"""Compare word-graph variants.   python3 evaluate.py base div bridge ...   (reads out/graph_<tag>.npz)

Structure:  reciprocity, tight cliques, lexical-overlap links, cross-topic links, in-degree extremes
Distances:  mean / p95 shortest path
Play:       a simulated semantic-hill-climbing player on a FIXED set of start/target pairs (the pairs both graphs share),
            reporting solve rate and median clicks within the endless budget (5 x par).
Caveat: the simulated player steers by the same embedding the graph came from, so it under-rates links that are good for
humans but far in vector space (bridges). Read its numbers as a floor on navigability, not the whole story.
"""
import sys
import numpy as np
from scipy.cluster.vq import kmeans2
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import shortest_path

from puzzle_lib import load, endpoint_pool, agent_moves, theme_of

tags = sys.argv[1:] or ["base"]
graphs = {}
for t in tags:
    G = load(f"out/graph_{t}.npz")
    G["A"] = csr_matrix((np.ones(G["nbrs"].size), (np.repeat(np.arange(G["n"]), 5), G["nbrs"].ravel())), shape=(G["n"], G["n"]))
    G["ix"] = {w: i for i, w in enumerate(G["words"])}
    G["pool"] = endpoint_pool(G)
    graphs[t] = G

# a fixed pair set drawn from the words every variant shares
shared = set.intersection(*[{G["words"][i] for i in G["pool"]} for G in graphs.values()])
first = graphs[tags[0]]
rng = np.random.default_rng(11)
shared = sorted(shared)
theme = {w: theme_of(first, first["ix"][w]) for w in shared}
pairs = []
while len(pairs) < 700:
    a, b = rng.choice(len(shared), 2, replace=False)
    a, b = shared[a], shared[b]
    if theme[a] != theme[b]:
        pairs.append((a, b))


def metrics(G):
    nb, n, V, words = G["nbrs"], G["n"], G["vecs"], G["words"]
    S = [set(map(int, r)) for r in nb]
    m = {}
    m["words"] = n
    m["mean link cos"] = float(np.mean([V[i] @ V[int(j)] for i in range(n) for j in nb[i]]))
    m["reciprocal %"] = 100 * sum(1 for i in range(n) for j in nb[i] if i in S[int(j)]) / (5 * n)
    tight = 0
    for i in range(n):
        two = set()
        for j in nb[i]:
            two |= S[int(j)]
        two -= {i} | S[i]
        tight += len(two) < 12
    m["tight cliques %"] = 100 * tight / n
    m["lexical-overlap links"] = sum(1 for i in range(n) for j in nb[i] if words[i].lower() in words[int(j)].lower() or words[int(j)].lower() in words[i].lower())
    lab = kmeans2(V, 40, minit="++", seed=1)[1]  # coarse "topics", deliberately different from the build's own clustering
    out = np.array([sum(lab[int(j)] != lab[i] for j in nb[i]) for i in range(n)])
    m["cross-topic links/word"] = float(out.mean())
    m["words with 0 cross-topic links %"] = 100 * float((out == 0).mean())
    indeg = np.bincount(nb.ravel(), minlength=n)
    m["in-degree<=1 %"] = 100 * float((indeg <= 1).mean())
    m["max in-degree"] = int(indeg.max())
    src = np.random.default_rng(0).choice(n, 250, replace=False)
    D = shortest_path(G["A"], method="D", unweighted=True, indices=src)
    D = D[np.isfinite(D)]
    m["mean path"] = float(D.mean())
    m["p95 path"] = float(np.percentile(D, 95))
    m["max path"] = int(D.max())
    return m


def play(G):
    ix, nb, V = G["ix"], G["nbrs"], G["vecs"]
    pr = [(ix[a], ix[b]) for a, b in pairs]
    srcs = sorted({a for a, _ in pr})
    Dm = dict(zip(srcs, shortest_path(G["A"], method="D", unweighted=True, indices=srcs)))
    res = {"all": [], 5: [], 6: [], 7: [], 8: []}
    dists = []
    for a, b in pr:
        d = Dm[a][b]
        if not np.isfinite(d) or d < 3:
            continue
        dists.append(d)
        mv = agent_moves(nb, V @ V[b], a, b, max_moves=int(5 * d))
        res["all"].append(mv)
        if int(d) in res:
            res[int(d)].append(mv)
    def summ(v):
        ok = [x for x in v if x is not None]
        return (100 * len(ok) / max(1, len(v)), float(np.median(ok)) if ok else float("nan"), len(v))
    return float(np.mean(dists)), {k: summ(v) for k, v in res.items()}


rows = {t: metrics(G) for t, G in graphs.items()}
names = list(rows[tags[0]])
w = max(len(n) for n in names) + 2
print("".ljust(w) + "".join(t.rjust(12) for t in tags))
for n in names:
    print(n.ljust(w) + "".join((f"{rows[t][n]:.2f}" if isinstance(rows[t][n], float) else str(rows[t][n])).rjust(12) for t in tags))
print("\nsimulated player on the same %d start/target pairs (budget = 5 x shortest route)" % len(pairs))
pl = {t: play(G) for t, G in graphs.items()}
print("mean shortest route".ljust(w) + "".join(f"{pl[t][0]:.2f}".rjust(12) for t in tags))
for k in ("all", 5, 6, 7, 8):
    lab = f"solve pct (par {k})" if k != "all" else "solve pct (all)"
    print(lab.ljust(w) + "".join(f"{pl[t][1][k][0]:.0f}".rjust(12) for t in tags))
    lab = "median clicks (par %s)" % k if k != "all" else "median clicks (all)"
    print(lab.ljust(w) + "".join(f"{pl[t][1][k][1]:.0f}".rjust(12) for t in tags))
