import { JSONObject } from "../../../Types/JSON";
import { NetworkControllerConfig } from "../../../Types/NetworkController/NetworkControllerConnectionSettings";
import { NetworkControllerTestResult } from "../../../Types/NetworkController/NetworkControllerConnectionTest";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import { NetworkTrafficUsageKind } from "../../../Types/NetFlow/NetworkTrafficUsage";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";

/*
 * THE CONTRACT EVERY NETWORK CONTROLLER CONNECTOR KEEPS.
 *
 * A connector is stateless: every call receives the decrypted settings and
 * opens its own requests, so one instance serves every connection of every
 * project. The read runner, "Test" and the save-time checks talk only to
 * this interface; a controller is an API client, a mapping into
 * NetworkTrafficUsage rows and one class.
 */

/*
 * Decrypted, server-only settings of one connection. Never serialize this
 * into a response or a log line: it holds the API key.
 */
export interface NetworkControllerSettings {
  provider: NetworkControllerProvider;
  projectId: string;
  config: NetworkControllerConfig;
  apiKey: string;
}

/*
 * The HTTP transport every request goes through: the SSRF-guarded
 * DataSourceHttpFetch in production (with every status answered, so a 429's
 * Retry-After and a redirect's Location can be read), a faithful fake of
 * the controller's API in tests.
 */
export type NetworkControllerTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface NetworkControllerCallOptions {
  transport: NetworkControllerTransport;
  // Test seam for "now"; the real clock when absent.
  now?: (() => Date) | undefined;
  // Test seam for waiting (the rate limit, a Retry-After); setTimeout when absent.
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  requestTimeoutInMs?: number | undefined;
}

/*
 * Where the reads of a connection got to (NetworkControllerConnection
 * .pullState). Server only; holds no secret.
 */
export interface NetworkControllerPullState {
  // The end of the last uplink window stored (ISO, exclusive).
  uplinkCursor?: string | undefined;
  /*
   * Per network (by its controller ID): the end of the last application and
   * client window stored (ISO, exclusive).
   */
  analyticsCursors?: Record<string, string> | undefined;
  /*
   * Networks whose traffic analytics Meraki would not give (turned off on
   * the network), and when that was found: asked again a day later.
   */
  trafficAnalysisOff?: Record<string, string> | undefined;
}

/*
 * A window a read stored, by what it totals: a row of the window is never
 * written twice (NetworkControllerReadRunner checks these before it writes).
 */
export interface NetworkTrafficUsageWindowKey {
  kind: NetworkTrafficUsageKind;
  controllerNetworkId: string;
  windowStartAt: Date;
}

/*
 * Where a connection's stored windows end
 * (NetworkTrafficUsageAggregationService.findStoredWindowEnds): what the
 * runner moves the cursors up to before a read, so traffic stored by a
 * read whose cursor was never recorded is not read - and written - again.
 */
export interface NetworkTrafficUsageStoredEnds {
  // The end of the newest stored uplink window.
  uplinkEnd: Date | null;
  // Per network: the end of its newest stored application or client window.
  analyticsEnds: Map<string, Date>;
}

// An appliance the read found: what rows are attributed and named by.
export interface NetworkControllerAppliance {
  serial: string;
  name: string;
  model: string;
  mac: string;
  controllerNetworkId: string;
}

/*
 * A device of the controller's device list - every product type, not only
 * the appliances that carry uplinks - as the controller describes it: what a
 * device in OneUptime that it is takes its missing details from
 * (NetworkControllerInventory). Every text is cleaned and bounded; a value
 * the controller did not give is "".
 */
export interface NetworkControllerDevice {
  serial: string;
  name: string;
  model: string;
  // Lowercase, colon-separated, or "".
  mac: string;
  // The management (LAN) address, an address literal, or "".
  lanIp: string;
  firmware: string;
  // As the controller names it: "appliance", "switch", "wireless"...
  productType: string;
  controllerNetworkId: string;
  networkName: string;
  // The street address the controller files it under.
  address: string;
}

/*
 * One row a read produced, before the runner gives it the device it
 * belongs to and turns it into the stored JSON (NetworkTrafficUsageRows).
 */
export interface NetworkTrafficUsageRecord {
  kind: NetworkTrafficUsageKind;
  controllerNetworkId: string;
  controllerNetworkName: string;
  deviceSerial: string;
  deviceName: string;
  interfaceName: string;
  application: string;
  destination: string;
  protocol: string;
  port: number;
  clientKey: string;
  clientName: string;
  clientIp: string;
  clientMac: string;
  clientManufacturer: string;
  sentOctets: number;
  receivedOctets: number;
  flows: number;
  clients: number;
  windowStartAt: Date;
  windowEndAt: Date;
}

export interface NetworkControllerReadOptions
  extends NetworkControllerCallOptions {
  state: NetworkControllerPullState;
  // Bounds on one read; it stops (complete=false) when one is reached.
  maxRequests: number;
  maxDurationMs: number;
}

export interface NetworkControllerReadResult {
  organizationName: string;
  networkCount: number;
  appliances: Array<NetworkControllerAppliance>;
  /*
   * Every device of the organization's device list, and whether the list is
   * whole: one cut short (more devices than a read lists) says nothing about
   * the devices it left out.
   */
  devices: Array<NetworkControllerDevice>;
  isDeviceListComplete: boolean;
  records: Array<NetworkTrafficUsageRecord>;
  // The windows the records cover, whether or not they hold a row.
  windows: Array<NetworkTrafficUsageWindowKey>;
  uplinkWindows: number;
  newestUplinkAt?: Date | undefined;
  analyticsNetworks: number;
  analyticsNetworksWaiting: number;
  trafficAnalysisOffNetworks: number;
  requestCount: number;
  wasRateLimited: boolean;
  warnings: Array<string>;
  // False when a bound stopped the read before it was done.
  complete: boolean;
  nextState: NetworkControllerPullState;
}

export interface NetworkControllerConnector {
  provider: NetworkControllerProvider;
  /*
   * A few read-only calls: is the key accepted, which organizations can it
   * read, and for the organization picked how many networks and appliances
   * a read covers. Never throws: a failure is a result with status "fail".
   */
  testConnection(
    data: {
      apiKey: string;
      config: NetworkControllerConfig;
    },
    options: NetworkControllerCallOptions,
  ): Promise<NetworkControllerTestResult>;
  // One read. Throws LlmProviderError when it cannot read at all.
  read(
    settings: NetworkControllerSettings,
    options: NetworkControllerReadOptions,
  ): Promise<NetworkControllerReadResult>;
}

export function readPullState(value: unknown): NetworkControllerPullState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const state: JSONObject = value as JSONObject;
  const result: NetworkControllerPullState = {};

  if (typeof state["uplinkCursor"] === "string") {
    result.uplinkCursor = state["uplinkCursor"];
  }

  for (const key of ["analyticsCursors", "trafficAnalysisOff"] as const) {
    const map: unknown = state[key];

    if (map && typeof map === "object" && !Array.isArray(map)) {
      const read: Record<string, string> = {};

      for (const [networkId, value] of Object.entries(
        map as Record<string, unknown>,
      )) {
        if (typeof value === "string") {
          read[networkId] = value;
        }
      }

      result[key] = read;
    }
  }

  return result;
}
