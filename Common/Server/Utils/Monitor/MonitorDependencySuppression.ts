import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import MonitorService from "../../Services/MonitorService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A parent monitor whose current status matches this monitor's suppression
 * rule. statusName is carried for the evaluation-summary message ("parent
 * monitor 'Router' is Offline").
 */
export interface SuppressingParent {
  monitorId: string;
  monitorName: string;
  statusName: string;
}

export interface DependencySuppressionResult {
  isSuppressed: boolean;
  suppressingParents: Array<SuppressingParent>;
}

/*
 * The status facts about one parent monitor that the pure decision step
 * needs. Split from the Monitor model so the decision can be unit tested
 * without a database.
 */
export interface ParentMonitorStatusRef {
  monitorId: string;
  monitorName: string;
  statusId: string | undefined;
  statusName: string | undefined;
  isOfflineState: boolean;
}

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
 * otherwise any status flagged `isOfflineState`.
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
    const parentIds: Array<ObjectID> = (input.monitor.dependsOnMonitors || [])
      .map((parent: Monitor) => {
        return parent.id || parent._id;
      })
      .filter((id: ObjectID | string | undefined): id is ObjectID | string => {
        return Boolean(id);
      })
      .map((id: ObjectID | string) => {
        return new ObjectID(id.toString());
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
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const parentRefs: Array<ParentMonitorStatusRef> = parents.map(
      (parent: Monitor) => {
        return {
          monitorId: parent.id?.toString() || "",
          monitorName: parent.name || "Unnamed monitor",
          statusId: parent.currentMonitorStatus?.id?.toString(),
          statusName: parent.currentMonitorStatus?.name,
          isOfflineState: Boolean(parent.currentMonitorStatus?.isOfflineState),
        };
      },
    );

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

  /*
   * Pure decision step, split from the query so it can be unit tested
   * without a database. A parent suppresses when its current status is in
   * the configured status list; with no list configured, when its current
   * status is flagged offline. A parent with no current status never
   * suppresses (a never-evaluated parent must not silence its children).
   */
  public static getSuppressingParents(input: {
    parents: Array<ParentMonitorStatusRef>;
    configuredSuppressionStatusIds: Set<string>;
  }): Array<SuppressingParent> {
    const suppressing: Array<SuppressingParent> = [];

    for (const parent of input.parents) {
      const matchesRule: boolean =
        input.configuredSuppressionStatusIds.size > 0
          ? Boolean(
              parent.statusId &&
                input.configuredSuppressionStatusIds.has(parent.statusId),
            )
          : parent.isOfflineState;

      if (matchesRule) {
        suppressing.push({
          monitorId: parent.monitorId,
          monitorName: parent.monitorName,
          statusName: parent.statusName || "Offline",
        });
      }
    }

    return suppressing;
  }

  /*
   * One human sentence naming the suppressing parents, shared by the
   * alert and incident skip events so both read identically in the
   * evaluation log.
   */
  public static buildSuppressionReason(
    suppressingParents: Array<SuppressingParent>,
  ): string {
    const parts: Array<string> = suppressingParents.map(
      (parent: SuppressingParent) => {
        return `"${parent.monitorName}" is ${parent.statusName}`;
      },
    );

    const plural: boolean = parts.length > 1;

    return `parent monitor${plural ? "s" : ""} ${parts.join(", ")}`;
  }
}
