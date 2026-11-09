import Monitor from "Common/Models/DatabaseModels/Monitor";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import {
  CLOUD_APP_PLATFORM_FILTER,
  readCloudAppTelemetryFilters,
} from "Common/Types/Monitor/CloudAppAlertTemplates";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import {
  MonitorRecommendationContext,
  MonitorRecommendationNotificationSettings,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import CloudAccountRecommendationPlan, {
  CloudAccountRecommendationDefaults,
  CloudAccountRecommendationGroup,
  CloudAccountRecommendationPlanItem,
  CloudAccountRecommendationResource,
  CloudAccountRecommendationTarget,
  RecommendationPlanGroupIdentity,
  RecommendationPlanScope,
} from "./CloudAccountRecommendationPlan";
import MonitorRecommendationCreateUtil from "./MonitorRecommendationCreateUtil";

/*
 * AN APP PLATFORMS ENVIRONMENT'S RECOMMENDED MONITORS, ACROSS ITS APPS.
 *
 * An app's Recommendations tab offers the monitors OneUptime recommends for
 * it - failed operations, error bursts, traffic that stops, slow requests
 * (CloudAppAlertTemplates); its environment's offers the same monitors for
 * every app it runs at once, so a team with a dozen ECS services sets them
 * all up in one step instead of a dozen. It is the cloud account's join
 * (CloudAccountRecommendationPlan) with an environment's scope: the
 * catalog's CloudApp type, every app in one group, each monitor linked to
 * the environment, where an app's incidents and alerts are listed.
 *
 * Each app's recommendations are built from its own context - its
 * environment's platform, account and Region and its own attributes, the
 * filter its Traces tab uses (buildCloudAppRecommendationContext) - so the
 * "same" recommendation on two apps is two different monitors, and one made
 * on an app's own tab is recognised here as made.
 *
 * React-free, and reads nothing.
 */

// The one group an environment's apps are in.
export const CLOUD_ENVIRONMENT_APPS_GROUP_KEY: string = "apps";

/*
 * Why one of the environment's apps is offered nothing:
 *   - NotScoped: its name was too long to filter its telemetry by, so no
 *     monitor can watch it alone;
 *   - PlatformUnknown: no telemetry has named its environment's platform
 *     yet, and every recommended monitor reads an app's telemetry by it.
 */
export enum CloudEnvironmentAppRecommendationGapReason {
  NotScoped = "NotScoped",
  PlatformUnknown = "PlatformUnknown",
}

export interface CloudEnvironmentAppRecommendationGap {
  resource: CloudAccountRecommendationResource;
  reason: CloudEnvironmentAppRecommendationGapReason;
  // An app's kind needs no saying: its cluster is beside its name instead.
  typeLabel: string;
}

export interface CloudEnvironmentAppRecommendationGaps {
  gaps: Array<CloudEnvironmentAppRecommendationGap>;
  byReason: Record<
    CloudEnvironmentAppRecommendationGapReason,
    Array<CloudEnvironmentAppRecommendationGap>
  >;
}

/*
 * The environment's scope: every app in one group, called what the page
 * calls them (in the reader's language), each monitor linked to the
 * environment - an app keeps no incidents or alerts of its own.
 */
export function getCloudEnvironmentAppRecommendationScope(data: {
  environmentId: string;
  groupLabel: string;
}): RecommendationPlanScope {
  return {
    resourceType: MonitorRecommendationResourceType.CloudApp,
    getGroup: (): RecommendationPlanGroupIdentity => {
      return {
        key: CLOUD_ENVIRONMENT_APPS_GROUP_KEY,
        provider: "",
        resourceType: "",
        label: data.groupLabel,
      };
    },
    linkMonitor: (link: {
      monitor: Monitor;
      resource: CloudAccountRecommendationResource;
    }): void => {
      MonitorRecommendationCreateUtil.linkToCloudResource({
        monitor: link.monitor,
        cloudResourceId: new ObjectID(data.environmentId),
      });
    },
  };
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export default class CloudEnvironmentAppRecommendationPlan {
  // The environment's recommendations: one group, a row per recommendation.
  public static buildGroups(data: {
    environmentId: string;
    groupLabel: string;
    resources: Array<CloudAccountRecommendationResource>;
    existingMonitors: Array<{
      monitorId: ObjectID;
      monitorSteps: Array<MonitorStep>;
    }>;
    dismissals: Array<RecommendationDismissal>;
  }): Array<CloudAccountRecommendationGroup> {
    return CloudAccountRecommendationPlan.buildGroups({
      resources: data.resources,
      existingMonitors: data.existingMonitors,
      dismissals: data.dismissals,
      scope: getCloudEnvironmentAppRecommendationScope({
        environmentId: data.environmentId,
        groupLabel: data.groupLabel,
      }),
    });
  }

  /*
   * One monitor per target, each built for its own app as its tab builds
   * it, and linked to the environment.
   */
  public static buildCreatePlan(data: {
    environmentId: string;
    targets: Array<CloudAccountRecommendationTarget>;
    defaults: CloudAccountRecommendationDefaults;
    notificationSettings: MonitorRecommendationNotificationSettings;
  }): Array<CloudAccountRecommendationPlanItem> {
    return CloudAccountRecommendationPlan.buildCreatePlan({
      targets: data.targets,
      defaults: data.defaults,
      notificationSettings: data.notificationSettings,
      scope: getCloudEnvironmentAppRecommendationScope({
        environmentId: data.environmentId,
        // Not drawn: a plan's monitors are named by app and recommendation.
        groupLabel: "",
      }),
    });
  }

  // Why an app that is offered nothing is offered nothing.
  public static getGapReason(
    context: MonitorRecommendationContext,
  ): CloudEnvironmentAppRecommendationGapReason {
    const filters: Record<string, string> = readCloudAppTelemetryFilters(
      context.cloudAppTelemetryFilters,
    );

    return filters[CLOUD_APP_PLATFORM_FILTER]
      ? CloudEnvironmentAppRecommendationGapReason.NotScoped
      : CloudEnvironmentAppRecommendationGapReason.PlatformUnknown;
  }

  /*
   * The environment's apps offered nothing, each with why, in the order the
   * page lists its apps: by name, then by what tells two of one name apart.
   */
  public static getGaps(data: {
    resources: Array<CloudAccountRecommendationResource>;
    groups: Array<CloudAccountRecommendationGroup>;
  }): CloudEnvironmentAppRecommendationGaps {
    const offered: Set<string> = new Set<string>();

    for (const group of data.groups) {
      for (const resource of group.resources) {
        offered.add(resource.resourceId);
      }
    }

    const result: CloudEnvironmentAppRecommendationGaps = {
      gaps: [],
      byReason: {
        [CloudEnvironmentAppRecommendationGapReason.NotScoped]: [],
        [CloudEnvironmentAppRecommendationGapReason.PlatformUnknown]: [],
      },
    };

    const sorted: Array<CloudAccountRecommendationResource> = [
      ...data.resources,
    ].sort(
      (
        a: CloudAccountRecommendationResource,
        b: CloudAccountRecommendationResource,
      ): number => {
        return (
          compareText(a.resourceName, b.resourceName) ||
          compareText(a.detail || "", b.detail || "") ||
          compareText(a.resourceId, b.resourceId)
        );
      },
    );

    for (const resource of sorted) {
      if (offered.has(resource.resourceId)) {
        continue;
      }

      const gap: CloudEnvironmentAppRecommendationGap = {
        resource: resource,
        reason: this.getGapReason(resource.context),
        typeLabel: "",
      };

      result.gaps.push(gap);
      result.byReason[gap.reason].push(gap);
    }

    return result;
  }
}
