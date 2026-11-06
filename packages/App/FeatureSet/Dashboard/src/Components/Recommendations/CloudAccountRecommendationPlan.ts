import Monitor from "Common/Models/DatabaseModels/Monitor";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import { getCloudResourceTypeDisplayName } from "Common/Types/Cloud/CloudResourceCatalog";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  getCloudAlertTemplatesForType,
  readCloudTelemetryAttributes,
} from "Common/Types/Monitor/CloudAlertTemplates";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationContext,
  MonitorRecommendationNotificationSettings,
  MonitorRecommendationResourceType,
  MonitorRecommendationSeverity,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import MonitorRecommendationCreateUtil from "./MonitorRecommendationCreateUtil";
import type { MonitorRecommendationProjectDefaults } from "./MonitorRecommendationProjectSetup";
import RecommendationFilterUtil from "./RecommendationFilterUtil";
import {
  RecommendationCounts,
  RecommendationFilterState,
  RecommendationSeverityFilter,
  RecommendationStatus,
  RecommendationStatusFilter,
  RecommendationViewModel,
} from "./RecommendationViewModel";

/*
 * A CLOUD ACCOUNT'S RECOMMENDED MONITORS, ACROSS ITS RESOURCES.
 *
 * A resource's Recommendations tab offers the monitors of its cloud and its
 * type (CloudAlertTemplates); an account's offers the same monitors for
 * every resource it holds at once, so a team that connects an account with
 * forty instances and a dozen functions sets them all up in one step
 * instead of forty-odd. Each recommendation is one row per resource type -
 * Status Checks Failing on the EC2 instances, Function Errors on the Lambda
 * functions - with the resources it is offered to, which of them already
 * have the monitor (a monitor that fingerprints as it would, made from the
 * resource's tab, from here, or by hand), and which the team dismissed on
 * the resource's tab.
 *
 * Each resource's recommendations are built from what its own row says
 * (readCloudResourceRecommendationContext): one resource's monitor reads
 * its own metrics, under its own attributes, so the "same" recommendation
 * on two resources is two different monitors. This module is that join,
 * kept out of the page so it can be tested in a suite with no renderer.
 * React-free, and reads nothing.
 */

// One resource of the account, as the page read it.
export interface CloudAccountRecommendationResource {
  // The CloudResource row's id: its monitors' resource identifier too.
  resourceId: string;
  resourceName: string;
  context: MonitorRecommendationContext;
}

// One recommendation for one resource, and where it stands.
export interface CloudAccountRecommendationTarget {
  resource: CloudAccountRecommendationResource;
  // Built for this resource: its monitor reads this resource's metrics.
  recommendation: MonitorRecommendation;
  status: RecommendationStatus;
  // The monitor that covers it, when status is Created.
  monitorId?: ObjectID | undefined;
}

export interface CloudAccountRecommendationCounts {
  total: number;
  available: number;
  created: number;
  dismissed: number;
}

// One recommendation of one resource type, across the resources offered it.
export interface CloudAccountRecommendationRow {
  recommendationId: string;
  name: string;
  // The one plain sentence of when it fires (CloudAlertTemplate.summary).
  summary?: string | undefined;
  description: string;
  category: string;
  severity: MonitorRecommendationSeverity;
  targets: Array<CloudAccountRecommendationTarget>;
  counts: CloudAccountRecommendationCounts;
}

// The recommendations of one resource type of the account.
export interface CloudAccountRecommendationGroup {
  // "<cloud>|<type>", lower case: unique per group.
  key: string;
  provider: string;
  resourceType: string;
  // The type as the product names it: "EC2 Instance", "Azure SQL Database".
  label: string;
  // The resources of this type that are offered at least one recommendation.
  resources: Array<CloudAccountRecommendationResource>;
  rows: Array<CloudAccountRecommendationRow>;
  counts: CloudAccountRecommendationCounts;
}

/*
 * Why one of the account's resources is offered nothing:
 *   - NoMetrics: none of its metrics has arrived, and every recommended
 *     monitor reads them;
 *   - NextRead: its connection read it before a read kept the names its
 *     Azure metrics are stored under - its next read, minutes away, does;
 *   - Unsupported: OneUptime has no recommended monitor for its type, or for
 *     the metrics it reports (a network load balancer's namespace).
 */
export enum CloudAccountRecommendationGapReason {
  NoMetrics = "NoMetrics",
  NextRead = "NextRead",
  Unsupported = "Unsupported",
}

export interface CloudAccountRecommendationGap {
  resource: CloudAccountRecommendationResource;
  reason: CloudAccountRecommendationGapReason;
  // Its type, as the product names it: "VPC", "S3 Bucket".
  typeLabel: string;
}

// The account's resources offered nothing, by reason, each by name.
export interface CloudAccountRecommendationGaps {
  gaps: Array<CloudAccountRecommendationGap>;
  byReason: Record<
    CloudAccountRecommendationGapReason,
    Array<CloudAccountRecommendationGap>
  >;
}

// One monitor to create, for one resource (runBulkAction's item).
export interface CloudAccountRecommendationPlanItem {
  target: CloudAccountRecommendationTarget;
  monitor: Monitor;
  miscDataProps: JSONObject;
}

// What the progress dialog calls the monitors it made, and did not make.
export const CLOUD_ACCOUNT_CREATE_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
} = {
  succeeded: {
    one: "{{count}} {{itemName}} created",
    other: "{{count}} {{itemsName}} created",
  },
  failed: {
    one: "{{count}} {{itemName}} not created",
    other: "{{count}} {{itemsName}} not created",
  },
};

/*
 * The project's ids every recommended monitor's criteria are built with
 * (MonitorRecommendationProjectSetup).
 */
export type CloudAccountRecommendationDefaults =
  MonitorRecommendationProjectDefaults;

/*
 * The arguments a resource's recommendation is built with. Its identifier
 * is its row's id, as on its own tab (RecommendationResourceRegistry), so
 * coverage reads the same here and there.
 */
export function getCloudAccountRecommendationArgs(data: {
  resource: CloudAccountRecommendationResource;
  defaults: CloudAccountRecommendationDefaults;
}): MonitorRecommendationArgs {
  return {
    resourceIdentifier: data.resource.resourceId,
    onlineMonitorStatusId: data.defaults.onlineMonitorStatusId,
    offlineMonitorStatusId: data.defaults.offlineMonitorStatusId,
    defaultIncidentSeverityId: data.defaults.defaultIncidentSeverityId,
    defaultAlertSeverityId: data.defaults.defaultAlertSeverityId,
    monitorName: data.resource.resourceName,
  };
}

/*
 * The coverage join reduces each step to a fingerprint of what it reads,
 * which no status or severity id is part of (MonitorRecommendationCoverage
 * pins it), so a read that only needs coverage builds with placeholders.
 */
function getFingerprintArgs(
  resource: CloudAccountRecommendationResource,
): MonitorRecommendationArgs {
  const placeholder: ObjectID = ObjectID.getZeroObjectID();

  return getCloudAccountRecommendationArgs({
    resource: resource,
    defaults: {
      onlineMonitorStatusId: placeholder,
      offlineMonitorStatusId: placeholder,
      defaultMonitorStatusId: placeholder,
      defaultIncidentSeverityId: placeholder,
      defaultAlertSeverityId: placeholder,
    },
  });
}

function countTargets(
  targets: Array<CloudAccountRecommendationTarget>,
): CloudAccountRecommendationCounts {
  const counts: CloudAccountRecommendationCounts = {
    total: targets.length,
    available: 0,
    created: 0,
    dismissed: 0,
  };

  for (const target of targets) {
    if (target.status === RecommendationStatus.Created) {
      counts.created++;
    } else if (target.status === RecommendationStatus.Dismissed) {
      counts.dismissed++;
    } else {
      counts.available++;
    }
  }

  return counts;
}

function addCounts(
  into: CloudAccountRecommendationCounts,
  counts: CloudAccountRecommendationCounts,
): void {
  into.total += counts.total;
  into.available += counts.available;
  into.created += counts.created;
  into.dismissed += counts.dismissed;
}

function getTypeKey(context: MonitorRecommendationContext): string {
  return `${(context.cloudProvider || "").trim().toLowerCase()}|${(
    context.cloudResourceType || ""
  )
    .trim()
    .toLowerCase()}`;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export default class CloudAccountRecommendationPlan {
  /*
   * The account's recommendations, by resource type: each type the label
   * the product names it by, in alphabetical order; each row in the order
   * its catalog declares (the most important first); each row's resources
   * by name. A resource offered nothing is in no group (getGaps says why).
   */
  public static buildGroups(data: {
    resources: Array<CloudAccountRecommendationResource>;
    existingMonitors: Array<{
      monitorId: ObjectID;
      monitorSteps: Array<MonitorStep>;
    }>;
    dismissals: Array<RecommendationDismissal>;
  }): Array<CloudAccountRecommendationGroup> {
    const monitorIdByFingerprint: Map<string, ObjectID> =
      MonitorRecommendationUtil.getMonitorIdByFingerprint(
        data.existingMonitors,
      );

    const dismissalsByResource: Map<
      string,
      Array<RecommendationDismissal>
    > = new Map<string, Array<RecommendationDismissal>>();

    for (const dismissal of data.dismissals) {
      const resourceId: string = dismissal.resourceId?.toString() || "";

      if (!resourceId) {
        continue;
      }

      const list: Array<RecommendationDismissal> =
        dismissalsByResource.get(resourceId) || [];
      list.push(dismissal);
      dismissalsByResource.set(resourceId, list);
    }

    const groups: Map<string, CloudAccountRecommendationGroup> = new Map<
      string,
      CloudAccountRecommendationGroup
    >();

    const sortedResources: Array<CloudAccountRecommendationResource> = [
      ...data.resources,
    ].sort(
      (
        a: CloudAccountRecommendationResource,
        b: CloudAccountRecommendationResource,
      ): number => {
        return (
          compareText(a.resourceName, b.resourceName) ||
          compareText(a.resourceId, b.resourceId)
        );
      },
    );

    for (const resource of sortedResources) {
      const recommendations: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.CloudResource,
          resource.context,
        );

      if (recommendations.length === 0) {
        continue;
      }

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: recommendations,
          coveredMonitorIds:
            MonitorRecommendationUtil.getCoveredRecommendationMonitorIdsByFingerprint(
              {
                recommendations: recommendations,
                monitorIdByFingerprint: monitorIdByFingerprint,
                args: getFingerprintArgs(resource),
              },
            ),
          dismissals: dismissalsByResource.get(resource.resourceId) || [],
        });

      const key: string = getTypeKey(resource.context);
      let group: CloudAccountRecommendationGroup | undefined = groups.get(key);

      if (!group) {
        group = {
          key: key,
          provider: (resource.context.cloudProvider || "").trim(),
          resourceType: (resource.context.cloudResourceType || "").trim(),
          label: getCloudResourceTypeDisplayName(
            resource.context.cloudProvider,
            resource.context.cloudResourceType,
          ),
          resources: [],
          rows: [],
          counts: { total: 0, available: 0, created: 0, dismissed: 0 },
        };
        groups.set(key, group);
      }

      group.resources.push(resource);

      for (const viewModel of viewModels) {
        let row: CloudAccountRecommendationRow | undefined = group.rows.find(
          (candidate: CloudAccountRecommendationRow): boolean => {
            return (
              candidate.recommendationId ===
              viewModel.recommendation.recommendationId
            );
          },
        );

        if (!row) {
          row = {
            recommendationId: viewModel.recommendation.recommendationId,
            name: viewModel.recommendation.name,
            summary: viewModel.recommendation.summary,
            description: viewModel.recommendation.description,
            category: viewModel.recommendation.category,
            severity: viewModel.recommendation.severity,
            targets: [],
            counts: { total: 0, available: 0, created: 0, dismissed: 0 },
          };
          group.rows.push(row);
        }

        row.targets.push({
          resource: resource,
          recommendation: viewModel.recommendation,
          status: viewModel.status,
          monitorId: viewModel.monitorId,
        });
      }
    }

    const declaredOrder: Map<string, number> = new Map<string, number>();

    MonitorRecommendationCatalog.getAllPossibleRecommendations(
      MonitorRecommendationResourceType.CloudResource,
    ).forEach((recommendation: MonitorRecommendation, index: number): void => {
      declaredOrder.set(recommendation.recommendationId, index);
    });

    const result: Array<CloudAccountRecommendationGroup> = Array.from(
      groups.values(),
    );

    for (const group of result) {
      group.rows.sort(
        (
          a: CloudAccountRecommendationRow,
          b: CloudAccountRecommendationRow,
        ): number => {
          return (
            (declaredOrder.get(a.recommendationId) ?? 0) -
            (declaredOrder.get(b.recommendationId) ?? 0)
          );
        },
      );

      for (const row of group.rows) {
        row.counts = countTargets(row.targets);
        addCounts(group.counts, row.counts);
      }
    }

    return result.sort(
      (
        a: CloudAccountRecommendationGroup,
        b: CloudAccountRecommendationGroup,
      ): number => {
        return compareText(a.label, b.label) || compareText(a.key, b.key);
      },
    );
  }

  // Every group's counts, added up: the account's own.
  public static getCounts(
    groups: Array<CloudAccountRecommendationGroup>,
  ): CloudAccountRecommendationCounts {
    const counts: CloudAccountRecommendationCounts = {
      total: 0,
      available: 0,
      created: 0,
      dismissed: 0,
    };

    for (const group of groups) {
      addCounts(counts, group.counts);
    }

    return counts;
  }

  /*
   * The account's resources offered nothing, each with why
   * (CloudAccountRecommendationGapReason), in the order the page lists the
   * account's resources: by name.
   */
  public static getGaps(data: {
    resources: Array<CloudAccountRecommendationResource>;
    groups: Array<CloudAccountRecommendationGroup>;
  }): CloudAccountRecommendationGaps {
    const offered: Set<string> = new Set<string>();

    for (const group of data.groups) {
      for (const resource of group.resources) {
        offered.add(resource.resourceId);
      }
    }

    const result: CloudAccountRecommendationGaps = {
      gaps: [],
      byReason: {
        [CloudAccountRecommendationGapReason.NoMetrics]: [],
        [CloudAccountRecommendationGapReason.NextRead]: [],
        [CloudAccountRecommendationGapReason.Unsupported]: [],
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
          compareText(a.resourceId, b.resourceId)
        );
      },
    );

    for (const resource of sorted) {
      if (offered.has(resource.resourceId)) {
        continue;
      }

      const gap: CloudAccountRecommendationGap = {
        resource: resource,
        reason: this.getGapReason(resource.context),
        typeLabel: getCloudResourceTypeDisplayName(
          resource.context.cloudProvider,
          resource.context.cloudResourceType,
        ),
      };

      result.gaps.push(gap);
      result.byReason[gap.reason].push(gap);
    }

    return result;
  }

  // Why a resource that is offered nothing is offered nothing.
  public static getGapReason(
    context: MonitorRecommendationContext,
  ): CloudAccountRecommendationGapReason {
    const forType: number = getCloudAlertTemplatesForType({
      provider: context.cloudProvider,
      resourceType: context.cloudResourceType,
    }).length;

    if (forType === 0) {
      return CloudAccountRecommendationGapReason.Unsupported;
    }

    if (
      Object.keys(
        readCloudTelemetryAttributes(context.cloudTelemetryAttributes),
      ).length === 0
    ) {
      return CloudAccountRecommendationGapReason.NoMetrics;
    }

    // An Azure resource its connection reads waits for its next read.
    if (
      (context.cloudProvider || "").trim().toLowerCase() ===
        CloudProvider.Azure &&
      context.cloudReadByConnection === true
    ) {
      return CloudAccountRecommendationGapReason.NextRead;
    }

    // Metrics no template reads: a namespace, or a stream shape, of its own.
    return CloudAccountRecommendationGapReason.Unsupported;
  }

  // What is still to set up of a row, or of every row of a group.
  public static getAvailableTargets(
    of: CloudAccountRecommendationRow | CloudAccountRecommendationGroup,
  ): Array<CloudAccountRecommendationTarget> {
    const rows: Array<CloudAccountRecommendationRow> =
      "rows" in of ? of.rows : [of];

    const targets: Array<CloudAccountRecommendationTarget> = [];

    for (const row of rows) {
      for (const target of row.targets) {
        if (target.status === RecommendationStatus.Available) {
          targets.push(target);
        }
      }
    }

    return targets;
  }

  /*
   * One monitor per target, each built for its own resource exactly as its
   * Recommendations tab builds it (MonitorRecommendationCreateUtil
   * .buildMonitor) - named "<resource> - <recommendation>", every five
   * minutes, with the person's notification settings - and linked to its
   * resource (Monitor.cloudResources). A target no longer Available is
   * left out: it was created or dismissed since the page read it.
   */
  public static buildCreatePlan(data: {
    targets: Array<CloudAccountRecommendationTarget>;
    defaults: CloudAccountRecommendationDefaults;
    notificationSettings: MonitorRecommendationNotificationSettings;
  }): Array<CloudAccountRecommendationPlanItem> {
    const miscDataProps: JSONObject =
      MonitorRecommendationCreateUtil.buildMiscDataProps(
        data.notificationSettings,
      );

    const plan: Array<CloudAccountRecommendationPlanItem> = [];

    for (const target of data.targets) {
      if (target.status !== RecommendationStatus.Available) {
        continue;
      }

      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: target.recommendation,
        args: getCloudAccountRecommendationArgs({
          resource: target.resource,
          defaults: data.defaults,
        }),
        resourceDisplayName: target.resource.resourceName,
        defaultMonitorStatusId: data.defaults.defaultMonitorStatusId,
        notificationSettings: data.notificationSettings,
      });

      MonitorRecommendationCreateUtil.linkToCloudResource({
        monitor: monitor,
        cloudResourceId: new ObjectID(target.resource.resourceId),
      });

      plan.push({
        target: target,
        monitor: monitor,
        miscDataProps: miscDataProps,
      });
    }

    return plan;
  }

  /*
   * The tiles' counts (RecommendationToolbar), one per recommendation of
   * each resource - a monitor to have - from every group, whatever the
   * filter, so the tiles keep their totals while the list narrows.
   */
  public static getToolbarCounts(
    groups: Array<CloudAccountRecommendationGroup>,
  ): RecommendationCounts {
    const counts: RecommendationCounts = {
      total: 0,
      available: 0,
      created: 0,
      dismissed: 0,
      availableCritical: 0,
      availableWarning: 0,
    };

    for (const group of groups) {
      for (const row of group.rows) {
        counts.total += row.counts.total;
        counts.available += row.counts.available;
        counts.created += row.counts.created;
        counts.dismissed += row.counts.dismissed;

        if (row.severity === "Critical") {
          counts.availableCritical += row.counts.available;
        } else {
          counts.availableWarning += row.counts.available;
        }
      }
    }

    return counts;
  }

  /*
   * The rows the toolbar's filters leave, in their groups; a group with no
   * row left is left out. A row is in a status when one of its resources
   * is (Not set up yet: one still to set up), and found by its name, its
   * summary, its description, its type, or the name of a resource it is
   * offered to.
   */
  public static filterGroups(data: {
    groups: Array<CloudAccountRecommendationGroup>;
    filterState: RecommendationFilterState;
  }): Array<CloudAccountRecommendationGroup> {
    const searchText: string = data.filterState.searchText.trim().toLowerCase();

    const matchesRow: (
      group: CloudAccountRecommendationGroup,
      row: CloudAccountRecommendationRow,
    ) => boolean = (
      group: CloudAccountRecommendationGroup,
      row: CloudAccountRecommendationRow,
    ): boolean => {
      switch (data.filterState.status) {
        case RecommendationStatusFilter.Available:
          if (row.counts.available === 0) {
            return false;
          }
          break;
        case RecommendationStatusFilter.Created:
          if (row.counts.created === 0) {
            return false;
          }
          break;
        case RecommendationStatusFilter.Dismissed:
          if (row.counts.dismissed === 0) {
            return false;
          }
          break;
        default:
          break;
      }

      if (
        data.filterState.severity !== RecommendationSeverityFilter.All &&
        (row.severity as string) !== (data.filterState.severity as string)
      ) {
        return false;
      }

      if (!searchText) {
        return true;
      }

      const texts: Array<string> = [
        row.name,
        row.summary || "",
        row.description,
        row.category,
        group.label,
        ...row.targets.map(
          (target: CloudAccountRecommendationTarget): string => {
            return target.resource.resourceName;
          },
        ),
      ];

      return texts.some((text: string): boolean => {
        return text.toLowerCase().includes(searchText);
      });
    };

    const result: Array<CloudAccountRecommendationGroup> = [];

    for (const group of data.groups) {
      const rows: Array<CloudAccountRecommendationRow> = group.rows.filter(
        (row: CloudAccountRecommendationRow): boolean => {
          return matchesRow(group, row);
        },
      );

      if (rows.length > 0) {
        result.push({ ...group, rows: rows });
      }
    }

    return result;
  }

  // A plan item's name in the progress dialog's lists: its monitor's.
  public static getPlanItemName(
    item: CloudAccountRecommendationPlanItem,
  ): string {
    return item.monitor.name || item.target.recommendation.name;
  }
}
