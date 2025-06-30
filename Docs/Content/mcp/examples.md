# Usage Examples

Learn how to use the OneUptime MCP Server with practical examples and common use cases.

## Getting Started Examples

### Basic Information Queries

**Check monitor status:**
```
"What's the current status of all my monitors?"
```

**View recent incidents:**
```
"Show me incidents from the last 24 hours"
```

## Monitor Management

### Creating Monitors

**Create a website monitor:**
```
"Create a new website monitor for https://example.com that checks every 5 minutes"
```

**Create an API monitor:**
```
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
```

**Create a ping monitor:**
```
"Create a ping monitor for server 192.168.1.100"
```

### Managing Existing Monitors

**Update monitor frequency:**
```
"Change the monitoring interval for my website monitor to every 2 minutes"
```

**Disable a monitor temporarily:**
```
"Disable the monitor for staging.example.com while we're doing maintenance"
```

**Add custom headers to HTTP monitor:**
```
"Add an Authorization header to my API monitor with value 'Bearer token123'"
```

## Incident Management

### Creating Incidents

**Create a new incident:**
```
"Create a high-priority incident for the database outage affecting user authentication"
```

**Create incident with details:**
```
"Create an incident titled 'Payment Gateway Down' with description 'Users cannot process payments' and assign it to the backend team"
```

### Managing Incidents

**Add notes to incident:**
```
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
```

**Update incident status:**
```
"Mark incident #456 as resolved"
```

**Assign incident to team:**
```
"Assign the current payment gateway incident to the infrastructure team"
```

## Team and User Management

### Team Operations

**List team members:**
```
"Who are the members of the infrastructure team?"
```

**Add user to team:**
```
"Add john@example.com to the backend development team"
```

**Check team permissions:**
```
"What permissions does the frontend team have?"
```

### On-Call Management

**Check who's on call:**
```
"Who's currently on call for the infrastructure team?"
```

**View on-call schedule:**
```
"Show me the on-call schedule for this week"
```

## Status Page Management

### Status Page Updates

**Update status page:**
```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
```

**Create announcement:**
```
"Create a status page announcement about scheduled maintenance this weekend"
```

**Check current status:**
```
"What's the current status showing on our public status page?"
```

## Probe Management

### Managing Probes

**List all probes:**
```
"Show me all monitoring probes and their locations"
```

**Create a new probe:**
```
"Set up a new monitoring probe in the EU-West region"
```

**Check probe health:**
```
"Are all our monitoring probes healthy and reporting data?"
```

## Analytics and Reporting

### Performance Queries

**Monitor uptime stats:**
```
"What's the uptime percentage for all monitors this month?"
```

**Incident trends:**
```
"How many incidents did we have last week compared to this week?"
```

**Response time analysis:**
```
"What are the average response times for our API endpoints today?"
```

## Advanced Use Cases

### Automated Incident Response

**Create incident and assign team:**
```
"Create a critical incident for API timeout issues, assign to DevOps team, and add initial troubleshooting steps to the description"
```

**Bulk monitor updates:**
```
"Update all website monitors to use a 60-second timeout instead of 30 seconds"
```

### Maintenance Operations

**Prepare for maintenance:**
```
"Create a scheduled maintenance window for this Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
```

**Post-maintenance cleanup:**
```
"Re-enable all monitors that were disabled for maintenance and update status page to show all systems operational"
```

### Integration Workflows

**Monitor creation from incidents:**
```
"Based on the recent database timeout incident, create a new monitor to check database response time every minute"
```

**Team notification setup:**
```
"Set up escalation rules so that if any critical monitor fails, it immediately notifies the on-call engineer and escalates to the team lead after 15 minutes"
```

## Complex Queries

### Multi-step Operations

```
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one, and assign them to the appropriate teams based on the monitor tags"
```

```
"Find all incidents that have been open for more than 24 hours, add a note requesting status updates, and notify the assigned teams"
```

### Conditional Logic

```
"If any monitors in the 'production' group are currently failing, create a high-priority incident and immediately notify the on-call team"
```

```
"Check if our main website monitor has been down for more than 5 minutes, and if so, update the status page to show 'investigating connectivity issues'"
```

## Best Practices

### Effective Prompts

1. **Be Specific**: Include exact names, IDs, or criteria
2. **Provide Context**: Mention urgency, affected systems, or business impact
3. **Use Natural Language**: The AI understands conversational requests
4. **Combine Operations**: Ask for multiple related actions in one request

### Safety Considerations

1. **Review Before Executing**: Check what the AI plans to do
2. **Start Small**: Test with non-critical resources first
3. **Have Rollback Plans**: Know how to reverse changes
4. **Monitor Results**: Verify operations completed successfully

## Next Steps

- [Learn about available resources](/docs/mcp/resources)
- [Explore configuration options](/docs/mcp/configuration)
- [View troubleshooting guide](/docs/mcp/troubleshooting)
