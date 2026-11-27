import MonitorRecommendationCoverageApi from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCoverageApi";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { MonitorRecommendationCoverageQuestion } from "../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import ObjectID from "../../../Types/ObjectID";
import { answerCoverage } from "./MonitorCoverageAnswer";
import { jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE RECOMMENDATION COVERAGE ROUTE, ANSWERED AS THE SERVER ANSWERS IT
 * (#11074).
 *
 * The pages that say which recommended monitors are already created ask
 * the server (POST /monitor/recommendation-coverage) rather than read the
 * project's monitors. A test hands this the monitors its project has, and
 * each question is answered from them as MonitorRecommendationCoverageQuery
 * answers it: the monitors of the question's type, in the order given (the
 * server reads them by name), matched by the server's own matcher
 * (MonitorCoverageAnswer). A suite that hands none is
 * answered from the monitors its ModelAPI stands in for (jest.setup.ts).
 */

export { answerCoverage };

/*
 * Every coverage question a page asks, answered from `getMonitors()`
 * (read at each question, so a test can change its monitors between
 * reads). The spy holds every batch of questions asked.
 */
export function serveCoverageFrom(
  getMonitors: () => Array<Monitor>,
): SpyInstance<typeof MonitorRecommendationCoverageApi.findCoveringMonitors> {
  return jest
    .spyOn(MonitorRecommendationCoverageApi, "findCoveringMonitors")
    .mockImplementation(
      async (
        questions: Array<MonitorRecommendationCoverageQuestion>,
      ): Promise<Map<string, ObjectID>> => {
        return answerCoverage({ questions, monitors: getMonitors() });
      },
    ) as unknown as SpyInstance<
    typeof MonitorRecommendationCoverageApi.findCoveringMonitors
  >;
}
