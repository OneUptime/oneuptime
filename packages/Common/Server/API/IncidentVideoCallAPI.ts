import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentVideoCall from "../../Models/DatabaseModels/IncidentVideoCall";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  CallSummary,
  CallSummaryRootCauseOutcome,
  CallSummaryStatus,
  RootCauseSuggestionStatus,
  readCallSummary,
} from "../../Types/VideoCall/CallSummary";
import { VideoCallTranscriptSource } from "../../Types/VideoCall/VideoCallTranscript";
import TranscriptText, {
  PreparedTranscript,
} from "../../Utils/VideoCall/TranscriptText";
import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import IncidentService from "../Services/IncidentService";
import IncidentVideoCallService, {
  Service as IncidentVideoCallServiceType,
} from "../Services/IncidentVideoCallService";
import IncidentCallSummary, {
  CallSummaryStart,
} from "../Utils/AI/CallSummary/IncidentCallSummary";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import PrivateRecordWriteCheck from "../Utils/Permission/PrivateRecordWriteCheck";
import ProductBrandingText from "../Utils/ProductBrandingText";
import Response from "../Utils/Response";
import IncidentCallTranscriptSave from "../Utils/VideoCall/Transcripts/IncidentCallTranscriptSave";
import IncidentVideoCallTranscriptWrite, {
  IncidentVideoCallTranscriptColumns,
} from "../Utils/VideoCall/Transcripts/IncidentVideoCallTranscriptWrite";
import VideoCallTranscriptReader from "../Utils/VideoCall/Transcripts/VideoCallTranscriptReader";
import { VideoCallTranscriptRead } from "../Utils/VideoCall/Transcripts/VideoCallTranscriptRead";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import PrivateRecordPermission from "../Types/Database/Permissions/PrivateRecordPermission";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * AN INCIDENT CALL'S TRANSCRIPT, AND WHAT ONEUPTIME AI READ IN IT
 * (issue #4875).
 *
 *   POST   /incident-video-call/:callId/transcript                add one: { text, fileName? }
 *   POST   /incident-video-call/:callId/transcript/from-provider  read it from Zoom or Google Meet
 *   DELETE /incident-video-call/:callId/transcript                remove it, and what was read in it
 *   POST   /incident-video-call/:callId/call-summary              have OneUptime AI read it again
 *   POST   /incident-video-call/:callId/root-cause-suggestion     { decision, rootCause? }
 *
 * The call is read with the caller's own permissions, so an incident the
 * caller cannot see - a private one - has no call here either. Adding,
 * reading again, removing and dismissing take what starting a call takes
 * (a create on IncidentVideoCall); using the suggestion as the incident's
 * root cause is an edit of the incident's root cause, made with the
 * caller's permissions, so it takes exactly what editing it takes.
 *
 * The transcript, the reading and the review are the server's to write,
 * never a request's: the call's CRUD update is closed (IncidentVideoCall),
 * and these routes write them as root once the caller has been checked.
 */

export const MAX_ACCEPTED_ROOT_CAUSE_LENGTH: number = 50_000;

const CALL_SELECT: {
  _id: true;
  projectId: true;
  incidentId: true;
  provider: true;
  title: true;
  videoCallConnectionId: true;
  externalMeetingId: true;
  externalCalendarEventId: true;
  createdAt: true;
  transcript: true;
  callSummary: true;
  callSummaryStatus: true;
  rootCauseSuggestionStatus: true;
} = {
  _id: true,
  projectId: true,
  incidentId: true,
  provider: true,
  title: true,
  videoCallConnectionId: true,
  externalMeetingId: true,
  externalCalendarEventId: true,
  createdAt: true,
  transcript: true,
  callSummary: true,
  callSummaryStatus: true,
  rootCauseSuggestionStatus: true,
};

export default class IncidentVideoCallAPI extends BaseAPI<
  IncidentVideoCall,
  IncidentVideoCallServiceType
> {
  public constructor() {
    super(IncidentVideoCall, IncidentVideoCallService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/:callId/transcript`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.addTranscript(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${basePath}/:callId/transcript/from-provider`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.readTranscriptFromProvider(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.delete(
      `${basePath}/:callId/transcript`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.removeTranscript(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${basePath}/:callId/call-summary`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.readAgain(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${basePath}/:callId/root-cause-suggestion`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.reviewRootCauseSuggestion(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async addTranscript(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await this.authorizeCallWork(req);
    const call: IncidentVideoCall = await this.getCallToWorkOn(req, props);
    const body: JSONObject = IncidentVideoCallAPI.getBody(req);
    const text: JSONValue | undefined = body["text"];
    const fileName: JSONValue | undefined = body["fileName"];

    if (typeof text !== "string" || !text.trim()) {
      throw new BadDataException(
        "Add the transcript: upload the file your meeting tool saved (.vtt, .srt or .txt), or paste its text.",
      );
    }

    const prepared: PreparedTranscript = TranscriptText.prepare({
      text,
      fileName: typeof fileName === "string" ? fileName : undefined,
    });

    const result: JSONObject = await this.saveTranscript({
      call,
      props,
      prepared,
      source: VideoCallTranscriptSource.Upload,
    });

    return Response.sendJsonObjectResponse(req, res, result);
  }

  private async readTranscriptFromProvider(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await this.authorizeCallWork(req);
    const call: IncidentVideoCall = await this.getCallToWorkOn(req, props);

    const read: VideoCallTranscriptRead = await VideoCallTranscriptReader.read({
      call: {
        provider: call.provider,
        videoCallConnectionId: call.videoCallConnectionId,
        externalMeetingId: call.externalMeetingId,
        externalCalendarEventId: call.externalCalendarEventId,
        startedAt: call.createdAt,
      },
      projectId: call.projectId!,
    });

    if (!read.found) {
      return Response.sendJsonObjectResponse(req, res, {
        added: false,
        reason: read.unavailable.reason,
        message: ProductBrandingText.brandText(read.unavailable.message),
      });
    }

    const prepared: PreparedTranscript = TranscriptText.prepareLines({
      lines: read.lines,
      format: read.format,
    });

    const result: JSONObject = await this.saveTranscript({
      call,
      props,
      prepared,
      source: VideoCallTranscriptSource.Provider,
    });

    return Response.sendJsonObjectResponse(req, res, {
      added: true,
      ...result,
    });
  }

  private async removeTranscript(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await this.authorizeCallWork(req);
    const call: IncidentVideoCall = await this.getCallToWorkOn(req, props);

    await this.writeCall(
      call.id!,
      IncidentVideoCallTranscriptWrite.noTranscript(),
    );

    return Response.sendEmptySuccessResponse(req, res);
  }

  private async readAgain(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await this.authorizeCallWork(req);
    const call: IncidentVideoCall = await this.getCallToWorkOn(req, props);

    if (!call.transcript || !call.transcript.trim()) {
      throw new BadDataException(
        "This call has no transcript to read. Add one first.",
      );
    }

    const started: CallSummaryStart = await IncidentCallSummary.start({
      callId: call.id!,
      userId: props.userId,
    });

    return Response.sendJsonObjectResponse(
      req,
      res,
      IncidentVideoCallAPI.describeStart(started),
    );
  }

  /*
   * What a person decided about the root cause OneUptime AI suggested from
   * the call: Accepted (with the root cause they saved, edited or not),
   * Dismissed, or Suggested again (undoing a dismissal).
   */
  private async reviewRootCauseSuggestion(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    CommonAPI.assertAuthenticatedProjectPrincipal(props);

    const body: JSONObject = IncidentVideoCallAPI.getBody(req);
    const decision: JSONValue | undefined = body["decision"];

    if (
      decision !== RootCauseSuggestionStatus.Accepted &&
      decision !== RootCauseSuggestionStatus.Dismissed &&
      decision !== RootCauseSuggestionStatus.Suggested
    ) {
      throw new BadDataException(
        "Decision must be Accepted, Dismissed or Suggested.",
      );
    }

    // Dismissing (and undoing it) is work on the call; accepting is an edit of the incident.
    if (decision !== RootCauseSuggestionStatus.Accepted) {
      IncidentVideoCallAPI.assertCanWorkOnCalls(props);
    }

    const call: IncidentVideoCall = await this.getCall(req, props);

    /*
     * A call of a private incident is worked on, and its incident edited,
     * only with the permissions of the teams that own the incident
     * (PrivateRecordPermission) - the review is written as OneUptime below,
     * so it is asked here.
     */
    if (decision === RootCauseSuggestionStatus.Accepted) {
      await IncidentVideoCallAPI.assertReachesIncident({
        call,
        props,
        modelType: Incident,
        type: DatabaseRequestType.Update,
        action: "edit this incident's root cause",
      });
    } else {
      await IncidentVideoCallAPI.assertReachesIncident({
        call,
        props,
        modelType: IncidentVideoCall,
        type: DatabaseRequestType.Create,
        action: "work on this incident's calls",
      });
    }

    const summary: CallSummary | null = readCallSummary(call.callSummary);

    if (
      call.callSummaryStatus !== CallSummaryStatus.Ready ||
      !summary ||
      summary.rootCause.outcome !== CallSummaryRootCauseOutcome.Suggested ||
      !call.rootCauseSuggestionStatus
    ) {
      throw new BadDataException(
        ProductBrandingText.brandText(
          "OneUptime AI did not suggest a root cause from this call.",
        ),
      );
    }

    if (decision === RootCauseSuggestionStatus.Accepted) {
      const rootCause: JSONValue | undefined = body["rootCause"];

      if (typeof rootCause !== "string" || !rootCause.trim()) {
        throw new BadDataException("Write the root cause to save.");
      }

      if (rootCause.length > MAX_ACCEPTED_ROOT_CAUSE_LENGTH) {
        throw new BadDataException(
          `The root cause is too long: it can be up to ${TranscriptText.formatCount(MAX_ACCEPTED_ROOT_CAUSE_LENGTH)} characters.`,
        );
      }

      /*
       * The caller's own edit of the incident: their permission to edit
       * its root cause, the incident's privacy, its feed entry and the
       * post to its channels, exactly as editing the root cause anywhere
       * else.
       */
      const updatedCount: number = await IncidentService.updateOneById({
        id: call.incidentId!,
        data: { rootCause: rootCause.trim() },
        props,
      });

      // An incident they may read but not change: refused, never marked accepted.
      if (updatedCount === 0) {
        throw await IncidentService.getUnwrittenByIdError({
          id: call.incidentId!,
          props,
          type: DatabaseRequestType.Update,
        });
      }
    }

    await this.writeCall(call.id!, {
      rootCauseSuggestionStatus: decision,
      rootCauseSuggestionReviewedAt:
        decision === RootCauseSuggestionStatus.Suggested ? null : new Date(),
      rootCauseSuggestionReviewedByUserId:
        decision === RootCauseSuggestionStatus.Suggested
          ? null
          : props.userId || null,
    });

    return Response.sendJsonObjectResponse(req, res, {
      rootCauseSuggestionStatus: decision,
    });
  }

  /*
   * Stores a transcript on the call - replacing any it had, and what was
   * read in that, and ending any wait for one - has OneUptime AI read it,
   * and says so in the incident's feed (IncidentCallTranscriptSave).
   */
  private async saveTranscript(data: {
    call: IncidentVideoCall;
    props: DatabaseCommonInteractionProps;
    prepared: PreparedTranscript;
    source: VideoCallTranscriptSource;
  }): Promise<JSONObject> {
    const started: CallSummaryStart = await IncidentCallTranscriptSave.save({
      call: data.call,
      prepared: data.prepared,
      source: data.source,
      userId: data.props.userId,
    });

    return {
      transcriptSource: data.source,
      transcriptInfo: data.prepared.info as unknown as JSONObject,
      ...IncidentVideoCallAPI.describeStart(started),
    };
  }

  // Who may add, read again, remove and dismiss: whoever may start the incident's calls.
  private async authorizeCallWork(
    req: ExpressRequest,
  ): Promise<DatabaseCommonInteractionProps> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertAuthenticatedProjectPrincipal(props);
    IncidentVideoCallAPI.assertCanWorkOnCalls(props);

    return props;
  }

  private static assertCanWorkOnCalls(
    props: DatabaseCommonInteractionProps,
  ): void {
    CommonAPI.assertCanCreateTable({
      modelType: IncidentVideoCall,
      props,
      errorMessage:
        "You do not have permission to work on this incident's calls. Ask for the Incident Member role, or the Create Incident Video Call permission.",
    });
  }

  /*
   * The call the path names (getCall), to add, read again or remove its
   * transcript: work on a call of a private incident takes the permission of
   * a team that owns the incident, or of a person named as its owner
   * (assertReachesIncident) - these routes write as OneUptime, so it is
   * asked here.
   */
  private async getCallToWorkOn(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
  ): Promise<IncidentVideoCall> {
    const call: IncidentVideoCall = await this.getCall(req, props);

    await IncidentVideoCallAPI.assertReachesIncident({
      call,
      props,
      modelType: IncidentVideoCall,
      type: DatabaseRequestType.Create,
      action: "work on this incident's calls",
    });

    return call;
  }

  /*
   * Refuses, in so many words, a caller whose permission for `type` on
   * `modelType` does not reach the call's incident: it is private, and
   * neither they nor a team of theirs granting it owns it
   * (PrivateRecordWriteCheck). Anyone may be told: they read the call.
   */
  private static async assertReachesIncident(data: {
    call: IncidentVideoCall;
    props: DatabaseCommonInteractionProps;
    modelType: typeof Incident | typeof IncidentVideoCall;
    type: DatabaseRequestType;
    action: string;
  }): Promise<void> {
    const reaches: boolean = await PrivateRecordWriteCheck.reaches({
      modelType: data.modelType,
      type: data.type,
      recordService:
        IncidentService as unknown as DatabaseService<DatabaseBaseModel>,
      recordId: data.call.incidentId!,
      props: data.props,
    });

    if (!reaches) {
      throw new NotAuthorizedException(
        `You do not have permission to ${data.action}. ${PrivateRecordPermission.getPrivateParentWriteReason("incident")}`,
      );
    }
  }

  /*
   * The call the path names, read with the caller's permissions: a call of
   * an incident they cannot see, or of another project, is not found.
   */
  private async getCall(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
  ): Promise<IncidentVideoCall> {
    const projectId: ObjectID = CommonAPI.assertTenantScoped(props);
    const callIdParam: string = String(req.params["callId"] || "");

    if (!ObjectID.isValidUUID(callIdParam)) {
      throw new BadDataException("A valid video call ID is required.");
    }

    const call: IncidentVideoCall | null = await this.service.findOneBy({
      query: { _id: callIdParam, projectId },
      select: CALL_SELECT,
      props,
    });

    if (!call || !call.id || !call.incidentId || !call.projectId) {
      throw new NotFoundException("Video call not found.");
    }

    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: call.projectId,
      projectId,
    });

    return call;
  }

  private static describeStart(started: CallSummaryStart): JSONObject {
    const described: JSONObject = { callSummaryStatus: started.status };

    if (started.message) {
      described["callSummaryStatusMessage"] = ProductBrandingText.brandText(
        started.message,
      );
    }

    return described;
  }

  private static getBody(req: ExpressRequest): JSONObject {
    return req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as JSONObject)
      : {};
  }

  // The server's own write, after the caller was checked.
  private async writeCall(
    callId: ObjectID,
    data: IncidentVideoCallTranscriptColumns,
  ): Promise<void> {
    await IncidentVideoCallTranscriptWrite.write(callId, data);
  }
}
