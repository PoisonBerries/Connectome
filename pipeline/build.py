"""Build the Connectome word graph.

  python3 build.py [N_COMMON] [ALPHA] [--diversity L=0.30] [--bridge K=0] [--mutual B=0.08] [--clusters C] [--tag NAME]

Writes out/graph.npz (or out/graph_NAME.npz with --tag): display names, node kinds, top-5 neighbour ids, unit vectors.
The optional switches are experiments in how the five links are chosen; see evaluate.py for how they are compared.
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

import argparse

ap = argparse.ArgumentParser()
ap.add_argument("n_common", nargs="?", type=int, default=6000)
ap.add_argument("alpha", nargs="?", type=float, default=1.0)  # CSLS hub penalty
ap.add_argument("--diversity", type=float, default=0.30)  # MMR: penalise a link for resembling links already chosen
ap.add_argument("--bridge", type=int, default=0)  # minimum links that must leave the word's own cluster
ap.add_argument("--mutual", type=float, default=0.08)  # bonus for links the other word would also make
ap.add_argument("--clusters", type=int, default=90)
ap.add_argument("--vectors", choices=["6b", "840b"], default="840b")  # which GloVe release supplies the vectors
ap.add_argument("--npc", type=int, default=3)  # principal components removed from the vectors
ap.add_argument("--freqdebias", type=float, default=0.0)  # strength of removing the word-frequency direction
ap.add_argument("--anchor", type=float, default=0.0)  # pull curated proper nouns toward their section's centroid
ap.add_argument("--tag", default="")
args = ap.parse_args()
N_COMMON, ALPHA = args.n_common, args.alpha
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
def all_but_the_top(X, n_pc=3, log_rank=None, freq_strength=0.0):
    """Mu & Viswanath 2018: centre, then remove the top principal components (frequency / hubness artefacts).

    Optionally also remove the direction along which vectors vary with word frequency: rare words otherwise cluster
    together just for being rare (Oompa Loompa ~ Hobbiton ~ Cruella), which reads as nonsense to a player.
    """
    X = X - X.mean(axis=0, keepdims=True)
    _, _, vt = np.linalg.svd(X[:30000], full_matrices=False)
    for pc in vt[:n_pc]:
        X = X - np.outer(X @ pc, pc)
    if freq_strength and log_rank is not None:
        z = (log_rank - log_rank.mean()) / (log_rank.std() + 1e-9)
        w = X.T @ z
        w /= np.linalg.norm(w)
        X = X - freq_strength * np.outer(X @ w, w)
    return X


rank_of = {t: int(r) for t, r in zip(tokens, d["ranks"])}
idx_of = {t: i for i, t in enumerate(tokens)}
LOG_RANK = np.log1p(d["ranks"].astype(np.float64))

if args.vectors == "6b":
    V_low = normalize(all_but_the_top(normalize(d["vecs"]), args.npc, LOG_RANK, args.freqdebias))
    V_cap = None
    has_low = np.ones(len(tokens), bool)
    has_cap = np.zeros(len(tokens), bool)
else:
    # GloVe 840B (cased): a lowercase and a Capitalised vector per word, sharing one centring / de-noising transform
    v8 = np.load(os.path.join(RAW, "vectors840.npz"))
    assert [str(x) for x in v8["words"]] == tokens, "vectors840.npz is not aligned with vectors.npz"
    has_low, has_cap = v8["has_low"], v8["has_cap"]
    low_n = normalize(v8["low"])
    cap_n = normalize(v8["cap"])
    fit_rows = has_low & (np.arange(len(tokens)) < 30000)
    mu = low_n[has_low].mean(axis=0, keepdims=True)
    _, _, vt = np.linalg.svd((low_n[fit_rows] - mu), full_matrices=False)

    def transform(X):
        X = X - mu
        for pc in vt[: args.npc]:
            X = X - np.outer(X @ pc, pc)
        return normalize(X)

    V_low = transform(low_n)
    V_cap = transform(cap_n)

LOWER_SECTIONS = {"common_phrases", "foods", "creatures", "everyday"}  # curated words that are ordinary lowercase words


def get_vec(tok, proper):
    """Normalised vector for a token, or None. Proper nouns prefer the Capitalised vector (Paris, not paris)."""
    i = idx_of.get(tok)
    if i is None:
        return None
    if proper and has_cap[i]:
        return V_cap[i]
    if has_low[i]:
        return V_low[i]
    return V_cap[i] if has_cap[i] else None
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
    parts = [get_vec(t, section not in LOWER_SECTIONS) for t in toks]
    if any(p is None for p in parts):
        missing.append(disp)
        continue
    v = normalize(np.mean(parts, axis=0, keepdims=True))[0]
    kind = 2 if section == "common_phrases" else 1
    key = disp.lower()
    if key in DROP or (len(toks) == 1 and (toks[0] in BLOCKLIST or flagged(toks[0]))):
        continue
    nodes.setdefault(key, dict(disp=disp, vec=v, kind=kind, rank=min(rank_of.get(t, 10**6) for t in toks), toks=toks,
                               section=section))
print(f"curated: {len(nodes)} usable, {len(missing)} missing tokens -> {missing[:60]}")

# ---------------------------------------------------------------- anchor outlier curated vectors to their section
# GloVe vectors are per surface-form and blend every sense of a token by how often each occurs in raw text. A
# curated proper noun's *intended* sense (Bosch the painter, not the auto-parts/appliance brand; Slinky the toy,
# not the adjective) can be a minority use, so the vector still swims toward whatever sense dominates in Common
# Crawl, which shows up as neighbours from a totally different world (Bosch <-> Roomba, Fitbit <-> Slinky).
#
# Most curated words are *not* like this - their raw vector already sits comfortably among their own curated
# section (Kraken's vector is already core "mythical sea monster", which is exactly why it earns a genuinely
# good bridge to Blackbeard). Pulling every word toward its section centroid indiscriminately was tried first and
# measurably hurt overall navigability (evaluate.py's simulated-player solve rate dropped 10-25 points) by also
# dragging well-placed words away from the legitimate cross-topic bridges they'd already found.
#
# So only outliers get corrected: for each section, find where a word's raw cosine similarity to its own
# section centroid falls versus its section-mates (10th vs 60th percentile), and pull only the words below that
# range - the ones a reader would call mislabeled - leaving everything already well-aligned untouched.
if args.anchor:
    from collections import defaultdict
    by_section = defaultdict(list)
    for k, node in nodes.items():
        if node["kind"] != 0:
            by_section[node["section"]].append(k)
    centroid, lo_hi = {}, {}
    for sec, ks in by_section.items():
        if len(ks) < 8:
            continue
        c = normalize(np.mean([nodes[k]["vec"] for k in ks], axis=0, keepdims=True))[0]
        sims = np.array([nodes[k]["vec"] @ c for k in ks])
        centroid[sec] = c
        lo_hi[sec] = tuple(np.percentile(sims, [10, 60]))
    for k, node in nodes.items():
        sec = node["section"]
        if node["kind"] == 0 or sec not in centroid:
            continue
        v, c = node["vec"], centroid[sec]
        sim = float(v @ c)
        lo, hi = lo_hi[sec]
        if sim >= hi or hi <= lo:
            continue
        pull = args.anchor * min(1.5, (hi - sim) / (hi - lo))
        node["vec"] = normalize(((1 - pull) * v + pull * c)[None, :])[0]

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
    if r >= 45000 or not has_low[idx_of[t]]:
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
    nodes[t] = dict(disp=t, vec=V_low[idx_of[t]], kind=0, rank=rank_of[t], toks=[t], section=category(t))

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
    from scipy.cluster.vq import kmeans2

    V = vecs[active]
    idxs, sims, r = csls_neighbors(V, pool=70)
    n = len(active)
    labels = kmeans2(V, args.clusters, minit="++", seed=0)[1] if args.bridge else None
    top_sets = [set(map(int, idxs[j, :15])) for j in range(n)] if args.mutual else None
    # 5 real links, plus 3 'octopus' extras chosen by the same rules (the first five are unaffected by asking for more)
    out = np.full((n, 8), -1, dtype=np.int32)

    def ok(i, b, chosen):
        return not related_forms(active[i], active[b]) and not any(related_forms(active[b], active[c]) for c in chosen)

    for i in range(n):
        cand = idxs[i]
        score = sims[i] - ALPHA * 0.5 * r[cand]
        if args.mutual:
            score = score + args.mutual * np.array([i in top_sets[int(b)] for b in cand])
        C = (V[cand] @ V[cand].T) if args.diversity else None
        alive = np.ones(len(cand), bool)
        chosen, pos = [], []
        while len(chosen) < 8:
            adj = score.copy()
            if args.diversity and pos:
                adj -= args.diversity * C[:, pos].max(axis=1)
            adj[~alive] = -np.inf
            j = int(np.argmax(adj))
            if adj[j] == -np.inf:
                break
            alive[j] = False
            b = int(cand[j])
            if ok(i, b, chosen):
                chosen.append(b)
                pos.append(j)
        if args.bridge and chosen:
            # guarantee some links that leave this word's neighbourhood, so it isn't a dead-end clique
            outside = sum(labels[c] != labels[i] for c in chosen)
            for j in np.argsort(-score):
                if outside >= args.bridge:
                    break
                b = int(cand[j])
                if labels[b] == labels[i] or b in chosen or not ok(i, b, chosen):
                    continue
                # replace the weakest in-cluster link
                inside = [k for k, c in enumerate(chosen) if labels[c] == labels[i]]
                if not inside:
                    break
                chosen[inside[-1]] = b
                outside += 1
        out[i, :len(chosen)] = chosen
    return out


active = np.arange(len(words))
for it in range(6):
    nb = build_graph(active)
    mask, _ = largest_scc(nb[:, :5])
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
np.savez(os.path.join(OUT, f"graph_{args.tag}.npz" if args.tag else "graph.npz"), words=np.array(final_words), kinds=final_kinds, nbrs=nb[:, :5], extras=nb[:, 5:8],
         vecs=vecs[active], ranks=np.array([nodes[keys[i]]["rank"] for i in active]),
         sections=np.array([nodes[keys[i]]["section"] for i in active]),
         zipf=np.array([zipf_frequency(nodes[keys[i]]["disp"].lower(), "en") for i in active], dtype=np.float32))
print("final nodes:", n, "kinds:", np.bincount(final_kinds))
indeg = np.bincount(nb[:, :5].ravel(), minlength=n)
print("indeg min/median/max:", indeg.min(), np.median(indeg), indeg.max())
