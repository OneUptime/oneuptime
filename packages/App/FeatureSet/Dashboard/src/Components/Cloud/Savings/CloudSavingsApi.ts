import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  CLOUD_SAVINGS_API_ROUTES,
  CloudOffHoursPreview,
  CloudSavingsActionResult,
  CloudSavingsFixInCodeResult,
  CloudSavingsOffer,
  CloudSavingsSummary,
} from "Common/Types/Cloud/CloudSavingsApiTypes";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Savings routes (#11010, CloudSavingsAPI), for the Dashboard: what
 * Apply would do, asking for it, an owner's approval, a dismissal, an
 * undo, a pull request instead, the strip's figures and what a schedule
 * picks. A refusal is thrown with the server's own words, as the page
 * draws it (API.getFriendlyMessage).
 */

export class CloudSavingsApiError extends Error {
  public statusCode: number | undefined;

  public constructor(message: string, statusCode?: number | undefined) {
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
    throw new CloudSavingsApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  const body: JSONValue = response.data as JSONValue;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

export default class CloudSavingsApi {
  public static async getOffer(
    cloudCostRecommendationId: ObjectID,
  ): Promise<CloudSavingsOffer> {
    return (await post(CLOUD_SAVINGS_API_ROUTES.offer, {
      cloudCostRecommendationId: cloudCostRecommendationId.toString(),
    })) as unknown as CloudSavingsOffer;
  }

  public static async apply(data: {
    cloudCostRecommendationId: ObjectID;
    finalSnapshot: boolean;
  }): Promise<CloudSavingsActionResult> {
    return (await post(CLOUD_SAVINGS_API_ROUTES.apply, {
      cloudCostRecommendationId: data.cloudCostRecommendationId.toString(),
      finalSnapshot: data.finalSnapshot,
    })) as unknown as CloudSavingsActionResult;
  }

  public static async approve(
    actionId: ObjectID,
  ): Promise<CloudSavingsActionResult> {
    return (await post(
      CLOUD_SAVINGS_API_ROUTES.approve(actionId.toString()),
    )) as unknown as CloudSavingsActionResult;
  }

  public static async dismiss(
    actionId: ObjectID,
    reason: string,
  ): Promise<CloudSavingsActionResult> {
    return (await post(CLOUD_SAVINGS_API_ROUTES.dismiss(actionId.toString()), {
      reason,
    })) as unknown as CloudSavingsActionResult;
  }

  public static async undo(
    actionId: ObjectID,
  ): Promise<CloudSavingsActionResult> {
    return (await post(
      CLOUD_SAVINGS_API_ROUTES.undo(actionId.toString()),
    )) as unknown as CloudSavingsActionResult;
  }

  public static async fixInCode(data: {
    cloudCostRecommendationId: ObjectID;
    codeRepositoryId?: string | undefined;
  }): Promise<CloudSavingsFixInCodeResult> {
    return (await post(CLOUD_SAVINGS_API_ROUTES.fixInCode, {
      cloudCostRecommendationId: data.cloudCostRecommendationId.toString(),
      ...(data.codeRepositoryId
        ? { codeRepositoryId: data.codeRepositoryId }
        : {}),
    })) as unknown as CloudSavingsFixInCodeResult;
  }

  public static async getSummary(): Promise<CloudSavingsSummary> {
    return (await post(
      CLOUD_SAVINGS_API_ROUTES.summary,
    )) as unknown as CloudSavingsSummary;
  }

  public static async getSchedulePreview(
    scheduleId: ObjectID,
  ): Promise<CloudOffHoursPreview> {
    return (await post(
      CLOUD_SAVINGS_API_ROUTES.schedulePreview(scheduleId.toString()),
    )) as unknown as CloudOffHoursPreview;
  }
}
