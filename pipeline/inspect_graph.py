import sys, numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import shortest_path
g = np.load("out/graph.npz")
words = list(g["words"]); nb = g["nbrs"]; n = len(words)
ix = {w.lower(): i for i, w in enumerate(words)}
rows = np.repeat(np.arange(n), 5)
G = csr_matrix((np.ones(n*5), (rows, nb.ravel())), shape=(n, n))
qs = sys.argv[1:]
if qs and qs[0] == "random":
    rng = np.random.default_rng(int(qs[1]) if len(qs) > 1 else 1)
    qs = [words[i] for i in rng.choice(n, 40, replace=False)]
for q in qs:
    i = ix.get(q.lower())
    if i is None: print(q, "-> (not in graph)"); continue
    print(f"{words[i]:>14} -> " + ", ".join(words[j] for j in nb[i]))
if not qs:
    rng = np.random.default_rng(0); src = rng.choice(n, 400, replace=False)
    D = shortest_path(G, method='D', unweighted=True, indices=src)
    print("dist hist", np.bincount(D[np.isfinite(D)].astype(int)))
    print("mean", D[np.isfinite(D)].mean())
