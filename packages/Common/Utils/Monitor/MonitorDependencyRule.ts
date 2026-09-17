/*
 * The alert-dependency suppression decision rule, shared verbatim by the
 * server (MonitorDependencySuppression, which enforces it during
 * evaluation) and the dashboard (DependencySuppressionWarning, which
 * explains it to the user). It lives here — not in Common/Server — so the
 * browser bundle can import it without dragging in the server module
 * graph, the same split MonitorSummarySnapshotUtil uses. Keep it pure:
 * no queries, no model imports.
 */

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
