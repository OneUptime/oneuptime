import MonitorRecommendationCoverageApi from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCoverageApi";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorRecommendationCreateUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";
import {
  MonitorRecommendationCoverageMatcher,
  MonitorRecommendationCoverageQuestion,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import ObjectID from "../../../Types/ObjectID";
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
 * server reads them by name), matched by the server's own matcher.
 */

export function answerCoverage(data: {
  questions: Array<MonitorRecommendationCoverageQuestion>;
  monitors: Array<Monitor>;
}): Map<string, ObjectID> {
  const covered: Map<string, ObjectID> = new Map<string, ObjectID>();
  const types: Set<string> = new Set<string>(
    data.questions.map(
      (question: MonitorRecommendationCoverageQuestion): string => {
        return question.monitorType;
      },
    ),
  );

  for (const monitorType of types) {
    const matcher: MonitorRecommendationCoverageMatcher =
      new MonitorRecommendationCoverageMatcher(
        data.questions.filter(
          (question: MonitorRecommendationCoverageQuestion): boolean => {
            return question.monitorType === monitorType;
          },
        ),
      );

    for (const monitor of data.monitors) {
      const monitorId: string = (monitor.id || monitor._id || "").toString();

      // A monitor with no type of its own is read as any type's, as a list's fake answered it.
      if (
        !monitorId ||
        (monitor.monitorType && monitor.monitorType !== monitorType)
      ) {
        continue;
      }

      matcher.addMonitor(
        monitorId,
        MonitorRecommendationCreateUtil.getExistingMonitorSteps([monitor]),
      );
    }

    for (const [key, monitorId] of matcher.getAnswer()) {
      covered.set(key, new ObjectID(monitorId));
    }
  }

  return covered;
}

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
