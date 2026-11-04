import {
  HasRegisterProbeKey,
  PROBE_API_REQUEST_TIMEOUT_IN_MS,
  PROBE_INGEST_URL,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import OpenStackCollector from "../../Utils/OpenStack/OpenStackCollector";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OPENSTACK_PROBE_COLLECTION_CONCURRENCY,
  OpenStackCollectionJob,
  OpenStackCollectionReport,
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
  OpenStackProbeWorkResponse,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import { promisify } from "util";
import zlib from "zlib";

/*
 * The probe's half of collecting clouds without an agent, every ten seconds:
 *
 *   1. ask for work, naming the collections still running, so the server hands out no
 *      cloud twice, and none of those again. That is what makes a collection slower
 *      than its interval skipped rather than stacked;
 *   2. collect each cloud handed out (OpenStackCollector), at most
 *      OPENSTACK_PROBE_COLLECTION_CONCURRENCY at once, and report it: its status, and
 *      its metrics gzip-compressed;
 *   3. run each connection test handed out and report it.
 *
 * Every cloud and test handed out is answered: whatever goes wrong becomes a Failed
 * report with the reason. A report the server refuses (the cloud moved to another probe
 * meanwhile) is logged, not retried.
 */

// How long one report upload may take: megabytes over a slow site link.
export const REPORT_UPLOAD_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

const gzip: (body: Buffer) => Promise<Buffer> = promisify<Buffer, Buffer>(
  zlib.gzip,
);

const runningCollections: Map<string, Promise<void>> = new Map();
const runningTests: Set<string> = new Set();

let isFetchInProgress: boolean = false;

// What a collection or a test needs; replaced in tests.
export interface FetchOpenStackWorkDependencies {
  collect: (job: OpenStackCollectionJob) => Promise<OpenStackCollectionReport>;
  test: (
    job: OpenStackConnectionTestJob,
  ) => Promise<OpenStackConnectionTestReport>;
}

const DEFAULT_DEPENDENCIES: FetchOpenStackWorkDependencies = {
  collect: (
    job: OpenStackCollectionJob,
  ): Promise<OpenStackCollectionReport> => {
    return OpenStackCollector.collect(job);
  },
  test: (
    job: OpenStackConnectionTestJob,
  ): Promise<OpenStackConnectionTestReport> => {
    return OpenStackCollector.test(job);
  },
};

// Exported for tests.
export function resetOpenStackWorkState(): void {
  isFetchInProgress = false;
  runningCollections.clear();
  runningTests.clear();
}

// Exported for tests: the clouds this probe is collecting right now.
export function getRunningOpenStackCloudIds(): Array<string> {
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
 * Asks for work. A failed request is an empty answer, logged: nothing was claimed, and
 * the next tick asks again.
 */
export async function fetchOpenStackWork(): Promise<OpenStackProbeWorkResponse> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/openstack/work",
  );

  const empty: OpenStackProbeWorkResponse = { collections: [], tests: [] };

  try {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          runningOpenStackCloudIds: getRunningOpenStackCloudIds(),
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(url),
      });

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `OpenStack work request failed: ${describeRejection(result)}. A server older than OpenStack collection answers 404 here.`,
      );
      return empty;
    }

    const body: JSONObject = (result.data as JSONObject) || {};

    return {
      collections: (
        (Array.isArray(body["collections"])
          ? body["collections"]
          : []) as JSONArray
      ).map((job: unknown): OpenStackCollectionJob => {
        return job as OpenStackCollectionJob;
      }),
      tests: (
        (Array.isArray(body["tests"]) ? body["tests"] : []) as JSONArray
      ).map((job: unknown): OpenStackConnectionTestJob => {
        return job as OpenStackConnectionTestJob;
      }),
    };
  } catch (err) {
    logger.error("Error fetching OpenStack work");
    logger.error(err);
    return empty;
  }
}

/*
 * Posts a collection report, gzip-compressed: a large cloud's metrics are megabytes of
 * JSON. Without blocking, because the same process runs this probe's monitors. Returns
 * whether the server accepted it.
 */
export async function postCollectionReport(
  report: OpenStackCollectionReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/openstack/collection",
  );

  try {
    const body: Buffer = await gzip(
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
        `The collection report of cloud ${report.openStackCloudId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    const answer: JSONObject = (result.data as JSONObject) || {};

    if (answer["accepted"] === false) {
      logger.warn(
        `The collection report of cloud ${report.openStackCloudId} was not accepted: ${String(
          answer["reason"] || "no reason given",
        )}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.error(
      `Error reporting the collection of cloud ${report.openStackCloudId}`,
    );
    logger.error(err);
    return false;
  }
}

export async function postTestReport(
  report: OpenStackConnectionTestReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/openstack/test",
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
        `The connection test report ${report.openStackCloudConnectionTestId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    return (result.data as JSONObject)?.["accepted"] !== false;
  } catch (err) {
    logger.error(
      `Error reporting connection test ${report.openStackCloudConnectionTestId}`,
    );
    logger.error(err);
    return false;
  }
}

function startCollection(
  job: OpenStackCollectionJob,
  dependencies: FetchOpenStackWorkDependencies,
): void {
  if (runningCollections.has(job.openStackCloudId)) {
    return;
  }

  const done: Promise<void> = (async (): Promise<void> => {
    try {
      const report: OpenStackCollectionReport = await dependencies.collect(job);

      logger.debug(
        `OpenStack collection of ${job.cloudName || job.openStackCloudId}: ${report.status}${
          report.errorCode ? ` (${report.errorCode})` : ""
        } in ${report.durationInMs} ms.`,
      );

      await postCollectionReport(report);
    } catch (err) {
      // collect() answers every failure, so this is a bug, and it is still reported.
      logger.error(err);
      await postCollectionReport({
        openStackCloudId: job.openStackCloudId,
        settingsVersion: job.settingsVersion,
        collectedAt: new Date().toISOString(),
        status: "Failed",
        errorCode: OpenStackCollectionErrorCode.Internal,
        errorMessage: `The probe hit an unexpected error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationInMs: 0,
      });
    } finally {
      runningCollections.delete(job.openStackCloudId);
    }
  })();

  runningCollections.set(job.openStackCloudId, done);
}

async function runTest(
  job: OpenStackConnectionTestJob,
  dependencies: FetchOpenStackWorkDependencies,
): Promise<void> {
  if (runningTests.has(job.openStackCloudConnectionTestId)) {
    return;
  }

  runningTests.add(job.openStackCloudConnectionTestId);

  try {
    let report: OpenStackConnectionTestReport;

    try {
      report = await dependencies.test(job);
    } catch (err) {
      logger.error(err);
      report = {
        openStackCloudConnectionTestId: job.openStackCloudConnectionTestId,
        status: "Failed",
        errorCode: OpenStackCollectionErrorCode.Internal,
        errorMessage: `The probe hit an unexpected error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationInMs: 0,
      };
    }

    await postTestReport(report);
  } finally {
    runningTests.delete(job.openStackCloudConnectionTestId);
  }
}

// One tick: ask for work, start what was handed out. Exported for tests.
export async function runOpenStackWorkTick(
  dependencies: FetchOpenStackWorkDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (isFetchInProgress) {
    logger.debug("Previous OpenStack work request is still in flight.");
    return;
  }

  isFetchInProgress = true;

  let work: OpenStackProbeWorkResponse;

  try {
    work = await fetchOpenStackWork();
  } finally {
    isFetchInProgress = false;
  }

  for (const job of work.collections) {
    if (runningCollections.size >= OPENSTACK_PROBE_COLLECTION_CONCURRENCY) {
      /*
       * The server hands out no more than the free slots, and a cloud beyond them waits
       * for its next turn rather than overloading the probe.
       */
      logger.warn(
        `OpenStack collection of ${job.openStackCloudId} skipped: ${OPENSTACK_PROBE_COLLECTION_CONCURRENCY} collections are already running.`,
      );
      continue;
    }

    startCollection(job, dependencies);
  }

  /*
   * Tests are a person waiting in the dashboard: they run at once, beside the
   * collections, and the tick does not wait for them.
   */
  for (const job of work.tests) {
    runTest(job, dependencies).catch((err: Error) => {
      logger.error(err);
    });
  }
}

/*
 * Whether this probe collects clouds at all. A global probe of the hosted, open-signup
 * product (registered with REGISTER_PROBE_KEY, BILLING_ENABLED in its own environment)
 * never does: every sign-up shares it, and a cloud's credential only ever reaches a
 * probe its own project runs. The server never hands such a probe a cloud or a test, and
 * it does not even ask. A self-hosted instance's global probes are its operator's own,
 * and collect.
 */
export function isOpenStackCollectionAllowedOnThisProbe(data: {
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
}): boolean {
  return !(data.isAutoRegisteredGlobalProbe && data.isBillingEnabled);
}

const InitJob: VoidFunction = (): void => {
  if (
    !isOpenStackCollectionAllowedOnThisProbe({
      isAutoRegisteredGlobalProbe: HasRegisterProbeKey,
      isBillingEnabled: IsBillingEnabled,
    })
  ) {
    logger.info(
      "OpenStack collection is off on this probe: a global probe of a billing-enabled instance never receives OpenStack credentials.",
    );
    return;
  }

  BasicCron({
    jobName: "Probe:OpenStackWork",
    options: {
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        await runOpenStackWorkTick();
      } catch (err) {
        logger.error("OpenStack work tick failed");
        logger.error(err);
      }
    },
  });
};

export default InitJob;
