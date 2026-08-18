import {
  PROBE_INGEST_URL,
  PROBE_NETWORK_DEVICE_POLL_CONCURRENCY,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import SnmpMonitor from "../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import API from "Common/Utils/API";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";

/*
 * The probe's half of device-owned polling: every minute, fetch the
 * NetworkDevices assigned to this probe that are due for a walk (the
 * server claims them atomically and hydrates their SNMP credentials into
 * a concrete config), walk each one, and report the results back.
 *
 * Monitors play no part here — Network Device monitors are evaluated
 * server-side from these walk results. A registered device gets polled,
 * inventoried, and charted even when nothing alerts on it.
 */

/*
 * Walks run concurrently in batches: one slow device must not starve the
 * rest of the batch, but an unbounded parallel burst of SNMP table walks
 * from one probe process would compete for sockets and CPU.
 *
 * Tunable (PROBE_NETWORK_DEVICE_POLL_CONCURRENCY) because it is one half of
 * how fast a fleet can be polled — see the constant's definition in Config
 * for how it pairs with the server's claim batch size.
 */
const DEVICE_POLL_CONCURRENCY: number = PROBE_NETWORK_DEVICE_POLL_CONCURRENCY;

export interface DevicePollConfig {
  networkDeviceId: string;
  projectId: string | undefined;
  collectEndpoints: boolean;
  snmpMonitor: MonitorStepSnmpMonitor;
}

/*
 * Single-flight guard for the LIST FETCH only. node-cron fires every tick
 * regardless of whether the previous one finished, so a fetch stuck on an
 * unresponsive server would otherwise stack a new hung request per minute.
 *
 * The guard deliberately does NOT cover the SNMP walking that follows: the
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

// Exported for tests: walks the handed-out devices in bounded batches.
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

// Exported for tests: walks one device and reports the outcome back.
export async function pollDevice(device: DevicePollConfig): Promise<void> {
  if (!device.networkDeviceId || !device.snmpMonitor?.hostname) {
    logger.warn(
      `Skipping device poll: missing device id or hostname in poll config.`,
    );
    return;
  }

  let snmpResponse: SnmpMonitorResponse;

  try {
    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      device.snmpMonitor,
      {
        timeout: device.snmpMonitor.timeout || 5000,
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
      snmpResponse = buildFailureResponse("SNMP query returned no response");
    } else {
      snmpResponse = response;
    }
  } catch (err) {
    snmpResponse = buildFailureResponse((err as Error).message || String(err));
  }

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
        snmpResponse: snmpResponse as unknown as JSONObject,
        monitoredAt: new Date().toISOString(),
      },
      headers: {},
      options: ProbeAPIRequest.getDefaultRequestOptions(ingestUrl),
    });
  } catch (err) {
    logger.error(
      `Failed to report walk for device ${device.networkDeviceId}: ${err}`,
    );
  }
}

/*
 * A reachability-failure response the server can ingest like any other
 * walk. isOnline false is what makes the server record the device as
 * unreachable (isReachable false, lastSeenAt untouched, lastPolledAt
 * stamped) and lets monitors alerting on the device fire their "device
 * unreachable" criteria.
 *
 * Reporting the failure is not optional bookkeeping: an unreachable device
 * is only ever marked down because this response arrives. A walk the probe
 * silently drops leaves the device on its last known verdict.
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
