// Optional community stats: "how you did vs. average" and "the most common route", via Firestore + Anonymous Auth.
//
// Everything in this file is best-effort. The game is fully playable without it — if Firebase is blocked (ad
// blockers commonly block Google/Firebase domains), the network is down, or the project isn't configured yet, every
// export here resolves to "unavailable" rather than throwing, and callers must treat that as normal.
//
// Data model (see ../../firestore.rules for what is actually enforced server-side):
//   plays/{puzzle}_{uid}   one immutable doc per player per daily puzzle: {puzzle, uid, score, par, won, path, ts}
//   puzzleStats/{puzzle}   an aggregate, updated with increment() on every finish (no read-modify-write needed):
//     attempts   every finish, win or lose/give-up
//     count      wins only — the denominator for "average" and "most common route"
//     sumScore   sum of scores among wins (avg = sumScore / count)
//     hist.N     wins with score exactly N, N capped at HIST_CAP (an overflow bucket beyond that)
//     paths.K    wins whose route encodes to key K = encodeURIComponent(words.join('|'))

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const HIST_CAP = 40;
const TIMEOUT_MS = 8000; // generous: this never blocks the UI, and a first-ever visit pays for SDK load + auth + write

// Public web config: safe to ship in client code (Firebase enforces access via security rules, not by hiding this).
// apiKey / appId come from Firebase console -> Project settings -> General -> Your apps -> Web app.
const firebaseConfig = {
  apiKey: 'AIzaSyAcg0t8cO10raPNmZv0cxk2pTKCnc3FKgY',
  authDomain: 'connectome-53d32.firebaseapp.com',
  projectId: 'connectome-53d32',
  storageBucket: 'connectome-53d32.firebasestorage.app',
  appId: '1:989973318837:web:037503419ddcf7e230c2fc',
};

let readyPromise = null;

function withTimeout(promise, ms = TIMEOUT_MS) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('firebase: timed out')), ms))]);
}

/** Lazily loads the SDK and signs in anonymously. Never called until a caller actually needs it. */
function load() {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'REPLACE_ME') {
        throw new Error('firebase not configured (see web/js/firebase.js)');
      }
      const [{ initializeApp }, authMod, fsMod] = await Promise.all([
        import(/* @vite-ignore */ `${SDK}/firebase-app.js`),
        import(/* @vite-ignore */ `${SDK}/firebase-auth.js`),
        import(/* @vite-ignore */ `${SDK}/firebase-firestore.js`),
      ]);
      const app = initializeApp(firebaseConfig);
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);
      await new Promise((resolve, reject) => {
        const unsub = authMod.onAuthStateChanged(
          auth,
          (user) => {
            if (user) {
              unsub();
              resolve();
            }
          },
          (err) => {
            unsub();
            reject(err);
          }
        );
        authMod.signInAnonymously(auth).catch(reject);
      });
      return { fsMod, db, uid: auth.currentUser.uid };
    })();
  }
  return withTimeout(readyPromise);
}

const pathKey = (words) => encodeURIComponent(words.join('|'));
const keyToPath = (key) => decodeURIComponent(key).split('|');

/**
 * Records one finished daily puzzle. Safe to call every time a puzzle is finished; callers should still only call it
 * once per puzzle (main.js gates this on the same "first time this puzzle was recorded" check used for local stats).
 * @returns {Promise<boolean>} whether it was actually recorded.
 */
export async function submitDailyResult(puzzleNum, { score, par, won, path }) {
  try {
    const { fsMod, db, uid } = await load();
    const playRef = fsMod.doc(db, 'plays', `${puzzleNum}_${uid}`);
    const statsRef = fsMod.doc(db, 'puzzleStats', String(puzzleNum));
    const bucket = Math.min(score, HIST_CAP);
    const key = pathKey(path);

    await withTimeout(
      fsMod.setDoc(playRef, { puzzle: puzzleNum, uid, score, par, won, path, ts: fsMod.serverTimestamp() })
    );

    // updateDoc() parses a dotted string key ("hist.5") as a real nested-field path, merging into just that one key
    // without disturbing any other bucket already there. setDoc(...,{merge:true}) does NOT do this for a plain
    // string key — it would store a literal field literally named "hist.5" — so it's only safe to use as the
    // create-time fallback below, where hist/paths don't exist yet and there's nothing to accidentally clobber.
    const dotted = { attempts: fsMod.increment(1) };
    if (won) {
      dotted.count = fsMod.increment(1);
      dotted.sumScore = fsMod.increment(score);
      dotted[`hist.${bucket}`] = fsMod.increment(1);
      dotted[`paths.${key}`] = fsMod.increment(1);
    }
    try {
      // updateDoc() requires the doc to already exist; on a fresh puzzle nobody has finished yet, Firestore's rules
      // evaluate this as an update against a nonexistent resource and it comes back as permission-denied, not some
      // more specific "not found" code — so there's no reliable way to distinguish "doesn't exist yet" from a real
      // rejection other than trying the create-shaped write next and letting IT fail on its own if something is
      // actually wrong.
      await withTimeout(fsMod.updateDoc(statsRef, dotted));
    } catch {
      const fresh = { attempts: fsMod.increment(1) };
      if (won) {
        fresh.count = fsMod.increment(1);
        fresh.sumScore = fsMod.increment(score);
        fresh.hist = { [bucket]: fsMod.increment(1) };
        fresh.paths = { [key]: fsMod.increment(1) };
      }
      await withTimeout(fsMod.setDoc(statsRef, fresh, { merge: true }));
    }
    return true;
  } catch (e) {
    console.warn('[connectome] could not record community stats:', e && e.message);
    return false;
  }
}

/** @returns {Promise<null|{attempts:number, solved:number, avg:number|null, hist:object, bestPath:string[]|null, bestPathPct:number}>} */
export async function fetchDailyStats(puzzleNum) {
  try {
    const { fsMod, db } = await load();
    const snap = await withTimeout(fsMod.getDoc(fsMod.doc(db, 'puzzleStats', String(puzzleNum))));
    if (!snap.exists()) return { attempts: 0, solved: 0, avg: null, hist: {}, bestPath: null, bestPathPct: 0 };
    const d = snap.data();
    const hist = d.hist || {};
    const paths = d.paths || {};
    const count = d.count || 0;
    let bestKey = null;
    let bestN = 0;
    for (const [k, n] of Object.entries(paths)) {
      if (n > bestN) {
        bestN = n;
        bestKey = k;
      }
    }
    return {
      attempts: d.attempts || 0,
      solved: count,
      avg: count ? (d.sumScore || 0) / count : null,
      hist,
      bestPath: bestKey ? keyToPath(bestKey) : null,
      bestPathPct: count ? Math.round((100 * bestN) / count) : 0,
    };
  } catch (e) {
    console.warn('[connectome] could not load community stats:', e && e.message);
    return null;
  }
}

/** Share of recorded wins with a strictly worse (higher) score than `score`. Null if there is no data yet. */
export function percentileBetterThan(hist, score) {
  const total = Object.values(hist).reduce((a, b) => a + b, 0);
  if (!total) return null;
  let worse = 0;
  for (const [k, n] of Object.entries(hist)) if (Number(k) > score) worse += n;
  return Math.round((100 * worse) / total);
}
