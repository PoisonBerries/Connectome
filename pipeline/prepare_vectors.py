"""Stream the full GloVe 6B/300d file, keep the top-N tokens plus every token our curated list needs."""
import re, subprocess, numpy as np
from common import RAW
import os

TOP_N = 50000
want = set()
for line in open("proper_nouns.txt", encoding="utf8"):
    if line.startswith("#") or not line.strip():
        continue
    for ent in line.split(","):
        ent = ent.strip()
        if not ent:
            continue
        if "=" in ent:
            _, comps = ent.split("=", 1)
            want.update(comps.lower().split("+"))
        else:
            want.update(re.findall(r"[a-z0-9\-']+", ent.lower()))
print("wanted extra tokens:", len(want))

proc = subprocess.Popen(["unzip", "-p", os.path.join(RAW, "glove.6B.zip"), "glove.6B.300d.txt"], stdout=subprocess.PIPE, text=True)
words, vecs, ranks = [], [], []
for i, line in enumerate(proc.stdout):
    tok, rest = line.split(" ", 1)
    if i < TOP_N or tok in want:
        words.append(tok); ranks.append(i)
        vecs.append(np.fromstring(rest, dtype=np.float32, sep=" "))
    if i % 100000 == 0:
        print(i, flush=True)
np.savez(os.path.join(RAW, "vectors.npz"), words=np.array(words), vecs=np.vstack(vecs).astype(np.float32),
         ranks=np.array(ranks))
print("saved", len(words))
