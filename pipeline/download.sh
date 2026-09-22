#!/usr/bin/env bash
# Fetches the open datasets the pipeline needs into pipeline/raw/ (about 3 GB; git-ignored).
#   GloVe 6B   Stanford NLP, Public Domain (PDDL): word vectors that define "related"
#   GloVe 840B Stanford NLP, Public Domain (PDDL): cased, trained on 140x more text; far better for rare words
#   fastText   Facebook, CC BY-SA: only its cased word list, used to capitalise proper nouns
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p raw && cd raw

[ -f glove.6B.zip ] || curl -L -o glove.6B.zip https://huggingface.co/stanfordnlp/glove/resolve/main/glove.6B.zip
[ -f glove300_top60k.txt ] || unzip -p glove.6B.zip glove.6B.300d.txt | head -n 60000 > glove300_top60k.txt
[ -f glove.840B.zip ] || curl -L -o glove.840B.zip https://huggingface.co/stanfordnlp/glove/resolve/main/glove.840B.300d.zip
[ -f fasttext_cased_words.txt ] || \
  curl -sL https://dl.fbaipublicfiles.com/fasttext/vectors-english/wiki-news-300d-1M.vec.zip \
  | funzip 2>/dev/null | head -n 250001 | cut -d' ' -f1 > fasttext_cased_words.txt
echo "raw data ready"
