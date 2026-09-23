// Exercises firestore.rules against the local Firestore emulator (not the real project — no credentials needed).
// Requires Java (the emulator is a JVM process). Run with:
//
//   npm install                                          # once, pulls in firebase-tools + rules-unit-testing
//   npx firebase emulators:exec --only firestore,auth --project demo-connectome "node tests/firestore.rules.test.mjs"
//
// or just `npm run test:rules`, which does the same thing. This is separate from tests/game.test.mjs (which has no
// such dependency); CI runs it as its own `test-rules` job (with Java installed via actions/setup-java) that's
// independent of `deploy`, since the rules are published separately to the Firebase console, not part of the site.
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

  await createPlay(alice, 'alice', 10, { won: false }); // a loss: no count/sumScore/hist/firstWord/lastWord in the update at all
  ok('first-ever finish on a puzzle (a loss) can create the aggregate', await succeeds(
    setDoc(doc(alice.firestore(), stats(10)), { attempts: increment(1) }, { merge: true })
  ));
  let snap = await getDoc(doc(alice.firestore(), stats(10)));
  ok('the fresh aggregate has attempts=1, count=0 (no field at all)', snap.data().attempts === 1 && snap.data().count === undefined);

  // Note the write style below: updateDoc() with a dotted string key ("hist.7") is what actually merges into one
  // key of an existing nested map without disturbing its siblings. setDoc(...,{merge:true}) does NOT parse a dotted
  // string key the same way — it stores a literal field named "hist.7" — so it's only used below for the one case
  // where that's actually correct (creating the very first entry in a map that doesn't exist yet, nothing to
  // preserve). Using the wrong one of the two for an update is exactly the bug this whole aggregate design had
  // until it was caught by testing against the real project: see the "malformed update" checks further down.
  const win7 = { attempts: increment(1), count: increment(1), sumScore: increment(7), 'hist.7': increment(1), 'firstWord.gods': increment(1), 'lastWord.feast': increment(1) };
  await createPlay(bob, 'bob', 10, { won: true, score: 7 });
  ok('a second, different user can add a win on top of a loss-only aggregate', await succeeds(
    updateDoc(doc(bob.firestore(), stats(10)), win7)
  ));
  snap = await getDoc(doc(bob.firestore(), stats(10)));
  ok('aggregate now reflects both finishes, with real nested maps', snap.data().attempts === 2 && snap.data().count === 1 && snap.data().sumScore === 7
    && snap.data().hist?.['7'] === 1 && snap.data().firstWord?.gods === 1 && snap.data().lastWord?.feast === 1);

  ok('cannot jump attempts by more than 1 in a single write', await fails(
    updateDoc(doc(bob.firestore(), stats(10)), { attempts: increment(5) })
  ));
  ok('cannot touch two histogram buckets in one write', await fails(
    updateDoc(doc(bob.firestore(), stats(10)), { attempts: increment(1), count: increment(1), sumScore: increment(5), 'hist.5': increment(1), 'hist.6': increment(1), 'firstWord.x': increment(1), 'lastWord.y': increment(1) })
  ));
  ok('cannot touch two first-word buckets in one write', await fails(
    updateDoc(doc(bob.firestore(), stats(10)), { attempts: increment(1), count: increment(1), sumScore: increment(5), 'hist.5': increment(1), 'firstWord.x': increment(1), 'firstWord.z': increment(1), 'lastWord.y': increment(1) })
  ));
  ok('cannot record a win while updating firstWord but not lastWord', await fails(
    updateDoc(doc(bob.firestore(), stats(10)), { attempts: increment(1), count: increment(1), sumScore: increment(5), 'hist.5': increment(1), 'firstWord.x': increment(1) })
  ));
  ok('cannot record a win without also updating sumScore/hist/firstWord/lastWord', await fails(
    updateDoc(doc(bob.firestore(), stats(10)), { attempts: increment(1), count: increment(1) })
  ));
  ok('cannot delete an aggregate', await fails(deleteDoc(doc(bob.firestore(), stats(10)))));

  // ---- the malformed-update bug, kept as a regression test: writing a dotted key via setDoc+merge instead of
  // updateDoc() produces a literal "hist.9" field rather than a real hist map, which the rules correctly reject
  // once the doc already exists (they can't tell it apart from tampering — that's the point).
  const carol = env.authenticatedContext('carol');
  await createPlay(carol, 'carol', 10, { won: true, score: 9 });
  ok('a malformed dotted-key write via setDoc+merge against an EXISTING doc is rejected, not silently wrong', await fails(
    setDoc(doc(carol.firestore(), stats(10)), { attempts: increment(1), count: increment(1), sumScore: increment(9), 'hist.9': increment(1), 'firstWord.x': increment(1), 'lastWord.y': increment(1) }, { merge: true })
  ));

  // ---- the same bug, but on a brand-new puzzle (a create): a flat "hist.5" field isn't a size-1 hist map, so the
  // create-time shape check added after this bug was found catches it too.
  const dave = env.authenticatedContext('dave');
  await createPlay(dave, 'dave', 60, { won: true, score: 5 });
  ok('a malformed dotted-key write via setDoc+merge on a FRESH puzzle is also rejected', await fails(
    setDoc(doc(dave.firestore(), stats(60)), { attempts: increment(1), count: increment(1), sumScore: increment(5), 'hist.5': increment(1), 'firstWord.x': increment(1), 'lastWord.y': increment(1) }, { merge: true })
  ));
  ok('the correctly-shaped create for that same fresh puzzle succeeds', await succeeds(
    setDoc(doc(dave.firestore(), stats(60)), { attempts: increment(1), count: increment(1), sumScore: increment(5), hist: { 5: increment(1) }, firstWord: { x: increment(1) }, lastWord: { y: increment(1) } }, { merge: true })
  ));
  const erin = env.authenticatedContext('erin');
  await createPlay(erin, 'erin', 61, { won: true, score: 5 });
  ok('a create with mismatched map sizes (firstWord missing its entry) is rejected', await fails(
    setDoc(doc(erin.firestore(), stats(61)), { attempts: increment(1), count: increment(1), sumScore: increment(5), hist: { 5: increment(1) }, firstWord: {}, lastWord: { y: increment(1) } }, { merge: true })
  ));

  // ---- reads
  ok('reading the public aggregate requires only being signed in', await succeeds(getDoc(doc(alice.firestore(), stats(10)))));
  ok('reading the aggregate while signed out is refused', await fails(getDoc(doc(anon.firestore(), stats(10)))));

  // ---- endlessRecord: a single global "longest chain" number, only ever movable upward
  const record = doc(alice.firestore(), 'endlessRecord/global');
  const goodRecord = (overrides = {}) => ({ links: 10, hops: 40, ts: serverTimestamp(), ...overrides });

  ok('signed-out cannot create the record', await fails(setDoc(doc(anon.firestore(), 'endlessRecord/global'), goodRecord())));
  ok('links out of range is refused', await fails(setDoc(record, goodRecord({ links: 0 }))));
  ok('links above the plausibility cap is refused', await fails(setDoc(record, goodRecord({ links: 501 }))));
  ok('hops less than links is refused (can\'t chain N links in fewer than N hops)', await fails(setDoc(record, goodRecord({ links: 10, hops: 5 }))));
  ok('a spoofed ts instead of serverTimestamp is refused', await fails(setDoc(record, goodRecord({ ts: new Date() }))));
  ok('a signed-in user can set the first-ever record', await succeeds(setDoc(record, goodRecord())));

  ok('an update that does not beat the current record is refused', await fails(setDoc(doc(bob.firestore(), 'endlessRecord/global'), goodRecord({ links: 10 }))));
  ok('an update with fewer links than the current record is refused', await fails(setDoc(doc(bob.firestore(), 'endlessRecord/global'), goodRecord({ links: 4 }))));
  ok('an update that genuinely beats the current record succeeds', await succeeds(setDoc(doc(bob.firestore(), 'endlessRecord/global'), goodRecord({ links: 11, hops: 44 }))));
  ok('the record now reflects the higher value', (await getDoc(record)).data().links === 11);
  ok('deleting the record is always refused', await fails(deleteDoc(record)));
  ok('reading the record while signed out is refused', await fails(getDoc(doc(anon.firestore(), 'endlessRecord/global'))));

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
