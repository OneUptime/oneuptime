import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallAcknowledgePageAnswer,
  OnCallAcknowledgePageChange,
  OnCallAcknowledgePageRecord,
  getOnCallAcknowledgePageAnswer,
  getOnCallAcknowledgePagePersonName,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgePage";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import UserService from "../../Services/UserService";
import Select from "../../Types/Database/Select";
import logger from "../Logger";
import {
  OnCallNotificationResourceReference,
  OnCallNotificationResourceType,
} from "../OnCallNotificationContext";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordChange,
  OnCallTimeoutRecordKind,
  OnCallTimeoutRecordStanding,
} from "./OnCallAcknowledgementTimeout";

/*
 * WHETHER A MESSAGE'S ACKNOWLEDGE PAGE STILL OFFERS ACKNOWLEDGE, READ.
 *
 * The rule and its words are Types/OnCallDutyPolicy/OnCallAcknowledgePage;
 * this reads what it needs - the run the page is part of, where its record
 * stands, and who took it there and when - for the acknowledge page and for
 * the address its button opens (UserOnCallLogTimelineAPI), which asks again,
 * so a page left open while a colleague acknowledged the incident does not
 * acknowledge it a second time.
 *
 * Each read is best effort on its own and never throws: one that fails is
 * logged and left out, and a fact left out never takes Acknowledge away -
 * a page that cannot be read is offered as it always was. Who and when,
 * left out, only leave the page's sentence shorter.
 */

// What the page reads of the run: its kind, and who answered it.
export const ACKNOWLEDGE_PAGE_RUN_SELECT: Select<OnCallDutyPolicyExecutionLog> =
  {
    _id: true,
    // An observer's page is answered as seen (OnCallObserverPage).
    isObserverPage: true,
    // A page again (OnCallAcknowledgementTimeout).
    pageAgainNumber: true,
    /*
     * A page a person asked for (OnCallPersonPage): all three, as it asks.
     * A policy a person started by hand (OnCallPolicyStartedByHand): those,
     * and the event type that tells a test page apart.
     */
    onCallDutyPolicyId: true,
    triggeredByUserId: true,
    triggeredByWorkflowId: true,
    userNotificationEventType: true,
    acknowledgedAt: true,
    acknowledgedByUserId: true,
    acknowledgedByUser: {
      name: true,
      email: true,
    },
  };

// Each record a page can be about, as the clock reads its state.
const RECORD_KIND: Record<
  OnCallNotificationResourceType,
  OnCallTimeoutRecordKind
> = {
  [OnCallNotificationResourceType.Incident]: "incident",
  [OnCallNotificationResourceType.Alert]: "alert",
  [OnCallNotificationResourceType.IncidentEpisode]: "incident episode",
  [OnCallNotificationResourceType.AlertEpisode]: "alert episode",
};

export default class OnCallAcknowledgePageAnswerReader {
  // The run a page is part of, or null when it has none or it cannot be read.
  @CaptureSpan()
  public static async readRun(
    executionLogId: ObjectID | null | undefined,
  ): Promise<OnCallDutyPolicyExecutionLog | null> {
    if (!executionLogId) {
      return null;
    }

    try {
      return await OnCallDutyPolicyExecutionLogService.findOneById({
        id: executionLogId,
        select: ACKNOWLEDGE_PAGE_RUN_SELECT,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        `Could not read on-call run ${executionLogId.toString()} for an acknowledge page; offering Acknowledge.`,
      );
      logger.error(err as Error);
      return null;
    }
  }

  /*
   * Where the record the page shows stands, by the one rule
   * (AcknowledgedState, ResolvedState) - the record the page names and
   * links, an episode rather than an alert of it - and who took it there,
   * and when, by its state timeline (readRecordStanding), with their names.
   * The person the page is for (`personUserId`) is "you", and their name is
   * not read. Null when the record is gone or cannot be read.
   */
  @CaptureSpan()
  public static async readRecord(
    reference: OnCallNotificationResourceReference | null,
    personUserId?: ObjectID | null | undefined,
  ): Promise<OnCallAcknowledgePageRecord | null> {
    if (!reference) {
      return null;
    }

    let standing: OnCallTimeoutRecordStanding | null;

    try {
      standing = await OnCallAcknowledgementTimeout.readRecordStanding({
        kind: RECORD_KIND[reference.resourceType],
        recordId: reference.resourceId,
      });
    } catch (err) {
      logger.error(
        `Could not read where ${reference.resourceType} ${reference.resourceId.toString()} stands for an acknowledge page; offering Acknowledge.`,
      );
      logger.error(err as Error);
      return null;
    }

    if (!standing) {
      return null;
    }

    const names: Map<string, string> = await this.readNames(
      [
        standing.acknowledgement?.createdByUserId,
        standing.resolution?.createdByUserId,
      ],
      personUserId,
    );

    return {
      isAcknowledged: standing.isAcknowledged,
      isResolved: standing.isResolved,
      ...(standing.acknowledgement
        ? { acknowledgement: this.toChange(standing.acknowledgement, names) }
        : {}),
      ...(standing.resolution
        ? { resolution: this.toChange(standing.resolution, names) }
        : {}),
    };
  }

  /*
   * What the page about `timelineItem` (read with userId, isAcknowledged,
   * acknowledgedAt and onCallDutyPolicyExecutionLogId) offers: Acknowledge,
   * or why not. `run` is the page's run as readRun read it, so a caller that
   * reads it for more than this reads it once; a page with a run that came
   * back as nothing is one whose kind is not known (isRunUnknown).
   */
  @CaptureSpan()
  public static async read(data: {
    timelineItem: UserOnCallLogTimeline;
    reference: OnCallNotificationResourceReference | null;
    run: OnCallDutyPolicyExecutionLog | null;
  }): Promise<OnCallAcknowledgePageAnswer> {
    return getOnCallAcknowledgePageAnswer({
      personUserId: data.timelineItem.userId,
      isMessageAcknowledged: Boolean(data.timelineItem.isAcknowledged),
      messageAcknowledgedAt: data.timelineItem.acknowledgedAt,
      run: data.run,
      isRunUnknown: Boolean(
        data.timelineItem.onCallDutyPolicyExecutionLogId && !data.run,
      ),
      record: await this.readRecord(data.reference, data.timelineItem.userId),
    });
  }

  // A change of the record's timeline, as the page's rule reads it.
  private static toChange(
    change: OnCallTimeoutRecordChange,
    names: Map<string, string>,
  ): OnCallAcknowledgePageChange {
    const name: string | undefined = change.createdByUserId
      ? names.get(change.createdByUserId.toString().toLowerCase())
      : undefined;

    return {
      byUserId: change.createdByUserId,
      at: change.startsAt,
      ...(name ? { byName: name } : {}),
    };
  }

  /*
   * The names of the people who made the changes, by id - each read once,
   * and not the person the page is for, whom the page calls "you". One that
   * cannot be read is left out: the page says when, without who.
   */
  private static async readNames(
    userIds: Array<ObjectID | null | undefined>,
    personUserId: ObjectID | null | undefined,
  ): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();
    const person: string = personUserId
      ? personUserId.toString().toLowerCase()
      : "";

    for (const userId of userIds) {
      const key: string = userId ? userId.toString().toLowerCase() : "";

      if (!userId || !key || key === person || names.has(key)) {
        continue;
      }

      try {
        const user: User | null = await UserService.findOneById({
          id: userId,
          select: {
            name: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

        names.set(key, getOnCallAcknowledgePagePersonName(user));
      } catch (err) {
        logger.error(
          `Could not read user ${userId.toString()} for an acknowledge page; saying when without who.`,
        );
        logger.error(err as Error);
      }
    }

    return names;
  }
}
