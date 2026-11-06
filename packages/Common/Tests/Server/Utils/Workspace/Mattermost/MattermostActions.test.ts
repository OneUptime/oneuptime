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
      .mockResolvedValue({ authToken: AUTH_TOKEN } as never);
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

    test("the record's project must be connected to the team the press came from", async () => {
      findProjectConnection.mockResolvedValue(null);

      const answer: MattermostPressAnswer = await MattermostActions.handlePress(
        press(SlackActionType.AcknowledgeIncident),
      );

      expect(findProjectConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            projectId: projectId,
            workspaceType: WorkspaceType.Mattermost,
            workspaceProjectId: TEAM_ID,
          },
        }),
      );
      expect(answer.ephemeral_text).toContain(
        "no longer connected to the OneUptime project",
      );
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
