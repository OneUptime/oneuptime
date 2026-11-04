import { HasRegisterProbeKey, PROBE_INGEST_URL } from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import OpenStackApiCheck from "../../Utils/OpenStack/Checks/OpenStackApiCheck";
import OpenStackLifecycleCheck from "../../Utils/OpenStack/Checks/OpenStackLifecycleCheck";
import { isOpenStackCollectionAllowedOnThisProbe } from "./FetchOpenStackWork";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  OPENSTACK_PROBE_API_CHECK_CONCURRENCY,
  OPENSTACK_PROBE_LIFECYCLE_CHECK_CONCURRENCY,
  OpenStackApiCheckJob,
  OpenStackApiCheckResult,
  OpenStackCheckReport,
  OpenStackCheckWorkResponse,
  OpenStackLifecycleCheckJob,
  OpenStackLifecycleRun,
  OpenStackLifecycleStep,
} from "Common/Types/OpenStack/OpenStackCheck";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";

/*
 * The probe's half of checking clouds from outside, every ten seconds:
 *
 *   1. ask for what is due, naming what is still running. The server hands out none of those, and
 *      that is what keeps a run from starting while one is going;
 *   2. run each one, the API checks and the lifecycle check each on their own, so that a boot taking
 *      ten minutes takes nothing from the check that says Keystone is up;
 *   3. report it.
 *
 * Every check handed out is answered, and every run that reached the cloud is reported however long
 * that takes: a lifecycle run costs a server and a volume, and what it found is worth waiting for a
 * server that is restarting. A report the server refuses is logged, not retried.
 */

// How many times a report is tried, and how long apart: long enough for a server to restart.
export const REPORT_ATTEMPTS: number = 5;
export const REPORT_RETRY_DELAY_IN_MS: number = 15_000;

const runningApiChecks: Map<string, Promise<void>> = new Map();
const runningLifecycleChecks: Map<string, Promise<void>> = new Map();

let isFetchInProgress: boolean = false;

// What a check needs; replaced in tests.
export interface FetchOpenStackChecksDependencies {
  runApiCheck: (job: OpenStackApiCheckJob) => Promise<OpenStackApiCheckResult>;
  runLifecycleCheck: (
    job: OpenStackLifecycleCheckJob,
  ) => Promise<Array<OpenStackLifecycleRun>>;
  sleep: (milliseconds: number) => Promise<void>;
}

const DEFAULT_DEPENDENCIES: FetchOpenStackChecksDependencies = {
  runApiCheck: (job: OpenStackApiCheckJob): Promise<OpenStackApiCheckResult> => {
    return OpenStackApiCheck.run(job);
  },
  runLifecycleCheck: (
    job: OpenStackLifecycleCheckJob,
  ): Promise<Array<OpenStackLifecycleRun>> => {
    return OpenStackLifecycleCheck.run(job);
  },
  sleep: (milliseconds: number): Promise<void> => {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, milliseconds);
    });
  },
};

// Exported for tests.
export function resetOpenStackChecksState(): void {
  isFetchInProgress = false;
  runningApiChecks.clear();
  runningLifecycleChecks.clear();
}

// Exported for tests: what this probe is running right now.
export function getRunningOpenStackChecks(): {
  api: Array<string>;
  lifecycle: Array<string>;
} {
  return {
    api: Array.from(runningApiChecks.keys()),
    lifecycle: Array.from(runningLifecycleChecks.keys()),
  };
}

// Exported for tests: resolves when every running check has reported.
export async function waitForRunningOpenStackChecks(): Promise<void> {
  await Promise.all([
    ...Array.from(runningApiChecks.values()),
    ...Array.from(runningLifecycleChecks.values()),
  ]);
}

function describeRejection(result: HTTPErrorResponse): string {
  return (
    `HTTP ${result.statusCode}` + (result.message ? ` - ${result.message}` : "")
  );
}

/*
 * Asks for what is due. A failed request is an empty answer: nothing was claimed, and the next tick
 * asks again. A server older than these checks answers 404, which is no reason for a warning every
 * ten seconds.
 */
export async function fetchOpenStackChecks(): Promise<OpenStackCheckWorkResponse> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/openstack/checks/work",
  );

  const empty: OpenStackCheckWorkResponse = {
    apiChecks: [],
    lifecycleChecks: [],
  };

  try {
    const running: { api: Array<string>; lifecycle: Array<string> } =
      getRunningOpenStackChecks();

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          runningApiCheckIds: running.api,
          runningLifecycleCheckIds: running.lifecycle,
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(url),
      });

    if (result instanceof HTTPErrorResponse) {
      logger.debug(
        `OpenStack checks request failed: ${describeRejection(result)}.`,
      );
      return empty;
    }

    const body: JSONObject = (result.data as JSONObject) || {};

    return {
      apiChecks: (
        (Array.isArray(body["apiChecks"]) ? body["apiChecks"] : []) as JSONArray
      ).map((job: unknown): OpenStackApiCheckJob => {
        return job as OpenStackApiCheckJob;
      }),
      lifecycleChecks: (
        (Array.isArray(body["lifecycleChecks"])
          ? body["lifecycleChecks"]
          : []) as JSONArray
      ).map((job: unknown): OpenStackLifecycleCheckJob => {
        return job as OpenStackLifecycleCheckJob;
      }),
    };
  } catch (err) {
    logger.error("Error fetching OpenStack checks");
    logger.error(err);
    return empty;
  }
}

export async function postOpenStackCheckReport(
  report: OpenStackCheckReport,
  dependencies: FetchOpenStackChecksDependencies = DEFAULT_DEPENDENCIES,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/openstack/checks/report",
  );

  /*
   * An API check is said again in a minute. A lifecycle run is not, and what it found took a server
   * and a volume to find.
   */
  const attempts: number = report.kind === "lifecycle" ? REPORT_ATTEMPTS : 1;

  for (let attempt: number = 1; attempt <= attempts; attempt++) {
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
          `The report of OpenStack check ${report.openStackCloudCheckId} was not accepted: ${describeRejection(result)}.`,
        );
      } else {
        const answer: JSONObject = (result.data as JSONObject) || {};

        if (answer["accepted"] === false) {
          // It was heard, and is not wanted: asking again would get the same answer.
          logger.warn(
            `The report of OpenStack check ${report.openStackCloudCheckId} was not accepted: ${String(
              answer["reason"] || "no reason given",
            )}`,
          );
          return false;
        }

        return true;
      }
    } catch (err) {
      logger.error(
        `Error reporting OpenStack check ${report.openStackCloudCheckId}`,
      );
      logger.error(err);
    }

    if (attempt < attempts) {
      await dependencies.sleep(REPORT_RETRY_DELAY_IN_MS);
    }
  }

  return false;
}

function startApiCheck(
  job: OpenStackApiCheckJob,
  dependencies: FetchOpenStackChecksDependencies,
): void {
  if (runningApiChecks.has(job.openStackCloudCheckId)) {
    return;
  }

  const done: Promise<void> = (async (): Promise<void> => {
    try {
      let result: OpenStackApiCheckResult;

      try {
        result = await dependencies.runApiCheck(job);
      } catch (err) {
        // It answers every failure, so this is a bug, and it is still reported.
        logger.error(err);
        result = {
          startedAt: new Date().toISOString(),
          durationInMs: 0,
          regionNames: job.regions,
          token: {
            status: "Failed",
            durationInMs: 0,
            errorCode: OpenStackCollectionErrorCode.Internal,
            message: `The probe hit an unexpected error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
          services: [],
          certificates: [],
          warnings: [],
        };
      }

      await postOpenStackCheckReport(
        {
          openStackCloudCheckId: job.openStackCloudCheckId,
          settingsVersion: job.settingsVersion,
          kind: "api",
          api: result,
        },
        dependencies,
      );
    } finally {
      runningApiChecks.delete(job.openStackCloudCheckId);
    }
  })();

  runningApiChecks.set(job.openStackCloudCheckId, done);
}

function startLifecycleCheck(
  job: OpenStackLifecycleCheckJob,
  dependencies: FetchOpenStackChecksDependencies,
): void {
  if (runningLifecycleChecks.has(job.openStackCloudCheckId)) {
    return;
  }

  const done: Promise<void> = (async (): Promise<void> => {
    try {
      let runs: Array<OpenStackLifecycleRun>;

      try {
        runs = await dependencies.runLifecycleCheck(job);

        logger.debug(
          `OpenStack lifecycle check of ${job.cloudName || job.openStackCloudId}: ${runs
            .map((run: OpenStackLifecycleRun): string => {
              return `${run.regionName} ${run.status}${run.failedStep ? ` at ${run.failedStep}` : ""}`;
            })
            .join(", ")}.`,
        );
      } catch (err) {
        logger.error(err);

        const now: string = new Date().toISOString();

        runs = (job.regions.length > 0 ? job.regions : [""]).map(
          (regionName: string): OpenStackLifecycleRun => {
            return {
              runId: "unknown",
              regionName: regionName,
              startedAt: now,
              finishedAt: now,
              status: "Failed",
              failedStep: OpenStackLifecycleStep.Prepare,
              fault: {
                source: "probe",
                message: `The probe hit an unexpected error: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              },
              steps: [],
              phases: {},
              leftoverCount: 0,
              requestCount: 0,
              writeCount: 0,
              warnings: [],
            };
          },
        );
      }

      await postOpenStackCheckReport(
        {
          openStackCloudCheckId: job.openStackCloudCheckId,
          settingsVersion: job.settingsVersion,
          kind: "lifecycle",
          lifecycle: runs,
        },
        dependencies,
      );
    } finally {
      runningLifecycleChecks.delete(job.openStackCloudCheckId);
    }
  })();

  runningLifecycleChecks.set(job.openStackCloudCheckId, done);
}

// One tick: ask, and start what was handed out. Exported for tests.
export async function runOpenStackChecksTick(
  dependencies: FetchOpenStackChecksDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (isFetchInProgress) {
    logger.debug("Previous OpenStack checks request is still in flight.");
    return;
  }

  isFetchInProgress = true;

  let work: OpenStackCheckWorkResponse;

  try {
    work = await fetchOpenStackChecks();
  } finally {
    isFetchInProgress = false;
  }

  for (const job of work.apiChecks) {
    if (runningApiChecks.size >= OPENSTACK_PROBE_API_CHECK_CONCURRENCY) {
      logger.warn(
        `OpenStack API check ${job.openStackCloudCheckId} skipped: ${OPENSTACK_PROBE_API_CHECK_CONCURRENCY} are already running.`,
      );
      continue;
    }

    startApiCheck(job, dependencies);
  }

  for (const job of work.lifecycleChecks) {
    if (
      runningLifecycleChecks.size >= OPENSTACK_PROBE_LIFECYCLE_CHECK_CONCURRENCY
    ) {
      logger.warn(
        `OpenStack lifecycle check ${job.openStackCloudCheckId} skipped: ${OPENSTACK_PROBE_LIFECYCLE_CHECK_CONCURRENCY} are already running.`,
      );
      continue;
    }

    startLifecycleCheck(job, dependencies);
  }
}

const InitJob: VoidFunction = (): void => {
  /*
   * For the same reason as collection: a credential only ever reaches a probe its own project runs.
   */
  if (
    !isOpenStackCollectionAllowedOnThisProbe({
      isAutoRegisteredGlobalProbe: HasRegisterProbeKey,
      isBillingEnabled: IsBillingEnabled,
    })
  ) {
    return;
  }

  BasicCron({
    jobName: "Probe:OpenStackChecks",
    options: {
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        await runOpenStackChecksTick();
      } catch (err) {
        logger.error("OpenStack checks tick failed");
        logger.error(err);
      }
    },
  });
};

export default InitJob;
