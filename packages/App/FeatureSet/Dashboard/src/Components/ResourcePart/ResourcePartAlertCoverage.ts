import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import MonitorRecommendationCoverageApi from "../Recommendations/MonitorRecommendationCoverageApi";
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
  /*
   * What the resource's recommendations depend on, as its Recommendations
   * page passes it: a storage array's platform.
   */
  context?: MonitorRecommendationContext | undefined;
}): Array<MonitorRecommendation> {
  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(
      data.resourceType,
      data.context,
    );

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
  context?: MonitorRecommendationContext | undefined;
}): Promise<Array<RecommendationViewModel>> {
  const recommendations: Array<MonitorRecommendation> =
    getResourcePartAlertRecommendations({
      resourceType: data.resourceType,
      templateIds: data.templateIds,
      context: data.context,
    });

  if (recommendations.length === 0) {
    return [];
  }

  const placeholderId: ObjectID = ObjectID.getZeroObjectID();

  /*
   * Coverage is decided by the server, with a query over every monitor the
   * reader may read (#11074): the part's page read the project's first
   * 10,000 monitors of the types, so a monitor past them never covered it.
   */
  const [coveredMonitorIds, dismissals]: [
    Map<string, ObjectID>,
    Array<RecommendationDismissal>,
  ] = await Promise.all([
    MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds({
      recommendations: recommendations,
      args: {
        resourceIdentifier: data.resourceIdentifier,
        onlineMonitorStatusId: placeholderId,
        offlineMonitorStatusId: placeholderId,
        defaultIncidentSeverityId: placeholderId,
        defaultAlertSeverityId: placeholderId,
        monitorName: data.resourceIdentifier,
      },
    }),
    RecommendationDismissalUtil.getDismissals({
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      recommendationType: RecommendationType.Monitor,
    }),
  ]);

  return RecommendationFilterUtil.buildViewModels({
    recommendations: recommendations,
    coveredMonitorIds: coveredMonitorIds,
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
