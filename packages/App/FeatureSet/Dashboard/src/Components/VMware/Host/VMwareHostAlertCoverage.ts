import Monitor from "Common/Models/DatabaseModels/Monitor";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
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
import MonitorRecommendationCreateUtil from "../../Recommendations/MonitorRecommendationCreateUtil";
import RecommendationDismissalUtil from "../../Recommendations/RecommendationDismissalUtil";
import RecommendationFilterUtil from "../../Recommendations/RecommendationFilterUtil";
import {
  RecommendationStatus,
  RecommendationViewModel,
} from "../../Recommendations/RecommendationViewModel";

/*
 * Which of the recommended ESXi host alerts are on, for an ESXi host's page.
 *
 * vCenter's host alerts are not one per host: each VMware template in the
 * "Host" category (CPU and memory saturation, disk latency, NIC errors and
 * drops) is one monitor on the vCenter that groups by
 * resource.vcenter.host.name, and fires once for each host that breaches.
 * So a host is watched exactly when its vCenter has those monitors - the
 * same answer the vCenter's Recommendations page gives, worked out the same
 * way: the catalog, minus the monitors that already cover a recommendation
 * (MonitorRecommendationUtil's fingerprint diff), minus what the team
 * dismissed. Like the Recommendations side-menu badge, it passes placeholder
 * monitor-status and severity ids: they never reach the fingerprint (pinned
 * by "the fingerprint ignores the monitor-status and severity args" in
 * Common's MonitorRecommendationCoverage tests).
 */

export const VMWARE_HOST_ALERT_CATEGORY: string = "Host";

export function getVMwareHostAlertRecommendations(): Array<MonitorRecommendation> {
  return MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.VMware,
  ).filter((recommendation: MonitorRecommendation): boolean => {
    return recommendation.category === VMWARE_HOST_ALERT_CATEGORY;
  });
}

export async function loadVMwareHostAlertCoverage(data: {
  vcenterId: ObjectID;
  vcenterName: string;
}): Promise<Array<RecommendationViewModel>> {
  const recommendations: Array<MonitorRecommendation> =
    getVMwareHostAlertRecommendations();

  const [monitorList, dismissals]: [
    ListResult<Monitor>,
    Array<RecommendationDismissal>,
  ] = await Promise.all([
    ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: { monitorType: MonitorType.VMware },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { name: true, monitorSteps: true },
      sort: { name: SortOrder.Ascending },
    }),
    RecommendationDismissalUtil.getDismissals({
      resourceType: MonitorRecommendationResourceType.VMware,
      resourceId: data.vcenterId,
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
          resourceIdentifier: data.vcenterName,
          onlineMonitorStatusId: placeholderId,
          offlineMonitorStatusId: placeholderId,
          defaultIncidentSeverityId: placeholderId,
          defaultAlertSeverityId: placeholderId,
          monitorName: data.vcenterName,
        },
      }),
    dismissals: dismissals,
  });
}

/*
 * The host alerts nobody turned on or dismissed yet: what "Turn on" ticks
 * on the Recommendations page. A dismissed one stays dismissed - the team
 * said no to it there, and restoring it is that page's call.
 */
export function getVMwareHostAlertsToTurnOn(
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

export function countVMwareHostAlertsOn(
  viewModels: Array<RecommendationViewModel>,
): number {
  return viewModels.filter((viewModel: RecommendationViewModel): boolean => {
    return viewModel.status === RecommendationStatus.Created;
  }).length;
}
