import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { SecurityTelemetrySourceKind } from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * "Your OneUptime data" on the Connections page, as data: one row per kind
 * of telemetry beyond logs, what it watches in a plain line, and what its
 * last check said. React-free, so the rows and the status lines are pinned
 * in a plain test (SecurityTelemetrySourcesModel.test.ts); the card draws
 * them (SecurityTelemetrySourcesCard.tsx).
 */

export const SECURITY_TELEMETRY_SOURCES_CARD_ID: string =
  "security-telemetry-sources";

export interface SecurityTelemetrySourceRow {
  kind: SecurityTelemetrySourceKind;
  // A translation key: what the source reads.
  title: string;
  // A translation key: what it finds there, in one line.
  description: string;
  icon: IconProp;
  // Only OneUptime Enterprise writes it (the audit log).
  needsEnterprise: boolean;
}

export const SECURITY_TELEMETRY_SOURCE_ROWS: ReadonlyArray<SecurityTelemetrySourceRow> =
  [
    {
      kind: SecurityTelemetrySourceKind.Traces,
      title: translationKey("Traces"),
      description: translationKey(
        "Attacks in the requests your apps answer, requests that reach for cloud credentials, and prompt injection on your LLM features.",
      ),
      icon: IconProp.Waterfall,
      needsEnterprise: false,
    },
    {
      kind: SecurityTelemetrySourceKind.NetworkFlows,
      title: translationKey("Network flows"),
      description: translationKey(
        "Port scans, network sweeps, traffic with known-bad addresses and large transfers out of your network.",
      ),
      icon: IconProp.Signal,
      needsEnterprise: false,
    },
    {
      kind: SecurityTelemetrySourceKind.AuditLog,
      title: translationKey("Audit log"),
      description: translationKey(
        "New API keys and MCP clients, changed roles and security controls, and mass deletes in OneUptime itself.",
      ),
      icon: IconProp.ClipboardDocumentList,
      needsEnterprise: true,
    },
    {
      kind: SecurityTelemetrySourceKind.RumSessions,
      title: translationKey("Session replays"),
      description: translationKey(
        "A signed-in user of your app seen in two countries within an hour.",
      ),
      icon: IconProp.Film,
      needsEnterprise: false,
    },
  ];

export const NEEDS_ENTERPRISE_NOTE: string = translationKey(
  "Available in OneUptime Enterprise, which keeps the audit log.",
);

// How many security events the last check found, by signal.
export function readFoundBySignal(
  result: JSONObject | undefined,
): Record<string, number> {
  const bySignal: JSONValue | undefined = result?.["bySignal"];
  const found: Record<string, number> = {};

  if (!bySignal || typeof bySignal !== "object" || Array.isArray(bySignal)) {
    return found;
  }

  for (const [signal, count] of Object.entries(bySignal as JSONObject)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      found[signal] = count;
    }
  }

  return found;
}

// How many security events the last check found in all.
export function readFoundInLastCheck(result: JSONObject | undefined): number {
  return Object.values(readFoundBySignal(result)).reduce(
    (total: number, count: number): number => {
      return total + count;
    },
    0,
  );
}

// What the card draws for one source's state.
export interface SecurityTelemetrySourceState {
  isOn: boolean;
  lastScannedAt?: Date | undefined;
  lastEventFoundAt?: Date | undefined;
  lastScanResult?: JSONObject | undefined;
  lastError?: string | undefined;
}

export enum SecurityTelemetrySourceStatusKind {
  // Off: nothing is said under it.
  Off = "off",
  // On, and not read yet.
  Waiting = "waiting",
  // On and read; the last check worked.
  Checked = "checked",
  // On, and the last check failed.
  Failed = "failed",
}

export interface SecurityTelemetrySourceStatus {
  kind: SecurityTelemetrySourceStatusKind;
  // When the source was last read, for "Checked {{time}}".
  checkedAt: Date | null;
  // When it last found something, for "Last found {{time}}".
  lastFoundAt: Date | null;
  // How many the last check found.
  foundInLastCheck: number;
  error: string;
}

// What to say under one source.
export function getSecurityTelemetrySourceStatus(
  state: SecurityTelemetrySourceState,
): SecurityTelemetrySourceStatus {
  const status: SecurityTelemetrySourceStatus = {
    kind: SecurityTelemetrySourceStatusKind.Off,
    checkedAt: state.lastScannedAt ? new Date(state.lastScannedAt) : null,
    lastFoundAt: state.lastEventFoundAt
      ? new Date(state.lastEventFoundAt)
      : null,
    foundInLastCheck: readFoundInLastCheck(state.lastScanResult),
    error: (state.lastError || "").trim(),
  };

  if (!state.isOn) {
    return status;
  }

  if (status.error) {
    status.kind = SecurityTelemetrySourceStatusKind.Failed;
  } else if (status.checkedAt) {
    status.kind = SecurityTelemetrySourceStatusKind.Checked;
  } else {
    status.kind = SecurityTelemetrySourceStatusKind.Waiting;
  }

  return status;
}

/*
 * Whether a row's switch can be used here: the audit log has nothing to
 * read where OneUptime is not Enterprise, so its switch stays off there and
 * says why - unless it was turned on before, so it can still be turned off.
 */
export function isSecurityTelemetrySourceAvailable(data: {
  row: SecurityTelemetrySourceRow;
  isEnterpriseEdition: boolean;
  isOn: boolean;
}): boolean {
  return !data.row.needsEnterprise || data.isEnterpriseEdition || data.isOn;
}
