import RecommendationDismissalUtil from "../Recommendations/RecommendationDismissalUtil";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import {
  SetupHealthAnswer,
  SetupHealthFinding,
  SetupHealthSummary,
  getSetupHealthDismissalId,
} from "Common/Types/SetupHealth/SetupHealth";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * SETUP HEALTH, as the Dashboard asks for it (Common/Server/API/
 * SetupHealthAPI, #6812): the findings for the page, the counts for Home's
 * line, and a finding dismissed or restored for everyone in the project
 * (a RecommendationDismissal of RecommendationType.SetupHealth).
 */

export const SETUP_HEALTH_API_PATH: string = "/setup-health";

export function getSetupHealthUrl(data?: {
  refresh?: boolean | undefined;
}): URL {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    SETUP_HEALTH_API_PATH,
  );

  if (data?.refresh) {
    url.addQueryParam("refresh", "true");
  }

  return url;
}

export function getSetupHealthSummaryUrl(): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${SETUP_HEALTH_API_PATH}/summary`,
  );
}

export class SetupHealthApiError extends Error {
  public statusCode: number | undefined;

  public constructor(message: string, statusCode?: number | undefined) {
    super(message);
    this.statusCode = statusCode;
  }
}

/*
 * Whether an answer has the shape the page reads: a server that answers
 * something else (an older one, a proxy's page) is an error to show, never
 * a list to draw.
 */
export function isSetupHealthAnswer(body: unknown): body is SetupHealthAnswer {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const answer: Partial<SetupHealthAnswer> = body as Partial<SetupHealthAnswer>;

  return (
    Array.isArray(answer.findings) &&
    Array.isArray(answer.dismissed) &&
    Boolean(answer.counts) &&
    typeof answer.counts === "object" &&
    typeof answer.checkedAt === "string"
  );
}

export function isSetupHealthSummary(
  body: unknown,
): body is SetupHealthSummary {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const summary: Partial<SetupHealthSummary> =
    body as Partial<SetupHealthSummary>;

  return (
    Boolean(summary.counts) &&
    typeof summary.counts === "object" &&
    typeof summary.counts?.needsALook === "number"
  );
}

async function getJson(url: URL): Promise<JSONValue> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: url,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw new SetupHealthApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  return response.data as JSONValue;
}

export default class SetupHealthApi {
  public static async getAnswer(data?: {
    refresh?: boolean | undefined;
  }): Promise<SetupHealthAnswer> {
    const body: JSONValue = await getJson(getSetupHealthUrl(data));

    if (!isSetupHealthAnswer(body)) {
      throw new SetupHealthApiError("Couldn't read the setup health.");
    }

    return body;
  }

  public static async getSummary(): Promise<SetupHealthSummary> {
    const body: JSONValue = await getJson(getSetupHealthSummaryUrl());

    if (!isSetupHealthSummary(body)) {
      throw new SetupHealthApiError("Couldn't read the setup health.");
    }

    return body;
  }

  // Hides a finding for everyone in the project, with the reason given.
  public static async dismiss(data: {
    finding: SetupHealthFinding;
    reason: string;
  }): Promise<void> {
    await RecommendationDismissalUtil.dismiss({
      recommendationId: getSetupHealthDismissalId(data.finding),
      recommendationType: RecommendationType.SetupHealth,
      resourceType: data.finding.record.kind,
      resourceId: new ObjectID(data.finding.record.id),
      dismissalReason: data.reason,
    });
  }

  // Brings a dismissed finding back, for everyone.
  public static async restore(dismissalId: string): Promise<void> {
    await RecommendationDismissalUtil.restore(new ObjectID(dismissalId));
  }
}
