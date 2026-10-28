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
  sampleDatabase,
  sanitizeErrorMessage,
} from "Common/Server/Utils/DataSecurity/Content/DatabaseSampler";
import {
  buildProbeScanOptions,
  DATA_SECURITY_PROBE_RESULT_ROUTE,
  DATA_SECURITY_PROBE_WORK_ROUTE,
  DataSecurityProbeResultReport,
  DataSecurityProbeStoreWork,
  isValidProbeConnectionVariable,
  readProbeStoreWork,
} from "Common/Server/Utils/DataSecurity/DataSecurityProbeScan";
import {
  ContentScanOptions,
  ContentScanResult,
} from "Common/Server/Utils/DataSecurity/DataSecurityScanTypes";

/*
 * THE PROBE'S HALF OF SCANNING DATABASES FOR DATA SECURITY, EVERY FIVE
 * MINUTES.
 *
 *   1. ask for work - the server claims the stores due for this probe and
 *      names, for each, the environment variable of this probe that holds
 *      its connection string;
 *   2. read the connection string from that variable - a name that is not
 *      an upper-case shell variable's, or one of the probe's own settings,
 *      is refused - and sample the database read-only (DatabaseSampler);
 *   3. report what was found: findings by column, never a value, never the
 *      connection string.
 *
 * Every store handed out is answered: a variable the probe does not have,
 * a database it cannot reach, become a report of the error, so the store
 * says why it was not scanned. One tick runs at a time; scans run one
 * after another, each within its own time limit.
 */

// How long one result upload may take.
export const RESULT_UPLOAD_TIMEOUT_IN_MS: number = 2 * 60 * 1000;

// What a scan needs; replaced in tests.
export interface ScanDatabasesDependencies {
  sample: (
    connection: DatabaseConnection,
    options: ContentScanOptions,
  ) => Promise<ContentScanResult>;
  environment: Record<string, string | undefined>;
}

const DEFAULT_DEPENDENCIES: ScanDatabasesDependencies = {
  sample: (
    connection: DatabaseConnection,
    options: ContentScanOptions,
  ): Promise<ContentScanResult> => {
    return sampleDatabase(connection, options);
  },
  environment: process.env,
};

let isTickInProgress: boolean = false;

// Exported for tests.
export function resetDataSecurityScanState(): void {
  isTickInProgress = false;
}

function describeRejection(result: HTTPErrorResponse): string {
  return (
    `HTTP ${result.statusCode}` + (result.message ? ` - ${result.message}` : "")
  );
}

/*
 * Asks for work. A failed request is no work, logged: nothing was claimed,
 * or what was is claimed until its claim runs out.
 */
export async function fetchDataSecurityWork(): Promise<
  Array<DataSecurityProbeStoreWork>
> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    DATA_SECURITY_PROBE_WORK_ROUTE,
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
        `Data Security work request failed: ${describeRejection(result)}. A server older than Data Security answers 404 here.`,
      );
      return [];
    }

    const body: JSONObject = (result.data as JSONObject) || {};
    const stores: Array<DataSecurityProbeStoreWork> = [];

    if (Array.isArray(body["stores"])) {
      for (const item of body["stores"] as Array<unknown>) {
        const work: DataSecurityProbeStoreWork | null =
          readProbeStoreWork(item);

        if (work) {
          stores.push(work);
        }
      }
    }

    return stores;
  } catch (err) {
    logger.error("Error fetching Data Security work");
    logger.error(err);
    return [];
  }
}

// Posts one store's report. Returns whether the server accepted it.
export async function postScanReport(
  report: DataSecurityProbeResultReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    DATA_SECURITY_PROBE_RESULT_ROUTE,
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
        `The Data Security scan report of store ${report.dataStoreId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    return (result.data as JSONObject)?.["accepted"] !== false;
  } catch (err) {
    logger.error(
      `Error reporting the Data Security scan of store ${report.dataStoreId}`,
    );
    logger.error(err);
    return false;
  }
}

/*
 * Scans one store and says how it went. Never throws: whatever goes wrong
 * is the report's error, with the connection string's secrets taken out.
 */
export async function scanStore(
  work: DataSecurityProbeStoreWork,
  dependencies: ScanDatabasesDependencies = DEFAULT_DEPENDENCIES,
): Promise<DataSecurityProbeResultReport> {
  const startedAt: string = new Date().toISOString();
  const name: string = work.probeConnectionVariable;

  if (!isValidProbeConnectionVariable(name)) {
    return {
      dataStoreId: work.dataStoreId,
      startedAt,
      error: `The probe does not read the environment variable "${work.probeConnectionVariable.slice(
        0,
        64,
      )}": name a variable of upper-case letters, digits and underscores that is not one of the probe's own settings.`,
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
    const result: ContentScanResult = await dependencies.sample(
      { engine: work.engine, connectionString: connectionString.trim() },
      buildProbeScanOptions(work),
    );

    return { dataStoreId: work.dataStoreId, startedAt, result };
  } catch (err) {
    return {
      dataStoreId: work.dataStoreId,
      startedAt,
      error: sanitizeErrorMessage(err, getConnectionSecrets(connectionString)),
    };
  }
}

// One tick: ask for work, scan what was handed out, report each. For tests.
export async function runDataSecurityScanTick(
  dependencies: ScanDatabasesDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (isTickInProgress) {
    logger.debug("The previous Data Security scan is still running.");
    return;
  }

  isTickInProgress = true;

  try {
    const stores: Array<DataSecurityProbeStoreWork> =
      await fetchDataSecurityWork();

    for (const work of stores) {
      const report: DataSecurityProbeResultReport = await scanStore(
        work,
        dependencies,
      );

      logger.debug(
        `Data Security scan of store ${work.dataStoreId}: ${
          report.error ? "failed" : "done"
        }.`,
      );

      await postScanReport(report);
    }
  } finally {
    isTickInProgress = false;
  }
}

/*
 * Whether this probe scans databases at all. A global probe of the hosted,
 * open-signup product never does - the server hands one nothing, and it
 * does not ask: databases are scanned by their project's own probe.
 */
export function isDataSecurityScanAllowedOnThisProbe(data: {
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
}): boolean {
  return !(data.isAutoRegisteredGlobalProbe && data.isBillingEnabled);
}

const InitJob: VoidFunction = (): void => {
  if (
    !isDataSecurityScanAllowedOnThisProbe({
      isAutoRegisteredGlobalProbe: HasRegisterProbeKey,
      isBillingEnabled: IsBillingEnabled,
    })
  ) {
    logger.info(
      "Data Security database scans are off on this probe: a global probe of a billing-enabled instance scans no customer's database.",
    );
    return;
  }

  BasicCron({
    jobName: "Probe:DataSecurityScanDatabases",
    options: {
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    },
    runFunction: async () => {
      try {
        await runDataSecurityScanTick();
      } catch (err) {
        logger.error("Data Security scan tick failed");
        logger.error(err);
      }
    },
  });
};

export default InitJob;
