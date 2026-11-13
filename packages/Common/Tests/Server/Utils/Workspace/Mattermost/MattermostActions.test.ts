import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import MattermostActions, {
  MATTERMOST_NOTE_FIELD,
  MATTERMOST_NOTE_TYPE_FIELD,
  MATTERMOST_ON_CALL_POLICY_FIELD,
  MATTERMOST_SEVERITY_FIELD,
  MATTERMOST_STATE_FIELD,
  MattermostDialogAnswer,
  MattermostPressAnswer,
} from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActions";
import MattermostActionContext from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActionContext";
import MattermostUtil from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostConnection from "../../../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import {
  MATTERMOST_PRESS_ACTIONS,
  MATTERMOST_SUBMIT_ACTIONS,
} from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActionTypes";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "../../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceActionAnswers from "../../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceConnectRequest from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceNoteForm from "../../../../../Server/Utils/Workspace/WorkspaceNoteForm";
import WorkspaceIncidentActions from "../../../../../Server/Utils/Workspace/WorkspaceIncidentActions";
import OnCallPersonPageAnswer from "../../../../../Server/Utils/OnCall/OnCallPersonPageAnswer";
import IncidentService from "../../../../../Server/Services/IncidentService";
import AlertService from "../../../../../Server/Services/AlertService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import IncidentPublicNoteService from "../../../../../Server/Services/IncidentPublicNoteService";
import IncidentInternalNoteService from "../../../../../Server/Services/IncidentInternalNoteService";
import AlertInternalNoteService from "../../../../../Server/Services/AlertInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import IncidentEpisodePublicNoteService from "../../../../../Server/Services/IncidentEpisodePublicNoteService";
import AlertEpisodeService from "../../../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../../../Server/Services/IncidentEpisodeService";
import PublicNoteApprovalEngine from "../../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import { PublicNoteApprovalWaitingFor } from "../../../../../Server/Utils/Notes/PublicNoteApprovalFeed";
import PublicNoteApprovalPolicy from "../../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import AlertStateTimeline from "../../../../../Models/DatabaseModels/AlertStateTimeline";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import {
  WorkspaceDropdownBlock,
  WorkspaceModalBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

/*
 * A press of a button on a Mattermost message, and the submission of a form
 * one opened, acted on in order: the context it carries checked, the record
 * and its project found, the presser's connected account read, their
 * membership checked, and the action done as them - by the same code a
 * press in Slack or Microsoft Teams runs, answered with the same words.
 */

const TEAM_ID: string = "t".repeat(26);
const OTHER_TEAM_ID: string = "o".repeat(26);
const MATTERMOST_USER_ID: string = "u".repeat(26);
const CHANNEL_ID: string = "c".repeat(26);
const AUTH_TOKEN: string = MattermostConnection.toAuthToken({
  serverUrl: "https://chat.example.com",
  accessToken: "abcdefghijklmnopqrstuvwxyz",
  teamId: TEAM_ID,
  botUserId: "b".repeat(26),
});

describe("MattermostActions", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let recordId: ObjectID;
  let props: DatabaseCommonInteractionProps;
  let event: WorkspaceEventRecord;

  let findIncident: jest.SpyInstance;
  let findProjectConnection: jest.SpyInstance;
  let findUserLink: jest.SpyInstance;
  let getMemberProps: jest.SpyInstance;
  let authorize: jest.SpyInstance;
  let getStanding: jest.SpyInstance;
  let acknowledge: jest.SpyInstance;
  let resolve: jest.SpyInstance;
  let showModal: jest.SpyInstance;
  let logPress: jest.SpyInstance;

  function press(
    actionId: string,
    overrides: JSONObject = {},
    value?: string,
  ): JSONObject {
    return {
      user_id: MATTERMOST_USER_ID,
      team_id: TEAM_ID,
      channel_id: CHANNEL_ID,
      post_id: "p".repeat(26),
      trigger_id: "trigger-1",
      context: MattermostActionContext.toContext({
        teamId: TEAM_ID,
        actions: [{ actionId: actionId, value: value ?? recordId.toString() }],
      }),
      ...overrides,
    };
  }

  function submission(
    actionId: string,
    values: JSONObject,
    overrides: JSONObject = {},
  ): JSONObject {
    return {
      type: "dialog_submission",
      callback_id: actionId,
      user_id: MATTERMOST_USER_ID,
      team_id: TEAM_ID,
      channel_id: CHANNEL_ID,
      state: MattermostActionContext.toDialogState({
        teamId: TEAM_ID,
        actionId: actionId,
        value: recordId.toString(),
      }),
      submission: values,
      cancelled: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    recordId = ObjectID.generate();
    props = {
      userId: userId,
      tenantId: projectId,
    } as unknown as DatabaseCommonInteractionProps;
    event = {
      type: WorkspaceEventType.Incident,
      id: recordId,
      projectId: projectId,
      currentStateId: ObjectID.generate(),
      number: 42,
      numberWithPrefix: "INC-42",
    };

    findIncident = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue({ projectId: projectId } as never);
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue({ projectId: projectId } as never);
    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue({ projectId: projectId } as never);

    findProjectConnection = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockResolvedValue({
        authToken: AUTH_TOKEN,
        workspaceProjectId: TEAM_ID,
      } as never);
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    findUserLink = jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue({ userId: userId } as never);

    getMemberProps = jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(props);

    authorize = jest
      .spyOn(WorkspaceMemberActions, "authorize")
      .mockResolvedValue(event);
    getStanding = jest
      .spyOn(WorkspaceMemberActions, "getStanding")
      .mockResolvedValue({
        isAcknowledged: false,
        isResolved: false,
        hasStarted: false,
        isComplete: false,
      });
    acknowledge = jest
      .spyOn(WorkspaceMemberActions, "acknowledge")
      .mockResolvedValue(undefined);
    resolve = jest
      .spyOn(WorkspaceMemberActions, "resolve")
      .mockResolvedValue(undefined);

    jest.spyOn(WorkspaceActionAnswers, "getDoneAnswer").mockResolvedValue({
      markdown: "✅ **INC-42** acknowledged by you.",
      text: "INC-42 acknowledged",
    });
    jest.spyOn(WorkspaceActionAnswers, "getAlreadyAnswer").mockResolvedValue({
      markdown: "INC-42 was acknowledged already.",
      text: "INC-42 was acknowledged already",
    });
    jest
      .spyOn(OnCallPersonPageAnswer, "onAcknowledgePressed")
      .mockResolvedValue(0);

    jest
      .spyOn(WorkspaceConnectRequest, "getSettingsUrl")
      .mockResolvedValue(
        URL.fromString(
          `https://oneuptime.com/dashboard/${projectId.toString()}/user-settings/mattermost-integration`,
        ),
      );

    showModal = jest
      .spyOn(MattermostUtil, "showModalToUser")
      .mockResolvedValue(undefined);

    logPress = jest
      .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
      .mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("what a press must carry", () => {
    test("a context OneUptime did not sign does nothing, and says so", async () => {
      const body: JSONObject = press(SlackActionType.AcknowledgeIncident);
      (body["context"] as JSONObject)["signature"] = "forged";

      const answer: MattermostPressAnswer =
        await MattermostActions.handlePress(body);

      expect(answer.ephemeral_text).toBe(
        MattermostActions.UNVERIFIED_PRESS_MESSAGE,
      );
      expect(findIncident).not.toHaveBeenCalled();
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("a signed context replayed from another team does nothing", async () => {
      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident, { team_id: OTHER_TEAM_ID }),
      );

      expect(answer.ephemeral_text).toBe(
        MattermostActions.UNVERIFIED_PRESS_MESSAGE,
      );
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("a button Mattermost has no action for does nothing", async () => {
      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.ViewAssignIncidentRole),
      );

      expect(answer.ephemeral_text).toBe(
        MattermostActions.UNSUPPORTED_PRESS_MESSAGE,
      );
      expect(findIncident).not.toHaveBeenCalled();
    });

    test("a press with no Mattermost user does nothing", async () => {
      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident, { user_id: "../admin" }),
      );

      expect(answer.ephemeral_text).toBe(
        MattermostActions.UNVERIFIED_PRESS_MESSAGE,
      );
      expect(findIncident).not.toHaveBeenCalled();
    });

    test("a value that is no record id does nothing", async () => {
      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident, {}, "not-an-id"),
      );

      expect(answer.ephemeral_text).toBe(
        MattermostActions.UNVERIFIED_PRESS_MESSAGE,
      );
      expect(findIncident).not.toHaveBeenCalled();
    });
  });

  describe("whose press it is", () => {
    test("a record that no longer exists is said so", async () => {
      findIncident.mockResolvedValue(null);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toBe(
        "This incident no longer exists in OneUptime.",
      );
    });

    test("the record's project must be connected to Mattermost", async () => {
      findProjectConnection.mockResolvedValue(null);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      /*
       * Read by the project alone: which teams it works in is the
       * connection's to say (MattermostTeams), below.
       */
      expect(findProjectConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            projectId: projectId,
            workspaceType: WorkspaceType.Mattermost,
          },
        }),
      );
      expect(answer.ephemeral_text).toContain(
        "no longer connected to the OneUptime project",
      );
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("the record's project must work in the team the press came from", async () => {
      findProjectConnection.mockResolvedValue({
        authToken: AUTH_TOKEN,
        workspaceProjectId: OTHER_TEAM_ID,
        miscData: {
          teamId: OTHER_TEAM_ID,
          teams: [
            { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
          ],
          teamsReadAt: new Date().toISOString(),
        },
      } as never);
      const listTeams: jest.SpyInstance = jest
        .spyOn(MattermostUtil, "getTeamsOfBot")
        .mockResolvedValue([
          { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
        ]);
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "updateMattermostTeams")
        .mockResolvedValue(undefined);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toBe(
        "This Mattermost team is no longer connected to the OneUptime project this message is from.",
      );
      // Asked once whether the bot was added to the team since.
      expect(listTeams).toHaveBeenCalledTimes(1);
      expect(findUserLink).not.toHaveBeenCalled();
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("the presser's account is read in the record's project, as a Mattermost account", async () => {
      await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(findUserLink).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            projectId: projectId,
            workspaceType: WorkspaceType.Mattermost,
            workspaceUserId: MATTERMOST_USER_ID,
          },
        }),
      );
    });

    test("an account not connected is asked to connect, with a link to where they do", async () => {
      findUserLink.mockResolvedValue(null);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toContain(
        "Connect your Mattermost account to acknowledge this incident.",
      );
      expect(answer.ephemeral_text).toContain(
        `[Connect Mattermost account](https://oneuptime.com/dashboard/${projectId.toString()}/user-settings/mattermost-integration)`,
      );
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("in a team connected to more than one project, the prompt names the project", async () => {
      findUserLink.mockResolvedValue(null);
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "countBy")
        .mockResolvedValue(new PositiveNumber(2));
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue({ name: "Production" } as never);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toContain(
        "Connect your Mattermost account in Production to acknowledge this incident.",
      );
    });

    test("somebody no longer in the project is told why", async () => {
      getMemberProps.mockRejectedValue(
        new NotAuthorizedException("You are not a member of this project."),
      );

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toBe(
        "You are not a member of this project.",
      );
      expect(acknowledge).not.toHaveBeenCalled();
    });
  });

  /*
   * One project, several teams of its Mattermost server (MattermostTeams):
   * a press is acted on from any team the project's bot is a member of -
   * signed, as every press is, for the team it came from.
   */
  describe("a project in several teams of its server", () => {
    const LISTED_NOW: string = new Date().toISOString();
    // Older than the ten minutes the teams a server listed are used for.
    const LISTED_LONG_AGO: string = new Date(
      Date.now() - 60 * 60 * 1000,
    ).toISOString();

    let listTeams: jest.SpyInstance;
    let keepTeams: jest.SpyInstance;

    function pressFrom(teamId: string, actionId: string): JSONObject {
      return press(actionId, {
        team_id: teamId,
        context: MattermostActionContext.toContext({
          teamId: teamId,
          actions: [{ actionId: actionId, value: recordId.toString() }],
        }),
      });
    }

    function connectedWith(miscData: JSONObject): void {
      findProjectConnection.mockResolvedValue({
        authToken: AUTH_TOKEN,
        workspaceProjectId: TEAM_ID,
        miscData: {
          teamId: TEAM_ID,
          teamName: "engineering",
          ...miscData,
        },
      } as never);
    }

    beforeEach(() => {
      listTeams = jest.spyOn(MattermostUtil, "getTeamsOfBot");
      keepTeams = jest
        .spyOn(WorkspaceProjectAuthTokenService, "updateMattermostTeams")
        .mockResolvedValue(undefined);
    });

    test("a press from another team the bot is in is acted on, nothing asked of the server", async () => {
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
          { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
        ],
        teamsReadAt: LISTED_NOW,
      });

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        pressFrom(OTHER_TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      expect(acknowledge).toHaveBeenCalledWith({ event: event, props: props });
      expect(answer.ephemeral_text).toBe("✅ **INC-42** acknowledged by you.");
      expect(listTeams).not.toHaveBeenCalled();
    });

    test("a press from a team the bot was added to since its teams were listed: asked once, then acted on", async () => {
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
        ],
        teamsReadAt: LISTED_NOW,
      });
      listTeams.mockResolvedValue([
        { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
        { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
      ]);

      await MattermostActions.handlePress(
        pressFrom(OTHER_TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      expect(listTeams).toHaveBeenCalledTimes(1);
      // Kept for the next press.
      expect(keepTeams).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: projectId,
          workspaceProjectId: TEAM_ID,
          teams: [
            { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
            { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
          ],
        }),
      );
      expect(acknowledge).toHaveBeenCalledTimes(1);
    });

    test("a press from a team the bot is not in is refused, the server asked once", async () => {
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
        ],
        teamsReadAt: LISTED_NOW,
      });
      listTeams.mockResolvedValue([
        { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
      ]);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        pressFrom(OTHER_TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toBe(
        "This Mattermost team is no longer connected to the OneUptime project this message is from.",
      );
      expect(listTeams).toHaveBeenCalledTimes(1);
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("a server that does not answer leaves a press from a team never listed refused, never failed", async () => {
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
        ],
        teamsReadAt: LISTED_NOW,
      });
      listTeams.mockRejectedValue(new Error("connect ECONNREFUSED"));

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        pressFrom(OTHER_TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toBe(
        "This Mattermost team is no longer connected to the OneUptime project this message is from.",
      );
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("a press from another team, its teams listed long ago: asked again, and acted on while the bot is still in it", async () => {
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
          { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
        ],
        teamsReadAt: LISTED_LONG_AGO,
      });
      listTeams.mockResolvedValue([
        { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
        { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
      ]);

      await MattermostActions.handlePress(
        pressFrom(OTHER_TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      expect(listTeams).toHaveBeenCalledTimes(1);
      expect(acknowledge).toHaveBeenCalledTimes(1);
    });

    test("REGRESSION: a team the bot was taken out of: its buttons stop working once its teams are listed again", async () => {
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
          { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
        ],
        teamsReadAt: LISTED_LONG_AGO,
      });
      listTeams.mockResolvedValue([
        { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
      ]);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        pressFrom(OTHER_TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toBe(
        "This Mattermost team is no longer connected to the OneUptime project this message is from.",
      );
      expect(listTeams).toHaveBeenCalledTimes(1);
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("presses from the default team and the team it was connected to never ask the server, however old the teams", async () => {
      connectedWith({
        teamId: OTHER_TEAM_ID,
        teamName: "support",
        teams: [{ id: OTHER_TEAM_ID, name: "support", displayName: "Support" }],
        teamsReadAt: LISTED_LONG_AGO,
      });
      listTeams.mockResolvedValue([
        { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
      ]);

      await MattermostActions.handlePress(
        pressFrom(TEAM_ID, SlackActionType.AcknowledgeIncident),
      );
      await MattermostActions.handlePress(
        pressFrom(OTHER_TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      expect(acknowledge).toHaveBeenCalledTimes(2);
      expect(listTeams).not.toHaveBeenCalled();
    });

    test("a press from the team the project was connected to still acts once another team is the default", async () => {
      connectedWith({
        teamId: OTHER_TEAM_ID,
        teamName: "support",
        teams: [{ id: OTHER_TEAM_ID, name: "support", displayName: "Support" }],
        teamsReadAt: LISTED_NOW,
      });

      await MattermostActions.handlePress(
        pressFrom(TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      expect(acknowledge).toHaveBeenCalledTimes(1);
      expect(listTeams).not.toHaveBeenCalled();
    });

    test("the form a press opens is opened in the team the press came from", async () => {
      jest.spyOn(WorkspaceNoteForm, "isPrivateRecord").mockResolvedValue(false);
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
          { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
        ],
        teamsReadAt: LISTED_NOW,
      });

      await MattermostActions.handlePress(
        pressFrom(OTHER_TEAM_ID, SlackActionType.ViewAddIncidentNote),
      );

      expect(showModal).toHaveBeenCalledTimes(1);
      expect(showModal.mock.calls[0][0]).toMatchObject({
        authToken: AUTH_TOKEN,
        teamId: OTHER_TEAM_ID,
      });
    });

    test("a form sent from another team the bot is in is acted on", async () => {
      jest.spyOn(WorkspaceNoteForm, "isPrivateRecord").mockResolvedValue(false);
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined);
      const addPublic: jest.SpyInstance = jest
        .spyOn(IncidentPublicNoteService, "addNote")
        .mockResolvedValue({} as never);
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
          { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
        ],
        teamsReadAt: LISTED_NOW,
      });

      await MattermostActions.handleDialogSubmission(
        submission(
          SlackActionType.SubmitIncidentNote,
          {
            [MATTERMOST_NOTE_FIELD]: "Rolled back.",
            [MATTERMOST_NOTE_TYPE_FIELD]: "public",
          },
          {
            team_id: OTHER_TEAM_ID,
            state: MattermostActionContext.toDialogState({
              teamId: OTHER_TEAM_ID,
              actionId: SlackActionType.SubmitIncidentNote,
              value: recordId.toString(),
            }),
          },
        ),
      );

      expect(addPublic).toHaveBeenCalledWith(
        expect.objectContaining({ incidentId: recordId, note: "Rolled back." }),
      );
    });

    test("in another team than the one it was connected to, the connect prompt names the project", async () => {
      findUserLink.mockResolvedValue(null);
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue({ name: "Production" } as never);
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
          { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
        ],
        teamsReadAt: LISTED_NOW,
      });

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        pressFrom(OTHER_TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      // Another project may be connected to that team: which one is said.
      expect(answer.ephemeral_text).toContain(
        "Connect your Mattermost account in Production to acknowledge this incident.",
      );
    });

    test("in the team it was connected to, alone there, the prompt names no project", async () => {
      findUserLink.mockResolvedValue(null);
      connectedWith({
        teams: [
          { id: TEAM_ID, name: "engineering", displayName: "Engineering" },
          { id: OTHER_TEAM_ID, name: "support", displayName: "Support" },
        ],
        teamsReadAt: LISTED_NOW,
      });

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        pressFrom(TEAM_ID, SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toContain(
        "Connect your Mattermost account to acknowledge this incident.",
      );
    });
  });

  describe("presses that change where a record stands", () => {
    test("Acknowledge acknowledges, as the member, and answers that it did", async () => {
      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(authorize).toHaveBeenCalledWith({
        props: props,
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        event: { type: WorkspaceEventType.Incident, id: recordId },
      });
      expect(acknowledge).toHaveBeenCalledWith({ event: event, props: props });
      expect(answer.ephemeral_text).toBe("✅ **INC-42** acknowledged by you.");
    });

    test("the press is logged against the record, with the channel it was pressed in", async () => {
      await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(logPress).toHaveBeenCalledWith(
        {
          projectId: projectId,
          workspaceType: WorkspaceType.Mattermost,
          userId: userId,
          buttonAction: "acknowledge_incident",
          incidentId: recordId,
          channelId: CHANNEL_ID,
        },
        { isRoot: true },
      );
    });

    test("Acknowledge on an acknowledged incident says so, and changes nothing", async () => {
      getStanding.mockResolvedValue({
        isAcknowledged: true,
        isResolved: false,
        hasStarted: false,
        isComplete: false,
      });

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(acknowledge).not.toHaveBeenCalled();
      expect(OnCallPersonPageAnswer.onAcknowledgePressed).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "incident",
          recordId: recordId,
          pressedByUserId: userId,
        }),
      );
      expect(answer.ephemeral_text).toBe("INC-42 was acknowledged already.");
    });

    /*
     * A policy a person started by hand for an episode goes on until
     * somebody it paged answers it (OnCallPolicyStartedByHand, #7596):
     * Acknowledge on the episode somebody else is on answers the presser's
     * own pages about it, as on an incident or an alert.
     */
    test.each([
      {
        actionId: SlackActionType.AcknowledgeIncidentEpisode,
        type: WorkspaceEventType.IncidentEpisode,
        kind: "incident episode",
      },
      {
        actionId: SlackActionType.AcknowledgeAlertEpisode,
        type: WorkspaceEventType.AlertEpisode,
        kind: "alert episode",
      },
    ])(
      "Acknowledge on an acknowledged $kind answers the presser's own pages about it, and changes nothing",
      async (data: {
        actionId: SlackActionType;
        type: WorkspaceEventType;
        kind: string;
      }) => {
        jest
          .spyOn(IncidentEpisodeService, "findOneById")
          .mockResolvedValue({ projectId: projectId } as never);
        jest
          .spyOn(AlertEpisodeService, "findOneById")
          .mockResolvedValue({ projectId: projectId } as never);
        authorize.mockResolvedValue({ ...event, type: data.type });
        getStanding.mockResolvedValue({
          isAcknowledged: true,
          isResolved: false,
          hasStarted: false,
          isComplete: false,
        });

        await MattermostActions.handlePress(press(data.actionId));

        expect(acknowledge).not.toHaveBeenCalled();
        expect(
          OnCallPersonPageAnswer.onAcknowledgePressed,
        ).toHaveBeenCalledWith({
          kind: data.kind,
          recordId: recordId,
          projectId: projectId,
          pressedByUserId: userId,
          isResolved: false,
        });
      },
    );

    test("Resolve on a resolved incident answers no page", async () => {
      getStanding.mockResolvedValue({
        isAcknowledged: true,
        isResolved: true,
        hasStarted: false,
        isComplete: false,
      });

      await MattermostActions.handlePress(
        press(SlackActionType.ResolveIncident),
      );

      expect(resolve).not.toHaveBeenCalled();
      expect(
        OnCallPersonPageAnswer.onAcknowledgePressed,
      ).not.toHaveBeenCalled();
    });

    test("Resolve resolves an alert, as the member", async () => {
      authorize.mockResolvedValue({ ...event, type: WorkspaceEventType.Alert });

      await MattermostActions.handlePress(press(SlackActionType.ResolveAlert));

      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AlertStateTimeline,
          action: "resolve this alert",
          event: { type: WorkspaceEventType.Alert, id: recordId },
        }),
      );
      expect(resolve).toHaveBeenCalled();
    });

    test("Mark as Ongoing and Mark as Complete move a scheduled maintenance event", async () => {
      const ongoing: jest.SpyInstance = jest
        .spyOn(WorkspaceMemberActions, "markScheduledMaintenanceAsOngoing")
        .mockResolvedValue(undefined);

      authorize.mockResolvedValue({
        ...event,
        type: WorkspaceEventType.ScheduledMaintenance,
      });

      await MattermostActions.handlePress(
        press(SlackActionType.MarkScheduledMaintenanceAsOngoing),
      );
      expect(ongoing).toHaveBeenCalled();

      await MattermostActions.handlePress(
        press(SlackActionType.MarkScheduledMaintenanceAsComplete),
      );
      expect(resolve).toHaveBeenCalled();
    });

    test("a refusal to act is said in the member's own words", async () => {
      authorize.mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to acknowledge this incident.",
        ),
      );

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toBe(
        "You do not have permission to acknowledge this incident.",
      );
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("an unexpected failure says it could not be done, never what failed", async () => {
      acknowledge.mockRejectedValue(new Error("connection reset by peer"));

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(answer.ephemeral_text).toContain("could not do that just now");
      expect(answer.ephemeral_text).not.toContain("connection reset");
    });
  });

  describe("presses that open a form", () => {
    test("Add Note opens the note form for whoever pressed, with the trigger of the press", async () => {
      jest.spyOn(WorkspaceNoteForm, "isPrivateRecord").mockResolvedValue(false);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.ViewAddIncidentNote),
      );

      expect(answer).toEqual({});
      expect(showModal).toHaveBeenCalledTimes(1);

      const opened: {
        authToken: string;
        triggerId: string;
        modalBlock: WorkspaceModalBlock;
      } = showModal.mock.calls[0][0];

      expect(opened.authToken).toBe(AUTH_TOKEN);
      expect(opened.triggerId).toBe("trigger-1");
      expect(opened.modalBlock.actionId).toBe(
        SlackActionType.SubmitIncidentNote,
      );
      expect(opened.modalBlock.actionValue).toBe(recordId.toString());
      expect(
        opened.modalBlock.blocks.map((block: { _type: string }) => {
          return block._type;
        }),
      ).toEqual(["WorkspaceDropdownBlock", "WorkspaceTextAreaBlock"]);
    });

    test("a private incident's note form asks for no note type", async () => {
      jest.spyOn(WorkspaceNoteForm, "isPrivateRecord").mockResolvedValue(true);

      await MattermostActions.handlePress(
        press(SlackActionType.ViewAddIncidentNote),
      );

      const modalBlock: WorkspaceModalBlock =
        showModal.mock.calls[0][0].modalBlock;

      expect(
        modalBlock.blocks.some((block: { _type: string }) => {
          return block._type === "WorkspaceDropdownBlock";
        }),
      ).toBe(false);
    });

    test("an alert's note form takes the note alone", async () => {
      await MattermostActions.handlePress(
        press(SlackActionType.ViewAddAlertNote),
      );

      const modalBlock: WorkspaceModalBlock =
        showModal.mock.calls[0][0].modalBlock;

      expect(modalBlock.actionId).toBe(SlackActionType.SubmitAlertNote);
      expect(modalBlock.blocks).toHaveLength(1);
      expect(modalBlock.blocks[0]!._type).toBe("WorkspaceTextAreaBlock");
    });

    test("Change State offers the states the member may move the record into", async () => {
      jest.spyOn(WorkspaceMemberActions, "findStateOptions").mockResolvedValue({
        options: [
          { id: ObjectID.generate(), name: "Investigating" },
          { id: ObjectID.generate(), name: "Resolved" },
        ],
        hasNoLaterState: false,
      });

      await MattermostActions.handlePress(
        press(SlackActionType.ViewChangeIncidentState),
      );

      const modalBlock: WorkspaceModalBlock =
        showModal.mock.calls[0][0].modalBlock;
      const dropdown: WorkspaceDropdownBlock = modalBlock
        .blocks[0] as WorkspaceDropdownBlock;

      expect(modalBlock.actionId).toBe(
        SlackActionType.SubmitChangeIncidentState,
      );
      expect(dropdown.blockId).toBe(MATTERMOST_STATE_FIELD);
      expect(
        dropdown.options.map((option: { label: string }) => {
          return option.label;
        }),
      ).toEqual(["Investigating", "Resolved"]);
    });

    test("Change State on a record in its last state says so, and opens nothing", async () => {
      jest.spyOn(WorkspaceMemberActions, "findStateOptions").mockResolvedValue({
        options: [],
        hasNoLaterState: true,
      });

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.ViewChangeIncidentState),
      );

      expect(showModal).not.toHaveBeenCalled();
      expect(answer.ephemeral_text).toBe(
        "There is no later state to move this incident to.",
      );
    });

    test("Execute On-Call Policy offers the member's unarchived policies, checked first", async () => {
      const assertCanCreate: jest.SpyInstance = jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined);
      const findReadable: jest.SpyInstance = jest
        .spyOn(WorkspaceActionAuthorization, "findReadable")
        .mockResolvedValue([
          { _id: ObjectID.generate().toString(), name: "Primary" },
        ] as never);

      await MattermostActions.handlePress(
        press(SlackActionType.ViewExecuteAlertOnCallPolicy),
      );

      expect(assertCanCreate).toHaveBeenCalledWith(
        expect.objectContaining({ modelType: OnCallDutyPolicyExecutionLog }),
      );
      expect(findReadable).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { projectId: projectId, isArchived: false },
        }),
      );
      expect(showModal.mock.calls[0][0].modalBlock.actionId).toBe(
        SlackActionType.SubmitExecuteAlertOnCallPolicy,
      );
    });

    test("Execute On-Call Policy with no policy to offer says so", async () => {
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined);
      jest
        .spyOn(WorkspaceActionAuthorization, "findReadable")
        .mockResolvedValue([] as never);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.ViewExecuteIncidentOnCallPolicy),
      );

      expect(showModal).not.toHaveBeenCalled();
      expect(answer.ephemeral_text).toContain(
        "No on-call policies are available",
      );
    });

    test("Change Severity opens on the incident's severity", async () => {
      const currentId: ObjectID = ObjectID.generate();

      jest
        .spyOn(WorkspaceIncidentActions, "authorizeForForm")
        .mockResolvedValue({
          event: event,
          title: "Checkout is down",
        });
      jest
        .spyOn(WorkspaceIncidentActions, "getSeverityChoices")
        .mockResolvedValue([
          { id: currentId, name: "Critical" },
          { id: ObjectID.generate(), name: "Minor" },
        ]);
      jest
        .spyOn(WorkspaceIncidentActions, "getSeverityId")
        .mockResolvedValue(currentId);

      await MattermostActions.handlePress(
        press(SlackActionType.ViewChangeIncidentSeverity),
      );

      const dropdown: WorkspaceDropdownBlock = showModal.mock.calls[0][0]
        .modalBlock.blocks[0] as WorkspaceDropdownBlock;

      expect(dropdown.blockId).toBe(MATTERMOST_SEVERITY_FIELD);
      expect(dropdown.initialValue).toBe(currentId.toString());
    });

    test("a form Mattermost would not open is said where the press was", async () => {
      jest.spyOn(WorkspaceNoteForm, "isPrivateRecord").mockResolvedValue(false);
      showModal.mockRejectedValue(
        new BadDataException("Error from Mattermost: trigger_id expired"),
      );

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.ViewAddIncidentNote),
      );

      // Written as text: an underscore inside a word starts no emphasis.
      expect(answer.ephemeral_text).toBe(
        "Error from Mattermost: trigger_id expired",
      );
    });
  });

  describe("forms submitted", () => {
    test("a cancelled form closes, doing nothing", async () => {
      expect(
        await MattermostActions.handleDialogSubmission(
          submission(
            SlackActionType.SubmitIncidentNote,
            {},
            { cancelled: true },
          ),
        ),
      ).toEqual({});

      expect(findIncident).not.toHaveBeenCalled();
    });

    test("a form whose state OneUptime did not sign is refused", async () => {
      const answer: MattermostDialogAnswer =
        await MattermostActions.handleDialogSubmission(
          submission(
            SlackActionType.SubmitIncidentNote,
            { note: "x" },
            { state: "forged" },
          ),
        );

      expect(answer.error).toBe(MattermostActions.UNVERIFIED_PRESS_MESSAGE);
    });

    test("a public note is added to the incident as the member", async () => {
      jest.spyOn(WorkspaceNoteForm, "isPrivateRecord").mockResolvedValue(false);
      const assertCanCreate: jest.SpyInstance = jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined);
      const addPublic: jest.SpyInstance = jest
        .spyOn(IncidentPublicNoteService, "addNote")
        .mockResolvedValue({} as never);

      const answer: MattermostDialogAnswer =
        await MattermostActions.handleDialogSubmission(
          submission(SlackActionType.SubmitIncidentNote, {
            [MATTERMOST_NOTE_FIELD]: "  Rolled back the deploy.  ",
            [MATTERMOST_NOTE_TYPE_FIELD]: "public",
          }),
        );

      expect(answer).toEqual({});
      expect(assertCanCreate).toHaveBeenCalledWith(
        expect.objectContaining({ modelType: IncidentPublicNote }),
      );
      expect(addPublic).toHaveBeenCalledWith({
        incidentId: recordId,
        projectId: projectId,
        note: "Rolled back the deploy.",
        props: props,
      });
    });

    test("a public note asked for on a private incident is added as a private note", async () => {
      jest.spyOn(WorkspaceNoteForm, "isPrivateRecord").mockResolvedValue(true);
      const assertCanCreate: jest.SpyInstance = jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined);
      const addPublic: jest.SpyInstance = jest
        .spyOn(IncidentPublicNoteService, "addNote")
        .mockResolvedValue({} as never);
      const addPrivate: jest.SpyInstance = jest
        .spyOn(IncidentInternalNoteService, "addNote")
        .mockResolvedValue({} as never);

      await MattermostActions.handleDialogSubmission(
        submission(SlackActionType.SubmitIncidentNote, {
          [MATTERMOST_NOTE_FIELD]: "Customer data involved.",
          [MATTERMOST_NOTE_TYPE_FIELD]: "public",
        }),
      );

      expect(addPublic).not.toHaveBeenCalled();
      expect(addPrivate).toHaveBeenCalled();
      expect(assertCanCreate).toHaveBeenCalledWith(
        expect.objectContaining({ modelType: IncidentInternalNote }),
      );
    });

    test("an alert's note is a private note", async () => {
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined);
      const addAlertNote: jest.SpyInstance = jest
        .spyOn(AlertInternalNoteService, "addNote")
        .mockResolvedValue({} as never);

      await MattermostActions.handleDialogSubmission(
        submission(SlackActionType.SubmitAlertNote, {
          [MATTERMOST_NOTE_FIELD]: "Looking into it.",
        }),
      );

      expect(addAlertNote).toHaveBeenCalledWith(
        expect.objectContaining({
          alertId: recordId,
          note: "Looking into it.",
        }),
      );
    });

    test("a scheduled maintenance event takes a public note", async () => {
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined);
      const addPublic: jest.SpyInstance = jest
        .spyOn(ScheduledMaintenancePublicNoteService, "addNote")
        .mockResolvedValue({} as never);

      await MattermostActions.handleDialogSubmission(
        submission(SlackActionType.SubmitScheduledMaintenanceNote, {
          [MATTERMOST_NOTE_FIELD]: "Starting now.",
          [MATTERMOST_NOTE_TYPE_FIELD]: "public",
        }),
      );

      expect(addPublic).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledMaintenanceId: recordId,
          note: "Starting now.",
        }),
      );
    });

    test.each([
      [{}, MATTERMOST_NOTE_FIELD, "Type a note."],
      [
        { [MATTERMOST_NOTE_FIELD]: "   " },
        MATTERMOST_NOTE_FIELD,
        "Type a note.",
      ],
      [
        { [MATTERMOST_NOTE_FIELD]: "x".repeat(3001) },
        MATTERMOST_NOTE_FIELD,
        "A note may have at most 3000 characters.",
      ],
      [
        {
          [MATTERMOST_NOTE_FIELD]: "ok",
          [MATTERMOST_NOTE_TYPE_FIELD]: "secret",
        },
        MATTERMOST_NOTE_TYPE_FIELD,
        "Pick a note type.",
      ],
    ])(
      "a note form filled in as %j keeps the form open on %s",
      async (values: JSONObject, field: string, message: string) => {
        const answer: MattermostDialogAnswer =
          await MattermostActions.handleDialogSubmission(
            submission(SlackActionType.SubmitIncidentNote, values),
          );

        expect(answer.errors).toEqual({ [field]: message });
      },
    );

    test("a state chosen changes the record's state, as the member", async () => {
      const stateId: ObjectID = ObjectID.generate();
      const changeState: jest.SpyInstance = jest
        .spyOn(WorkspaceMemberActions, "changeState")
        .mockResolvedValue(undefined);

      const answer: MattermostDialogAnswer =
        await MattermostActions.handleDialogSubmission(
          submission(SlackActionType.SubmitChangeIncidentState, {
            [MATTERMOST_STATE_FIELD]: stateId.toString(),
          }),
        );

      expect(answer).toEqual({});
      expect(changeState).toHaveBeenCalledWith({
        event: event,
        stateId: stateId,
        props: props,
      });
    });

    test("a state that is not an id keeps the form open", async () => {
      expect(
        (
          await MattermostActions.handleDialogSubmission(
            submission(SlackActionType.SubmitChangeIncidentState, {
              [MATTERMOST_STATE_FIELD]: "resolved",
            }),
          )
        ).errors,
      ).toEqual({ [MATTERMOST_STATE_FIELD]: "Pick a state." });
    });

    test("an on-call policy chosen is executed for the record, checked against the policy", async () => {
      const policyId: ObjectID = ObjectID.generate();
      const assertCanCreate: jest.SpyInstance = jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined);
      const execute: jest.SpyInstance = jest
        .spyOn(WorkspaceMemberActions, "executeOnCallPolicy")
        .mockResolvedValue(undefined);

      await MattermostActions.handleDialogSubmission(
        submission(SlackActionType.SubmitExecuteIncidentOnCallPolicy, {
          [MATTERMOST_ON_CALL_POLICY_FIELD]: policyId.toString(),
        }),
      );

      expect(assertCanCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: OnCallDutyPolicyExecutionLog,
          resources: [expect.objectContaining({ id: policyId })],
        }),
      );
      expect(execute).toHaveBeenCalledWith({
        event: event,
        onCallDutyPolicyId: policyId,
        props: props,
      });
    });

    test("a severity chosen changes the incident's severity", async () => {
      const severityId: ObjectID = ObjectID.generate();

      jest
        .spyOn(WorkspaceIncidentActions, "authorizeForForm")
        .mockResolvedValue({
          event: event,
          title: "Checkout is down",
        });
      const changeSeverity: jest.SpyInstance = jest
        .spyOn(WorkspaceIncidentActions, "changeSeverity")
        .mockResolvedValue({ isChanged: true, severityName: "Critical" });

      await MattermostActions.handleDialogSubmission(
        submission(SlackActionType.SubmitChangeIncidentSeverity, {
          [MATTERMOST_SEVERITY_FIELD]: severityId.toString(),
        }),
      );

      expect(changeSeverity).toHaveBeenCalledWith({
        event: event,
        severityId: severityId,
        props: props,
      });
    });

    test("a refusal keeps the form open with the member's reason", async () => {
      jest
        .spyOn(WorkspaceMemberActions, "changeState")
        .mockRejectedValue(
          new NotAuthorizedException(
            "You do not have permission to change the state of this incident.",
          ),
        );

      expect(
        (
          await MattermostActions.handleDialogSubmission(
            submission(SlackActionType.SubmitChangeIncidentState, {
              [MATTERMOST_STATE_FIELD]: ObjectID.generate().toString(),
            }),
          )
        ).error,
      ).toBe(
        "You do not have permission to change the state of this incident.",
      );
    });

    test("an account not connected is told to connect, the form kept open", async () => {
      findUserLink.mockResolvedValue(null);

      const answer: MattermostDialogAnswer =
        await MattermostActions.handleDialogSubmission(
          submission(SlackActionType.SubmitChangeIncidentState, {
            [MATTERMOST_STATE_FIELD]: ObjectID.generate().toString(),
          }),
        );

      expect(answer.error).toContain("Connect your Mattermost account");
    });
  });

  /*
   * A public note held for approval (#6254) is posted to no channel until
   * it is approved, and a form closes saying nothing: so its sender is told
   * in the channel, in a post only they see, that it waits and for whom.
   */
  describe("a public note that waits for approval", () => {
    const WAITING_FOR: PublicNoteApprovalWaitingFor = {
      position: {
        step: {
          id: "s1",
          name: "Support",
          order: 1,
          userIds: [],
          teamIds: [],
        },
        number: 1,
        count: 2,
        isFinal: false,
        isAskedAgain: false,
      },
      approverNames: ["Bob", "Platform"],
    };
    const HELD_ANSWER: string =
      "⏳ Sent for approval: your public note on **[Incident INC-42](https://oneuptime.example/incidents/42)** is published on status pages once it is approved. It waits for step 1 of 2 (Support): Bob, Platform.";

    let postEphemeral: jest.SpyInstance;

    beforeEach(() => {
      jest.spyOn(WorkspaceNoteForm, "isPrivateRecord").mockResolvedValue(false);
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined);
      jest
        .spyOn(PublicNoteApprovalEngine, "getWaitingForNote")
        .mockResolvedValue(WAITING_FOR);
      jest
        .spyOn(WorkspaceMemberActions, "findEventForMember")
        .mockResolvedValue({ record: {}, event: event } as never);
      jest.spyOn(WorkspaceActionAnswers, "getRecordName").mockResolvedValue({
        label: "Incident INC-42",
        link: "https://oneuptime.example/incidents/42",
      });
      postEphemeral = jest
        .spyOn(MattermostUtil, "postEphemeral")
        .mockResolvedValue(undefined);
    });

    test.each([
      [
        "an incident",
        SlackActionType.SubmitIncidentNote,
        IncidentPublicNoteService,
      ],
      [
        "an incident episode",
        SlackActionType.SubmitIncidentEpisodeNote,
        IncidentEpisodePublicNoteService,
      ],
      [
        "a scheduled maintenance event",
        SlackActionType.SubmitScheduledMaintenanceNote,
        ScheduledMaintenancePublicNoteService,
      ],
    ])(
      "on %s: the form closes, and its sender alone is told it waits, and for whom",
      async (
        _record: string,
        actionId: string,
        service:
          | typeof IncidentPublicNoteService
          | typeof IncidentEpisodePublicNoteService
          | typeof ScheduledMaintenancePublicNoteService,
      ) => {
        jest
          .spyOn(IncidentEpisodeService, "findOneById")
          .mockResolvedValue({ projectId: projectId } as never);
        jest
          .spyOn(service, "addNote")
          .mockResolvedValue({ isPublished: false } as never);

        const answer: MattermostDialogAnswer =
          await MattermostActions.handleDialogSubmission(
            submission(actionId, {
              [MATTERMOST_NOTE_FIELD]: "We are rolling back the deploy.",
              [MATTERMOST_NOTE_TYPE_FIELD]: "public",
            }),
          );

        expect(answer).toEqual({});
        expect(postEphemeral).toHaveBeenCalledTimes(1);
        expect(postEphemeral).toHaveBeenCalledWith({
          authToken: AUTH_TOKEN,
          userId: MATTERMOST_USER_ID,
          channelId: CHANNEL_ID,
          markdown: HELD_ANSWER,
        });
      },
    );

    test("published as it was posted: nothing more is posted, as before", async () => {
      jest
        .spyOn(IncidentPublicNoteService, "addNote")
        .mockResolvedValue({ isPublished: true } as never);

      await MattermostActions.handleDialogSubmission(
        submission(SlackActionType.SubmitIncidentNote, {
          [MATTERMOST_NOTE_FIELD]: "We are rolling back the deploy.",
          [MATTERMOST_NOTE_TYPE_FIELD]: "public",
        }),
      );

      expect(postEphemeral).not.toHaveBeenCalled();
    });

    test("a private note is never held, and nothing is posted", async () => {
      jest
        .spyOn(IncidentInternalNoteService, "addNote")
        .mockResolvedValue({} as never);

      await MattermostActions.handleDialogSubmission(
        submission(SlackActionType.SubmitIncidentNote, {
          [MATTERMOST_NOTE_FIELD]: "Rolled back 4.2.1.",
          [MATTERMOST_NOTE_TYPE_FIELD]: "private",
        }),
      );

      expect(postEphemeral).not.toHaveBeenCalled();
    });

    test("the note is written by now: an answer that cannot be posted still closes the form as done", async () => {
      jest
        .spyOn(IncidentPublicNoteService, "addNote")
        .mockResolvedValue({ isPublished: false } as never);
      postEphemeral.mockRejectedValue(new Error("Mattermost is down"));

      await expect(
        MattermostActions.handleDialogSubmission(
          submission(SlackActionType.SubmitIncidentNote, {
            [MATTERMOST_NOTE_FIELD]: "We are rolling back the deploy.",
            [MATTERMOST_NOTE_TYPE_FIELD]: "public",
          }),
        ),
      ).resolves.toEqual({});
    });

    test("a form sent from no channel has nowhere to say it, and posts nothing", async () => {
      jest
        .spyOn(IncidentPublicNoteService, "addNote")
        .mockResolvedValue({ isPublished: false } as never);

      await expect(
        MattermostActions.handleDialogSubmission(
          submission(
            SlackActionType.SubmitIncidentNote,
            {
              [MATTERMOST_NOTE_FIELD]: "We are rolling back the deploy.",
              [MATTERMOST_NOTE_TYPE_FIELD]: "public",
            },
            { channel_id: undefined },
          ),
        ),
      ).resolves.toEqual({});
      expect(postEphemeral).not.toHaveBeenCalled();
    });

    test.each([
      [SlackActionType.ViewAddIncidentNote],
      [SlackActionType.ViewAddScheduledMaintenanceNote],
    ])(
      "the note form (%s) says the public note is posted once approved",
      async (actionId: string) => {
        jest
          .spyOn(PublicNoteApprovalPolicy, "isRequired")
          .mockResolvedValue(true);

        await MattermostActions.handlePress(press(actionId));

        const modalBlock: WorkspaceModalBlock =
          showModal.mock.calls[0][0].modalBlock;
        const noteType: WorkspaceDropdownBlock = modalBlock.blocks.find(
          (block: { _type: string }) => {
            return block._type === "WorkspaceDropdownBlock";
          },
        ) as WorkspaceDropdownBlock;

        expect(noteType.options[0]).toEqual({
          label: "Public Note (Posted on Status Page once approved)",
          value: "public",
        });
      },
    );
  });

  describe("the action table", () => {
    test("every form a press opens has a submission that is acted on", () => {
      for (const spec of Object.values(MATTERMOST_PRESS_ACTIONS)) {
        if (spec.submitActionId) {
          expect(MATTERMOST_SUBMIT_ACTIONS[spec.submitActionId]).toEqual(
            expect.objectContaining({ recordType: spec.recordType }),
          );
        }
      }
    });

    test("every action is one of the ids OneUptime's messages carry", () => {
      const ids: Array<string> = Object.values(
        SlackActionType,
      ) as Array<string>;

      for (const actionId of [
        ...Object.keys(MATTERMOST_PRESS_ACTIONS),
        ...Object.keys(MATTERMOST_SUBMIT_ACTIONS),
      ]) {
        expect(ids).toContain(actionId);
      }
    });
  });
});
