# Managed Security Event Connectors

OneUptime can pull security findings and alerts from AWS Security Hub, Microsoft Defender XDR and Sentinel, Cloudflare, CrowdStrike Falcon, Google Security Command Center, Okta, and Splunk Enterprise Security. The connectors normalize provider records to OneUptime's OCSF-based security event model, deduplicate overlapping results, enrich observables with configured threat-intelligence feeds, and store the events alongside logs, metrics, and traces.

Google SecOps has its own managed connection and diagnostics workflow. See the [Google SecOps integration guide](/docs/integrations/google-secops).

## Create a connection

1. In OneUptime, open **Security Events → Connections**.
2. On **Managed Security Event Connections**, select **Create**.
3. Choose the provider and enter the provider's non-secret **Configuration** JSON and **Credentials JSON** from the sections below.
4. Choose a poll interval from `1` to `1440` minutes and save the connection.

Credentials are encrypted at rest and are write-only. OneUptime never returns a saved credential through its API. Use **Update Credentials** on the connection row when a token, key, or client secret is rotated.

Credential updates are treated as rotations for the same provider source, so replayed events keep their existing identities. If new AWS or CrowdStrike credentials point to a different account while the visible configuration stays the same, create a new connection instead of rotating the credentials on the existing connection.

Use a dedicated read-only identity for each connector. Grant only the permissions listed below and rotate long-lived secrets according to your organization's policy.

## AWS Security Hub

The connector calls Security Hub `GetFindings` in one AWS region and reads findings whose `UpdatedAt` falls within the poll window.

Configuration:

```json
{
  "region": "us-east-1"
}
```

Credentials:

```json
{
  "accessKeyId": "AKIA...",
  "secretAccessKey": "...",
  "sessionToken": "..."
}
```

`sessionToken` is optional for a long-lived IAM access key and required for temporary credentials. The IAM principal needs `securityhub:GetFindings` in the selected region. Prefer temporary credentials and a narrowly scoped role where your deployment can rotate them.

GuardDuty findings are included after GuardDuty is integrated with Security Hub in that region. This connector does not call the GuardDuty API directly, so enable the Security Hub integration for every GuardDuty region you want OneUptime to ingest.

## Microsoft Defender XDR and Sentinel

The connector obtains an application token from Microsoft Entra ID and reads Microsoft Graph security alerts and incidents. Defender and Sentinel records available through the unified Microsoft security incident experience are normalized under their reported product name.

Configuration:

```json
{
  "tenantId": "00000000-0000-0000-0000-000000000000"
}
```

Credentials:

```json
{
  "clientId": "00000000-0000-0000-0000-000000000000",
  "clientSecret": "..."
}
```

Create an app registration with Microsoft Graph application permissions `SecurityAlert.Read.All` and `SecurityIncident.Read.All`, then grant tenant-wide admin consent. The connector uses the OAuth client-credentials flow and does not need a user account.

Sentinel incidents are available through this connector after the Sentinel workspace is onboarded to the Microsoft Defender portal and appears in the unified security incident experience.

## Cloudflare

The connector reads Security Events from the GraphQL Analytics API for one zone. It automatically divides busy time ranges into smaller windows when the API reaches its 1,000-event result ceiling.

Configuration:

```json
{
  "zoneId": "..."
}
```

Credentials:

```json
{
  "apiToken": "..."
}
```

Create a scoped Cloudflare API token that can read firewall or security analytics for the selected account and zone. Availability and retention of `firewallEventsAdaptive` depend on the Cloudflare plan attached to that zone.
Cloudflare can return sampled adaptive events at high traffic volumes, so use Enterprise Logpush when you require a complete raw event archive.

## CrowdStrike Falcon

The connector queries Falcon alerts by update time, then retrieves the full alert entities in bounded batches. It reads one stable ID page per time window; when more alerts are present, OneUptime narrows the time window instead of traversing mutable offset pages.

Configuration:

```json
{
  "cloud": "us-1"
}
```

Supported cloud values are `us-1`, `us-2`, `eu-1`, and `us-gov-1`.

Credentials:

```json
{
  "clientId": "...",
  "clientSecret": "..."
}
```

Create a Falcon API client with read access to Alerts. The credentials are exchanged at the OAuth endpoint for the selected Falcon cloud.

## Google Security Command Center

The connector lists Security Command Center findings for an organization, folder, or project source. Use `-` as the source ID to include all sources visible to the service account.

Configuration:

```json
{
  "parent": "organizations/123456789/sources/-"
}
```

For a regional source, append `/locations/{location}`, for example `organizations/123456789/sources/-/locations/eu`.

Credentials are a Google service-account key:

```json
{
  "client_email": "oneuptime-scc@example.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

Grant the service account a Security Command Center finding read role at the configured organization, folder, or project. OneUptime validates the private key and only exchanges it at Google's standard OAuth token endpoint.

## Okta

The connector reads the Okta System Log in ascending publication order. It omits an `until` boundary and persists Okta's next polling link, which keeps events eligible when Okta publishes them after their original event time.

Configuration:

```json
{
  "baseUrl": "https://example.okta.com"
}
```

Credentials:

```json
{
  "apiToken": "..."
}
```

Create the token from a dedicated read-only Okta administrator account with permission to read the System Log. The connector follows Okta's `Link` pagination only when the next URL remains on the configured HTTPS origin.

## Splunk Enterprise Security

The connector runs a bounded export search through Splunk's management API. By default it reads notable and risk indexes. Set `search` to a narrower query when your deployment uses different indexes, macros, or data models.

Configuration:

```json
{
  "baseUrl": "https://splunk.example.com:8089",
  "search": "search (index=notable OR index=risk)"
}
```

Token credentials:

```json
{
  "apiToken": "...",
  "tokenScheme": "Bearer"
}
```

`tokenScheme` defaults to `Bearer`. Set it to `Splunk` when `apiToken` is a Splunk session key.

Basic credentials can be used instead:

```json
{
  "username": "oneuptime-reader",
  "password": "..."
}
```

The Splunk identity needs permission to run the configured search and read every referenced index. The management API must be reachable from the OneUptime workers and present a certificate trusted by their operating system or container trust store; replace Splunk's default self-signed management certificate or install your internal CA in that trust store. A poll that reaches the 1,000-result ceiling is marked incomplete and retried over a narrower time range.

## Polling and delivery guarantees

The worker checks for due connections once a minute. A new connection initially reads the preceding 15 minutes. Time-window providers resume from the last complete cursor with a one-minute overlap, and a stale connection catches up in windows of at most 24 hours. Okta resumes its provider-issued ascending polling link instead.

OneUptime derives an event ID from the connection, source settings, provider record, event class, and source revision. Exact repeats caused by overlap, provider retries, or interrupted runs are skipped, while later revisions of the same alert remain visible. Provider page tokens are saved between polls. Repeated provider or page-token failures clear the token and narrow the time range. If a provider still truncates a one-second window, OneUptime writes a durable gap audit event, reports possible data loss, and advances so the connection cannot remain permanently stuck.

Malformed records and normalization failures create durable audit events, are counted, and are reported as a partial import so valid later records continue to flow. **Last Polled**, **Last Successful Poll**, **Last Event Imported**, **Last Poll Result**, and **Last Error** show the connection's current state.

For self-hosted installations, workers need outbound HTTPS access to the selected providers. Okta custom domains and Splunk management endpoints may also require private network or internal DNS access from the worker deployment.
