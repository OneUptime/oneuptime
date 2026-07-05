# MCP Server

OneUptime Model Context Protocol (MCP) Server, LLMs को आपके OneUptime instance तक सीधी पहुंच प्रदान करता है, जिससे AI-संचालित monitoring, incident management और observability operations सक्षम होते हैं।

## OneUptime MCP Server क्या है?

OneUptime MCP Server, Large Language Models (LLMs) और आपके OneUptime instance के बीच एक bridge है। यह Model Context Protocol (MCP) को implement करता है, जिससे Claude जैसे AI assistants आपके monitoring infrastructure के साथ सीधे interact कर सकते हैं।

## यह कैसे काम करता है

MCP server आपके OneUptime instance के साथ hosted है और Streamable HTTP transport के माध्यम से accessible है। कोई local installation आवश्यक नहीं है।

**Cloud उपयोगकर्ता**: `https://oneuptime.com/mcp`
**Self-Hosted उपयोगकर्ता**: `https://your-oneuptime-domain.com/mcp`

## मुख्य विशेषताएं

- **~155 Tools**: 22 resource types (incidents, alerts, monitors, status pages, on-call और अधिक) के लिए पूर्ण CRUD tools, read-only telemetry tools, साथ ही workflow और helper tools
- **Real-time Operations**: real-time में resources बनाएं, पढ़ें, अपडेट करें और हटाएं
- **Type-safe Interface**: व्यापक input validation के साथ पूरी तरह typed
- **सुरक्षित Authentication**: उचित error handling के साथ per-request API key authentication
- **Safety Annotations**: read-only tools पर `readOnlyHint` और delete tools पर `destructiveHint` लगे होते हैं, जिससे MCP clients सुरक्षित calls को स्वतः approve कर सकते हैं और destructive calls से पहले पूछ सकते हैं
- **आसान Integration**: Claude Desktop और अन्य MCP-compatible clients के साथ काम करता है
- **Design से ही Stateless**: कोई session IDs नहीं — हर request self-contained है, इसलिए server load balancers और multi-replica deployments के पीछे भी काम करता है

## आप क्या कर सकते हैं

OneUptime MCP Server के साथ, AI assistants आपकी मदद कर सकते हैं:

- **Monitor Management**: monitors बनाएं और configure करें, उनकी status जांचें और status history की समीक्षा करें
- **Incident Response**: incidents बनाएं, acknowledge और resolve करें, internal या public notes जोड़ें और resolution track करें
- **Team Operations**: teams और on-call policies प्रबंधित करें
- **Status Pages**: status pages प्रबंधित करें और announcements बनाएं
- **Alerting**: alerts को acknowledge और resolve करें, alert notes जोड़ें और alert states तथा severities प्रबंधित करें
- **Scheduled Maintenance**: scheduled maintenance events बनाएं और प्रबंधित करें
- **Telemetry**: logs, metrics, traces, exceptions और monitor logs query करें (read-only)

## आवश्यकताएं

- OneUptime instance (cloud या self-hosted)
- MCP-compatible client (Claude Desktop, VS Code with GitHub Copilot, आदि)
- Valid OneUptime API key (केवल authenticated operations के लिए आवश्यक - public tools इसके बिना काम करते हैं)

## अपनी API Key प्राप्त करना

1. अपने OneUptime instance में लॉग इन करें
2. **Settings** → **API Keys** पर जाएं
3. **Create API Key** पर क्लिक करें
4. एक नाम दें (जैसे "MCP Server")
5. अपने use case के लिए उचित permissions चुनें
6. generated API key copy करें

API keys project-scoped होती हैं: MCP server आपकी key से आपका project स्वयं पहचान लेता है, इसलिए create tools को कभी भी `projectId` argument की आवश्यकता नहीं होती।

> **चेतावनी — किसी AI agent को कभी master key न दें।** OneUptime की *master* API key भी इस header पर स्वीकार की जाती है और यह instance-व्यापी admin access प्रदान करती है। हमेशा उस project API key का उपयोग करें जिसमें agent के लिए आवश्यक न्यूनतम privilege हो (सभी `get_`/`list_`/`count_` tools के लिए एक read-only key पर्याप्त है)।

## Configuration

### Claude Desktop Configuration

अपनी Claude Desktop configuration फ़ाइल खोजें:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### OneUptime Cloud के लिए

निम्नलिखित configuration जोड़ें:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Self-Hosted OneUptime के लिए

`oneuptime.com` को अपने OneUptime domain से बदलें:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Public Access (API Key के बिना)

केवल public tools (status page जानकारी, help) का उपयोग करने के लिए, आप API key के बिना connect कर सकते हैं:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

यह configuration authentication की आवश्यकता के बिना public status page tools और help resources तक पहुंच की अनुमति देती है।

### VS Code with GitHub Copilot

VS Code, GitHub Copilot (version 1.99+) के साथ MCP servers को natively support करता है। इससे Copilot सीधे OneUptime डेटा तक पहुंच सकता है।

#### चरण 1: आवश्यकताएं

- VS Code version 1.99 या बाद का
- GitHub Copilot extension इंस्टॉल और activated
- GitHub Copilot Chat सक्षम

#### चरण 2: MCP Configuration खोलें

1. `Ctrl+Shift+P` (Windows/Linux) या `Cmd+Shift+P` (macOS) दबाएं
2. "MCP: Open User Configuration" टाइप करें और Enter दबाएं
3. यह `mcp.json` configuration फ़ाइल खोलता या बनाता है

वैकल्पिक रूप से, project-specific configuration के लिए अपने workspace में `.vscode/mcp.json` बनाएं।

#### OneUptime Cloud के लिए

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Self-Hosted OneUptime के लिए

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### चरण 3: MCP Server शुरू करें

1. `Ctrl+Shift+P` / `Cmd+Shift+P` दबाएं
2. उपलब्ध servers देखने के लिए "MCP: List Servers" टाइप करें
3. server शुरू करने के लिए "oneuptime" पर क्लिक करें
4. जब पूछा जाए, अपनी OneUptime API key दर्ज करें

#### चरण 4: Copilot Chat के साथ उपयोग करें

GitHub Copilot Chat खोलें और Agent mode (`@workspace` या सीधे पूछें) का उपयोग करें:

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### सुरक्षा नोट

उपरोक्त configuration आपकी API key को plain text में संग्रहीत करने के बजाय सुरक्षित रूप से prompt करने के लिए `"password": true` के साथ input variables का उपयोग करती है। पहली बार MCP server शुरू करते समय VS Code आपसे trust confirm करने के लिए कहेगा।

## उपलब्ध Endpoints

| Endpoint      | Method | विवरण                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | tool calls और अन्य operations के लिए JSON-RPC requests                                                                            |
| `/mcp`        | GET    | SSE `Accept` header के बिना: friendly JSON discovery payload। इसके साथ: `405` — stateless server कोई standalone SSE stream प्रदान नहीं करता (compliant clients इसके बिना आगे बढ़ते हैं) |
| `/mcp`        | DELETE | No-op (server stateless है, इसलिए terminate करने के लिए कोई session नहीं है)                                                             |
| `/mcp/health` | GET    | Health check endpoint                                                                                                            |
| `/mcp/tools`  | GET    | उपलब्ध tools सूचीबद्ध करने के लिए REST API                                                                                                 |

## Authentication

MCP server दो modes में काम करता है:

### Public Tools (Authentication आवश्यक नहीं)

आप public tools तक पहुंचने के लिए API key के बिना MCP server से connect कर सकते हैं:

- **`oneuptime_help`**: OneUptime MCP capabilities के बारे में help और मार्गदर्शन प्राप्त करें
- **`oneuptime_list_resources`**: उपलब्ध resources और उनके operations सूचीबद्ध करें
- **`get_public_status_page_overview`**: एक public status page का overview प्राप्त करें
- **`get_public_status_page_incidents`**: एक public status page से incidents प्राप्त करें
- **`get_public_status_page_scheduled_maintenance`**: scheduled maintenance events प्राप्त करें
- **`get_public_status_page_announcements`**: एक public status page से announcements प्राप्त करें

Public status page tools status page ID (UUID) या status page domain name दोनों स्वीकार करते हैं।

### Authenticated Tools (API Key आवश्यक)

अन्य सभी operations के लिए (monitors, incidents, teams, आदि प्रबंधित करना), निम्नलिखित headers में से किसी एक के माध्यम से authentication आवश्यक है:

- `x-api-key`: आपकी OneUptime API key
- `Authorization`: आपकी API key के साथ Bearer token (जैसे `Bearer your-api-key-here`)

`Bearer` scheme case-insensitive है। Tool errors, in-band tool results (`isError: true`) के रूप में लौटाई जाती हैं — जिनमें `statusCode`, विवरण और एक सुझाव शामिल होता है — MCP protocol errors के रूप में नहीं, ताकि agents विफलता को पढ़कर स्वयं को सुधार सकें।

## Workflow Tools

per-resource CRUD tools के अलावा, server incident और alert response के लिए विशेष रूप से बनाए गए workflow tools भी प्रदान करता है:

- **`acknowledge_incident`** / **`resolve_incident`**: incident को project की Acknowledged या Resolved state में ले जाएं — dashboard में बटन दबाने के समतुल्य
- **`acknowledge_alert`** / **`resolve_alert`**: alerts के लिए वही कार्य
- **`add_incident_note`**: incident में note जोड़ें, `visibility: "internal"` (केवल team के लिए, default) या `visibility: "public"` (status page पर प्रकाशित) के साथ। Markdown समर्थित है
- **`add_alert_note`**: alert में एक internal note जोड़ें

एक सामान्य loop: `list_incidents` → `acknowledge_incident` → `list_logs` से जांच → `add_incident_note` (public) → `resolve_incident`।

## Who Am I

**`oneuptime_whoami`** tool वह project लौटाता है जिससे आपकी API key संबंधित है (ID और नाम)। किसी agent के लिए स्वयं को orient करने हेतु यह एक उपयोगी पहली call है — और चूंकि create tools API key से `projectId` स्वयं पहचान लेते हैं, agent को कभी project ID pass करने की आवश्यकता नहीं होती।

## Telemetry Query करना

Logs, metrics, traces (spans), exceptions और monitor logs read-only `list_` और `count_` tools के रूप में उपलब्ध हैं (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` और उनके `count_` समकक्ष)। Telemetry OpenTelemetry के माध्यम से ingest होती है, इसलिए कोई create tools नहीं हैं।

Telemetry को हमेशा time-range filter के साथ query करें। Query fields या तो सीधा value या एक operator object स्वीकार करती हैं:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

समर्थित operators: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`। Sort values `"ASC"` या `"DESC"` हैं।

## Field Selection और Pagination

`get_` और `list_` tools field names का एक वैकल्पिक `select` array स्वीकार करते हैं। Default रूप से सभी readable fields लौटाई जाती हैं, सिवाय भारी fields के (JSON, very-long-text और HTML columns), जिन्हें `select` में स्पष्ट रूप से मांगना आवश्यक है।

List tools `limit` (default 10, अधिकतम 100) और `skip` के साथ paginate करते हैं, और हर list response ठीक-ठीक बताता है कि उसने क्या लौटाया:

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## सत्यापन

सत्यापित करें कि MCP server चल रहा है:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

उपलब्ध tools सूचीबद्ध करें:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## उपयोग उदाहरण

### बुनियादी जानकारी queries

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Monitor Management

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Incident Management

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Team और On-Call

```
"List the teams in this project"
"Show me our on-call policies"
```

### Status Page Management

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Public Status Page Queries (API Key के बिना)

ये queries authentication के बिना काम करती हैं, केवल public status page tools का उपयोग करती हैं:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### उन्नत Operations

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API Key Permissions

### Read-Only Access

केवल डेटा देखने के लिए, अपनी API key के लिए read permissions जोड़ें।

### Full Access

resources बनाने, अपडेट करने और हटाने के लिए पूर्ण पहुंच हेतु, सुनिश्चित करें कि आपकी API key में Project Admin permissions हों।

### सर्वोत्तम प्रथाएं

- Specific Permissions उपयोग करें: केवल न्यूनतम आवश्यक permissions grant करें
- API Keys rotate करें: अपनी API keys नियमित रूप से rotate करें
- उपयोग Monitor करें: OneUptime में API key उपयोग पर नज़र रखें
- अलग Keys: विभिन्न environments के लिए अलग-अलग API keys उपयोग करें

## समस्या निवारण

### Permission Errors

सुनिश्चित करें कि आपकी API key में आवश्यक permissions हैं:

- resources सूचीबद्ध करने के लिए Read access
- resources बनाने/अपडेट करने के लिए Write access
- resources हटाने के लिए Delete access

### Connection संबंधी समस्याएं

1. सत्यापित करें कि आपका OneUptime URL सही है
2. जांचें कि आपकी API key valid है
3. सुनिश्चित करें कि आपका OneUptime instance accessible है
4. health endpoint परीक्षण करें

### Invalid API Key

- अपने OneUptime settings में API key सत्यापित करें
- अतिरिक्त spaces या characters जांचें
- सुनिश्चित करें कि key expired नहीं हुई है

### Session Errors

यदि आपको session-संबंधित त्रुटियां मिलती हैं:

- MCP server stateless है — यह session IDs जारी या track नहीं करता, इसलिए हर request किसी भी server replica पर काम करती है
- जो clients किसी पुराने server version का `mcp-session-id` header भेजते हैं, वे इसे बस छोड़ सकते हैं; इसे अनदेखा किया जाता है
- ऐसे पुराने MCP client configurations अपडेट करें जो server से session ID लौटाए जाने की अपेक्षा करते हैं

## उपलब्ध Resources

MCP server निम्नलिखित resources के लिए tools प्रदान करता है:

**Monitoring**: Monitor, Monitor Status, Monitor Status Event
**Incidents**: Incident, Incident State, Incident Severity, Incident State Timeline, Incident Public Note, Incident Internal Note
**Alerts**: Alert, Alert State, Alert Severity, Alert State Timeline, Alert Internal Note
**Status Pages**: Status Page, Status Page Announcement
**Scheduled Maintenance**: Scheduled Maintenance Event, Scheduled Maintenance State, Scheduled Maintenance State Timeline
**Teams और On-Call**: Team, On-Call Policy
**Labels**: Label
**Telemetry (read-only)**: Log, Metric, Span, Exception Instance, Monitor Log

प्रत्येक database resource snake_case tools के माध्यम से Create, Get, List, Update, Delete और Count का समर्थन करता है — उदाहरण के लिए `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`। Telemetry resources केवल `list_` और `count_` tools प्रदान करते हैं (उदाहरण के लिए `list_logs`, `count_spans`)।
