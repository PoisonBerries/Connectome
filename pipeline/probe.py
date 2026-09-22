import sys, numpy as np
tags=sys.argv[1].split(","); words=sys.argv[2].split(",")
gs={t:np.load(f"out/graph_{t}.npz") for t in tags}
ix={t:{str(w):i for i,w in enumerate(g["words"])} for t,g in gs.items()}
for w in words:
    print(f"\n{w}")
    for t,g in gs.items():
        if w in ix[t]:
            i=ix[t][w]; cs=[float(g['vecs'][i]@g['vecs'][j]) for j in g['nbrs'][i]]
            print(f"  {t:8} (avg cos {np.mean(cs):.2f}): "+", ".join(str(g['words'][j]) for j in g['nbrs'][i]))
        else: print(f"  {t:8}: (not in graph)")
