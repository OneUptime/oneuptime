import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallAcknowledgePageAnswer,
  OnCallAcknowledgePageRecord,
  getOnCallAcknowledgePageAnswer,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgePage";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import Select from "../../Types/Database/Select";
import logger from "../Logger";
import {
  OnCallNotificationResourceReference,
  OnCallNotificationResourceType,
} from "../OnCallNotificationContext";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordKind,
  OnCallTimeoutRecordState,
} from "./OnCallAcknowledgementTimeout";

/*
 * WHETHER A MESSAGE'S ACKNOWLEDGE PAGE STILL OFFERS ACKNOWLEDGE, READ.
 *
 * The rule and its words are Types/OnCallDutyPolicy/OnCallAcknowledgePage;
 * this reads what it needs - the run the page is part of and where its
 * record stands - for the acknowledge page and for the address its button
 * opens (UserOnCallLogTimelineAPI), which asks again, so a page left open
 * while a colleague acknowledged the incident does not acknowledge it a
 * second time.
 *
 * Each read is best effort on its own and never throws: one that fails is
 * logged and left out, and a fact left out never takes Acknowledge away -
 * a page that cannot be read is offered as it always was.
 */

// What the page reads of the run: its kind, and who answered it.
export const ACKNOWLEDGE_PAGE_RUN_SELECT: Select<OnCallDutyPolicyExecutionLog> =
  {
    _id: true,
    // An observer's page is answered as seen (OnCallObserverPage).
    isObserverPage: true,
    // A page again (OnCallAcknowledgementTimeout).
    pageAgainNumber: true,
    // A page a person asked for (OnCallPersonPage): all three, as it asks.
    onCallDutyPolicyId: true,
    triggeredByUserId: true,
    triggeredByWorkflowId: true,
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
   * links, an episode rather than an alert of it. Null when it is gone or
   * cannot be read.
   */
  @CaptureSpan()
  public static async readRecord(
    reference: OnCallNotificationResourceReference | null,
  ): Promise<OnCallAcknowledgePageRecord | null> {
    if (!reference) {
      return null;
    }

    try {
      const state: OnCallTimeoutRecordState | null =
        await OnCallAcknowledgementTimeout.readRecordState({
          kind: RECORD_KIND[reference.resourceType],
          recordId: reference.resourceId,
        });

      return state
        ? { isAcknowledged: state.isAcknowledged, isResolved: state.isResolved }
        : null;
    } catch (err) {
      logger.error(
        `Could not read where ${reference.resourceType} ${reference.resourceId.toString()} stands for an acknowledge page; offering Acknowledge.`,
      );
      logger.error(err as Error);
      return null;
    }
  }

  /*
   * What the page about `timelineItem` (read with userId, isAcknowledged and
   * onCallDutyPolicyExecutionLogId) offers: Acknowledge, or why not. `run`
   * is the page's run as readRun read it, so a caller that reads it for more
   * than this reads it once; a page with a run that came back as nothing is
   * one whose kind is not known (isRunUnknown).
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
      run: data.run,
      isRunUnknown: Boolean(
        data.timelineItem.onCallDutyPolicyExecutionLogId && !data.run,
      ),
      record: await this.readRecord(data.reference),
    });
  }
}
