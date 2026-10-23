import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  NetworkTrafficUsageApplicationRow,
  NetworkTrafficUsageClientRow,
  NetworkTrafficUsageConnection,
  NetworkTrafficUsageDestinationRow,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageKindTotals,
  NetworkTrafficUsageNetworkRow,
  NetworkTrafficUsageRequest,
  NetworkTrafficUsageSeriesPoint,
  NetworkTrafficUsageSummary,
  NetworkTrafficUsageUplinkRow,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import { NetworkControllerConnectionStatus } from "Common/Types/NetworkController/NetworkControllerConnectionHealth";
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
 * is empty, a number that is not one is 0.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

export const NETWORK_TRAFFIC_USAGE_SUMMARY_PATH: string =
  "/network-traffic/usage-summary";
export const NETWORK_CONTROLLER_CONNECTION_PATH: string =
  "/network-controller-connection";

function toNumber(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
      (row: JSONObject): NetworkTrafficUsageNetworkRow => {
        return {
          controllerNetworkId: toText(row["controllerNetworkId"]),
          name: toText(row["name"]),
          sentOctets: toNumber(row["sentOctets"]),
          receivedOctets: toNumber(row["receivedOctets"]),
        };
      },
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
    topApplications: listOf(
      value["topApplications"],
      (row: JSONObject): NetworkTrafficUsageApplicationRow => {
        return {
          application: toText(row["application"]),
          sentOctets: toNumber(row["sentOctets"]),
          receivedOctets: toNumber(row["receivedOctets"]),
          flows: toNumber(row["flows"]),
        };
      },
    ),
    topDestinations: listOf(
      value["topDestinations"],
      (row: JSONObject): NetworkTrafficUsageDestinationRow => {
        return {
          destination: toText(row["destination"]),
          application: toText(row["application"]),
          sentOctets: toNumber(row["sentOctets"]),
          receivedOctets: toNumber(row["receivedOctets"]),
        };
      },
    ),
    topClients: listOf(
      value["topClients"],
      (row: JSONObject): NetworkTrafficUsageClientRow => {
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
      },
    ),
    lastUplinkAt: optionalText(value["lastUplinkAt"]) || null,
    lastAnalyticsAt: optionalText(value["lastAnalyticsAt"]) || null,
    connections: listOf(
      value["connections"],
      parseNetworkTrafficUsageConnection,
    ),
  };
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
