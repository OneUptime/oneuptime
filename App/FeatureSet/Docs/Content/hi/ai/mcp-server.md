# MCP Server

OneUptime Model Context Protocol (MCP) Server, LLMs को आपके OneUptime instance तक सीधी पहुंच प्रदान करता है, जिससे AI-संचालित monitoring, incident management और observability operations सक्षम होते हैं।

## OneUptime MCP Server क्या है?

OneUptime MCP Server, Large Language Models (LLMs) और आपके OneUptime instance के बीच एक bridge है। यह Model Context Protocol (MCP) को implement करता है, जिससे Claude जैसे AI assistants आपके monitoring infrastructure के साथ सीधे interact कर सकते हैं।

## यह कैसे काम करता है

MCP server आपके OneUptime instance के साथ hosted है और Streamable HTTP transport के माध्यम से accessible है। कोई local installation आवश्यक नहीं है।

**Cloud उपयोगकर्ता**: `https://oneuptime.com/mcp`
**Self-Hosted उपयोगकर्ता**: `https://your-oneuptime-domain.com/mcp`

## मुख्य विशेषताएं

- **पूर्ण API Coverage**: 711 OneUptime API endpoints तक पहुंच
- **126 Resource Types**: monitors, incidents, teams, probes और अधिक सहित सभी OneUptime resources प्रबंधित करें
- **Real-time Operations**: real-time में resources बनाएं, पढ़ें, अपडेट करें और हटाएं
- **Type-safe Interface**: व्यापक input validation के साथ पूरी तरह typed
- **सुरक्षित Authentication**: उचित error handling के साथ API key-आधारित authentication
- **आसान Integration**: Claude Desktop और अन्य MCP-compatible clients के साथ काम करता है
- **Session Management**: स्वचालित reconnection support के साथ built-in session handling

## आप क्या कर सकते हैं

OneUptime MCP Server के साथ, AI assistants आपकी मदद कर सकते हैं:

- **Monitor Management**: monitors बनाएं और configure करें, उनकी status जांचें और monitor groups प्रबंधित करें
- **Incident Response**: incidents बनाएं, notes जोड़ें, team members assign करें और resolution track करें
- **Team Operations**: teams, permissions और on-call schedules प्रबंधित करें
- **Status Pages**: status pages अपडेट करें, announcements बनाएं और subscribers प्रबंधित करें
- **Alerting**: alert rules configure करें, escalation policies प्रबंधित करें और notification logs जांचें
- **Probes**: विभिन्न स्थानों पर monitoring probes deploy और प्रबंधित करें
- **Reports और Analytics**: रिपोर्ट तैयार करें और monitoring डेटा का विश्लेषण करें

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

| Endpoint      | Method | विवरण                                                           |
| ------------- | ------ | --------------------------------------------------------------- |
| `/mcp`        | GET    | server-to-client notifications के लिए Server-sent events stream |
| `/mcp`        | POST   | tool calls और अन्य operations के लिए JSON-RPC requests          |
| `/mcp`        | DELETE | Session cleanup और termination                                  |
| `/mcp/health` | GET    | Health check endpoint                                           |
| `/mcp/tools`  | GET    | उपलब्ध tools सूचीबद्ध करने के लिए REST API                      |

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

## सत्यापन

सत्यापित करें कि MCP server चल रहा है:

```bash
# OneUptime Cloud के लिए
curl https://oneuptime.com/mcp/health

# Self-Hosted के लिए
curl https://your-oneuptime-domain.com/mcp/health
```

उपलब्ध tools सूचीबद्ध करें:

```bash
# OneUptime Cloud के लिए
curl https://oneuptime.com/mcp/tools

# Self-Hosted के लिए
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
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
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

- MCP server sessions track करने के लिए `mcp-session-id` header का उपयोग करता है
- सुनिश्चित करें कि आपका client server द्वारा returned session ID को ठीक से handle करता है
- connections बंद होने पर sessions स्वचालित रूप से clean up हो जाते हैं

## उपलब्ध Resources

MCP server 126 resource types तक पहुंच प्रदान करता है जिनमें शामिल हैं:

**Monitoring**: Monitor, MonitorStatus, MonitorGroup, Probe
**Incidents**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Alerts**: Alert, AlertState, AlertSeverity
**Status Pages**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**On-Call**: On-CallPolicy, EscalationRule, On-CallSchedule
**Teams**: Team, TeamMember, TeamPermission
**Telemetry**: TelemetryService, Log, Span, Metric
**Workflows**: Workflow, WorkflowVariable, WorkflowLog

प्रत्येक resource standard operations का समर्थन करता है: List, Count, Get, Create, Update और Delete।
