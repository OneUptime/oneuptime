import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import ObjectID from "../../../../Types/ObjectID";
import {
  PostmortemCallState,
  isPostmortemWaitingForCalls,
} from "../../../../Types/VideoCall/CallTranscriptAutoFetch";
import ResolvedStateUtil from "../../../../Utils/ResolvedState";
import { StateListType } from "../../../../Utils/StateOrder";
import IncidentStateService from "../../../Services/IncidentStateService";
import IncidentVideoCallService from "../../../Services/IncidentVideoCallService";

/*
 * WHETHER AN INCIDENT'S POSTMORTEM DRAFT STILL WAITS FOR ITS CALLS.
 *
 * The automatic postmortem draft is written when the incident resolves and
 * reads what was said on the incident's calls. A call usually ends about
 * when the incident does, so its transcript - and OneUptime AI's reading of
 * it - comes after the resolve. The draft waits for it as long as one can be
 * expected (isPostmortemWaitingForCalls has the rule), reading the calls'
 * columns here.
 */

// More calls than an incident ever has; a draft reads this many at most.
const MAX_CALLS: number = 20;

export default class IncidentPostmortemCallWait {
  public static async isWaiting(data: {
    incidentId: ObjectID;
    // When the draft started waiting: the incident's resolve.
    waitingSince: Date;
    now: Date;
  }): Promise<boolean> {
    const calls: Array<IncidentVideoCall> =
      await IncidentVideoCallService.findBy({
        query: { incidentId: data.incidentId },
        select: {
          _id: true,
          transcriptAddedAt: true,
          transcriptFetchStatus: true,
          transcriptFetchReason: true,
          callSummaryStatus: true,
          callSummaryUpdatedAt: true,
        },
        skip: 0,
        limit: MAX_CALLS,
        props: { isRoot: true },
      });

    return isPostmortemWaitingForCalls({
      calls: calls.map((call: IncidentVideoCall): PostmortemCallState => {
        return {
          hasTranscript: Boolean(call.transcriptAddedAt),
          transcriptFetchStatus: call.transcriptFetchStatus,
          transcriptFetchReason: call.transcriptFetchReason,
          callSummaryStatus: call.callSummaryStatus,
          callSummaryUpdatedAt: call.callSummaryUpdatedAt,
        };
      }),
      waitingSince: data.waitingSince,
      now: data.now,
    });
  }

  /*
   * Whether the incident is resolved now, by the one rule
   * (Common/Utils/ResolvedState): a draft that waited is written only for
   * an incident still resolved - one reopened meanwhile is drafted on its
   * next resolve.
   */
  public static async isResolved(data: {
    projectId: ObjectID;
    currentIncidentStateId: ObjectID | undefined;
  }): Promise<boolean> {
    if (!data.currentIncidentStateId) {
      return false;
    }

    const states: Array<IncidentState> =
      await IncidentStateService.getAllIncidentStates({
        projectId: data.projectId,
        props: { isRoot: true },
      });

    return ResolvedStateUtil.isResolved({
      list: StateListType.IncidentState,
      states,
      stateId: data.currentIncidentStateId,
    });
  }
}
