import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  NETWORK_TRAFFIC_USAGE_LIST_KINDS,
  NetworkTrafficUsageApplianceLinkStatus,
  NetworkTrafficUsageApplicationRow,
  NetworkTrafficUsageClientRow,
  NetworkTrafficUsageConnection,
  NetworkTrafficUsageConversationRow,
  NetworkTrafficUsageDestinationRow,
  NetworkTrafficUsageDeviceAppliance,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageKindTotals,
  NetworkTrafficUsageListKind,
  NetworkTrafficUsageListRequest,
  NetworkTrafficUsageListResult,
  NetworkTrafficUsageNetworkRow,
  NetworkTrafficUsageRequest,
  NetworkTrafficUsageSeriesPoint,
  NetworkTrafficUsageSummary,
  NetworkTrafficUsageUplinkInterfaceRow,
  NetworkTrafficUsageUplinkRow,
  NetworkTrafficUsageUplinkSeriesPoint,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import {
  NetworkControllerLinkableAppliance,
  NetworkControllerLinkableApplianceList,
} from "Common/Types/NetworkController/NetworkControllerApplianceLink";
import { NameLikenessReason } from "Common/Utils/NetworkDevice/DeviceNameLikeness";
import { NetworkControllerConnectionStatus } from "Common/Types/NetworkController/NetworkControllerConnectionHealth";
import {
  NetworkControllerDeviceAddRequest,
  NetworkControllerDeviceAddState,
  readNetworkControllerDeviceAddState,
} from "Common/Types/NetworkController/NetworkControllerDeviceAdd";
import {
  NetworkControllerOrganization,
  NetworkControllerTestResult,
  NetworkControllerTestStatus,
} from "Common/Types/NetworkController/NetworkControllerConnectionTest";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";

/*
 * The Traffic pages' Meraki calls: the page's traffic as a Meraki
 * connection read it (POST /network-traffic/usage-summary), the connect
 * dialog's test (POST /network-controller-connection/test) and Read now -
 * with readers for their answers that never trust a shape: a missing list
 * is empty, a number that is not one is 0, and a measurement that is not one
 * is null - unknown, never a perfect 0.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

export const NETWORK_TRAFFIC_USAGE_SUMMARY_PATH: string =
  "/network-traffic/usage-summary";
// A page of a whole list: every network, application or client (issue #5762).
export const NETWORK_TRAFFIC_USAGE_LIST_PATH: string =
  "/network-traffic/usage-list";
// A device's link to the Meraki appliance it is (issue #5762).
export const NETWORK_TRAFFIC_USAGE_APPLIANCES_PATH: string =
  "/network-traffic/usage-appliances";
export const NETWORK_TRAFFIC_LINK_APPLIANCE_PATH: string =
  "/network-traffic/link-appliance";
export const NETWORK_TRAFFIC_UNLINK_APPLIANCE_PATH: string =
  "/network-traffic/unlink-appliance";
export const NETWORK_CONTROLLER_CONNECTION_PATH: string =
  "/network-controller-connection";

function toNumber(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toMeasurement(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function listOf<T>(value: unknown, read: (row: JSONObject) => T): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as JSONArray)
    .filter((row: unknown): boolean => {
      return Boolean(row) && typeof row === "object" && !Array.isArray(row);
    })
    .map((row: unknown): T => {
      return read(row as JSONObject);
    });
}

const STATUSES: Array<string> = Object.values(
  NetworkControllerConnectionStatus,
);

export function parseNetworkTrafficUsageConnection(
  row: JSONObject,
): NetworkTrafficUsageConnection {
  const status: string = toText(row["status"]);

  return {
    id: toText(row["id"]),
    name: toText(row["name"]),
    provider: toText(row["provider"]),
    organizationName: toText(row["organizationName"]),
    status: STATUSES.includes(status)
      ? (status as NetworkControllerConnectionStatus)
      : NetworkControllerConnectionStatus.Waiting,
    readIntervalInMinutes: toNumber(row["readIntervalInMinutes"]) || 5,
    lastPulledAt: optionalText(row["lastPulledAt"]),
    lastSuccessfulPullAt: optionalText(row["lastSuccessfulPullAt"]),
    lastError: optionalText(row["lastError"]),
    warning: optionalText(row["warning"]),
  };
}

export function parseNetworkTrafficUsageNetworkRow(
  row: JSONObject,
): NetworkTrafficUsageNetworkRow {
  return {
    controllerNetworkId: toText(row["controllerNetworkId"]),
    name: toText(row["name"]),
    sentOctets: toNumber(row["sentOctets"]),
    receivedOctets: toNumber(row["receivedOctets"]),
  };
}

export function parseNetworkTrafficUsageApplicationRow(
  row: JSONObject,
): NetworkTrafficUsageApplicationRow {
  return {
    application: toText(row["application"]),
    protocol: toText(row["protocol"]),
    port: toNumber(row["port"]),
    sentOctets: toNumber(row["sentOctets"]),
    receivedOctets: toNumber(row["receivedOctets"]),
    flows: toNumber(row["flows"]),
  };
}

export function parseNetworkTrafficUsageClientRow(
  row: JSONObject,
): NetworkTrafficUsageClientRow {
  return {
    clientKey: toText(row["clientKey"]),
    name: toText(row["name"]),
    ip: toText(row["ip"]),
    mac: toText(row["mac"]),
    manufacturer: toText(row["manufacturer"]),
    controllerNetworkName: toText(row["controllerNetworkName"]),
    sentOctets: toNumber(row["sentOctets"]),
    receivedOctets: toNumber(row["receivedOctets"]),
  };
}

/*
 * Which appliance a device's page is of, as the server says (issue #5762):
 * linked or unlinked, and nothing else - a status it does not know reads as
 * no Meraki side, never as one it is not.
 */
export function parseNetworkTrafficUsageDeviceAppliance(
  value: unknown,
): NetworkTrafficUsageDeviceAppliance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const row: JSONObject = value as JSONObject;
  const status: unknown = row["status"];

  if (
    status !== NetworkTrafficUsageApplianceLinkStatus.Linked &&
    status !== NetworkTrafficUsageApplianceLinkStatus.Unlinked
  ) {
    return undefined;
  }

  if (status === NetworkTrafficUsageApplianceLinkStatus.Unlinked) {
    return { status };
  }

  const serial: string | undefined = optionalText(row["serial"]);
  const name: string | undefined = optionalText(row["name"]);
  const networkName: string | undefined = optionalText(
    row["controllerNetworkName"],
  );

  return {
    status,
    ...(serial ? { serial } : {}),
    ...(name ? { name } : {}),
    ...(networkName ? { controllerNetworkName: networkName } : {}),
    isLinkedBySerialNumber: row["isLinkedBySerialNumber"] === true,
  };
}

export function parseNetworkTrafficUsageSummary(
  data: JSONObject | undefined,
): NetworkTrafficUsageSummary {
  const value: JSONObject = data || {};
  const totals: JSONObject = (value["totals"] as JSONObject) || {};
  const kindTotals: (key: string) => NetworkTrafficUsageKindTotals = (
    key: string,
  ): NetworkTrafficUsageKindTotals => {
    const row: JSONObject = (value[key] as JSONObject) || {};

    return {
      sentOctets: toNumber(row["sentOctets"]),
      receivedOctets: toNumber(row["receivedOctets"]),
    };
  };

  const deviceAppliance: NetworkTrafficUsageDeviceAppliance | undefined =
    parseNetworkTrafficUsageDeviceAppliance(value["deviceAppliance"]);

  return {
    isAvailable: value["isAvailable"] === true,
    windowStartAt: toText(value["windowStartAt"]),
    windowEndAt: toText(value["windowEndAt"]),
    bucketSeconds: toNumber(value["bucketSeconds"]) || 300,
    totals: {
      sentOctets: toNumber(totals["sentOctets"]),
      receivedOctets: toNumber(totals["receivedOctets"]),
      flows: toNumber(totals["flows"]),
    },
    primaryKind:
      value["primaryKind"] === NetworkTrafficUsageKind.Application
        ? NetworkTrafficUsageKind.Application
        : NetworkTrafficUsageKind.Uplink,
    applicationTotals: kindTotals("applicationTotals"),
    clientTotals: kindTotals("clientTotals"),
    series: listOf(
      value["series"],
      (row: JSONObject): NetworkTrafficUsageSeriesPoint => {
        return {
          time: toText(row["time"]),
          sentOctets: toNumber(row["sentOctets"]),
          receivedOctets: toNumber(row["receivedOctets"]),
        };
      },
    ),
    topNetworks: listOf(
      value["topNetworks"],
      parseNetworkTrafficUsageNetworkRow,
    ),
    topUplinks: listOf(
      value["topUplinks"],
      (row: JSONObject): NetworkTrafficUsageUplinkRow => {
        return {
          deviceSerial: toText(row["deviceSerial"]),
          deviceName: toText(row["deviceName"]),
          controllerNetworkId: toText(row["controllerNetworkId"]),
          controllerNetworkName: toText(row["controllerNetworkName"]),
          interfaceName: toText(row["interfaceName"]),
          sentOctets: toNumber(row["sentOctets"]),
          receivedOctets: toNumber(row["receivedOctets"]),
          networkDeviceId:
            typeof row["networkDeviceId"] === "string" &&
            ObjectID.isValidUUID(row["networkDeviceId"])
              ? row["networkDeviceId"]
              : undefined,
        };
      },
    ),
    uplinkInterfaces: listOf(
      value["uplinkInterfaces"],
      (row: JSONObject): NetworkTrafficUsageUplinkInterfaceRow => {
        return {
          interfaceName: toText(row["interfaceName"]),
          applianceCount: toNumber(row["applianceCount"]),
          sentOctets: toNumber(row["sentOctets"]),
          receivedOctets: toNumber(row["receivedOctets"]),
          lossPercent: toMeasurement(row["lossPercent"]),
          latencyMs: toMeasurement(row["latencyMs"]),
        };
      },
    ),
    uplinkSeries: listOf(
      value["uplinkSeries"],
      (row: JSONObject): NetworkTrafficUsageUplinkSeriesPoint => {
        return {
          time: toText(row["time"]),
          interfaceName: toText(row["interfaceName"]),
          sentOctets: toNumber(row["sentOctets"]),
          receivedOctets: toNumber(row["receivedOctets"]),
          lossPercent: toMeasurement(row["lossPercent"]),
          latencyMs: toMeasurement(row["latencyMs"]),
        };
      },
    ),
    topApplications: listOf(
      value["topApplications"],
      parseNetworkTrafficUsageApplicationRow,
    ),
    topDestinations: listOf(
      value["topDestinations"],
      (row: JSONObject): NetworkTrafficUsageDestinationRow => {
        return {
          destination: toText(row["destination"]),
          application: toText(row["application"]),
          protocol: toText(row["protocol"]),
          port: toNumber(row["port"]),
          sentOctets: toNumber(row["sentOctets"]),
          receivedOctets: toNumber(row["receivedOctets"]),
        };
      },
    ),
    topClients: listOf(value["topClients"], parseNetworkTrafficUsageClientRow),
    topConversations: listOf(
      value["topConversations"],
      (row: JSONObject): NetworkTrafficUsageConversationRow => {
        return {
          controllerNetworkId: toText(row["controllerNetworkId"]),
          controllerNetworkName: toText(row["controllerNetworkName"]),
          destination: toText(row["destination"]),
          application: toText(row["application"]),
          protocol: toText(row["protocol"]),
          port: toNumber(row["port"]),
          sentOctets: toNumber(row["sentOctets"]),
          receivedOctets: toNumber(row["receivedOctets"]),
          flows: toNumber(row["flows"]),
          clients: toNumber(row["clients"]),
        };
      },
    ),
    networkCount: toNumber(value["networkCount"]),
    applicationCount: toNumber(value["applicationCount"]),
    clientCount: toNumber(value["clientCount"]),
    ...(deviceAppliance ? { deviceAppliance } : {}),
    lastUplinkAt: optionalText(value["lastUplinkAt"]) || null,
    lastAnalyticsAt: optionalText(value["lastAnalyticsAt"]) || null,
    uplinksReadTo: optionalText(value["uplinksReadTo"]) || null,
    connections: listOf(
      value["connections"],
      parseNetworkTrafficUsageConnection,
    ),
  };
}

/*
 * A page of a whole list, read as the list it was asked for: rows of
 * another kind are none of its own, and a count that is not one is 0.
 */
export function parseNetworkTrafficUsageListResult(
  data: JSONObject | undefined,
  list: NetworkTrafficUsageListKind,
): NetworkTrafficUsageListResult {
  const value: JSONObject = data || {};

  return {
    list,
    count: toNumber(value["count"]),
    networks:
      list === NetworkTrafficUsageListKind.Networks
        ? listOf(value["networks"], parseNetworkTrafficUsageNetworkRow)
        : [],
    applications:
      list === NetworkTrafficUsageListKind.Applications
        ? listOf(value["applications"], parseNetworkTrafficUsageApplicationRow)
        : [],
    clients:
      list === NetworkTrafficUsageListKind.Clients
        ? listOf(value["clients"], parseNetworkTrafficUsageClientRow)
        : [],
  };
}

export async function fetchNetworkTrafficUsageList(
  request: NetworkTrafficUsageListRequest,
): Promise<NetworkTrafficUsageListResult> {
  if (!NETWORK_TRAFFIC_USAGE_LIST_KINDS.includes(request.list)) {
    throw new Error(`Unknown list: ${String(request.list)}`);
  }

  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    NETWORK_TRAFFIC_USAGE_LIST_PATH,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: request as unknown as JSONObject,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseNetworkTrafficUsageListResult(response.data, request.list);
}

const LIKENESS_REASONS: Array<string> = Object.values(NameLikenessReason);

export function parseLinkableAppliance(
  row: JSONObject,
): NetworkControllerLinkableAppliance {
  const linkedDeviceId: unknown = row["linkedDeviceId"];
  const reason: string = toText(row["likenessReason"]);
  const linkedDeviceName: string | undefined = optionalText(
    row["linkedDeviceName"],
  );
  const shared: string | undefined = optionalText(row["likenessShared"]);

  return {
    serial: toText(row["serial"]),
    name: toText(row["name"]),
    controllerNetworkId: toText(row["controllerNetworkId"]),
    controllerNetworkName: toText(row["controllerNetworkName"]),
    connectionName: toText(row["connectionName"]),
    lastSeenAt: toText(row["lastSeenAt"]),
    octets: toNumber(row["octets"]),
    ...(typeof linkedDeviceId === "string" &&
    ObjectID.isValidUUID(linkedDeviceId)
      ? { linkedDeviceId }
      : {}),
    ...(linkedDeviceName ? { linkedDeviceName } : {}),
    isLikely: row["isLikely"] === true,
    ...(LIKENESS_REASONS.includes(reason)
      ? { likenessReason: reason as NameLikenessReason }
      : {}),
    ...(shared ? { likenessShared: shared } : {}),
  };
}

export function parseLinkableApplianceList(
  data: JSONObject | undefined,
): NetworkControllerLinkableApplianceList {
  const value: JSONObject = data || {};

  return {
    appliances: listOf(value["appliances"], parseLinkableAppliance).filter(
      (appliance: NetworkControllerLinkableAppliance): boolean => {
        return Boolean(appliance.serial);
      },
    ),
    total: toNumber(value["total"]),
    matching: toNumber(value["matching"]),
  };
}

// The appliances a device can be linked to, the likely ones first.
export async function fetchLinkableAppliances(data: {
  networkDeviceId: ObjectID;
  search: string;
}): Promise<NetworkControllerLinkableApplianceList> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    NETWORK_TRAFFIC_USAGE_APPLIANCES_PATH,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: {
        networkDeviceId: data.networkDeviceId.toString(),
        search: data.search,
      },
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseLinkableApplianceList(response.data);
}

// Link a device to the appliance it is: its serial number written on it.
export async function linkMerakiAppliance(data: {
  networkDeviceId: ObjectID;
  deviceSerial: string;
}): Promise<void> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    NETWORK_TRAFFIC_LINK_APPLIANCE_PATH,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: {
        networkDeviceId: data.networkDeviceId.toString(),
        deviceSerial: data.deviceSerial,
      },
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
}

// Undo a link: the serial number taken off, its traffic back to the network's page.
export async function unlinkMerakiAppliance(
  networkDeviceId: ObjectID,
): Promise<void> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    NETWORK_TRAFFIC_UNLINK_APPLIANCE_PATH,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: { networkDeviceId: networkDeviceId.toString() },
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
}

export async function fetchNetworkTrafficUsage(
  request: NetworkTrafficUsageRequest,
): Promise<NetworkTrafficUsageSummary> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    NETWORK_TRAFFIC_USAGE_SUMMARY_PATH,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: request as unknown as JSONObject,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseNetworkTrafficUsageSummary(response.data);
}

const TEST_STATUSES: Array<NetworkControllerTestStatus> = [
  "pass",
  "warn",
  "fail",
];

// The server's answer to a test, read as the result it is - or a failure saying so.
export function readNetworkControllerTestResult(
  data: JSONObject | undefined,
): NetworkControllerTestResult {
  const status: unknown = data?.["status"];

  if (!data || !TEST_STATUSES.includes(status as NetworkControllerTestStatus)) {
    return {
      provider: "",
      status: "fail",
      message: "OneUptime could not read the answer to the test.",
      organizations: [],
      durationMs: 0,
    };
  }

  const organizations: Array<NetworkControllerOrganization> = listOf(
    data["organizations"],
    (row: JSONObject): NetworkControllerOrganization => {
      return { id: toText(row["id"]), name: toText(row["name"]) };
    },
  ).filter((organization: NetworkControllerOrganization): boolean => {
    return Boolean(organization.id);
  });

  const networkCount: unknown = data["networkCount"];
  const applianceCount: unknown = data["applianceCount"];

  return {
    provider: toText(data["provider"]),
    status: status as NetworkControllerTestStatus,
    message: toText(data["message"]),
    remediation: optionalText(data["remediation"]),
    failureKind: optionalText(
      data["failureKind"],
    ) as NetworkControllerTestResult["failureKind"],
    organizations,
    organizationId: optionalText(data["organizationId"]),
    networkCount: typeof networkCount === "number" ? networkCount : undefined,
    applianceCount:
      typeof applianceCount === "number" ? applianceCount : undefined,
    durationMs: toNumber(data["durationMs"]),
  };
}

/*
 * A test of settings never saved (the connect dialog) or of a saved
 * connection with unsaved values over it. A refused key is the answer, not
 * a failed request; a failed request is turned into one.
 */
export async function runNetworkControllerTest(
  body: JSONObject,
): Promise<NetworkControllerTestResult> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    `${NETWORK_CONTROLLER_CONNECTION_PATH}/test`,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: body,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    return {
      provider: "",
      status: "fail",
      message: API.getFriendlyMessage(response),
      organizations: [],
      durationMs: 0,
    };
  }

  return readNetworkControllerTestResult(response.data);
}

// Queue a read of a saved connection now.
export async function readNetworkControllerConnectionNow(
  connectionId: ObjectID,
): Promise<void> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    `${NETWORK_CONTROLLER_CONNECTION_PATH}/${connectionId.toString()}/read-now`,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: {},
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
}

/*
 * Ask for a connection's devices of the kinds picked to be added as network
 * devices. Answers the ask as the connection now keeps it (Queued), or
 * undefined when the answer cannot be read - the connection's row reads it
 * again either way.
 */
export async function addNetworkControllerDevices(
  connectionId: ObjectID,
  request: NetworkControllerDeviceAddRequest,
): Promise<NetworkControllerDeviceAddState | undefined> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    `${NETWORK_CONTROLLER_CONNECTION_PATH}/${connectionId.toString()}/add-devices`,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: {
        productTypes: [...request.productTypes],
        groupBySite: request.groupBySite,
        ...(request.probeId ? { probeId: request.probeId } : {}),
      },
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readNetworkControllerDeviceAddState(
    (response.data as JSONObject | undefined)?.["lastDeviceAdd"],
  );
}
