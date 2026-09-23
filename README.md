# Connectome

A daily word game in the spirit of the Wikipedia link race. You start on one word and must reach another by hopping
between related words. **Every word links to its five most related words**, nothing more. Get from A to B in as few
hops as you can. A new puzzle arrives every day, and yours is scored against *min* (the true shortest route).

The name is the theme: words are neurons, hops are synapses, and at the end you get to see the connectome you grew.

## Play locally

The game is a static site with no build step. Serve the `web/` folder (ES modules don't load from `file://`):

```sh
cd web && python3 -m http.server 8000   # then open http://localhost:8000
```

Handy URLs: `?p=3` replays an earlier puzzle; add `&dev=1` to preview future ones.

## Deploy to GitHub Pages

`.github/workflows/pages.yml` runs the tests and publishes `web/`. In the repo: **Settings → Pages → Source: GitHub Actions**,
then push to `main`. All asset paths are relative, so it works under `https://<user>.github.io/Connectome/`.

## How it works

| Piece | Where | Notes |
|---|---|---|
| Word graph | `web/data/graph.json` | ~7,500 nodes, 5 out-links each, one strongly-connected component (every word can reach every other) |
| Daily puzzles | `web/data/puzzles.json` | 730 days, generated offline. Launch day was 2026-09-21 (#8); #1-#7 are archive puzzles for 9/14-9/20. Rolls over at the player's local midnight |
| Game logic | `web/js/game.js`, `data.js` | Pure state machine + BFS (min, hints); unit-checked in `tests/` |
| Look & feel | `web/js/stage.js`, `map.js`, `css/` | DOM buttons on an SVG synapse layer; canvas constellation of your explored network |
| Saves & stats | `web/js/store.js` | localStorage only, no accounts, no backend |
| Community stats | `web/js/firebase.js`, `firestore.rules` | optional; see [Community stats](#community-stats-optional) below |

**Endless mode (∞):** a random start and target. Each round's move budget starts at 20, then shrinks by 2 every round
(never below the round's min plus a small buffer, so a clean run is always theoretically possible) — but any moves
left over when you reach the target carry straight into the next round's budget on top of that, shown with a
"+N carried" flourish over the moves counter. Reach the target and it becomes your next start word with a fresh
target; run out of moves and the run ends. Min ramps 4 → 8 over the first ten links (a separate curve from the
budget), hints spend moves, and your score is links chained. The free step back and each hint are single-use per
round rather than per puzzle, resetting whenever you reach a target and a new round begins. Rules live in
`web/js/endless.js`; targets are drawn from the `e` (endpoint pool) list in `graph.json`.

**Scoring (daily):** hops = every forward move (dead ends count). Hints add to that, cheapest first: *Plasticity* +1
(grows 3 extra links on the current word: the next 3 most related words after its usual five, from `graph.json`'s `x`
field), *Compass* +3 (highlights options on a shortest route), *Gateways* +5 (shows every word that links straight to
the target).
Stepping back — the Back button, or jumping to an earlier word in the trail — is free, and each hint is a one-time
purchase, but both are single-use per puzzle: once you've spent your one free step back, or bought a given hint, it's
gone for the rest of that puzzle (buying it again on the same word you already paid for would just show the same
thing anyway). Rating tiers run from *Perfect wiring* (min) down to *Tangled*. The share text is spoiler-free:
🟩 closer · 🟨 sideways · 🟥 farther.

**Difficulty curve:** min is 5 on Monday/Tuesday, 6 on Wed/Thu, 7 on Fri/Sat, 8 on Sunday. A simple simulated
"semantic hill-climbing" player needs a median of ~15-28 clicks on these, matching typical human play.

**Community stats:** once you finish a daily puzzle, the result screen shows how you compare — solve count, the
average number of hops, the percentage of solvers you beat (wins only; a give-up doesn't get a percentile), and the
most common first hop and the most common word right before the target (shown plainly, not behind a click — a single
word each isn't much of a spoiler). This is entirely optional: the game works exactly the same without it, just
without that section. See [Community stats (optional)](#community-stats-optional) to turn it on.

## Community stats (optional)

This is a small Firestore backend (Firebase's free Spark plan covers it) that every player writes one anonymous,
immutable record to per daily puzzle, and a per-puzzle aggregate they nudge by exactly one play's worth on each
finish. No accounts, no names, no emails — the only identity involved is a random ID from Firebase Anonymous Auth,
and it isn't stored on the aggregate at all. `web/js/firebase.js` has the full data model and client code;
`firestore.rules` is what actually enforces all of this server-side (both files are commented throughout).

**Setup** (one-time, in the [Firebase console](https://console.firebase.google.com/)):

1. **Authentication → Sign-in method → Anonymous → Enable.** This is the only auth method the game uses; there's no
   sign-up flow, it happens silently the first time someone finishes a puzzle.
2. **Firestore Database → Create database → Production mode**, any region (the rules below are the actual access
   control, "production mode" here just means "start from deny-all" — the region only affects latency).
3. **Firestore Database → Rules → paste in the contents of `firestore.rules`** from this repo → Publish.
   (If you have the [Firebase CLI](https://firebase.google.com/docs/cli) set up and linked to this project instead,
   `firebase deploy --only firestore:rules` does the same thing from the command line.)
4. **Project settings (gear icon) → General → Your apps → add a Web app** (or open the existing one) → copy the
   `firebaseConfig` object it shows you.
5. Paste the `apiKey` and `appId` from that object into `web/js/firebase.js` (`projectId`/`authDomain` are already
   filled in for `connectome-53d32`; change them too if you're pointing this at a different Firebase project).
6. Commit and push. That's it — no server to run, no environment variables, nothing to deploy beyond the rules.

**Threat model, stated plainly:** there's no backend verifying a puzzle was actually solved (that needs a Cloud
Function, which needs the paid Blaze plan — still free up to a large quota, just requires a card on file). The rules
stop the cheap kind of tampering: writing arbitrary numbers into the aggregate, resubmitting the same puzzle to pad
it, or forging someone else's ID. They can't stop someone from opening devtools, creating a fresh anonymous identity,
and submitting one fabricated-but-plausible play. That's an accepted limitation of a free, backend-less setup — if it
ever becomes a real problem, the fix is moving the aggregate update into a Cloud Function that checks the path against
the actual graph before trusting it.

**Testing the rules:** `tests/firestore.rules.test.mjs` exercises `firestore.rules` against a local emulator (not
your real project — no credentials touched), and runs as its own check in CI (`.github/workflows/pages.yml`) on every
push. To run it locally you need Java (the emulator is a JVM process):

```sh
npm install
npm run test:rules
```

If `npx firebase ...` crashes with `ERR_REQUIRE_ESM` from inside `universal-analytics`: that package's `0.5.4`
release (a dependency of `firebase-tools`, used only for its own anonymous CLI telemetry) shipped a broken dependency
on ESM-only `uuid@14`, while it still uses `require()` itself. `package.json` already pins it back to the last good
release (`0.5.3`) via `overrides`; a plain `npm install` picks that up. Safe to remove once `firebase-tools` bumps
past the broken release upstream.

## Regenerating the data (`pipeline/`)

```sh
cd pipeline
pip install -r requirements.txt
./download.sh                 # GloVe 6B + 840B + fastText word list into raw/ (~3 GB, git-ignored)
python3 prepare_vectors.py    # word list + ranks from GloVe 6B
python3 prepare_vectors840.py # the cased GloVe 840B vectors we actually use for similarity
python3 build.py 6000 1.0 --anchor 0.3  # vocabulary + hub-corrected top-5 neighbour graph -> out/graph.npz
python3 make_puzzles.py 730   # puzzle calendar -> web/data/
node ../tests/game.test.mjs   # sanity checks on the shipped data
```

Relatedness = cosine similarity of GloVe 840B vectors (Common Crawl, cased; Capitalised vectors for proper nouns) after "all-but-the-top" post-processing, with a CSLS hub penalty so a
few generic words don't appear in everyone's top five. The five links are then chosen for *diversity* (an MMR penalty
keeps them from being five near-synonyms, which is what pulls in associations like kimchi → Korea) with a small bonus for
links the other word would return. `pipeline/evaluate.py` compares variants on structure, path length and a simulated
player: versus plain top-five, this cut tight cliques from 13% to 1.5% and raised the simulated solve rate from 45% to 64%.
Each endpoint also gets an *approachability* score (how often a simple navigator reaches it) so endless mode avoids
near-unreachable targets. Inflections and obvious relatives (dog/dogs, photo/photograph)
are never offered as neighbours. Proper nouns come from a hand-curated list (`proper_nouns.txt`) rather than the
news-heavy raw corpus, and profanity, slurs, and graphic-violence terms are excluded (`lexicon.py`).
A raw GloVe vector blends *every* sense of a surface form by how often each occurs in Common Crawl text, so a
minority sense (Bosch the painter, myrtle the plant) can lose out to a majority one (Bosch the auto-parts/appliance
brand, "Myrtle Beach") and pull in nonsense neighbours (Roomba, a grinder; sandcastle, resort). `--anchor` corrects
only the outliers: every word is grouped by its section (a curated proper noun's category, or a common word's
WordNet lexname), and if its raw vector sits unusually far from the average of its own section (below the
section's 10th-60th percentile of similarity-to-centroid), it's pulled proportionally toward that average; words
already sitting comfortably in their section (most of them) are left untouched so genuine cross-topic bridges
survive. A flat pull on every word was tried first and fixed the same cases, but indiscriminately dragging
well-placed ones too cost 10-25 points of simulated solve rate in `evaluate.py`; the outlier-only version costs
none - it's actually raised solve rate slightly, since the words it fixes were creating bad bridges elsewhere too.
A handful of pairs have no shared theme even in hindsight (llama <-> karaoke) and aren't a single word swimming
toward the wrong sense so much as a stray corpus coincidence between two otherwise-fine words; those are named
directly in `lexicon.py`'s `BANNED_PAIRS` and never linked, found by manually reading generated puzzle routes.
Every puzzle target also needs at least `MIN_TARGET_INDEGREE` (`puzzle_lib.py`) words that link straight to it, so
the Gateways hint always has something to show and a target never reduces to one narrow route in.
Endpoint words carry a **theme** (place, people, fiction, brand, food, animal, object, nature, ...). Puzzles and endless
targets are drawn theme-first, and a start and target never share a theme, so there is no "Paris → Austria". Re-running
`make_puzzles.py` keeps every already-published puzzle (through launch day) and only regenerates the future ones.
Every puzzle's endpoints are picturable, well-known words that are semantically unrelated, and each is verified
solvable by the simulated player.

To tune the vocabulary, edit the lists in `proper_nouns.txt`, `lexicon.py` and `puzzle_lib.py`, then rerun the last
three steps. `python3 inspect_graph.py pizza Paris Zeus` prints any word's five neighbours.

## Data licences

- [GloVe](https://nlp.stanford.edu/projects/glove/) 6B and 840B (Stanford), Public Domain Dedication and License.
- [fastText wiki-news vectors](https://fasttext.cc/docs/en/english-vectors.html), CC BY-SA 3.0 (only used for capitalisation).
- WordNet (Princeton), used for filtering.
