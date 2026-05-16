# Resource Operations

OneUptime CLI सभी समर्थित resources के लिए पूर्ण CRUD (Create, Read, Update, Delete) operations प्रदान करती है। Resources आपके OneUptime instance से auto-discover होते हैं।

## उपलब्ध Resources

सभी उपलब्ध resource types देखने के लिए निम्नलिखित command चलाएं:

```bash
oneuptime resources
```

आप type के अनुसार filter कर सकते हैं:

```bash
# केवल database resources दिखाएं
oneuptime resources --type database

# केवल analytics resources दिखाएं
oneuptime resources --type analytics
```

सामान्य resources में शामिल हैं:

| Resource | Command |
|----------|---------|
| Incident | `oneuptime incident` |
| Alert | `oneuptime alert` |
| Monitor | `oneuptime monitor` |
| Monitor Status | `oneuptime monitor-status` |
| Incident State | `oneuptime incident-state` |
| Status Page | `oneuptime status-page` |
| On-Call Policy | `oneuptime on-call-policy` |
| Team | `oneuptime team` |
| Scheduled Maintenance Event | `oneuptime scheduled-maintenance-event` |

## Resources सूचीबद्ध करें

वैकल्पिक filtering, pagination और sorting के साथ resources की सूची प्राप्त करें।

```bash
oneuptime <resource> list [options]
```

**Options:**

| Option | विवरण | Default |
|--------|-------|---------|
| `--query <json>` | JSON के रूप में filter criteria | None |
| `--limit <n>` | results की अधिकतम संख्या | `10` |
| `--skip <n>` | skip करने के लिए results की संख्या | `0` |
| `--sort <json>` | JSON के रूप में sort order | None |
| `-o, --output <format>` | Output format | `table` |

**उदाहरण:**

```bash
# 10 सबसे हाल के incidents सूचीबद्ध करें
oneuptime incident list

# state ID से incidents filter करें
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# pagination के साथ सूचीबद्ध करें
oneuptime incident list --limit 20 --skip 40

# creation date (descending) के अनुसार sort करें
oneuptime incident list --sort '{"createdAt":-1}'

# JSON के रूप में output करें
oneuptime incident list -o json
```

## एक Resource प्राप्त करें

अपनी ID से एक single resource प्राप्त करें।

```bash
oneuptime <resource> get <id>
```

**Arguments:**

| Argument | विवरण |
|----------|-------|
| `<id>` | Resource ID (UUID) |

**उदाहरण:**

```bash
# एक specific incident प्राप्त करें
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# एक monitor को JSON के रूप में प्राप्त करें
oneuptime monitor get abc-123 -o json
```

## एक Resource बनाएं

inline JSON या फ़ाइल से एक नया resource बनाएं।

```bash
oneuptime <resource> create [options]
```

**Options:**

| Option | विवरण |
|--------|-------|
| `--data <json>` | JSON object के रूप में Resource data |
| `--file <path>` | Resource data युक्त JSON फ़ाइल का path |
| `-o, --output <format>` | Output format |

आपको `--data` या `--file` में से एक प्रदान करना होगा।

**उदाहरण:**

```bash
# inline JSON के साथ incident बनाएं
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# JSON फ़ाइल से बनाएं
oneuptime incident create --file incident.json

# ID capture करने के लिए JSON के रूप में output करते हुए बनाएं
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## एक Resource अपडेट करें

ID से एक मौजूदा resource अपडेट करें।

```bash
oneuptime <resource> update <id> [options]
```

**Arguments:**

| Argument | विवरण |
|----------|-------|
| `<id>` | Resource ID |

**Options:**

| Option | विवरण |
|--------|-------|
| `--data <json>` | JSON के रूप में update करने के लिए fields (आवश्यक) |
| `-o, --output <format>` | Output format |

**उदाहरण:**

```bash
# incident state बदलें (जैसे resolved पर)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# एक monitor का नाम बदलें
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## एक Resource हटाएं

ID से एक resource हटाएं।

```bash
oneuptime <resource> delete <id> [--force]
```

**Arguments:**

| Argument | विवरण |
|----------|-------|
| `<id>` | Resource ID |

**Options:**

| Option | विवरण |
|--------|-------|
| `--force` | confirmation prompt छोड़ें |

**उदाहरण:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# confirmation छोड़ें
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Resources गिनें

वैकल्पिक filter criteria से मेल खाने वाले resources गिनें।

```bash
oneuptime <resource> count [options]
```

**Options:**

| Option | विवरण |
|--------|-------|
| `--query <json>` | JSON के रूप में filter criteria |

**उदाहरण:**

```bash
# सभी incidents गिनें
oneuptime incident count

# state के अनुसार incidents गिनें
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# monitors गिनें
oneuptime monitor count
```

## Analytics Resources

Analytics resources, database resources की तुलना में सीमित operations का समर्थन करते हैं:

| Operation | समर्थित |
|-----------|---------|
| `list` | हाँ |
| `create` | हाँ |
| `count` | हाँ |
| `get` | नहीं |
| `update` | नहीं |
| `delete` | नहीं |

अपने instance पर कौन से analytics resources उपलब्ध हैं, यह देखने के लिए `oneuptime resources --type analytics` उपयोग करें।
