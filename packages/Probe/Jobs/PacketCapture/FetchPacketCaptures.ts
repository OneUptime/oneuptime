import {
  PROBE_API_REQUEST_TIMEOUT_IN_MS,
  PROBE_INGEST_URL,
  PROBE_PACKET_CAPTURE_SETTINGS,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import {
  PacketCaptureRunResult,
  RunPacketCaptureOptions,
  runPacketCapture,
} from "../../Utils/PacketCapture/PacketCaptureRunner";
import { PacketCaptureSettings } from "../../Utils/PacketCapture/PacketCaptureSettings";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  PACKET_CAPTURE_PROBE_CONCURRENCY,
  PacketCaptureJob,
  PacketCaptureListResponse,
  PacketCaptureReport,
} from "Common/Types/PacketCapture/PacketCaptureJob";
import PacketCaptureStatus from "Common/Types/PacketCapture/PacketCaptureStatus";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";

/*
 * The probe's half of packet capture, every ten seconds while captures are
 * turned on (PROBE_PACKET_CAPTURE_ENABLED):
 *
 *   1. ask for work, naming the captures this probe is running - which also
 *      tells OneUptime they are alive - and how many more it can take;
 *   2. stop the running ones the answer names (someone pressed Stop, or the
 *      capture was deleted);
 *   3. start the new ones, at most PACKET_CAPTURE_PROBE_CONCURRENCY at once;
 *   4. as each one ends, upload its file - or say why it failed.
 *
 * A capture that was handed out is ALWAYS answered: whatever goes wrong
 * running it becomes a Failed report with the reason, because the only
 * alternative is a capture that says Running until the server gives up on
 * it.
 */

// How long one upload may take: 25 MB over a slow site link, and then some.
export const UPLOAD_TIMEOUT_IN_MS: number = 8 * 60 * 1000;

interface RunningCapture {
  controller: AbortController;
  done: Promise<void>;
}

const runningCaptures: Map<string, RunningCapture> = new Map();

/*
 * One list request at a time: node-cron fires every tick whether or not
 * the last one finished, and a stuck request must not pile up more. The
 * captures themselves run outside it.
 */
let isFetchInProgress: boolean = false;

// What a capture run needs; replaced in tests.
export interface FetchDependencies {
  settings: PacketCaptureSettings;
  run: (options: RunPacketCaptureOptions) => Promise<PacketCaptureRunResult>;
}

const DEFAULT_DEPENDENCIES: FetchDependencies = {
  settings: PROBE_PACKET_CAPTURE_SETTINGS,
  run: runPacketCapture,
};

// Exported for tests.
export function resetPacketCaptureState(): void {
  isFetchInProgress = false;
  runningCaptures.clear();
}

// Exported for tests: the ids of the captures this probe is running.
export function getRunningPacketCaptureIds(): Array<string> {
  return Array.from(runningCaptures.keys());
}

// Exported for tests: resolves when every running capture has reported.
export async function waitForRunningCaptures(): Promise<void> {
  await Promise.all(
    Array.from(runningCaptures.values()).map(
      (capture: RunningCapture): Promise<void> => {
        return capture.done;
      },
    ),
  );
}

function describeRejection(result: HTTPErrorResponse): string {
  return (
    `HTTP ${result.statusCode}` + (result.message ? ` - ${result.message}` : "")
  );
}

/*
 * Asks for new captures and which running ones to stop. A failed request
 * is an empty answer, logged: nothing was claimed, and the next tick asks
 * again.
 */
export async function fetchPacketCaptures(data: {
  limit: number;
  runningPacketCaptureIds: Array<string>;
}): Promise<PacketCaptureListResponse> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/packet-capture/list",
  );

  const empty: PacketCaptureListResponse = {
    packetCaptures: [],
    stopPacketCaptureIds: [],
  };

  try {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          limit: data.limit,
          runningPacketCaptureIds: data.runningPacketCaptureIds,
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(url),
      });

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `Packet capture list request failed: ${describeRejection(result)}. A server older than packet capture answers 404 here.`,
      );
      return empty;
    }

    const body: JSONObject = (result.data as JSONObject) || {};

    return {
      packetCaptures: (
        (Array.isArray(body["packetCaptures"])
          ? body["packetCaptures"]
          : []) as JSONArray
      ).map((job: unknown): PacketCaptureJob => {
        return job as PacketCaptureJob;
      }),
      stopPacketCaptureIds: (Array.isArray(body["stopPacketCaptureIds"])
        ? (body["stopPacketCaptureIds"] as Array<unknown>)
        : []
      ).filter((id: unknown): id is string => {
        return typeof id === "string";
      }),
    };
  } catch (err) {
    logger.error("Error fetching packet captures");
    logger.error(err);
    return empty;
  }
}

/*
 * Posts how a capture ended. A rejected report is logged, not retried: the
 * server refuses a capture that was deleted or timed out meanwhile, and
 * nothing the probe sends again would change that.
 */
export async function reportPacketCapture(
  report: PacketCaptureReport,
): Promise<void> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/packet-capture/response/ingest",
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
        options: {
          ...ProbeAPIRequest.getDefaultRequestOptions(url, {
            timeout: Math.max(PROBE_API_REQUEST_TIMEOUT_IN_MS, UPLOAD_TIMEOUT_IN_MS),
          }),
          // A capture file is far larger than any other probe request.
          maxBodyLength: Infinity,
        },
      });

    if (result instanceof HTTPErrorResponse) {
      logger.error(
        `Packet capture ${report.packetCaptureId} report was rejected: ${describeRejection(result)}`,
      );
    }
  } catch (err) {
    logger.error(
      `Failed to report packet capture ${report.packetCaptureId}: ${(err as Error).message || String(err)}`,
    );
  }
}

// The report a run's result becomes.
export function toReport(
  packetCaptureId: string,
  result: PacketCaptureRunResult,
): PacketCaptureReport {
  if (result.isFailure) {
    return {
      packetCaptureId: packetCaptureId,
      status: PacketCaptureStatus.Failed,
      statusMessage:
        result.failureMessage || "The probe could not run this capture.",
    };
  }

  const report: PacketCaptureReport = {
    packetCaptureId: packetCaptureId,
    status: PacketCaptureStatus.Completed,
    endReason: result.endReason,
  };

  if (result.statusMessage) {
    report.statusMessage = result.statusMessage;
  }

  if (result.pcap && result.pcap.length > 0) {
    report.pcapBase64 = result.pcap.toString("base64");
  }

  return report;
}

async function runAndReport(data: {
  job: PacketCaptureJob;
  signal: AbortSignal;
  dependencies: FetchDependencies;
}): Promise<void> {
  let result: PacketCaptureRunResult;

  try {
    result = await data.dependencies.run({
      job: data.job,
      limits: data.dependencies.settings.limits,
      signal: data.signal,
    });
  } catch (err) {
    result = {
      isFailure: true,
      failureMessage: `The probe could not run this capture: ${(err as Error).message || String(err)}`,
      pcap: null,
      packetCount: 0,
    };
  }

  logger.info(
    result.isFailure
      ? `Packet capture ${data.job.id} failed: ${result.failureMessage}`
      : `Packet capture ${data.job.id} on ${data.job.interfaceName} ended (${result.endReason}): ${result.packetCount} packet(s).`,
  );

  await reportPacketCapture(toReport(data.job.id, result));
}

function startCapture(
  job: PacketCaptureJob,
  dependencies: FetchDependencies,
): void {
  if (!job || typeof job.id !== "string" || !job.id) {
    logger.warn("Skipping a packet capture the server handed out with no id.");
    return;
  }

  if (runningCaptures.has(job.id)) {
    return;
  }

  const controller: AbortController = new AbortController();

  const done: Promise<void> = runAndReport({
    job: job,
    signal: controller.signal,
    dependencies: dependencies,
  })
    .catch((err: Error) => {
      logger.error(`Packet capture ${job.id} could not be reported`);
      logger.error(err);
    })
    .finally(() => {
      runningCaptures.delete(job.id);
    });

  runningCaptures.set(job.id, { controller: controller, done: done });

  logger.info(
    `Packet capture ${job.id} started on ${job.interfaceName}${job.bpfFilter ? ` (${job.bpfFilter})` : ""}.`,
  );
}

// Exported for tests: one tick, exactly as the cron runs it.
export async function fetchAndRunPacketCaptures(
  dependencies: FetchDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (isFetchInProgress) {
    logger.debug(
      "Previous packet capture fetch is still in flight. Skipping this tick.",
    );
    return;
  }

  isFetchInProgress = true;

  let response: PacketCaptureListResponse;

  try {
    response = await fetchPacketCaptures({
      limit: Math.max(
        0,
        PACKET_CAPTURE_PROBE_CONCURRENCY - runningCaptures.size,
      ),
      runningPacketCaptureIds: getRunningPacketCaptureIds(),
    });
  } finally {
    isFetchInProgress = false;
  }

  for (const id of response.stopPacketCaptureIds) {
    const capture: RunningCapture | undefined = runningCaptures.get(id);

    if (capture && !capture.controller.signal.aborted) {
      logger.info(`Stopping packet capture ${id}, as OneUptime asked.`);
      capture.controller.abort();
    }
  }

  for (const job of response.packetCaptures) {
    if (runningCaptures.size >= PACKET_CAPTURE_PROBE_CONCURRENCY) {
      /*
       * The server hands out no more than the slots this probe said it had,
       * so this is a capture it cannot have meant; say so rather than drop it.
       */
      await reportPacketCapture({
        packetCaptureId: job.id,
        status: PacketCaptureStatus.Failed,
        statusMessage: `The probe is already running ${PACKET_CAPTURE_PROBE_CONCURRENCY} captures.`,
      });
      continue;
    }

    startCapture(job, dependencies);
  }
}

const InitJob: VoidFunction = (): void => {
  if (!PROBE_PACKET_CAPTURE_SETTINGS.isEnabled) {
    return;
  }

  BasicCron({
    jobName: "Probe:PacketCaptures",
    options: {
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    },
    runFunction: async (): Promise<void> => {
      await fetchAndRunPacketCaptures();
    },
  });
};

export default InitJob;
