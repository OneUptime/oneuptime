# Monitor Templates

Monitor templates share monitoring criteria and check settings across linked monitors. A criteria sync also copies step settings such as destinations, request headers, and timeouts unless you protect those fields.

## Keep values specific to each monitor

1. Open **Monitors → Settings → Templates** and select a template.
2. Click **Edit Criteria**.
3. In **Template sync settings**, check **Do not sync this field** beside each field you want to keep on the linked monitors.
4. Save your changes. The template details and sync confirmation list the protected fields.
5. Use **Sync Criteria to Linked Monitors**, or sync an individual linked monitor.

For example, protect **Monitor destination** and **Request headers** on an API template. Production and staging monitors keep their own URLs and headers, while both receive the template's updated criteria and other unprotected settings.

The available options depend on the monitor type. These include destinations and ports, HTTP request options, database connections, DNS settings, infrastructure selectors, and telemetry queries. Related credentials, such as a client certificate and its private key, are kept together.

## How exclusions behave

- Checked fields keep each existing monitor's current value, including an empty or unset value. Request headers and other collections are preserved in full.
- Unchecked fields continue to sync from the template. Uncheck a protected field and save to copy its template value on the next sync.
- Exclusions apply to bulk and individual syncs. They are saved on the template, not selected separately for each sync.
- New monitors still start with the template's field values. Exclusions only affect syncing to existing monitors.
- Criteria always sync. Criteria-only sync leaves monitoring interval, labels, and other monitor-level settings alone.
- Existing templates have no field exclusions until you configure them. Network Device monitors continue to retain their own device binding automatically.

For templates with multiple steps, protected values are matched using the step IDs. Independently created single-step monitors can also receive a single-step template. If a protected step cannot be matched, the sync is rejected before any monitor updates, so a new or reordered step cannot accidentally copy another step's destination or credentials.

Before changing a saved template's monitor type, clear exclusions that do not apply to the new type in **Edit Criteria**.

## API configuration

Each template step accepts a `doNotSyncFields` array in its `MonitorStep.value` object. For an API monitor, protect its destination and entire header collection with:

```json
{
  "doNotSyncFields": ["monitorDestination", "requestHeaders"]
}
```

Omit the array or set it to `[]` to sync every supported step setting. Unsupported field names and fields that do not apply to the template's monitor type are rejected. The template's array controls sync; any such metadata on a linked monitor does not override it.
