import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { WhoIsToldResult } from "Common/Types/Monitor/WhoIsTold";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHO IS TOLD WHEN A MONITOR GOES DOWN, as the Dashboard asks for it
 * (Common/Server/API/WhoIsToldAPI). One request per card.
 */

export const WHO_IS_TOLD_API_PATH: string = "/who-is-told";

export function getWhoIsToldUrl(data: {
  monitorId: ObjectID;
  refresh?: boolean | undefined;
}): URL {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    `${WHO_IS_TOLD_API_PATH}/monitor/${data.monitorId.toString()}`,
  );

  if (data.refresh) {
    url.addQueryParam("refresh", "true");
  }

  return url;
}

export class WhoIsToldApiError extends Error {
  public statusCode: number | undefined;

  public constructor(message: string, statusCode?: number | undefined) {
    super(message);
    this.statusCode = statusCode;
  }
}

export default class WhoIsToldApi {
  public static async getForMonitor(data: {
    monitorId: ObjectID;
    refresh?: boolean | undefined;
  }): Promise<WhoIsToldResult> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: getWhoIsToldUrl(data),
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new WhoIsToldApiError(
        API.getFriendlyMessage(response),
        response.statusCode,
      );
    }

    const body: JSONValue = response.data as JSONValue;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new WhoIsToldApiError("Couldn't read who is told.");
    }

    return body as unknown as WhoIsToldResult;
  }
}
