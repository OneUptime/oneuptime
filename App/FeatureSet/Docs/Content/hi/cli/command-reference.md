# Command Reference

सभी OneUptime CLI commands का पूर्ण संदर्भ।

## Authentication Commands

### `oneuptime login`

OneUptime instance के साथ authenticate करें।

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Parameter | Type | आवश्यक | विवरण |
|-----------|------|--------|-------|
| `<api-key>` | argument | हाँ | authentication के लिए API key |
| `<instance-url>` | argument | हाँ | OneUptime instance URL |
| `--context-name` | option | नहीं | Context नाम (डिफ़ॉल्ट: `"default"`) |

---

### `oneuptime context list`

सभी saved contexts सूचीबद्ध करें।

```bash
oneuptime context list
```

---

### `oneuptime context use`

एक named context पर switch करें।

```bash
oneuptime context use <name>
```

| Parameter | Type | आवश्यक | विवरण |
|-----------|------|--------|-------|
| `<name>` | argument | हाँ | activate करने के लिए Context नाम |

---

### `oneuptime context current`

Masked API key के साथ active context प्रदर्शित करें।

```bash
oneuptime context current
```

---

### `oneuptime context delete`

एक saved context हटाएं।

```bash
oneuptime context delete <name>
```

| Parameter | Type | आवश्यक | विवरण |
|-----------|------|--------|-------|
| `<name>` | argument | हाँ | delete करने के लिए Context नाम |

---

## Resource Commands

सभी resource commands एक ही pattern का पालन करते हैं। `<resource>` को किसी भी समर्थित resource नाम से बदलें (जैसे `incident`, `monitor`, `alert`, `status-page`)।

### `oneuptime <resource> list`

filtering और pagination के साथ resources सूचीबद्ध करें।

```bash
oneuptime <resource> list [options]
```

| Option | Type | Default | विवरण |
|--------|------|---------|-------|
| `--query <json>` | string | None | JSON के रूप में filter criteria |
| `--limit <n>` | number | `10` | अधिकतम results |
| `--skip <n>` | number | `0` | skip करने के लिए results |
| `--sort <json>` | string | None | JSON के रूप में sort order |
| `-o, --output` | string | `table` | Output format |

---

### `oneuptime <resource> get`

ID से एक single resource प्राप्त करें।

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Parameter | Type | आवश्यक | विवरण |
|-----------|------|--------|-------|
| `<id>` | argument | हाँ | Resource ID (UUID) |
| `-o, --output` | option | नहीं | Output format |

---

### `oneuptime <resource> create`

एक नया resource बनाएं।

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Option | Type | आवश्यक | विवरण |
|--------|------|--------|-------|
| `--data <json>` | string | `--data` या `--file` में से एक | JSON के रूप में Resource data |
| `--file <path>` | string | `--data` या `--file` में से एक | JSON फ़ाइल का path |
| `-o, --output` | string | नहीं | Output format |

---

### `oneuptime <resource> update`

एक मौजूदा resource अपडेट करें।

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Parameter | Type | आवश्यक | विवरण |
|-----------|------|--------|-------|
| `<id>` | argument | हाँ | Resource ID |
| `--data <json>` | option | हाँ | JSON के रूप में update करने के लिए fields |
| `-o, --output` | option | नहीं | Output format |

---

### `oneuptime <resource> delete`

एक resource हटाएं।

```bash
oneuptime <resource> delete <id> [--force]
```

| Parameter | Type | आवश्यक | विवरण |
|-----------|------|--------|-------|
| `<id>` | argument | हाँ | Resource ID |
| `--force` | option | नहीं | confirmation prompt छोड़ें |

---

### `oneuptime <resource> count`

एक filter से मेल खाने वाले resources गिनें।

```bash
oneuptime <resource> count [--query <json>]
```

| Option | Type | Default | विवरण |
|--------|------|---------|-------|
| `--query <json>` | string | None | JSON के रूप में filter criteria |

---

## Utility Commands

### `oneuptime version`

CLI version प्रदर्शित करें।

```bash
oneuptime version
```

---

### `oneuptime whoami`

वर्तमान authentication विवरण दिखाएं।

```bash
oneuptime whoami
```

instance URL और masked API key प्रदर्शित करता है। यदि कोई saved context active है, तो context नाम भी दिखाया जाता है।

---

### `oneuptime resources`

सभी उपलब्ध resource types सूचीबद्ध करें।

```bash
oneuptime resources [--type <type>]
```

| Option | Type | Default | विवरण |
|--------|------|---------|-------|
| `--type <type>` | string | None | `database` या `analytics` से filter करें |

---

## Global Options

ये flags सभी commands पर उपलब्ध हैं:

| Option | विवरण |
|--------|-------|
| `--api-key <key>` | API key override करें |
| `--url <url>` | instance URL override करें |
| `--context <name>` | एक specific context उपयोग करें |
| `-o, --output <format>` | Output format: `json`, `table`, `wide` |
| `--no-color` | colored output अक्षम करें |
| `--help` | help दिखाएं |
| `--version` | version दिखाएं |

## API Routes

संदर्भ के लिए, CLI commands इन API endpoints से map होते हैं:

| Command | Method | Endpoint |
|---------|--------|----------|
| `list` | POST | `/api/<resource>/get-list` |
| `get` | POST | `/api/<resource>/<id>/get-item` |
| `create` | POST | `/api/<resource>` |
| `update` | PUT | `/api/<resource>/<id>/` |
| `delete` | DELETE | `/api/<resource>/<id>/` |
| `count` | POST | `/api/<resource>/count` |

सभी requests में authentication के लिए `APIKey` header शामिल है।
