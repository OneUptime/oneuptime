import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import MonitorDependencyRule, {
  DependencySuppressionResult,
  ParentMonitorStatusRef,
  SuppressingParent,
} from "../../../Utils/Monitor/MonitorDependencyRule";
import MonitorService from "../../Services/MonitorService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Re-exported so server-side callers (and the existing tests) keep a
 * single import site; the rule itself lives in
 * Common/Utils/Monitor/MonitorDependencyRule so the dashboard can share
 * it without importing server modules.
 */
export type {
  DependencySuppressionResult,
  ParentMonitorStatusRef,
  SuppressingParent,
};

/*
 * Alert-dependency suppression (the per-monitor counterpart of the
 * per-series MonitorMaintenanceSuppression): when a monitor declares
 * `dependsOnMonitors` and any of those parents is currently in a
 * suppressing status, alert/incident *creation* for this monitor is
 * skipped for the evaluation. The monitor itself keeps evaluating — its
 * status timeline, metrics, and the resolve path for already-open
 * alerts/incidents are untouched. That keeps the child visibly Offline on
 * status pages (and lets grand-children observe the outage through the
 * child's real status, which is what makes one-hop checks transitive)
 * while silencing the redundant paging.
 *
 * Which parent statuses suppress: the monitor's
 * `suppressAlertsWhenParentMonitorStatuses` list when configured,
 * otherwise any status flagged `isOfflineState`. The decision itself is
 * MonitorDependencyRule.getSuppressingParents, shared with the dashboard
 * banner.
 */
export default class MonitorDependencySuppression {
  /*
   * Resolve the suppression decision for one evaluation. Zero queries on
   * the common path — a monitor with no dependencies returns immediately —
   * and exactly one query (the parents' current statuses) otherwise. This
   * sits on the hottest Postgres path in the product, so the monitor's
   * dependency ids must arrive pre-selected on the monitor row rather than
   * being re-read here.
   */
  @CaptureSpan()
  public static async getDependencySuppression(input: {
    monitor: Monitor;
  }): Promise<DependencySuppressionResult> {
    const monitorId: string = (
      input.monitor.id ||
      input.monitor._id ||
      ""
    ).toString();

    const parentIds: Array<ObjectID> = (input.monitor.dependsOnMonitors || [])
      .map((parent: Monitor) => {
        return (parent.id || parent._id)?.toString() || "";
      })
      .filter((id: string) => {
        /*
         * A self-edge should never exist (validation rejects it, uuids
         * compared case-insensitively), but if one was persisted through
         * an older payload shape it must not let a monitor suppress its
         * own offline alerts — that would silence exactly the outage the
         * monitor exists to report.
         */
        return id.length > 0 && id.toLowerCase() !== monitorId.toLowerCase();
      })
      .map((id: string) => {
        return new ObjectID(id);
      });

    if (parentIds.length === 0) {
      return { isSuppressed: false, suppressingParents: [] };
    }

    const parents: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any(parentIds),
      },
      select: {
        _id: true,
        name: true,
        currentMonitorStatus: {
          _id: true,
          name: true,
          isOfflineState: true,
        },
        /*
         * The parents' own parent ids, for the runtime mutual-cycle guard
         * below. Selected here so the guard costs no extra query.
         */
        dependsOnMonitors: {
          _id: true,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const parentRefs: Array<ParentMonitorStatusRef> = [];

    for (const parent of parents) {
      /*
       * Runtime mutual-cycle guard: write-time validation walks the graph
       * before persisting, but two concurrent updates can each pass
       * validation and jointly commit a cycle (A depends on B, B depends
       * on A). If that cycle suppressed, a shared outage would take both
       * monitors offline and page NOBODY. Fail open instead: a parent
       * that itself depends on this monitor is ignored for suppression,
       * so a raced-in cycle degrades to normal (noisy) paging rather than
       * a silent blackout.
       */
      const isMutualCycle: boolean = (parent.dependsOnMonitors || []).some(
        (grandParent: Monitor) => {
          const grandParentId: string = (
            grandParent.id ||
            grandParent._id ||
            ""
          ).toString();

          return (
            grandParentId.length > 0 &&
            grandParentId.toLowerCase() === monitorId.toLowerCase()
          );
        },
      );

      if (isMutualCycle) {
        logger.warn(
          `${monitorId} - Monitor dependency cycle detected at evaluation time with parent ${parent.id?.toString()} ("${parent.name}"). The parent is ignored for suppression so alerts still fire. Remove one side of the cycle.`,
        );
        continue;
      }

      parentRefs.push({
        monitorId: parent.id?.toString() || "",
        monitorName: parent.name || "Unnamed monitor",
        statusId: parent.currentMonitorStatus?.id?.toString(),
        statusName: parent.currentMonitorStatus?.name,
        isOfflineState: Boolean(parent.currentMonitorStatus?.isOfflineState),
      });
    }

    const configuredSuppressionStatusIds: Set<string> = new Set<string>(
      (input.monitor.suppressAlertsWhenParentMonitorStatuses || [])
        .map((status: MonitorStatus) => {
          return (status.id || status._id)?.toString() || "";
        })
        .filter((id: string) => {
          return id.length > 0;
        }),
    );

    const suppressingParents: Array<SuppressingParent> =
      this.getSuppressingParents({
        parents: parentRefs,
        configuredSuppressionStatusIds,
      });

    return {
      isSuppressed: suppressingParents.length > 0,
      suppressingParents,
    };
  }

  // Delegates kept so callers and tests have one server-side entry point.
  public static getSuppressingParents(input: {
    parents: Array<ParentMonitorStatusRef>;
    configuredSuppressionStatusIds: Set<string>;
  }): Array<SuppressingParent> {
    return MonitorDependencyRule.getSuppressingParents(input);
  }

  public static buildSuppressionReason(
    suppressingParents: Array<SuppressingParent>,
  ): string {
    return MonitorDependencyRule.buildSuppressionReason(suppressingParents);
  }
}
