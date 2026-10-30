import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { isOnCallPersonPage } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserOnCallLogService from "../../Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A PERSON'S PAGE IS ANSWERED BY ACKNOWLEDGING ITS RECORD, TOO.
 *
 * A page a person asked for - from an incident's own Slack or Microsoft
 * Teams channel, or the incident's Page Someone (OnCallPersonPage) - goes on
 * until somebody it paged answers it, or its record is resolved: somebody
 * else acknowledging the incident does not stop it, since it was them the
 * page was for. Answering it is what its link, a call's 1 or a text do
 * (UserOnCallLogTimelineService.acknowledgePage) - and, just as naturally,
 * acknowledging the incident itself: its button in the channel, the
 * Dashboard, the app. Without this, the person paged who acknowledged the
 * incident from its channel was called ten minutes later, for a page they
 * had not answered.
 *
 * So when somebody moves an incident or an alert into a state that counts
 * as acknowledged and is not resolved (a resolve ends every page of it),
 * each of THEIR pages still going out about it from a person's page nobody
 * answered yet is acknowledged, as theirs: their notifications still due
 * stop, the page is answered and ends for everybody it paged, and its
 * message in the channel says they acknowledged. A change somebody else
 * makes answers nothing of theirs, and one OneUptime makes on its own (no
 * person) answers nothing at all. Pressing Acknowledge in Slack or
 * Microsoft Teams on a record somebody else acknowledged already answers
 * the presser's pages too (onAcknowledgePressed): it is the same "I'm on
 * it", though the record's state does not move.
 *
 * Every state timeline of an incident or an alert tells the one hook every
 * state change reaches (OnCallAcknowledgementTimeout.onRecordStateChanged),
 * for the record's current state only - a back-dated row is no answer - and
 * that hook hands the change on to this, with who made it. Imported there
 * rather than by the state timelines themselves, whose own imports load
 * before half the server. Never throws: a page that could not be answered
 * is logged, the state change goes on, and its person can still answer it
 * from the page.
 */

export type OnCallPersonPageRecordKind = "incident" | "alert";

// The statuses of a person's page still going out to them.
const OPEN_PAGE_STATUSES: Array<UserNotificationExecutionStatus> = [
  UserNotificationExecutionStatus.Scheduled,
  UserNotificationExecutionStatus.Started,
  UserNotificationExecutionStatus.Executing,
];

export default class OnCallPersonPageAnswer {
  /*
   * Acknowledge pressed on an incident or an alert that is acknowledged
   * already - in Slack or Microsoft Teams, where the press is answered with
   * who got there first. It is the press a person paged into an incident
   * somebody else is on makes in its channel, and the incident's state does
   * not move, so onRecordStateChanged hears nothing: the press answers the
   * presser's own person's pages about it all the same, as acknowledging it
   * would have. Without this, they were called again ten minutes after
   * pressing Acknowledge. A resolved record answers nothing: resolving it
   * ended its pages. Returns how many were answered; never throws.
   */
  @CaptureSpan()
  public static async onAcknowledgePressed(data: {
    kind: OnCallPersonPageRecordKind;
    recordId: ObjectID;
    projectId: ObjectID;
    pressedByUserId?: ObjectID | null | undefined;
    // Where the record stands, as the press read it.
    isResolved: boolean;
  }): Promise<number> {
    return await OnCallPersonPageAnswer.onRecordStateChanged({
      kind: data.kind,
      recordId: data.recordId,
      projectId: data.projectId,
      changedByUserId: data.pressedByUserId,
      isAcknowledged: true,
      isResolved: data.isResolved,
    });
  }

  /*
   * A state change of an incident or an alert, as its state timeline saved
   * it: answers the person's pages it answers (see the header). Returns how
   * many - none is an answer too.
   */
  @CaptureSpan()
  public static async onRecordStateChanged(data: {
    kind: OnCallPersonPageRecordKind;
    recordId: ObjectID;
    projectId: ObjectID;
    // Who changed it; none for a change OneUptime made on its own.
    changedByUserId?: ObjectID | null | undefined;
    // Where the record stands in its new state, by the one rule of each.
    isAcknowledged: boolean;
    isResolved: boolean;
  }): Promise<number> {
    if (!data.changedByUserId || !data.isAcknowledged || data.isResolved) {
      return 0;
    }

    try {
      const logs: Array<UserOnCallLog> = await UserOnCallLogService.findBy({
        query: {
          projectId: data.projectId,
          userId: data.changedByUserId,
          status: QueryHelper.any(OPEN_PAGE_STATUSES),
          ...(data.kind === "incident"
            ? { triggeredByIncidentId: data.recordId }
            : { triggeredByAlertId: data.recordId }),
        },
        select: {
          _id: true,
          onCallDutyPolicyExecutionLogId: true,
          onCallDutyPolicyExecutionLogTimelineId: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          onCallDutyPolicyExecutionLog: {
            onCallDutyPolicyId: true,
            triggeredByUserId: true,
            triggeredByWorkflowId: true,
            acknowledgedAt: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

      // A person's page, of a run nobody answered yet, that can be answered.
      const unanswered: Array<UserOnCallLog> = logs.filter(
        (log: UserOnCallLog): boolean => {
          return (
            isOnCallPersonPage(log.onCallDutyPolicyExecutionLog) &&
            !log.onCallDutyPolicyExecutionLog?.acknowledgedAt &&
            Boolean(log.onCallDutyPolicyExecutionLogId) &&
            Boolean(log.onCallDutyPolicyExecutionLogTimelineId)
          );
        },
      );

      const acknowledgedAt: Date = OneUptimeDate.getCurrentDate();
      let answered: number = 0;

      for (const log of unanswered) {
        try {
          await UserOnCallLogTimelineService.acknowledgePage({
            userOnCallLogId: log.id!,
            userId: data.changedByUserId,
            onCallDutyPolicyExecutionLogId: log.onCallDutyPolicyExecutionLogId,
            onCallDutyPolicyExecutionLogTimelineId:
              log.onCallDutyPolicyExecutionLogTimelineId,
            triggeredByIncidentId: log.triggeredByIncidentId,
            triggeredByAlertId: log.triggeredByAlertId,
            acknowledgedAt: acknowledgedAt,
          });
          answered++;
        } catch (err) {
          logger.error(
            `Could not answer person's page ${log.id?.toString()} after its ${data.kind} was acknowledged.`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
          logger.error(err as Error);
        }
      }

      return answered;
    } catch (err) {
      logger.error(
        `Could not read the person's pages of ${data.kind} ${data.recordId.toString()} after its state changed.`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      logger.error(err as Error);
      return 0;
    }
  }
}
