#!/usr/bin/env bash

if [ "$#" -ne 2 ]; then
    echo "usage: $0 <tree_version> <game_version>"
    echo ""
    echo "example: $0 3.21.0 3.21"
    exit 1
fi

set -ex

# Game data is fetched straight into the frontend's static dir, where the
# TypeScript data loader (frontend/src/lib/calculator/data.ts) reads it at
# runtime. No Go codegen step is needed — the TS types are maintained by hand.
DEST=./frontend/static/data

curl -L "https://raw.githubusercontent.com/grindinggear/skilltree-export/$1/data.json" | gzip > "$DEST/SkillTree.json.gz"

curl -L "https://go-pob-data.pages.dev/data/$2/raw/AlternatePassiveAdditions.json.gz" > "$DEST/alternate_passive_additions.json.gz"
curl -L "https://go-pob-data.pages.dev/data/$2/raw/AlternatePassiveSkills.json.gz" > "$DEST/alternate_passive_skills.json.gz"
curl -L "https://go-pob-data.pages.dev/data/$2/raw/AlternateTreeVersions.json.gz" > "$DEST/alternate_tree_versions.json.gz"
curl -L "https://go-pob-data.pages.dev/data/$2/raw/PassiveSkills.json.gz" > "$DEST/passive_skills.json.gz"
curl -L "https://go-pob-data.pages.dev/data/$2/raw/Stats.json.gz" > "$DEST/stats.json.gz"

curl -L "https://go-pob-data.pages.dev/data/$2/stat_translations/en/stat_descriptions.json.gz" > "$DEST/stat_descriptions.json.gz"
curl -L "https://go-pob-data.pages.dev/data/$2/stat_translations/en/passive_skill_stat_descriptions.json.gz" > "$DEST/passive_skill_stat_descriptions.json.gz"
curl -L "https://go-pob-data.pages.dev/data/$2/stat_translations/en/passive_skill_aura_stat_descriptions.json.gz" > "$DEST/passive_skill_aura_stat_descriptions.json.gz"
