import Monitor from "Common/Models/DatabaseModels/Monitor";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  MAX_COVERAGE_QUESTIONS,
  MONITOR_RECOMMENDATION_COVERAGE_PATH,
  MonitorRecommendationCoverageQuestion,
  getCoverageQuestions,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHICH RECOMMENDED MONITORS A RESOURCE HAS ALREADY, ASKED OF THE SERVER
 * (#11074).
 *
 * Every page that says which recommendations are already created - a
 * resource's Recommendations tab and its menu's count, a cloud account's
 * recommendations and its count, the telemetry guided setup - read the
 * project's first 10,000 monitors of each type, every step of each, and
 * compared them here. A monitor past them that covered a recommendation was
 * never seen: the recommendation read as missing, and the guided setup
 * offered to make it again. The server decides it now, with a query
 * (POST /monitor/recommendation-coverage,
 * MonitorRecommendationCoverageQuestions), and answers a monitor id for
 * each covered recommendation, however many monitors the project has.
 */
export default class MonitorRecommendationCoverageApi {
  /*
   * The monitor that covers each question, by its key: asked in requests
   * of at most MAX_COVERAGE_QUESTIONS, one after another. A request that
   * fails fails the answer - a page that showed a part of it would offer a
   * covered recommendation again.
   */
  public static async findCoveringMonitors(
    questions: Array<MonitorRecommendationCoverageQuestion>,
  ): Promise<Map<string, ObjectID>> {
    const covered: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (
      let start: number = 0;
      start < questions.length;
      start += MAX_COVERAGE_QUESTIONS
    ) {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString())
            .addRoute(new Monitor().getCrudApiPath()!)
            .addRoute(MONITOR_RECOMMENDATION_COVERAGE_PATH),
          data: {
            questions: questions.slice(
              start,
              start + MAX_COVERAGE_QUESTIONS,
            ) as unknown as Array<JSONObject>,
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const answer: unknown = (response.data || {})["covered"];

      if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
        continue;
      }

      for (const [key, monitorId] of Object.entries(
        answer as Record<string, unknown>,
      )) {
        if (typeof monitorId === "string" && ObjectID.isValidUUID(monitorId)) {
          covered.set(key, new ObjectID(monitorId));
        }
      }
    }

    return covered;
  }

  // One resource's covered recommendations, by recommendation id.
  public static async getCoveredRecommendationMonitorIds(data: {
    recommendations: ReadonlyArray<MonitorRecommendation>;
    args: MonitorRecommendationArgs;
  }): Promise<Map<string, ObjectID>> {
    return await MonitorRecommendationCoverageApi.findCoveringMonitors(
      getCoverageQuestions({
        recommendations: data.recommendations,
        args: data.args,
      }),
    );
  }
}
