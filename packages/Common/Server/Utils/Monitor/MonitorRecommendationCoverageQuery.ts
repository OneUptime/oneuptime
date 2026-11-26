import MonitorService from "../../Services/MonitorService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCreateUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";
import {
  MonitorRecommendationCoverageMatcher,
  MonitorRecommendationCoverageQuestion,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHICH OF THE PROJECT'S MONITORS COVERS EACH RECOMMENDATION ASKED ABOUT,
 * DECIDED WITH A QUERY (#11074).
 *
 * For each monitor type asked about, the project's monitors of that type
 * whose steps mention what the fingerprints are about
 * (getCoverageSearchText - a candidate, never a match) are read by name,
 * a page at a time, under the reader's own permissions: a member whose
 * team reads only the monitors with a label is answered from those alone,
 * as the list they used to read was. Each one is fingerprinted as the
 * browser did (MonitorRecommendationCoverageMatcher), the first by name
 * winning where several cover the same recommendation; reading stops once
 * every fingerprint asked about has its monitor.
 *
 * Archived monitors cover as they always did: the page read every monitor
 * of the type.
 */

// The most candidates read at once.
export const COVERAGE_CANDIDATES_PAGE_SIZE: number = 500;

export default class MonitorRecommendationCoverageQuery {
  @CaptureSpan()
  public static async findCoveringMonitors(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    questions: Array<MonitorRecommendationCoverageQuestion>;
  }): Promise<Map<string, ObjectID>> {
    const byType: Map<
      MonitorType,
      Array<MonitorRecommendationCoverageQuestion>
    > = new Map<MonitorType, Array<MonitorRecommendationCoverageQuestion>>();

    for (const question of data.questions) {
      const list: Array<MonitorRecommendationCoverageQuestion> =
        byType.get(question.monitorType) || [];
      list.push(question);
      byType.set(question.monitorType, list);
    }

    const covered: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const [monitorType, questions] of byType) {
      const matcher: MonitorRecommendationCoverageMatcher =
        new MonitorRecommendationCoverageMatcher(questions);
      const texts: Array<string> | null = matcher.getSearchTexts();

      for (let skip: number = 0; ; skip += COVERAGE_CANDIDATES_PAGE_SIZE) {
        const page: Array<Monitor> = await MonitorService.findBy({
          query: {
            projectId: data.projectId,
            monitorType: monitorType,
            ...(texts
              ? { monitorSteps: QueryHelper.textContainsAnyOf(texts) }
              : {}),
          } as never,
          select: {
            _id: true,
            name: true,
            monitorSteps: true,
          },
          // By name, as the list read was; the id keeps pages from overlapping.
          sort: {
            name: SortOrder.Ascending,
            _id: SortOrder.Ascending,
          } as never,
          limit: COVERAGE_CANDIDATES_PAGE_SIZE,
          skip: skip,
          props: data.props,
        });

        for (const monitor of page) {
          if (!monitor.id) {
            continue;
          }

          matcher.addMonitor(
            monitor.id.toString(),
            MonitorRecommendationCreateUtil.getExistingMonitorSteps([monitor]),
          );
        }

        if (
          page.length < COVERAGE_CANDIDATES_PAGE_SIZE ||
          matcher.isComplete()
        ) {
          break;
        }
      }

      for (const [key, monitorId] of matcher.getAnswer()) {
        covered.set(key, new ObjectID(monitorId));
      }
    }

    return covered;
  }
}
