import {
  HasRegisterProbeKey,
  PROBE_API_REQUEST_TIMEOUT_IN_MS,
  PROBE_INGEST_URL,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import VMwareCollector from "../../Utils/VMware/VMwareCollector";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  VMWARE_PROBE_COLLECTION_CONCURRENCY,
  VMwareCollectionJob,
  VMwareCollectionReport,
  VMwareConnectionTestJob,
  VMwareConnectionTestReport,
  VMwareProbeWorkResponse,
} from "Common/Types/VMware/VMwareProbeCollection";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import zlib from "zlib";

/*
 * The probe's half of collecting vCenters without an agent, every ten
 * seconds:
 *
 *   1. ask for work, naming the collections still running - the server
 *      hands out no vCenter twice, and none of those again;
 *   2. collect each vCenter handed out (VMwareCollector), at most
 *      VMWARE_PROBE_COLLECTION_CONCURRENCY at once, and report it - its
 *      status, and its metrics gzip-compressed;
 *   3. run each connection test handed out and report it.
 *
 * Every vCenter and test handed out is answered: whatever goes wrong
 * becomes a Failed report with the reason. A report the server refuses (the
 * vCenter moved to another probe meanwhile) is logged, not retried.
 */

// How long one report upload may take: megabytes over a slow site link.
export const REPORT_UPLOAD_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

const runningCollections: Map<string, Promise<void>> = new Map();
const runningTests: Set<string> = new Set();

let isFetchInProgress: boolean = false;

// What a collection or a test needs; replaced in tests.
export interface FetchVMwareWorkDependencies {
  collect: (job: VMwareCollectionJob) => Promise<VMwareCollectionReport>;
  test: (job: VMwareConnectionTestJob) => Promise<VMwareConnectionTestReport>;
}

const DEFAULT_DEPENDENCIES: FetchVMwareWorkDependencies = {
  collect: (job: VMwareCollectionJob): Promise<VMwareCollectionReport> => {
    return VMwareCollector.collect(job);
  },
  test: (job: VMwareConnectionTestJob): Promise<VMwareConnectionTestReport> => {
    return VMwareCollector.test(job);
  },
};

// Exported for tests.
export function resetVMwareWorkState(): void {
  isFetchInProgress = false;
  runningCollections.clear();
  runningTests.clear();
}

// Exported for tests: the vCenters this probe is collecting right now.
export function getRunningVMwareVCenterIds(): Array<string> {
  return Array.from(runningCollections.keys());
}

// Exported for tests: resolves when every running collection has reported.
export async function waitForRunningCollections(): Promise<void> {
  await Promise.all(Array.from(runningCollections.values()));
}

function describeRejection(result: HTTPErrorResponse): string {
  return (
    `HTTP ${result.statusCode}` + (result.message ? ` - ${result.message}` : "")
  );
}

/*
 * Asks for work. A failed request is an empty answer, logged: nothing was
 * claimed, and the next tick asks again.
 */
export async function fetchVMwareWork(): Promise<VMwareProbeWorkResponse> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/vmware/work",
  );

  const empty: VMwareProbeWorkResponse = { collections: [], tests: [] };

  try {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          runningVMwareVCenterIds: getRunningVMwareVCenterIds(),
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(url),
      });

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `VMware work request failed: ${describeRejection(result)}. A server older than VMware collection answers 404 here.`,
      );
      return empty;
    }

    const body: JSONObject = (result.data as JSONObject) || {};

    return {
      collections: (
        (Array.isArray(body["collections"])
          ? body["collections"]
          : []) as JSONArray
      ).map((job: unknown): VMwareCollectionJob => {
        return job as VMwareCollectionJob;
      }),
      tests: (
        (Array.isArray(body["tests"]) ? body["tests"] : []) as JSONArray
      ).map((job: unknown): VMwareConnectionTestJob => {
        return job as VMwareConnectionTestJob;
      }),
    };
  } catch (err) {
    logger.error("Error fetching VMware work");
    logger.error(err);
    return empty;
  }
}

/*
 * Posts a collection report, gzip-compressed: a large vCenter's metrics are
 * megabytes of JSON. Returns whether the server accepted it.
 */
export async function postCollectionReport(
  report: VMwareCollectionReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/vmware/collection",
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
        `The collection report of vCenter ${report.vmwareVCenterId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    const answer: JSONObject = (result.data as JSONObject) || {};

    if (answer["accepted"] === false) {
      logger.warn(
        `The collection report of vCenter ${report.vmwareVCenterId} was not accepted: ${String(
          answer["reason"] || "no reason given",
        )}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.error(
      `Error reporting the collection of vCenter ${report.vmwareVCenterId}`,
    );
    logger.error(err);
    return false;
  }
}

export async function postTestReport(
  report: VMwareConnectionTestReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/vmware/test",
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
        `The connection test report ${report.vmwareVCenterConnectionTestId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    return (result.data as JSONObject)?.["accepted"] !== false;
  } catch (err) {
    logger.error(
      `Error reporting connection test ${report.vmwareVCenterConnectionTestId}`,
    );
    logger.error(err);
    return false;
  }
}

function startCollection(
  job: VMwareCollectionJob,
  dependencies: FetchVMwareWorkDependencies,
): void {
  if (runningCollections.has(job.vmwareVCenterId)) {
    return;
  }

  const done: Promise<void> = (async (): Promise<void> => {
    try {
      const report: VMwareCollectionReport = await dependencies.collect(job);

      logger.debug(
        `VMware collection of ${job.vcenterName || job.vmwareVCenterId}: ${report.status}${
          report.errorCode ? ` (${report.errorCode})` : ""
        } in ${report.durationInMs} ms.`,
      );

      await postCollectionReport(report);
    } catch (err) {
      // collect() answers every failure; this is a bug, still reported.
      logger.error(err);
      await postCollectionReport({
        vmwareVCenterId: job.vmwareVCenterId,
        settingsVersion: job.settingsVersion,
        collectedAt: new Date().toISOString(),
        status: "Failed",
        errorMessage: `The probe hit an unexpected error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationInMs: 0,
      });
    } finally {
      runningCollections.delete(job.vmwareVCenterId);
    }
  })();

  runningCollections.set(job.vmwareVCenterId, done);
}

async function runTest(
  job: VMwareConnectionTestJob,
  dependencies: FetchVMwareWorkDependencies,
): Promise<void> {
  if (runningTests.has(job.vmwareVCenterConnectionTestId)) {
    return;
  }

  runningTests.add(job.vmwareVCenterConnectionTestId);

  try {
    let report: VMwareConnectionTestReport;

    try {
      report = await dependencies.test(job);
    } catch (err) {
      logger.error(err);
      report = {
        vmwareVCenterConnectionTestId: job.vmwareVCenterConnectionTestId,
        status: "Failed",
        errorMessage: `The probe hit an unexpected error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationInMs: 0,
      };
    }

    await postTestReport(report);
  } finally {
    runningTests.delete(job.vmwareVCenterConnectionTestId);
  }
}

// One tick: ask for work, start what was handed out. Exported for tests.
export async function runVMwareWorkTick(
  dependencies: FetchVMwareWorkDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (isFetchInProgress) {
    logger.debug("Previous VMware work request is still in flight.");
    return;
  }

  isFetchInProgress = true;

  let work: VMwareProbeWorkResponse;

  try {
    work = await fetchVMwareWork();
  } finally {
    isFetchInProgress = false;
  }

  for (const job of work.collections) {
    if (runningCollections.size >= VMWARE_PROBE_COLLECTION_CONCURRENCY) {
      /*
       * The server hands out no more than the free slots; a vCenter beyond
       * them waits for its next turn rather than overloading the probe.
       */
      logger.warn(
        `VMware collection of ${job.vmwareVCenterId} skipped: ${VMWARE_PROBE_COLLECTION_CONCURRENCY} collections are already running.`,
      );
      continue;
    }

    startCollection(job, dependencies);
  }

  /*
   * Tests are a person waiting in the dashboard: they run at once, beside
   * the collections, and the tick does not wait for them.
   */
  for (const job of work.tests) {
    runTest(job, dependencies).catch((err: Error) => {
      logger.error(err);
    });
  }
}

/*
 * Whether this probe collects vCenters at all. A global probe of the hosted,
 * open-signup product (registered with REGISTER_PROBE_KEY, BILLING_ENABLED in
 * its own environment) never does: every sign-up shares it, and a vCenter's
 * password only ever reaches a probe its own project runs. The server never
 * hands such a probe a vCenter or a test; it does not even ask. A self-hosted
 * instance's global probes are its operator's own, and collect.
 */
export function isVMwareCollectionAllowedOnThisProbe(data: {
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
}): boolean {
  return !(data.isAutoRegisteredGlobalProbe && data.isBillingEnabled);
}

const InitJob: VoidFunction = (): void => {
  if (
    !isVMwareCollectionAllowedOnThisProbe({
      isAutoRegisteredGlobalProbe: HasRegisterProbeKey,
      isBillingEnabled: IsBillingEnabled,
    })
  ) {
    logger.info(
      "VMware collection is off on this probe: a global probe of a billing-enabled instance never receives vCenter passwords.",
    );
    return;
  }

  BasicCron({
    jobName: "Probe:VMwareWork",
    options: {
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        await runVMwareWorkTick();
      } catch (err) {
        logger.error("VMware work tick failed");
        logger.error(err);
      }
    },
  });
};

export default InitJob;
