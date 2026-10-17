import IncidentVideoCall from "../../Models/DatabaseModels/IncidentVideoCall";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Blue500 } from "../../Types/BrandColors";
import BadDataException from "../../Types/Exception/BadDataException";
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
import {
  getVideoCallNoun,
  getVideoCallProviderDisplayName,
} from "../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallTranscriptInfo,
  VideoCallTranscriptSource,
} from "../../Types/VideoCall/VideoCallTranscript";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import TranscriptText, {
  PreparedTranscript,
} from "../../Utils/VideoCall/TranscriptText";
import UserMiddleware from "../Middleware/UserAuthorization";
import IncidentFeedService from "../Services/IncidentFeedService";
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
import logger, { LogAttributes } from "../Utils/Logger";
import ProductBrandingText from "../Utils/ProductBrandingText";
import Response from "../Utils/Response";
import IncidentVideoCallTranscriptWrite, {
  IncidentVideoCallTranscriptColumns,
} from "../Utils/VideoCall/Transcripts/IncidentVideoCallTranscriptWrite";
import VideoCallTranscriptReader from "../Utils/VideoCall/Transcripts/VideoCallTranscriptReader";
import { VideoCallTranscriptRead } from "../Utils/VideoCall/Transcripts/VideoCallTranscriptRead";
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
    const call: IncidentVideoCall = await this.getCall(req, props);
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
    const call: IncidentVideoCall = await this.getCall(req, props);

    const read: VideoCallTranscriptRead = await VideoCallTranscriptReader.read({
      call: {
        provider: call.provider,
        videoCallConnectionId: call.videoCallConnectionId,
        externalMeetingId: call.externalMeetingId,
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
    const call: IncidentVideoCall = await this.getCall(req, props);

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
    const call: IncidentVideoCall = await this.getCall(req, props);

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
      await IncidentService.updateOneById({
        id: call.incidentId!,
        data: { rootCause: rootCause.trim() },
        props,
      });
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
   * read in that - has OneUptime AI read it, and says so in the incident's
   * feed.
   */
  private async saveTranscript(data: {
    call: IncidentVideoCall;
    props: DatabaseCommonInteractionProps;
    prepared: PreparedTranscript;
    source: VideoCallTranscriptSource;
  }): Promise<JSONObject> {
    const call: IncidentVideoCall = data.call;
    const info: VideoCallTranscriptInfo = data.prepared.info;

    await this.writeCall(call.id!, {
      transcript: data.prepared.stored,
      transcriptSource: data.source,
      transcriptInfo: info as unknown as JSONObject,
      transcriptAddedAt: new Date(),
      transcriptAddedByUserId: data.props.userId || null,
      ...IncidentVideoCallTranscriptWrite.noReading(),
    });

    const started: CallSummaryStart = await IncidentCallSummary.start({
      callId: call.id!,
      userId: data.props.userId,
    });

    await this.announceTranscript({
      call,
      props: data.props,
      info,
      source: data.source,
    });

    return {
      transcriptSource: data.source,
      transcriptInfo: info as unknown as JSONObject,
      ...IncidentVideoCallAPI.describeStart(started),
    };
  }

  // A line in the incident's feed, kept to the dashboard: never posted to its channels.
  private async announceTranscript(data: {
    call: IncidentVideoCall;
    props: DatabaseCommonInteractionProps;
    info: VideoCallTranscriptInfo;
    source: VideoCallTranscriptSource;
  }): Promise<void> {
    try {
      const callNoun: string = getVideoCallNoun(data.call.provider);
      const details: string = TranscriptText.describeInfo(data.info);

      const feedInfoInMarkdown: string =
        data.source === VideoCallTranscriptSource.Provider
          ? mdText`📝 The transcript of the **${callNoun}** was read from ${getVideoCallProviderDisplayName(data.call.provider)}: ${details}.`.toString()
          : mdText`📝 A transcript of the **${callNoun}** was added: ${details}.`.toString();

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: data.call.incidentId!,
        projectId: data.call.projectId!,
        incidentFeedEventType: IncidentFeedEventType.VideoCallTranscriptAdded,
        displayColor: Blue500,
        feedInfoInMarkdown,
        userId: data.props.userId,
      });
    } catch (error) {
      logger.error(`Could not record an added call transcript: ${error}`, {
        projectId: data.call.projectId?.toString(),
        incidentId: data.call.incidentId?.toString(),
      } as LogAttributes);
    }
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
