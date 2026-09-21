# Connectome

A daily word game in the spirit of the Wikipedia link race. You start on one word and must reach another by hopping
between related words. **Every word links to its five most related words**, nothing more. Get from A to B in as few
hops as you can. A new puzzle arrives every day, and yours is scored against *par* (the true shortest route).

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
| Game logic | `web/js/game.js`, `data.js` | Pure state machine + BFS (par, hints); unit-checked in `tests/` |
| Look & feel | `web/js/stage.js`, `map.js`, `css/` | DOM buttons on an SVG synapse layer; canvas constellation of your explored network |
| Saves & stats | `web/js/store.js` | localStorage only, no accounts, no backend |

**Endless mode (∞):** a random start and target, with 5× par moves to connect them. Reach the target and it becomes your
next start word with a fresh target and a fresh move budget; run out of moves and the run ends. Par ramps 4 → 8 over the
first ten links, hints spend moves, and your score is links chained. Rules live in `web/js/endless.js`; targets are drawn
from the `e` (endpoint pool) list in `graph.json`.

**Scoring (daily):** hops = every forward move (dead ends count; stepping back is free). Hints add to that: *Gateways* +1
(shows every word that links straight to the target), *Compass* +2 (highlights options on a shortest route).
Rating tiers run from *Perfect wiring* (par) down to *Tangled*. The share text is spoiler-free:
🟩 closer · 🟨 sideways · 🟥 farther.

**Difficulty curve:** par is 5 on Monday/Tuesday, 6 on Wed/Thu, 7 on Fri/Sat, 8 on Sunday. A simple simulated
"semantic hill-climbing" player needs a median of ~15-28 clicks on these, matching typical human play.

## Regenerating the data (`pipeline/`)

```sh
cd pipeline
pip install -r requirements.txt
./download.sh                 # GloVe + fastText word list into raw/ (~1 GB, git-ignored)
python3 prepare_vectors.py    # extract the vectors we need
python3 build.py 6000 1.0     # vocabulary + hub-corrected top-5 neighbour graph -> out/graph.npz
python3 make_puzzles.py 730   # puzzle calendar -> web/data/
node ../tests/game.test.mjs   # sanity checks on the shipped data
```

Relatedness = cosine similarity of GloVe vectors after "all-but-the-top" post-processing, with a CSLS hub penalty so a
few generic words don't appear in everyone's top five. The five links are then chosen for *diversity* (an MMR penalty
keeps them from being five near-synonyms, which is what pulls in associations like kimchi → Korea) with a small bonus for
links the other word would return. `pipeline/evaluate.py` compares variants on structure, path length and a simulated
player: versus plain top-five, this cut tight cliques from 13% to 1.5% and raised the simulated solve rate from 45% to 64%.
Each endpoint also gets an *approachability* score (how often a simple navigator reaches it) so endless mode avoids
near-unreachable targets. Inflections and obvious relatives (dog/dogs, photo/photograph)
are never offered as neighbours. Proper nouns come from a hand-curated list (`proper_nouns.txt`) rather than the
news-heavy raw corpus, and profanity, slurs, and graphic-violence terms are excluded (`lexicon.py`).
Endpoint words carry a **theme** (place, people, fiction, brand, food, animal, object, nature, ...). Puzzles and endless
targets are drawn theme-first, and a start and target never share a theme, so there is no "Paris → Austria". Re-running
`make_puzzles.py` keeps every already-published puzzle (through launch day) and only regenerates the future ones.
Every puzzle's endpoints are picturable, well-known words that are semantically unrelated, and each is verified
solvable by the simulated player.

To tune the vocabulary, edit the lists in `proper_nouns.txt`, `lexicon.py` and `puzzle_lib.py`, then rerun the last
three steps. `python3 inspect_graph.py pizza Paris Zeus` prints any word's five neighbours.

## Data licences

- [GloVe](https://nlp.stanford.edu/projects/glove/) (Stanford), Public Domain Dedication and License.
- [fastText wiki-news vectors](https://fasttext.cc/docs/en/english-vectors.html), CC BY-SA 3.0 (only used for capitalisation).
- WordNet (Princeton), used for filtering.
