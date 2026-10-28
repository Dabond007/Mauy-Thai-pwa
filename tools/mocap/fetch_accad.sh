#!/bin/sh
# Download the ACCAD Male2 martial arts motion capture (CC BY 3.0, Ohio State
# ACCAD Open Motion Project) into tools/mocap/data/ (git-ignored).
set -e
cd "$(dirname "$0")"
mkdir -p data && cd data
for f in Male2MartialArtsPunches_c3d.zip Male2MartialArtsKicks_c3d.zip Male2MartialArtsStances_c3d.zip; do
  curl -sSfL -O "https://accad.osu.edu/sites/accad.osu.edu/files/$f"
  unzip -oq "$f"
done
echo "OK: $(ls *.c3d | wc -l) C3D files"
