import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { WhoWasToldResult } from "Common/Types/Notification/WhoWasTold";
import ObjectID from "Common/Types/ObjectID";
import { OnCallTestPageRecordKind } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHO WAS TOLD ABOUT AN INCIDENT OR AN ALERT, as the Dashboard asks for it
 * (Common/Server/API/WhoWasToldAPI, #7075). One request per read of the
 * card; the server reads everything as the person asking.
 */

export const WHO_WAS_TOLD_API_PATH: string = "/who-was-told";

export function getWhoWasToldUrl(data: {
  recordKind: OnCallTestPageRecordKind;
  recordId: ObjectID;
}): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${WHO_WAS_TOLD_API_PATH}/${
      data.recordKind === OnCallTestPageRecordKind.Alert ? "alert" : "incident"
    }/${data.recordId.toString()}`,
  );
}

export class WhoWasToldApiError extends Error {
  public statusCode: number | undefined;

  public constructor(message: string, statusCode?: number | undefined) {
    super(message);
    this.statusCode = statusCode;
  }
}

/*
 * Whether an answer has the shape the card reads: a server that answers
 * something else (an older one, a proxy's page) is an error to show, never
 * a list to draw.
 */
export function isWhoWasToldResult(body: unknown): body is WhoWasToldResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const result: Partial<WhoWasToldResult> = body as Partial<WhoWasToldResult>;

  return (
    Array.isArray(result.people) &&
    Array.isArray(result.channels) &&
    Array.isArray(result.notPaged) &&
    Array.isArray(result.runs) &&
    typeof result.checkedAt === "string" &&
    typeof result.hiddenNotificationCount === "number"
  );
}

export default class WhoWasToldApi {
  public static async get(data: {
    recordKind: OnCallTestPageRecordKind;
    recordId: ObjectID;
  }): Promise<WhoWasToldResult> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: getWhoWasToldUrl(data),
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new WhoWasToldApiError(
        API.getFriendlyMessage(response),
        response.statusCode,
      );
    }

    const body: JSONValue = response.data as JSONValue;

    if (!isWhoWasToldResult(body)) {
      throw new WhoWasToldApiError("Couldn't read who was told.");
    }

    return body;
  }
}
