import {
  PROBE_INGEST_URL,
  PROBE_NETWORK_DEVICE_POLL_CONCURRENCY,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import PingMonitor, {
  DeviceReachabilityCheck,
} from "../../Utils/Monitors/MonitorTypes/PingMonitor";
import SnmpMonitor from "../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import Hostname from "Common/Types/API/Hostname";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IP from "Common/Types/IP/IP";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import API from "Common/Utils/API";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";

/*
 * The probe's half of device-owned polling: every minute, fetch the
 * NetworkDevices assigned to this probe that are due for a poll (the
 * server claims them atomically and hydrates whatever SNMP credentials the
 * device or its site carry into a concrete config), poll each one, and
 * report the results back.
 *
 * A poll is ping-first. Every device is pinged; a device with usable SNMP
 * credentials is ALSO walked, in parallel, and the two verdicts are
 * reported side by side so the server can tell "unreachable" from "SNMP is
 * broken" — a device that filters ICMP but answers SNMP is Up, and a device
 * that answers ping but has a wrong community is Up with a failing walk.
 *
 * Monitors play no part here — Network Device monitors are evaluated
 * server-side from these poll results. A registered device gets polled,
 * inventoried, and charted even when nothing alerts on it.
 */

/*
 * Polls run concurrently in batches: one slow device must not starve the
 * rest of the batch, but an unbounded parallel burst of SNMP table walks
 * from one probe process would compete for sockets and CPU.
 *
 * Tunable (PROBE_NETWORK_DEVICE_POLL_CONCURRENCY) because it is one half of
 * how fast a fleet can be polled — see the constant's definition in Config
 * for how it pairs with the server's claim batch size.
 */
const DEVICE_POLL_CONCURRENCY: number = PROBE_NETWORK_DEVICE_POLL_CONCURRENCY;

/*
 * Per-reply wait for the ping when the device carries no SNMP timeout to
 * borrow (ping-only devices). Same figure as the SNMP step default, so a
 * device's poll budget does not change when credentials are added.
 */
const DEFAULT_DEVICE_PING_TIMEOUT_IN_MS: number = 5000;

/*
 * How a device is polled. "ping": ICMP only — the device has no usable SNMP
 * credentials. "snmp": pinged AND walked. The server decides per device from
 * the credentials it resolved; the probe reports the mode it actually ran
 * so the server knows whether a missing snmpResponse means "no walk was
 * asked for" rather than "the walk went missing".
 */
export type NetworkDevicePollMode = "ping" | "snmp";

export interface DevicePollConfig {
  networkDeviceId: string;
  projectId: string | undefined;
  /*
   * The address the probe pings. Servers that predate ping-first polling
   * send it only inside snmpMonitor; resolvePollHost falls back to that.
   */
  hostname?: string | undefined;
  /*
   * Absent from servers that predate ping-first polling. Those only ever
   * hand out devices with an SNMP config, so absence means "snmp" whenever
   * one is present — see resolvePollMode.
   */
  pollMode?: NetworkDevicePollMode | undefined;
  collectEndpoints: boolean;
  // Emitted only for snmp mode: the hydrated credentials for the walk.
  snmpMonitor?: MonitorStepSnmpMonitor | undefined;
}

/*
 * Single-flight guard for the LIST FETCH only. node-cron fires every tick
 * regardless of whether the previous one finished, so a fetch stuck on an
 * unresponsive server would otherwise stack a new hung request per minute.
 *
 * The guard deliberately does NOT cover the polling that follows: the
 * server claims due devices atomically when handing out the list, so
 * overlapping ticks poll disjoint device sets — that pipelining is what
 * keeps a fleet whose poll cycle exceeds a minute (slow or unreachable
 * devices) polling at its configured cadence.
 */
let isDeviceFetchInProgress: boolean = false;

// Exported for tests: lets a wedged-state test reset between cases.
export function resetDevicePollRunInProgress(): void {
  isDeviceFetchInProgress = false;
}

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:NetworkDeviceFetchList",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: true,
    },
    runFunction: async () => {
      if (isDeviceFetchInProgress) {
        logger.debug(
          "Previous network device list fetch is still in flight. Skipping this tick.",
        );
        return;
      }

      isDeviceFetchInProgress = true;

      let devices: Array<DevicePollConfig> = [];

      try {
        devices = await fetchDeviceList();
      } catch (err) {
        logger.error("Network device poll fetch failed");
        logger.error(err);
      } finally {
        // Release as soon as the fetch settles — see the guard comment.
        isDeviceFetchInProgress = false;
      }

      try {
        await pollDevices(devices);
      } catch (err) {
        logger.error("Network device poll failed");
        logger.error(err);
      }
    },
  });
};

// Exported for tests: fetches this probe's due devices from the server.
export async function fetchDeviceList(): Promise<Array<DevicePollConfig>> {
  const listUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/network-device/list",
  );

  const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.fetch<JSONObject>({
      method: HTTPMethod.POST,
      url: listUrl,
      data: {
        /*
         * Carries probeCapabilities ("networkDevicePing"): without it the
         * server keeps ping-only devices back from this probe.
         */
        ...ProbeAPIRequest.getDefaultRequestBody(),
      },
      headers: {},
      options: ProbeAPIRequest.getDefaultRequestOptions(listUrl),
    });

  return (((result.data as JSONObject)?.["devices"] as JSONArray) || []).map(
    (device: JSONObject) => {
      return device as unknown as DevicePollConfig;
    },
  );
}

// Exported for tests: polls the handed-out devices in bounded batches.
export async function pollDevices(
  devices: Array<DevicePollConfig>,
): Promise<void> {
  if (devices.length === 0) {
    return;
  }

  logger.debug(`Polling ${devices.length} network device(s).`);

  for (
    let batchStart: number = 0;
    batchStart < devices.length;
    batchStart += DEVICE_POLL_CONCURRENCY
  ) {
    const batch: Array<DevicePollConfig> = devices.slice(
      batchStart,
      batchStart + DEVICE_POLL_CONCURRENCY,
    );

    await Promise.allSettled(
      batch.map((device: DevicePollConfig) => {
        return pollDevice(device);
      }),
    );
  }
}

// Exported for tests: fetches this probe's due devices and polls them.
export async function fetchAndPollDevices(): Promise<void> {
  await pollDevices(await fetchDeviceList());
}

/*
 * The address to poll. Newer servers put it on the device; older ones only
 * inside the SNMP config. Either is fine — only a device with NEITHER is
 * unpollable.
 */
function resolvePollHost(device: DevicePollConfig): string | undefined {
  return device.hostname || device.snmpMonitor?.hostname || undefined;
}

/*
 * The mode this poll will actually run in.
 *
 * A server that predates ping-first polling sends no pollMode and only ever
 * hands out credentialed devices, so "no pollMode, SNMP config present" is
 * an snmp poll — the same walk it always got, now with a ping beside it.
 *
 * "snmp" without a config to walk cannot be honoured, so it degrades to a
 * ping poll and is reported as one: the server reads pollMode as what the
 * probe DID, and an "snmp" report with no snmpResponse would be a lie about
 * why the walk is missing.
 */
function resolvePollMode(device: DevicePollConfig): NetworkDevicePollMode {
  if (device.pollMode === "snmp") {
    if (device.snmpMonitor) {
      return "snmp";
    }

    logger.warn(
      `Device ${device.networkDeviceId} was handed out for an SNMP poll without an SNMP config; pinging only.`,
    );
    return "ping";
  }

  if (device.pollMode === "ping") {
    return "ping";
  }

  return device.snmpMonitor?.hostname ? "snmp" : "ping";
}

/*
 * The typed ping target. An IP literal must become IPv4/IPv6 (the ping
 * library needs to know which binary to run); anything else is a DNS name.
 *
 * `new Hostname`, never Hostname.fromString: fromString splits on the first
 * ":" to find a port, which would shred any colon-bearing value that is not
 * an IP literal by isIP's rules (a zone-scoped "fe80::1%eth0", say) into a
 * host of "fe80" and a port of garbage. Throws (BadDataException) on a value
 * that is neither an IP nor a valid hostname — pollDevice reports that as
 * the poll's failure rather than skipping the device.
 */
function buildPingTarget(host: string): Hostname | IPv4 | IPv6 {
  if (IP.isIP(host)) {
    // isIP passed, so a colon can only mean an IPv6 literal.
    return host.includes(":") ? new IPv6(host) : new IPv4(host);
  }

  return new Hostname(host);
}

/*
 * The SNMP walk, wrapped so it can never reject: whatever happens it yields
 * a response the server can ingest, because a walk that ran must be
 * reported even when it failed (isSnmpReachable false is a real verdict).
 */
async function walkDevice(
  device: DevicePollConfig,
  snmpMonitor: MonitorStepSnmpMonitor,
): Promise<SnmpMonitorResponse> {
  try {
    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      snmpMonitor,
      {
        timeout: snmpMonitor.timeout || DEFAULT_DEVICE_PING_TIMEOUT_IN_MS,
        /*
         * ARP/FDB endpoint collection rides the interface walk. Strictly
         * OPT-IN (extra SNMP table walks per poll): only an explicit true
         * from the device's collectEndpoints column enables it.
         */
        collectEndpoints: device.collectEndpoints === true,
      },
    );

    if (!response) {
      // The query util retries internally; null means it gave up entirely.
      return buildFailureResponse("SNMP query returned no response");
    }

    return response;
  } catch (err) {
    return buildFailureResponse((err as Error).message || String(err));
  }
}

/*
 * Exported for tests: polls one device and reports the outcome back.
 *
 * The ping and (in snmp mode) the walk run IN PARALLEL, and the walk is
 * never gated on the ping: gear that filters ICMP but answers SNMP must
 * stay Up, and a device that answers ping with a broken community must
 * show a failing walk — neither is knowable from the ping alone.
 *
 * Once a device has an id and an address, this function ALWAYS reports.
 * Whatever throws before a verdict (an address that is neither an IP nor
 * a valid hostname is the realistic case) becomes a failure body: the
 * server only ever marks a device unreachable because a report says so,
 * and a device the probe stays silent about keeps its previous verdict —
 * which, for a device that just went dark, means it is never marked down.
 */
export async function pollDevice(device: DevicePollConfig): Promise<void> {
  const host: string | undefined = resolvePollHost(device);

  if (!device.networkDeviceId || !host) {
    logger.warn(
      `Skipping device poll: missing device id or hostname in poll config.`,
    );
    return;
  }

  const pollMode: NetworkDevicePollMode = resolvePollMode(device);

  let pingResponse: DeviceReachabilityCheck;
  let snmpResponse: SnmpMonitorResponse | undefined = undefined;

  try {
    const target: Hostname | IPv4 | IPv6 = buildPingTarget(host);

    const walk: Promise<SnmpMonitorResponse | undefined> =
      pollMode === "snmp" && device.snmpMonitor
        ? walkDevice(device, device.snmpMonitor)
        : Promise.resolve(undefined);

    const [reachability, walkResult]: [
      DeviceReachabilityCheck,
      SnmpMonitorResponse | undefined,
    ] = await Promise.all([
      PingMonitor.checkReachability({
        host: target,
        // Borrow the SNMP wait so one device has one poll budget.
        timeoutMs:
          device.snmpMonitor?.timeout || DEFAULT_DEVICE_PING_TIMEOUT_IN_MS,
      }),
      walk,
    ]);

    pingResponse = reachability;
    snmpResponse = walkResult;
  } catch (err) {
    const failureCause: string = (err as Error).message || String(err);

    logger.error(
      `Network device poll for ${device.networkDeviceId} (${host}) failed before a verdict: ${failureCause}`,
    );

    pingResponse = {
      isOnline: false,
      avgRttMs: null,
      packetLossPercent: null,
      failureCause: failureCause,
    };
  }

  // Reachable by either path is reachable; the server tells them apart.
  const isOnline: boolean =
    pingResponse.isOnline || (snmpResponse?.isOnline ?? false);

  const ingestUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/network-device/response/ingest",
  );

  try {
    await API.fetch<JSONObject>({
      method: HTTPMethod.POST,
      url: ingestUrl,
      data: {
        ...ProbeAPIRequest.getDefaultRequestBody(),
        networkDeviceId: device.networkDeviceId,
        isOnline: isOnline,
        pollMode: pollMode,
        pingResponse: pingResponse as unknown as JSONObject,
        /*
         * Only when a walk ran (success or failure). The server reads its
         * absence as "no walk was attempted" (isSnmpReachable NULL), so it
         * must never be synthesized for a ping-only poll.
         */
        ...(snmpResponse
          ? { snmpResponse: snmpResponse as unknown as JSONObject }
          : {}),
        monitoredAt: new Date().toISOString(),
      },
      headers: {},
      options: ProbeAPIRequest.getDefaultRequestOptions(ingestUrl),
    });
  } catch (err) {
    logger.error(
      `Failed to report poll for device ${device.networkDeviceId}: ${err}`,
    );
  }
}

/*
 * A walk-failure response the server can ingest like any other walk.
 * isOnline false here is the SNMP verdict only (isSnmpReachable false,
 * lastSnmpSeenAt untouched); whether the DEVICE is reachable is the
 * top-level isOnline, which the ping can still carry.
 *
 * Reporting the failure is not optional bookkeeping: a failing walk is
 * only ever recorded because this response arrives, and it is what lets a
 * monitor's "SNMP walk failing" criteria fire.
 */
function buildFailureResponse(failureCause: string): SnmpMonitorResponse {
  return {
    isOnline: false,
    responseTimeInMs: 0,
    failureCause: failureCause,
    oidResponses: [],
  };
}

export default InitJob;
