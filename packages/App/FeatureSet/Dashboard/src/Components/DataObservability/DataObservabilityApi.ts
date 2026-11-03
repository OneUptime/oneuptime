import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DATA_OBSERVABILITY_API_ROUTES,
  DataObservabilityCheckAlertResponse,
  DataObservabilityConnectStoreRequest,
  DataObservabilityConnectStoreResponse,
  DataObservabilityOverview,
  DataObservabilityStoreSummary,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Dashboard's side of Data Observability's own routes (Server/API/
 * DataObservabilityAPI.ts): the Overview, the watched stores, Collect Now,
 * Connect a Database, and a data check's alert and Run Now. Every request goes through the refresh-aware
 * client with the project's headers, like every other page's.
 */

export class DataObservabilityApiError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function post(route: string, data: JSONObject = {}): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw new DataObservabilityApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  const body: JSONValue = response.data as JSONValue;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

export default class DataObservabilityApi {
  public static async getOverview(): Promise<DataObservabilityOverview> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.overview,
    )) as unknown as DataObservabilityOverview;
  }

  public static async getStores(): Promise<
    Array<DataObservabilityStoreSummary>
  > {
    const body: JSONObject = await post(DATA_OBSERVABILITY_API_ROUTES.stores);

    return Array.isArray(body["stores"])
      ? (body["stores"] as unknown as Array<DataObservabilityStoreSummary>)
      : [];
  }

  public static async collectNow(dataStoreId: ObjectID): Promise<void> {
    await post(
      DATA_OBSERVABILITY_API_ROUTES.collectNow(dataStoreId.toString()),
    );
  }

  // Makes a check's monitor match its alert condition: made, changed or removed.
  public static async syncCheckAlert(
    dataCheckId: ObjectID,
  ): Promise<DataObservabilityCheckAlertResponse> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.checkAlert(dataCheckId.toString()),
    )) as unknown as DataObservabilityCheckAlertResponse;
  }

  public static async runCheckNow(dataCheckId: ObjectID): Promise<void> {
    await post(
      DATA_OBSERVABILITY_API_ROUTES.checkRunNow(dataCheckId.toString()),
    );
  }

  public static async connectStore(
    request: DataObservabilityConnectStoreRequest,
  ): Promise<DataObservabilityConnectStoreResponse> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.connectStore,
      request as unknown as JSONObject,
    )) as unknown as DataObservabilityConnectStoreResponse;
  }
}
