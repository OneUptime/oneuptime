import {
  HasRegisterProbeKey,
  PROBE_API_REQUEST_TIMEOUT_IN_MS,
  PROBE_INGEST_URL,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import ServerBusy from "../../Utils/ServerBusy";
import XapiCollector from "../../Utils/XcpNg/XapiCollector";
import XenOrchestraCollector from "../../Utils/XcpNg/XenOrchestraCollector";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import {
  XCP_NG_PROBE_COLLECTION_CONCURRENCY,
  XcpNgCollectionJob,
  XcpNgCollectionReport,
  XcpNgConnectionTestJob,
  XcpNgConnectionTestReport,
  XcpNgProbeWorkResponse,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import zlib from "zlib";

/*
 * The probe's half of reading XCP-ng without an agent (#10996, #10999),
 * every ten seconds - the vCenter work loop's (FetchVMwareWork), shape for
 * shape:
 *
 *   1. ask for work, naming the reads still running - the server hands out
 *      no connection twice, and none of those again;
 *   2. read each connection handed out - a Xen Orchestra
 *      (XenOrchestraCollector) or a pool's XAPI (XapiCollector) - at most
 *      XCP_NG_PROBE_COLLECTION_CONCURRENCY at once, and report it: its
 *      status, and its metrics gzip-compressed;
 *   3. run each connection test handed out and report it.
 *
 * Every connection and test handed out is answered: whatever goes wrong
 * becomes a Failed report with the reason. A report the server refuses
 * (the connection moved to another probe meanwhile) is logged, not retried.
 * A secret is never written to a log line.
 */

// How long one report upload may take: megabytes over a slow site link.
export const XCP_NG_REPORT_UPLOAD_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

// The work the work request hands out, as a busy answer names it (ServerBusy).
const XCP_NG_WORK: string = "XCP-ng collections";

const runningCollections: Map<string, Promise<void>> = new Map();
const runningTests: Set<string> = new Set();

let isFetchInProgress: boolean = false;

// What a read or a test needs; replaced in tests.
export interface FetchXcpNgWorkDependencies {
  collect: (job: XcpNgCollectionJob) => Promise<XcpNgCollectionReport>;
  test: (job: XcpNgConnectionTestJob) => Promise<XcpNgConnectionTestReport>;
}

const DEFAULT_DEPENDENCIES: FetchXcpNgWorkDependencies = {
  collect: (job: XcpNgCollectionJob): Promise<XcpNgCollectionReport> => {
    return job.connectionType === XcpNgConnectionType.Xapi
      ? XapiCollector.collect(job)
      : XenOrchestraCollector.collect(job);
  },
  test: (job: XcpNgConnectionTestJob): Promise<XcpNgConnectionTestReport> => {
    return job.connectionType === XcpNgConnectionType.Xapi
      ? XapiCollector.test(job)
      : XenOrchestraCollector.test(job);
  },
};

// Exported for tests.
export function resetXcpNgWorkState(): void {
  isFetchInProgress = false;
  runningCollections.clear();
  runningTests.clear();
}

// Exported for tests: the connections this probe is reading right now.
export function getRunningXcpNgConnectionIds(): Array<string> {
  return Array.from(runningCollections.keys());
}

// Exported for tests: resolves when every running read has reported.
export async function waitForRunningXcpNgCollections(): Promise<void> {
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
export async function fetchXcpNgWork(): Promise<XcpNgProbeWorkResponse> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/xcp-ng/work",
  );

  const empty: XcpNgProbeWorkResponse = { collections: [], tests: [] };

  // The server asked this probe to wait (ServerBusy): it asks later.
  if (ServerBusy.isBackingOff(XCP_NG_WORK)) {
    return empty;
  }

  try {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          runningXcpNgConnectionIds: getRunningXcpNgConnectionIds(),
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(url),
      });

    if (ServerBusy.isBusyAnswer(result)) {
      ServerBusy.note(XCP_NG_WORK, result);
      return empty;
    }

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `XCP-ng work request failed: ${describeRejection(result)}. A server older than XCP-ng collection answers 404 here.`,
      );
      return empty;
    }

    const body: JSONObject = (result.data as JSONObject) || {};

    return {
      collections: (
        (Array.isArray(body["collections"])
          ? body["collections"]
          : []) as JSONArray
      ).map((job: unknown): XcpNgCollectionJob => {
        return job as XcpNgCollectionJob;
      }),
      tests: (
        (Array.isArray(body["tests"]) ? body["tests"] : []) as JSONArray
      ).map((job: unknown): XcpNgConnectionTestJob => {
        return job as XcpNgConnectionTestJob;
      }),
    };
  } catch (err) {
    logger.error("Error fetching XCP-ng work");
    logger.error(err);
    return empty;
  }
}

/*
 * Posts a collection report, gzip-compressed: a large Xen Orchestra's
 * metrics are megabytes of JSON. The probe's id and key travel in headers as
 * well as in the body, so the server checks the key before it reads the
 * report (ProbeAPIRequest.getProbeKeyHeaders). Returns whether the server
 * accepted it.
 */
export async function postXcpNgCollectionReport(
  report: XcpNgCollectionReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/xcp-ng/collection",
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
              XCP_NG_REPORT_UPLOAD_TIMEOUT_IN_MS,
            ),
          }),
          maxBodyLength: Infinity,
        },
      });

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `The collection report of XCP-ng connection ${report.xcpNgConnectionId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    const answer: JSONObject = (result.data as JSONObject) || {};

    if (answer["accepted"] === false) {
      logger.warn(
        `The collection report of XCP-ng connection ${report.xcpNgConnectionId} was not accepted: ${String(
          answer["reason"] || "no reason given",
        )}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.error(
      `Error reporting the collection of XCP-ng connection ${report.xcpNgConnectionId}`,
    );
    logger.error(err);
    return false;
  }
}

export async function postXcpNgTestReport(
  report: XcpNgConnectionTestReport,
): Promise<boolean> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/xcp-ng/test",
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
        `The XCP-ng connection test report ${report.xcpNgConnectionTestId} was not accepted: ${describeRejection(result)}.`,
      );
      return false;
    }

    return (result.data as JSONObject)?.["accepted"] !== false;
  } catch (err) {
    logger.error(
      `Error reporting XCP-ng connection test ${report.xcpNgConnectionTestId}`,
    );
    logger.error(err);
    return false;
  }
}

function startCollection(
  job: XcpNgCollectionJob,
  dependencies: FetchXcpNgWorkDependencies,
): void {
  if (runningCollections.has(job.xcpNgConnectionId)) {
    return;
  }

  const done: Promise<void> = (async (): Promise<void> => {
    try {
      const report: XcpNgCollectionReport = await dependencies.collect(job);

      logger.debug(
        `XCP-ng collection of ${job.connectionName || job.xcpNgConnectionId}: ${report.status}${
          report.errorCode ? ` (${report.errorCode})` : ""
        } in ${report.durationInMs} ms.`,
      );

      await postXcpNgCollectionReport(report);
    } catch (err) {
      // collect() answers every failure; this is a bug, still reported.
      logger.error(err);
      await postXcpNgCollectionReport({
        xcpNgConnectionId: job.xcpNgConnectionId,
        settingsVersion: job.settingsVersion,
        collectedAt: new Date().toISOString(),
        status: "Failed",
        errorMessage: `The probe hit an unexpected error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationInMs: 0,
      });
    } finally {
      runningCollections.delete(job.xcpNgConnectionId);
    }
  })();

  runningCollections.set(job.xcpNgConnectionId, done);
}

async function runTest(
  job: XcpNgConnectionTestJob,
  dependencies: FetchXcpNgWorkDependencies,
): Promise<void> {
  if (runningTests.has(job.xcpNgConnectionTestId)) {
    return;
  }

  runningTests.add(job.xcpNgConnectionTestId);

  try {
    let report: XcpNgConnectionTestReport;

    try {
      report = await dependencies.test(job);
    } catch (err) {
      logger.error(err);
      report = {
        xcpNgConnectionTestId: job.xcpNgConnectionTestId,
        status: "Failed",
        errorMessage: `The probe hit an unexpected error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationInMs: 0,
      };
    }

    await postXcpNgTestReport(report);
  } finally {
    runningTests.delete(job.xcpNgConnectionTestId);
  }
}

// One tick: ask for work, start what was handed out. Exported for tests.
export async function runXcpNgWorkTick(
  dependencies: FetchXcpNgWorkDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (isFetchInProgress) {
    logger.debug("Previous XCP-ng work request is still in flight.");
    return;
  }

  isFetchInProgress = true;

  let work: XcpNgProbeWorkResponse;

  try {
    work = await fetchXcpNgWork();
  } finally {
    isFetchInProgress = false;
  }

  for (const job of work.collections) {
    if (runningCollections.size >= XCP_NG_PROBE_COLLECTION_CONCURRENCY) {
      logger.warn(
        `XCP-ng collection of ${job.xcpNgConnectionId} skipped: ${XCP_NG_PROBE_COLLECTION_CONCURRENCY} collections are already running.`,
      );
      continue;
    }

    startCollection(job, dependencies);
  }

  /*
   * Tests are a person waiting in the dashboard: they run at once, beside
   * the reads, and the tick does not wait for them.
   */
  for (const job of work.tests) {
    runTest(job, dependencies).catch((err: Error) => {
      logger.error(err);
    });
  }
}

/*
 * Whether this probe reads XCP-ng at all. A global probe of the hosted,
 * open-signup product (registered with REGISTER_PROBE_KEY, BILLING_ENABLED
 * in its own environment) never does: every sign-up shares it, and an
 * XCP-ng secret only ever reaches a probe its own project runs. The server
 * never hands such a probe a connection or a test; it does not even ask. A
 * self-hosted instance's global probes are its operator's own, and read.
 */
export function isXcpNgCollectionAllowedOnThisProbe(data: {
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
}): boolean {
  return !(data.isAutoRegisteredGlobalProbe && data.isBillingEnabled);
}

const InitJob: VoidFunction = (): void => {
  if (
    !isXcpNgCollectionAllowedOnThisProbe({
      isAutoRegisteredGlobalProbe: HasRegisterProbeKey,
      isBillingEnabled: IsBillingEnabled,
    })
  ) {
    logger.info(
      "XCP-ng collection is off on this probe: a global probe of a billing-enabled instance never receives XCP-ng secrets.",
    );
    return;
  }

  BasicCron({
    jobName: "Probe:XcpNgWork",
    options: {
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        await runXcpNgWorkTick();
      } catch (err) {
        logger.error("XCP-ng work tick failed");
        logger.error(err);
      }
    },
  });
};

export default InitJob;
