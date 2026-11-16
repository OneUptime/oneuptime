import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  UsedByBulkSummary,
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedBySummary,
  isUsedByBulkSummary,
  isUsedByPage,
  isUsedBySummary,
} from "Common/Types/UsedBy/UsedBy";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { COULD_NOT_LOAD_USED_BY } from "./UsedByWords";

/*
 * WHAT REFERS TO A RECORD, as the Dashboard asks for it
 * (Common/Server/API/UsedByAPI): one request per card for the counts and
 * the first rows, one per page of "See all", and one per bulk Delete or
 * Archive dialog for the whole selection, however many records it holds.
 */

export const USED_BY_API_PATH: string = "/used-by";

export function getUsedBySummaryUrl(data: {
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
}): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${USED_BY_API_PATH}/${data.recordKind}/${data.recordId.toString()}`,
  );
}

export function getUsedByPageUrl(data: {
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  relation: UsedByRelation;
  skip: number;
  limit: number;
}): URL {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    `${USED_BY_API_PATH}/${data.recordKind}/${data.recordId.toString()}/${data.relation}`,
  );

  url.addQueryParam("skip", String(data.skip));
  url.addQueryParam("limit", String(data.limit));

  return url;
}

// Where a list's selection is counted (POST, the ids in its body).
export function getUsedBySummariesUrl(data: {
  recordKind: UsedByRecordKind;
}): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${USED_BY_API_PATH}/${data.recordKind}`,
  );
}

export class UsedByApiError extends Error {
  public statusCode: number | undefined;

  public constructor(message: string, statusCode?: number | undefined) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function getJson(url: URL): Promise<JSONValue> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: url,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw new UsedByApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  return response.data as JSONValue;
}

export default class UsedByApi {
  public static async getSummary(data: {
    recordKind: UsedByRecordKind;
    recordId: ObjectID;
  }): Promise<UsedBySummary> {
    const body: JSONValue = await getJson(getUsedBySummaryUrl(data));

    if (!isUsedBySummary(body)) {
      throw new UsedByApiError(COULD_NOT_LOAD_USED_BY);
    }

    return body;
  }

  /*
   * What refers to any of a list's selection, counted once for all of it:
   * one request, however many records are selected.
   */
  public static async getSummaries(data: {
    recordKind: UsedByRecordKind;
    recordIds: Array<ObjectID>;
  }): Promise<UsedByBulkSummary> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: getUsedBySummariesUrl(data),
        data: {
          recordIds: data.recordIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        },
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new UsedByApiError(
        API.getFriendlyMessage(response),
        response.statusCode,
      );
    }

    const body: JSONValue = response.data as JSONValue;

    if (!isUsedByBulkSummary(body)) {
      throw new UsedByApiError(COULD_NOT_LOAD_USED_BY);
    }

    return body;
  }

  public static async getPage(data: {
    recordKind: UsedByRecordKind;
    recordId: ObjectID;
    relation: UsedByRelation;
    skip: number;
    limit: number;
  }): Promise<UsedByPage> {
    const body: JSONValue = await getJson(getUsedByPageUrl(data));

    if (!isUsedByPage(body)) {
      throw new UsedByApiError(COULD_NOT_LOAD_USED_BY);
    }

    return body;
  }
}
