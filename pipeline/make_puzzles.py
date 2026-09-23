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

from puzzle_lib import load, adjacency, endpoint_pool, agent_moves, theme_of, compute_overrides
from common import HERE

EPOCH = dt.date(2026, 9, 21)  # launch day (a Monday); archive puzzles run back from here
N_DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 730
PAST_DAYS = 7
WEB = os.path.join(HERE, "..", "web", "data")
os.makedirs(WEB, exist_ok=True)

# Monday (easy) ... Sunday (hard): shortest-path length in hops
DIST_BY_WEEKDAY = [5, 5, 6, 6, 7, 7, 8]
COS_MAX = 0.22        # endpoints must be semantically unrelated, or the puzzle is trivial
AGENT_MAX = 3.6       # a simple semantic-hill-climbing player must succeed within this many x min
REUSE_GAP = 200       # days before an endpoint can reappear

LABELS = {
    "noun.animal": "animal", "noun.food": "food or drink", "noun.artifact": "object", "noun.plant": "plant",
    "noun.body": "body part", "noun.location": "place", "noun.object": "natural thing", "noun.person": "person or role",
    "noun.substance": "material", "noun.shape": "shape", "noun.group": "group", "noun.act": "activity",
    "noun.communication": "concept", "noun.cognition": "concept", "noun.event": "event", "noun.phenomenon": "phenomenon",
    "countries": "country", "continents_regions": "place", "cities": "city", "us_states": "US state",
    "history_people": "historical figure", "arts_people": "artist or athlete", "fiction": "pop culture",
    "mythology": "myth & legend", "space": "space", "brands": "brand", "culture_misc": "culture",
    "landmarks": "landmark", "common_phrases": "everyday phrase", "foods": "food", "creatures": "animal", "games": "game", "everyday": "thing",
    "adjectives": "descriptive word", "verbs": "action",
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

overrides = compute_overrides(G, pool)
override_words = {w for pairs in overrides.values() for w, _ in pairs}
print(f"target overrides: {len(overrides)} targets, {sum(len(v) for v in overrides.values())} total splices, "
      f"{len(override_words)} distinct words affected")

D = shortest_path(A, method="D", unweighted=True, indices=pool)[:, pool]
C = vecs[pool] @ vecs[pool].T
P = len(pool)
rng = np.random.default_rng(20260921)

# ---- approachability: how often a simple semantic navigator reaches each word from elsewhere in the pool.
# Some words have gateways that are semantically odd, so you can't steer toward them (see evaluate.py); endless mode
# uses this to avoid rolling near-unreachable targets.
def approachability(samples=30):
    arng = np.random.default_rng(5)
    out = np.zeros(P, dtype=np.int16)
    for b in range(P):
        srcs = np.where((D[:, b] >= 4) & (D[:, b] <= 8))[0]
        if len(srcs) == 0:
            out[b] = 0
            continue
        srcs = arng.choice(srcs, min(samples, len(srcs)), replace=False)
        cosb = vecs @ vecs[pool[b]]
        wins = sum(agent_moves(nb, cosb, int(pool[a]), int(pool[b]), max_moves=int(5 * D[a, b])) is not None for a in srcs)
        out[b] = round(100 * wins / len(srcs))
    return out


approach = approachability()
print("approachability of endpoint words (%% solved by a simple navigator): p10=%d p25=%d p50=%d p75=%d" % tuple(np.percentile(approach, [10, 25, 50, 75])))

last_used = np.full(P, -10**6)
word2idx = {w: i for i, w in enumerate(words)}
pool_pos = {int(g): k for k, g in enumerate(pool)}
themes = [theme_of(G, i) for i in pool]
by_theme = {}
for k, t in enumerate(themes):
    by_theme.setdefault(t, []).append(k)
theme_names = sorted(by_theme)
# how often each theme is drawn (places are plentiful but shouldn't dominate)
THEME_WEIGHT = {"place": 0.7, "people": 1.0, "fiction": 1.0, "brand": 0.8, "culture": 1.0, "space": 0.4, "food": 1.2,
                "animal": 1.0, "plant": 0.6, "object": 1.4, "nature": 0.7, "building": 0.9}
theme_p = np.array([THEME_WEIGHT.get(t, 1.0) for t in theme_names])
theme_p /= theme_p.sum()


def choose(day, rng, prev_themes):
    """Pick a (start, target) pair for `day` (negative = pre-launch archive day).

    Draws a theme first (so the calendar is varied), then a word from it; the target is always from a *different*
    theme, so there is never a place -> place or food -> food puzzle.
    """
    date = EPOCH + dt.timedelta(days=day)
    want = DIST_BY_WEEKDAY[date.weekday()]
    for ti in rng.choice(len(theme_names), size=len(theme_names), replace=False, p=theme_p):
        t = theme_names[ti]
        if t in prev_themes and rng.random() < 0.7:
            continue
        members = list(by_theme[t])
        rng.shuffle(members)
        for a in members[:80]:
            if abs(day - last_used[a]) < REUSE_GAP:
                continue
            cand = np.where((D[a] == want) & (C[a] < COS_MAX))[0]
            cand = [b for b in cand if abs(day - last_used[b]) >= REUSE_GAP and themes[b] != t]
            rng.shuffle(cand)
            for b in cand[:12]:
                ia, ib = pool[a], pool[b]
                m = agent_moves(nb, vecs @ vecs[ib], ia, ib)
                if m is not None and m <= AGENT_MAX * want:
                    last_used[a] = last_used[b] = day
                    return dict(start=words[ia], target=words[ib], min=int(want), agent=int(m),
                                sl=label(ia), tl=label(ib), _t=(t, themes[b]))
    raise SystemExit(f"no puzzle for day {day}")


EPOCH_OUT = EPOCH - dt.timedelta(days=PAST_DAYS)
TOTAL = PAST_DAYS + N_DAYS
puzzles = [None] * TOTAL

# Puzzles up to and including today are already public (today's may already be mid-play): keep them, unless
# they break the theme rule (e.g. Namibia -> Toronto) or the graph has drifted under them, in which case they
# are re-rolled. KEEP only grows release over release - re-running this the day after launch must not regenerate
# a puzzle a player could already be looking at.
today_num = (dt.date.today() - EPOCH_OUT).days + 1
KEEP = max(PAST_DAYS + 1, today_num)
published = os.path.join(WEB, "puzzles.json")
old = json.load(open(published)) if os.path.exists(published) else None
if old and old.get("epoch") != EPOCH_OUT.isoformat():
    old = None
for idx in range(KEEP):
    if not old or idx >= len(old["puzzles"]):
        continue
    s_, t_, min_, sl, tl = old["puzzles"][idx]
    gs, gt = word2idx.get(s_), word2idx.get(t_)
    if gs is None or gt is None or theme_of(G, gs) == theme_of(G, gt):
        continue
    # the graph may have changed since it was published: use the true shortest route now, and re-roll if the
    # difficulty has drifted more than a hop from what that weekday calls for
    true_min = shortest_path(A, method="D", unweighted=True, indices=[gs])[0][gt]
    want = DIST_BY_WEEKDAY[(EPOCH + dt.timedelta(days=idx - PAST_DAYS)).weekday()]
    if not np.isfinite(true_min) or abs(true_min - want) > 1:
        print(f"published puzzle #{idx + 1} ({s_} -> {t_}) drifted to min {true_min}; re-rolling")
        continue
    min_ = int(true_min)
    puzzles[idx] = dict(start=s_, target=t_, min=min_, agent=0, sl=sl, tl=tl, _t=(theme_of(G, gs), theme_of(G, gt)))
    for g_ in (gs, gt):
        if g_ in pool_pos:
            last_used[pool_pos[g_]] = idx - PAST_DAYS

rng_fix = np.random.default_rng(20260922)
for idx in range(KEEP):
    if puzzles[idx] is None:
        prev = set(puzzles[idx - 1]["_t"]) if idx and puzzles[idx - 1] else set()
        puzzles[idx] = choose(idx - PAST_DAYS, rng_fix, prev)
        print(f"re-rolled published puzzle #{idx + 1}: {puzzles[idx]['start']} -> {puzzles[idx]['target']}")

for idx in range(KEEP, TOTAL):
    puzzles[idx] = choose(idx - PAST_DAYS, rng, set(puzzles[idx - 1]["_t"]))

for i in list(range(16)) + [100, 400, 700]:
    p = puzzles[i]
    print(f"#{i+1:<4} {(EPOCH_OUT+dt.timedelta(days=i)).strftime('%a')}  {p['start']:>14} -> {p['target']:<14} min {p['min']}  agent {p['agent']:>2}  [{p['sl']} / {p['tl']}]")

# ------------------------------------------------------------------ ship
out_graph = dict(w=words, k=[int(x) for x in kinds], n=[int(x) for x in nb.ravel()],
                 x=[int(v) for v in G["extras"].ravel()],  # 3 extra 'plasticity' links per word
                 e=[int(x) for x in pool],  # well-known endpoint words: the pool endless mode draws from
                 eg=[theme_names.index(t) for t in themes], gn=theme_names,
                 ea=[int(x) for x in approach],  # each endpoint's theme, for variety
                 ov=overrides)  # per-target near-miss splices: {target_id: [[word_id, extra_link_id], ...]}
with open(os.path.join(WEB, "graph.json"), "w") as f:
    json.dump(out_graph, f, separators=(",", ":"))
out_p = dict(epoch=EPOCH_OUT.isoformat(),
             puzzles=[[p["start"], p["target"], p["min"], p["sl"], p["tl"]] for p in puzzles])
with open(os.path.join(WEB, "puzzles.json"), "w") as f:
    json.dump(out_p, f, separators=(",", ":"))
print("wrote", os.path.getsize(os.path.join(WEB, "graph.json")) // 1024, "KB graph;",
      os.path.getsize(os.path.join(WEB, "puzzles.json")) // 1024, "KB puzzles")
