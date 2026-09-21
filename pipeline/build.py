"""Build the Connectome word graph.

  python3 build.py [N_COMMON] [ALPHA]

Writes out/graph.npz: display names, node kinds, top-5 neighbour ids and unit vectors.
"""
import os
import re
import sys
import json
import numpy as np
from nltk.corpus import wordnet as wn
from wordfreq import zipf_frequency

from common import RAW, HERE, load_cased_forms, display_form, normalize
from lexicon import *
from graph import lemma_of, csls_neighbors, largest_scc

N_COMMON = int(sys.argv[1]) if len(sys.argv) > 1 else 7000
ALPHA = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)


# curated entries whose averaged multi-word vectors landed in the wrong neighbourhood (reviewed by hand)
DROP = set("""
black hole|french fries|time machine|golden retriever|jelly bean|social media|virtual reality|traffic light|post office|flying saucer
world record|home run|slam dunk|hat trick|heat wave|tennis court|first aid|ferris wheel|pot luck|dark matter|video game
south africa|united states|united kingdom|marco polo|amelia earhart|wright brothers|king arthur|ada lovelace|muhammad ali
peter pan|james bond|wonder woman|captain america|robinson crusoe|moby dick|times square|central park|silicon valley
tiger woods|wizard of oz|star wars|white house|iron man|toy story|sesame street|indiana jones|game of thrones|pac-man
alice in wonderland|snow white|sleeping beauty|middle east|north pole|south pole|cape town|joan of arc|robin hood
""".replace("\n", "|").split("|"))
DROP = {x.strip() for x in DROP if x.strip()}

FILLER = {"the", "of", "de", "la", "le", "del", "and", "new", "in", "a", "an"}
# common words that would otherwise be dropped by the "looks like a proper noun" rule but should stay lowercase
FORCE_COMMON = set("apple orange sun moon".split())

d = np.load(os.path.join(RAW, "vectors.npz"))
tokens = list(d["words"])
def all_but_the_top(X, n_pc=3):
    """Mu & Viswanath 2018: centre, then remove the top principal components (frequency / hubness artefacts)."""
    X = X - X.mean(axis=0, keepdims=True)
    _, _, vt = np.linalg.svd(X[:30000], full_matrices=False)
    for pc in vt[:n_pc]:
        X = X - np.outer(X @ pc, pc)
    return X


V_all = normalize(all_but_the_top(normalize(d["vecs"])))
rank_of = {t: int(r) for t, r in zip(tokens, d["ranks"])}
idx_of = {t: i for i, t in enumerate(tokens)}
forms = load_cased_forms()


# ---------------------------------------------------------------- curated entries
curated = []
section = None
for line in open(os.path.join(HERE, "proper_nouns.txt"), encoding="utf8"):
    if line.startswith("## "):
        section = line[3:].strip()
        continue
    if line.startswith("#") or not line.strip():
        continue
    for ent in [e.strip() for e in line.split(",") if e.strip()]:
        if "=" in ent:
            disp, comps = ent.split("=", 1)
            toks = comps.lower().split("+")
        else:
            disp = ent
            toks = [t for t in re.findall(r"[a-z]+", disp.lower().replace("'", "")) if t not in FILLER] or \
                   re.findall(r"[a-z]+", disp.lower())
        curated.append((disp.strip(), toks, section))

nodes = {}  # key(lower display) -> dict
missing = []
for disp, toks, section in curated:
    if any(t not in idx_of for t in toks):
        missing.append(disp)
        continue
    v = normalize(np.mean([V_all[idx_of[t]] for t in toks], axis=0, keepdims=True))[0]
    kind = 2 if section == "common_phrases" else 1
    key = disp.lower()
    if key in DROP or (len(toks) == 1 and (toks[0] in BLOCKLIST or flagged(toks[0]))):
        continue
    nodes.setdefault(key, dict(disp=disp, vec=v, kind=kind, rank=min(rank_of.get(t, 10**6) for t in toks), toks=toks,
                               section=section))
print(f"curated: {len(nodes)} usable, {len(missing)} missing tokens -> {missing[:60]}")

# ---------------------------------------------------------------- common words
CONCRETE = {"noun.animal", "noun.food", "noun.artifact", "noun.body", "noun.plant", "noun.object", "noun.substance",
            "noun.location", "noun.person", "noun.natural_object", "noun.shape"}


def familiarity(w):
    """Higher = more everyday and more picturable. None = reject."""
    syn = wn.synsets(w)
    if not syn:
        return None
    pos = {s.pos() for s in syn}
    z = zipf_frequency(w, "en")
    first = syn[0]
    if len(w) <= 3 and not (first.pos() == "n" and first.lexname() in CONCRETE and z >= 3.5) and z < 4.5:
        return None
    if first.pos() == "n":
        bonus = 0.7 if first.lexname() in CONCRETE else 0.0
        return z + bonus
    if pos & {"a", "s"} and z >= 4.2:
        return z - 0.7
    if "n" in pos:
        return z - 0.2
    if "v" in pos and z >= 4.6:
        return z - 0.8
    return None


def category(w):
    syn = wn.synsets(w)
    return syn[0].lexname() if syn else "unknown"


common = []
for t in tokens:
    r = rank_of[t]
    if r >= 45000:
        continue
    if not re.fullmatch(r"[a-z]{3,13}", t):
        continue
    if t in STOPWORDS or t in BLOCKLIST or t in JUNK or t in DEMONYMS or flagged(t) or lemma_of(t) in BLOCKLIST:
        continue
    if t in nodes:
        continue
    surf, _ = display_form(t, forms)
    if surf != t and t not in FORCE_COMMON:
        continue  # reads as a proper noun / acronym we didn't curate
    f = familiarity(t)
    if f is None:
        continue
    common.append((f, t))
wset = {t for _, t in common} | set(nodes)  # curated words count too, so 'sandwiches' collapses into 'sandwich'
common = [(f, t) for f, t in common if not (lemma_of(t) != t and lemma_of(t) in wset)]
common.sort(key=lambda ft: -ft[0])
common = [t for _, t in common[:N_COMMON]]
print("common words:", len(common))
for t in common:
    nodes[t] = dict(disp=t, vec=V_all[idx_of[t]], kind=0, rank=rank_of[t], toks=[t], section=category(t))

keys = list(nodes.keys())
words = [nodes[k]["disp"] for k in keys]
kinds = np.array([nodes[k]["kind"] for k in keys])
vecs = np.vstack([nodes[k]["vec"] for k in keys])
toksets = [set(nodes[k]["toks"]) | {k} for k in keys]
lows = [k for k in keys]


# ---------------------------------------------------------------- neighbours
def related_forms(i, j):
    a, b = lows[i], lows[j]
    if a == b:
        return True
    if toksets[i] & toksets[j] and (kinds[i] != 0 or kinds[j] != 0):
        return True  # "ice cream" vs "ice"
    if " " in a or " " in b:
        # phrase vs another single word: block token containment
        return False
    s, l = (a, b) if len(a) <= len(b) else (b, a)
    if len(s) >= 4 and l.startswith(s):
        return True
    if len(s) >= 3 and l.endswith(s) and len(l) - len(s) <= 4 and len(s) >= 4:
        return True
    p = 0
    while p < min(len(a), len(b)) and a[p] == b[p]:
        p += 1
    return p >= 6 or (p >= 5 and min(len(a), len(b)) <= 6)


def build_graph(active):
    """active: array of node ids. Returns neighbour matrix in *local* ids."""
    V = vecs[active]
    idxs, sims, r = csls_neighbors(V, pool=70)
    n = len(active)
    out = np.full((n, 5), -1, dtype=np.int32)
    for i in range(n):
        score = sims[i] - ALPHA * 0.5 * r[idxs[i]]
        order = np.argsort(-score)
        chosen = []
        for j in order:
            b = int(idxs[i, j])
            if related_forms(active[i], active[b]):
                continue
            if any(related_forms(active[b], active[c]) for c in chosen):
                continue
            chosen.append(b)
            if len(chosen) == 5:
                break
        out[i, :len(chosen)] = chosen
    return out


active = np.arange(len(words))
for it in range(6):
    nb = build_graph(active)
    mask, _ = largest_scc(nb)
    short = (nb < 0).any(axis=1)
    print(f"iter {it}: n={len(active)} scc={mask.sum()} short={short.sum()}")
    keep = mask & ~short
    if keep.all():
        break
    active = active[keep]

nb = build_graph(active)
n = len(active)
final_words = [words[i] for i in active]
final_kinds = kinds[active]
np.savez(os.path.join(OUT, "graph.npz"), words=np.array(final_words), kinds=final_kinds, nbrs=nb,
         vecs=vecs[active], ranks=np.array([nodes[keys[i]]["rank"] for i in active]),
         sections=np.array([nodes[keys[i]]["section"] for i in active]),
         zipf=np.array([zipf_frequency(nodes[keys[i]]["disp"].lower(), "en") for i in active], dtype=np.float32))
print("final nodes:", n, "kinds:", np.bincount(final_kinds))
indeg = np.bincount(nb.ravel(), minlength=n)
print("indeg min/median/max:", indeg.min(), np.median(indeg), indeg.max())
