import Monitor from "Common/Models/DatabaseModels/Monitor";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import MonitorRecommendationCreateUtil from "../Recommendations/MonitorRecommendationCreateUtil";
import RecommendationDismissalUtil from "../Recommendations/RecommendationDismissalUtil";
import RecommendationFilterUtil from "../Recommendations/RecommendationFilterUtil";
import {
  RecommendationStatus,
  RecommendationViewModel,
} from "../Recommendations/RecommendationViewModel";

/*
 * "Will I hear about it when this part is in trouble?" for a part's own
 * page: which of the resource's recommended alerts that watch parts of
 * this kind are on - the ESXi host page's coverage, generalized.
 *
 * A resource's part alerts are not one per part: each template is one
 * monitor on the resource that groups by the part (a Proxmox template by
 * `id`) and fires for each part that crosses it. So a part is watched
 * exactly when its resource has those monitors - the same answer the
 * resource's Recommendations page gives, worked out the same way: the
 * catalog, minus the monitors that already cover a recommendation
 * (MonitorRecommendationUtil's fingerprint diff), minus what the team
 * dismissed. Like the Recommendations side-menu badge, it passes
 * placeholder monitor-status and severity ids: they never reach the
 * fingerprint.
 */

export function getResourcePartAlertRecommendations(data: {
  resourceType: MonitorRecommendationResourceType;
  // The template ids that watch this kind of part, in the order to list them.
  templateIds: Array<string>;
}): Array<MonitorRecommendation> {
  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(data.resourceType);

  return data.templateIds
    .map((templateId: string): MonitorRecommendation | undefined => {
      return recommendations.find(
        (recommendation: MonitorRecommendation): boolean => {
          return recommendation.templateId === templateId;
        },
      );
    })
    .filter(
      (
        recommendation: MonitorRecommendation | undefined,
      ): recommendation is MonitorRecommendation => {
        return Boolean(recommendation);
      },
    );
}

export async function loadResourcePartAlertCoverage(data: {
  resourceType: MonitorRecommendationResourceType;
  templateIds: Array<string>;
  resourceId: ObjectID;
  // What the resource's monitors are matched on (its name).
  resourceIdentifier: string;
}): Promise<Array<RecommendationViewModel>> {
  const recommendations: Array<MonitorRecommendation> =
    getResourcePartAlertRecommendations({
      resourceType: data.resourceType,
      templateIds: data.templateIds,
    });

  if (recommendations.length === 0) {
    return [];
  }

  const monitorTypes: Array<MonitorType> = Array.from(
    new Set(
      recommendations.map((recommendation: MonitorRecommendation) => {
        return recommendation.monitorType;
      }),
    ),
  );

  const [monitorList, dismissals]: [
    ListResult<Monitor>,
    Array<RecommendationDismissal>,
  ] = await Promise.all([
    ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        monitorType:
          monitorTypes.length === 1
            ? monitorTypes[0]!
            : new Includes(monitorTypes),
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { name: true, monitorSteps: true },
      sort: { name: SortOrder.Ascending },
    }),
    RecommendationDismissalUtil.getDismissals({
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      recommendationType: RecommendationType.Monitor,
    }),
  ]);

  const placeholderId: ObjectID = ObjectID.getZeroObjectID();

  return RecommendationFilterUtil.buildViewModels({
    recommendations: recommendations,
    coveredMonitorIds:
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: recommendations,
        existingMonitors: monitorList.data
          .filter((monitor: Monitor): boolean => {
            return Boolean(monitor.id);
          })
          .map((monitor: Monitor) => {
            return {
              monitorId: monitor.id!,
              monitorSteps:
                MonitorRecommendationCreateUtil.getExistingMonitorSteps([
                  monitor,
                ]) as Array<MonitorStep>,
            };
          }),
        args: {
          resourceIdentifier: data.resourceIdentifier,
          onlineMonitorStatusId: placeholderId,
          offlineMonitorStatusId: placeholderId,
          defaultIncidentSeverityId: placeholderId,
          defaultAlertSeverityId: placeholderId,
          monitorName: data.resourceIdentifier,
        },
      }),
    dismissals: dismissals,
  });
}

/*
 * The alerts nobody turned on or dismissed yet: what "Turn on" ticks on the
 * Recommendations page. A dismissed one stays dismissed - the team said no
 * to it there, and restoring it is that page's call.
 */
export function getResourcePartAlertsToTurnOn(
  viewModels: Array<RecommendationViewModel>,
): Array<string> {
  return viewModels
    .filter((viewModel: RecommendationViewModel): boolean => {
      return viewModel.status === RecommendationStatus.Available;
    })
    .map((viewModel: RecommendationViewModel): string => {
      return viewModel.recommendation.recommendationId;
    });
}

export function countResourcePartAlertsOn(
  viewModels: Array<RecommendationViewModel>,
): number {
  return viewModels.filter((viewModel: RecommendationViewModel): boolean => {
    return viewModel.status === RecommendationStatus.Created;
  }).length;
}
