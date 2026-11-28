/*
 * WHICH RECOMMENDED MONITORS A RESOURCE HAS ALREADY, AS AN OFFLINE
 * FIXTURE'S SERVER ANSWERS IT (#11074).
 *
 * A resource's alerts card, a resource part's alerts card
 * (Components/ResourcePart/ResourcePartAlertCoverage), a Recommendations tab
 * and the Recommendations badge in a side menu no longer read the project's
 * monitors through the model API: they send their recommendations' fingerprints
 * (POST /monitor/recommendation-coverage, MonitorRecommendationCoverageApi)
 * and the server answers a monitor id for each covered recommendation
 * (MonitorRecommendationCoverageQuery). For each monitor type asked about,
 * it reads the project's monitors of that type by name, each matched by the
 * server's own matcher (MonitorRecommendationCoverageMatcher), the first by
 * name covering a recommendation. The route refuses a role that may not read
 * monitors (assertCanReadTable: a NotAuthorizedException, 422) and questions
 * it cannot read (readCoverageQuestions: a BadDataException, 400), saying
 * why, as the server's error handler writes them.
 *
 * A fixture answers the route with answerRecommendationCoverage, beside the
 * other routes it models, handing it the monitors its project holds and
 * whether its reader may read them:
 *
 *   const coverage = answerRecommendationCoverage({
 *     method,
 *     url,
 *     body,
 *     monitors: store.Monitor,
 *     mayReadMonitors: ALERTS !== "denied",
 *   });
 *   if (coverage) {
 *     return coverage;
 *   }
 */
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import {
  MONITOR_RECOMMENDATION_COVERAGE_PATH,
  MonitorRecommendationCoverageMatcher,
  readCoverageQuestions,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import MonitorRecommendationCreateUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";

// The route, under the monitors' own (/monitor), as MonitorAPI serves it.
const COVERAGE_ROUTE = `/monitor${MONITOR_RECOMMENDATION_COVERAGE_PATH}`;

// MonitorAPI's refusal of a role that may not read monitors.
export const RECOMMENDATION_COVERAGE_REFUSAL =
  "You do not have permission to read this project's monitors.";

// Whether <method> <url> - a URL, or text, absolute or a path - is the route.
export function isRecommendationCoverageRequest(method, url) {
  const pathname = new URL(String(url), "http://fixture.invalid").pathname;
  return (
    String(method).toUpperCase() === "POST" &&
    pathname.replace(/^\/api(?=\/)/, "") === COVERAGE_ROUTE
  );
}

/*
 * A monitor's steps as the server reads them: its MonitorSteps, or the JSON
 * of one (a monitor a fixture kept serialized) read back as the server's
 * column transformer reads it.
 */
function stepsOf(monitor) {
  const held = monitor.monitorSteps;
  const monitorSteps =
    held && !(held instanceof MonitorSteps) && held._type === "MonitorSteps"
      ? MonitorSteps.fromJSON(held)
      : held;
  return MonitorRecommendationCreateUtil.getExistingMonitorSteps([
    { monitorSteps },
  ]);
}

/*
 * The answer to <method> <url> with <body>, or null when it is not the
 * route: { covered: { <question's key>: <monitor id> } }, from `monitors`
 * (the project's, plain records or models, each with its `_id`, `name`,
 * `monitorType` and `monitorSteps`), read by type and by name, as the server
 * reads them - or the server's refusal, when `mayReadMonitors` is false or
 * the questions are not ones it reads.
 */
export function answerRecommendationCoverage(data) {
  if (!isRecommendationCoverageRequest(data.method, data.url)) {
    return null;
  }

  if (data.mayReadMonitors === false) {
    return new HTTPErrorResponse(
      422,
      { message: RECOMMENDATION_COVERAGE_REFUSAL },
      {},
    );
  }

  let questions;
  try {
    questions = readCoverageQuestions(data.body);
  } catch (error) {
    return new HTTPErrorResponse(400, { message: error.message }, {});
  }

  const covered = {};
  const monitorTypes = new Set(
    questions.map((question) => {
      return question.monitorType;
    }),
  );

  for (const monitorType of monitorTypes) {
    const matcher = new MonitorRecommendationCoverageMatcher(
      questions.filter((question) => {
        return question.monitorType === monitorType;
      }),
    );
    // By name, as the server reads them; the id keeps two of one name in order.
    const byName = (data.monitors || [])
      .filter((monitor) => {
        return monitor.monitorType === monitorType;
      })
      .sort((a, b) => {
        return (
          String(a.name ?? "").localeCompare(String(b.name ?? "")) ||
          String(a._id).localeCompare(String(b._id))
        );
      });

    for (const monitor of byName) {
      matcher.addMonitor(String(monitor._id), stepsOf(monitor));
    }

    for (const [key, monitorId] of matcher.getAnswer()) {
      covered[key] = monitorId;
    }
  }

  return new HTTPResponse(200, { covered }, {});
}
