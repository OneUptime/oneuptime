import AlertEpisodeInternalNote from "../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeStateTimeline from "../../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeInternalNote from "../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeStateTimeline from "../../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import Project from "../../../../Models/DatabaseModels/Project";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX, {
  LIMIT_PER_PROJECT,
} from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { PrivateRecordKind } from "../../../../Types/StatusPage/PrivateRecordPublicNotes";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspaceTextAreaBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import AlertEpisodeInternalNoteService from "../../../Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../../Services/AlertEpisodeService";
import AlertInternalNoteService from "../../../Services/AlertInternalNoteService";
import AlertService from "../../../Services/AlertService";
import IncidentEpisodeInternalNoteService from "../../../Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodePublicNoteService from "../../../Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../Services/IncidentEpisodeService";
import IncidentInternalNoteService from "../../../Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../Services/IncidentPublicNoteService";
import IncidentService from "../../../Services/IncidentService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import ProjectService from "../../../Services/ProjectService";
import ScheduledMaintenanceInternalNoteService from "../../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Services/ScheduledMaintenanceService";
import WorkspaceNotificationLogService from "../../../Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";
import logger from "../../Logger";
import OnCallPersonPageAnswer, {
  OnCallPersonPageRecordKind,
} from "../../OnCall/OnCallPersonPageAnswer";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
  WorkspaceLatePress,
} from "../WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectButton,
  WorkspaceConnectRequestAgainKind,
  WorkspacePendingActionKind,
} from "../WorkspaceConnectRequest";
import WorkspaceIncidentActions, {
  WORKSPACE_INCIDENT_FORM_TEXT,
  WorkspaceIncidentChoice,
  WorkspaceIncidentForForm,
  WorkspaceIncidentFormCheck,
} from "../WorkspaceIncidentActions";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventRecord,
  WorkspaceEventStanding,
  WorkspaceEventStateOption,
  WorkspaceEventStateOptions,
  WorkspaceEventType,
} from "../WorkspaceMemberActions";
import WorkspaceNoteForm, {
  SCHEDULED_MAINTENANCE_NOTE_NOUN,
  WORKSPACE_NOTE_FORM_TEXT,
  WorkspaceNoteFormType,
  WorkspaceSubmittedNote,
} from "../WorkspaceNoteForm";
import WorkspaceHeldPublicNote from "../WorkspaceHeldPublicNote";
import WorkspacePublicNoteApproval from "../WorkspacePublicNoteApproval";
import MattermostUtil from "./Mattermost";
import MattermostActionContext, {
  MattermostPressedAction,
} from "./MattermostActionContext";
import {
  MATTERMOST_PRESS_ACTIONS,
  MATTERMOST_SUBMIT_ACTIONS,
  MattermostPress,
  MattermostPressSpec,
  MattermostRecordType,
  MattermostSubmit,
  MattermostSubmitSpec,
} from "./MattermostActionTypes";
import MattermostConnection from "./MattermostConnection";
import MattermostPublicNoteApprovalActions from "./MattermostPublicNoteApprovalActions";
import MattermostTeams, {
  MattermostTeamsOfConnection,
} from "./MattermostTeams";

/*
 * ACTING ON A PRESS IN MATTERMOST.
 *
 * Mattermost POSTs a press of a button or a menu on OneUptime's messages
 * to /mattermost/interactive, and the submission of a form OneUptime opened
 * to /mattermost/dialog (MattermostAPI). Each is acted on here, in this
 * order:
 *
 *  1. Its context is read: signed by OneUptime for the team the press came
 *     from (MattermostActionContext), or refused.
 *  2. The record it is about is found, and with it the project: a button
 *     acts in the project of the record it is about. That project must be
 *     connected to the Mattermost team the press came from.
 *  3. Whose Mattermost account pressed - which OneUptime member it is
 *     connected to in that project (WorkspaceUserAuthToken), and that they
 *     are still a member (WorkspaceActionAuthorization). An account that is
 *     not connected is asked to connect, with a link to where they do.
 *  4. It is done as that member, with their permissions, by the same code
 *     Slack and Microsoft Teams presses run (WorkspaceMemberActions,
 *     WorkspaceIncidentActions, WorkspaceNoteForm), and answered with the
 *     same words (WorkspaceActionAnswers).
 *
 * A press is answered only to the person who pressed: Mattermost shows a
 * press's `ephemeral_text` to them alone. A form's submission is answered by
 * closing the form, or by keeping it open with what went wrong.
 */

// What Mattermost is answered with for a press: only the presser sees it.
export interface MattermostPressAnswer {
  ephemeral_text?: string | undefined;
}

// What Mattermost is answered with for a form: nothing closes it, an error keeps it open.
export interface MattermostDialogAnswer {
  error?: string | undefined;
  errors?: Record<string, string> | undefined;
}

// Who pressed, as a OneUptime member, and where.
export interface MattermostRequester {
  projectId: ObjectID;
  userId: ObjectID;
  // Their Mattermost account, which an answer only they see is posted to.
  mattermostUserId: string;
  props: DatabaseCommonInteractionProps;
  // The project's connection: what OneUptime calls Mattermost with.
  authToken: string;
  channelId: string | undefined;
}

// A request that could not be acted on: what its person is told instead.
class MattermostRefusal extends Error {
  public readonly markdown: string;

  public constructor(markdown: string) {
    super(markdown);
    this.markdown = markdown;
  }
}

interface RecordTypeDetails {
  eventType: WorkspaceEventType;
  stateTimelineModel: DatabaseBaseModelType;
  // How a log row names the record: incidentId.
  logColumn:
    | "incidentId"
    | "alertId"
    | "incidentEpisodeId"
    | "alertEpisodeId"
    | "scheduledMaintenanceId";
  // How workspace logs name the button's record: "acknowledge_incident".
  loggedName: string;
}

const RECORD_TYPES: Record<MattermostRecordType, RecordTypeDetails> = {
  [MattermostRecordType.Incident]: {
    eventType: WorkspaceEventType.Incident,
    stateTimelineModel: IncidentStateTimeline,
    logColumn: "incidentId",
    loggedName: "incident",
  },
  [MattermostRecordType.Alert]: {
    eventType: WorkspaceEventType.Alert,
    stateTimelineModel: AlertStateTimeline,
    logColumn: "alertId",
    loggedName: "alert",
  },
  [MattermostRecordType.IncidentEpisode]: {
    eventType: WorkspaceEventType.IncidentEpisode,
    stateTimelineModel: IncidentEpisodeStateTimeline,
    logColumn: "incidentEpisodeId",
    loggedName: "incident_episode",
  },
  [MattermostRecordType.AlertEpisode]: {
    eventType: WorkspaceEventType.AlertEpisode,
    stateTimelineModel: AlertEpisodeStateTimeline,
    logColumn: "alertEpisodeId",
    loggedName: "alert_episode",
  },
  [MattermostRecordType.ScheduledMaintenance]: {
    eventType: WorkspaceEventType.ScheduledMaintenance,
    stateTimelineModel: ScheduledMaintenanceStateTimeline,
    logColumn: "scheduledMaintenanceId",
    loggedName: "scheduled_maintenance",
  },
};

// The state changes a press makes, as the shared answers name them.
const PENDING_KINDS: Partial<
  Record<MattermostPress, WorkspacePendingActionKind>
> = {
  [MattermostPress.Acknowledge]: WorkspacePendingActionKind.Acknowledge,
  [MattermostPress.Resolve]: WorkspacePendingActionKind.Resolve,
  [MattermostPress.MarkAsOngoing]: WorkspacePendingActionKind.MarkAsOngoing,
  [MattermostPress.MarkAsComplete]: WorkspacePendingActionKind.MarkAsComplete,
};

const LATE_PRESSES: Partial<Record<MattermostPress, WorkspaceLatePress>> = {
  [MattermostPress.Acknowledge]: WorkspaceLatePress.Acknowledge,
  [MattermostPress.Resolve]: WorkspaceLatePress.Resolve,
  [MattermostPress.MarkAsOngoing]: WorkspaceLatePress.MarkAsOngoing,
  [MattermostPress.MarkAsComplete]: WorkspaceLatePress.MarkAsComplete,
};

// The fields of OneUptime's forms, by the names their submissions carry.
export const MATTERMOST_NOTE_FIELD: string = "note";
export const MATTERMOST_NOTE_TYPE_FIELD: string = "noteType";
export const MATTERMOST_STATE_FIELD: string = "state";
export const MATTERMOST_ON_CALL_POLICY_FIELD: string = "onCallPolicy";
export const MATTERMOST_SEVERITY_FIELD: string = "incidentSeverity";

// The most characters a note typed in a form may have (Mattermost's longest text area).
const MAX_NOTE_LENGTH: number = MattermostUtil.DIALOG_TEXTAREA_MAX_LENGTH;

const SEVERITY_CHECK: WorkspaceIncidentFormCheck = {
  kind: "update",
  data: { incidentSeverityId: ObjectID.generate() },
  action: "change the severity of this incident",
};

export default class MattermostActions {
  // What a press with a context OneUptime did not sign is told.
  public static readonly UNVERIFIED_PRESS_MESSAGE: string =
    "This button could not be verified, so nothing was done. Open the record in OneUptime instead.";

  // What a press of a button Mattermost has no action for is told.
  public static readonly UNSUPPORTED_PRESS_MESSAGE: string =
    "This button cannot be used in Mattermost. Open the record in OneUptime instead.";

  public static readonly NO_ON_CALL_POLICIES_MESSAGE: string =
    "No on-call policies are available to you in this project yet. Add one in the OneUptime Dashboard under On-Call > On-Call Policies, or ask a project admin for access to one.";

  // A press of a button or a menu item: what its presser is told.
  @CaptureSpan()
  public static async handlePress(
    body: JSONObject,
  ): Promise<MattermostPressAnswer> {
    const press: MattermostPressedAction | null =
      MattermostActionContext.readPress({
        context: body["context"],
        teamId: body["team_id"],
        channelId: body["channel_id"],
      });

    if (!press) {
      return { ephemeral_text: MattermostActions.UNVERIFIED_PRESS_MESSAGE };
    }

    /*
     * Approve or Reject on a public note that waits for approval, in the
     * direct message its approvers get (MattermostPublicNoteApprovalActions).
     */
    if (WorkspacePublicNoteApproval.isApprovalAction(press.actionId)) {
      return await MattermostPublicNoteApprovalActions.handlePress({
        body: body,
        press: press,
      });
    }

    const spec: MattermostPressSpec | undefined =
      Object.prototype.hasOwnProperty.call(
        MATTERMOST_PRESS_ACTIONS,
        press.actionId,
      )
        ? MATTERMOST_PRESS_ACTIONS[press.actionId]
        : undefined;

    if (!spec) {
      return { ephemeral_text: MattermostActions.UNSUPPORTED_PRESS_MESSAGE };
    }

    const pendingKind: WorkspacePendingActionKind | undefined =
      PENDING_KINDS[spec.press];

    try {
      const requester: MattermostRequester =
        await MattermostActions.getRequester({
          body: body,
          teamId: press.teamId,
          recordType: spec.recordType,
          recordId: press.value,
          purpose: pendingKind
            ? WorkspaceActionAnswers.getPendingActionPurpose({
                kind: pendingKind,
                eventType: RECORD_TYPES[spec.recordType].eventType,
                workspaceType: WorkspaceType.Mattermost,
              })
            : MattermostActions.getFormPurpose(spec),
          isForm: !pendingKind,
        });

      const recordId: ObjectID = new ObjectID(press.value);

      if (pendingKind) {
        const answer: WorkspaceAnswer = await MattermostActions.changeStanding({
          requester: requester,
          spec: spec,
          kind: pendingKind,
          recordId: recordId,
        });

        return { ephemeral_text: answer.markdown };
      }

      const modalBlock: WorkspaceModalBlock = await MattermostActions.getForm({
        requester: requester,
        spec: spec,
        recordId: recordId,
      });

      await MattermostUtil.showModalToUser({
        authToken: requester.authToken,
        triggerId:
          typeof body["trigger_id"] === "string"
            ? (body["trigger_id"] as string)
            : "",
        modalBlock: modalBlock,
        directMessageChannelId: press.channelId,
        // Its submission comes from the team the press did.
        teamId: press.teamId,
      });

      return {};
    } catch (err) {
      return { ephemeral_text: MattermostActions.getRefusalMarkdown(err) };
    }
  }

  /*
   * A form's submission: closed when it is done, kept open with why when it
   * is not. A form somebody cancelled is closed.
   */
  @CaptureSpan()
  public static async handleDialogSubmission(
    body: JSONObject,
  ): Promise<MattermostDialogAnswer> {
    if (body["cancelled"] === true) {
      return {};
    }

    const form: MattermostPressedAction | null =
      MattermostActionContext.readDialogState({
        state: body["state"],
        teamId: body["team_id"],
        channelId: body["channel_id"],
      });

    const submission: JSONObject =
      body["submission"] &&
      typeof body["submission"] === "object" &&
      !Array.isArray(body["submission"])
        ? (body["submission"] as JSONObject)
        : {};

    // Reject's form, on a public note that waits for approval.
    if (form && WorkspacePublicNoteApproval.isApprovalAction(form.actionId)) {
      return await MattermostPublicNoteApprovalActions.handleDialogSubmission({
        body: body,
        form: form,
        submission: submission,
      });
    }

    const spec: MattermostSubmitSpec | undefined =
      form &&
      Object.prototype.hasOwnProperty.call(
        MATTERMOST_SUBMIT_ACTIONS,
        form.actionId,
      )
        ? MATTERMOST_SUBMIT_ACTIONS[form.actionId]
        : undefined;

    if (!form || !spec) {
      return { error: MattermostActions.UNVERIFIED_PRESS_MESSAGE };
    }

    try {
      const requester: MattermostRequester =
        await MattermostActions.getRequester({
          body: body,
          teamId: form.teamId,
          recordType: spec.recordType,
          recordId: form.value,
          purpose: MattermostActions.getSubmitPurpose(spec),
          isForm: true,
        });

      const recordId: ObjectID = new ObjectID(form.value);

      switch (spec.submit) {
        case MattermostSubmit.Note:
          return await MattermostActions.submitNote({
            requester,
            spec,
            recordId,
            submission,
          });
        case MattermostSubmit.State:
          return await MattermostActions.submitState({
            requester,
            spec,
            recordId,
            submission,
          });
        case MattermostSubmit.OnCallPolicy:
          return await MattermostActions.submitOnCallPolicy({
            requester,
            spec,
            recordId,
            submission,
          });
        case MattermostSubmit.Severity:
          return await MattermostActions.submitSeverity({
            requester,
            recordId,
            submission,
          });
      }
    } catch (err) {
      return { error: MattermostActions.getRefusalText(err) };
    }
  }

  /*
   * Who pressed, as the OneUptime member their Mattermost account is
   * connected to in the project of the record - refused (MattermostRefusal)
   * with what they are told when there is no such member.
   */
  private static async getRequester(data: {
    body: JSONObject;
    teamId: string;
    recordType: MattermostRecordType;
    recordId: string;
    // Completes "Connect your Mattermost account to ...".
    purpose: string;
    // A form opens only on a fresh press: the prompt asks to press it again.
    isForm: boolean;
  }): Promise<MattermostRequester> {
    const mattermostUserId: JSONValue | undefined = data.body["user_id"];

    if (!MattermostConnection.isMattermostId(mattermostUserId)) {
      throw new MattermostRefusal(MattermostActions.UNVERIFIED_PRESS_MESSAGE);
    }

    if (!ObjectID.isValidUUID(data.recordId)) {
      throw new MattermostRefusal(MattermostActions.UNVERIFIED_PRESS_MESSAGE);
    }

    const projectId: ObjectID | null =
      await MattermostActions.getProjectOfRecord({
        recordType: data.recordType,
        recordId: new ObjectID(data.recordId),
      });

    const noRecordMessage: string =
      mdText`This ${WorkspaceMemberActions.getNoun(
        RECORD_TYPES[data.recordType].eventType,
      )} no longer exists in OneUptime.`.toString();

    if (!projectId) {
      throw new MattermostRefusal(noRecordMessage);
    }

    return await MattermostActions.getRequesterInProject({
      body: data.body,
      teamId: data.teamId,
      projectId: projectId,
      purpose: data.purpose,
      isForm: data.isForm,
    });
  }

  /*
   * Who pressed, as the OneUptime member their Mattermost account is
   * connected to in `projectId` - the project of the record a press is
   * about, or the one a public note's approval message was signed for -
   * refused (MattermostRefusal) with what they are told when there is no
   * such member. The Mattermost team the press's context was signed for
   * must be one the project's connection works in (MattermostTeams): the
   * team it was connected to, its default team, or another team its bot is
   * a member of (isTeamOfProject).
   */
  public static async getRequesterInProject(data: {
    body: JSONObject;
    teamId: string;
    projectId: ObjectID;
    // Completes "Connect your Mattermost account to ...".
    purpose: string;
    // A form opens only on a fresh press: the prompt asks to press it again.
    isForm: boolean;
  }): Promise<MattermostRequester> {
    const projectId: ObjectID = data.projectId;
    const mattermostUserId: JSONValue | undefined = data.body["user_id"];

    if (!MattermostConnection.isMattermostId(mattermostUserId)) {
      throw new MattermostRefusal(MattermostActions.UNVERIFIED_PRESS_MESSAGE);
    }

    // The record's project must work in the team the press came from.
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          projectId: projectId,
          workspaceType: WorkspaceType.Mattermost,
        },
        select: {
          _id: true,
          authToken: true,
          workspaceProjectId: true,
          miscData: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      !projectAuth?.authToken ||
      !(await MattermostActions.isTeamOfProject({
        projectId: projectId,
        projectAuth: projectAuth,
        teamId: data.teamId,
      }))
    ) {
      throw new MattermostRefusal(
        "This Mattermost team is no longer connected to the OneUptime project this message is from.",
      );
    }

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          projectId: projectId,
          workspaceType: WorkspaceType.Mattermost,
          workspaceUserId: mattermostUserId,
        },
        select: {
          userId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userAuth?.userId) {
      throw new MattermostRefusal(
        await MattermostActions.getConnectPromptMarkdown({
          projectId: projectId,
          teamId: data.teamId,
          connectedTeamId: projectAuth.workspaceProjectId,
          purpose: data.purpose,
          isForm: data.isForm,
        }),
      );
    }

    let props: DatabaseCommonInteractionProps;

    try {
      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userAuth.userId,
        projectId: projectId,
      });
    } catch (err) {
      throw new MattermostRefusal(MattermostActions.getRefusalMarkdown(err));
    }

    return {
      projectId: projectId,
      userId: userAuth.userId,
      mattermostUserId: mattermostUserId,
      props: props,
      authToken: projectAuth.authToken,
      channelId: MattermostConnection.isMattermostId(data.body["channel_id"])
        ? (data.body["channel_id"] as string)
        : undefined,
    };
  }

  /*
   * Whether a team is one a project's Mattermost connection works in. The
   * team it was connected to, and its default team, always are, as the one
   * team was before teams were told apart. Another team is one its bot is
   * a member of: as listed in the last few minutes
   * (MattermostTeams.isFresh), else as the server lists the bot's teams
   * now - a team the bot was added to since, or taken out of, so the
   * buttons in a team it left stop working. Asked of the server only for a
   * team a press OneUptime signed came from.
   */
  private static async isTeamOfProject(data: {
    projectId: ObjectID;
    projectAuth: WorkspaceProjectAuthToken;
    teamId: string;
  }): Promise<boolean> {
    const stored: MattermostTeamsOfConnection | null =
      MattermostTeams.readConnection(data.projectAuth);

    if (!stored) {
      return false;
    }

    if (
      data.teamId === stored.connectedTeamId ||
      data.teamId === stored.defaultTeam.id
    ) {
      return true;
    }

    if (
      MattermostTeams.isFresh(stored) &&
      MattermostTeams.isTeamOfConnection({
        connection: stored,
        teamId: data.teamId,
      })
    ) {
      return true;
    }

    return MattermostTeams.isTeamOfConnection({
      connection: await MattermostTeams.getOfConnection({
        projectId: data.projectId,
        projectAuth: data.projectAuth,
        refresh: true,
      }),
      teamId: data.teamId,
    });
  }

  /*
   * The project a record is in, read as OneUptime only for that: whether
   * the presser may see the record is asked of them afterwards. Null when
   * there is no such record.
   */
  private static async getProjectOfRecord(data: {
    recordType: MattermostRecordType;
    recordId: ObjectID;
  }): Promise<ObjectID | null> {
    const findArgs: {
      id: ObjectID;
      select: { projectId: true };
      props: { isRoot: true };
    } = {
      id: data.recordId,
      select: { projectId: true },
      props: { isRoot: true },
    };

    let projectId: ObjectID | undefined = undefined;

    switch (data.recordType) {
      case MattermostRecordType.Incident:
        projectId = (await IncidentService.findOneById(findArgs))?.projectId;
        break;
      case MattermostRecordType.Alert:
        projectId = (await AlertService.findOneById(findArgs))?.projectId;
        break;
      case MattermostRecordType.IncidentEpisode:
        projectId = (await IncidentEpisodeService.findOneById(findArgs))
          ?.projectId;
        break;
      case MattermostRecordType.AlertEpisode:
        projectId = (await AlertEpisodeService.findOneById(findArgs))
          ?.projectId;
        break;
      case MattermostRecordType.ScheduledMaintenance:
        projectId = (await ScheduledMaintenanceService.findOneById(findArgs))
          ?.projectId;
        break;
    }

    return projectId || null;
  }

  /*
   * What somebody whose Mattermost account is not connected is told: to
   * connect it, with a link to where they do - their User Settings in the
   * project - and, in a team connected to more than one project, or one the
   * project works in beside the team it was connected to (another project
   * may be connected to it), which project. The press itself is not kept:
   * they press it again once they are connected.
   */
  public static async getConnectPromptMarkdown(data: {
    projectId: ObjectID;
    teamId: string;
    // The team the project was connected to (MattermostTeams).
    connectedTeamId?: string | undefined;
    purpose: string;
    isForm: boolean;
  }): Promise<string> {
    let projectName: string | null = null;

    const connectionCount: number = (
      await WorkspaceProjectAuthTokenService.countBy({
        query: {
          workspaceType: WorkspaceType.Mattermost,
          workspaceProjectId: data.teamId,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    if (
      connectionCount > 1 ||
      (data.connectedTeamId && data.connectedTeamId !== data.teamId)
    ) {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: { name: true },
        props: { isRoot: true },
      });

      projectName = project?.name || null;
    }

    let settingsUrl: URL | null = null;

    try {
      settingsUrl = await WorkspaceConnectRequest.getSettingsUrl({
        workspaceType: WorkspaceType.Mattermost,
        projectId: data.projectId,
      });
    } catch (err) {
      logger.debug("Could not build the Mattermost settings link.");
      logger.debug(err);
    }

    const prompt: WorkspaceAnswer = WorkspaceActionAnswers.getConnectPrompt({
      workspaceType: WorkspaceType.Mattermost,
      purpose: data.purpose,
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
      },
      button: settingsUrl
        ? WorkspaceConnectButton.SettingsPage
        : WorkspaceConnectButton.None,
      projectName: projectName,
    });

    if (!settingsUrl) {
      return prompt.markdown;
    }

    return mdText`${prompt.markdown}

[${WorkspaceActionAnswers.getConnectButtonTitle(WorkspaceType.Mattermost)}](${settingsUrl.toString()})`.toString();
  }

  // What a refusal tells the presser: their reason, or that it could not be done.
  public static getRefusalMarkdown(err: unknown): string {
    if (err instanceof MattermostRefusal) {
      return err.markdown;
    }

    return mdText`${MattermostActions.getRefusalText(err)}`.toString();
  }

  // The same, as plain text: what a form shows under its fields.
  public static getRefusalText(err: unknown): string {
    if (err instanceof MattermostRefusal) {
      return err.markdown;
    }

    if (
      err instanceof NotAuthorizedException ||
      err instanceof BadDataException ||
      err instanceof PaymentRequiredException
    ) {
      return err.message;
    }

    logger.error("Could not act on a press in Mattermost.");
    logger.error(err);

    return `${ProductBrandingText.getProductName()} could not do that just now. Please try again.`;
  }

  // Acknowledge, Resolve, Mark as Ongoing or Mark as Complete, as the member.
  private static async changeStanding(data: {
    requester: MattermostRequester;
    spec: MattermostPressSpec;
    kind: WorkspacePendingActionKind;
    recordId: ObjectID;
  }): Promise<WorkspaceAnswer> {
    const details: RecordTypeDetails = RECORD_TYPES[data.spec.recordType];

    const event: WorkspaceEventRecord = await WorkspaceMemberActions.authorize({
      props: data.requester.props,
      modelType: details.stateTimelineModel,
      action: WorkspaceActionAnswers.getPendingActionPurpose({
        kind: data.kind,
        eventType: details.eventType,
        workspaceType: WorkspaceType.Mattermost,
      }),
      event: { type: details.eventType, id: data.recordId },
    });

    const standing: WorkspaceEventStanding =
      await WorkspaceMemberActions.getStanding(event);

    if (MattermostActions.isDoneAlready(data.spec.press, standing)) {
      /*
       * Acknowledge on an incident, an alert or an episode somebody else is
       * on answers the presser's own pages about it, as it does in Slack
       * and Microsoft Teams (OnCallPersonPageAnswer).
       */
      const pageRecordKind: OnCallPersonPageRecordKind | null =
        WorkspaceMemberActions.getPageRecordKind(event.type);

      return await WorkspaceActionAnswers.getAlreadyAnswer({
        event: event,
        press: LATE_PRESSES[data.spec.press] || WorkspaceLatePress.Acknowledge,
        answeredPageCount:
          data.spec.press === MattermostPress.Acknowledge && pageRecordKind
            ? await OnCallPersonPageAnswer.onAcknowledgePressed({
                kind: pageRecordKind,
                recordId: event.id,
                projectId: event.projectId,
                pressedByUserId: data.requester.userId,
                isResolved: standing.isResolved,
              })
            : 0,
      });
    }

    switch (data.spec.press) {
      case MattermostPress.Acknowledge:
        await WorkspaceMemberActions.acknowledge({
          event: event,
          props: data.requester.props,
        });
        break;
      case MattermostPress.Resolve:
      case MattermostPress.MarkAsComplete:
        await WorkspaceMemberActions.resolve({
          event: event,
          props: data.requester.props,
        });
        break;
      case MattermostPress.MarkAsOngoing:
        await WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
          event: event,
          props: data.requester.props,
        });
        break;
      default:
        break;
    }

    await MattermostActions.logPress({
      requester: data.requester,
      recordType: data.spec.recordType,
      recordId: data.recordId,
      buttonAction: MattermostActions.getLoggedAction(
        data.kind,
        details.loggedName,
      ),
    });

    return await WorkspaceActionAnswers.getDoneAnswer({
      event: event,
      kind: data.kind,
    });
  }

  private static isDoneAlready(
    press: MattermostPress,
    standing: WorkspaceEventStanding,
  ): boolean {
    switch (press) {
      case MattermostPress.Acknowledge:
        return standing.isAcknowledged;
      case MattermostPress.Resolve:
        return standing.isResolved || standing.isComplete;
      case MattermostPress.MarkAsOngoing:
        return standing.hasStarted;
      case MattermostPress.MarkAsComplete:
        return standing.isComplete;
      default:
        return false;
    }
  }

  // "acknowledge_incident", as the other chats' presses are logged.
  private static getLoggedAction(
    kind: WorkspacePendingActionKind,
    record: string,
  ): string {
    switch (kind) {
      case WorkspacePendingActionKind.Acknowledge:
        return `acknowledge_${record}`;
      case WorkspacePendingActionKind.Resolve:
        return `resolve_${record}`;
      case WorkspacePendingActionKind.MarkAsOngoing:
        return `mark_${record}_as_ongoing`;
      case WorkspacePendingActionKind.MarkAsComplete:
        return `mark_${record}_as_complete`;
      default:
        return `${kind.toLowerCase()}_${record}`;
    }
  }

  // A press, in the project's workspace logs. Never fails the press.
  private static async logPress(data: {
    requester: MattermostRequester;
    recordType: MattermostRecordType;
    recordId: ObjectID;
    buttonAction: string;
  }): Promise<void> {
    try {
      const logData: Parameters<
        typeof WorkspaceNotificationLogService.logButtonPressed
      >[0] = {
        projectId: data.requester.projectId,
        workspaceType: WorkspaceType.Mattermost,
        userId: data.requester.userId,
        buttonAction: data.buttonAction,
      };

      logData[RECORD_TYPES[data.recordType].logColumn] = data.recordId;

      if (data.requester.channelId) {
        logData.channelId = data.requester.channelId;
      }

      await WorkspaceNotificationLogService.logButtonPressed(logData, {
        isRoot: true,
      });
    } catch (err) {
      logger.error("Could not log a Mattermost button press.", {
        projectId: data.requester.projectId.toString(),
      });
      logger.error(err, { projectId: data.requester.projectId.toString() });
    }
  }

  // "add a note to this incident", for a form's connect prompt.
  private static getFormPurpose(spec: MattermostPressSpec): string {
    const noun: string = WorkspaceMemberActions.getNoun(
      RECORD_TYPES[spec.recordType].eventType,
    );

    switch (spec.press) {
      case MattermostPress.OpenNoteForm:
        return `add a note to this ${noun}`;
      case MattermostPress.OpenStateForm:
        return `change the state of this ${noun}`;
      case MattermostPress.OpenOnCallPolicyForm:
        return `execute an on-call policy for this ${noun}`;
      case MattermostPress.OpenSeverityForm:
        return `change the severity of this ${noun}`;
      default:
        return `act on this ${noun}`;
    }
  }

  private static getSubmitPurpose(spec: MattermostSubmitSpec): string {
    const noun: string = WorkspaceMemberActions.getNoun(
      RECORD_TYPES[spec.recordType].eventType,
    );

    switch (spec.submit) {
      case MattermostSubmit.Note:
        return `add a note to this ${noun}`;
      case MattermostSubmit.State:
        return `change the state of this ${noun}`;
      case MattermostSubmit.OnCallPolicy:
        return `execute an on-call policy for this ${noun}`;
      case MattermostSubmit.Severity:
        return `change the severity of this ${noun}`;
    }
  }

  // FORMS

  /*
   * The form a press opens, checked as its submission will be: somebody
   * who may not do what it asks is told so now, not after filling it in.
   */
  private static async getForm(data: {
    requester: MattermostRequester;
    spec: MattermostPressSpec;
    recordId: ObjectID;
  }): Promise<WorkspaceModalBlock> {
    const submitActionId: string = data.spec.submitActionId || "";
    const noun: string = WorkspaceMemberActions.getNoun(
      RECORD_TYPES[data.spec.recordType].eventType,
    );

    switch (data.spec.press) {
      case MattermostPress.OpenNoteForm: {
        const form: { title: string; blocks: Array<WorkspaceMessageBlock> } =
          await MattermostActions.getNoteForm({
            recordType: data.spec.recordType,
            recordId: data.recordId,
            projectId: data.requester.projectId,
          });

        return {
          _type: "WorkspaceModalBlock",
          title: form.title,
          submitButtonTitle: WORKSPACE_NOTE_FORM_TEXT.submit,
          cancelButtonTitle: WORKSPACE_NOTE_FORM_TEXT.cancel,
          actionId: submitActionId,
          actionValue: data.recordId.toString(),
          blocks: form.blocks,
        };
      }
      case MattermostPress.OpenStateForm: {
        const event: WorkspaceEventRecord =
          await WorkspaceMemberActions.authorize({
            props: data.requester.props,
            modelType: RECORD_TYPES[data.spec.recordType].stateTimelineModel,
            action: `change the state of this ${noun}`,
            event: {
              type: RECORD_TYPES[data.spec.recordType].eventType,
              id: data.recordId,
            },
          });

        const stateOptions: WorkspaceEventStateOptions =
          await WorkspaceMemberActions.findStateOptions({
            event: event,
            props: data.requester.props,
          });

        if (stateOptions.options.length === 0) {
          throw new MattermostRefusal(
            stateOptions.hasNoLaterState
              ? WorkspaceMemberActions.getNoLaterStateMessage(event.type)
              : mdText`No ${noun} states are available to you in this project. Ask a project admin for access to them.`.toString(),
          );
        }

        const dropdown: WorkspaceDropdownBlock = {
          _type: "WorkspaceDropdownBlock",
          label: "State",
          blockId: MATTERMOST_STATE_FIELD,
          placeholder: "Select a state",
          options: stateOptions.options.map(
            (state: WorkspaceEventStateOption) => {
              return { label: state.name, value: state.id.toString() };
            },
          ),
        };

        return {
          _type: "WorkspaceModalBlock",
          title: "Change State",
          submitButtonTitle: "Submit",
          cancelButtonTitle: "Cancel",
          actionId: submitActionId,
          actionValue: data.recordId.toString(),
          blocks: [dropdown],
        };
      }
      case MattermostPress.OpenOnCallPolicyForm: {
        await WorkspaceActionAuthorization.assertCanCreate({
          props: data.requester.props,
          modelType: OnCallDutyPolicyExecutionLog,
          action: `execute an on-call policy for this ${noun}`,
        });

        const policies: Array<OnCallDutyPolicy> =
          await WorkspaceActionAuthorization.findReadable({
            service: OnCallDutyPolicyService,
            props: data.requester.props,
            query: {
              projectId: data.requester.projectId,
              // Archived policies page no one, so they are not offered.
              isArchived: false,
            },
            select: {
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
          });

        const options: Array<{ label: string; value: string }> = policies
          .filter((policy: OnCallDutyPolicy): boolean => {
            return Boolean(policy._id && policy.name);
          })
          .map((policy: OnCallDutyPolicy) => {
            return { label: policy.name!, value: policy._id!.toString() };
          });

        if (options.length === 0) {
          throw new MattermostRefusal(
            mdText`${MattermostActions.NO_ON_CALL_POLICIES_MESSAGE}`.toString(),
          );
        }

        return {
          _type: "WorkspaceModalBlock",
          title: "Execute On-Call Policy",
          submitButtonTitle: "Submit",
          cancelButtonTitle: "Cancel",
          actionId: submitActionId,
          actionValue: data.recordId.toString(),
          blocks: [
            {
              _type: "WorkspaceDropdownBlock",
              label: "On-Call Policy",
              blockId: MATTERMOST_ON_CALL_POLICY_FIELD,
              placeholder: "Select an on-call policy",
              options: options,
            } as WorkspaceDropdownBlock,
          ],
        };
      }
      case MattermostPress.OpenSeverityForm: {
        const incident: WorkspaceIncidentForForm =
          await WorkspaceIncidentActions.authorizeForForm({
            incidentId: data.recordId,
            props: data.requester.props,
            check: SEVERITY_CHECK,
          });

        const choices: Array<WorkspaceIncidentChoice> =
          await WorkspaceIncidentActions.getSeverityChoices({
            projectId: data.requester.projectId,
            props: data.requester.props,
          });

        if (choices.length === 0) {
          throw new MattermostRefusal(
            mdText`${WorkspaceIncidentActions.getNoSeveritiesMessage()}`.toString(),
          );
        }

        const currentId: ObjectID | null =
          await WorkspaceIncidentActions.getSeverityId({
            event: incident.event,
            props: data.requester.props,
          });

        return {
          _type: "WorkspaceModalBlock",
          title: WORKSPACE_INCIDENT_FORM_TEXT.severityTitle,
          submitButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.save,
          cancelButtonTitle: WORKSPACE_INCIDENT_FORM_TEXT.cancel,
          actionId: submitActionId,
          actionValue: data.recordId.toString(),
          blocks: [
            {
              _type: "WorkspaceDropdownBlock",
              label: "Severity",
              blockId: MATTERMOST_SEVERITY_FIELD,
              placeholder: WORKSPACE_INCIDENT_FORM_TEXT.severityPlaceholder,
              options: choices.map((choice: WorkspaceIncidentChoice) => {
                return { label: choice.name, value: choice.id.toString() };
              }),
              ...(currentId ? { initialValue: currentId.toString() } : {}),
            } as WorkspaceDropdownBlock,
          ],
        };
      }
      default:
        throw new MattermostRefusal(
          MattermostActions.UNSUPPORTED_PRESS_MESSAGE,
        );
    }
  }

  /*
   * A note's form: an incident's or an incident episode's as Slack shows it
   * (WorkspaceNoteForm - public or private, or only private on a private
   * record); a scheduled maintenance event's with public or private; an
   * alert's or an alert episode's, which take private notes only, with the
   * note alone.
   */
  private static async getNoteForm(data: {
    recordType: MattermostRecordType;
    recordId: ObjectID;
    projectId: ObjectID;
  }): Promise<{ title: string; blocks: Array<WorkspaceMessageBlock> }> {
    const noteArea: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: WORKSPACE_NOTE_FORM_TEXT.noteLabel,
      blockId: MATTERMOST_NOTE_FIELD,
      placeholder: WORKSPACE_NOTE_FORM_TEXT.notePlaceholder,
      description: WORKSPACE_NOTE_FORM_TEXT.noteDescription,
    };

    if (
      data.recordType === MattermostRecordType.Incident ||
      data.recordType === MattermostRecordType.IncidentEpisode
    ) {
      const kind: PrivateRecordKind =
        data.recordType === MattermostRecordType.Incident
          ? PrivateRecordKind.Incident
          : PrivateRecordKind.IncidentEpisode;

      return WorkspaceNoteForm.getSlackForm({
        kind: kind,
        isPrivateRecord: await WorkspaceNoteForm.isPrivateRecord({
          kind: kind,
          recordId: data.recordId,
          projectId: data.projectId,
        }),
        isPublicNoteApprovalRequired:
          await WorkspaceHeldPublicNote.isApprovalRequired({
            type: RECORD_TYPES[data.recordType].eventType,
            projectId: data.projectId,
          }),
      });
    }

    if (data.recordType === MattermostRecordType.ScheduledMaintenance) {
      return {
        title: WORKSPACE_NOTE_FORM_TEXT.title,
        blocks: [
          {
            _type: "WorkspaceDropdownBlock",
            label: WORKSPACE_NOTE_FORM_TEXT.noteTypeLabel,
            blockId: MATTERMOST_NOTE_TYPE_FIELD,
            placeholder: WORKSPACE_NOTE_FORM_TEXT.noteTypePlaceholder,
            options: [
              {
                label: WorkspaceNoteForm.getPublicOption(
                  await WorkspaceHeldPublicNote.isApprovalRequired({
                    type: WorkspaceEventType.ScheduledMaintenance,
                    projectId: data.projectId,
                  }),
                ),
                value: WorkspaceNoteFormType.Public,
              },
              {
                label: WorkspaceNoteForm.getPrivateOption(
                  SCHEDULED_MAINTENANCE_NOTE_NOUN,
                ),
                value: WorkspaceNoteFormType.Private,
              },
            ],
          } as WorkspaceDropdownBlock,
          noteArea,
        ],
      };
    }

    return {
      title: "Add Private Note",
      blocks: [noteArea],
    };
  }

  private static async submitNote(data: {
    requester: MattermostRequester;
    spec: MattermostSubmitSpec;
    recordId: ObjectID;
    submission: JSONObject;
  }): Promise<MattermostDialogAnswer> {
    const note: string =
      typeof data.submission[MATTERMOST_NOTE_FIELD] === "string"
        ? (data.submission[MATTERMOST_NOTE_FIELD] as string).trim()
        : "";

    if (!note) {
      return { errors: { [MATTERMOST_NOTE_FIELD]: "Type a note." } };
    }

    if (note.length > MAX_NOTE_LENGTH) {
      return {
        errors: {
          [MATTERMOST_NOTE_FIELD]: `A note may have at most ${MAX_NOTE_LENGTH} characters.`,
        },
      };
    }

    const submittedNoteType: unknown =
      data.submission[MATTERMOST_NOTE_TYPE_FIELD];

    if (
      submittedNoteType !== undefined &&
      submittedNoteType !== null &&
      submittedNoteType !== WorkspaceNoteFormType.Public &&
      submittedNoteType !== WorkspaceNoteFormType.Private
    ) {
      return {
        errors: { [MATTERMOST_NOTE_TYPE_FIELD]: "Pick a note type." },
      };
    }

    const isPublic: boolean = await MattermostActions.isPublicNote({
      recordType: data.spec.recordType,
      recordId: data.recordId,
      projectId: data.requester.projectId,
      submittedNoteType: submittedNoteType,
    });

    const noun: string = WorkspaceMemberActions.getNoun(
      RECORD_TYPES[data.spec.recordType].eventType,
    );

    const props: DatabaseCommonInteractionProps = data.requester.props;
    const projectId: ObjectID = data.requester.projectId;

    // The public note written, if one was: held for approval, it is answered below.
    let publicNote:
      | IncidentPublicNote
      | IncidentEpisodePublicNote
      | ScheduledMaintenancePublicNote
      | null = null;

    switch (data.spec.recordType) {
      case MattermostRecordType.Incident:
        await WorkspaceActionAuthorization.assertCanCreate({
          props: props,
          modelType: isPublic ? IncidentPublicNote : IncidentInternalNote,
          action: `add a ${isPublic ? "public" : "private"} note to this ${noun}`,
          resources: [{ service: IncidentService, id: data.recordId }],
        });

        if (isPublic) {
          publicNote = await IncidentPublicNoteService.addNote({
            incidentId: data.recordId,
            projectId: projectId,
            note: note,
            props: props,
          });
        } else {
          await IncidentInternalNoteService.addNote({
            incidentId: data.recordId,
            projectId: projectId,
            note: note,
            props: props,
          });
        }
        break;
      case MattermostRecordType.IncidentEpisode:
        await WorkspaceActionAuthorization.assertCanCreate({
          props: props,
          modelType: isPublic
            ? IncidentEpisodePublicNote
            : IncidentEpisodeInternalNote,
          action: `add a ${isPublic ? "public" : "private"} note to this ${noun}`,
          resources: [{ service: IncidentEpisodeService, id: data.recordId }],
        });

        if (isPublic) {
          publicNote = await IncidentEpisodePublicNoteService.addNote({
            incidentEpisodeId: data.recordId,
            projectId: projectId,
            note: note,
            props: props,
          });
        } else {
          await IncidentEpisodeInternalNoteService.addNote({
            incidentEpisodeId: data.recordId,
            projectId: projectId,
            note: note,
            props: props,
          });
        }
        break;
      case MattermostRecordType.ScheduledMaintenance:
        await WorkspaceActionAuthorization.assertCanCreate({
          props: props,
          modelType: isPublic
            ? ScheduledMaintenancePublicNote
            : ScheduledMaintenanceInternalNote,
          action: `add a ${isPublic ? "public" : "private"} note to this ${noun}`,
          resources: [
            { service: ScheduledMaintenanceService, id: data.recordId },
          ],
        });

        if (isPublic) {
          publicNote = await ScheduledMaintenancePublicNoteService.addNote({
            scheduledMaintenanceId: data.recordId,
            projectId: projectId,
            note: note,
            props: props,
          });
        } else {
          await ScheduledMaintenanceInternalNoteService.addNote({
            scheduledMaintenanceId: data.recordId,
            projectId: projectId,
            note: note,
            props: props,
          });
        }
        break;
      case MattermostRecordType.Alert:
        await WorkspaceActionAuthorization.assertCanCreate({
          props: props,
          modelType: AlertInternalNote,
          action: `add a note to this ${noun}`,
          resources: [{ service: AlertService, id: data.recordId }],
        });

        await AlertInternalNoteService.addNote({
          alertId: data.recordId,
          projectId: projectId,
          note: note,
          props: props,
        });
        break;
      case MattermostRecordType.AlertEpisode:
        await WorkspaceActionAuthorization.assertCanCreate({
          props: props,
          modelType: AlertEpisodeInternalNote,
          action: `add a note to this ${noun}`,
          resources: [{ service: AlertEpisodeService, id: data.recordId }],
        });

        await AlertEpisodeInternalNoteService.addNote({
          alertEpisodeId: data.recordId,
          projectId: projectId,
          note: note,
          props: props,
        });
        break;
    }

    await MattermostActions.logPress({
      requester: data.requester,
      recordType: data.spec.recordType,
      recordId: data.recordId,
      buttonAction: `add_${RECORD_TYPES[data.spec.recordType].loggedName}_note`,
    });

    await MattermostActions.answerHeldNote({
      requester: data.requester,
      event: {
        type: RECORD_TYPES[data.spec.recordType].eventType,
        id: data.recordId,
      },
      note: publicNote,
    });

    return {};
  }

  /*
   * A public note held for approval is posted to no channel until it is
   * approved, so the person who sent it is told - in the channel they sent
   * it from, in a post only they see - that it waits, and for whom
   * (WorkspaceHeldPublicNote). The note is written by now: an answer that
   * cannot be posted is logged, and the form still closes as done.
   */
  private static async answerHeldNote(data: {
    requester: MattermostRequester;
    event: WorkspaceEvent;
    note: DatabaseBaseModel | null;
  }): Promise<void> {
    try {
      const answer: WorkspaceAnswer | null =
        await WorkspaceHeldPublicNote.getAnswerForAddedNote({
          event: data.event,
          note: data.note,
          props: data.requester.props,
        });

      if (!answer || !data.requester.channelId) {
        return;
      }

      await MattermostUtil.postEphemeral({
        authToken: data.requester.authToken,
        userId: data.requester.mattermostUserId,
        channelId: data.requester.channelId,
        markdown: answer.markdown,
      });
    } catch (err) {
      logger.error(
        "Could not tell a Mattermost member their public note waits for approval.",
      );
      logger.error(err);
    }
  }

  /*
   * Whether a note is written as a public note: asked for as one, on a
   * record that takes them. An incident or an episode that is private now
   * takes private notes only (WorkspaceNoteForm.getSubmittedNote); an alert
   * or an alert episode takes nothing but private notes.
   */
  private static async isPublicNote(data: {
    recordType: MattermostRecordType;
    recordId: ObjectID;
    projectId: ObjectID;
    submittedNoteType: unknown;
  }): Promise<boolean> {
    if (
      data.recordType === MattermostRecordType.Incident ||
      data.recordType === MattermostRecordType.IncidentEpisode
    ) {
      const submitted: WorkspaceSubmittedNote | null =
        await WorkspaceNoteForm.getSubmittedNote({
          submittedNoteType: data.submittedNoteType,
          kind:
            data.recordType === MattermostRecordType.Incident
              ? PrivateRecordKind.Incident
              : PrivateRecordKind.IncidentEpisode,
          recordId: data.recordId,
          projectId: data.projectId,
        });

      return submitted?.noteType === WorkspaceNoteType.Public;
    }

    if (data.recordType === MattermostRecordType.ScheduledMaintenance) {
      return data.submittedNoteType === WorkspaceNoteFormType.Public;
    }

    return false;
  }

  private static async submitState(data: {
    requester: MattermostRequester;
    spec: MattermostSubmitSpec;
    recordId: ObjectID;
    submission: JSONObject;
  }): Promise<MattermostDialogAnswer> {
    const stateId: unknown = data.submission[MATTERMOST_STATE_FIELD];

    if (typeof stateId !== "string" || !ObjectID.isValidUUID(stateId)) {
      return { errors: { [MATTERMOST_STATE_FIELD]: "Pick a state." } };
    }

    const details: RecordTypeDetails = RECORD_TYPES[data.spec.recordType];

    const event: WorkspaceEventRecord = await WorkspaceMemberActions.authorize({
      props: data.requester.props,
      modelType: details.stateTimelineModel,
      action: `change the state of this ${WorkspaceMemberActions.getNoun(details.eventType)}`,
      event: { type: details.eventType, id: data.recordId },
    });

    await WorkspaceMemberActions.changeState({
      event: event,
      stateId: new ObjectID(stateId),
      props: data.requester.props,
    });

    await MattermostActions.logPress({
      requester: data.requester,
      recordType: data.spec.recordType,
      recordId: data.recordId,
      buttonAction: `change_${details.loggedName}_state`,
    });

    return {};
  }

  private static async submitOnCallPolicy(data: {
    requester: MattermostRequester;
    spec: MattermostSubmitSpec;
    recordId: ObjectID;
    submission: JSONObject;
  }): Promise<MattermostDialogAnswer> {
    const policyId: unknown = data.submission[MATTERMOST_ON_CALL_POLICY_FIELD];

    if (typeof policyId !== "string" || !ObjectID.isValidUUID(policyId)) {
      return {
        errors: {
          [MATTERMOST_ON_CALL_POLICY_FIELD]: "Pick an on-call policy.",
        },
      };
    }

    const details: RecordTypeDetails = RECORD_TYPES[data.spec.recordType];
    const noun: string = WorkspaceMemberActions.getNoun(details.eventType);

    await WorkspaceActionAuthorization.assertCanCreate({
      props: data.requester.props,
      modelType: OnCallDutyPolicyExecutionLog,
      action: `execute an on-call policy for this ${noun}`,
      resources: [
        { service: OnCallDutyPolicyService, id: new ObjectID(policyId) },
      ],
    });

    const event: WorkspaceEventRecord = await WorkspaceMemberActions.authorize({
      props: data.requester.props,
      modelType: OnCallDutyPolicyExecutionLog,
      action: `execute an on-call policy for this ${noun}`,
      event: { type: details.eventType, id: data.recordId },
    });

    await WorkspaceMemberActions.executeOnCallPolicy({
      event: event,
      onCallDutyPolicyId: new ObjectID(policyId),
      props: data.requester.props,
    });

    await MattermostActions.logPress({
      requester: data.requester,
      recordType: data.spec.recordType,
      recordId: data.recordId,
      buttonAction: `execute_${details.loggedName}_on_call_policy`,
    });

    return {};
  }

  private static async submitSeverity(data: {
    requester: MattermostRequester;
    recordId: ObjectID;
    submission: JSONObject;
  }): Promise<MattermostDialogAnswer> {
    const severityId: unknown = data.submission[MATTERMOST_SEVERITY_FIELD];

    if (typeof severityId !== "string" || !ObjectID.isValidUUID(severityId)) {
      return { errors: { [MATTERMOST_SEVERITY_FIELD]: "Pick a severity." } };
    }

    const incident: WorkspaceIncidentForForm =
      await WorkspaceIncidentActions.authorizeForForm({
        incidentId: data.recordId,
        props: data.requester.props,
        check: SEVERITY_CHECK,
      });

    await WorkspaceIncidentActions.changeSeverity({
      event: incident.event,
      severityId: new ObjectID(severityId),
      props: data.requester.props,
    });

    await MattermostActions.logPress({
      requester: data.requester,
      recordType: MattermostRecordType.Incident,
      recordId: data.recordId,
      buttonAction: "change_incident_severity",
    });

    return {};
  }
}
