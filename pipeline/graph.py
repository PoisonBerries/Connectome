"""Vocabulary selection + top-5 neighbour graph construction."""
import re
import numpy as np
from nltk.corpus import wordnet as wn
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components

from common import load_glove, load_cased_forms, display_form, normalize
from lexicon import *

KEEP_FAMOUS = set("washington kennedy jordan hamilton ford king rose white black hunter freeman holmes ross".split())
FIRST_NAMES = {l.strip().lower() for l in open("/usr/share/dict/propernames")}
FIRST_NAMES -= {"paris", "victoria", "china", "florence", "sydney", "jordan", "austin", "chelsea", "madison",
                "orlando", "phoenix", "savannah", "dallas", "houston", "denver", "lincoln", "eden", "hope", "faith",
                "joy", "grace", "amber", "rose", "ruby", "pearl", "jasmine", "olive", "holly", "daisy", "iris", "lily",
                "violet", "ivy", "april", "may", "june", "summer", "autumn", "sandy", "will", "bill", "mark", "jack",
                "rich", "art", "pat", "bob", "ray", "rob", "sue", "tom", "don", "dean", "earl", "duke", "chase",
                "cliff", "dawn", "glen", "gene", "grant", "guy", "jim", "jay", "jean", "joe", "lance", "mike", "nick",
                "pete", "randy", "rick", "roy", "sam", "stan", "ted", "tim", "tony", "van", "wade", "wayne"}


def lemma_of(w):
    for pos in ("n", "v", "a"):
        m = wn.morphy(w, pos)
        if m and m != w:
            return m
    return w


def is_wn_common(w):
    return bool(wn.synsets(w))


def similar_form(a, b):
    """True when two tokens are obvious morphological relatives (photo/photograph, child/children)."""
    if a == b:
        return True
    s, l = (a, b) if len(a) <= len(b) else (b, a)
    if len(s) >= 4 and l.startswith(s):
        return True
    p = 0
    while p < min(len(a), len(b)) and a[p] == b[p]:
        p += 1
    return p >= 6 or (p >= 5 and min(len(a), len(b)) <= 6)


def build_candidates(n_glove=40000):
    words, vecs = load_glove(n_glove)
    forms = load_cased_forms()
    raw = []
    for rank, w in enumerate(words):
        if not re.fullmatch(r"[a-z]{3,13}", w):
            continue
        if w in STOPWORDS or w in BLOCKLIST or w in JUNK or w in DEMONYMS:
            continue
        surf, crank = display_form(w, forms)
        proper = surf != w
        known = is_wn_common(w)
        if proper:
            if w in FIRST_NAMES and surf == surf.capitalize():
                continue
            if w in GENERIC_NAMES and w not in KEEP_FAMOUS:
                continue
            if not known and crank > 30000:
                continue
        elif not known:
            continue
        raw.append(dict(rank=rank, w=w, surf=surf, proper=proper, idx=rank))
    # collapse inflections (dogs -> dog) when the lemma is also present
    wset = {r["w"] for r in raw}
    kept = []
    for r in raw:
        lem = lemma_of(r["w"])
        if lem != r["w"] and lem in wset:
            continue
        kept.append(r)
    return kept, vecs


def csls_neighbors(V, k=5, alpha=1.0, r_k=12, pool=60, forbid=None):
    """Top-k neighbour lists using hub-penalised similarity (CSLS-style).

    V: (n, d) unit vectors. Returns (n, k) int array of neighbour indices (-1 padded).
    """
    n = V.shape[0]
    sims = np.empty((n, pool), dtype=np.float32)
    idxs = np.empty((n, pool), dtype=np.int32)
    B = 1024
    for s in range(0, n, B):
        S = V[s:s + B] @ V.T
        for i in range(S.shape[0]):
            S[i, s + i] = -1
        part = np.argpartition(-S, pool, axis=1)[:, :pool]
        ps = np.take_along_axis(S, part, axis=1)
        order = np.argsort(-ps, axis=1)
        idxs[s:s + B] = np.take_along_axis(part, order, axis=1)
        sims[s:s + B] = np.take_along_axis(ps, order, axis=1)
    r = sims[:, :r_k].mean(axis=1)  # mean sim to r_k nearest neighbours = "hubness"
    return idxs, sims, r


def pick_top(words, idxs, sims, r, alpha=1.0, k=5):
    n = len(words)
    out = np.full((n, k), -1, dtype=np.int32)
    for i in range(n):
        score = sims[i] - alpha * 0.5 * r[idxs[i]]
        order = np.argsort(-score)
        chosen = []
        for j in order:
            b = int(idxs[i, j])
            if similar_form(words[i], words[b]):
                continue
            if any(similar_form(words[b], words[c]) for c in chosen):
                continue
            chosen.append(b)
            if len(chosen) == k:
                break
        out[i, :len(chosen)] = chosen
    return out


def largest_scc(nbrs):
    n = nbrs.shape[0]
    rows = np.repeat(np.arange(n), nbrs.shape[1])
    cols = nbrs.ravel()
    m = cols >= 0
    g = csr_matrix((np.ones(m.sum()), (rows[m], cols[m])), shape=(n, n))
    ncomp, labels = connected_components(g, directed=True, connection="strong")
    counts = np.bincount(labels)
    return labels == counts.argmax(), g
