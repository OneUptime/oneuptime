import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
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

/*
 * A monitor not saved yet (#7055): the form's name, type, labels and
 * criteria on Create Monitor - or, with monitorId, a saved monitor's
 * criteria being edited.
 */
export interface WhoIsToldDraftInput {
  monitorId?: ObjectID | undefined;
  name: string;
  description?: string | undefined;
  monitorType: MonitorType;
  monitorSteps: MonitorSteps;
  labelIds: Array<ObjectID>;
}

export function getWhoIsToldDraftUrl(): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${WHO_IS_TOLD_API_PATH}/draft`,
  );
}

// The body POST /who-is-told/draft reads (WhoIsToldAPI.readDraftFromBody).
export function getWhoIsToldDraftBody(draft: WhoIsToldDraftInput): JSONObject {
  return {
    ...(draft.monitorId ? { monitorId: draft.monitorId.toString() } : {}),
    name: draft.name,
    description: draft.description || "",
    monitorType: draft.monitorType,
    monitorSteps: draft.monitorSteps.toJSON(),
    labelIds: draft.labelIds.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

// An answer, or a refusal said in the reader's words.
function readAnswer(
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): WhoIsToldResult {
  if (response instanceof HTTPErrorResponse) {
    throw new WhoIsToldApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  const body: JSONValue = response.data as JSONValue;

  if (!isWhoIsToldResult(body)) {
    throw new WhoIsToldApiError("Couldn't read who is told.");
  }

  return body;
}

export default class WhoIsToldApi {
  public static async getForMonitor(data: {
    monitorId: ObjectID;
    refresh?: boolean | undefined;
  }): Promise<WhoIsToldResult> {
    return readAnswer(
      await API.get<JSONObject>({
        url: getWhoIsToldUrl(data),
        headers: { ...ModelAPI.getCommonHeaders() },
      }),
    );
  }

  // Worked out afresh on every ask: the server keeps nothing of a draft.
  public static async getForDraft(data: {
    draft: WhoIsToldDraftInput;
  }): Promise<WhoIsToldResult> {
    return readAnswer(
      await API.post<JSONObject>({
        url: getWhoIsToldDraftUrl(),
        data: getWhoIsToldDraftBody(data.draft),
        headers: { ...ModelAPI.getCommonHeaders() },
      }),
    );
  }
}

/*
 * Whether an answer has the shape the card reads: a server that answers
 * something else (an older one, a proxy's page) is an error to show, never
 * a chain to draw.
 */
export function isWhoIsToldResult(body: unknown): body is WhoIsToldResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const result: Partial<WhoIsToldResult> = body as Partial<WhoIsToldResult>;

  return (
    Array.isArray(result.criteria) &&
    Array.isArray(result.breaks) &&
    Boolean(result.channels) &&
    typeof result.channels === "object" &&
    typeof result.checkedAt === "string"
  );
}
