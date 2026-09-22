"""Stream GloVe 840B (Common Crawl, cased, ~2.2M words; Stanford, Public Domain PDDL) and keep, for every word we might use,
its lowercase vector and its Capitalised / UPPER vector. Trained on ~140x more text than the 6B set, so rare words
(samosa, pangolin, Jenga) get far more reliable vectors, and proper nouns are no longer blended with their lowercase twins.

Writes raw/vectors840.npz aligned with the token list in raw/vectors.npz.
"""
import os, re, subprocess
import numpy as np
from common import RAW

base = np.load(os.path.join(RAW, "vectors.npz"))
tokens = [str(t) for t in base["words"]]
idx = {t: i for i, t in enumerate(tokens)}
n = len(tokens)
low = np.zeros((n, 300), np.float32); has_low = np.zeros(n, bool); low_rank = np.full(n, 10**9)
cap = np.zeros((n, 300), np.float32); has_cap = np.zeros(n, bool); cap_rank = np.full(n, 10**9)

proc = subprocess.Popen(["unzip", "-p", os.path.join(RAW, "glove.840B.zip"), "glove.840B.300d.txt"], stdout=subprocess.PIPE, text=True, bufsize=1 << 20)
for line_no, line in enumerate(proc.stdout):
    sp = line.find(" ")
    tok = line[:sp]
    k = tok.lower()
    i = idx.get(k)
    if i is None or not tok.isalpha():
        continue
    if tok == k:
        if not has_low[i]:
            low[i] = np.array(line[sp + 1:].split(), dtype=np.float32); has_low[i] = True; low_rank[i] = line_no
    elif tok == k.capitalize() or tok == k.upper():
        # first occurrence wins: the file is sorted by frequency, so this is the most common cased form
        if not has_cap[i]:
            cap[i] = np.array(line[sp + 1:].split(), dtype=np.float32); has_cap[i] = True; cap_rank[i] = line_no
    if line_no % 300000 == 0:
        print(line_no, int(has_low.sum()), int(has_cap.sum()), flush=True)
np.savez(os.path.join(RAW, "vectors840.npz"), words=np.array(tokens), low=low, has_low=has_low, low_rank=low_rank,
         cap=cap, has_cap=has_cap, cap_rank=cap_rank)
print("saved; lowercase found:", int(has_low.sum()), "/", n, "| capitalised found:", int(has_cap.sum()))
