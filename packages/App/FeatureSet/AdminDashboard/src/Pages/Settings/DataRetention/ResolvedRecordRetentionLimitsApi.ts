import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { ResolvedRecordKind } from "Common/Types/Retention/ResolvedRecordRetention";
import ResolvedRecordRetentionAnswers, {
  DueRecordsCountAnswer,
  RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE,
} from "Common/Types/Retention/ResolvedRecordRetentionAnswers";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * Admin Dashboard > Settings > Data Retention, over HTTP (issue #6941): GET
 * /global-config/resolved-record-retention/projects-reached?kind=Incident&
 * maximumInDays=365 (GlobalConfigAPI, master admins only) - how many live
 * projects a new limit holds to a shorter length than they keep resolved
 * incidents (alerts) for now, for the question asked before it is saved.
 *
 * The path is the one GlobalConfigAPI serves it on: the model's CRUD path
 * and the route's name. A count that cannot be had - a refusal, a failure, an
 * answer with no count - is null, never 0: the question is then asked
 * without it rather than saying that nothing more is deleted.
 */

export const getProjectsReachedPath: () => string = (): string => {
  return `${new GlobalConfig().getCrudApiPath()?.toString()}/${RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE}`;
};

export const countProjectsReached: (data: {
  kind: ResolvedRecordKind;
  maximumInDays: number;
}) => Promise<number | null> = async (data: {
  kind: ResolvedRecordKind;
  maximumInDays: number;
}): Promise<number | null> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromURL(APP_API_URL).addRoute(
          new Route(getProjectsReachedPath()),
        ),
        params: {
          kind: data.kind,
          maximumInDays: data.maximumInDays.toString(),
        },
      });

    if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
      return null;
    }

    // The route's { count }, read as every retention count is read.
    const answer: DueRecordsCountAnswer | null =
      ResolvedRecordRetentionAnswers.readCount(response.data);

    return answer ? answer.count : null;
  } catch {
    return null;
  }
};
