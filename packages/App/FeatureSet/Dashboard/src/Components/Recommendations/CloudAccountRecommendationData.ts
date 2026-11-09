import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { getCloudAccountResourcesQuery } from "../Cloud/CloudAccountScope";
import { CloudAccountRecommendationResource } from "./CloudAccountRecommendationPlan";
import MonitorRecommendationCreateUtil from "./MonitorRecommendationCreateUtil";
import { readCloudResourceRecommendationContext } from "./RecommendationResourceRegistry";

/*
 * What a cloud account's recommended monitors are worked out from, read the
 * same way by its Recommendations tab (CloudAccountMonitorRecommendations)
 * and by the side menu's count beside it
 * (CloudAccountRecommendationsMenuItem), so the two never disagree:
 *
 *   - the account's resources - its live rows of kind resource, with the
 *     columns their recommendations depend on, as a resource's own tab
 *     reads them (readCloudResourceRecommendationContext);
 *   - the Metrics monitors that may already cover a recommendation, and the
 *     recommendations the team dismissed on a cloud resource's tab.
 */

export interface CloudAccountRecommendationResources {
  resources: Array<CloudAccountRecommendationResource>;
  // How many the account holds: more than were read past the list's limit.
  total: number;
}

export interface CloudAccountRecommendationCoverage {
  existingMonitors: Array<{
    monitorId: ObjectID;
    monitorSteps: Array<MonitorStep>;
  }>;
  dismissals: Array<RecommendationDismissal>;
}

export async function loadCloudAccountRecommendationResources(data: {
  projectId: ObjectID;
  provider: string;
  cloudAccountId: string;
}): Promise<CloudAccountRecommendationResources> {
  const list: ListResult<CloudResource> = await ModelAPI.getList<CloudResource>(
    {
      modelType: CloudResource,
      query: {
        ...getCloudAccountResourcesQuery({
          projectId: data.projectId,
          provider: data.provider,
          accountId: data.cloudAccountId,
        }),
        // Its environments are App Platforms', and read no cloud metrics.
        cloudResourceKind: CloudResourceKind.Resource,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      // What decides each one's recommendations, as on its own tab.
      select: {
        _id: true,
        name: true,
        cloudProvider: true,
        cloudResourceType: true,
        telemetryAttributes: true,
        cloudReadings: true,
        cloudProperties: true,
        cloudConnectionId: true,
      },
      sort: { name: SortOrder.Ascending },
    },
  );

  const resources: Array<CloudAccountRecommendationResource> = list.data
    .filter((resource: CloudResource): boolean => {
      return Boolean(resource._id);
    })
    .map((resource: CloudResource): CloudAccountRecommendationResource => {
      const id: string = resource._id!.toString();

      return {
        resourceId: id,
        resourceName: (resource.name || "").trim() || id,
        context: readCloudResourceRecommendationContext(
          resource as unknown as Record<string, unknown>,
        ),
      };
    });

  return {
    resources: resources,
    total: Math.max(list.count || 0, resources.length),
  };
}

export async function loadCloudAccountRecommendationCoverage(): Promise<CloudAccountRecommendationCoverage> {
  return await loadRecommendationCoverage({
    resourceType: MonitorRecommendationResourceType.CloudResource,
    monitorTypes: [MonitorType.Metrics],
  });
}

/*
 * What covers a recommendation of a resource type, read once for every
 * resource of the page: the monitors of the kinds its recommendations make
 * (a cloud resource's are Metrics monitors; an app's, Traces and Metrics),
 * and every dismissal of the type - the plan reads those of the page's own
 * resources (CloudAccountRecommendationPlan.buildGroups), and a list of a
 * few thousand ids is no query to send.
 */
export async function loadRecommendationCoverage(data: {
  resourceType: MonitorRecommendationResourceType;
  monitorTypes: Array<MonitorType>;
}): Promise<CloudAccountRecommendationCoverage> {
  const [monitorLists, dismissalList]: [
    Array<ListResult<Monitor>>,
    ListResult<RecommendationDismissal>,
  ] = await Promise.all([
    Promise.all(
      data.monitorTypes.map(
        (monitorType: MonitorType): Promise<ListResult<Monitor>> => {
          return ModelAPI.getList<Monitor>({
            modelType: Monitor,
            query: { monitorType: monitorType },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, monitorSteps: true },
            sort: { name: SortOrder.Ascending },
          });
        },
      ),
    ),
    ModelAPI.getList<RecommendationDismissal>({
      modelType: RecommendationDismissal,
      query: {
        recommendationType: RecommendationType.Monitor,
        resourceType: data.resourceType,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        recommendationId: true,
        recommendationType: true,
        resourceType: true,
        resourceId: true,
        dismissalReason: true,
      },
      sort: {},
    }),
  ]);

  return {
    existingMonitors: monitorLists
      .flatMap((monitorList: ListResult<Monitor>): Array<Monitor> => {
        return monitorList.data;
      })
      .filter((monitor: Monitor): boolean => {
        return Boolean(monitor.id);
      })
      .map((monitor: Monitor) => {
        return {
          monitorId: monitor.id!,
          monitorSteps: MonitorRecommendationCreateUtil.getExistingMonitorSteps(
            [monitor],
          ),
        };
      }),
    dismissals: dismissalList.data,
  };
}
