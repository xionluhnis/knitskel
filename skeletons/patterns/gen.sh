#!/usr/bin/env bash

basedir=$(dirname "$0")
outfile="$basedir/list.json"

echo "[" > "$outfile"
sep=
for f in "$basedir"/*.pat; do
  name=$(basename "$f")
  [[ -z "$sep" ]] && sep="," || echo "$sep" >> "$outfile"
  echo -n "{ \"path\": \"$name\" }" >> "$outfile"
done
echo >> "$outfile"
echo "]" >> "$outfile"
