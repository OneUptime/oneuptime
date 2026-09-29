import { PROBE_INGEST_URL } from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import NetworkPathMonitor, {
  NetworkPathMonitorOptions,
} from "../../Utils/Monitors/MonitorTypes/NetworkPathMonitor";
import PingMonitor from "../../Utils/Monitors/MonitorTypes/PingMonitor";
import Hostname from "Common/Types/API/Hostname";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import IP from "Common/Types/IP/IP";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import NetworkPathTrace from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import {
  NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT,
  NetworkDeviceDiagnosticJob,
  NetworkDeviceDiagnosticPingResult,
  NetworkDeviceDiagnosticReport,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import { NetworkDeviceDiagnosticStatus } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";

/*
 * The probe's half of on-demand device diagnostics (issue #3745): the Ping
 * and Traceroute buttons on the topology map and the device page.
 *
 * Every ten seconds, fetch the NetworkDeviceDiagnostic rows the dashboard
 * has created for this probe's devices (the server claims them atomically
 * when handing them out), run each one — a five-packet ping or a traceroute
 * from THIS probe, which is the point: the answer comes from where the
 * device is actually monitored — and post the result back. The dashboard
 * polls the row until it settles.
 *
 * Ten seconds, like the monitor-test job, because somebody is watching a
 * spinner; the device poll's one-minute cadence would be most of the wait.
 */

/*
 * Diagnostics run concurrently in small batches. They are interactive and
 * rare, so the bound is about fault isolation (one traceroute stuck at its
 * 30 s deadline must not hold up the ping somebody else just asked for)
 * rather than throughput; five is well under the claim limit and keeps a
 * burst of traceroutes from forking a pile of processes at once.
 */
export const DIAGNOSTIC_CONCURRENCY: number = 5;

/*
 * Single-flight guard for the LIST FETCH only. node-cron fires every tick
 * regardless of whether the previous one finished, so a fetch stuck on an
 * unresponsive server would otherwise stack six new hung requests a minute.
 *
 * The guard deliberately does NOT cover the diagnostics that follow: the
 * server hands each one out exactly once, so overlapping ticks run disjoint
 * batches — and a traceroute legitimately takes up to its 30 s deadline,
 * which must not delay the pickup of the next person's ping by even a tick.
 */
let isDiagnosticFetchInProgress: boolean = false;

// Exported for tests: lets a wedged-state test reset between cases.
export function resetDiagnosticFetchInProgress(): void {
  isDiagnosticFetchInProgress = false;
}

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:NetworkDeviceDiagnostics",
    options: {
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    },
    runFunction: async () => {
      if (isDiagnosticFetchInProgress) {
        logger.debug(
          "Previous network device diagnostic fetch is still in flight. Skipping this tick.",
        );
        return;
      }

      isDiagnosticFetchInProgress = true;

      let jobs: Array<NetworkDeviceDiagnosticJob> = [];

      try {
        jobs = await fetchDiagnosticList();
      } catch (err) {
        logger.error("Network device diagnostic fetch failed");
        logger.error(err);
      } finally {
        // Release as soon as the fetch settles — see the guard comment.
        isDiagnosticFetchInProgress = false;
      }

      try {
        await runDiagnostics(jobs);
      } catch (err) {
        logger.error("Network device diagnostics failed");
        logger.error(err);
      }
    },
  });
};

/*
 * Exported for tests: fetches (and thereby claims) this probe's pending
 * diagnostics. A failed fetch is an empty batch, logged: the next tick
 * asks again, and nothing claimed was lost because nothing was claimed.
 */
export async function fetchDiagnosticList(): Promise<
  Array<NetworkDeviceDiagnosticJob>
> {
  const listUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/network-device-diagnostic/list",
  );

  try {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: listUrl,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          limit: NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT,
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(listUrl),
      });

    /*
     * API.fetch RETURNS an HTTPErrorResponse for a 4xx/5xx — it only throws
     * when no response arrived at all — so without this check a rejection
     * would be read as an empty batch and the server's reason ("Probe not
     * found", "Invalid Probe ID or Probe Key") never logged. A 404 has one
     * more meaning: a server older than this job has no such route, and the
     * probe would otherwise ask it six times a minute in silence.
     */
    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `Network device diagnostic list request failed: ${describeRejection(result)}. ` +
          "A server that predates on-demand diagnostics answers 404 here; upgrade it to use Ping / Traceroute from the dashboard.",
      );
      return [];
    }

    return (
      ((result.data as JSONObject)?.["diagnostics"] as JSONArray) || []
    ).map((job: JSONObject) => {
      return job as unknown as NetworkDeviceDiagnosticJob;
    });
  } catch (err) {
    logger.error("Error in fetching network device diagnostic list");
    logger.error(err);
    return [];
  }
}

// Exported for tests: runs the handed-out diagnostics in bounded batches.
export async function runDiagnostics(
  jobs: Array<NetworkDeviceDiagnosticJob>,
): Promise<void> {
  if (jobs.length === 0) {
    return;
  }

  logger.debug(`Running ${jobs.length} network device diagnostic(s).`);

  for (
    let batchStart: number = 0;
    batchStart < jobs.length;
    batchStart += DIAGNOSTIC_CONCURRENCY
  ) {
    const batch: Array<NetworkDeviceDiagnosticJob> = jobs.slice(
      batchStart,
      batchStart + DIAGNOSTIC_CONCURRENCY,
    );

    await Promise.allSettled(
      batch.map((job: NetworkDeviceDiagnosticJob) => {
        return runAndReportDiagnostic(job);
      }),
    );
  }
}

// Exported for tests: fetches this probe's pending diagnostics and runs them.
export async function fetchAndRunDiagnostics(): Promise<void> {
  await runDiagnostics(await fetchDiagnosticList());
}

/*
 * A diagnostic without an id cannot be reported, so it cannot be run
 * either: the server would never learn the outcome, and the dashboard would
 * wait on the row until its own timeout regardless. Skip it loudly.
 */
async function runAndReportDiagnostic(
  job: NetworkDeviceDiagnosticJob,
): Promise<void> {
  if (!job.id) {
    logger.warn(
      "Skipping network device diagnostic: the server handed out a job with no id.",
    );
    return;
  }

  await reportDiagnosticResult(await runDiagnostic(job));
}

/*
 * Exported for tests: runs one diagnostic and yields its report.
 *
 * Once claimed, a diagnostic is ALWAYS answered. Whatever goes wrong before
 * a result — a type this probe does not know, a hostname that cannot become
 * a target, a runner that throws — becomes a Failed report with the reason,
 * because the only alternative is a row stuck In Progress and a spinner the
 * person has to give up on. Never throws.
 *
 * A device that simply does not answer is NOT a failure: that is a
 * Completed ping with isOnline false, or a Completed trace whose
 * failureMessage says where the path broke. The dashboard explains those.
 */
export async function runDiagnostic(
  job: NetworkDeviceDiagnosticJob,
): Promise<NetworkDeviceDiagnosticReport> {
  try {
    if (!job.hostname || !job.hostname.trim()) {
      return buildFailedReport(
        job,
        "This device has no hostname or IP address to reach.",
      );
    }

    if (job.diagnosticType === NetworkDeviceDiagnosticType.Ping) {
      return await runPingDiagnostic(job);
    }

    if (job.diagnosticType === NetworkDeviceDiagnosticType.Traceroute) {
      return await runTracerouteDiagnostic(job);
    }

    return buildFailedReport(
      job,
      `Unsupported diagnostic type "${job.diagnosticType}". This probe supports Ping and Traceroute.`,
    );
  } catch (err) {
    const message: string = (err as Error).message || String(err);

    logger.error(
      `Network device diagnostic ${job.id} (${job.diagnosticType} ${job.hostname}) failed: ${message}`,
    );

    return buildFailedReport(job, message);
  }
}

async function runPingDiagnostic(
  job: NetworkDeviceDiagnosticJob,
): Promise<NetworkDeviceDiagnosticReport> {
  let target: Hostname | IPv4 | IPv6;

  try {
    target = buildPingTarget(job.hostname);
  } catch {
    /*
     * A BadDataException from the argv guard or from Hostname: the device's
     * address is neither an IP nor a plain DNS name, so there is nothing to
     * ping. The person needs the plain reason, not the validator's wording.
     */
    return buildFailedReport(
      job,
      `"${job.hostname}" is not a valid hostname or IP address.`,
    );
  }

  const pingResult: NetworkDeviceDiagnosticPingResult =
    await PingMonitor.runDiagnosticPing({
      host: target,
      packetCount: job.packetCount,
      timeoutMs: job.timeoutInMs,
    });

  return {
    networkDeviceDiagnosticId: job.id,
    status: NetworkDeviceDiagnosticStatus.Completed,
    pingResult: pingResult,
  };
}

/*
 * NetworkPathMonitor.trace never rejects: an unusable destination, a
 * missing traceroute binary or a hit deadline all come back as a trace
 * whose traceRoute carries the failureMessage (and maybe zero hops). That
 * is still a Completed diagnostic — the message IS the result, and the
 * dashboard renders it as such.
 */
async function runTracerouteDiagnostic(
  job: NetworkDeviceDiagnosticJob,
): Promise<NetworkDeviceDiagnosticReport> {
  const options: NetworkPathMonitorOptions = {
    timeout: job.timeoutInMs,
    // Only when the server sent one, so trace() applies its own default.
    ...(job.maxHops !== undefined ? { maxHops: job.maxHops } : {}),
  };

  const trace: NetworkPathTrace = await NetworkPathMonitor.trace(
    job.hostname,
    options,
  );

  return {
    networkDeviceDiagnosticId: job.id,
    status: NetworkDeviceDiagnosticStatus.Completed,
    traceRouteResult: trace,
  };
}

/*
 * Exported for tests: posts one report back. A failed post is logged and
 * swallowed — the batch must keep going, and the row's claim window means
 * the dashboard stops waiting on its own; there is nothing to retry into.
 *
 * "Failed" covers two shapes: a throw (no response at all) and a returned
 * HTTPErrorResponse (the server answered and said no — "Diagnostic not
 * found for this probe", a validation 400). API.fetch does not throw on the
 * second, so it is checked explicitly; a row the server refused to settle
 * stays In Progress with the reason known only to this probe, and the log
 * line is the only place it can surface.
 */
export async function reportDiagnosticResult(
  report: NetworkDeviceDiagnosticReport,
): Promise<void> {
  const ingestUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/network-device-diagnostic/response/ingest",
  );

  try {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: ingestUrl,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          ...(report as unknown as JSONObject),
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(ingestUrl),
      });

    if (result instanceof HTTPErrorResponse) {
      logger.error(
        `Network device diagnostic ${report.networkDeviceDiagnosticId} report was rejected: ${describeRejection(result)}`,
      );
      return;
    }
  } catch (err) {
    logger.error(
      `Failed to report network device diagnostic ${report.networkDeviceDiagnosticId}: ${err}`,
    );
  }
}

/*
 * The server's own words for a rejected request, in the same shape the
 * discovery job's getRejectionReason uses ("HTTP 404 — Not Found"), so the
 * two jobs' log lines read alike. The dash is dropped when the body carried
 * no message rather than printing a dangling "HTTP 500 — ". Local rather
 * than imported from FetchScans: that module drags the whole discovery
 * runner in for one string.
 */
function describeRejection(result: HTTPErrorResponse): string {
  const serverMessage: string = result.message;

  return (
    `HTTP ${result.statusCode}` + (serverMessage ? ` — ${serverMessage}` : "")
  );
}

function buildFailedReport(
  job: NetworkDeviceDiagnosticJob,
  statusMessage: string,
): NetworkDeviceDiagnosticReport {
  return {
    networkDeviceDiagnosticId: job.id,
    status: NetworkDeviceDiagnosticStatus.Failed,
    statusMessage: statusMessage,
  };
}

/*
 * What a bare ping target must not contain. Hostname.isValid accepts a full
 * URL authority — "user@host", "host:port", "[::1]", whitespace inside the
 * userinfo — because webhook URLs need those and the values are already
 * stored; `new Hostname` then keeps the WHOLE string as .hostname, and the
 * ping runner puts that string into ping(8)'s argv verbatim. None of these
 * characters can appear in a DNS name, so rejecting them costs nothing.
 */
const PING_TARGET_FORBIDDEN_CHARS_REGEX: RegExp = /[@:[\]/\s]/;

/*
 * A leading "-" would be read by ping(8) as an option, not a host. Hostname
 * happens to reject it today (a label may not start with "-"), but argv
 * safety must not hang on the details of a URL validator.
 */
const PING_TARGET_LEADING_DASH_REGEX: RegExp = /^-/;

/*
 * The typed ping target — the same rule as the device poll's
 * buildPingTarget in ./FetchList.ts, which explains it: an IP literal must
 * become IPv4/IPv6 so the ping library picks the right binary, and a DNS
 * name goes through `new Hostname` (never Hostname.fromString, which would
 * split a colon-bearing value at the first ":" looking for a port). Throws
 * BadDataException on a value that is neither — and, before Hostname gets
 * a say, on an authority-shaped value that Hostname would let through but
 * that is not a plain host (see the two regexes above).
 */
function buildPingTarget(host: string): Hostname | IPv4 | IPv6 {
  if (IP.isIP(host)) {
    // isIP passed, so a colon can only mean an IPv6 literal.
    return host.includes(":") ? new IPv6(host) : new IPv4(host);
  }

  if (
    PING_TARGET_FORBIDDEN_CHARS_REGEX.test(host) ||
    PING_TARGET_LEADING_DASH_REGEX.test(host)
  ) {
    throw new BadDataException(
      `"${host}" is not a plain hostname or IP address, so it cannot be pinged.`,
    );
  }

  return new Hostname(host);
}

export default InitJob;
