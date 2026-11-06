import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { getCloudAppGroupLabel } from "../../Pages/AppPlatforms/Utils/CloudApps";
import { CloudAccountRecommendationResource } from "./CloudAccountRecommendationPlan";
import {
  CloudAccountRecommendationCoverage,
  CloudAccountRecommendationResources,
  loadRecommendationCoverage,
} from "./CloudAccountRecommendationData";
import { buildCloudAppRecommendationContext } from "./RecommendationResourceRegistry";

/*
 * What an App Platforms environment's recommended monitors are worked out
 * from, read the same way by its Recommendations page
 * (CloudEnvironmentAppRecommendations) and by the count beside it in its
 * menu (CloudEnvironmentRecommendationsMenuItem), so the two never
 * disagree:
 *
 *   - the environment's apps, each with the context its own tab reads it
 *     with (buildCloudAppRecommendationContext): its environment's platform,
 *     account and Region and its own attributes - read once for all of
 *     them, from the environment's row;
 *   - the Traces and Metrics monitors that may already cover a
 *     recommendation, and the recommendations the team dismissed on an
 *     app's tab.
 */

export async function loadCloudEnvironmentAppRecommendationResources(data: {
  environmentId: ObjectID;
  translator: Pick<Translator, "translateTemplate">;
}): Promise<CloudAccountRecommendationResources> {
  const [environment, list]: [CloudResource | null, ListResult<CloudApp>] =
    await Promise.all([
      ModelAPI.getItem<CloudResource>({
        modelType: CloudResource,
        id: data.environmentId,
        select: { cloudPlatform: true, cloudAccountId: true, cloudRegion: true },
      }),
      ModelAPI.getList<CloudApp>({
        modelType: CloudApp,
        query: { cloudResourceId: data.environmentId },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        // What decides each one's recommendations, as on its own tab.
        select: {
          _id: true,
          name: true,
          telemetryAttributes: true,
          cloudResourceId: true,
          cloudPlatform: true,
          groupName: true,
        },
        sort: { name: SortOrder.Ascending },
      }),
    ]);

  const environmentId: string = data.environmentId.toString();

  const resources: Array<CloudAccountRecommendationResource> = list.data
    .filter((app: CloudApp): boolean => {
      return Boolean(app._id);
    })
    .map((app: CloudApp): CloudAccountRecommendationResource => {
      const id: string = app._id!.toString();
      const detail: string = getCloudAppGroupLabel({
        groupName: app.groupName as string | undefined,
        cloudPlatform: app.cloudPlatform as string | undefined,
        translator: data.translator,
      });

      return {
        resourceId: id,
        resourceName: (app.name || "").trim() || id,
        context: buildCloudAppRecommendationContext({
          environmentId: environmentId,
          environment: environment
            ? {
                cloudPlatform: environment.cloudPlatform as string | undefined,
                cloudAccountId: environment.cloudAccountId as
                  | string
                  | undefined,
                cloudRegion: environment.cloudRegion as string | undefined,
              }
            : null,
          telemetryAttributes: app.telemetryAttributes,
        }),
        ...(detail ? { detail: detail } : {}),
      };
    });

  return {
    resources: resources,
    total: Math.max(list.count || 0, resources.length),
  };
}

// The kinds of monitor an app's recommendations make: Traces and Metrics.
export function getCloudAppRecommendationMonitorTypes(): Array<MonitorType> {
  const definition: MonitorRecommendationResourceTypeDefinition | undefined =
    MonitorRecommendationCatalog.getResourceTypeDefinition(
      MonitorRecommendationResourceType.CloudApp,
    );

  return definition ? [...definition.monitorTypes] : [];
}

export async function loadCloudEnvironmentAppRecommendationCoverage(): Promise<CloudAccountRecommendationCoverage> {
  return await loadRecommendationCoverage({
    resourceType: MonitorRecommendationResourceType.CloudApp,
    monitorTypes: getCloudAppRecommendationMonitorTypes(),
  });
}
