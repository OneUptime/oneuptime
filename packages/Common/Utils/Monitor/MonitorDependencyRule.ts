/*
 * The alert-dependency suppression decision rule, shared verbatim by the
 * server (MonitorDependencySuppression, which enforces it during
 * evaluation) and the dashboard (DependencySuppressionWarning, which
 * explains it to the user). It lives here — not in Common/Server — so the
 * browser bundle can import it without dragging in the server module
 * graph, the same split MonitorSummarySnapshotUtil uses. Keep it pure:
 * no queries, no model imports.
 */

import { JSONObject } from "../../Types/JSON";

/*
 * A parent monitor whose current status matches the suppression rule.
 * statusName is carried for user-facing messages ("parent monitor
 * 'Router' is Offline").
 */
export interface SuppressingParent {
  monitorId: string;
  monitorName: string;
  statusName: string;
}

export interface DependencySuppressionResult {
  isSuppressed: boolean;
  suppressingParents: Array<SuppressingParent>;
  /*
   * Which of a grouped monitor's series its parents speak for, when that is
   * not all of them: a RabbitMQ gone in one region says nothing of a worker
   * in another. Left out, as it is for every monitor but those that say so
   * (OpenStackDependencySuppression), a suppressing parent speaks for the
   * whole monitor. Series labels are all this reads, so the rule stays pure.
   */
  coversSeries?: ((labels: JSONObject) => boolean) | undefined;
}

// The status facts about one parent monitor that the decision needs.
export interface ParentMonitorStatusRef {
  monitorId: string;
  monitorName: string;
  statusId: string | undefined;
  statusName: string | undefined;
  isOfflineState: boolean;
}

export default class MonitorDependencyRule {
  /*
   * A parent suppresses when its current status is in the configured
   * status list; with no list configured, when its current status is
   * flagged offline. A parent with no current status never suppresses (a
   * never-evaluated parent must not silence its children).
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
   * Whether a suppressing parent speaks for the whole of this evaluation, so
   * that nothing is to be created at all, rather than for some of its series.
   */
  public static isWholeMonitorSuppressed(
    suppression: DependencySuppressionResult | undefined,
  ): boolean {
    return Boolean(suppression?.isSuppressed && !suppression.coversSeries);
  }

  /*
   * Whether one series is to open nothing. A check that is not split into
   * series has nothing to narrow by, so its parents speak for it.
   */
  public static isSeriesSuppressed(data: {
    suppression: DependencySuppressionResult | undefined;
    labels: JSONObject | undefined;
  }): boolean {
    if (!data.suppression?.isSuppressed) {
      return false;
    }

    if (!data.suppression.coversSeries || !data.labels) {
      return true;
    }

    return data.suppression.coversSeries(data.labels);
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
