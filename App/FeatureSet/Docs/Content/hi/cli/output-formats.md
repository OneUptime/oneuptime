# Output Formats

OneUptime CLI तीन output formats का समर्थन करती है: **table**, **JSON** और **wide**। आप किसी भी command पर `-o` या `--output` flag के साथ format सेट कर सकते हैं।

## Table (Default)

एक interactive terminal में चलाते समय डिफ़ॉल्ट format। results को intelligently चयनित columns के साथ ASCII table के रूप में प्रदर्शित करता है।

```bash
oneuptime incident list
```

```
┌──────────────────┬───────────────────────┬─────────────────────┬─────────────────────┐
│ _id              │ title                 │ createdAt           │ updatedAt           │
├──────────────────┼───────────────────────┼─────────────────────┼─────────────────────┤
│ abc-123          │ API Outage            │ 2025-01-15T10:30:00 │ 2025-01-15T12:00:00 │
│ def-456          │ Database Slowdown     │ 2025-01-14T08:15:00 │ 2025-01-14T09:30:00 │
└──────────────────┴───────────────────────┴─────────────────────┴─────────────────────┘
```

Table format का व्यवहार:
- 6 columns तक चुनता है, प्राथमिकता देता है: `_id`, `name`, `title`, `createdAt`, `updatedAt`
- 60 characters से अधिक लंबे values को `...` से truncate करता है
- Color-coded headers उपयोग करता है (`--no-color` से अक्षम करें)

## JSON

Raw JSON output, 2-space indentation के साथ pretty-printed। यह scripting और अन्य tools में piping के लिए सबसे अच्छा format है।

```bash
oneuptime incident list -o json
```

```json
[
  {
    "_id": "abc-123",
    "title": "API Outage",
    "currentIncidentStateId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-01-15T10:30:00Z"
  }
]
```

JSON format स्वचालित रूप से तब उपयोग किया जाता है जब output को किसी अन्य command में pipe किया जाता है (non-TTY mode):

```bash
# piping करते समय JSON स्वचालित रूप से उपयोग होता है
oneuptime incident list | jq '.[].title'
```

## Wide

बिना truncation के सभी columns प्रदर्शित करता है। विस्तृत निरीक्षण के लिए उपयोगी लेकिन बहुत चौड़ा output उत्पन्न कर सकता है।

```bash
oneuptime incident list -o wide
```

## Color अक्षम करना

Color output को कई तरीकों से अक्षम किया जा सकता है:

```bash
# --no-color flag का उपयोग करके
oneuptime --no-color incident list

# NO_COLOR environment variable का उपयोग करके
NO_COLOR=1 oneuptime incident list
```

## विशेष Output Cases

| परिदृश्य | Output |
|---------|--------|
| खाली result set | `"No results found."` |
| कोई डेटा returned नहीं | `"No data returned."` |
| Single object (जैसे `get`) | Key-value table format |
| `count` command | Plain numeric value |
