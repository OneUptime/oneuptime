import { generateKeyPairSync } from "crypto";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  GoogleSecOpsListBasis,
  SearchDetectionsResult,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import {
  ConnectorFetchOptions,
  SecurityConnectorSettings,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

/*
 * Shared fixtures for the GoogleSecOpsConnector suites. Not a suite itself
 * (jest only runs *.test.ts): settings that pass every save-time rule, a
 * scripted GoogleSecOpsClient double injected through the connector's
 * client factory, and the response builders the passes read.
 *
 * The key is a real RS256 key because validateSettings, and therefore every
 * fetch and test, parses the PEM before anything is contacted.
 */

const keyPair: { publicKey: string; privateKey: string } = generateKeyPairSync(
  "rsa",
  {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  },
);

export const PRIVATE_KEY: string = keyPair.privateKey;
export const PUBLIC_KEY: string = keyPair.publicKey;
export const TOKEN_URI: string = "https://oauth2.googleapis.com/token";
export const SERVICE_ACCOUNT_EMAIL: string =
  "poller@example.iam.gserviceaccount.com";
export const INSTANCE: string =
  "projects/test-project/locations/us/instances/test-instance";
export const API_BASE: string = `https://us-chronicle.googleapis.com/v1alpha/${INSTANCE}`;

export const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: SERVICE_ACCOUNT_EMAIL,
  private_key: PRIVATE_KEY,
  token_uri: TOKEN_URI,
});

export function secOpsSettings(
  overrides: {
    config?: JSONObject | undefined;
    secrets?: JSONObject | undefined;
    provider?: SecurityEventConnectorProvider | undefined;
    alertingOnly?: boolean | undefined;
  } = {},
): SecurityConnectorSettings {
  return {
    provider: overrides.provider || SecurityEventConnectorProvider.GoogleSecOps,
    config: {
      region: "us",
      instanceResourceName: INSTANCE,
      ...(overrides.config || {}),
    },
    secrets: {
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      ...(overrides.secrets || {}),
    },
    alertingOnly:
      overrides.alertingOnly === undefined ? true : overrides.alertingOnly,
  };
}

// The bounds the poller hands the connector once its fetchBudget is merged.
export function fetchOptions(
  overrides: Partial<ConnectorFetchOptions> = {},
): ConnectorFetchOptions {
  return {
    maxRequests: 36,
    maxEvents: 36000,
    requestTimeoutInMs: 60000,
    sampleLimit: 25,
    purpose: "poll",
    maxDurationMs: 4 * 60 * 1000,
    pollIntervalInMinutes: 5,
    ...overrides,
  };
}

export function page(
  detections: Array<JSONObject>,
  changes: Partial<SearchDetectionsResult> = {},
): SearchDetectionsResult {
  return { detections, nextPageToken: null, truncated: false, ...changes };
}

export function fetched(
  alerts: Array<JSONObject>,
  changes: Partial<FetchAlertsResult> = {},
): FetchAlertsResult {
  return {
    alerts,
    complete: true,
    progress: 1,
    truncatedByCount: false,
    truncatedByBytes: false,
    baselineAlertsCount: alerts.length,
    filteredAlertsCount: alerts.length,
    chunkCount: 1,
    ...changes,
  };
}

export function detection(id: string, changes: JSONObject = {}): JSONObject {
  return {
    id,
    type: "RULE_DETECTION",
    detectionTime: "2026-09-14T11:00:00.000Z",
    createdTime: "2026-09-14T11:02:00.000Z",
    detection: [
      { ruleName: `Rule for ${id}`, alertState: "ALERTING", severity: "HIGH" },
    ],
    ...changes,
  };
}

/*
 * A Collection whose detection entry throws when read: the normalizer is
 * tolerant by design, so a hostile getter is the only way to make it fail.
 */
export function poisonDetection(id: string): JSONObject {
  const poison: JSONObject = { id };
  Object.defineProperty(poison, "detection", {
    get: (): never => {
      throw new Error("poison");
    },
    enumerable: true,
  });
  return poison;
}

export interface SearchCall {
  startTime: Date;
  endTime: Date;
  listBasis: GoogleSecOpsListBasis;
  alertingOnly: boolean;
  pageSize?: number | undefined;
  pageToken?: string | undefined;
  curated?: boolean | undefined;
}

export interface AlertsCall {
  startTime: Date;
  endTime: Date;
  maxAlerts?: number | undefined;
  includeNonAlertingDetections?: boolean | undefined;
}

export type SearchAnswer =
  | SearchDetectionsResult
  | Error
  | ((call: SearchCall) => SearchDetectionsResult);

export type AlertsAnswer =
  | FetchAlertsResult
  | Error
  | ((call: AlertsCall) => FetchAlertsResult);

export interface FakeClient {
  client: GoogleSecOpsClient;
  searchCalls: Array<SearchCall>;
  alertsCalls: Array<AlertsCall>;
}

/*
 * Answers are queued per (curated, basis) pair so a test can script the
 * rule pass and the curated pass independently; each queue repeats its
 * last entry, so one entry means "answer this way every time".
 */
export function makeFakeClient(data: {
  rule?: Array<SearchAnswer> | undefined;
  curated?: Array<SearchAnswer> | undefined;
  alerts?: Array<AlertsAnswer> | undefined;
}): FakeClient {
  const searchCalls: Array<SearchCall> = [];
  const alertsCalls: Array<AlertsCall> = [];
  const indexes: Map<string, number> = new Map<string, number>();
  let alertsIndex: number = 0;

  const client: GoogleSecOpsClient = {
    testAuthentication: async (): Promise<void> => {},
    searchDetections: async (
      call: SearchCall,
    ): Promise<SearchDetectionsResult> => {
      searchCalls.push(call);
      const queue: Array<SearchAnswer> = (call.curated
        ? data.curated
        : data.rule) || [page([])];
      const key: string = `${call.curated ? "curated" : "rule"}:${call.listBasis}`;
      const index: number = indexes.get(key) || 0;
      indexes.set(key, index + 1);
      const answer: SearchAnswer = queue[
        Math.min(index, queue.length - 1)
      ] as SearchAnswer;

      if (answer instanceof Error) {
        throw answer;
      }

      return typeof answer === "function" ? answer(call) : answer;
    },
    fetchDetectionAlerts: async (
      call: AlertsCall,
    ): Promise<FetchAlertsResult> => {
      alertsCalls.push(call);
      const queue: Array<AlertsAnswer> = data.alerts || [fetched([])];
      const answer: AlertsAnswer = queue[
        Math.min(alertsIndex++, queue.length - 1)
      ] as AlertsAnswer;

      if (answer instanceof Error) {
        throw answer;
      }

      return typeof answer === "function" ? answer(call) : answer;
    },
  } as unknown as GoogleSecOpsClient;

  return { client, searchCalls, alertsCalls };
}

export interface ClientFactoryCall {
  region: string;
  instanceResourceName: string;
  serviceAccountJson: string;
  requestTimeoutInMs: number;
}

export interface ConnectorHarness {
  connector: GoogleSecOpsConnector;
  factoryCalls: Array<ClientFactoryCall>;
}

// A connector whose every call is served by the given client double.
export function connectorWith(client: GoogleSecOpsClient): ConnectorHarness {
  const factoryCalls: Array<ClientFactoryCall> = [];
  const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
    undefined,
    (call: ClientFactoryCall): GoogleSecOpsClient => {
      factoryCalls.push(call);
      return client;
    },
  );

  return { connector, factoryCalls };
}

export function checkByKey(
  checks: Array<SecurityConnectorCheck> | undefined,
  key: string,
): SecurityConnectorCheck {
  const check: SecurityConnectorCheck | undefined = (checks || []).find(
    (candidate: SecurityConnectorCheck): boolean => {
      return candidate.key === key;
    },
  );

  if (!check) {
    throw new Error(`Missing check ${key}`);
  }

  return check;
}

export function statusesOf(
  checks: Array<SecurityConnectorCheck> | undefined,
): Array<string> {
  return (checks || []).map((check: SecurityConnectorCheck): string => {
    return `${check.key}:${check.status}`;
  });
}

// The rejection a promise settles with; fails the test when it resolves.
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject.");
}
