# oneuptime-mcp

OneUptime Model Context Protocol (MCP) Server - Provides access to OneUptime APIs for LLMs

This is a Model Context Protocol (MCP) server that provides access to OneUptime's APIs, allowing LLMs to interact with your OneUptime instance for monitoring, incident management, and observability operations.

## Features

- **Complete API Coverage**: Access to 707 OneUptime API endpoints
- **Resource Management**: Manage 125 different resource types including User, Probe, Project, Team, Team Member, and more
- **Real-time Operations**: Create, read, update, and delete resources in your OneUptime instance
- **Type-safe**: Fully typed interface with comprehensive input validation
- **Error Handling**: Robust error handling with detailed error messages
- **Authentication**: Secure API key-based authentication

## Installation

### Via NPM

```bash
npm install -g @oneuptime/mcp-server
```

### From Source

```bash
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime/MCP-Generated
npm install
npm run build
```

## Configuration

### Environment Variables

The MCP server requires the following environment variables:

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `ONEUPTIME_API_KEY` | Your OneUptime API key | Yes | `sk-xxxxxxxxxxxx` |
| `ONEUPTIME_URL` | Your OneUptime instance URL | No | `https://oneuptime.com` (default) |

### Getting Your API Key

1. **For OneUptime Cloud**:
   - Go to [OneUptime Cloud](https://oneuptime.com) and log in
   - Navigate to **Settings** → **API Keys**
   - Click **Create API Key**
   - Name it "MCP Server" and select appropriate permissions
   - Copy the generated API key

2. **For Self-Hosted OneUptime**:
   - Access your OneUptime instance
   - Navigate to **Settings** → **API Keys**
   - Click **Create API Key**
   - Name it "MCP Server" and select appropriate permissions
   - Copy the generated API key

## Usage

### With Claude Desktop

Add the following to your Claude Desktop configuration file:

```json
{
  "mcpServers": {
    "oneuptime": {
      "command": "oneuptime-mcp",
      "env": {
        "ONEUPTIME_API_KEY": "your-api-key-here",
        "ONEUPTIME_URL": "https://your-instance.oneuptime.com"
      }
    }
  }
}
```

### With Other MCP Clients

The server can be used with any MCP-compatible client by running:

```bash
oneuptime-mcp
```

Ensure the environment variables are set before running the server.

## Available Tools

The MCP server provides access to the following OneUptime operations:

- **listUser**: Endpoint to list all User items
- **countUser**: Endpoint to count User items
- **listProbe**: Endpoint to list all Probe items
- **countProbe**: Endpoint to count Probe items
- **createProbe**: Endpoint to create a new Probe
- **getProbe**: Endpoint to retrieve a single Probe by ID
- **updateProbe**: Endpoint to update an existing Probe
- **deleteProbe**: Endpoint to delete a Probe
- **listProject**: Endpoint to list all Project items
- **countProject**: Endpoint to count Project items
- **createProject**: Endpoint to create a new Project
- **getProject**: Endpoint to retrieve a single Project by ID
- **updateProject**: Endpoint to update an existing Project
- **deleteProject**: Endpoint to delete a Project
- **listTeam**: Endpoint to list all Team items
- **countTeam**: Endpoint to count Team items
- **createTeam**: Endpoint to create a new Team
- **getTeam**: Endpoint to retrieve a single Team by ID
- **updateTeam**: Endpoint to update an existing Team
- **deleteTeam**: Endpoint to delete a Team
...and 687 more tools

## Resource Types

You can manage the following OneUptime resources:

- **User**
- **Probe**
- **Project**
- **Team**
- **TeamMember**
- **TeamPermission**
- **APIKey**
- **Label**
- **APIKeyPermission**
- **StatusPage**
- **On-CallPolicy**
- **On-CallPolicyCustomField**
- **EscalationRule**
- **TeamOn-CallDutyEscalationRule**
- **User'SOn-CallDutyEscalationRule**
- **On-CallDutyExecutionLog**
- **On-CallDutyExecutionLogTimeline**
- **UserOverride**
- **Monitor**
- **MonitorSecret**
- **MonitorStatus**
- **MonitorCustomField**
- **IncidentState**
- **Incident**
- **IncidentFeed**
- **IncidentCustomField**
- **IncidentStateTimeline**
- **IncidentInternalNote**
- **IncidentPublicNote**
- **IncidentTemplate**
- **IncidentTemplateTeamOwner**
- **IncidentTemplateUserOwner**
- **IncidentTeamOwner**
- **IncidentUserOwner**
- **IncidentSeverity**
- **IncidentNoteTemplate**
- **AlertState**
- **Alert**
- **AlertFeed**
- **AlertCustomField**
- **AlertStateTimeline**
- **AlertInternalNote**
- **AlertTeamOwner**
- **AlertUserOwner**
- **AlertSeverity**
- **AlertNoteTemplate**
- **MonitorStatusEvent**
- **Domain**
- **StatusPageGroup**
- **StatusPageDomain**
- **StatusPageCustomField**
- **StatusPageResource**
- **StatusPageAnnouncement**
- **StatusPageAnnouncementTemplate**
- **StatusPageSubscriber**
- **StatusPageFooterLink**
- **StatusPageHeaderLink**
- **StatusPagePrivateUser**
- **StatusPageHistoryChartBarColor**
- **ScheduledMaintenanceState**
- **ScheduledMaintenanceEvent**
- **ScheduledMaintenanceStateTimeline**
- **ScheduledEventPublicNote**
- **ScheduledMaintenanceCustomField**
- **ScheduledMaintenanceFeed**
- **Workflow**
- **WorkflowVariable**
- **WorkflowLog**
- **StatusPageSSO**
- **MonitorProbe**
- **MonitorTeamOwner**
- **MonitorUserOwner**
- **ScheduledMaintenanceTeamOwner**
- **ScheduledMaintenanceUserOwner**
- **StatusPageTeamOwner**
- **StatusPageUserOwner**
- **SMSLog**
- **CallLog**
- **EmailLog**
- **UserNotificationLog**
- **UserOn-CallLogTimeline**
- **ScheduledMaintenanceTemplate**
- **ScheduledMaintenanceTemplateTeamOwner**
- **ScheduledMaintenanceTemplateUserOwner**
- **ScheduledMaintenanceNoteTemplate**
- **MonitorGroup**
- **MonitorGroupTeamOwner**
- **MonitorGroupUserOwner**
- **MonitorGroupResource**
- **TelemetryService**
- **On-CallPolicySchedule**
- **On-CallScheduleLayer**
- **On-CallScheduleLayerUser**
- **OnCallDutyPolicyFeed**
- **OnCallDutyPolicyTeamOwner**
- **OnCallDutyPolicyUserOwner**
- **Schedule'SOn-CallDutyEscalationRule**
- **ServiceInServiceCatalog**
- **ServiceCatalogTeamOwner**
- **ServiceCatalogUserOwner**
- **ServiceDependency**
- **ServiceCatalogMonitor**
- **ServiceCatalogTelemetryService**
- **CodeRepository**
- **CopilotEvent**
- **ServiceCodeRepositoryForCopilot**
- **CopilotPullRequest**
- **CopilotActionPriority**
- **ProbeOwnerTeam**
- **ProbeUserOwner**
- **TwoFactorAuth**
- **TelemetryIngestionKey**
- **Exception**
- **TableView**
- **Dashboard**
- **WorkspaceNotificationRule**
- **MonitorFeed**
- **MetricType**
- **OnCallTimeLog**
- **Log**
- **Span**
- **Metric**
- **TelemetryAttribute**
- **ExceptionInstance**
- **MonitorLog**

## Development

### Prerequisites

- Node.js 18+
- TypeScript 5+
- OneUptime API access

### Setup

1. Clone the repository and navigate to the generated MCP directory
2. Install dependencies: `npm install`
3. Set up environment variables
4. Start development server: `npm run dev`

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

## License

This project is licensed under the Apache 2.0 License.

---

Generated from OneUptime OpenAPI specification v1.0.0
