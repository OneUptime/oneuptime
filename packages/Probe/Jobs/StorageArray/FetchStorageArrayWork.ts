import {
  HasRegisterProbeKey,
  PROBE_API_REQUEST_TIMEOUT_IN_MS,
  PROBE_INGEST_URL,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import ServerBusy from "../../Utils/ServerBusy";
import { StorageArrayPoller } from "../../Utils/StorageArray/StorageArrayPoller";
import StorageArrayPollers from "../../Utils/StorageArray/StorageArrayPollers";
import { isVMwareCollectionAllowedOnThisProbe } from "../VMware/FetchVMwareWork";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import StorageArrayCollectionErrorCode from "Common/Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import {
  STORAGE_ARRAY_PROBE_COLLECTION_CONCURRENCY,
  StorageArrayCollectionJob,
  StorageArrayCollectionReport,
  StorageArrayConnectionTestJob,
  StorageArrayConnectionTestReport,
  StorageArrayProbeWorkResponse,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import zlib from "zlib";

/*
 * The probe's half of collecting storage arrays from their management
 * server (#11004), every ten seconds - VMware's agentless collection's job
 * (FetchVMwareWork), for any platform a poller reads:
 *
 *   1. ask for work, naming the collections still running - the server
 *      hands out no connection twice, and none of those again;
 *   2. collect each connection handed out with its platform's poller
 *      (StorageArrayPollers), at most
 *      STORAGE_ARRAY_PROBE_COLLECTION_CONCURRENCY at once, and report it -
 *      its status, and its metrics gzip-compressed;
 *   3. run each connection test handed out and report it.
 *
 * Every connection and test handed out is answered: whatever goes wrong
 * becomes a Failed report with the reason. The password is in memory only,
 * for the length of the collection.
 */

// How long one report upload may take: megabytes over a slow site link.
export const REPORT_UPLOAD_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

// The work the work request hands out, as a busy answer names it.
const STORAGE_ARRAY_WORK: string = "storage array collections";

const runningCollections: Map<string, Promise<void>> = new Map();
const runningTests: Set<string> = new Set();

let isFetchInProgress: boolean = false;

// What a collection or a test needs; replaced in tests.
export interface FetchStorageArrayWorkDependencies {
  getPoller: (storageSystem: string) => StorageArrayPoller | null;
}

const DEFAULT_DEPENDENCIES: FetchStorageArrayWorkDependencies = {
  getPoller: (storageSystem: string): StorageArrayPoller | null => {
    return StorageArrayPollers.getPoller(storageSystem);
  },
};

// Exported for tests.
export function resetStorageArrayWorkState(): void {
  isFetchInProgress = false;
  runningCollections.clear();
  runningTests.clear();
}

// Exported for tests: the connections this probe is collecting right now.
export function getRunningStorageArrayConnectionIds(): Array<string> {
  return Array.from(runningCollections.keys());
}

// Exported for tests: resolves when every running collection has reported.
export async function waitForRunningStorageArrayCollections(): Promise<void> {
  await Promise.all(Array.from(runningCollections.values()));
}

function describeRejection(result: HTTPErrorResponse): string {
  return (
    `HTTP ${result.statusCode}` + (result.message ? ` - ${result.message}` : "")
  );
}

// A platform this probe has no poller for: answered, never left waiting.
function notSupported(storageSystem: string): {
  errorCode: StorageArrayCollectionErrorCode;
  errorMessage: string;
} {
  return {
    errorCode: StorageArrayCollectionErrorCode.PlatformNotSupported,
    errorMessage: `This probe cannot read ${storageSystem || "this platform"}. Update the probe to the latest OneUptime version.`,
  };
}

export async function fetchStorageArrayWork(): Promise<StorageArrayProbeWorkResponse> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/storage-array/work",
  );

  const empty: StorageArrayProbeWorkResponse = { collections: [], tests: [] };

  if (ServerBusy.isBackingOff(STORAGE_ARRAY_WORK)) {
    return empty;
  }

  try {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          runningStorageArrayConnectionIds:
            getRunningStorageArrayConnectionIds(),
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(url),
      });

    if (ServerBusy.isBusyAnswer(result)) {
      ServerBusy.note(STORAGE_ARRAY_WORK, result);
      return empty;
    }

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `Storage array work request failed: ${describeRejection(result)}. A server older than storage array collection answers 404 here.`,
      );
      return empty;
    }

    const body: JSONObject = (result.data as JSONObject) || {};

    return {
      collections: (
        (Array.isArray(body["collections"])
          ? body["collections"]
          : []) as JSONArray
      ).map((job: unknown): StorageArrayCollectionJob => {
        return job as StorageArrayCollectionJob;
      }),
      tests: (
        (Array.isArray(body["tests"]) ? body["tests"] : []) as JSONArray
      ).map((job: unknown): StorageArrayConnectionTestJob => {
        return job as StorageArrayConnectionTestJob;
      }),
    };
  } catch (err) {
    logger.error("Error fetching storage array work");
    logger.error(err);
    return empty;
  }
}

/*
 * Posts a collection report, gzip-compressed: a Unisphere of many arrays is
 * megabytes of JSON. The probe's id and key travel in headers as well as in
 * the body, so the server checks the key before it reads the report.
 */
export async function postStorageArrayCollectionReport(
  report: StorageArrayCollectionReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/storage-array/collection",
  );

  try {
    const body: Buffer = zlib.gzipSync(
      Buffer.from(
        JSON.stringify({
          ...ProbeAPIRequest.getDefaultRequestBody(),
          ...(report as unknown as JSONObject),
        }),
      ),
    );

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: body as unknown as JSONObject,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          ...ProbeAPIRequest.getProbeKeyHeaders(),
        },
        options: {
          ...ProbeAPIRequest.getDefaultRequestOptions(url, {
            timeout: Math.max(
              PROBE_API_REQUEST_TIMEOUT_IN_MS,
              REPORT_UPLOAD_TIMEOUT_IN_MS,
            ),
          }),
          maxBodyLength: Infinity,
        },
      });

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `The collection report of storage array connection ${report.storageArrayConnectionId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    const answer: JSONObject = (result.data as JSONObject) || {};

    if (answer["accepted"] === false) {
      logger.warn(
        `The collection report of storage array connection ${report.storageArrayConnectionId} was not accepted: ${String(
          answer["reason"] || "no reason given",
        )}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.error(
      `Error reporting the collection of storage array connection ${report.storageArrayConnectionId}`,
    );
    logger.error(err);
    return false;
  }
}

export async function postStorageArrayTestReport(
  report: StorageArrayConnectionTestReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/storage-array/test",
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
        options: ProbeAPIRequest.getDefaultRequestOptions(url),
      });

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `The connection test report ${report.storageArrayConnectionTestId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    return (result.data as JSONObject)?.["accepted"] !== false;
  } catch (err) {
    logger.error(
      `Error reporting storage array connection test ${report.storageArrayConnectionTestId}`,
    );
    logger.error(err);
    return false;
  }
}

function startCollection(
  job: StorageArrayCollectionJob,
  dependencies: FetchStorageArrayWorkDependencies,
): void {
  if (runningCollections.has(job.storageArrayConnectionId)) {
    return;
  }

  const done: Promise<void> = (async (): Promise<void> => {
    try {
      const poller: StorageArrayPoller | null = dependencies.getPoller(
        job.storageSystem,
      );
      const report: StorageArrayCollectionReport = poller
        ? await poller.collect(job)
        : {
            storageArrayConnectionId: job.storageArrayConnectionId,
            settingsVersion: job.settingsVersion,
            collectedAt: new Date().toISOString(),
            status: "Failed",
            ...notSupported(job.storageSystem),
            durationInMs: 0,
          };

      logger.debug(
        `Storage array collection of ${job.connectionName || job.storageArrayConnectionId}: ${report.status}${
          report.errorCode ? ` (${report.errorCode})` : ""
        } in ${report.durationInMs} ms.`,
      );

      await postStorageArrayCollectionReport(report);
    } catch (err) {
      // A poller answers every failure; this is a bug, still reported.
      logger.error(err);
      await postStorageArrayCollectionReport({
        storageArrayConnectionId: job.storageArrayConnectionId,
        settingsVersion: job.settingsVersion,
        collectedAt: new Date().toISOString(),
        status: "Failed",
        errorCode: StorageArrayCollectionErrorCode.Internal,
        errorMessage: `The probe hit an unexpected error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationInMs: 0,
      });
    } finally {
      runningCollections.delete(job.storageArrayConnectionId);
    }
  })();

  runningCollections.set(job.storageArrayConnectionId, done);
}

async function runTest(
  job: StorageArrayConnectionTestJob,
  dependencies: FetchStorageArrayWorkDependencies,
): Promise<void> {
  if (runningTests.has(job.storageArrayConnectionTestId)) {
    return;
  }

  runningTests.add(job.storageArrayConnectionTestId);

  try {
    let report: StorageArrayConnectionTestReport;

    try {
      const poller: StorageArrayPoller | null = dependencies.getPoller(
        job.storageSystem,
      );
      report = poller
        ? await poller.test(job)
        : {
            storageArrayConnectionTestId: job.storageArrayConnectionTestId,
            status: "Failed",
            ...notSupported(job.storageSystem),
            durationInMs: 0,
          };
    } catch (err) {
      logger.error(err);
      report = {
        storageArrayConnectionTestId: job.storageArrayConnectionTestId,
        status: "Failed",
        errorCode: StorageArrayCollectionErrorCode.Internal,
        errorMessage: `The probe hit an unexpected error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationInMs: 0,
      };
    }

    await postStorageArrayTestReport(report);
  } finally {
    runningTests.delete(job.storageArrayConnectionTestId);
  }
}

// One tick: ask for work, start what was handed out. Exported for tests.
export async function runStorageArrayWorkTick(
  dependencies: FetchStorageArrayWorkDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (isFetchInProgress) {
    logger.debug("Previous storage array work request is still in flight.");
    return;
  }

  isFetchInProgress = true;

  let work: StorageArrayProbeWorkResponse;

  try {
    work = await fetchStorageArrayWork();
  } finally {
    isFetchInProgress = false;
  }

  for (const job of work.collections) {
    if (runningCollections.size >= STORAGE_ARRAY_PROBE_COLLECTION_CONCURRENCY) {
      logger.warn(
        `Storage array collection of ${job.storageArrayConnectionId} skipped: ${STORAGE_ARRAY_PROBE_COLLECTION_CONCURRENCY} collections are already running.`,
      );
      continue;
    }

    startCollection(job, dependencies);
  }

  // Tests are a person waiting in the dashboard: they run at once.
  for (const job of work.tests) {
    runTest(job, dependencies).catch((err: Error) => {
      logger.error(err);
    });
  }
}

const InitJob: VoidFunction = (): void => {
  /*
   * A global probe of the hosted, open-signup product never collects: a
   * storage password only ever reaches a probe its own project runs - the
   * rule VMware's collection follows (isVMwareCollectionAllowedOnThisProbe).
   */
  if (
    !isVMwareCollectionAllowedOnThisProbe({
      isAutoRegisteredGlobalProbe: HasRegisterProbeKey,
      isBillingEnabled: IsBillingEnabled,
    })
  ) {
    logger.info(
      "Storage array collection is off on this probe: a global probe of a billing-enabled instance never receives storage passwords.",
    );
    return;
  }

  BasicCron({
    jobName: "Probe:StorageArrayWork",
    options: {
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        await runStorageArrayWorkTick();
      } catch (err) {
        logger.error("Storage array work tick failed");
        logger.error(err);
      }
    },
  });
};

export default InitJob;
