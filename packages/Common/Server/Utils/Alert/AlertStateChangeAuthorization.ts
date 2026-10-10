import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Whether a caller may change the state of a set of alerts - acknowledge
 * them, say - when that change is going to be written for them as root
 * (declaring an incident with "acknowledge the linked alerts" ticked:
 * IncidentAlertService).
 *
 * Changing one alert's state from its own page is one write as the
 * caller: a new AlertStateTimeline row. The alert's own state then follows
 * it as OneUptime's write (StateChangeFollowOn), so no permission to edit
 * the alert is needed. A write made as root skips the caller's checks, so
 * this asks the very checks creating that row as the caller would run, for
 * every alert, before anything is written: the state timeline's own create
 * check (DatabaseService.checkCallerMayCreate), on the row each alert's
 * change would be. That holds the caller to
 *
 *   - the timeline's create permission, and its columns (Create Alert State
 *     Timeline, or a role that has it), and a team's block on it;
 *   - each alert as a record they may read (CreatePermission
 *     .checkParentPermission): their read's labels, owners and blocks, and
 *     the alert's privacy;
 *   - what their create permission reaches through each alert
 *     (CreateScopePermission): a grant limited to labels reaches the alerts
 *     that carry one of them, one limited to owned records the alerts they
 *     or their teams own, and a block with labels none of the alerts that
 *     carry them.
 *
 * So acknowledging a set of alerts here needs exactly what acknowledging
 * each of them on its own page needs - nothing more, nothing less. Throws
 * what that create would throw; a root caller passes without a check.
 */
export default class AlertStateChangeAuthorization {
  @CaptureSpan()
  public static async assertCanChangeStateOfAlerts(data: {
    projectId: ObjectID;
    alertIds: Array<ObjectID>;
    // The state the alerts are to be moved to (the project's Acknowledged state).
    alertStateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot || data.alertIds.length === 0) {
      return;
    }

    // Each alert once, whatever the case of its id.
    const checked: Set<string> = new Set<string>();

    for (const alertId of data.alertIds) {
      const key: string = alertId.toString().toLowerCase();

      if (checked.has(key)) {
        continue;
      }

      checked.add(key);

      // The row this alert's state change would be, as its own page creates it.
      const stateChange: AlertStateTimeline = new AlertStateTimeline();
      stateChange.projectId = data.projectId;
      stateChange.alertId = alertId;
      stateChange.alertStateId = data.alertStateId;

      await AlertStateTimelineService.checkCallerMayCreate({
        data: stateChange,
        props: data.props,
      });
    }
  }
}
