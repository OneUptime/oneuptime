import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  DiscoveryImportSettings,
  DiscoveryImportView,
  readDiscoveryImportView,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import BadDataException from "Common/Types/Exception/BadDataException";

/*
 * The Review dialog's calls to the discovery import API
 * (Common/Server/API/NetworkDeviceDiscoveryImportAPI). Every call carries the
 * project's headers, and a non-2xx answer is thrown, so the dialog shows it
 * with API.getFriendlyMessage. React-free: tested from App.
 */

export const DISCOVERY_IMPORT_ROUTES: {
  start: string;
  active: string;
  import: (importId: string) => string;
  latestForScan: (scanId: string) => string;
  stop: (importId: string) => string;
  retry: (importId: string) => string;
} = {
  start: "/network-device-discovery-import/start",
  active: "/network-device-discovery-import/active",
  import: (importId: string): string => {
    return `/network-device-discovery-import/import/${encodeURIComponent(importId)}`;
  },
  latestForScan: (scanId: string): string => {
    return `/network-device-discovery-import/scan/${encodeURIComponent(scanId)}/latest`;
  },
  stop: (importId: string): string => {
    return `/network-device-discovery-import/import/${encodeURIComponent(importId)}/stop`;
  },
  retry: (importId: string): string => {
    return `/network-device-discovery-import/import/${encodeURIComponent(importId)}/retry`;
  },
};

function apiUrl(route: string): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(route);
}

async function getJson(route: string): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: apiUrl(route),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

async function postJson(route: string, body: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: apiUrl(route),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

/*
 * The import an answer carries, or a refusal: a 2xx answer without one is
 * the server not doing what it said, and must not read as "no import".
 */
function readImport(body: JSONObject): DiscoveryImportView {
  const view: DiscoveryImportView | null = readDiscoveryImportView(
    body["import"],
  );

  if (!view) {
    throw new BadDataException(
      "The server's answer did not describe the import. Reopen Review Results to see where it stands.",
    );
  }

  return view;
}

export async function startDiscoveryImport(data: {
  scanId: string;
  ipAddresses: Array<string>;
  settings: DiscoveryImportSettings;
}): Promise<DiscoveryImportView> {
  const body: JSONObject = await postJson(DISCOVERY_IMPORT_ROUTES.start, {
    scanId: data.scanId,
    ipAddresses: data.ipAddresses,
    settings: data.settings as unknown as JSONObject,
  });

  return readImport(body);
}

export async function getDiscoveryImport(
  importId: string,
  options?: { allResults?: boolean | undefined },
): Promise<DiscoveryImportView> {
  const route: string = DISCOVERY_IMPORT_ROUTES.import(importId);

  return readImport(
    await getJson(options?.allResults ? `${route}?results=all` : route),
  );
}

export async function getLatestDiscoveryImport(
  scanId: string,
): Promise<DiscoveryImportView | null> {
  const body: JSONObject = await getJson(
    DISCOVERY_IMPORT_ROUTES.latestForScan(scanId),
  );

  return readDiscoveryImportView(body["import"]);
}

export async function listActiveDiscoveryImports(): Promise<
  Array<DiscoveryImportView>
> {
  const body: JSONObject = await getJson(DISCOVERY_IMPORT_ROUTES.active);
  const imports: Array<JSONValue> = Array.isArray(body["imports"])
    ? (body["imports"] as Array<JSONValue>)
    : [];

  return imports
    .map((value: JSONValue): DiscoveryImportView | null => {
      return readDiscoveryImportView(value);
    })
    .filter((view: DiscoveryImportView | null): view is DiscoveryImportView => {
      return Boolean(view);
    });
}

export async function stopDiscoveryImport(
  importId: string,
): Promise<DiscoveryImportView> {
  return readImport(await postJson(DISCOVERY_IMPORT_ROUTES.stop(importId), {}));
}

export async function retryDiscoveryImport(
  importId: string,
): Promise<DiscoveryImportView> {
  return readImport(
    await postJson(DISCOVERY_IMPORT_ROUTES.retry(importId), {}),
  );
}
