import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { getCloudAccountResourcesQuery } from "../Cloud/CloudAccountScope";
import CloudAccountRecommendationPlan, {
  CloudAccountRecommendationResource,
} from "./CloudAccountRecommendationPlan";
import MonitorRecommendationCoverageApi from "./MonitorRecommendationCoverageApi";
import {
  CLOUD_RECOMMENDATION_CONNECTION_SELECT,
  readCloudConnectionRecommendationContext,
  readCloudResourceRecommendationContext,
} from "./RecommendationResourceRegistry";

/*
 * What a cloud account's recommended monitors are worked out from, read the
 * same way by its Recommendations tab (CloudAccountMonitorRecommendations)
 * and by the side menu's count beside it
 * (CloudAccountRecommendationsMenuItem), so the two never disagree:
 *
 *   - the account's resources - its live rows of kind resource, with the
 *     columns their recommendations depend on, as a resource's own tab
 *     reads them (readCloudResourceRecommendationContext), and what each
 *     one's connection says of how its metrics come: how often it reads
 *     them, and which its stream writes instead, which each monitor's
 *     window follows (readCloudConnectionRecommendationContext, #10028);
 *   - which of their recommendations a monitor covers already, decided by
 *     the server (#11074), and the recommendations the team dismissed on a
 *     cloud resource's tab.
 */

export interface CloudAccountRecommendationResources {
  resources: Array<CloudAccountRecommendationResource>;
  // How many the account holds: more than were read past the list's limit.
  total: number;
}

export interface CloudAccountRecommendationCoverage {
  /*
   * The monitor that covers each recommendation of each resource, by
   * getCloudAccountCoverageKey: decided by the server (#11074).
   */
  coveredMonitorIds: Map<string, ObjectID>;
  dismissals: Array<RecommendationDismissal>;
}

export async function loadCloudAccountRecommendationResources(data: {
  projectId: ObjectID;
  provider: string;
  cloudAccountId: string;
}): Promise<CloudAccountRecommendationResources> {
  const [list, connections]: [
    ListResult<CloudResource>,
    Map<string, CloudConnection>,
  ] = await Promise.all([
    loadAccountResources(data),
    loadCloudConnections(data.provider),
  ]);
  const now: Date = OneUptimeDate.getCurrentDate();

  const resources: Array<CloudAccountRecommendationResource> = list.data
    .filter((resource: CloudResource): boolean => {
      return Boolean(resource._id);
    })
    .map((resource: CloudResource): CloudAccountRecommendationResource => {
      const id: string = resource._id!.toString();
      const record: Record<string, unknown> = resource as unknown as Record<
        string,
        unknown
      >;

      return {
        resourceId: id,
        resourceName: (resource.name || "").trim() || id,
        context: readCloudConnectionRecommendationContext({
          context: readCloudResourceRecommendationContext(record),
          record,
          connection: connections.get(
            String(resource.cloudConnectionId || "").trim(),
          ),
          now,
        }),
      };
    });

  return {
    resources: resources,
    total: Math.max(list.count || 0, resources.length),
  };
}

function loadAccountResources(data: {
  projectId: ObjectID;
  provider: string;
  cloudAccountId: string;
}): Promise<ListResult<CloudResource>> {
  return ModelAPI.getList<CloudResource>({
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
      // What its account's stream is read by.
      cloudAccountId: true,
      cloudRegion: true,
    },
    sort: { name: SortOrder.Ascending },
  });
}

/*
 * The project's connections of the account's cloud, by id: a project has a
 * few, and each resource names its own. A read that fails reads none - each
 * resource's monitors then read the windows of its cloud's default
 * interval, as before.
 */
async function loadCloudConnections(
  provider: string,
): Promise<Map<string, CloudConnection>> {
  const connections: Map<string, CloudConnection> = new Map<
    string,
    CloudConnection
  >();

  try {
    const list: ListResult<CloudConnection> =
      await ModelAPI.getList<CloudConnection>({
        modelType: CloudConnection,
        query: { provider: provider as CloudProvider },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, ...CLOUD_RECOMMENDATION_CONNECTION_SELECT },
        sort: {},
      });

    for (const connection of list.data) {
      if (connection._id) {
        connections.set(connection._id.toString(), connection);
      }
    }
  } catch {
    // Read as before: the windows of its cloud's default interval.
  }

  return connections;
}

/*
 * Which of the resources' recommendations a monitor covers already, and
 * what the team dismissed. Coverage is the server's to decide, with a query
 * over every monitor the reader may read (#11074): the page read the
 * project's first 10,000 Metrics monitors and compared them here, so a
 * monitor past them never covered anything, and the account offered again
 * what was already made.
 */
export async function loadCloudAccountRecommendationCoverage(
  resources: Array<CloudAccountRecommendationResource>,
): Promise<CloudAccountRecommendationCoverage> {
  const [coveredMonitorIds, dismissalList]: [
    Map<string, ObjectID>,
    ListResult<RecommendationDismissal>,
  ] = await Promise.all([
    MonitorRecommendationCoverageApi.findCoveringMonitors(
      CloudAccountRecommendationPlan.getCoverageQuestions(resources),
    ),
    /*
     * Every cloud resource's dismissals: the plan reads those of the
     * account's own resources (CloudAccountRecommendationPlan.buildGroups),
     * and a list of a few thousand ids is no query to send.
     */
    ModelAPI.getList<RecommendationDismissal>({
      modelType: RecommendationDismissal,
      query: {
        recommendationType: RecommendationType.Monitor,
        resourceType: MonitorRecommendationResourceType.CloudResource,
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
    coveredMonitorIds,
    dismissals: dismissalList.data,
  };
}
