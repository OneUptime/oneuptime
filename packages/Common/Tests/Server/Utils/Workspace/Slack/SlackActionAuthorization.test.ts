import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import AccessTokenService from "../../../../../Server/Services/AccessTokenService";
import AlertEpisodeInternalNoteService from "../../../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeStateTimelineService from "../../../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertInternalNoteService from "../../../../../Server/Services/AlertInternalNoteService";
import AlertStateTimelineService from "../../../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodePublicNoteService from "../../../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeStateTimelineService from "../../../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentInternalNoteService from "../../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import ScheduledMaintenancePublicNoteService from "../../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAlertActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Alert";
import SlackAlertEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/AlertEpisode";
import SlackAuthAction, {
  SlackRequest,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackIncidentActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackIncidentEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/IncidentEpisode";
import SlackScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import ProjectService from "../../../../../Server/Services/ProjectService";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * Slack buttons, modals and emoji reactions act as the OneUptime member the
 * Slack account is connected to: someone who may not acknowledge, resolve or
 * post a public status-page note is told so and nothing is written, and so
 * is someone who has left the project. What a permitted member's action
 * writes is their own write (SlackMemberActions.test.ts pins each one).
 * These tests drive the real handlers with the real permission logic; only
 * persistence and the Slack API are stubbed.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const slackUserId: string = "U0READONLY";
const slackTeamId: string = "T0WORKSPACE";
const projectAuthToken: string = "xoxb-project-token";

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

let directMessageSpy: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>;

function createTenantPermission(
  permissions: Array<Permission>,
): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        isBlockPermission: false,
        labelIds: [],
      };
    }),
  };
}

// A current member of the project holding exactly `permissions`.
function mockMember(permissions: Array<Permission>): void {
  const member: TeamMember = new TeamMember();
  member.teamId = ObjectID.generate();
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([member]);
  jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermission")
    .mockResolvedValue(createTenantPermission(permissions));
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockResolvedValue(null);
}

/*
 * Someone removed from the project. Their permission cache entry may still
 * say ProjectOwner - it must not matter.
 */
function mockRemovedMember(): void {
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermission")
    .mockResolvedValue(createTenantPermission([Permission.ProjectOwner]));
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockResolvedValue(null);
}

function createSlackRequest(
  viewValues: Dictionary<string | number | Array<string | number> | Date> = {},
): SlackRequest {
  return {
    isAuthorized: true,
    userId: userId,
    projectId: projectId,
    projectAuthToken: projectAuthToken,
    botUserId: "B0BOT",
    slackUserId: slackUserId,
    slackUsername: "read.only",
    slackChannelId: "C0CHANNEL",
    viewValues: viewValues,
  };
}

function handlerArgs(
  actionType: SlackActionType,
  actionValue: string,
  viewValues?: Dictionary<string | number | Array<string | number> | Date>,
): {
  slackRequest: SlackRequest;
  action: { actionType: SlackActionType; actionValue: string };
  req: ExpressRequest;
  res: ExpressResponse;
} {
  return {
    slackRequest: createSlackRequest(viewValues),
    action: { actionType: actionType, actionValue: actionValue },
    req: {} as ExpressRequest,
    res: {} as ExpressResponse,
  };
}

// The project's incident states, top of the list first.
function incidentStates(): Array<IncidentState> {
  return [
    { name: "Created", order: 1, isCreatedState: true },
    { name: "Acknowledged", order: 2, isAcknowledgedState: true },
    { name: "Resolved", order: 3, isResolvedState: true },
  ].map(
    (data: {
      name: string;
      order: number;
      isCreatedState?: boolean;
      isAcknowledgedState?: boolean;
      isResolvedState?: boolean;
    }): IncidentState => {
      const state: IncidentState = new IncidentState();
      state.id = ObjectID.generate();
      state.projectId = projectId;
      state.name = data.name;
      state.order = data.order;
      state.isCreatedState = Boolean(data.isCreatedState);
      state.isAcknowledgedState = Boolean(data.isAcknowledgedState);
      state.isResolvedState = Boolean(data.isResolvedState);
      return state;
    },
  );
}

function directMessageTexts(): Array<string> {
  return directMessageSpy.mock.calls.map(
    (call: Parameters<typeof SlackUtil.sendDirectMessageToUser>): string => {
      const block: WorkspaceMessageBlock | undefined = call[0].messageBlocks[0];
      return (block as WorkspacePayloadMarkdown).text;
    },
  );
}

beforeEach((): void => {
  // The project's plan, as the action's checks read it where a plan decides (CallerPlan).
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
  jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
  jest.spyOn(Response, "sendTextResponse").mockImplementation(() => {});
  jest.spyOn(Response, "sendErrorResponse").mockImplementation(() => {});
  directMessageSpy = jest
    .spyOn(SlackUtil, "sendDirectMessageToUser")
    .mockResolvedValue();
});

afterEach((): void => {
  jest.restoreAllMocks();
});

type WriteCase = {
  name: string;
  refusal: string;
  mutation: () => AnySpy;
  run: (resourceId: string) => Promise<void>;
};

const writeCases: Array<WriteCase> = [
  {
    name: "acknowledge an incident",
    refusal: "acknowledge this incident",
    mutation: (): AnySpy => {
      return jest.spyOn(IncidentStateTimelineService, "create") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackIncidentActions.handleIncidentAction(
        handlerArgs(SlackActionType.AcknowledgeIncident, id),
      );
    },
  },
  {
    name: "resolve an incident",
    refusal: "resolve this incident",
    mutation: (): AnySpy => {
      return jest.spyOn(IncidentStateTimelineService, "create") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackIncidentActions.handleIncidentAction(
        handlerArgs(SlackActionType.ResolveIncident, id),
      );
    },
  },
  {
    name: "post a public incident note",
    refusal: "add a public note to this incident",
    mutation: (): AnySpy => {
      return jest.spyOn(IncidentPublicNoteService, "addNote") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackIncidentActions.handleIncidentAction(
        handlerArgs(SlackActionType.SubmitIncidentNote, id, {
          noteType: "public",
          note: "All clear.",
        }),
      );
    },
  },
  {
    name: "post a private incident note",
    refusal: "add a private note to this incident",
    mutation: (): AnySpy => {
      return jest.spyOn(IncidentInternalNoteService, "addNote") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackIncidentActions.handleIncidentAction(
        handlerArgs(SlackActionType.SubmitIncidentNote, id, {
          noteType: "private",
          note: "Looking.",
        }),
      );
    },
  },
  {
    name: "change an incident's state",
    refusal: "change the state of this incident",
    mutation: (): AnySpy => {
      return jest.spyOn(IncidentStateTimelineService, "create") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackIncidentActions.handleIncidentAction(
        handlerArgs(SlackActionType.SubmitChangeIncidentState, id, {
          incidentState: ObjectID.generate().toString(),
        }),
      );
    },
  },
  {
    name: "page an on-call policy for an incident",
    refusal: "execute an on-call policy for this incident",
    mutation: (): AnySpy => {
      return jest.spyOn(
        OnCallDutyPolicyExecutionLogService,
        "create",
      ) as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackIncidentActions.handleIncidentAction(
        handlerArgs(SlackActionType.SubmitExecuteIncidentOnCallPolicy, id, {
          onCallPolicy: ObjectID.generate().toString(),
        }),
      );
    },
  },
  {
    name: "acknowledge an alert",
    refusal: "acknowledge this alert",
    mutation: (): AnySpy => {
      return jest.spyOn(AlertStateTimelineService, "create") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackAlertActions.handleAlertAction(
        handlerArgs(SlackActionType.AcknowledgeAlert, id),
      );
    },
  },
  {
    name: "resolve an alert",
    refusal: "resolve this alert",
    mutation: (): AnySpy => {
      return jest.spyOn(AlertStateTimelineService, "create") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackAlertActions.handleAlertAction(
        handlerArgs(SlackActionType.ResolveAlert, id),
      );
    },
  },
  {
    name: "add an alert note",
    refusal: "add a private note to this alert",
    mutation: (): AnySpy => {
      return jest.spyOn(AlertInternalNoteService, "addNote") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackAlertActions.handleAlertAction(
        handlerArgs(SlackActionType.SubmitAlertNote, id, { note: "Noted." }),
      );
    },
  },
  {
    name: "acknowledge an alert episode",
    refusal: "acknowledge this alert episode",
    mutation: (): AnySpy => {
      return jest.spyOn(AlertEpisodeStateTimelineService, "create") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackAlertEpisodeActions.handleAlertEpisodeAction(
        handlerArgs(SlackActionType.AcknowledgeAlertEpisode, id),
      );
    },
  },
  {
    name: "change an alert episode's state",
    refusal: "change the state of this alert episode",
    mutation: (): AnySpy => {
      return jest.spyOn(AlertEpisodeStateTimelineService, "create") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackAlertEpisodeActions.handleAlertEpisodeAction(
        handlerArgs(SlackActionType.SubmitChangeAlertEpisodeState, id, {
          episodeState: ObjectID.generate().toString(),
        }),
      );
    },
  },
  {
    name: "add an alert episode note",
    refusal: "add a private note to this alert episode",
    mutation: (): AnySpy => {
      return jest.spyOn(AlertEpisodeInternalNoteService, "addNote") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackAlertEpisodeActions.handleAlertEpisodeAction(
        handlerArgs(SlackActionType.SubmitAlertEpisodeNote, id, {
          note: "Noted.",
        }),
      );
    },
  },
  {
    name: "resolve an incident episode",
    refusal: "resolve this incident episode",
    mutation: (): AnySpy => {
      return jest.spyOn(
        IncidentEpisodeStateTimelineService,
        "create",
      ) as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackIncidentEpisodeActions.handleIncidentEpisodeAction(
        handlerArgs(SlackActionType.ResolveIncidentEpisode, id),
      );
    },
  },
  {
    name: "post a public incident episode note",
    refusal: "add a public note to this incident episode",
    mutation: (): AnySpy => {
      return jest.spyOn(IncidentEpisodePublicNoteService, "addNote") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackIncidentEpisodeActions.handleIncidentEpisodeAction(
        handlerArgs(SlackActionType.SubmitIncidentEpisodeNote, id, {
          noteType: "public",
          note: "All clear.",
        }),
      );
    },
  },
  {
    name: "mark a scheduled maintenance event as ongoing",
    refusal: "mark this scheduled maintenance event as ongoing",
    mutation: (): AnySpy => {
      return jest.spyOn(
        ScheduledMaintenanceStateTimelineService,
        "create",
      ) as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackScheduledMaintenanceActions.handleScheduledMaintenanceAction(
        handlerArgs(SlackActionType.MarkScheduledMaintenanceAsOngoing, id),
      );
    },
  },
  {
    name: "post a public scheduled maintenance note",
    refusal: "add a public note to this scheduled maintenance event",
    mutation: (): AnySpy => {
      return jest.spyOn(
        ScheduledMaintenancePublicNoteService,
        "addNote",
      ) as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackScheduledMaintenanceActions.handleScheduledMaintenanceAction(
        handlerArgs(SlackActionType.SubmitScheduledMaintenanceNote, id, {
          noteType: "public",
          note: "Starting now.",
        }),
      );
    },
  },
  {
    name: "create a scheduled maintenance event",
    refusal: "create a scheduled maintenance event",
    mutation: (): AnySpy => {
      return jest.spyOn(ScheduledMaintenanceService, "create") as AnySpy;
    },
    run: (id: string): Promise<void> => {
      return SlackScheduledMaintenanceActions.handleScheduledMaintenanceAction(
        handlerArgs(SlackActionType.SubmitNewScheduledMaintenance, id, {
          scheduledMaintenanceTitle: "Database upgrade",
          scheduledMaintenanceDescription: "Planned.",
          startDate: new Date(),
          endDate: new Date(),
        }),
      );
    },
  },
];

describe("Slack interactive actions refuse a read-only member", (): void => {
  test.each(writeCases)(
    "cannot $name",
    async (testCase: WriteCase): Promise<void> => {
      mockMember([Permission.Viewer]);
      const mutationSpy: AnySpy = testCase
        .mutation()
        .mockResolvedValue(undefined as never);

      await testCase.run(ObjectID.generate().toString());

      expect(mutationSpy).not.toHaveBeenCalled();
      expect(directMessageSpy).toHaveBeenCalledTimes(1);
      expect(directMessageSpy.mock.calls[0]![0].workspaceUserId).toBe(
        slackUserId,
      );
      expect(directMessageTexts()[0]).toContain(
        `You do not have permission to ${testCase.refusal}.`,
      );
    },
  );
});

describe("Slack interactive actions refuse a user removed from the project", (): void => {
  test.each(writeCases)(
    "cannot $name",
    async (testCase: WriteCase): Promise<void> => {
      mockRemovedMember();
      const mutationSpy: AnySpy = testCase
        .mutation()
        .mockResolvedValue(undefined as never);

      await testCase.run(ObjectID.generate().toString());

      expect(mutationSpy).not.toHaveBeenCalled();
      expect(directMessageTexts()[0]).toContain(
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
    },
  );
});

describe("Slack interactive actions still work for members who hold the permission", (): void => {
  test("an incident member acknowledges an incident they can read", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    mockMember([Permission.IncidentMember]);
    const states: Array<IncidentState> = incidentStates();
    const incident: Incident = new Incident();
    incident.id = incidentId;
    incident.currentIncidentStateId = states[0]!.id!;
    const lookupSpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident);
    jest
      .spyOn(IncidentService, "isIncidentAcknowledged")
      .mockResolvedValue(false);
    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockResolvedValue(states);
    const logSpy: AnySpy = jest
      .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
      .mockResolvedValue(undefined as never) as AnySpy;
    const createSpy: SpyInstance<typeof IncidentStateTimelineService.create> =
      jest
        .spyOn(IncidentStateTimelineService, "create")
        .mockResolvedValue(new IncidentStateTimeline());

    await SlackIncidentActions.handleIncidentAction(
      handlerArgs(SlackActionType.AcknowledgeIncident, incidentId.toString()),
    );

    /*
     * The state change the dashboard makes for them: a timeline row into
     * the project's acknowledged state, created with their own props.
     */
    expect(createSpy).toHaveBeenCalledTimes(1);
    const created: IncidentStateTimeline = createSpy.mock.calls[0]![0].data;
    expect(created.incidentId?.toString()).toBe(incidentId.toString());
    expect(created.incidentStateId?.toString()).toBe(states[1]!.id!.toString());
    expect(created.projectId?.toString()).toBe(projectId.toString());
    expect(createSpy.mock.calls[0]![0].props.isRoot).toBeUndefined();
    expect(createSpy.mock.calls[0]![0].props.userId).toBe(userId);
    expect(createSpy.mock.calls[0]![0].props.tenantId).toBe(projectId);
    // Visibility was checked as the user, inside this project.
    expect(lookupSpy.mock.calls[0]![0].props.isRoot).toBeUndefined();
    expect(lookupSpy.mock.calls[0]![0].props.userId).toBe(userId);
    expect(lookupSpy.mock.calls[0]![0].query).toMatchObject({
      projectId: projectId,
    });
    // The button is logged as pressed once the change is made.
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(directMessageSpy).not.toHaveBeenCalled();
  });

  test("a refusal from the state change itself is told to the member, and the button is not logged", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    mockMember([Permission.IncidentMember]);
    const states: Array<IncidentState> = incidentStates();
    const incident: Incident = new Incident();
    incident.id = incidentId;
    incident.currentIncidentStateId = states[0]!.id!;
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(IncidentService, "isIncidentAcknowledged")
      .mockResolvedValue(false);
    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockResolvedValue(states);
    const logSpy: AnySpy = jest
      .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
      .mockResolvedValue(undefined as never) as AnySpy;
    // The create's own checks refuse it - a column, a label, the plan.
    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to create Incident State Timeline.",
        ),
      );

    await SlackIncidentActions.handleIncidentAction(
      handlerArgs(SlackActionType.AcknowledgeIncident, incidentId.toString()),
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(directMessageTexts()).toEqual([
      expect.stringContaining(
        "Could not acknowledge the incident: You do not have permissions to create Incident State Timeline.",
      ),
    ]);
  });

  test("an incident member posts a public note", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    mockMember([Permission.IncidentMember]);
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(new Incident());
    const addNoteSpy: SpyInstance<typeof IncidentPublicNoteService.addNote> =
      jest
        .spyOn(IncidentPublicNoteService, "addNote")
        .mockResolvedValue(undefined as never);

    await SlackIncidentActions.handleIncidentAction(
      handlerArgs(SlackActionType.SubmitIncidentNote, incidentId.toString(), {
        noteType: "public",
        note: "All clear.",
      }),
    );

    expect(addNoteSpy).toHaveBeenCalledTimes(1);
    expect(addNoteSpy.mock.calls[0]![0]).toMatchObject({
      note: "All clear.",
      projectId: projectId,
    });
    // Posted with the member's own props: the note is theirs.
    expect(addNoteSpy.mock.calls[0]![0].props.userId).toBe(userId);
    expect(addNoteSpy.mock.calls[0]![0].props.tenantId).toBe(projectId);
    expect(addNoteSpy.mock.calls[0]![0].props.isRoot).toBeUndefined();
  });

  test("a member cannot act on an incident outside their project or scope", async (): Promise<void> => {
    mockMember([Permission.ProjectMember]);
    // The user-scoped, project-scoped lookup finds nothing.
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
    const resolveSpy: SpyInstance<typeof IncidentStateTimelineService.create> =
      jest
        .spyOn(IncidentStateTimelineService, "create")
        .mockResolvedValue(new IncidentStateTimeline());

    await SlackIncidentActions.handleIncidentAction(
      handlerArgs(
        SlackActionType.ResolveIncident,
        ObjectID.generate().toString(),
      ),
    );

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(directMessageTexts()[0]).toContain(
      "the incident was not found in this project",
    );
  });
});

describe("Slack emoji reactions", (): void => {
  function mockIncidentChannel(): void {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = projectId;
    projectAuth.authToken = projectAuthToken;
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([projectAuth]);

    // The channel is the one OneUptime created for this incident.
    const incident: Incident = new Incident();
    incident.id = ObjectID.generate();
    incident.projectId = projectId;
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockResolvedValue(null);
    jest
      .spyOn(IncidentService, "getIncidentNumber")
      .mockResolvedValue({ number: 7, numberWithPrefix: "#7" });

    const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    userAuth.userId = userId;
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue(userAuth);
  }

  test.each([
    {
      who: "a read-only member",
      arrange: (): void => {
        return mockMember([Permission.Viewer]);
      },
    },
    { who: "a removed member", arrange: mockRemovedMember },
  ])(
    "$who cannot turn a message into a public status-page note",
    async ({ arrange }: { arrange: () => void }): Promise<void> => {
      arrange();
      mockIncidentChannel();
      const fetchMessageSpy: SpyInstance<
        typeof SlackUtil.getMessageDetailsByTimestamp
      > = jest
        .spyOn(SlackUtil, "getMessageDetailsByTimestamp")
        .mockResolvedValue({ text: "Someone else's message", threadTs: null });
      const addNoteSpy: SpyInstance<typeof IncidentPublicNoteService.addNote> =
        jest
          .spyOn(IncidentPublicNoteService, "addNote")
          .mockResolvedValue(undefined as never);

      await SlackIncidentActions.handleEmojiReaction({
        teamId: slackTeamId,
        reaction: "mega",
        userId: slackUserId,
        channelId: "C0INCIDENT",
        messageTs: "1700000000.000100",
      });

      expect(addNoteSpy).not.toHaveBeenCalled();
      expect(fetchMessageSpy).not.toHaveBeenCalled();
      expect(directMessageSpy).toHaveBeenCalledTimes(1);
    },
  );
});

describe("SlackAuthAction.isAuthorized", (): void => {
  function mockConnectedWorkspace(): void {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = projectId;
    projectAuth.authToken = projectAuthToken;
    projectAuth.miscData = { botUserId: "B0BOT" } as never;
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockResolvedValue(projectAuth);

    const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    userAuth.userId = userId;
    userAuth.authToken = "xoxp-user-token";
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue(userAuth);
  }

  function buttonRequest(actionType: SlackActionType): ExpressRequest {
    return {
      body: {
        payload: JSON.stringify({
          type: "block_actions",
          user: { id: slackUserId, username: "read.only" },
          team: { id: slackTeamId },
          channel: { id: "C0CHANNEL" },
          actions: [
            {
              action_id: actionType,
              value: ObjectID.generate().toString(),
            },
          ],
        }),
      },
    } as unknown as ExpressRequest;
  }

  test("does not treat a removed member's linked account as that user", async (): Promise<void> => {
    mockConnectedWorkspace();
    mockRemovedMember();

    const result: SlackRequest = await SlackAuthAction.isAuthorized({
      req: buttonRequest(SlackActionType.AcknowledgeIncident),
    });

    expect(result.isAuthorized).toBe(false);
    expect(result.userId).toBeUndefined();
    expect(directMessageTexts()[0]).toContain(
      WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    );
  });

  test("a removed member keeps only what an unconnected Slack user has", async (): Promise<void> => {
    mockConnectedWorkspace();
    mockRemovedMember();

    const result: SlackRequest = await SlackAuthAction.isAuthorized({
      req: buttonRequest(SlackActionType.ViewIncident),
    });

    expect(result.isAuthorized).toBe(true);
    expect(result.userId).toBeUndefined();
    expect(result.userAuthToken).toBeUndefined();
  });

  test("a current member is resolved to their OneUptime user", async (): Promise<void> => {
    mockConnectedWorkspace();
    mockMember([Permission.Viewer]);

    const result: SlackRequest = await SlackAuthAction.isAuthorized({
      req: buttonRequest(SlackActionType.AcknowledgeIncident),
    });

    expect(result.isAuthorized).toBe(true);
    expect(result.userId).toBe(userId);
    expect(directMessageSpy).not.toHaveBeenCalled();
  });

  /*
   * Join call is a link button: Slack opens the meeting itself, and the
   * meeting decides who gets in. Someone who never linked a OneUptime
   * account must not be told to link one for joining the incident's call.
   */
  test("anyone in the channel can press Join call without a linked OneUptime account", async (): Promise<void> => {
    mockConnectedWorkspace();
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue(null);

    const result: SlackRequest = await SlackAuthAction.isAuthorized({
      req: buttonRequest(SlackActionType.JoinVideoCall),
    });

    expect(result.isAuthorized).toBe(true);
    expect(result.userId).toBeUndefined();
    expect(directMessageSpy).not.toHaveBeenCalled();
  });

  test("a removed member pressing Join call is not sent the not-a-member message", async (): Promise<void> => {
    mockConnectedWorkspace();
    mockRemovedMember();

    const result: SlackRequest = await SlackAuthAction.isAuthorized({
      req: buttonRequest(SlackActionType.JoinVideoCall),
    });

    expect(result.isAuthorized).toBe(true);
    expect(result.userId).toBeUndefined();
    expect(directMessageSpy).not.toHaveBeenCalled();
  });
});
