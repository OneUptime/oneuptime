import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  CallTranscriptFetchNext,
  CallTranscriptFetchStatus,
  getFirstCallTranscriptFetchAt,
  getNextCallTranscriptFetch,
} from "../../../../Types/VideoCall/CallTranscriptAutoFetch";
import {
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailableReason,
  canReadVideoCallTranscriptFromProvider,
} from "../../../../Types/VideoCall/VideoCallTranscript";
import TranscriptText, {
  PreparedTranscript,
} from "../../../../Utils/VideoCall/TranscriptText";
import IncidentVideoCallService from "../../../Services/IncidentVideoCallService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AIIncidentPostmortemRunner from "../../AI/SRE/IncidentPostmortemRunner";
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import VideoCallHttpClient from "../VideoCallHttpClient";
import IncidentCallRecordingSetting from "./IncidentCallRecordingSetting";
import IncidentCallTranscriptSave from "./IncidentCallTranscriptSave";
import IncidentVideoCallTranscriptWrite from "./IncidentVideoCallTranscriptWrite";
import { VideoCallTranscriptRead } from "./VideoCallTranscriptRead";
import VideoCallTranscriptReader from "./VideoCallTranscriptReader";

/*
 * GETS AN INCIDENT CALL'S TRANSCRIPT ONCE THE CALL IS OVER, by itself.
 *
 * A Zoom or Google Meet call OneUptime started while the project's Record
 * and transcribe incident calls was on is watched from the moment it is
 * created (watchNewCall): Waiting, first asked about
 * CALL_TRANSCRIPT_FIRST_FETCH_AFTER_MS later. The Workers job (every few
 * minutes) asks the provider about each call that is due (fetchDue), the
 * way Get from Zoom does - with the connection that started the call - and
 * then:
 *
 *   - a transcript: it is stored as Get from Zoom stores it, OneUptime AI
 *     reads it and its summary goes to the incident's feed
 *     (IncidentCallTranscriptSave), and the call is no longer watched;
 *   - none yet: asked again later, less often as the call gets older, until
 *     the provider's answer is final or the watch's window is over
 *     (getNextCallTranscriptFetch) - then Stopped, with the provider's last
 *     answer for the call's card to show;
 *   - no answer at all (a timeout, a 5xx, a rate limit): asked again later.
 *
 * Every call is taken before it is asked about (claimTranscriptFetch), so
 * two runs of the job never ask about one call at once and a transcript is
 * never stored and read twice. A project that turned Record and transcribe
 * incident calls off since is not asked about again, and a call that got a
 * transcript some other way meanwhile is left as it is.
 */

// The most calls one run of the job asks about.
export const MAX_CALL_TRANSCRIPT_FETCHES_PER_RUN: number = 50;

/*
 * While a run asks about a call, the call's next attempt is put this far
 * ahead: should the run stop half-way, the call is asked about again then.
 */
export const CALL_TRANSCRIPT_CLAIM_HOLD_IN_MS: number = 10 * 60 * 1000;

// What the job reads of a call.
const CALL_SELECT: {
  _id: true;
  projectId: true;
  incidentId: true;
  provider: true;
  videoCallConnectionId: true;
  externalMeetingId: true;
  createdAt: true;
  transcriptAddedAt: true;
  transcriptFetchStatus: true;
  transcriptFetchNextAttemptAt: true;
} = {
  _id: true,
  projectId: true,
  incidentId: true,
  provider: true,
  videoCallConnectionId: true,
  externalMeetingId: true,
  createdAt: true,
  transcriptAddedAt: true,
  transcriptFetchStatus: true,
  transcriptFetchNextAttemptAt: true,
};

// How asking about one call ended, for the run's summary and the tests.
export enum CallTranscriptFetchOutcome {
  // The transcript was stored, and OneUptime AI is reading it.
  Found = "Found",
  // Not there yet: asked again later.
  Waiting = "Waiting",
  // No more asking: the provider's answer is final, or the window is over.
  Stopped = "Stopped",
  // Another run took the call, or it stopped waiting meanwhile.
  Skipped = "Skipped",
  // The project turned Record and transcribe incident calls off.
  TurnedOff = "TurnedOff",
}

export interface CallTranscriptFetchRunSummary {
  asked: number;
  outcomes: Partial<Record<CallTranscriptFetchOutcome, number>>;
}

export default class IncidentCallTranscriptFetch {
  /*
   * Watches a call that was just started for its transcript, when it is one
   * OneUptime can ask the provider about (a Zoom or Google Meet meeting it
   * created). Never throws: the call exists either way.
   */
  @CaptureSpan()
  public static async watchNewCall(
    call: Pick<
      IncidentVideoCall,
      | "id"
      | "projectId"
      | "incidentId"
      | "provider"
      | "videoCallConnectionId"
      | "externalMeetingId"
      | "createdAt"
    >,
  ): Promise<void> {
    if (!call.id || !canReadVideoCallTranscriptFromProvider(call)) {
      return;
    }

    try {
      await IncidentVideoCallTranscriptWrite.write(call.id, {
        transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
        transcriptFetchReason: null,
        transcriptFetchNextAttemptAt: getFirstCallTranscriptFetchAt(
          call.createdAt || new Date(),
        ),
      });
    } catch (error) {
      logger.error(
        `Could not start waiting for an incident call's transcript: ${error}`,
        {
          projectId: call.projectId?.toString(),
          incidentId: call.incidentId?.toString(),
        } as LogAttributes,
      );
    }
  }

  // Asks about every call that is due, oldest attempt first.
  @CaptureSpan()
  public static async fetchDue(
    options: {
      now?: Date | undefined;
      limit?: number | undefined;
      http?: VideoCallHttpClient | undefined;
    } = {},
  ): Promise<CallTranscriptFetchRunSummary> {
    const now: Date = options.now || new Date();

    const calls: Array<IncidentVideoCall> =
      await IncidentVideoCallService.findBy({
        query: {
          transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
          transcriptFetchNextAttemptAt: QueryHelper.lessThanEqualTo(now),
        },
        select: CALL_SELECT,
        sort: { transcriptFetchNextAttemptAt: SortOrder.Ascending },
        skip: 0,
        limit: options.limit || MAX_CALL_TRANSCRIPT_FETCHES_PER_RUN,
        props: { isRoot: true },
      });

    const summary: CallTranscriptFetchRunSummary = {
      asked: 0,
      outcomes: {},
    };

    for (const call of calls) {
      let outcome: CallTranscriptFetchOutcome;

      try {
        outcome = await IncidentCallTranscriptFetch.fetchOne({
          call,
          now,
          http: options.http,
        });
      } catch (error) {
        logger.error(`Could not get an incident call's transcript: ${error}`, {
          projectId: call.projectId?.toString(),
          incidentId: call.incidentId?.toString(),
        } as LogAttributes);
        continue;
      }

      summary.asked++;
      summary.outcomes[outcome] = (summary.outcomes[outcome] || 0) + 1;
    }

    return summary;
  }

  // Asks the provider about one call that is due.
  @CaptureSpan()
  public static async fetchOne(data: {
    call: IncidentVideoCall;
    now: Date;
    http?: VideoCallHttpClient | undefined;
  }): Promise<CallTranscriptFetchOutcome> {
    const call: IncidentVideoCall = data.call;

    if (
      !call.id ||
      !call.projectId ||
      !call.incidentId ||
      !call.transcriptFetchNextAttemptAt
    ) {
      return CallTranscriptFetchOutcome.Skipped;
    }

    const claimed: number = await IncidentVideoCallService.claimTranscriptFetch(
      {
        callId: call.id,
        dueAt: call.transcriptFetchNextAttemptAt,
        nextAttemptAt: new Date(
          data.now.getTime() + CALL_TRANSCRIPT_CLAIM_HOLD_IN_MS,
        ),
      },
    );

    if (claimed === 0) {
      return CallTranscriptFetchOutcome.Skipped;
    }

    // Got some other way meanwhile: added by a person, read by Get from Zoom.
    if (call.transcriptAddedAt) {
      await IncidentVideoCallTranscriptWrite.write(
        call.id,
        IncidentVideoCallTranscriptWrite.noFetch(),
      );
      return CallTranscriptFetchOutcome.Skipped;
    }

    if (!(await IncidentCallRecordingSetting.isOn(call.projectId))) {
      await IncidentVideoCallTranscriptWrite.write(
        call.id,
        IncidentVideoCallTranscriptWrite.noFetch(),
      );
      return CallTranscriptFetchOutcome.TurnedOff;
    }

    const callStartedAt: Date = call.createdAt || data.now;
    let read: VideoCallTranscriptRead;

    try {
      read = await VideoCallTranscriptReader.read({
        call: {
          provider: call.provider,
          videoCallConnectionId: call.videoCallConnectionId,
          externalMeetingId: call.externalMeetingId,
        },
        projectId: call.projectId,
        http: data.http,
      });
    } catch (error) {
      // The provider did not answer: asked again later.
      logger.warn(
        `The provider did not answer for an incident call's transcript; asking again later: ${error}`,
        {
          projectId: call.projectId.toString(),
          incidentId: call.incidentId.toString(),
        } as LogAttributes,
      );

      return await IncidentCallTranscriptFetch.recordAnswer({
        call,
        callStartedAt,
        now: data.now,
        reason: undefined,
      });
    }

    if (!read.found) {
      return await IncidentCallTranscriptFetch.recordAnswer({
        call,
        callStartedAt,
        now: data.now,
        reason: read.unavailable.reason,
      });
    }

    let prepared: PreparedTranscript;

    try {
      prepared = TranscriptText.prepareLines({
        lines: read.lines,
        format: read.format,
      });
    } catch (error) {
      /*
       * A transcript with no words in it, or longer than a call's can be:
       * nothing to store, and asking again brings the same back.
       */
      logger.warn(
        `An incident call's transcript could not be stored: ${error instanceof BadDataException ? error.message : error}`,
        {
          projectId: call.projectId.toString(),
          incidentId: call.incidentId.toString(),
        } as LogAttributes,
      );

      await IncidentVideoCallTranscriptWrite.write(call.id, {
        transcriptFetchStatus: CallTranscriptFetchStatus.Stopped,
        transcriptFetchReason:
          VideoCallTranscriptUnavailableReason.NotTranscribed,
        transcriptFetchCheckedAt: data.now,
        transcriptFetchNextAttemptAt: null,
      });
      await IncidentCallTranscriptFetch.letPostmortemDraftGoOn(call.incidentId);
      return CallTranscriptFetchOutcome.Stopped;
    }

    /*
     * Stored only while OneUptime still waits for it: a person who got or
     * added the transcript while the provider answered took it from here.
     */
    const taken: number =
      await IncidentVideoCallService.takeTranscriptFetchForSaving({
        callId: call.id,
        checkedAt: data.now,
      });

    if (taken === 0) {
      return CallTranscriptFetchOutcome.Skipped;
    }

    await IncidentCallTranscriptSave.save({
      call,
      prepared,
      source: VideoCallTranscriptSource.Provider,
      isAutomatic: true,
    });

    return CallTranscriptFetchOutcome.Found;
  }

  // Keeps what the provider answered, and when to ask again, if ever.
  private static async recordAnswer(data: {
    call: IncidentVideoCall;
    callStartedAt: Date;
    now: Date;
    reason: VideoCallTranscriptUnavailableReason | undefined;
  }): Promise<CallTranscriptFetchOutcome> {
    const next: CallTranscriptFetchNext = getNextCallTranscriptFetch({
      callStartedAt: data.callStartedAt,
      now: data.now,
      reason: data.reason,
    });

    await IncidentVideoCallTranscriptWrite.write(data.call.id!, {
      transcriptFetchStatus: next.status,
      /*
       * No answer at all keeps the last answer there was: a provider that
       * timed out once has not taken back that it is preparing the
       * transcript.
       */
      ...(data.reason !== undefined
        ? { transcriptFetchReason: data.reason }
        : {}),
      transcriptFetchCheckedAt: data.now,
      transcriptFetchNextAttemptAt: next.nextAttemptAt,
    });

    if (next.status === CallTranscriptFetchStatus.Stopped) {
      await IncidentCallTranscriptFetch.letPostmortemDraftGoOn(
        data.call.incidentId!,
      );
      return CallTranscriptFetchOutcome.Stopped;
    }

    return CallTranscriptFetchOutcome.Waiting;
  }

  /*
   * A call that will not get its transcript after all no longer holds the
   * incident's postmortem draft back. Never throws.
   */
  private static async letPostmortemDraftGoOn(
    incidentId: ObjectID,
  ): Promise<void> {
    try {
      await AIIncidentPostmortemRunner.draftWaitingPostmortem({ incidentId });
    } catch (error) {
      logger.error(
        `Could not draft a postmortem that waited for its calls: ${error}`,
        { incidentId: incidentId.toString() } as LogAttributes,
      );
    }
  }
}
