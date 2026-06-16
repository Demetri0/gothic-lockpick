#!/usr/bin/env bash
# Translate chest names between languages using claude CLI
# Usage: ./tools/translate.sh <src_lang> <tgt_lang> [chests.json] [out.json]
# Example: ./tools/translate.sh ru en
#          ./tools/translate.sh ru de
#          ./tools/translate.sh ru uk
#          ./tools/translate.sh en ru
set -euo pipefail

SRC="${1:?Usage: translate.sh <src> <tgt> [in.json] [out.json]}"
TGT="${2:?}"
IN="${3:-chests.json}"
OUT="${4:-chests.json}"
GLOSSARY="tools/gothic-glossary.json"
BATCH=40

declare -A LANG_NAME=(
  [ru]="Russian" [en]="English" [de]="German" [uk]="Ukrainian" [pl]="Polish"
)

GLOSSARY_TEXT=$(jq -r '
  "Characters: " + ([.characters | to_entries[] | .key + " → " + .value] | join(", ")) + "\n" +
  "Locations: " + ([.locations | to_entries[] | .key + " → " + .value] | join(", "))
' "$GLOSSARY")

SRC_NAME="${LANG_NAME[$SRC]}"
TGT_NAME="${LANG_NAME[$TGT]}"

SYSTEM_PROMPT="You are a Gothic 1 RPG localization expert. Translate lock/chest location names from ${SRC_NAME} to ${TGT_NAME}.
Rules:
- Keep Gothic character names consistent with the glossary
- Translate descriptive parts naturally (floor, door, chest, hut, room, left, right, second, first, upper, lower, underwater, nearby, behind, inside, near the, in front of)
- For Ukrainian: use Ukrainian equivalents of Russian words (замок=замок, поверх=поверх, кімната=кімната, старий=старий, новий=новий, болотний=болотний, стара=стара, вільна=вільна, скарбниця=скарбниця)
- For German: use Gothic 1's original German location names from the glossary where applicable (Старый лагерь=Altes Lager, Новый лагерь=Neues Lager, Болотный лагерь=Sumpflager, Свободная шахта=Freie Mine, Старая шахта=Alte Mine, Монастырь=Kloster, Замок=Burg)
- Return ONLY a JSON object: {\"id\": \"translation\", ...}
- No extra text, no markdown fences, just the raw JSON object

Gothic 1 glossary:
${GLOSSARY_TEXT}"

# Find entries that have SRC but not TGT
ENTRIES=$(jq -c --arg src "$SRC" --arg tgt "$TGT" '
  [.entries[] | select(.name[$src] != null and .name[$tgt] == null) | {id, src: .name[$src]}]
' "$IN")
TOTAL=$(echo "$ENTRIES" | jq 'length')

if [ "$TOTAL" -eq 0 ]; then
  echo "Nothing to translate (all entries already have ${TGT_NAME})." >&2
  exit 0
fi

echo "Translating ${SRC_NAME}→${TGT_NAME}: $TOTAL entries in batches of $BATCH..." >&2

cp "$IN" /tmp/translate-work.json

DONE=0
while [ "$DONE" -lt "$TOTAL" ]; do
  BATCH_DATA=$(echo "$ENTRIES" | jq -c ".[$DONE:$((DONE + BATCH))]")
  BATCH_COUNT=$(echo "$BATCH_DATA" | jq 'length')

  PROMPT="Translate these $BATCH_COUNT lock/chest location names from ${SRC_NAME} to ${TGT_NAME}.
Input JSON array (id + source text): $BATCH_DATA
Return a JSON object mapping each id to its ${TGT_NAME} translation."

  echo "  Batch $((DONE/BATCH + 1)): entries $((DONE+1))–$((DONE+BATCH_COUNT))..." >&2

  RESULT=$(echo "$PROMPT" | claude --print -p "$SYSTEM_PROMPT" 2>/dev/null | tr -d '\n' | grep -o '{.*}' | head -1)

  if [ -z "$RESULT" ]; then
    echo "  WARNING: empty result for batch $((DONE/BATCH + 1)), skipping" >&2
    DONE=$((DONE + BATCH_COUNT))
    continue
  fi

  PATCHED=$(jq --argjson t "$RESULT" --arg tgt "$TGT" '
    .entries |= map(
      if ($t[.id] // "" | length) > 0
      then .name[$tgt] = $t[.id]
      else .
      end
    )
  ' /tmp/translate-work.json)

  echo "$PATCHED" > /tmp/translate-work.json
  DONE=$((DONE + BATCH_COUNT))
done

cp /tmp/translate-work.json "$OUT"

COUNT=$(jq --arg tgt "$TGT" '[.entries[] | select(.name[$tgt])] | length' "$OUT")
echo "Done. $COUNT / $(jq '.entries | length' "$OUT") entries now have ${TGT_NAME}." >&2
