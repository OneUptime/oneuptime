import { BASE_URL, env } from "../../../Config";
import ObjectID from "Common/Types/ObjectID";

const EXCEPTION_TABLE_NAME: string = "ExceptionItemV3";
const EXCEPTION_STORAGE_TABLE_NAME: string = "ExceptionItemV3Local";
const DEFAULT_CLICKHOUSE_DATABASE: string = "oneuptime";
const LOCAL_CLICKHOUSE_HTTP_PORT: string = "8189";
const IDENTIFIER_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ExceptionOccurrenceFixtureData {
  projectId: string;
  primaryEntityId: string;
  primaryEntityType: string;
  time: Date;
  exceptionType: string;
  stackTrace: string;
  message: string;
  spanStatusCode: number;
  escaped: boolean;
  traceId: string;
  spanId: string;
  sessionId: string;
  fingerprint: string;
  spanName: string;
  release: string;
  environment: string;
  attributes: Record<string, string>;
  entityKeys: Array<string>;
}

export interface ClickHouseFixtureLocation {
  database: string;
  endpoint: globalThis.URL;
}

export interface ClickHouseFixtureLocationInput {
  database: string;
  explicitUrl: string;
  configuredHost: string;
  browserTarget: string;
  explicitPort: string;
  configuredPort: string;
  isHttps: boolean;
}

const requireIdentifier: (value: string, description: string) => string = (
  value: string,
  description: string,
): string => {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ClickHouse ${description}: ${value}`);
  }

  return value;
};

const requireUuid: (value: string, description: string) => string = (
  value: string,
  description: string,
): string => {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Invalid ${description}: ${value}`);
  }

  return value;
};

/*
 * config.env uses the Compose-network address clickhouse:8123, while E2E runs
 * from the host when HOST=localhost. Resolve only that known local pairing to
 * Docker's published HTTP port. CI or custom environments can state their
 * endpoint explicitly with E2E_CLICKHOUSE_URL (or the host/port overrides).
 */
export const resolveClickHouseFixtureLocation: (
  data: ClickHouseFixtureLocationInput,
) => ClickHouseFixtureLocation = (
  data: ClickHouseFixtureLocationInput,
): ClickHouseFixtureLocation => {
  const database: string = requireIdentifier(data.database, "database");
  const explicitUrl: string = data.explicitUrl.trim();

  if (explicitUrl) {
    const endpoint: globalThis.URL = new globalThis.URL(explicitUrl);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error("E2E_CLICKHOUSE_URL must use http or https.");
    }
    return { database, endpoint };
  }

  const browserTarget: globalThis.URL = new globalThis.URL(data.browserTarget);
  const browserRunsOnLocalhost: boolean = [
    "localhost",
    "127.0.0.1",
    "::1",
  ].includes(browserTarget.hostname);
  const composeNetworkHost: boolean = data.configuredHost === "clickhouse";
  const usePublishedLocalPort: boolean =
    browserRunsOnLocalhost && composeNetworkHost;
  const host: string = usePublishedLocalPort
    ? "127.0.0.1"
    : data.configuredHost;
  const port: string =
    data.explicitPort ||
    (usePublishedLocalPort
      ? LOCAL_CLICKHOUSE_HTTP_PORT
      : data.configuredPort || "8123");
  const protocol: string = data.isHttps ? "https" : "http";

  return {
    database,
    endpoint: new globalThis.URL(`${protocol}://${host}:${port}`),
  };
};

const clickHouseFixtureLocation: () => ClickHouseFixtureLocation =
  (): ClickHouseFixtureLocation => {
    return resolveClickHouseFixtureLocation({
      database:
        env("E2E_CLICKHOUSE_DATABASE") ||
        env("CLICKHOUSE_DATABASE") ||
        DEFAULT_CLICKHOUSE_DATABASE,
      explicitUrl: env("E2E_CLICKHOUSE_URL"),
      configuredHost:
        env("E2E_CLICKHOUSE_HOST") || env("CLICKHOUSE_HOST") || "127.0.0.1",
      browserTarget: BASE_URL.toString(),
      explicitPort: env("E2E_CLICKHOUSE_PORT"),
      configuredPort: env("CLICKHOUSE_PORT"),
      isHttps: env("CLICKHOUSE_IS_HOST_HTTPS") === "true",
    });
  };

const executeClickHouseRequest: (data: {
  query: string;
  queryParameters?: Record<string, string> | undefined;
  settings?: Record<string, string> | undefined;
  body?: string | undefined;
}) => Promise<void> = async (data: {
  query: string;
  queryParameters?: Record<string, string> | undefined;
  settings?: Record<string, string> | undefined;
  body?: string | undefined;
}): Promise<void> => {
  const location: ClickHouseFixtureLocation = clickHouseFixtureLocation();
  const endpoint: globalThis.URL = new globalThis.URL(
    location.endpoint.toString(),
  );
  endpoint.searchParams.set("database", location.database);
  endpoint.searchParams.set("query", data.query);
  endpoint.searchParams.set("date_time_input_format", "best_effort");

  for (const [key, value] of Object.entries(data.queryParameters || {})) {
    endpoint.searchParams.set(`param_${key}`, value);
  }
  for (const [key, value] of Object.entries(data.settings || {})) {
    endpoint.searchParams.set(key, value);
  }

  const username: string = env("CLICKHOUSE_USER") || "default";
  const password: string = env("CLICKHOUSE_PASSWORD") || "";
  const authorization: string = Buffer.from(`${username}:${password}`).toString(
    "base64",
  );
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-ndjson",
    },
  };
  if (data.body !== undefined) {
    requestInit.body = data.body;
  }
  const response: globalThis.Response = await fetch(endpoint, requestInit);

  if (!response.ok) {
    throw new Error(
      `ClickHouse exception fixture request failed (${response.status}): ${await response.text()}`,
    );
  }
};

export const insertExceptionOccurrenceFixture: (
  data: ExceptionOccurrenceFixtureData,
) => Promise<string> = async (
  data: ExceptionOccurrenceFixtureData,
): Promise<string> => {
  requireUuid(data.projectId, "fixture project id");
  requireUuid(data.primaryEntityId, "fixture primary entity id");

  const location: ClickHouseFixtureLocation = clickHouseFixtureLocation();
  const id: string = ObjectID.generateTimeOrdered().toString();
  const attributeKeys: Array<string> = Object.keys(data.attributes);
  const retentionDate: Date = new Date(
    data.time.getTime() + 7 * 24 * 60 * 60 * 1000,
  );
  const row: Record<string, unknown> = {
    projectId: data.projectId,
    primaryEntityId: data.primaryEntityId,
    primaryEntityType: data.primaryEntityType,
    time: data.time.toISOString(),
    timeUnixNano: (BigInt(data.time.getTime()) * BigInt(1_000_000)).toString(),
    exceptionType: data.exceptionType,
    stackTrace: data.stackTrace,
    message: data.message,
    spanStatusCode: data.spanStatusCode,
    escaped: data.escaped,
    traceId: data.traceId,
    spanId: data.spanId,
    fingerprint: data.fingerprint,
    spanName: data.spanName,
    release: data.release,
    environment: data.environment,
    parsedFrames: null,
    attributes: data.attributes,
    attributeKeys,
    entityKeys: data.entityKeys,
    serviceEntityKey: "",
    hostEntityKey: "",
    k8sPodEntityKey: "",
    k8sNodeEntityKey: "",
    k8sClusterEntityKey: "",
    containerEntityKey: "",
    retentionDate: retentionDate.toISOString(),
    _id: id,
    createdAt: data.time.toISOString(),
    sessionId: data.sessionId,
  };

  await executeClickHouseRequest({
    query: `INSERT INTO ${location.database}.${EXCEPTION_TABLE_NAME} FORMAT JSONEachRow`,
    settings: {
      async_insert: "0",
      insert_distributed_sync: "1",
      wait_for_async_insert: "1",
    },
    body: `${JSON.stringify(row)}\n`,
  });

  return id;
};

export const deleteExceptionOccurrenceFixture: (data: {
  projectId: string;
  occurrenceId: string;
}) => Promise<void> = async (data: {
  projectId: string;
  occurrenceId: string;
}): Promise<void> => {
  requireUuid(data.projectId, "fixture project id");
  requireUuid(data.occurrenceId, "fixture occurrence id");

  const location: ClickHouseFixtureLocation = clickHouseFixtureLocation();
  await executeClickHouseRequest({
    /* The public table is Distributed; mutations must target its local store. */
    query: `ALTER TABLE ${location.database}.${EXCEPTION_STORAGE_TABLE_NAME} DELETE WHERE projectId = {projectId:String} AND _id = {occurrenceId:String} SETTINGS mutations_sync = 1`,
    queryParameters: {
      projectId: data.projectId,
      occurrenceId: data.occurrenceId,
    },
  });
};
