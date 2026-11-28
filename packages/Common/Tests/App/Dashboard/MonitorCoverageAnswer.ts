import Monitor from "../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCreateUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";
import {
  MonitorRecommendationCoverageMatcher,
  MonitorRecommendationCoverageQuestion,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * THE RECOMMENDATION COVERAGE ROUTE, ANSWERED AS THE SERVER ANSWERS IT
 * (#11074, #11170).
 *
 * The pages that say which recommended monitors are already created - a
 * resource's Recommendations tab and its menu's badge, a part's alerts card,
 * a cloud account's recommendations, the telemetry guided setup - ask the
 * server (POST /monitor/recommendation-coverage). They read the project's
 * monitors through ModelAPI before #11170, which every page suite stands in
 * for, so a suite that drew one of them never had to answer coverage. Since
 * then, every suite that draws a resource's side menu or a part's page sent
 * the request, and Tests/jest.setup.ts's network rule failed it
 * (StorageArrayPages and the rest).
 *
 * So every suite is answered here, as the server answers: from the monitors
 * the suite's ModelAPI stands in for, read as the pages read them before
 * (Monitor, by the questions' monitor types, by name), each question matched
 * by the server's own matcher. jest.setup.ts hands answerCoverageFromModelApi
 * to the Dashboard's MonitorRecommendationCoverageApi in every suite; a suite
 * that answers coverage itself (MonitorCoverageServer.serveCoverageFrom, a
 * spy on findCoveringMonitors) still does, and the client's own suite tests
 * the real request (jest.unmock).
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
 * The project's monitors of the questions' types, as the running suite's
 * ModelAPI stands in for them: the read the pages made before #11170, one
 * list for each monitor type (the Recommendations page, its badge, the
 * guided setup and a cloud account's read them so). This file is first
 * loaded when a page loads the coverage client, after the suite's
 * jest.mock of ModelAPI, so its ModelAPI is the suite's; a jest.spyOn of
 * getList is seen when the questions are asked.
 */
async function readSuiteMonitors(
  monitorTypes: Array<MonitorType>,
): Promise<Array<Monitor>> {
  const lists: Array<ListResult<Monitor> | undefined> = await Promise.all(
    monitorTypes.map(
      async (monitorType: MonitorType): Promise<ListResult<Monitor>> => {
        return await ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: { monitorType: monitorType },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { name: true, monitorSteps: true },
          sort: { name: SortOrder.Ascending },
        });
      },
    ),
  );

  return lists.flatMap(
    (list: ListResult<Monitor> | undefined): Array<Monitor> => {
      return list?.data || [];
    },
  );
}

// What the server answers the questions, from the running suite's monitors.
export async function answerCoverageFromModelApi(
  questions: Array<MonitorRecommendationCoverageQuestion>,
): Promise<Map<string, ObjectID>> {
  if (questions.length === 0) {
    return new Map<string, ObjectID>();
  }

  const monitorTypes: Array<MonitorType> = Array.from(
    new Set<MonitorType>(
      questions.map(
        (question: MonitorRecommendationCoverageQuestion): MonitorType => {
          return question.monitorType;
        },
      ),
    ),
  );

  return answerCoverage({
    questions,
    monitors: await readSuiteMonitors(monitorTypes),
  });
}
