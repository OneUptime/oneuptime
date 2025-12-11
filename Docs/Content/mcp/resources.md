# Available Resources

The OneUptime MCP Server provides access to 126 different resource types across your OneUptime instance. Here's a comprehensive overview of what you can manage.

## Core Resources

### User Management
- **User**: Manage user accounts and profiles
- **TeamMember**: Handle team membership relationships
- **TeamPermission**: Control access permissions within teams
- **TwoFactorAuth**: Manage two-factor authentication settings

### Project and Team Management
- **Project**: Create and manage monitoring projects
- **Team**: Organize users into teams with specific roles
- **TeamOwner**: Manage team ownership relationships

### Authentication and Security
- **APIKey**: Generate and manage API keys for integrations
- **APIKeyPermission**: Control what each API key can access
- **Label**: Create labels for organizing resources

## Monitoring and Observability

### Monitors
- **Monitor**: Configure and manage all types of monitors
- **MonitorSecret**: Store sensitive data for monitor configurations
- **MonitorStatus**: Track the current state of monitors
- **MonitorCustomField**: Add custom metadata to monitors
- **MonitorProbe**: Assign probes to monitors
- **MonitorTeamOwner**: Manage monitor ownership by teams
- **MonitorUserOwner**: Manage monitor ownership by users
- **MonitorGroup**: Organize monitors into logical groups
- **MonitorGroupTeamOwner**: Manage group ownership by teams
- **MonitorGroupUserOwner**: Manage group ownership by users
- **MonitorGroupResource**: Associate monitors with groups
- **MonitorStatusEvent**: Track monitor status change events
- **MonitorFeed**: Monitor activity feeds and notifications
- **MonitorLog**: Access monitor execution logs

### Probes
- **Probe**: Deploy and manage monitoring probes
- **ProbeOwnerTeam**: Manage probe ownership by teams
- **ProbeUserOwner**: Manage probe ownership by users

## Incident Management

### Incidents
- **Incident**: Create and manage incidents
- **IncidentState**: Define incident states (open, investigating, resolved)
- **IncidentFeed**: Incident activity feeds
- **IncidentCustomField**: Add custom fields to incidents
- **IncidentStateTimeline**: Track incident state changes over time
- **IncidentInternalNote**: Add internal notes for team communication
- **IncidentPublicNote**: Add public-facing notes for transparency
- **IncidentTemplate**: Create templates for common incident types
- **IncidentTemplateTeamOwner**: Manage template ownership by teams
- **IncidentTemplateUserOwner**: Manage template ownership by users
- **IncidentTeamOwner**: Assign incidents to teams
- **IncidentUserOwner**: Assign incidents to individual users
- **IncidentSeverity**: Define and manage incident severity levels
- **IncidentNoteTemplate**: Create templates for incident notes

### Alerts
- **Alert**: Manage alert notifications
- **AlertState**: Define alert states
- **AlertFeed**: Alert activity feeds
- **AlertCustomField**: Add custom fields to alerts
- **AlertStateTimeline**: Track alert state changes
- **AlertInternalNote**: Internal alert notes
- **AlertTeamOwner**: Assign alerts to teams
- **AlertUserOwner**: Assign alerts to users
- **AlertSeverity**: Define alert severity levels
- **AlertNoteTemplate**: Create templates for alert notes

## Status Pages

### Status Page Management
- **StatusPage**: Create and manage public status pages
- **StatusPageGroup**: Organize status page components
- **StatusPageDomain**: Configure custom domains for status pages
- **StatusPageCustomField**: Add custom fields to status pages
- **StatusPageResource**: Manage resources displayed on status pages
- **StatusPageAnnouncement**: Create announcements for status pages
- **StatusPageAnnouncementTemplate**: Templates for common announcements
- **StatusPageSubscriber**: Manage status page subscribers
- **StatusPageFooterLink**: Add custom footer links
- **StatusPageHeaderLink**: Add custom header links
- **StatusPagePrivateUser**: Manage private status page access
- **StatusPageHistoryChartBarColor**: Customize status page chart colors
- **StatusPageTeamOwner**: Manage status page ownership by teams
- **StatusPageUserOwner**: Manage status page ownership by users
- **StatusPageSSO**: Configure single sign-on for private status pages

## Scheduled Maintenance

### Maintenance Management
- **ScheduledMaintenanceState**: Define maintenance states
- **ScheduledMaintenanceEvent**: Create and manage maintenance windows
- **ScheduledMaintenanceStateTimeline**: Track maintenance state changes
- **ScheduledEventPublicNote**: Public notes for maintenance events
- **ScheduledMaintenanceCustomField**: Custom fields for maintenance
- **ScheduledMaintenanceFeed**: Maintenance activity feeds
- **ScheduledMaintenanceTeamOwner**: Team ownership of maintenance events
- **ScheduledMaintenanceUserOwner**: User ownership of maintenance events
- **ScheduledMaintenanceTemplate**: Templates for common maintenance
- **ScheduledMaintenanceTemplateTeamOwner**: Template team ownership
- **ScheduledMaintenanceTemplateUserOwner**: Template user ownership
- **ScheduledMaintenanceNoteTemplate**: Templates for maintenance notes

## On-Call Management

### On-Call Policies
- **On-CallPolicy**: Define on-call escalation policies
- **On-CallPolicyCustomField**: Custom fields for on-call policies
- **EscalationRule**: Configure escalation rules
- **TeamOn-CallDutyEscalationRule**: Team-based escalation rules
- **User'SOn-CallDutyEscalationRule**: User-based escalation rules
- **Schedule'SOn-CallDutyEscalationRule**: Schedule-based escalation rules
- **On-CallDutyExecutionLog**: Logs of on-call executions
- **On-CallDutyExecutionLogTimeline**: Timeline of on-call events
- **UserOverride**: Temporary on-call schedule overrides
- **OnCallDutyPolicyFeed**: On-call policy activity feeds
- **OnCallDutyPolicyTeamOwner**: Team ownership of on-call policies
- **OnCallDutyPolicyUserOwner**: User ownership of on-call policies

### Scheduling
- **On-CallPolicySchedule**: Define on-call schedules
- **On-CallScheduleLayer**: Create schedule layers for complex rotations
- **On-CallScheduleLayerUser**: Assign users to schedule layers
- **UserOn-CallLogTimeline**: Track user on-call activities
- **OnCallTimeLog**: Log on-call time for billing/reporting

## Service Catalog

### Service Management
- **ServiceInServiceCatalog**: Define services in your catalog
- **ServiceCatalogTeamOwner**: Team ownership of services
- **ServiceCatalogUserOwner**: User ownership of services
- **ServiceDependency**: Define dependencies between services
- **ServiceCatalogMonitor**: Associate monitors with services
- **ServiceCatalogTelemetryService**: Link telemetry to services

## Workflow Automation

### Workflows
- **Workflow**: Create automated workflows
- **WorkflowVariable**: Define variables for workflows
- **WorkflowLog**: Access workflow execution logs

## Telemetry and Observability

### Telemetry Services
- **TelemetryService**: Manage telemetry data sources
- **TelemetryIngestionKey**: Keys for telemetry data ingestion
- **Log**: Access and manage log data
- **Span**: Distributed tracing spans
- **Metric**: Application and infrastructure metrics
- **MetricType**: Define custom metric types

### Error Tracking
- **Exception**: Track application exceptions
- **ExceptionInstance**: Individual exception occurrences

### Code Repository Integration
- **CodeRepository**: Connect code repositories

## Communication and Notifications

### Notification Logs
- **SMSLog**: SMS notification delivery logs
- **CallLog**: Phone call notification logs
- **EmailLog**: Email notification delivery logs
- **UserNotificationLog**: User-specific notification history

### Workspace Communication
- **WorkspaceNotificationRule**: Define workspace-wide notification rules

## UI and Customization

### Dashboard and Views
- **Dashboard**: Create custom dashboards
- **TableView**: Customize table views for resources
- **File**: Manage uploaded files and assets
- **Domain**: Configure custom domains

## Resource Operations

For each resource type, the MCP server typically provides these operations:

### Standard Operations
- **List**: Retrieve multiple resources with filtering and pagination
- **Count**: Get the total count of resources matching criteria
- **Get**: Retrieve a single resource by ID
- **Create**: Create new resources
- **Update**: Modify existing resources
- **Delete**: Remove resources

### Example Usage Patterns

**Resource Listing:**
```
"Show me all monitors" → Uses listMonitor
"How many incidents are open?" → Uses countIncident with status filter
```

**Resource Creation:**
```
"Create a new team called 'DevOps'" → Uses createTeam
"Add a website monitor for example.com" → Uses createMonitor
```

**Resource Management:**
```
"Update the timeout for monitor #123" → Uses updateMonitor
"Delete the test probe" → Uses deleteProbe
```

## Resource Relationships

Many resources are interconnected:

- **Monitors** can be owned by **Teams** and **Users**
- **Incidents** can be assigned to **Teams** and have multiple **Notes**
- **Status Pages** display **Resources** and can have **Announcements**
- **On-Call Policies** include **Escalation Rules** and **Schedules**
- **Services** can have **Dependencies** and associated **Monitors**

## Next Steps

- [View usage examples](/docs/mcp/examples)
- [Learn about configuration](/docs/mcp/configuration)
- [Explore troubleshooting](/docs/mcp/troubleshooting)
