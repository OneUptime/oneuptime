import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * How many alerts are asked about at once. Each alert's check reads the
 * database a couple of times (the alert as the caller, the state it moves
 * to, its labels or owners for a narrowed permission), and a declaration
 * names up to 50 alerts (MAX_ALERTS_PER_INCIDENT_LINK_ACTION): a few at a
 * time keeps the declaration quick without taking many connections at once.
 */
export const ALERTS_CHECKED_AT_ONCE: number = 5;

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
 * what that create would throw - for the first alert, in the order given,
 * the caller may not change - and a root caller passes without a check.
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

    // Each alert once, whatever the case of its id, in the order given.
    const seen: Set<string> = new Set<string>();
    const alertIds: Array<ObjectID> = data.alertIds.filter(
      (alertId: ObjectID): boolean => {
        const key: string = alertId.toString().toLowerCase();

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      },
    );

    for (
      let start: number = 0;
      start < alertIds.length;
      start += ALERTS_CHECKED_AT_ONCE
    ) {
      const outcomes: Array<PromiseSettledResult<void>> =
        await Promise.allSettled(
          alertIds
            .slice(start, start + ALERTS_CHECKED_AT_ONCE)
            .map((alertId: ObjectID): Promise<void> => {
              return AlertStateTimelineService.checkCallerMayCreate({
                data: AlertStateChangeAuthorization.getStateChange({
                  projectId: data.projectId,
                  alertId: alertId,
                  alertStateId: data.alertStateId,
                }),
                props: data.props,
              });
            }),
        );

      // The first alert refused, in the order given, answers for them all.
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          throw outcome.reason;
        }
      }
    }
  }

  /*
   * The row a change of one alert's state is, as its own page's create
   * writes it once its hook has run: the project, the alert, the state it
   * moves to, and when it starts. The other columns that hook fills in - why
   * the state changed, when it ends - are creatable by exactly the table's
   * create permissions, so they add nothing to the check
   * (AlertStateChangeAuthorization.test pins that), and the ones OneUptime
   * computes are never the caller's to write.
   */
  public static getStateChange(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    alertStateId: ObjectID;
  }): AlertStateTimeline {
    const stateChange: AlertStateTimeline = new AlertStateTimeline();
    stateChange.projectId = data.projectId;
    stateChange.alertId = data.alertId;
    stateChange.alertStateId = data.alertStateId;
    stateChange.startsAt = OneUptimeDate.getCurrentDate();
    return stateChange;
  }
}
