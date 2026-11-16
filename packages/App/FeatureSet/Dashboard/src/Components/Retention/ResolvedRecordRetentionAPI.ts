import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ResolvedRecordRetentionAnswers, {
  DueRecordsCountAnswer,
  DueRecordsCountRequest,
  RESOLVED_RECORD_RETENTION_COUNT_ROUTE,
  RESOLVED_RECORD_RETENTION_ROUTE,
  ResolvedRecordRetentionLimitsAnswer,
} from "Common/Types/Retention/ResolvedRecordRetentionAnswers";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The server's Data Retention routes, for the project's cards (ProjectAPI;
 * Common/Types/Retention/ResolvedRecordRetentionAnswers says what each
 * answers):
 *
 *   - getLimits: the server's maximum for incidents and alerts (issue
 *     #6941). Throws on failure: the card then shows its choices unlocked,
 *     and the server holds them to the maximum anyway.
 *   - countDue: how many a setting deletes now (issue #6943), or null when
 *     it could not be counted - the question is then asked without it.
 */
export default class ResolvedRecordRetentionAPI {
  public static getLimitsPath(projectId: ObjectID): string {
    return `/project/${projectId.toString()}/${RESOLVED_RECORD_RETENTION_ROUTE}`;
  }

  public static getCountPath(projectId: ObjectID): string {
    return `/project/${projectId.toString()}/${RESOLVED_RECORD_RETENTION_COUNT_ROUTE}`;
  }

  public static async getLimits(
    projectId: ObjectID,
  ): Promise<ResolvedRecordRetentionLimitsAnswer> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          ResolvedRecordRetentionAPI.getLimitsPath(projectId),
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return ResolvedRecordRetentionAnswers.readLimits(response.data);
  }

  public static async countDue(
    projectId: ObjectID,
    request: DueRecordsCountRequest,
  ): Promise<DueRecordsCountAnswer | null> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            ResolvedRecordRetentionAPI.getCountPath(projectId),
          ),
          data: ResolvedRecordRetentionAnswers.toCountRequestJSON(request),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        return null;
      }

      return ResolvedRecordRetentionAnswers.readCount(response.data);
    } catch {
      return null;
    }
  }
}
