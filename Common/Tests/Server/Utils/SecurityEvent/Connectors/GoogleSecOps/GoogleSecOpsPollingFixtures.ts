import SecurityEventConnection from "../../../../../../Models/DatabaseModels/SecurityEventConnection";
import Semaphore from "../../../../../../Server/Infrastructure/Semaphore";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventConnectionService from "../../../../../../Server/Services/SecurityEventConnectionService";
import SecurityEventService from "../../../../../../Server/Services/SecurityEventService";
import logger from "../../../../../../Server/Utils/Logger";
import {
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import { PollerOverrides } from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import { SecurityConnectorSettings } from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import SecurityEventDedupe from "../../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import ThreatIntelEnricher from "../../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import { JSONObject } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { SecurityEventConnectionRunResult } from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import ServiceType from "../../../../../../Types/Telemetry/ServiceType";
import { getJestSpyOn } from "../../../../../Spy";
import { expect } from "@jest/globals";
import {
  INSTANCE,
  SERVICE_ACCOUNT_JSON,
  TOKEN_URI,
  secOpsSettings,
} from "./GoogleSecOpsConnectorFixtures";

/*
 * Shared fixtures for the suites that drive the REAL
 * SecurityEventConnectionPoller with the REAL GoogleSecOpsConnector and its
 * real GoogleSecOpsClient. Not a suite itself (jest only runs *.test.ts).
 *
 * Only the transport is fake: GoogleSecOpsTenant is a FetchLike that answers
 * the token exchange and the three Chronicle routes the way Google documents
 * them - the detection searches filter on created OR detection time with an
 * inclusive start and exclusive end and page newest first; the alerts view
 * filters on detection time, returns at most maxReturnedAlerts inside the
 * streaming chunk envelope and reports how many matched. So request
 * serialization, response parsing, the three passes, their budgets and the
 * poller's cursor rules all run for real, and a test reads what was asked of
 * Google straight off the recorded URLs.
 *
 * Persistence and infrastructure are stubbed exactly where the retired
 * Google SecOps poller suites stubbed them: the source lock, the duplicate
 * lookup, the telemetry service, threat-intel enrichment, the ClickHouse
 * insert and the connection row write.
 */

export const MINUTE_MS: number = 60 * 1000;
export const HOUR_MS: number = 60 * MINUTE_MS;
export const DAY_MS: number = 24 * HOUR_MS;

export const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
export const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

export const API_ORIGIN: string = "https://us-chronicle.googleapis.com";
export const SEARCH_PATH: string = `/v1alpha/${INSTANCE}/legacy:legacySearchDetections`;
export const CURATED_PATH: string = `/v1alpha/${INSTANCE}/legacy:legacySearchCuratedDetections`;
export const ALERTS_PATH: string = `/v1alpha/${INSTANCE}/legacy:legacyFetchAlertsView`;
export const TENANT_ACCESS_TOKEN: string = "tenant-access-token";

export type TenantRoute = "token" | "search" | "curated" | "alerts" | "unknown";

export interface TenantRequest {
  route: TenantRoute;
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface TenantReply {
  status: number;
  body: string;
}

/*
 * A scripted answer for one route: a reply, an Error to reject the transport
 * with (a socket that hung up), or undefined to let the simulated tenant
 * answer as usual.
 */
export type TenantScript = (
  request: TenantRequest,
) => TenantReply | Error | undefined;

export interface TenantDetection {
  id: string;
  createdMs: number;
  detectionMs: number;
  // False for a rule match that did not generate an alert. Default true.
  alerting?: boolean | undefined;
  // Served by the curated route instead of the rule route.
  curated?: boolean | undefined;
  // The raw Collection to serve instead of the generated one.
  record?: JSONObject | undefined;
}

function inRange(timeMs: number, startMs: number, endMs: number): boolean {
  return timeMs >= startMs && timeMs < endMs;
}

export class GoogleSecOpsTenant {
  public detections: Array<TenantDetection> = [];
  /*
   * Google may return fewer detections than the pageSize asked for. A small
   * page keeps the volume needed to overflow the 20 page budget small.
   */
  public searchPageSize: number = 1000;
  public requests: Array<TenantRequest> = [];
  public scripts: Partial<Record<TenantRoute, TenantScript>> = {};

  public readonly fetch: FetchLike = async (
    url: string,
    init: FetchInitLike,
  ): Promise<FetchResponseLike> => {
    const parsed: URL = new URL(url);
    const request: TenantRequest = {
      route: GoogleSecOpsTenant.routeOf(url, parsed),
      url: parsed,
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    this.requests.push(request);

    const script: TenantScript | undefined = this.scripts[request.route];
    const scripted: TenantReply | Error | undefined = script
      ? script(request)
      : undefined;

    if (scripted instanceof Error) {
      throw scripted;
    }

    const reply: TenantReply = scripted || this.answer(request);

    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async (): Promise<string> => {
        return reply.body;
      },
    };
  };

  // A connector whose client sends every request to this tenant.
  public connector(): GoogleSecOpsConnector {
    return new GoogleSecOpsConnector(this.fetch);
  }

  public overrides(
    settings: SecurityConnectorSettings = secOpsSettings(),
  ): PollerOverrides {
    return { connector: this.connector(), settings };
  }

  public requestsTo(route: TenantRoute): Array<TenantRequest> {
    return this.requests.filter((request: TenantRequest): boolean => {
      return request.route === route;
    });
  }

  public add(detection: TenantDetection): void {
    this.detections.push(detection);
  }

  private static routeOf(url: string, parsed: URL): TenantRoute {
    if (url === TOKEN_URI) {
      return "token";
    }

    if (parsed.origin !== API_ORIGIN) {
      return "unknown";
    }

    if (parsed.pathname === SEARCH_PATH) {
      return "search";
    }

    if (parsed.pathname === CURATED_PATH) {
      return "curated";
    }

    if (parsed.pathname === ALERTS_PATH) {
      return "alerts";
    }

    return "unknown";
  }

  private answer(request: TenantRequest): TenantReply {
    if (request.route === "token") {
      return {
        status: 200,
        body: JSON.stringify({
          access_token: TENANT_ACCESS_TOKEN,
          expires_in: 3600,
        }),
      };
    }

    if (request.route === "unknown") {
      return { status: 404, body: "" };
    }

    if (request.headers["Authorization"] !== `Bearer ${TENANT_ACCESS_TOKEN}`) {
      return { status: 401, body: "Bearer token required" };
    }

    if (request.route === "alerts") {
      return this.alertsReply(request.url.searchParams);
    }

    return this.searchReply(
      request.url.searchParams,
      request.route === "curated",
    );
  }

  private searchReply(params: URLSearchParams, curated: boolean): TenantReply {
    const startMs: number = Date.parse(params.get("startTime") || "");
    const endMs: number = Date.parse(params.get("endTime") || "");
    const byDetectionTime: boolean =
      params.get("listBasis") === "DETECTION_TIME";
    const alertingOnly: boolean = params.get("alertState") === "ALERTING";
    const pageSize: number = Math.min(
      Number(params.get("pageSize")) || 1000,
      this.searchPageSize,
    );
    const offset: number = Number(params.get("pageToken") || "0");
    const timeOf: (item: TenantDetection) => number = (
      item: TenantDetection,
    ): number => {
      return byDetectionTime ? item.detectionMs : item.createdMs;
    };

    const matched: Array<TenantDetection> = this.detections
      .filter((item: TenantDetection): boolean => {
        return (
          Boolean(item.curated) === curated &&
          (!alertingOnly || item.alerting !== false) &&
          inRange(timeOf(item), startMs, endMs)
        );
      })
      .sort((a: TenantDetection, b: TenantDetection): number => {
        return timeOf(b) - timeOf(a);
      });
    const pageItems: Array<TenantDetection> = matched.slice(
      offset,
      offset + pageSize,
    );
    const next: number = offset + pageSize;
    // proto3 omits empty fields, so a quiet page is a bare {}.
    const body: JSONObject = {};

    if (pageItems.length > 0) {
      body[curated ? "curatedDetections" : "detections"] =
        pageItems.map(collectionOf);
    }

    if (next < matched.length) {
      body["nextPageToken"] = String(next);
    }

    return { status: 200, body: JSON.stringify(body) };
  }

  private alertsReply(params: URLSearchParams): TenantReply {
    const startMs: number = Date.parse(params.get("timeRange.startTime") || "");
    const endMs: number = Date.parse(params.get("timeRange.endTime") || "");
    const includeNonAlerting: boolean =
      params.get("includeNonAlertingDetections") ===
      "ALERTS_FEATURE_PREFERENCE_ENABLED";
    const maxAlerts: number =
      Number(params.get("alertListOptions.maxReturnedAlerts")) || 1000;

    const matched: Array<TenantDetection> = this.detections
      .filter((item: TenantDetection): boolean => {
        return (
          (includeNonAlerting || item.alerting !== false) &&
          inRange(item.detectionMs, startMs, endMs)
        );
      })
      .sort((a: TenantDetection, b: TenantDetection): number => {
        return b.detectionMs - a.detectionMs;
      });
    const returned: Array<TenantDetection> = matched.slice(0, maxAlerts);

    return streamReply([
      {
        ...(returned.length > 0
          ? { alerts: { alerts: returned.map(collectionOf) } }
          : {}),
        progress: 1,
        complete: true,
        baselineAlertsCount: matched.length,
        filteredAlertsCount: matched.length,
      },
    ]);
  }
}

export function collectionOf(item: TenantDetection): JSONObject {
  if (item.record) {
    return item.record;
  }

  return {
    id: item.id,
    type: "RULE_DETECTION",
    detectionTime: new Date(item.detectionMs).toISOString(),
    createdTime: new Date(item.createdMs).toISOString(),
    detection: [
      {
        ruleName: `Rule for ${item.id}`,
        alertState: item.alerting === false ? "NOT_ALERTING" : "ALERTING",
        severity: "HIGH",
      },
    ],
  };
}

// A 200 carrying the alerts view's streaming envelope.
export function streamReply(chunks: Array<JSONObject>): TenantReply {
  return { status: 200, body: JSON.stringify(chunks) };
}

// A Google error the way Chronicle answers one.
export function googleError(
  status: number,
  googleStatus: string,
  message: string,
): TenantReply {
  return {
    status,
    body: JSON.stringify({
      error: { code: status, status: googleStatus, message },
    }),
  };
}

export function secOpsConnection(
  overrides: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID.toString();
  connection.projectId = PROJECT_ID;
  connection.name = "Google SecOps production";
  connection.provider = SecurityEventConnectorProvider.GoogleSecOps;
  connection.config = { region: "us", instanceResourceName: INSTANCE };
  connection.secrets = JSON.stringify({
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
  });
  connection.alertingOnly = true;
  connection.pollIntervalInMinutes = 5;
  connection.isEnabled = true;
  Object.assign(connection, overrides);
  return connection;
}

export function makeServiceMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: "Google SecOps",
    primaryEntityId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

export interface ConnectionUpdate {
  id: ObjectID;
  data: JSONObject;
}

export interface DedupeLookup {
  projectId: ObjectID;
  vendorName: string;
  productName: string;
  ids: Array<string>;
}

export interface CapturedLogs {
  info: Array<string>;
  warn: Array<string>;
  error: Array<string>;
  debug: Array<string>;
}

export interface PollPersistence {
  updates: Array<ConnectionUpdate>;
  insertedBatches: Array<Array<JSONObject>>;
  insertOptions: Array<JSONObject>;
  // Event uids "in ClickHouse": what earlier inserts in this test wrote.
  stored: Set<string>;
  dedupeLookups: Array<DedupeLookup>;
  logs: CapturedLogs;
}

function textOf(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }

  if (body instanceof Error) {
    return body.message;
  }

  return String(body);
}

/*
 * Every write a poll would perform, captured instead of performed, with the
 * duplicate lookup answering from what earlier inserts stored, as ClickHouse
 * would. Called per test (from beforeEach) so no two tests share a spy.
 */
export function stubPollPersistence(): PollPersistence {
  const persistence: PollPersistence = {
    updates: [],
    insertedBatches: [],
    insertOptions: [],
    stored: new Set<string>(),
    dedupeLookups: [],
    logs: { info: [], warn: [], error: [], debug: [] },
  };

  getJestSpyOn(Semaphore, "lock").mockResolvedValue({} as never);
  getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  getJestSpyOn(SecurityEventDedupe, "findExistingEventUids").mockImplementation(
    ((data: DedupeLookup): Promise<Set<string>> => {
      persistence.dedupeLookups.push(data);
      return Promise.resolve(
        new Set<string>(
          data.ids.filter((id: string): boolean => {
            return persistence.stored.has(id);
          }),
        ),
      );
    }) as never,
  );
  getJestSpyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue(
    makeServiceMetadata() as never,
  );
  /*
   * Enrichment reaches ClickHouse for its per-project indicator probe, so
   * leaving it live would make every test depend on a database being absent
   * in exactly the right way.
   */
  getJestSpyOn(ThreatIntelEnricher, "enrichNormalizedEvents").mockResolvedValue(
    { eventsMatched: 0, valuesLookedUp: 0 } as never,
  );
  getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
    rows: Array<JSONObject>,
    options: JSONObject,
  ): Promise<void> => {
    persistence.insertedBatches.push(rows);
    persistence.insertOptions.push(options);

    for (const row of rows) {
      persistence.stored.add(String(row["eventUid"]));
    }

    return Promise.resolve();
  }) as never);
  getJestSpyOn(
    SecurityEventConnectionService,
    "updateOneById",
  ).mockImplementation(((call: ConnectionUpdate): Promise<void> => {
    persistence.updates.push(call);
    return Promise.resolve();
  }) as never);

  for (const level of ["info", "warn", "error", "debug"] as Array<
    keyof CapturedLogs
  >) {
    getJestSpyOn(logger, level).mockImplementation(((body: unknown): void => {
      persistence.logs[level].push(textOf(body));
    }) as never);
  }

  return persistence;
}

export function lastUpdate(persistence: PollPersistence): JSONObject {
  expect(persistence.updates.length).toBeGreaterThan(0);
  return persistence.updates[persistence.updates.length - 1]!.data;
}

export function storedResult(
  update: JSONObject,
): SecurityEventConnectionRunResult {
  return update[
    "lastPollResult"
  ] as unknown as SecurityEventConnectionRunResult;
}

export function findCheck(
  checks: Array<SecurityConnectorCheck>,
  key: string,
): SecurityConnectorCheck {
  const found: SecurityConnectorCheck | undefined = checks.find(
    (candidate: SecurityConnectorCheck): boolean => {
      return candidate.key === key;
    },
  );
  expect({ key, found: found !== undefined }).toEqual({ key, found: true });
  return found!;
}

export function keysAndStatuses(
  checks: Array<SecurityConnectorCheck>,
): Array<string> {
  return checks.map((check: SecurityConnectorCheck): string => {
    return `${check.key}:${check.status}`;
  });
}

export function eventUidsOf(rows: Array<JSONObject>): Array<string> {
  return rows
    .map((row: JSONObject): string => {
      return String(row["eventUid"]);
    })
    .sort();
}

// The window one request asked Google for, read off its query string.
export function requestWindow(request: TenantRequest): {
  startTime: string;
  endTime: string;
} {
  const params: URLSearchParams = request.url.searchParams;

  if (request.route === "alerts") {
    return {
      startTime: params.get("timeRange.startTime") || "",
      endTime: params.get("timeRange.endTime") || "",
    };
  }

  return {
    startTime: params.get("startTime") || "",
    endTime: params.get("endTime") || "",
  };
}
