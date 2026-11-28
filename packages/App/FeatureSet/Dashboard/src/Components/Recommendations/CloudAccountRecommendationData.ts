import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import EveryPage from "Common/UI/Utils/EveryPage";
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
 *
 * EVERY RESOURCE, AND EVERY DISMISSAL OF ONE (#11210). The account's
 * resources were one read of the first 10,000, and the dismissals one read
 * of the project's first 10,000: in a larger account the resources past
 * them were offered nothing, and in a project that had dismissed more, a
 * dismissed recommendation came back as one to set up. The resources are
 * read a page at a time until every one is (EveryPage), and the dismissals
 * by the resources they are of - the account's own, every one - rather
 * than the project's first 10,000.
 */

// The most resources one page of the account's holds.
export const ACCOUNT_RESOURCES_PAGE_SIZE: number = 2500;

// The most resources whose dismissals one read asks for.
export const DISMISSALS_RESOURCES_PER_READ: number = 500;

export interface CloudAccountRecommendationResources {
  // Every resource the account holds, each with what decides its monitors.
  resources: Array<CloudAccountRecommendationResource>;
}

export interface CloudAccountRecommendationCoverage {
  /*
   * The monitor that covers each recommendation of each resource, by
   * getCloudAccountCoverageKey: decided by the server (#11074).
   */
  coveredMonitorIds: Map<string, ObjectID>;
  // What the team dismissed on the account's resources' tabs.
  dismissals: Array<RecommendationDismissal>;
}

// What decides each resource's recommendations, as on its own tab.
export const CLOUD_ACCOUNT_RESOURCE_SELECT: Select<CloudResource> = {
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
};

// What the plan reads of a dismissal.
export const CLOUD_ACCOUNT_DISMISSAL_SELECT: Select<RecommendationDismissal> = {
  recommendationId: true,
  recommendationType: true,
  resourceType: true,
  resourceId: true,
  dismissalReason: true,
};

export async function loadCloudAccountRecommendationResources(data: {
  projectId: ObjectID;
  provider: string;
  cloudAccountId: string;
}): Promise<CloudAccountRecommendationResources> {
  const [rows, connections]: [
    Array<CloudResource>,
    Map<string, CloudConnection>,
  ] = await Promise.all([
    loadAccountResources(data),
    loadCloudConnections(data.provider),
  ]);
  const now: Date = OneUptimeDate.getCurrentDate();

  const resources: Array<CloudAccountRecommendationResource> = rows
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

  return { resources: resources };
}

/*
 * Every resource of the account, by name, a page at a time: a page holds
 * each resource's attributes, readings and properties, so the pages are
 * smaller than the most a page may hold.
 */
function loadAccountResources(data: {
  projectId: ObjectID;
  provider: string;
  cloudAccountId: string;
}): Promise<Array<CloudResource>> {
  return EveryPage.read<CloudResource>({
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
    select: CLOUD_ACCOUNT_RESOURCE_SELECT,
    sort: { name: SortOrder.Ascending },
    pageSize: ACCOUNT_RESOURCES_PAGE_SIZE,
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
    const rows: Array<CloudConnection> = await EveryPage.read<CloudConnection>({
      modelType: CloudConnection,
      query: { provider: provider as CloudProvider },
      select: { _id: true, ...CLOUD_RECOMMENDATION_CONNECTION_SELECT },
    });

    for (const connection of rows) {
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
 * What the team dismissed on these resources' tabs - every dismissal of
 * every one of them - read by the resources, a few hundred at a time, each
 * read a page at a time (a resource has a dismissal per recommendation it
 * was offered). A read that fails fails the answer: a dismissed
 * recommendation read as not dismissed would be offered again.
 */
export async function loadCloudAccountDismissals(
  resourceIds: Array<string>,
): Promise<Array<RecommendationDismissal>> {
  const ids: Array<string> = Array.from(
    new Set(
      resourceIds
        .map((id: string): string => {
          return id.trim().toLowerCase();
        })
        .filter((id: string): boolean => {
          return ObjectID.isValidUUID(id);
        }),
    ),
  );

  const dismissals: Array<RecommendationDismissal> = [];

  for (
    let start: number = 0;
    start < ids.length;
    start += DISMISSALS_RESOURCES_PER_READ
  ) {
    dismissals.push(
      ...(await EveryPage.read<RecommendationDismissal>({
        modelType: RecommendationDismissal,
        query: {
          recommendationType: RecommendationType.Monitor,
          resourceType: MonitorRecommendationResourceType.CloudResource,
          resourceId: new Includes(
            ids
              .slice(start, start + DISMISSALS_RESOURCES_PER_READ)
              .map((id: string): ObjectID => {
                return new ObjectID(id);
              }),
          ),
        } as Query<RecommendationDismissal>,
        select: CLOUD_ACCOUNT_DISMISSAL_SELECT,
      })),
    );
  }

  return dismissals;
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
  const [coveredMonitorIds, dismissals]: [
    Map<string, ObjectID>,
    Array<RecommendationDismissal>,
  ] = await Promise.all([
    MonitorRecommendationCoverageApi.findCoveringMonitors(
      CloudAccountRecommendationPlan.getCoverageQuestions(resources),
    ),
    loadCloudAccountDismissals(
      resources.map((resource: CloudAccountRecommendationResource): string => {
        return resource.resourceId;
      }),
    ),
  ]);

  return {
    coveredMonitorIds,
    dismissals: dismissals,
  };
}
