"""Generate the daily puzzle calendar + ship the graph to the web app.

  python3 make_puzzles.py [N_DAYS]

Outputs web/data/graph.json and web/data/puzzles.json.
"""
import json
import os
import sys
import datetime as dt
import numpy as np
from scipy.sparse.csgraph import shortest_path

from puzzle_lib import load, adjacency, endpoint_pool, agent_moves
from common import HERE

EPOCH = dt.date(2026, 9, 21)  # puzzle #1 (a Monday)
N_DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 730
WEB = os.path.join(HERE, "..", "web", "data")
os.makedirs(WEB, exist_ok=True)

# Monday (easy) ... Sunday (hard): shortest-path length in hops
DIST_BY_WEEKDAY = [5, 5, 6, 6, 7, 7, 8]
COS_MAX = 0.22        # endpoints must be semantically unrelated, or the puzzle is trivial
AGENT_MAX = 3.6       # a simple semantic-hill-climbing player must succeed within this many x par
REUSE_GAP = 200       # days before an endpoint can reappear

LABELS = {
    "noun.animal": "animal", "noun.food": "food or drink", "noun.artifact": "object", "noun.plant": "plant",
    "noun.body": "body part", "noun.location": "place", "noun.object": "natural thing", "noun.person": "person or role",
    "noun.substance": "material", "noun.shape": "shape", "noun.group": "group", "noun.act": "activity",
    "noun.communication": "concept", "noun.cognition": "concept", "noun.event": "event", "noun.phenomenon": "phenomenon",
    "countries": "country", "continents_regions": "place", "cities": "city", "us_states": "US state",
    "history_people": "historical figure", "arts_people": "artist or athlete", "fiction": "pop culture",
    "mythology": "myth & legend", "space": "space", "brands": "brand", "culture_misc": "culture",
    "landmarks": "landmark", "common_phrases": "everyday phrase",
}

def label(i):
    if kinds[i] == 1 or cats[i] in LABELS and kinds[i] == 2:
        return LABELS.get(cats[i], "")
    return ""  # plain words: a WordNet-derived label is too often wrong ("pineapple: plant") to be worth showing


G = load()
words, nb, kinds, cats, vecs = G["words"], G["nbrs"], G["kinds"], G["cats"], G["vecs"]
n = G["n"]
A = adjacency(nb)
pool = endpoint_pool(G)
print("endpoint pool:", len(pool))

D = shortest_path(A, method="D", unweighted=True, indices=pool)[:, pool]
C = vecs[pool] @ vecs[pool].T
P = len(pool)
rng = np.random.default_rng(20260921)

last_used = np.full(P, -10**6)
type_of = [("P:" + cats[i]) if kinds[i] == 1 else ("C:" + cats[i]) for i in pool]
puzzles = []
cos_cache = {}

for day in range(N_DAYS):
    date = EPOCH + dt.timedelta(days=day)
    want = DIST_BY_WEEKDAY[date.weekday()]
    order = rng.permutation(P)
    found = None
    prev_types = {puzzles[-1]["_t"][0], puzzles[-1]["_t"][1]} if puzzles else set()
    for a in order:
        if day - last_used[a] < REUSE_GAP:
            continue
        if type_of[a] in prev_types and len(prev_types) and rng.random() < 0.7:
            continue
        cand = np.where((D[a] == want) & (C[a] < COS_MAX))[0]
        cand = [b for b in cand if day - last_used[b] >= REUSE_GAP and type_of[b] != type_of[a]]
        rng.shuffle(cand)
        for b in cand[:12]:
            ia, ib = pool[a], pool[b]
            m = agent_moves(nb, vecs @ vecs[ib], ia, ib)
            if m is not None and m <= AGENT_MAX * want:
                found = (a, b, m)
                break
        if found:
            break
    if not found:
        raise SystemExit(f"no puzzle for day {day}")
    a, b, m = found
    last_used[a] = last_used[b] = day
    puzzles.append(dict(start=words[pool[a]], target=words[pool[b]], par=int(want), agent=int(m),
                        sl=label(pool[a]), tl=label(pool[b]),
                        _t=(type_of[a], type_of[b])))

for i in list(range(14)) + [100, 200, 400]:
    p = puzzles[i]
    print(f"#{i+1:<4} {(EPOCH+dt.timedelta(days=i)).strftime('%a')}  {p['start']:>14} -> {p['target']:<14} par {p['par']}  agent {p['agent']:>2}  [{p['sl']} / {p['tl']}]")

# ------------------------------------------------------------------ ship
out_graph = dict(w=words, k=[int(x) for x in kinds], n=[int(x) for x in nb.ravel()])
with open(os.path.join(WEB, "graph.json"), "w") as f:
    json.dump(out_graph, f, separators=(",", ":"))
out_p = dict(epoch=EPOCH.isoformat(),
             puzzles=[[p["start"], p["target"], p["par"], p["sl"], p["tl"]] for p in puzzles])
with open(os.path.join(WEB, "puzzles.json"), "w") as f:
    json.dump(out_p, f, separators=(",", ":"))
print("wrote", os.path.getsize(os.path.join(WEB, "graph.json")) // 1024, "KB graph;",
      os.path.getsize(os.path.join(WEB, "puzzles.json")) // 1024, "KB puzzles")
