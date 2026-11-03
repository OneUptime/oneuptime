import {
  HasRegisterProbeKey,
  PROBE_API_REQUEST_TIMEOUT_IN_MS,
  PROBE_INGEST_URL,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import {
  DatabaseConnection,
  getConnectionSecrets,
  sanitizeErrorMessage,
} from "Common/Server/Utils/DataSecurity/Content/DatabaseSampler";
import {
  buildProbeCollectOptions,
  DATA_OBSERVABILITY_PROBE_RESULT_ROUTE,
  DATA_OBSERVABILITY_PROBE_WORK_ROUTE,
  DataObservabilityProbeResultReport,
  DataObservabilityProbeStoreWork,
  isCollectableVariable,
  readProbeCollectWork,
} from "Common/Server/Utils/DataObservability/DataObservabilityProbeCollect";
import {
  collectTableHealth,
  TableHealthCollectOptions,
  TableHealthSnapshot,
} from "Common/Server/Utils/DataObservability/TableHealthCollector";

/*
 * THE PROBE'S HALF OF DATA OBSERVABILITY'S TABLE HEALTH, EVERY FIVE MINUTES.
 *
 *   1. ask for work - the server claims the stores due for this probe and
 *      names, for each, the environment variable of this probe that holds
 *      its connection string (the same variable Data Security's scans use);
 *   2. read the connection string from that variable and read the
 *      database's catalog (TableHealthCollector): columns, row counts,
 *      sizes and last changes - never a row;
 *   3. report what was read, never the connection string.
 *
 * Every store handed out is answered: a variable the probe does not have,
 * a database it cannot reach, become a report of the error, so the store
 * says why it was not collected. One tick runs at a time.
 */

// How long one result upload may take.
export const RESULT_UPLOAD_TIMEOUT_IN_MS: number = 2 * 60 * 1000;

// What a collection needs; replaced in tests.
export interface CollectTableHealthDependencies {
  collect: (
    connection: DatabaseConnection,
    options: TableHealthCollectOptions,
  ) => Promise<TableHealthSnapshot>;
  environment: Record<string, string | undefined>;
}

const DEFAULT_DEPENDENCIES: CollectTableHealthDependencies = {
  collect: (
    connection: DatabaseConnection,
    options: TableHealthCollectOptions,
  ): Promise<TableHealthSnapshot> => {
    return collectTableHealth(connection, options);
  },
  environment: process.env,
};

let isTickInProgress: boolean = false;

// Exported for tests.
export function resetTableHealthCollectState(): void {
  isTickInProgress = false;
}

function describeRejection(result: HTTPErrorResponse): string {
  return (
    `HTTP ${result.statusCode}` + (result.message ? ` - ${result.message}` : "")
  );
}

// Asks for work. A failed request is no work: what was claimed is released when its claim runs out.
export async function fetchTableHealthWork(): Promise<
  Array<DataObservabilityProbeStoreWork>
> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    DATA_OBSERVABILITY_PROBE_WORK_ROUTE,
  );

  try {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: ProbeAPIRequest.getDefaultRequestBody(),
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(url),
      });

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `Data Observability work request failed: ${describeRejection(result)}. A server older than Data Observability answers 404 here.`,
      );
      return [];
    }

    const body: JSONObject = (result.data as JSONObject) || {};
    const stores: Array<DataObservabilityProbeStoreWork> = [];

    if (Array.isArray(body["stores"])) {
      for (const item of body["stores"] as Array<unknown>) {
        const work: DataObservabilityProbeStoreWork | null =
          readProbeCollectWork(item);

        if (work) {
          stores.push(work);
        }
      }
    }

    return stores;
  } catch (err) {
    logger.error("Error fetching Data Observability work");
    logger.error(err);
    return [];
  }
}

// Posts one store's report. Returns whether the server accepted it.
export async function postCollectionReport(
  report: DataObservabilityProbeResultReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    DATA_OBSERVABILITY_PROBE_RESULT_ROUTE,
  );

  try {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          ...(report as unknown as JSONObject),
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(url, {
          timeout: Math.max(
            PROBE_API_REQUEST_TIMEOUT_IN_MS,
            RESULT_UPLOAD_TIMEOUT_IN_MS,
          ),
        }),
      });

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `The Data Observability collection of store ${report.dataStoreId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    return (result.data as JSONObject)?.["accepted"] !== false;
  } catch (err) {
    logger.error(
      `Error reporting the Data Observability collection of store ${report.dataStoreId}`,
    );
    logger.error(err);
    return false;
  }
}

// Collects one store and says how it went. Never throws.
export async function collectStore(
  work: DataObservabilityProbeStoreWork,
  dependencies: CollectTableHealthDependencies = DEFAULT_DEPENDENCIES,
): Promise<DataObservabilityProbeResultReport> {
  const startedAt: string = new Date().toISOString();
  const name: string = work.probeConnectionVariable;

  if (!isCollectableVariable(name)) {
    return {
      dataStoreId: work.dataStoreId,
      startedAt,
      error: `The probe does not read the environment variable "${work.probeConnectionVariable.slice(0, 64)}": name a variable of upper-case letters, digits and underscores that is not one of the probe's own settings.`,
    };
  }

  const connectionString: string | undefined = dependencies.environment[name];

  if (!connectionString || connectionString.trim().length === 0) {
    return {
      dataStoreId: work.dataStoreId,
      startedAt,
      error: `The probe has no environment variable ${name}.`,
    };
  }

  try {
    const snapshot: TableHealthSnapshot = await dependencies.collect(
      { engine: work.engine, connectionString: connectionString.trim() },
      buildProbeCollectOptions(work),
    );

    return { dataStoreId: work.dataStoreId, startedAt, snapshot };
  } catch (err) {
    return {
      dataStoreId: work.dataStoreId,
      startedAt,
      error: sanitizeErrorMessage(err, getConnectionSecrets(connectionString)),
    };
  }
}

// One tick: ask for work, collect what was handed out, report each. For tests.
export async function runTableHealthCollectTick(
  dependencies: CollectTableHealthDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (isTickInProgress) {
    logger.debug(
      "The previous Data Observability collection is still running.",
    );
    return;
  }

  isTickInProgress = true;

  try {
    const stores: Array<DataObservabilityProbeStoreWork> =
      await fetchTableHealthWork();

    for (const work of stores) {
      const report: DataObservabilityProbeResultReport = await collectStore(
        work,
        dependencies,
      );

      logger.debug(
        `Data Observability collection of store ${work.dataStoreId}: ${
          report.error ? "failed" : "done"
        }.`,
      );

      await postCollectionReport(report);
    }
  } finally {
    isTickInProgress = false;
  }
}

/*
 * Whether this probe collects databases at all. A global probe of the
 * hosted, open-signup product never does: databases are collected by their
 * project's own probe.
 */
export function isTableHealthCollectAllowedOnThisProbe(data: {
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
}): boolean {
  return !(data.isAutoRegisteredGlobalProbe && data.isBillingEnabled);
}

const InitJob: VoidFunction = (): void => {
  if (
    !isTableHealthCollectAllowedOnThisProbe({
      isAutoRegisteredGlobalProbe: HasRegisterProbeKey,
      isBillingEnabled: IsBillingEnabled,
    })
  ) {
    logger.info(
      "Data Observability collections are off on this probe: a global probe of a billing-enabled instance reads no customer's database.",
    );
    return;
  }

  BasicCron({
    jobName: "Probe:DataObservabilityCollectTableHealth",
    options: {
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    },
    runFunction: async () => {
      try {
        await runTableHealthCollectTick();
      } catch (err) {
        logger.error("Data Observability collection tick failed");
        logger.error(err);
      }
    },
  });
};

export default InitJob;
