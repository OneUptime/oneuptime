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
 *   session replay  one signed-in user in two countries within the hour.
 *
 * One switch per kind per project (SecurityTelemetrySource), read every
 * minute by Server/Utils/SecurityEvent/TelemetryScan. Every event a kind
 * finds is attributed to the kind's own "OneUptime ..." service and carries
 * the vendor "OneUptime" and the kind's product, which is how the rule
 * library tells the project sends it (DetectionRuleDataKind).
 */
export enum SecurityTelemetrySourceKind {
  Traces = "traces",
  NetworkFlows = "network-flows",
  AuditLog = "audit-log",
  RumSessions = "rum-sessions",
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
