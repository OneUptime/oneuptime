import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";

/*
 * The contract every managed security source implements.
 *
 * A connector is stateless: every call receives the decrypted settings and
 * opens its own HTTP session, so one instance is shared across requests
 * and across tenants. The poller, the tester and the API only ever talk
 * to this interface — a provider is a client, a normalizer and one class
 * implementing this, nothing else.
 *
 * Time basis is the whole design: fetchEvents lists records by the time
 * the SOURCE CREATED them, never by the time of the underlying activity.
 * A SIEM rule that runs hourly creates a detection long after the events
 * it matched; polling by event time with a forward-moving cursor skips
 * every such record, which is the bug this framework exists to avoid.
 */

/*
 * Decrypted, server-only settings for one connection. `config` holds the
 * catalog's non-secret keys, `secrets` its secret keys. Never serialize
 * this object into a response or a log line.
 */
export interface SecurityConnectorSettings {
  provider: SecurityEventConnectorProvider;
  config: JSONObject;
  secrets: JSONObject;
  alertingOnly: boolean;
}

/*
 * The transport every connector client sends requests through. It is the
 * SSRF-guarded DataSourceHttpFetch in production and a fixture in tests.
 */
export type ConnectorTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface ConnectorFetchWindow {
  // Inclusive lower bound on the source's creation time.
  startTime: Date;
  // Exclusive upper bound on the source's creation time.
  endTime: Date;
}

export interface ConnectorFetchOptions {
  // Upper bound on outbound requests for this fetch, pagination included.
  maxRequests: number;
  // Upper bound on records collected before the connector must stop.
  maxEvents: number;
  requestTimeoutInMs: number;
  // How many samples to return for diagnostics.
  sampleLimit: number;
}

export interface ConnectorFetchResult {
  events: Array<NormalizedSecurityEvent>;
  // Records returned by the source before normalization.
  fetchedCount: number;
  // Records the normalizer did not recognize.
  rejectedCount: number;
  // Records that threw during normalization.
  failedCount: number;
  /*
   * False when a bound (requests, events) or a partial source response
   * left part of the window unread. The poller holds its cursor.
   */
  complete: boolean;
  requestCount: number;
  warnings: Array<string>;
  samples: Array<SecurityConnectorSample>;
}

export interface ConnectorTestOptions {
  requestTimeoutInMs: number;
}

export interface SecurityEventConnector {
  provider: SecurityEventConnectorProvider;

  /*
   * Synchronous shape validation of config and secrets beyond what the
   * catalog's required flags express (URL syntax, enum values, identifier
   * formats). Throws BadDataException with a message the person filling
   * the form can act on.
   */
  validateSettings(settings: SecurityConnectorSettings): void;

  /*
   * Provider-side checks only: authentication, a one-record read over the
   * last day, and how many records the source created in the last 24
   * hours and 7 days. Platform checks (workers, scheduler, storage) are
   * added by the shared tester. Never throws — failures are checks with
   * status "fail".
   */
  testConnection(
    settings: SecurityConnectorSettings,
    options: ConnectorTestOptions,
  ): Promise<Array<SecurityConnectorCheck>>;

  /*
   * List records created in the window and normalize them. Must paginate
   * and respect every bound in options; must throw for transport,
   * authentication and permission failures (the poller records them as a
   * failed run and holds the cursor).
   */
  fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult>;
}

/*
 * Small helpers shared by connectors so their checks read alike.
 */
export function readSettingString(source: JSONObject, key: string): string {
  const value: unknown = source[key];

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function readSettingBoolean(
  source: JSONObject,
  key: string,
  fallback: boolean,
): boolean {
  const value: unknown = source[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

export function makeCheck(data: {
  key: string;
  name: string;
  status: SecurityConnectorCheck["status"];
  startedAtMs: number;
  message: string;
  remediation?: string | undefined;
  details?: JSONObject | undefined;
}): SecurityConnectorCheck {
  return {
    key: data.key,
    name: data.name,
    status: data.status,
    durationMs: Math.max(0, Date.now() - data.startedAtMs),
    message: data.message,
    ...(data.remediation ? { remediation: data.remediation } : {}),
    ...(data.details ? { details: data.details } : {}),
  };
}
