/*
 * "Your OneUptime data" as security sources: the telemetry beyond logs that
 * OneUptime already holds for a project, read for what an attack leaves in
 * it - the way "Your logs" (SecurityLogFormat) reads the logs.
 *
 *   traces          requests whose URL carries an attack, requests that
 *                   send the app to a cloud metadata address, and prompts to
 *                   an LLM that try to override its instructions;
 *   network flows   one address scanning ports or hosts, traffic with an
 *                   address threat intel knows, large transfers out;
 *   audit log       API keys, roles, teams, MCP clients and packet captures
 *                   changed in OneUptime itself, and many deletes at once;
 *   session replay  one signed-in user in two countries within the hour;
 *   cloud audit     the audit logs of the AWS accounts, Google Cloud
 *                   projects and Azure subscriptions connected under Cloud:
 *                   CloudTrail, Google Cloud's Admin Activity log and the
 *                   Azure Activity Log, as OneUptime reads them for Cloud's
 *                   changes - with no log pipeline to set up.
 *
 * One switch per kind per project (SecurityTelemetrySource). The first four
 * are read every minute by Server/Utils/SecurityEvent/TelemetryScan; every
 * event one of them finds is attributed to the kind's own "OneUptime ..."
 * service and carries the vendor "OneUptime" and the kind's product, which
 * is how the rule library tells the project sends it (DetectionRuleDataKind).
 *
 * Cloud audit logs are read with each cloud account's own read
 * (Server/Utils/SecurityEvent/CloudAudit): their records are the cloud's,
 * read by the same parsers as "Your logs", so their events carry the
 * cloud's vendor and product - AWS CloudTrail, Google Cloud Audit Logs,
 * Azure Activity Log - and a record read both ways is stored once.
 */
export enum SecurityTelemetrySourceKind {
  Traces = "traces",
  NetworkFlows = "network-flows",
  AuditLog = "audit-log",
  RumSessions = "rum-sessions",
  CloudAudit = "cloud-audit",
}

export interface SecurityTelemetrySourceDefinition {
  kind: SecurityTelemetrySourceKind;
  // The service its events are attributed to, as "OneUptime Logs" is for logs.
  serviceName: string;
  vendorName: string;
  productName: string;
}

export const SECURITY_TELEMETRY_VENDOR_NAME: string = "OneUptime";

export const SECURITY_TELEMETRY_SOURCES: ReadonlyArray<SecurityTelemetrySourceDefinition> =
  [
    {
      kind: SecurityTelemetrySourceKind.Traces,
      serviceName: "OneUptime Traces",
      vendorName: SECURITY_TELEMETRY_VENDOR_NAME,
      productName: "OneUptime Traces",
    },
    {
      kind: SecurityTelemetrySourceKind.NetworkFlows,
      serviceName: "OneUptime Network Flows",
      vendorName: SECURITY_TELEMETRY_VENDOR_NAME,
      productName: "OneUptime Network Flows",
    },
    {
      kind: SecurityTelemetrySourceKind.AuditLog,
      serviceName: "OneUptime Audit Log",
      vendorName: SECURITY_TELEMETRY_VENDOR_NAME,
      productName: "OneUptime Audit Log",
    },
    {
      kind: SecurityTelemetrySourceKind.RumSessions,
      serviceName: "OneUptime Session Replay",
      vendorName: SECURITY_TELEMETRY_VENDOR_NAME,
      productName: "OneUptime Session Replay",
    },
    /*
     * Its events carry the cloud's own vendor and product (see the header):
     * these name the service they are attributed to, and nothing else.
     */
    {
      kind: SecurityTelemetrySourceKind.CloudAudit,
      serviceName: "OneUptime Cloud Audit Logs",
      vendorName: SECURITY_TELEMETRY_VENDOR_NAME,
      productName: "OneUptime Cloud Audit Logs",
    },
  ];

export const SECURITY_TELEMETRY_SOURCE_KINDS: ReadonlyArray<SecurityTelemetrySourceKind> =
  SECURITY_TELEMETRY_SOURCES.map(
    (
      definition: SecurityTelemetrySourceDefinition,
    ): SecurityTelemetrySourceKind => {
      return definition.kind;
    },
  );

export function isSecurityTelemetrySourceKind(
  value: unknown,
): value is SecurityTelemetrySourceKind {
  return (
    typeof value === "string" &&
    (SECURITY_TELEMETRY_SOURCE_KINDS as ReadonlyArray<string>).includes(value)
  );
}

// The kinds the telemetry scan reads, every minute: all but cloud audit logs.
export type SecurityTelemetryScannedKind = Exclude<
  SecurityTelemetrySourceKind,
  SecurityTelemetrySourceKind.CloudAudit
>;

export const SECURITY_TELEMETRY_SCANNED_KINDS: ReadonlyArray<SecurityTelemetryScannedKind> =
  SECURITY_TELEMETRY_SOURCE_KINDS.filter(
    (
      kind: SecurityTelemetrySourceKind,
    ): kind is SecurityTelemetryScannedKind => {
      return kind !== SecurityTelemetrySourceKind.CloudAudit;
    },
  );

export function isSecurityTelemetryScannedKind(
  value: unknown,
): value is SecurityTelemetryScannedKind {
  return (
    typeof value === "string" &&
    (SECURITY_TELEMETRY_SCANNED_KINDS as ReadonlyArray<string>).includes(value)
  );
}

export function getSecurityTelemetrySourceDefinition(
  kind: SecurityTelemetrySourceKind,
): SecurityTelemetrySourceDefinition {
  return SECURITY_TELEMETRY_SOURCES.find(
    (definition: SecurityTelemetrySourceDefinition): boolean => {
      return definition.kind === kind;
    },
  )!;
}

/*
 * What an event of a telemetry source is, on every one it stores: the rule
 * library's rules for these sources match it, and a search reads it
 * (`@oneuptime.signal:port-scan`). The source itself goes under the key
 * "Your logs" uses (SECURITY_LOG_SOURCE_ATTRIBUTE, "oneuptime.source"), with
 * the kind as its value.
 */
export const SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE: string = "oneuptime.signal";

export enum SecurityTelemetrySignal {
  // Traces.
  WebAttack = "web-attack",
  ServerSideRequestForgery = "ssrf",
  PromptInjection = "prompt-injection",
  // Network flows.
  PortScan = "port-scan",
  NetworkSweep = "network-sweep",
  ThreatIntelTraffic = "threat-intel-traffic",
  LargeOutboundTransfer = "large-outbound-transfer",
  // OneUptime's own audit log.
  ApiKeyCreated = "api-key-created",
  ApiKeyDeleted = "api-key-deleted",
  RoleChanged = "role-changed",
  TeamChanged = "team-changed",
  McpClientAuthorized = "mcp-client-authorized",
  PacketCaptureDownloaded = "packet-capture-downloaded",
  SecurityControlChanged = "security-control-changed",
  MassDelete = "mass-delete",
  // Session replay.
  UserInTwoCountries = "user-in-two-countries",
}

export const SECURITY_TELEMETRY_SIGNALS: ReadonlyArray<SecurityTelemetrySignal> =
  Object.values(SecurityTelemetrySignal);

// Which source finds each signal.
export const SECURITY_TELEMETRY_SIGNAL_SOURCES: Record<
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind
> = {
  [SecurityTelemetrySignal.WebAttack]: SecurityTelemetrySourceKind.Traces,
  [SecurityTelemetrySignal.ServerSideRequestForgery]:
    SecurityTelemetrySourceKind.Traces,
  [SecurityTelemetrySignal.PromptInjection]: SecurityTelemetrySourceKind.Traces,
  [SecurityTelemetrySignal.PortScan]: SecurityTelemetrySourceKind.NetworkFlows,
  [SecurityTelemetrySignal.NetworkSweep]:
    SecurityTelemetrySourceKind.NetworkFlows,
  [SecurityTelemetrySignal.ThreatIntelTraffic]:
    SecurityTelemetrySourceKind.NetworkFlows,
  [SecurityTelemetrySignal.LargeOutboundTransfer]:
    SecurityTelemetrySourceKind.NetworkFlows,
  [SecurityTelemetrySignal.ApiKeyCreated]: SecurityTelemetrySourceKind.AuditLog,
  [SecurityTelemetrySignal.ApiKeyDeleted]: SecurityTelemetrySourceKind.AuditLog,
  [SecurityTelemetrySignal.RoleChanged]: SecurityTelemetrySourceKind.AuditLog,
  [SecurityTelemetrySignal.TeamChanged]: SecurityTelemetrySourceKind.AuditLog,
  [SecurityTelemetrySignal.McpClientAuthorized]:
    SecurityTelemetrySourceKind.AuditLog,
  [SecurityTelemetrySignal.PacketCaptureDownloaded]:
    SecurityTelemetrySourceKind.AuditLog,
  [SecurityTelemetrySignal.SecurityControlChanged]:
    SecurityTelemetrySourceKind.AuditLog,
  [SecurityTelemetrySignal.MassDelete]: SecurityTelemetrySourceKind.AuditLog,
  [SecurityTelemetrySignal.UserInTwoCountries]:
    SecurityTelemetrySourceKind.RumSessions,
};

export function isSecurityTelemetrySignal(
  value: unknown,
): value is SecurityTelemetrySignal {
  return (
    typeof value === "string" &&
    (SECURITY_TELEMETRY_SIGNALS as ReadonlyArray<string>).includes(value)
  );
}
