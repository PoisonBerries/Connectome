"""Shared helpers for the Connectome data pipeline."""
import os
import re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")


def load_glove(limit=60000):
    words, vecs = [], []
    with open(os.path.join(RAW, "glove300_top60k.txt"), encoding="utf8") as f:
        for i, line in enumerate(f):
            if i >= limit:
                break
            parts = line.rstrip().split(" ")
            words.append(parts[0])
            vecs.append(np.asarray(parts[1:], dtype=np.float32))
    return words, np.vstack(vecs)


def load_cased_forms():
    """Map lowercase token -> {surface form: frequency rank} (fastText, ordered by frequency)."""
    forms = {}
    with open(os.path.join(RAW, "fasttext_cased_words.txt"), encoding="utf8") as f:
        for rank, tok in enumerate(f):
            tok = tok.rstrip("\n")
            if not re.fullmatch(r"[A-Za-z]+", tok):
                continue
            forms.setdefault(tok.lower(), {}).setdefault(tok, rank)
    return forms


def display_form(w, forms):
    """Pick how to show a lowercase GloVe token: 'paris' -> 'Paris', 'nasa' -> 'NASA', 'iphone' -> 'iPhone'."""
    f = forms.get(w)
    if not f:
        return w, 10**9
    low = f.get(w)
    best_s, best_r = min(f.items(), key=lambda kv: kv[1])
    if best_s == w:
        return w, best_r
    if low is None or best_r < 0.35 * low:
        return best_s, best_r
    return w, low


def normalize(m):
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1
    return m / n
