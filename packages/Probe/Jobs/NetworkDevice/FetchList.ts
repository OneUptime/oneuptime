import {
  PROBE_INGEST_URL,
  PROBE_NETWORK_DEVICE_POLL_CONCURRENCY,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import ServerBusy from "../../Utils/ServerBusy";
import MonitorCheckSlots from "../../Utils/Monitors/MonitorCheckSlots";
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
 * The probe's half of device-owned polling: fetch the NetworkDevices
 * assigned to this probe that are due for a poll (the server claims them
 * atomically and hydrates whatever SNMP credentials the device or its site
 * carry into a concrete config), poll each one, and report the results
 * back.
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
 * HOW THIS PROBE KEEPS ITS NETWORK DEVICES POLLED (OneUptime issue #9499).
 *
 * Every minute the probe asks the server for the devices that are due, as
 * many as it has room to poll. While the server says it handed out a full
 * batch, more may be due, so the probe asks again as soon as it has room;
 * once a batch is not full, everything that was due has been handed out,
 * and it waits for the next minute.
 *
 * It used to ask once a minute for NETWORK_DEVICE_POLL_FETCH_LIMIT devices
 * (250 by default) and poll them PROBE_NETWORK_DEVICE_POLL_CONCURRENCY at a
 * time, so one probe polled at most 250 devices a minute, however many
 * were due: the rest waited, polled less often than their interval, and
 * nothing in the Dashboard said so. It is the design the monitors moved to
 * in #9488 (Jobs/Monitor/FetchList).
 *
 * What keeps it bounded:
 *
 *   - Polls at once: never more than DEVICE_POLLS_AT_ONCE,
 *     PROBE_NETWORK_DEVICE_POLL_CONCURRENCY - what it always ran at once.
 *     Each poll holds a slot of its own (MonitorCheckSlots) and gives it
 *     back when it settles, or at DEVICE_POLL_DEADLINE_MS, so one slow
 *     device holds one slot, never a batch.
 *   - What it asks for: never more devices than it has room to poll now,
 *     and only once it has room for at least DEVICE_ROOM_TO_ASK, so the
 *     server's work per request stays what it was or less, and a device is
 *     claimed only when the probe can poll it at once.
 *   - Memory: the devices it holds are the ones it is polling, and - only
 *     from a server older than #9499, which hands out its whole batch
 *     whatever the probe asks for - the rest of that one batch, each
 *     waiting for a slot before the probe asks for more.
 *   - When the server is busy (429) it asks again only once the answer's
 *     Retry-After has passed (ServerBusy); after any other failed fetch, at
 *     the next minute. Nothing is lost either way: the server claimed
 *     nothing, and the devices stay due.
 *
 * The server claims what it hands out in one statement and moves each
 * claimed device to its next poll in the same breath
 * (NetworkDeviceService.claimDevicesForPolling), so asking again never
 * hands a device out twice for one interval: not to this probe, not to
 * another copy of it, not to it after a restart.
 *
 * Old and new, either way round: a probe from before #9499 sends no limit
 * and is handed up to NETWORK_DEVICE_POLL_FETCH_LIMIT once a minute, as it
 * always was - and shows as Behind on its page when that is not enough. A
 * server from before #9499 ignores the limit and says nothing of a full
 * batch: this probe then reads a batch as full when it holds as many
 * devices as it asked for, and polls a bigger one through its slots.
 */

// The most device polls this probe runs at once.
export const DEVICE_POLLS_AT_ONCE: number = Math.max(
  1,
  Math.floor(PROBE_NETWORK_DEVICE_POLL_CONCURRENCY) || 1,
);

/*
 * The probe asks for devices once it has room for this many polls, rather
 * than wait for room for all of them: half of them, at least one.
 */
export const DEVICE_ROOM_TO_ASK: number = Math.max(
  1,
  Math.ceil(DEVICE_POLLS_AT_ONCE / 2),
);

/*
 * The fetch that waits this long for room while devices are due says so
 * (at warn, at most every DEVICE_WAIT_WARNING_EVERY_MS): the probe is
 * polling every device it may at once, and the devices waiting are polled
 * late.
 */
export const DEVICE_WAIT_WARNING_AFTER_MS: number = 60 * 1000;
export const DEVICE_WAIT_WARNING_EVERY_MS: number = 10 * 60 * 1000;

/*
 * The longest one device's poll holds its slot. A poll's ping, walk and
 * report each have budgets of their own and settle well inside it; this is
 * for a poll that never settles, which would otherwise hold its slot for
 * the life of the process. The poll is not cancelled - nothing can unwind
 * an SNMP library mid-walk - but the probe stops waiting for it.
 */
export const DEVICE_POLL_DEADLINE_MS: number = 10 * 60 * 1000;

// What ServerBusy calls this work, in what it logs.
const DEVICE_WORK: string = "network devices";

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
  /*
   * Read the device's transceivers (SFP/SFP+/QSFP health) during its walk.
   * Absent from servers that predate transceiver health, which then keep
   * getting exactly the walk they always did.
   */
  collectTransceivers?: boolean | undefined;
  // Emitted only for snmp mode: the hydrated credentials for the walk.
  snmpMonitor?: MonitorStepSnmpMonitor | undefined;
}

// One answer of the list endpoint.
export interface DevicePollBatch {
  devices: Array<DevicePollConfig>;
  /*
   * The server's claim filled the batch, so more devices may be due: the
   * probe asks again once it has room. A server from before #9499 does not
   * say; then a batch is full when it holds as many devices as were asked
   * for.
   */
  isFullBatch: boolean;
}

const devicePollSlots: MonitorCheckSlots = new MonitorCheckSlots(
  DEVICE_POLLS_AT_ONCE,
);

// The polls running or waiting for a slot now: what a test waits for.
const pollsInProgress: Set<Promise<void>> = new Set<Promise<void>>();

let lastWaitWarningAt: number | null = null;

/*
 * Single-flight guard for the FETCHING only. node-cron fires every tick
 * regardless of whether the previous one finished, so a fetch stuck on an
 * unresponsive server - or waiting for room while every slot is polling
 * and devices are still due - would otherwise stack a new one per minute.
 *
 * The guard deliberately does NOT cover the polls the fetching started:
 * they run on in their slots, and the next tick fetches while they do.
 * The server claims due devices atomically when handing out the list, so
 * overlapping fetches poll disjoint device sets.
 */
let isDeviceFetchInProgress: boolean = false;

/*
 * Exported for tests: lets each case start with an idle probe - no fetch
 * in flight, no slot held, nothing waiting.
 */
export function resetDevicePollRunInProgress(): void {
  isDeviceFetchInProgress = false;
  devicePollSlots.reset();
  pollsInProgress.clear();
  lastWaitWarningAt = null;
}

// Exported for tests: the probe's device poll slots.
export function getDevicePollSlots(): MonitorCheckSlots {
  return devicePollSlots;
}

// Exported for tests: whether a tick is fetching now.
export function isFetchingDevices(): boolean {
  return isDeviceFetchInProgress;
}

// Exported for tests: resolves once every poll started so far has settled.
export async function whenDevicePollsSettle(): Promise<void> {
  while (pollsInProgress.size > 0) {
    await Promise.allSettled(Array.from(pollsInProgress));
  }
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
          "This probe is still fetching network devices from a previous tick. Skipping this tick.",
        );
        return;
      }

      isDeviceFetchInProgress = true;

      try {
        await fetchAndPollWhileDue();
      } catch (err) {
        logger.error("Network device poll fetch failed");
        logger.error(err);
      } finally {
        // Released once the fetching is done - see the guard comment.
        isDeviceFetchInProgress = false;
      }
    },
  });
};

/*
 * Exported for tests: one tick's fetching. Fetches and starts polling the
 * due devices until the server has none more for this probe now, then
 * resolves; the polls it started run on in their slots.
 */
export async function fetchAndPollWhileDue(): Promise<void> {
  let isMoreDue: boolean = false;

  for (;;) {
    // The server asked this probe to wait (ServerBusy): it asks later.
    if (ServerBusy.isBackingOff(DEVICE_WORK)) {
      return;
    }

    const room: number = await reserveRoom({ isMoreDue });

    if (room <= 0) {
      return;
    }

    let batch: DevicePollBatch | null = null;

    try {
      batch = await fetchDueDevices(room);
    } finally {
      if (!batch) {
        devicePollSlots.release(room);
      }
    }

    if (!batch) {
      return;
    }

    startPolls(batch.devices, room);

    /*
     * Not a full batch: the server handed out every device that was due
     * for this probe, so nothing waits for it until the next minute.
     */
    if (!batch.isFullBatch) {
      return;
    }

    isMoreDue = true;

    logger.debug(
      `This probe was handed a full batch of ${batch.devices.length} network device(s); more may be due, so it asks again once it has room.`,
    );
  }
}

/*
 * Room for the next fetch. When the last batch was full, devices are
 * waiting for it: a wait of DEVICE_WAIT_WARNING_AFTER_MS or more means the
 * probe is polling all it may at once and they are polled late.
 */
async function reserveRoom(data: { isMoreDue: boolean }): Promise<number> {
  const startedAt: number = Date.now();

  const room: number = await devicePollSlots.reserve(
    DEVICE_POLLS_AT_ONCE,
    DEVICE_ROOM_TO_ASK,
  );

  const waitedInMs: number = Date.now() - startedAt;

  if (data.isMoreDue && waitedInMs >= DEVICE_WAIT_WARNING_AFTER_MS) {
    warnAboutWaiting(waitedInMs);
  }

  return room;
}

function warnAboutWaiting(waitedInMs: number): void {
  const now: number = Date.now();

  if (
    lastWaitWarningAt !== null &&
    now - lastWaitWarningAt < DEVICE_WAIT_WARNING_EVERY_MS
  ) {
    return;
  }

  lastWaitWarningAt = now;

  logger.warn(
    `This probe is polling all ${DEVICE_POLLS_AT_ONCE} network devices it may poll at once, and more devices are due: they waited ${Math.round(waitedInMs / 1000)} s for room, so they are polled later than their interval. Raise PROBE_NETWORK_DEVICE_POLL_CONCURRENCY (now ${DEVICE_POLLS_AT_ONCE}) to poll more at once, give the probe more CPU, or move some devices to another probe.`,
  );
}

/*
 * Starts polling every device the server handed out. `room` slots were
 * reserved for them: the ones not needed go back. A device past them - a
 * server from before #9499 handed out more than was asked for - is
 * claimed all the same, so it is polled too, once a slot is free: never
 * more polls at once than DEVICE_POLLS_AT_ONCE.
 */
function startPolls(devices: Array<DevicePollConfig>, room: number): void {
  const inRoom: number = Math.min(devices.length, room);

  devicePollSlots.release(room - inRoom);

  devices.forEach((device: DevicePollConfig, index: number) => {
    const poll: Promise<void> =
      index < inRoom ? runPollInSlot(device) : pollWhenASlotIsFree(device);

    track(poll);
  });
}

function track(poll: Promise<void>): void {
  pollsInProgress.add(poll);

  const forget: () => void = (): void => {
    pollsInProgress.delete(poll);
  };

  poll.then(forget, forget);
}

// Waits for a slot of its own, then polls the device in it.
async function pollWhenASlotIsFree(device: DevicePollConfig): Promise<void> {
  const taken: number = await devicePollSlots.reserve(1, 1);

  // Only the test seam (reset) answers no room: nothing is polled then.
  if (taken <= 0) {
    return;
  }

  await runPollInSlot(device);
}

/*
 * Polls one device in the slot reserved for it, and gives the slot back
 * when the poll settles or its deadline passes. Never rejects.
 */
async function runPollInSlot(device: DevicePollConfig): Promise<void> {
  try {
    await pollDeviceWithDeadline(device);
  } catch (err) {
    logger.error(err);
  } finally {
    devicePollSlots.release(1);
  }
}

/*
 * Exported for tests: bounds ONE device's poll in time (see
 * DEVICE_POLL_DEADLINE_MS). Promise.race subscribes to both promises, so a
 * poll that settles late is still observed and can never surface as an
 * unhandled rejection.
 */
export async function pollDeviceWithDeadline(
  device: DevicePollConfig,
  deadlineInMs: number = DEVICE_POLL_DEADLINE_MS,
): Promise<void> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  const deadline: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (err: Error) => void) => {
      deadlineTimer = setTimeout(() => {
        logger.error(
          `Network device ${device.networkDeviceId} did not finish its poll within ${Math.round(deadlineInMs / 1000)} s. This probe stops waiting for it and polls it again at its next interval.`,
        );

        reject(
          new Error(
            `Polling network device ${device.networkDeviceId} exceeded the ${deadlineInMs}ms deadline`,
          ),
        );
      }, deadlineInMs);

      /*
       * The deadline alone never keeps the process up: the probe's own
       * jobs do, and a probe shutting down need not wait for it.
       */
      (deadlineTimer as { unref?: () => void }).unref?.();
    },
  );

  try {
    return await Promise.race([pollDevice(device), deadline]);
  } finally {
    // An un-cleared timer holds the event loop open after a healthy poll.
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }
  }
}

/*
 * Up to `limit` of this probe's due devices, claimed for it by the server,
 * and whether the batch was full; null when there are none to be had now -
 * the server was busy, or the fetch failed - and the fetching stops until
 * its next tick. Never throws.
 */
export async function fetchDueDevices(
  limit: number,
): Promise<DevicePollBatch | null> {
  try {
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
          // The room this probe has: a server from before #9499 ignores it.
          limit: limit,
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(listUrl),
      });

    /*
     * Too busy to hand out devices now: nothing was claimed, they stay
     * due, and this probe asks again once the wait it was given has passed.
     */
    if (ServerBusy.isBusyAnswer(result)) {
      ServerBusy.note(DEVICE_WORK, result);
      return null;
    }

    if (result instanceof HTTPErrorResponse) {
      logger.error(
        `Fetching the network device list failed: the server answered ${result.statusCode}. This probe asks again at its next tick.`,
      );
      logger.error(result.data);
      return null;
    }

    const body: JSONObject | undefined =
      result.data && typeof result.data === "object"
        ? (result.data as JSONObject)
        : undefined;

    const devices: Array<DevicePollConfig> = (
      Array.isArray(body?.["devices"]) ? (body!["devices"] as JSONArray) : []
    ).map((device: JSONObject) => {
      return device as unknown as DevicePollConfig;
    });

    return {
      devices: devices,
      isFullBatch:
        typeof body?.["isFullBatch"] === "boolean"
          ? (body["isFullBatch"] as boolean)
          : devices.length >= limit,
    };
  } catch (err) {
    logger.error("Error in fetching the network device list");
    logger.error(err);
    return null;
  }
}

/*
 * Exported for tests: one fetch of this probe's due devices, as many as it
 * may poll at once; [] when there are none to be had now.
 */
export async function fetchDeviceList(
  limit: number = DEVICE_POLLS_AT_ONCE,
): Promise<Array<DevicePollConfig>> {
  // The server asked this probe to wait (ServerBusy): it asks later.
  if (ServerBusy.isBackingOff(DEVICE_WORK)) {
    return [];
  }

  return (await fetchDueDevices(limit))?.devices || [];
}

/*
 * Exported for tests: polls the devices given, each in a slot of its own,
 * and resolves once every one of them has settled.
 */
export async function pollDevices(
  devices: Array<DevicePollConfig>,
): Promise<void> {
  if (devices.length === 0) {
    return;
  }

  logger.debug(`Polling ${devices.length} network device(s).`);

  const polls: Array<Promise<void>> = devices.map(
    (device: DevicePollConfig) => {
      const poll: Promise<void> = pollWhenASlotIsFree(device);
      track(poll);
      return poll;
    },
  );

  await Promise.allSettled(polls);
}

// Exported for tests: one fetch of this probe's due devices, polled.
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
        /*
         * Transceiver health rides the interface walk too, and only when the
         * server asks for it. The static part of a device's optics is cached
         * on this probe under the device's id and address.
         */
        collectTransceivers: device.collectTransceivers === true,
        transceiverCacheKey: `${device.networkDeviceId}@${snmpMonitor.hostname}`,
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
