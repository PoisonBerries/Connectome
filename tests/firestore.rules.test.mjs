// Exercises firestore.rules against the local Firestore emulator (not the real project — no credentials needed).
// Requires Java (the emulator is a JVM process). Run with:
//
//   npm install                                          # once, pulls in firebase-tools + rules-unit-testing
//   npx firebase emulators:exec --only firestore,auth --project demo-connectome "node tests/firestore.rules.test.mjs"
//
// or just `npm run test:rules`, which does the same thing. This is separate from tests/game.test.mjs (which has no
// such dependency) and is not part of the GitHub Actions workflow, since CI has no reason to install a JVM for it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, increment, serverTimestamp } from 'firebase/firestore';

const PROJECT_ID = 'demo-connectome';
const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const play = (num, uid) => `plays/${num}_${uid}`;
const stats = (num) => `puzzleStats/${num}`;
const goodPlay = (overrides = {}) => ({
  puzzle: 8, uid: 'alice', score: 6, par: 5, won: true, path: ['Loki', 'gods', 'Ramadan'], ts: serverTimestamp(), ...overrides,
});

async function createPlay(ctx, uid, num, overrides = {}) {
  return setDoc(doc(ctx.firestore(), play(num, uid)), goodPlay({ puzzle: num, uid, ...overrides }));
}

let n = 0;
function ok(name, cond) {
  n++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) process.exitCode = 1;
}

try {
  // ---- plays: only a signed-in user, writing their own correctly-shaped, correctly-named, first-ever doc
  const anon = env.unauthenticatedContext();
  const alice = env.authenticatedContext('alice');
  const bob = env.authenticatedContext('bob');

  ok('anonymous (not even Firebase-anon-signed-in) cannot create a play', await fails(setDoc(doc(anon.firestore(), play(8, 'alice')), goodPlay())));
  ok('a signed-in user can create their own play doc', await succeeds(createPlay(alice, 'alice', 8)));
  ok('creating it again (resubmitting) is refused', await fails(createPlay(alice, 'alice', 8)));
  ok('a user cannot write a play doc claiming to be someone else', await fails(createPlay(alice, 'mallory', 8)));
  ok('the doc id must match puzzle_uid', await fails(setDoc(doc(alice.firestore(), 'plays/wrong_id'), goodPlay())));
  ok('score must be in range', await fails(createPlay(alice, 'alice', 9, { score: 99999 })));
  ok('path must be bounded', await fails(createPlay(alice, 'alice', 9, { path: Array(500).fill('x') })));
  ok('ts must be a real serverTimestamp, not a spoofed date', await fails(createPlay(alice, 'alice', 9, { ts: new Date() })));
  ok('play docs can never be read back by a client', await fails(getDoc(doc(alice.firestore(), play(8, 'alice')))));
  ok('play docs can never be updated', await fails(updateDoc(doc(alice.firestore(), play(8, 'alice')), { score: 1 })));

  // ---- puzzleStats: requires a matching play doc first, then only exactly-one-play-sized deltas
  ok('cannot touch puzzleStats without a matching play doc', await fails(setDoc(doc(bob.firestore(), stats(50)), { attempts: increment(1) }, { merge: true })));

  await createPlay(alice, 'alice', 10, { won: false }); // a loss: no count/sumScore/hist/paths in the update at all
  ok('first-ever finish on a puzzle (a loss) can create the aggregate', await succeeds(
    setDoc(doc(alice.firestore(), stats(10)), { attempts: increment(1) }, { merge: true })
  ));
  let snap = await getDoc(doc(alice.firestore(), stats(10)));
  ok('the fresh aggregate has attempts=1, count=0 (no field at all)', snap.data().attempts === 1 && snap.data().count === undefined);

  await createPlay(bob, 'bob', 10, { won: true, score: 7 });
  ok('a second, different user can add a win on top of a loss-only aggregate', await succeeds(
    setDoc(doc(bob.firestore(), stats(10)), { attempts: increment(1), count: increment(1), sumScore: increment(7), 'hist.7': increment(1), 'paths.Loki%7Cgods%7CRamadan': increment(1) }, { merge: true })
  ));
  snap = await getDoc(doc(bob.firestore(), stats(10)));
  ok('aggregate now reflects both finishes', snap.data().attempts === 2 && snap.data().count === 1 && snap.data().sumScore === 7);

  ok('cannot jump attempts by more than 1 in a single write', await fails(
    setDoc(doc(bob.firestore(), stats(10)), { attempts: increment(5) }, { merge: true })
  ));
  ok('cannot touch two histogram buckets in one write', await fails(
    setDoc(doc(bob.firestore(), stats(10)), { attempts: increment(1), count: increment(1), sumScore: increment(5), 'hist.5': increment(1), 'hist.6': increment(1), 'paths.x': increment(1) }, { merge: true })
  ));
  ok('cannot record a win without also updating sumScore/hist/paths', await fails(
    setDoc(doc(bob.firestore(), stats(10)), { attempts: increment(1), count: increment(1) }, { merge: true })
  ));
  ok('cannot delete an aggregate', await fails(deleteDoc(doc(bob.firestore(), stats(10)))));

  // ---- reads
  ok('reading the public aggregate requires only being signed in', await succeeds(getDoc(doc(alice.firestore(), stats(10)))));
  ok('reading the aggregate while signed out is refused', await fails(getDoc(doc(anon.firestore(), stats(10)))));

  console.log(`\n${n} checks run`);
} finally {
  await env.cleanup();
}

async function succeeds(p) {
  try {
    await assertSucceeds(p);
    return true;
  } catch {
    return false;
  }
}
async function fails(p) {
  try {
    await assertFails(p);
    return true;
  } catch {
    return false;
  }
}
