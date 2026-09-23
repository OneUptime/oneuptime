import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import logger from "../../../Server/Utils/Logger";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
  SlackMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import Project from "../../../Models/DatabaseModels/Project";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import BadDataException from "../../../Types/Exception/BadDataException";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Tests for WorkspaceNotificationRuleService.sendTestNotificationToDestination,
 * the service behind the "Send Test" button beside every Slack channel,
 * Microsoft Teams channel and Microsoft Teams chat in Project Settings.
 *
 * What these pin down:
 *
 * - The send goes through the SAME bot delivery path real notifications use
 *   (WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot), with exactly one
 *   payload addressed to exactly one destination.
 * - Every malformed request is rejected with a user-facing BadDataException
 *   BEFORE anything is loaded, sent or logged. Microsoft Teams team / channel
 *   ids are interpolated unencoded into Microsoft Graph URL paths downstream,
 *   so path separators, query / fragment starters, percent escapes, whitespace,
 *   control characters and dot-only segments ("." / "..") are a security
 *   boundary, not just hygiene.
 * - The SaaS bot is shared across tenants, so a project may only post to
 *   destinations proven to be its own: the Teams chats it captured itself,
 *   and Teams channels listed for the requested team with the project's own
 *   app token (MicrosoftTeamsUtil.getAllWorkspaceChannels). A channel that
 *   listing cannot vouch for - or a listing that fails - sends nothing and
 *   logs nothing.
 * - Whatever a provider throws - an Error, an HTTPErrorResponse (not an
 *   Error), a string, null - becomes a readable message, never
 *   "[object Object]".
 * - A "success" that sent nothing is reported as a failure, never as success.
 * - Every outcome is recorded in Notification Logs, and the best-effort parts
 *   (project name, user name, success-log write) never block or fail a send.
 *
 * Nothing here touches a database or the network: every collaborator is a
 * jest.spyOn on the service singletons, restored after every test.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const TEST_BY_USER_ID: ObjectID = ObjectID.generate();

const SLACK_CHANNEL_ID: string = "C0123ABCD";
const SLACK_CHANNEL_NAME: string = "alerts";

const TEAMS_TEAM_ID: string = "aaaaaaaa-1111-2222-3333-444444444444";
const TEAMS_CHANNEL_ID: string = "19:general-channel@thread.tacv2";
const TEAMS_CHANNEL_NAME: string = "General";
const TEAMS_APP_TOKEN: string = "teams-app-token";

const TEAMS_CHAT_ID: string = "19:chat-7f3a91@thread.v2";
const TEAMS_CHAT_NAME: string = "Ops War Room";

const PROJECT_NAME: string = "Acme Production";
const USER_MARKDOWN: string =
  "[Alice Admin](https://oneuptime.example.com/dashboard/p1/settings/users/u1)";

const SUCCESS_STATUS_MESSAGE: string =
  "Test notification sent from Project Settings";

const MSG_UNSUPPORTED_WORKSPACE_TYPE_PATTERN: RegExp =
  /Slack.*Microsoft Teams|Microsoft Teams.*Slack/;
const MSG_NO_DESTINATION: string =
  "Please choose a channel or a chat to send the test notification to.";
const MSG_BOTH_DESTINATIONS: string =
  "Please choose either a channel or a chat, not both.";
const MSG_CHAT_WITH_SLACK: string =
  "Chats are only supported for Microsoft Teams. Please choose a Slack channel.";
const MSG_INVALID_SLACK_CHANNEL: string = "The Slack channel id is not valid.";
const MSG_TEAM_REQUIRED: string =
  "Please select the team this channel belongs to.";
const MSG_INVALID_TEAMS_TEAM: string =
  "The Microsoft Teams team id is not valid.";
const MSG_INVALID_TEAMS_CHANNEL: string =
  "The Microsoft Teams channel id is not valid.";
const MSG_INVALID_TEAMS_CHAT: string =
  "The Microsoft Teams chat id is not valid.";
const MSG_CHAT_NOT_CONNECTED: string =
  "This chat is no longer connected to OneUptime. Add the OneUptime app to the chat in Microsoft Teams, click Refresh Chats, and try again.";
const MSG_CHANNEL_NOT_IN_TEAM: string =
  "This channel was not found in the selected team. It may have been renamed or deleted, or it may be a shared channel, which Microsoft Teams does not let bots post in. Click Refresh Channels and try again.";
const MSG_CHANNEL_LISTING_FAILED_PREFIX: string =
  "Could not load the channels of the selected team from Microsoft Teams.";
const SEND_FAILED_PREFIX: string = "Could not send the test notification.";
// What WorkspaceBase.getSendErrorMessage reports for a throw with nothing to say.
const UNKNOWN_ERROR_REASON: string = "Unknown error";

function notConnectedMessage(displayName: string): string {
  return `This project is not connected to ${displayName}. Please go to Project Settings and connect ${displayName} first.`;
}

function reconnectMessage(data: {
  destinationLabel: string;
  displayName: string;
}): string {
  return `OneUptime could not send the test notification to ${data.destinationLabel}. Please reconnect ${data.displayName} from Project Settings and try again.`;
}

// ---------------------------------------------------------------- fixtures

interface ThreadSpec {
  id: string;
  name: string;
  threadId: string;
}

interface ErrorSpec {
  id: string;
  name: string;
  error: string;
}

function makeSendResponse(data: {
  workspaceType: WorkspaceType;
  threads?: Array<ThreadSpec> | undefined;
  errors?: Array<ErrorSpec> | undefined;
}): WorkspaceSendMessageResponse {
  const response: WorkspaceSendMessageResponse = {
    workspaceType: data.workspaceType,
    threads: (data.threads || []).map((thread: ThreadSpec) => {
      return {
        channel: {
          id: thread.id,
          name: thread.name,
          workspaceType: data.workspaceType,
        } as WorkspaceChannel,
        threadId: thread.threadId,
      };
    }),
  };

  if (data.errors) {
    response.errors = data.errors.map((error: ErrorSpec) => {
      return {
        channel: {
          id: error.id,
          name: error.name,
          workspaceType: data.workspaceType,
        } as WorkspaceChannel,
        error: error.error,
      };
    });
  }

  return response;
}

function makeChat(data: {
  id: string;
  name: string;
  chatType?: "personal" | "groupChat" | undefined;
}): MicrosoftTeamsChat {
  return {
    id: data.id,
    name: data.name,
    chatType: data.chatType || "groupChat",
    serviceUrl: "https://smba.trafficmanager.net/amer/",
    addedAt: "2026-09-01T00:00:00.000Z",
  };
}

function defaultAvailableChats(): Record<string, MicrosoftTeamsChat> {
  return {
    [TEAMS_CHAT_ID]: makeChat({ id: TEAMS_CHAT_ID, name: TEAMS_CHAT_NAME }),
    "19:personal-bob@unq.gbl.spaces": makeChat({
      id: "19:personal-bob@unq.gbl.spaces",
      name: "Bob Builder",
      chatType: "personal",
    }),
  };
}

// A channel as MicrosoftTeamsUtil.getAllWorkspaceChannels lists it.
function makeTeamChannel(data: {
  id: string;
  name: string;
  teamId?: string | undefined;
}): WorkspaceChannel {
  return {
    id: data.id,
    name: data.name,
    workspaceType: WorkspaceType.MicrosoftTeams,
    teamId: data.teamId || TEAMS_TEAM_ID,
    membershipType: "standard",
  };
}

// One team's channel listing, keyed by channel id like the real one.
function teamListing(
  ...channels: Array<WorkspaceChannel>
): Dictionary<WorkspaceChannel> {
  const listing: Dictionary<WorkspaceChannel> = {};

  for (const channel of channels) {
    listing[channel.id] = channel;
  }

  return listing;
}

/*
 * The channel listing of every team in this project's tenant, keyed by team
 * id: by default one team holding the default channel and one other.
 */
function defaultTeamChannelsByTeamId(): Dictionary<
  Dictionary<WorkspaceChannel>
> {
  return {
    [TEAMS_TEAM_ID]: teamListing(
      makeTeamChannel({ id: TEAMS_CHANNEL_ID, name: TEAMS_CHANNEL_NAME }),
      makeTeamChannel({
        id: "19:engineering-channel@thread.tacv2",
        name: "Engineering",
      }),
    ),
  };
}

// Microsoft Graph's answer for a team the token cannot see.
function graphTeamNotFound(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    404,
    {
      error: {
        code: "NotFound",
        message: "No team found with Group Id in the tenant.",
      },
    },
    {},
  );
}

function makeProjectAuth(data: {
  workspaceType: WorkspaceType;
  authToken?: string | undefined;
  availableChats?: Record<string, MicrosoftTeamsChat> | null | undefined;
}): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = data.workspaceType;

  if (data.authToken !== undefined) {
    auth.authToken = data.authToken;
  }

  if (data.workspaceType === WorkspaceType.Slack) {
    auth.miscData = {
      teamId: "T0SLACKTEAM",
      teamName: "Acme Slack",
      botUserId: "U0BOTUSER",
    } as SlackMiscData;
  } else if (data.availableChats !== null) {
    auth.miscData = {
      tenantId: "tenant-1",
      teamId: TEAMS_TEAM_ID,
      teamName: "Acme Team",
      botId: "bot-1",
      availableChats:
        data.availableChats === undefined
          ? defaultAvailableChats()
          : data.availableChats,
    } as MicrosoftTeamsMiscData;
  }

  return auth;
}

// ------------------------------------------------------------------ mocks

type Connection = "connected" | "not-connected" | "no-auth-token";

interface MockOptions {
  workspaceType: WorkspaceType;
  connection?: Connection | undefined;
  // null: the Teams auth record has no miscData at all.
  availableChats?: Record<string, MicrosoftTeamsChat> | null | undefined;
  /*
   * What MicrosoftTeamsUtil.getAllWorkspaceChannels lists, per team id. A
   * team missing from it is refused the way Graph refuses a team outside the
   * token's tenant. Defaults to defaultTeamChannelsByTeamId().
   */
  teamChannelsByTeamId?: Dictionary<Dictionary<WorkspaceChannel>> | undefined;
  listChannelsRejects?: { error: unknown } | undefined;
  responses?: Array<WorkspaceSendMessageResponse> | undefined;
  postRejects?: { error: unknown } | undefined;
  // null: ProjectService.findOneById resolves null.
  projectName?: string | null | undefined;
  projectLookupFails?: boolean | undefined;
  userMarkdown?: string | undefined;
  userLookupFails?: boolean | undefined;
  logWriteFails?: boolean | undefined;
}

interface Mocks {
  getProjectAuthSpy: jest.SpyInstance;
  connectedChatsSpy: jest.SpyInstance;
  listTeamChannelsSpy: jest.SpyInstance;
  findProjectSpy: jest.SpyInstance;
  userMarkdownSpy: jest.SpyInstance;
  postSpy: jest.SpyInstance;
  createLogSpy: jest.SpyInstance;
  loggerErrorSpy: jest.SpyInstance;
  // testRule machinery that must never be reached from a destination test.
  testRuleSpy: jest.SpyInstance;
  ruleFindOneByIdSpy: jest.SpyInstance;
  createChannelsSpy: jest.SpyInstance;
  inviteUsersSpy: jest.SpyInstance;
}

function defaultThreadFor(workspaceType: WorkspaceType): ThreadSpec {
  if (workspaceType === WorkspaceType.Slack) {
    return {
      id: SLACK_CHANNEL_ID,
      name: SLACK_CHANNEL_NAME,
      threadId: "1726000000.000100",
    };
  }

  return {
    id: TEAMS_CHANNEL_ID,
    name: TEAMS_CHANNEL_NAME,
    threadId: "1726000000001",
  };
}

function mockDeps(options: MockOptions): Mocks {
  const connection: Connection = options.connection || "connected";

  let projectAuth: WorkspaceProjectAuthToken | null = null;

  if (connection === "connected") {
    projectAuth = makeProjectAuth({
      workspaceType: options.workspaceType,
      authToken:
        options.workspaceType === WorkspaceType.Slack
          ? "xoxb-test-token"
          : TEAMS_APP_TOKEN,
      availableChats: options.availableChats,
    });
  } else if (connection === "no-auth-token") {
    projectAuth = makeProjectAuth({
      workspaceType: options.workspaceType,
      availableChats: options.availableChats,
    });
  }

  const getProjectAuthSpy: jest.SpyInstance = jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(projectAuth);

  // Calls through, so the real miscData.availableChats lookup is exercised.
  const connectedChatsSpy: jest.SpyInstance = jest.spyOn(
    WorkspaceNotificationRuleService,
    "getConnectedMicrosoftTeamsChats",
  );

  // Always stubbed: the real listing would call Microsoft Graph.
  const listTeamChannelsSpy: jest.SpyInstance = jest.spyOn(
    MicrosoftTeamsUtil,
    "getAllWorkspaceChannels",
  );

  if (options.listChannelsRejects) {
    listTeamChannelsSpy.mockRejectedValue(options.listChannelsRejects.error);
  } else {
    const teamChannelsByTeamId: Dictionary<Dictionary<WorkspaceChannel>> =
      options.teamChannelsByTeamId || defaultTeamChannelsByTeamId();

    listTeamChannelsSpy.mockImplementation(
      async (data: {
        authToken: string;
        projectId: ObjectID;
        teamId: string;
      }): Promise<Dictionary<WorkspaceChannel>> => {
        const listing: Dictionary<WorkspaceChannel> | undefined =
          Object.prototype.hasOwnProperty.call(
            teamChannelsByTeamId,
            data.teamId,
          )
            ? teamChannelsByTeamId[data.teamId]
            : undefined;

        if (!listing) {
          throw graphTeamNotFound();
        }

        return listing;
      },
    );
  }

  const findProjectSpy: jest.SpyInstance = jest.spyOn(
    ProjectService,
    "findOneById",
  );

  if (options.projectLookupFails) {
    findProjectSpy.mockRejectedValue(new Error("database is unavailable"));
  } else if (options.projectName === null) {
    findProjectSpy.mockResolvedValue(null);
  } else {
    const project: Project = new Project();
    project.name =
      options.projectName === undefined ? PROJECT_NAME : options.projectName;
    findProjectSpy.mockResolvedValue(project);
  }

  const userMarkdownSpy: jest.SpyInstance = jest.spyOn(
    UserService,
    "getUserMarkdownString",
  );

  if (options.userLookupFails) {
    userMarkdownSpy.mockRejectedValue(new Error("user lookup exploded"));
  } else {
    userMarkdownSpy.mockResolvedValue(
      options.userMarkdown === undefined ? USER_MARKDOWN : options.userMarkdown,
    );
  }

  const postSpy: jest.SpyInstance = jest.spyOn(
    WorkspaceUtil,
    "postMessageToAllWorkspaceChannelsAsBot",
  );

  if (options.postRejects) {
    postSpy.mockRejectedValue(options.postRejects.error);
  } else {
    postSpy.mockResolvedValue(
      options.responses || [
        makeSendResponse({
          workspaceType: options.workspaceType,
          threads: [defaultThreadFor(options.workspaceType)],
        }),
      ],
    );
  }

  const createLogSpy: jest.SpyInstance = jest.spyOn(
    WorkspaceNotificationLogService,
    "create",
  );

  if (options.logWriteFails) {
    createLogSpy.mockRejectedValue(new Error("notification log is read-only"));
  } else {
    createLogSpy.mockResolvedValue(new WorkspaceNotificationLog());
  }

  const loggerErrorSpy: jest.SpyInstance = jest
    .spyOn(logger, "error")
    .mockImplementation((): void => {
      return undefined;
    });

  const testRuleSpy: jest.SpyInstance = jest
    .spyOn(WorkspaceNotificationRuleService, "testRule")
    .mockResolvedValue(undefined);

  const ruleFindOneByIdSpy: jest.SpyInstance = jest
    .spyOn(WorkspaceNotificationRuleService, "findOneById")
    .mockResolvedValue(null);

  const createChannelsSpy: jest.SpyInstance = jest
    .spyOn(WorkspaceNotificationRuleService, "createChannelsBasedOnRules")
    .mockResolvedValue([]);

  const inviteUsersSpy: jest.SpyInstance = jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockResolvedValue(undefined as never);

  return {
    getProjectAuthSpy,
    connectedChatsSpy,
    listTeamChannelsSpy,
    findProjectSpy,
    userMarkdownSpy,
    postSpy,
    createLogSpy,
    loggerErrorSpy,
    testRuleSpy,
    ruleFindOneByIdSpy,
    createChannelsSpy,
    inviteUsersSpy,
  };
}

// ---------------------------------------------------------------- helpers

interface DestinationArgs {
  workspaceType: WorkspaceType;
  channelId?: string | undefined;
  teamId?: string | undefined;
  chatId?: string | undefined;
}

function sendTest(args: DestinationArgs): Promise<WorkspaceThread> {
  return WorkspaceNotificationRuleService.sendTestNotificationToDestination({
    projectId: PROJECT_ID,
    testByUserId: TEST_BY_USER_ID,
    ...args,
  });
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  let resolvedWith: unknown = undefined;

  try {
    resolvedWith = await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error(
    `Expected the test send to fail, but it resolved with ${JSON.stringify(resolvedWith)}`,
  );
}

async function expectBadData(
  promise: Promise<unknown>,
  message: string | RegExp,
): Promise<Error> {
  const err: Error = await captureError(promise);

  expect(err).toBeInstanceOf(BadDataException);

  if (typeof message === "string") {
    expect(err.message).toBe(message);
  } else {
    expect(err.message).toMatch(message);
  }

  return err;
}

function expectNothingSentOrLogged(mocks: Mocks): void {
  expect(mocks.postSpy).not.toHaveBeenCalled();
  expect(mocks.createLogSpy).not.toHaveBeenCalled();
}

/*
 * Validation happens before step 3 (loading the project auth), so a rejected
 * request must not have touched credentials, the chat list or the lookups
 * used to build the message either.
 */
function expectRejectedBeforeAnyWork(mocks: Mocks): void {
  expectNothingSentOrLogged(mocks);
  expect(mocks.getProjectAuthSpy).not.toHaveBeenCalled();
  expect(mocks.connectedChatsSpy).not.toHaveBeenCalled();
  expect(mocks.listTeamChannelsSpy).not.toHaveBeenCalled();
  expect(mocks.findProjectSpy).not.toHaveBeenCalled();
  expect(mocks.userMarkdownSpy).not.toHaveBeenCalled();
}

/*
 * The team's channels were listed exactly once, with THIS project's own app
 * token and project id, for the requested (trimmed) team - never for any
 * other team.
 */
function expectTeamListedOnce(mocks: Mocks, teamId: string): void {
  expect(mocks.listTeamChannelsSpy).toHaveBeenCalledTimes(1);
  expect(mocks.listTeamChannelsSpy).toHaveBeenCalledWith({
    authToken: TEAMS_APP_TOKEN,
    projectId: PROJECT_ID,
    teamId: teamId,
  });
}

/*
 * A Teams channel the tenant check refused: the listing ran, but no message
 * was built (so no project / user lookups), nothing was sent and nothing was
 * logged.
 */
function expectRefusedByTenantCheck(mocks: Mocks): void {
  expectNothingSentOrLogged(mocks);
  expect(mocks.findProjectSpy).not.toHaveBeenCalled();
  expect(mocks.userMarkdownSpy).not.toHaveBeenCalled();
}

// The single payload of the single send, after asserting there was exactly one.
function onlyPayload(mocks: Mocks): WorkspaceMessagePayload {
  expect(mocks.postSpy).toHaveBeenCalledTimes(1);

  const args: {
    projectId: ObjectID;
    messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
  } = mocks.postSpy.mock.calls[0]![0] as {
    projectId: ObjectID;
    messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
  };

  expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(args.messagePayloadsByWorkspace).toHaveLength(1);

  return args.messagePayloadsByWorkspace[0]!;
}

// The markdown text of the payload, after asserting it is one markdown block.
function markdownOf(payload: WorkspaceMessagePayload): string {
  expect(payload.messageBlocks).toHaveLength(1);

  const block: WorkspacePayloadMarkdown = payload
    .messageBlocks[0] as WorkspacePayloadMarkdown;

  expect(block._type).toBe("WorkspacePayloadMarkdown");
  expect(typeof block.text).toBe("string");

  return block.text;
}

function loggedEntries(mocks: Mocks): Array<WorkspaceNotificationLog> {
  return mocks.createLogSpy.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: WorkspaceNotificationLog }).data;
  });
}

function loggedProps(mocks: Mocks, index: number): unknown {
  return (mocks.createLogSpy.mock.calls[index]![0] as { props: unknown }).props;
}

function successLogs(mocks: Mocks): Array<WorkspaceNotificationLog> {
  return loggedEntries(mocks).filter((log: WorkspaceNotificationLog) => {
    return log.status === WorkspaceNotificationStatus.Success;
  });
}

function errorLogs(mocks: Mocks): Array<WorkspaceNotificationLog> {
  return loggedEntries(mocks).filter((log: WorkspaceNotificationLog) => {
    return log.status === WorkspaceNotificationStatus.Error;
  });
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/*
 * The spec's message, written out literally for the common cases so these
 * tests do not merely mirror the implementation's string building.
 */
const FULL_CHANNEL_MARKDOWN: string =
  "**Test notification from OneUptime**\n\n" +
  `This is a test notification sent from the OneUptime project **${PROJECT_NAME}** by ${USER_MARKDOWN}. ` +
  "If you can see this message, OneUptime can post notifications to this channel. No action is needed.";

const FULL_CHAT_MARKDOWN: string =
  "**Test notification from OneUptime**\n\n" +
  `This is a test notification sent from the OneUptime project **${PROJECT_NAME}** by ${USER_MARKDOWN}. ` +
  "If you can see this message, OneUptime can post notifications to this chat. No action is needed.";

const NO_PROJECT_CHANNEL_MARKDOWN: string =
  "**Test notification from OneUptime**\n\n" +
  `This is a test notification sent by ${USER_MARKDOWN}. ` +
  "If you can see this message, OneUptime can post notifications to this channel. No action is needed.";

const NO_USER_CHANNEL_MARKDOWN: string =
  "**Test notification from OneUptime**\n\n" +
  `This is a test notification sent from the OneUptime project **${PROJECT_NAME}**. ` +
  "If you can see this message, OneUptime can post notifications to this channel. No action is needed.";

const BARE_CHANNEL_MARKDOWN: string =
  "**Test notification from OneUptime**\n\n" +
  "This is a test notification sent. " +
  "If you can see this message, OneUptime can post notifications to this channel. No action is needed.";

/*
 * The three kinds of destination the button exists for, for behaviour that
 * must hold for every one of them.
 */
interface DestinationCase {
  label: string;
  workspaceType: WorkspaceType;
  displayName: string;
  args: DestinationArgs;
  destinationId: string;
  kind: "channel" | "chat";
  thread: ThreadSpec;
}

const DESTINATIONS: Array<DestinationCase> = [
  {
    label: "a Slack channel",
    workspaceType: WorkspaceType.Slack,
    displayName: "Slack",
    args: { workspaceType: WorkspaceType.Slack, channelId: SLACK_CHANNEL_ID },
    destinationId: SLACK_CHANNEL_ID,
    kind: "channel",
    thread: {
      id: SLACK_CHANNEL_ID,
      name: SLACK_CHANNEL_NAME,
      threadId: "1726000000.000100",
    },
  },
  {
    label: "a Microsoft Teams channel",
    workspaceType: WorkspaceType.MicrosoftTeams,
    displayName: "Microsoft Teams",
    args: {
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
    },
    destinationId: TEAMS_CHANNEL_ID,
    kind: "channel",
    thread: {
      id: TEAMS_CHANNEL_ID,
      name: TEAMS_CHANNEL_NAME,
      threadId: "1726000000001",
    },
  },
  {
    label: "a Microsoft Teams chat",
    workspaceType: WorkspaceType.MicrosoftTeams,
    displayName: "Microsoft Teams",
    args: {
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: TEAMS_CHAT_ID,
    },
    destinationId: TEAMS_CHAT_ID,
    kind: "chat",
    thread: {
      id: TEAMS_CHAT_ID,
      name: TEAMS_CHAT_NAME,
      threadId: "1726000000002",
    },
  },
];

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ================================================================= Slack

describe("sendTestNotificationToDestination: Slack channel", () => {
  test("sends exactly one payload, addressed only to the channel id", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    const payload: WorkspaceMessagePayload = onlyPayload(mocks);

    expect(payload._type).toBe("WorkspaceMessagePayload");
    expect(payload.workspaceType).toBe(WorkspaceType.Slack);
    expect(payload.channelIds).toEqual([SLACK_CHANNEL_ID]);
    expect(payload.channelNames).toEqual([]);
    // teamId is a Microsoft Teams concept, chatIds a Teams chat concept.
    expect(payload).not.toHaveProperty("teamId");
    expect(payload).not.toHaveProperty("chatIds");
  });

  test("the message is the spec's markdown: heading, project, user and 'this channel'", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    const text: string = markdownOf(onlyPayload(mocks));

    expect(text).toContain("Test notification from OneUptime");
    expect(text).toContain(PROJECT_NAME);
    expect(text).toContain(USER_MARKDOWN);
    expect(text).toContain("this channel");
    expect(text).not.toContain("this chat");
    expect(text).toBe(FULL_CHANNEL_MARKDOWN);
  });

  test("looks up the project name as root and the user markdown for the tester", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(mocks.findProjectSpy).toHaveBeenCalledTimes(1);
    const projectQuery: {
      id: ObjectID;
      select: unknown;
      props: unknown;
    } = mocks.findProjectSpy.mock.calls[0]![0] as {
      id: ObjectID;
      select: unknown;
      props: unknown;
    };
    expect(projectQuery.id.toString()).toBe(PROJECT_ID.toString());
    expect(projectQuery.select).toEqual({ name: true });
    expect(projectQuery.props).toEqual({ isRoot: true });

    expect(mocks.userMarkdownSpy).toHaveBeenCalledTimes(1);
    const userQuery: { userId: ObjectID; projectId: ObjectID } = mocks
      .userMarkdownSpy.mock.calls[0]![0] as {
      userId: ObjectID;
      projectId: ObjectID;
    };
    expect(userQuery.userId.toString()).toBe(TEST_BY_USER_ID.toString());
    expect(userQuery.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  test("loads the Slack project auth for this project", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(mocks.getProjectAuthSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
    });
  });

  test("returns the thread the provider reported", async () => {
    const response: WorkspaceSendMessageResponse = makeSendResponse({
      workspaceType: WorkspaceType.Slack,
      threads: [
        {
          id: SLACK_CHANNEL_ID,
          name: SLACK_CHANNEL_NAME,
          threadId: "1726000000.000777",
        },
      ],
    });

    mockDeps({ workspaceType: WorkspaceType.Slack, responses: [response] });

    const thread: WorkspaceThread = await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(thread).toBe(response.threads[0]);
    expect(thread.threadId).toBe("1726000000.000777");
    expect(thread.channel.id).toBe(SLACK_CHANNEL_ID);
  });

  test("writes exactly one Success notification log with every spec field", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          threads: [
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              threadId: "1726000000.000100",
            },
          ],
        }),
      ],
    });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(mocks.createLogSpy).toHaveBeenCalledTimes(1);

    const log: WorkspaceNotificationLog = loggedEntries(mocks)[0]!;

    expect(log).toBeInstanceOf(WorkspaceNotificationLog);
    expect(log.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(log.workspaceType).toBe(WorkspaceType.Slack);
    expect(log.channelId).toBe(SLACK_CHANNEL_ID);
    expect(log.channelName).toBe(SLACK_CHANNEL_NAME);
    expect(log.threadId).toBe("1726000000.000100");
    expect(log.userId?.toString()).toBe(TEST_BY_USER_ID.toString());
    expect(log.status).toBe(WorkspaceNotificationStatus.Success);
    expect(log.statusMessage).toBe(SUCCESS_STATUS_MESSAGE);
    expect(log.actionType).toBe(WorkspaceNotificationActionType.SendMessage);
    expect(log.message).toBe(FULL_CHANNEL_MARKDOWN);

    // Written as root: the tester's own permissions do not gate the log.
    expect(loggedProps(mocks, 0)).toEqual({ isRoot: true });
  });

  test("the success log records the channel the provider reported, not just the request", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          threads: [
            {
              id: SLACK_CHANNEL_ID,
              name: "incident-war-room",
              threadId: "1726000000.000200",
            },
          ],
        }),
      ],
    });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(loggedEntries(mocks)[0]!.channelName).toBe("incident-war-room");
  });

  test("does not consult the Microsoft Teams chat list", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(mocks.connectedChatsSpy).not.toHaveBeenCalled();
  });

  test("does not list Microsoft Teams channels, even with a teamId in the request", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
      teamId: TEAMS_TEAM_ID,
    });

    expect(mocks.listTeamChannelsSpy).not.toHaveBeenCalled();
    expect(onlyPayload(mocks).channelIds).toEqual([SLACK_CHANNEL_ID]);
  });

  test("a teamId sent alongside a Slack channel is ignored, not forwarded", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
      teamId: TEAMS_TEAM_ID,
    });

    const payload: WorkspaceMessagePayload = onlyPayload(mocks);
    expect(payload).not.toHaveProperty("teamId");
    expect(payload.channelIds).toEqual([SLACK_CHANNEL_ID]);
  });

  test("returns the first thread when the provider reports several", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          threads: [
            { id: SLACK_CHANNEL_ID, name: "first", threadId: "t-1" },
            { id: SLACK_CHANNEL_ID, name: "second", threadId: "t-2" },
          ],
        }),
      ],
    });

    const thread: WorkspaceThread = await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(thread.threadId).toBe("t-1");
  });

  test.each<[string, string]>([
    ["a public channel id", "C0123ABCD"],
    ["a private channel id", "G0123ABCD"],
    ["a direct message id", "D0123ABCD"],
    ["lower-case letters", "c0123abcd"],
    ["a single character", "C"],
    ["exactly 64 characters", "C".repeat(64)],
  ])(
    "accepts %s",
    async (_description: string, channelId: string): Promise<void> => {
      const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

      await sendTest({ workspaceType: WorkspaceType.Slack, channelId });

      expect(onlyPayload(mocks).channelIds).toEqual([channelId]);
    },
  );
});

// ======================================================= Teams channels

describe("sendTestNotificationToDestination: Microsoft Teams channel", () => {
  test("forwards the teamId and addresses only the channel id", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
    });

    const payload: WorkspaceMessagePayload = onlyPayload(mocks);

    expect(payload._type).toBe("WorkspaceMessagePayload");
    expect(payload.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(payload.teamId).toBe(TEAMS_TEAM_ID);
    expect(payload.channelIds).toEqual([TEAMS_CHANNEL_ID]);
    expect(payload.channelNames).toEqual([]);
    expect(payload).not.toHaveProperty("chatIds");
  });

  test("the message says 'this channel' and names the project and the tester", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
    });

    expect(markdownOf(onlyPayload(mocks))).toBe(FULL_CHANNEL_MARKDOWN);
  });

  test("loads the Microsoft Teams project auth for this project", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
    });

    expect(mocks.getProjectAuthSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });

  test("does not consult the connected chat list for a channel", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
    });

    expect(mocks.connectedChatsSpy).not.toHaveBeenCalled();
  });

  test("lists the team's channels once, with the project's own token, before the message is built or sent", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
    });

    expectTeamListedOnce(mocks, TEAMS_TEAM_ID);

    // Auth first (the listing needs its token), then the tenant check.
    const authOrder: number =
      mocks.getProjectAuthSpy.mock.invocationCallOrder[0]!;
    const listOrder: number =
      mocks.listTeamChannelsSpy.mock.invocationCallOrder[0]!;
    const messageOrder: number =
      mocks.findProjectSpy.mock.invocationCallOrder[0]!;
    const sendOrder: number = mocks.postSpy.mock.invocationCallOrder[0]!;

    expect(authOrder).toBeLessThan(listOrder);
    expect(listOrder).toBeLessThan(messageOrder);
    expect(listOrder).toBeLessThan(sendOrder);
  });

  test("returns the thread and writes one Success log for the channel", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          threads: [
            {
              id: TEAMS_CHANNEL_ID,
              name: TEAMS_CHANNEL_NAME,
              threadId: "1726000000001",
            },
          ],
        }),
      ],
    });

    const thread: WorkspaceThread = await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
    });

    expect(thread.threadId).toBe("1726000000001");
    expect(mocks.createLogSpy).toHaveBeenCalledTimes(1);

    const log: WorkspaceNotificationLog = loggedEntries(mocks)[0]!;
    expect(log.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(log.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(log.channelId).toBe(TEAMS_CHANNEL_ID);
    expect(log.channelName).toBe(TEAMS_CHANNEL_NAME);
    expect(log.threadId).toBe("1726000000001");
    expect(log.userId?.toString()).toBe(TEST_BY_USER_ID.toString());
    expect(log.status).toBe(WorkspaceNotificationStatus.Success);
    expect(log.statusMessage).toBe(SUCCESS_STATUS_MESSAGE);
    expect(log.actionType).toBe(WorkspaceNotificationActionType.SendMessage);
    expect(log.message).toBe(FULL_CHANNEL_MARKDOWN);
  });

  test("an empty chatId alongside a channel is treated as missing", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
      chatId: "",
    });

    const payload: WorkspaceMessagePayload = onlyPayload(mocks);
    expect(payload.channelIds).toEqual([TEAMS_CHANNEL_ID]);
    expect(payload).not.toHaveProperty("chatIds");
  });

  test.each<[string, string, string]>([
    [
      "a real team GUID and thread.tacv2 channel id",
      "d1f7e0c6-4b0a-4a6a-9c6e-1e2f3a4b5c6d",
      "19:9c5a1f8e2b3d4c5e6f7a8b9c0d1e2f3a@thread.tacv2",
    ],
    [
      "a channel id with @, :, . and -",
      TEAMS_TEAM_ID,
      "19:abc-def.ghi@thread.skype",
    ],
    ["ids of exactly 512 characters", "t".repeat(512), "c".repeat(512)],
    /*
     * Only a value made ENTIRELY of dots is a "." / ".." path segment; real
     * ids contain dots all the time and must keep working.
     */
    [
      "a GUID team and a channel id containing dots",
      "d1f7e0c6-4b0a-4a6a-9c6e-1e2f3a4b5c6d",
      "19:abc@thread.tacv2",
    ],
    ["a team id with a leading dot", ".team", TEAMS_CHANNEL_ID],
    ["a team id with trailing dots", "team..", TEAMS_CHANNEL_ID],
    ["a channel id that starts with dots", TEAMS_TEAM_ID, "..19:abc@thread"],
    ["a channel id that ends with dots", TEAMS_TEAM_ID, "19:abc@thread..."],
  ])(
    "accepts %s",
    async (
      _description: string,
      teamId: string,
      channelId: string,
    ): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamChannelsByTeamId: {
          [teamId]: teamListing(
            makeTeamChannel({ id: channelId, name: "Listed", teamId }),
          ),
        },
      });

      await sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId,
        channelId,
      });

      expectTeamListedOnce(mocks, teamId);

      const payload: WorkspaceMessagePayload = onlyPayload(mocks);
      expect(payload.teamId).toBe(teamId);
      expect(payload.channelIds).toEqual([channelId]);
    },
  );
});

// ============================================ Teams channel tenant boundary

/*
 * The SaaS bot identity is shared across every customer tenant, and neither
 * the id format checks nor the send path prove that a Teams channel belongs
 * to THIS project: a caller's own installed teamId paired with a channelId
 * pasted from another tenant's Teams link skips Graph entirely downstream.
 * So the service lists the requested team's channels with the project's own
 * app token and requires the channelId to be an exact key of that listing.
 * Every refusal here must happen before the message is built: nothing sent,
 * nothing logged.
 */
describe("sendTestNotificationToDestination: a Microsoft Teams channel must be in this project's tenant", () => {
  test("a listing that fails with an HTTPErrorResponse sends nothing and reports Graph's message", async () => {
    const graphError: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      {
        error: {
          code: "Forbidden",
          message: "Caller is not authorized to access the team.",
        },
      },
      {},
    );

    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      listChannelsRejects: { error: graphError },
    });

    const err: Error = await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      `${MSG_CHANNEL_LISTING_FAILED_PREFIX} Caller is not authorized to access the team.`,
    );

    expect(err.message).not.toContain("[object Object]");
    expectTeamListedOnce(mocks, TEAMS_TEAM_ID);
    expectRefusedByTenantCheck(mocks);
  });

  test("a listing that fails with an empty HTTPErrorResponse still reports the HTTP status", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      listChannelsRejects: { error: new HTTPErrorResponse(502, {}, {}) },
    });

    const err: Error = await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      `${MSG_CHANNEL_LISTING_FAILED_PREFIX} Request failed with HTTP status 502`,
    );

    expect(err.message).not.toContain("[object Object]");
    expectRefusedByTenantCheck(mocks);
  });

  test("a listing that fails with an Error sends nothing and reports its message", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      listChannelsRejects: {
        error: new Error(
          "Microsoft Teams tenant ID not found for this project",
        ),
      },
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      `${MSG_CHANNEL_LISTING_FAILED_PREFIX} Microsoft Teams tenant ID not found for this project`,
    );

    expectTeamListedOnce(mocks, TEAMS_TEAM_ID);
    expectRefusedByTenantCheck(mocks);
  });

  test("a team outside the project's tenant (Graph refuses to list it) sends nothing", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: "bbbbbbbb-9999-8888-7777-666666666666",
        channelId: TEAMS_CHANNEL_ID,
      }),
      `${MSG_CHANNEL_LISTING_FAILED_PREFIX} No team found with Group Id in the tenant.`,
    );

    expectTeamListedOnce(mocks, "bbbbbbbb-9999-8888-7777-666666666666");
    expectRefusedByTenantCheck(mocks);
  });

  test("a listing that resolves without the channel sends nothing", async () => {
    // A channelId pasted from another tenant's Teams link.
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: "19:other-tenant-channel@thread.tacv2",
      }),
      MSG_CHANNEL_NOT_IN_TEAM,
    );

    expectTeamListedOnce(mocks, TEAMS_TEAM_ID);
    expectRefusedByTenantCheck(mocks);
  });

  test("an empty listing (a team with no postable channels) sends nothing", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamChannelsByTeamId: { [TEAMS_TEAM_ID]: {} },
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      MSG_CHANNEL_NOT_IN_TEAM,
    );

    expectRefusedByTenantCheck(mocks);
  });

  test("a channel from another team of the tenant is not accepted for the requested team", async () => {
    const otherTeamId: string = "cccccccc-1234-5678-9abc-def012345678";
    const otherTeamChannelId: string = "19:other-team-channel@thread.tacv2";

    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamChannelsByTeamId: {
        [TEAMS_TEAM_ID]: teamListing(
          makeTeamChannel({ id: TEAMS_CHANNEL_ID, name: TEAMS_CHANNEL_NAME }),
        ),
        [otherTeamId]: teamListing(
          makeTeamChannel({
            id: otherTeamChannelId,
            name: "Other Team Channel",
            teamId: otherTeamId,
          }),
        ),
      },
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: otherTeamChannelId,
      }),
      MSG_CHANNEL_NOT_IN_TEAM,
    );

    // Only the requested team was listed - the other team was never searched.
    expectTeamListedOnce(mocks, TEAMS_TEAM_ID);
    expectRefusedByTenantCheck(mocks);
  });

  test("the channel lookup is by exact id: a different-case id is not the listed channel", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID.toUpperCase(),
      }),
      MSG_CHANNEL_NOT_IN_TEAM,
    );

    expectRefusedByTenantCheck(mocks);
  });

  test("the channel lookup is by id: a channel NAME is not a channel id", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_NAME,
      }),
      MSG_CHANNEL_NOT_IN_TEAM,
    );

    expectRefusedByTenantCheck(mocks);
  });

  /*
   * Object prototype keys are "in" every plain object, so a plain index into
   * the listing would mistake them for a listed channel.
   */
  test.each<[string]>([
    ["__proto__"],
    ["constructor"],
    ["toString"],
    ["hasOwnProperty"],
  ])(
    "a prototype key (%s) is not a listed channel",
    async (channelId: string): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

      await expectBadData(
        sendTest({
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: TEAMS_TEAM_ID,
          channelId,
        }),
        MSG_CHANNEL_NOT_IN_TEAM,
      );

      expectTeamListedOnce(mocks, TEAMS_TEAM_ID);
      expectRefusedByTenantCheck(mocks);
    },
  );

  test("the listing is not consulted when the project is not connected", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      connection: "no-auth-token",
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      notConnectedMessage("Microsoft Teams"),
    );

    expect(mocks.listTeamChannelsSpy).not.toHaveBeenCalled();
    expectRefusedByTenantCheck(mocks);
  });

  test("the listed channel's name labels a delivery error the send then reports", async () => {
    /*
     * Downstream, a channel whose name Graph would not return is reported
     * under its raw id; the admin knows it by the name the listing gave.
     */
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamChannelsByTeamId: {
        [TEAMS_TEAM_ID]: teamListing(
          makeTeamChannel({ id: TEAMS_CHANNEL_ID, name: "Incident Bridge" }),
        ),
      },
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          errors: [
            {
              id: TEAMS_CHANNEL_ID,
              name: TEAMS_CHANNEL_ID,
              error: "Forbidden",
            },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      `Could not send the test notification to "Incident Bridge". Forbidden`,
    );

    expect(mocks.postSpy).toHaveBeenCalledTimes(1);
    expect(errorLogs(mocks)).toHaveLength(1);
  });

  test("the listed channel's name labels the reconnect error when nothing was sent", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamChannelsByTeamId: {
        [TEAMS_TEAM_ID]: teamListing(
          makeTeamChannel({ id: TEAMS_CHANNEL_ID, name: "Incident Bridge" }),
        ),
      },
      responses: [],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      reconnectMessage({
        destinationLabel: `"Incident Bridge"`,
        displayName: "Microsoft Teams",
      }),
    );

    const failures: Array<WorkspaceNotificationLog> = errorLogs(mocks);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.channelId).toBe(TEAMS_CHANNEL_ID);
    expect(failures[0]!.channelName).toBe("Incident Bridge");
  });
});

// ========================================================== Teams chats

describe("sendTestNotificationToDestination: Microsoft Teams chat", () => {
  test("addresses only the chat id: no channels, no teamId", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: TEAMS_CHAT_ID,
    });

    const payload: WorkspaceMessagePayload = onlyPayload(mocks);

    expect(payload._type).toBe("WorkspaceMessagePayload");
    expect(payload.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(payload.chatIds).toEqual([TEAMS_CHAT_ID]);
    expect(payload.channelIds).toEqual([]);
    expect(payload.channelNames).toEqual([]);
    expect(payload).not.toHaveProperty("teamId");
  });

  test("the message says 'this chat', not 'this channel'", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: TEAMS_CHAT_ID,
    });

    const text: string = markdownOf(onlyPayload(mocks));

    expect(text).toContain("this chat");
    expect(text).not.toContain("this channel");
    expect(text).toBe(FULL_CHAT_MARKDOWN);
  });

  test("consults the project's connected chats before sending", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: TEAMS_CHAT_ID,
    });

    expect(mocks.connectedChatsSpy).toHaveBeenCalledTimes(1);
    expect(mocks.connectedChatsSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
    });

    const chatsCheckOrder: number =
      mocks.connectedChatsSpy.mock.invocationCallOrder[0]!;
    const sendOrder: number = mocks.postSpy.mock.invocationCallOrder[0]!;
    expect(chatsCheckOrder).toBeLessThan(sendOrder);
  });

  test("does not list any team's channels, even with a teamId in the request", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: TEAMS_CHAT_ID,
      teamId: TEAMS_TEAM_ID,
    });

    expect(mocks.listTeamChannelsSpy).not.toHaveBeenCalled();
    expect(onlyPayload(mocks).chatIds).toEqual([TEAMS_CHAT_ID]);
  });

  test("uses the connected chat's name when a failure is reported", async () => {
    // The provider only knows the raw conversation id; the admin knows the name.
    mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          errors: [
            {
              id: TEAMS_CHAT_ID,
              name: TEAMS_CHAT_ID,
              error: "Bot is not a member of this conversation.",
            },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: TEAMS_CHAT_ID,
      }),
      `Could not send the test notification to "${TEAMS_CHAT_NAME}". Bot is not a member of this conversation.`,
    );
  });

  test("returns the thread and writes one Success log for the chat", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          threads: [
            {
              id: TEAMS_CHAT_ID,
              name: TEAMS_CHAT_NAME,
              threadId: "1726000000002",
            },
          ],
        }),
      ],
    });

    const thread: WorkspaceThread = await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: TEAMS_CHAT_ID,
    });

    expect(thread.threadId).toBe("1726000000002");
    expect(mocks.createLogSpy).toHaveBeenCalledTimes(1);

    const log: WorkspaceNotificationLog = loggedEntries(mocks)[0]!;
    expect(log.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(log.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(log.channelId).toBe(TEAMS_CHAT_ID);
    expect(log.channelName).toBe(TEAMS_CHAT_NAME);
    expect(log.threadId).toBe("1726000000002");
    expect(log.userId?.toString()).toBe(TEST_BY_USER_ID.toString());
    expect(log.status).toBe(WorkspaceNotificationStatus.Success);
    expect(log.statusMessage).toBe(SUCCESS_STATUS_MESSAGE);
    expect(log.actionType).toBe(WorkspaceNotificationActionType.SendMessage);
    expect(log.message).toBe(FULL_CHAT_MARKDOWN);
  });

  test("a personal (1:1) chat is sent to just like a group chat", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: "19:personal-bob@unq.gbl.spaces",
    });

    expect(onlyPayload(mocks).chatIds).toEqual([
      "19:personal-bob@unq.gbl.spaces",
    ]);
  });

  test("a teamId sent alongside a chat is ignored, not forwarded", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: TEAMS_CHAT_ID,
      teamId: TEAMS_TEAM_ID,
    });

    const payload: WorkspaceMessagePayload = onlyPayload(mocks);
    expect(payload).not.toHaveProperty("teamId");
    expect(payload.chatIds).toEqual([TEAMS_CHAT_ID]);
  });

  test("an empty channelId alongside a chat is treated as missing", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: TEAMS_CHAT_ID,
      channelId: "",
    });

    const payload: WorkspaceMessagePayload = onlyPayload(mocks);
    expect(payload.chatIds).toEqual([TEAMS_CHAT_ID]);
    expect(payload.channelIds).toEqual([]);
  });

  test("a chat id of exactly 1024 characters is accepted when it is connected", async () => {
    const longChatId: string = "19:" + "c".repeat(1021);
    expect(longChatId).toHaveLength(1024);

    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      availableChats: {
        [longChatId]: makeChat({ id: longChatId, name: "Long Chat" }),
      },
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: longChatId,
    });

    expect(onlyPayload(mocks).chatIds).toEqual([longChatId]);
  });
});

// ============================================================== trimming

describe("sendTestNotificationToDestination: ids are trimmed before use", () => {
  test("a Slack channel id with surrounding whitespace is sent trimmed", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: `  ${SLACK_CHANNEL_ID}\t\n`,
    });

    expect(onlyPayload(mocks).channelIds).toEqual([SLACK_CHANNEL_ID]);
  });

  test("Microsoft Teams team and channel ids are sent trimmed", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: `\n ${TEAMS_TEAM_ID}  `,
      channelId: ` \t${TEAMS_CHANNEL_ID} `,
    });

    // The tenant check lists the trimmed team and finds the trimmed channel.
    expectTeamListedOnce(mocks, TEAMS_TEAM_ID);

    const payload: WorkspaceMessagePayload = onlyPayload(mocks);
    expect(payload.teamId).toBe(TEAMS_TEAM_ID);
    expect(payload.channelIds).toEqual([TEAMS_CHANNEL_ID]);
  });

  test("a chat id is trimmed before the connected-chat lookup and the send", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: `   ${TEAMS_CHAT_ID}   `,
    });

    expect(onlyPayload(mocks).chatIds).toEqual([TEAMS_CHAT_ID]);
  });

  test("a whitespace-only chatId alongside a Slack channel is treated as missing", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
      chatId: "   ",
    });

    expect(onlyPayload(mocks).channelIds).toEqual([SLACK_CHANNEL_ID]);
  });

  test("the failure log records the trimmed destination", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      responses: [],
    });

    /*
     * Nothing sent: the failure log's destination comes from the request
     * itself, named by the team's channel listing.
     */
    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: ` ${TEAMS_TEAM_ID} `,
        channelId: `  ${TEAMS_CHANNEL_ID}  `,
      }),
      reconnectMessage({
        destinationLabel: `"${TEAMS_CHANNEL_NAME}"`,
        displayName: "Microsoft Teams",
      }),
    );

    expect(errorLogs(mocks)[0]!.channelId).toBe(TEAMS_CHANNEL_ID);
    expect(errorLogs(mocks)[0]!.channelName).toBe(TEAMS_CHANNEL_NAME);
  });
});

// ============================================================ validation

describe("sendTestNotificationToDestination: validation rejects before any work", () => {
  describe("workspace type", () => {
    test.each<[string, string]>([
      ["an unknown workspace", "Discord"],
      ["the wrong casing of a real one", "slack"],
      ["an empty workspace type", ""],
    ])(
      "rejects %s",
      async (_description: string, workspaceType: string): Promise<void> => {
        const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

        await expectBadData(
          sendTest({
            workspaceType: workspaceType as WorkspaceType,
            channelId: SLACK_CHANNEL_ID,
          }),
          MSG_UNSUPPORTED_WORKSPACE_TYPE_PATTERN,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );

    test("an unsupported workspace type is rejected even with no destination", async () => {
      const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

      await expectBadData(
        sendTest({ workspaceType: "Discord" as WorkspaceType }),
        MSG_UNSUPPORTED_WORKSPACE_TYPE_PATTERN,
      );

      expectRejectedBeforeAnyWork(mocks);
    });
  });

  describe("exactly one of channel / chat", () => {
    test.each<[string, WorkspaceType]>([
      ["Slack", WorkspaceType.Slack],
      ["Microsoft Teams", WorkspaceType.MicrosoftTeams],
    ])(
      "%s: neither a channel nor a chat",
      async (_name: string, workspaceType: WorkspaceType): Promise<void> => {
        const mocks: Mocks = mockDeps({ workspaceType });

        await expectBadData(sendTest({ workspaceType }), MSG_NO_DESTINATION);

        expectRejectedBeforeAnyWork(mocks);
      },
    );

    test.each<[string, string | undefined, string | undefined]>([
      ["both empty strings", "", ""],
      ["both whitespace-only", "   ", "\t\n"],
      ["an empty channel and no chat", "", undefined],
      ["no channel and a whitespace-only chat", undefined, "  "],
    ])(
      "treats %s as no destination",
      async (
        _description: string,
        channelId: string | undefined,
        chatId: string | undefined,
      ): Promise<void> => {
        const mocks: Mocks = mockDeps({
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

        await expectBadData(
          sendTest({
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId: TEAMS_TEAM_ID,
            channelId,
            chatId,
          }),
          MSG_NO_DESTINATION,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );

    test("a non-string channel id (a malformed request body) counts as missing", async () => {
      const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

      await expectBadData(
        sendTest({
          workspaceType: WorkspaceType.Slack,
          channelId: 12345 as unknown as string,
        }),
        MSG_NO_DESTINATION,
      );

      expectRejectedBeforeAnyWork(mocks);
    });

    test.each<[string, WorkspaceType]>([
      ["Slack", WorkspaceType.Slack],
      ["Microsoft Teams", WorkspaceType.MicrosoftTeams],
    ])(
      "%s: both a channel and a chat",
      async (_name: string, workspaceType: WorkspaceType): Promise<void> => {
        const mocks: Mocks = mockDeps({ workspaceType });

        await expectBadData(
          sendTest({
            workspaceType,
            teamId: TEAMS_TEAM_ID,
            channelId:
              workspaceType === WorkspaceType.Slack
                ? SLACK_CHANNEL_ID
                : TEAMS_CHANNEL_ID,
            chatId: TEAMS_CHAT_ID,
          }),
          MSG_BOTH_DESTINATIONS,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );
  });

  describe("chats are Microsoft Teams only", () => {
    test("a chatId with Slack is rejected", async () => {
      const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

      await expectBadData(
        sendTest({ workspaceType: WorkspaceType.Slack, chatId: TEAMS_CHAT_ID }),
        MSG_CHAT_WITH_SLACK,
      );

      expectRejectedBeforeAnyWork(mocks);
    });

    test("a Slack-looking chatId with Slack is rejected too", async () => {
      const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

      await expectBadData(
        sendTest({ workspaceType: WorkspaceType.Slack, chatId: "D0123ABCD" }),
        MSG_CHAT_WITH_SLACK,
      );

      expectRejectedBeforeAnyWork(mocks);
    });
  });

  describe("Slack channel id format", () => {
    test.each<[string, string]>([
      ["a path traversal", "../C0123ABCD"],
      ["a forward slash", "C0123/ABCD"],
      ["a backslash", "C0123\\ABCD"],
      ["an interior space", "C0123 ABCD"],
      ["an interior tab", "C0123\tABCD"],
      ["an interior newline", "C0123\nABCD"],
      ["a channel name rather than an id", "#general"],
      ["a hyphen", "C0123-ABCD"],
      ["an underscore", "C0123_ABCD"],
      ["a dot", "C0123.ABCD"],
      ["a query string", "C0123ABCD?limit=1"],
      ["a percent escape", "C0123%2FABCD"],
      ["a URL", "https://slack.com/api/chat.postMessage"],
      ["a non-ASCII letter", `C0123${String.fromCharCode(0xc4)}BCD`],
      ["a NUL control character", `C0123${String.fromCharCode(0x00)}ABCD`],
      ["65 characters", "C".repeat(65)],
      ["a very long id", "C".repeat(10000)],
    ])(
      "rejects %s",
      async (_description: string, channelId: string): Promise<void> => {
        const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

        await expectBadData(
          sendTest({ workspaceType: WorkspaceType.Slack, channelId }),
          MSG_INVALID_SLACK_CHANNEL,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );
  });

  describe("Microsoft Teams channels need a team", () => {
    test.each<[string, string | undefined]>([
      ["missing", undefined],
      ["empty", ""],
      ["whitespace-only", "  \t "],
    ])(
      "rejects a teamId that is %s",
      async (
        _description: string,
        teamId: string | undefined,
      ): Promise<void> => {
        const mocks: Mocks = mockDeps({
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

        await expectBadData(
          sendTest({
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId,
            channelId: TEAMS_CHANNEL_ID,
          }),
          MSG_TEAM_REQUIRED,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );
  });

  /*
   * Team and channel ids are interpolated unencoded into Microsoft Graph URL
   * paths downstream (/teams/{teamId}/channels/{channelId}). Each of these
   * characters would let a caller steer that request at a different Graph
   * resource using the project's app token.
   */
  const FORBIDDEN_GRAPH_PATH_CHARACTERS: Array<[string, string]> = [
    ["a forward slash", "/"],
    ["a backslash", "\\"],
    ["a question mark", "?"],
    ["a hash", "#"],
    ["a percent sign", "%"],
    ["a space", " "],
    ["a tab", "\t"],
    ["a newline", "\n"],
    ["a carriage return", "\r"],
    /*
     * Built from char codes rather than escapes so no formatter can turn
     * them into raw (and, for U+2028, line-breaking) characters.
     */
    ["a vertical tab", String.fromCharCode(0x0b)],
    ["a form feed", String.fromCharCode(0x0c)],
    ["a non-breaking space", String.fromCharCode(0xa0)],
    ["a line separator", String.fromCharCode(0x2028)],
    ["a NUL control character", String.fromCharCode(0x00)],
    ["an escape control character", String.fromCharCode(0x1b)],
    ["a unit-separator control character", String.fromCharCode(0x1f)],
    ["a DEL control character", String.fromCharCode(0x7f)],
    ["a C1 control character", String.fromCharCode(0x85)],
    ["the last C1 control character", String.fromCharCode(0x9f)],
  ];

  /*
   * URL normalisation resolves "." and ".." as relative-path segments
   * (/teams/T/channels/.. becomes /teams/T/), so an id made only of dots is
   * path traversal even though it contains no forbidden character. Padded
   * variants are trimmed to the same thing first.
   */
  const DOT_SEGMENT_IDS: Array<[string, string]> = [
    ["a single dot", "."],
    ["two dots", ".."],
    ["three dots", "..."],
    ["two dots padded with whitespace", "  ..\t"],
  ];

  describe("Microsoft Teams team id is safe for a Graph URL path", () => {
    test.each<[string, string]>(FORBIDDEN_GRAPH_PATH_CHARACTERS)(
      "rejects a teamId containing %s",
      async (_description: string, character: string): Promise<void> => {
        const mocks: Mocks = mockDeps({
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

        await expectBadData(
          sendTest({
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId: `aaaaaaaa-1111${character}2222-3333`,
            channelId: TEAMS_CHANNEL_ID,
          }),
          MSG_INVALID_TEAMS_TEAM,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );

    test.each<[string, string]>([
      ["a path traversal to another resource", "../../users"],
      ["an encoded path traversal", "team%2F..%2Fusers"],
      ["a smuggled query", `${TEAMS_TEAM_ID}?$select=id`],
      ["a smuggled fragment", `${TEAMS_TEAM_ID}#fragment`],
      ["a full URL", "https://graph.microsoft.com/v1.0/users"],
      ["513 characters", "t".repeat(513)],
    ])(
      "rejects a teamId that is %s",
      async (_description: string, teamId: string): Promise<void> => {
        const mocks: Mocks = mockDeps({
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

        await expectBadData(
          sendTest({
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId,
            channelId: TEAMS_CHANNEL_ID,
          }),
          MSG_INVALID_TEAMS_TEAM,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );

    test.each<[string, string]>(DOT_SEGMENT_IDS)(
      "rejects a teamId that is a dot segment (%s) before any lookup",
      async (_description: string, teamId: string): Promise<void> => {
        /*
         * Even a listing that would "contain" the channel for that team must
         * not be reached: the teamId goes into the listing URL itself.
         */
        const mocks: Mocks = mockDeps({
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamChannelsByTeamId: {
            [teamId.trim()]: teamListing(
              makeTeamChannel({
                id: TEAMS_CHANNEL_ID,
                name: TEAMS_CHANNEL_NAME,
              }),
            ),
          },
        });

        await expectBadData(
          sendTest({
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId,
            channelId: TEAMS_CHANNEL_ID,
          }),
          MSG_INVALID_TEAMS_TEAM,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );
  });

  describe("Microsoft Teams channel id is safe for a Graph URL path", () => {
    test.each<[string, string]>(FORBIDDEN_GRAPH_PATH_CHARACTERS)(
      "rejects a channelId containing %s",
      async (_description: string, character: string): Promise<void> => {
        const mocks: Mocks = mockDeps({
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

        await expectBadData(
          sendTest({
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId: TEAMS_TEAM_ID,
            channelId: `19:general${character}channel@thread.tacv2`,
          }),
          MSG_INVALID_TEAMS_CHANNEL,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );

    test.each<[string, string]>([
      ["a path into messages", "19:x@thread.tacv2/messages"],
      ["a path traversal", "19:x@thread.tacv2/../../../users"],
      ["a smuggled query", "19:x@thread.tacv2?$top=50"],
      ["an encoded slash", "19:x@thread.tacv2%2Fmessages"],
      ["513 characters", "19:" + "c".repeat(510)],
    ])(
      "rejects a channelId that is %s",
      async (_description: string, channelId: string): Promise<void> => {
        const mocks: Mocks = mockDeps({
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

        await expectBadData(
          sendTest({
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId: TEAMS_TEAM_ID,
            channelId,
          }),
          MSG_INVALID_TEAMS_CHANNEL,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );

    test.each<[string, string]>(DOT_SEGMENT_IDS)(
      "rejects a channelId that is a dot segment (%s) before any lookup",
      async (_description: string, channelId: string): Promise<void> => {
        // Rejected by format, not merely because the listing lacks it.
        const mocks: Mocks = mockDeps({
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamChannelsByTeamId: {
            [TEAMS_TEAM_ID]: teamListing(
              makeTeamChannel({ id: channelId.trim(), name: "Dots" }),
            ),
          },
        });

        await expectBadData(
          sendTest({
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId: TEAMS_TEAM_ID,
            channelId,
          }),
          MSG_INVALID_TEAMS_CHANNEL,
        );

        expectRejectedBeforeAnyWork(mocks);
      },
    );

    test("a dot-segment teamId is reported before a dot-segment channelId", async () => {
      const mocks: Mocks = mockDeps({
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

      await expectBadData(
        sendTest({
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: "..",
          channelId: ".",
        }),
        MSG_INVALID_TEAMS_TEAM,
      );

      expectRejectedBeforeAnyWork(mocks);
    });

    test("a bad teamId is reported before a bad channelId", async () => {
      const mocks: Mocks = mockDeps({
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

      await expectBadData(
        sendTest({
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: "team/x",
          channelId: "channel/y",
        }),
        MSG_INVALID_TEAMS_TEAM,
      );

      expectRejectedBeforeAnyWork(mocks);
    });
  });

  describe("Microsoft Teams chat id length", () => {
    test("rejects a chat id over 1024 characters", async () => {
      const chatId: string = "19:" + "c".repeat(1022);
      expect(chatId).toHaveLength(1025);

      const mocks: Mocks = mockDeps({
        workspaceType: WorkspaceType.MicrosoftTeams,
        availableChats: {
          [chatId]: makeChat({ id: chatId, name: "Too Long" }),
        },
      });

      await expectBadData(
        sendTest({ workspaceType: WorkspaceType.MicrosoftTeams, chatId }),
        MSG_INVALID_TEAMS_CHAT,
      );

      expectRejectedBeforeAnyWork(mocks);
    });

    test("rejects a very long chat id", async () => {
      const mocks: Mocks = mockDeps({
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

      await expectBadData(
        sendTest({
          workspaceType: WorkspaceType.MicrosoftTeams,
          chatId: "x".repeat(100000),
        }),
        MSG_INVALID_TEAMS_CHAT,
      );

      expectRejectedBeforeAnyWork(mocks);
    });
  });
});

// ========================================================= not connected

describe("sendTestNotificationToDestination: project not connected", () => {
  test.each(DESTINATIONS)(
    "$label: no project auth record",
    async (destination: DestinationCase): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: destination.workspaceType,
        connection: "not-connected",
      });

      await expectBadData(
        sendTest(destination.args),
        notConnectedMessage(destination.displayName),
      );

      expect(mocks.getProjectAuthSpy).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceType: destination.workspaceType,
      });
      // No token, so no Teams channel listing either.
      expect(mocks.listTeamChannelsSpy).not.toHaveBeenCalled();
      expectNothingSentOrLogged(mocks);
    },
  );

  test.each(DESTINATIONS)(
    "$label: auth record without an auth token",
    async (destination: DestinationCase): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: destination.workspaceType,
        connection: "no-auth-token",
      });

      await expectBadData(
        sendTest(destination.args),
        notConnectedMessage(destination.displayName),
      );

      expect(mocks.listTeamChannelsSpy).not.toHaveBeenCalled();
      expectNothingSentOrLogged(mocks);
    },
  );

  test("the Slack message names Slack, not Microsoft Teams", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      connection: "not-connected",
    });

    const err: Error = await captureError(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
    );

    expect(err.message).toContain("Slack");
    expect(err.message).not.toContain("Microsoft Teams");
  });

  test("the Microsoft Teams message names Microsoft Teams, not Slack", async () => {
    mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      connection: "not-connected",
    });

    const err: Error = await captureError(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
    );

    expect(err.message).toContain("Microsoft Teams");
    expect(err.message).not.toContain("Slack");
  });

  test("an empty-string auth token counts as not connected", async () => {
    const mocks: Mocks = mockDeps({ workspaceType: WorkspaceType.Slack });

    const auth: WorkspaceProjectAuthToken = makeProjectAuth({
      workspaceType: WorkspaceType.Slack,
      authToken: "",
    });
    mocks.getProjectAuthSpy.mockResolvedValue(auth);

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      notConnectedMessage("Slack"),
    );

    expectNothingSentOrLogged(mocks);
  });
});

// ================================================== chat not connected

describe("sendTestNotificationToDestination: chat is not one of the project's connected chats", () => {
  test("a chat id missing from the connected chats is rejected", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: "19:someone-elses-chat@thread.v2",
      }),
      MSG_CHAT_NOT_CONNECTED,
    );

    expect(mocks.connectedChatsSpy).toHaveBeenCalled();
    expectNothingSentOrLogged(mocks);
  });

  test("an empty connected-chat list rejects every chat", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      availableChats: {},
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: TEAMS_CHAT_ID,
      }),
      MSG_CHAT_NOT_CONNECTED,
    );

    expectNothingSentOrLogged(mocks);
  });

  test("an auth record with no misc data (no chats captured yet) rejects the chat", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      availableChats: null,
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: TEAMS_CHAT_ID,
      }),
      MSG_CHAT_NOT_CONNECTED,
    );

    expectNothingSentOrLogged(mocks);
  });

  test("the lookup is by id: a chat with the same NAME but a different id does not count", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      availableChats: {
        "19:other@thread.v2": makeChat({
          id: "19:other@thread.v2",
          name: TEAMS_CHAT_NAME,
        }),
      },
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: TEAMS_CHAT_ID,
      }),
      MSG_CHAT_NOT_CONNECTED,
    );

    expectNothingSentOrLogged(mocks);
  });

  test("the lookup is case-sensitive", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: TEAMS_CHAT_ID.toUpperCase(),
      }),
      MSG_CHAT_NOT_CONNECTED,
    );

    expectNothingSentOrLogged(mocks);
  });

  /*
   * The bot is shared across tenants; a project may only post to chats it
   * captured. Object prototype keys are "in" every plain object, so they must
   * not be mistaken for a captured chat.
   */
  test.each<[string]>([
    ["__proto__"],
    ["constructor"],
    ["toString"],
    ["hasOwnProperty"],
  ])(
    "a prototype key (%s) is not a connected chat",
    async (chatId: string): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

      await expectBadData(
        sendTest({ workspaceType: WorkspaceType.MicrosoftTeams, chatId }),
        MSG_CHAT_NOT_CONNECTED,
      );

      expectNothingSentOrLogged(mocks);
    },
  );

  test("project connection is checked before the chat list", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      connection: "not-connected",
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: "19:unknown@thread.v2",
      }),
      notConnectedMessage("Microsoft Teams"),
    );

    expectNothingSentOrLogged(mocks);
  });
});

// ======================================================= delivery errors

describe("sendTestNotificationToDestination: provider reports delivery errors", () => {
  test("Slack: throws with #name and the provider error, and logs the failure", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          errors: [
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              error: "not_in_channel",
            },
          ],
        }),
      ],
    });

    const err: Error = await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      `Could not send the test notification to #${SLACK_CHANNEL_NAME}. not_in_channel`,
    );

    expect(err.message).toContain(`#${SLACK_CHANNEL_NAME}`);
    expect(err.message).toContain("not_in_channel");

    expect(mocks.createLogSpy).toHaveBeenCalledTimes(1);
    const log: WorkspaceNotificationLog = loggedEntries(mocks)[0]!;
    expect(log.status).toBe(WorkspaceNotificationStatus.Error);
    expect(log.statusMessage).toBe("not_in_channel");
    expect(log.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(log.workspaceType).toBe(WorkspaceType.Slack);
    expect(log.channelId).toBe(SLACK_CHANNEL_ID);
    expect(log.channelName).toBe(SLACK_CHANNEL_NAME);
    expect(log.userId?.toString()).toBe(TEST_BY_USER_ID.toString());
    expect(log.actionType).toBe(WorkspaceNotificationActionType.SendMessage);
    expect(log.message).toBe(FULL_CHANNEL_MARKDOWN);
    expect(successLogs(mocks)).toHaveLength(0);
  });

  test("Microsoft Teams channel: throws with the quoted name and the provider error", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          errors: [
            {
              id: TEAMS_CHANNEL_ID,
              name: TEAMS_CHANNEL_NAME,
              error: "The bot is not part of the conversation roster.",
            },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      `Could not send the test notification to "${TEAMS_CHANNEL_NAME}". The bot is not part of the conversation roster.`,
    );

    const failures: Array<WorkspaceNotificationLog> = errorLogs(mocks);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.statusMessage).toBe(
      "The bot is not part of the conversation roster.",
    );
    expect(failures[0]!.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(failures[0]!.channelId).toBe(TEAMS_CHANNEL_ID);
    expect(successLogs(mocks)).toHaveLength(0);
  });

  test("Microsoft Teams chat: logs the failure and throws with the chat's quoted name", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          errors: [
            {
              id: TEAMS_CHAT_ID,
              name: TEAMS_CHAT_NAME,
              error: "Forbidden",
            },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: TEAMS_CHAT_ID,
      }),
      `Could not send the test notification to "${TEAMS_CHAT_NAME}". Forbidden`,
    );

    const failures: Array<WorkspaceNotificationLog> = errorLogs(mocks);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.statusMessage).toBe("Forbidden");
    expect(failures[0]!.channelId).toBe(TEAMS_CHAT_ID);
    expect(successLogs(mocks)).toHaveLength(0);
  });

  test("several errors: one failure log each, and every error in the message", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          errors: [
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              error: "not_in_channel",
            },
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              error: "rate_limited",
            },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      `Could not send the test notification to #${SLACK_CHANNEL_NAME}. not_in_channel; rate_limited`,
    );

    const failures: Array<WorkspaceNotificationLog> = errorLogs(mocks);
    expect(failures).toHaveLength(2);
    expect(
      failures.map((log: WorkspaceNotificationLog) => {
        return log.statusMessage;
      }),
    ).toEqual(["not_in_channel", "rate_limited"]);
  });

  test("Slack: with no channel name reported, the label falls back to #<id>", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          errors: [
            { id: SLACK_CHANNEL_ID, name: "", error: "channel_not_found" },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      `Could not send the test notification to #${SLACK_CHANNEL_ID}. channel_not_found`,
    );
  });

  test("Microsoft Teams channel: with no name listed or reported, the label falls back to the quoted id", async () => {
    mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamChannelsByTeamId: {
        [TEAMS_TEAM_ID]: teamListing(
          makeTeamChannel({ id: TEAMS_CHANNEL_ID, name: "" }),
        ),
      },
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          errors: [{ id: TEAMS_CHANNEL_ID, name: "", error: "NotFound" }],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      `Could not send the test notification to "${TEAMS_CHANNEL_ID}". NotFound`,
    );
  });

  test("Microsoft Teams channel: with no name listed, the name the provider reported is used", async () => {
    mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamChannelsByTeamId: {
        [TEAMS_TEAM_ID]: teamListing(
          makeTeamChannel({ id: TEAMS_CHANNEL_ID, name: "" }),
        ),
      },
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          errors: [
            { id: TEAMS_CHANNEL_ID, name: "Reported Name", error: "NotFound" },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      `Could not send the test notification to "Reported Name". NotFound`,
    );
  });

  test("errors win over threads: a partial success is still reported as a failure", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          threads: [
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              threadId: "t-1",
            },
          ],
          errors: [
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              error: "msg_too_long",
            },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      `Could not send the test notification to #${SLACK_CHANNEL_NAME}. msg_too_long`,
    );

    expect(successLogs(mocks)).toHaveLength(0);
    expect(errorLogs(mocks)).toHaveLength(1);
  });

  test("the send is attempted exactly once; a reported error is not retried", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          errors: [
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              error: "not_in_channel",
            },
          ],
        }),
      ],
    });

    await captureError(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
    );

    expect(mocks.postSpy).toHaveBeenCalledTimes(1);
  });

  test("a failure-log write that fails does not mask the delivery error", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      logWriteFails: true,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          errors: [
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              error: "not_in_channel",
            },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      `Could not send the test notification to #${SLACK_CHANNEL_NAME}. not_in_channel`,
    );

    expect(mocks.createLogSpy).toHaveBeenCalled();
  });

  test("only the response for the requested workspace type is read", async () => {
    // A Microsoft Teams error in the batch must not fail a Slack test.
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          errors: [{ id: TEAMS_CHANNEL_ID, name: "Other", error: "unrelated" }],
        }),
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          threads: [
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              threadId: "slack-thread",
            },
          ],
        }),
      ],
    });

    const thread: WorkspaceThread = await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(thread.threadId).toBe("slack-thread");
    expect(errorLogs(mocks)).toHaveLength(0);
    expect(successLogs(mocks)).toHaveLength(1);
  });
});

// ========================================================== nothing sent

/*
 * WorkspaceNotificationLog.channelId / channelName are 100-character columns
 * and statusMessage is 500. The insert rejects an over-long field outright and
 * the best-effort logging swallows that, so without truncation the row simply
 * vanishes - and Microsoft's "app is not installed in this team" explanation
 * alone is longer than 500 characters.
 */
describe("sendTestNotificationToDestination: log fields are cut to their column limits", () => {
  const LONG_PROVIDER_ERROR: string = "E".repeat(650);
  const LONG_NAME: string = "n".repeat(150);
  const LONG_ID: string = "C".repeat(150);

  test("a failure log keeps the first 500 characters of the provider error and 100 of the channel name", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          errors: [
            {
              id: SLACK_CHANNEL_ID,
              name: LONG_NAME,
              error: LONG_PROVIDER_ERROR,
            },
          ],
        }),
      ],
    });

    const err: Error = await captureError(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
    );

    // The caller still sees the whole explanation.
    expect(err).toBeInstanceOf(BadDataException);
    expect(err.message).toContain(LONG_PROVIDER_ERROR);

    const failures: Array<WorkspaceNotificationLog> = errorLogs(mocks);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.statusMessage).toBe(
      LONG_PROVIDER_ERROR.substring(0, 500),
    );
    expect(failures[0]!.channelName).toBe(LONG_NAME.substring(0, 100));
    expect(failures[0]!.channelId).toBe(SLACK_CHANNEL_ID);
  });

  test("a failure with an empty provider error is still logged with a readable status message", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          errors: [
            {
              id: SLACK_CHANNEL_ID,
              name: SLACK_CHANNEL_NAME,
              error: "",
            },
          ],
        }),
      ],
    });

    await captureError(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
    );

    const failures: Array<WorkspaceNotificationLog> = errorLogs(mocks);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.statusMessage).toBe("Failed to send message");
  });

  test("a success log keeps the first 100 characters of the channel id and name", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.Slack,
          threads: [
            {
              id: LONG_ID,
              name: LONG_NAME,
              threadId: "1726000000.000100",
            },
          ],
        }),
      ],
    });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    const successes: Array<WorkspaceNotificationLog> = successLogs(mocks);
    expect(successes).toHaveLength(1);
    expect(successes[0]!.channelId).toBe(LONG_ID.substring(0, 100));
    expect(successes[0]!.channelName).toBe(LONG_NAME.substring(0, 100));
    expect(successes[0]!.threadId).toBe("1726000000.000100");
  });
});

describe("sendTestNotificationToDestination: a send that went nowhere is a failure", () => {
  test.each(DESTINATIONS)(
    "$label: an empty response array",
    async (destination: DestinationCase): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: destination.workspaceType,
        responses: [],
      });

      /*
       * A chat's name comes from the captured chats and a Teams channel's
       * from the team's channel listing, both known before sending. Only a
       * Slack channel's name would come back from the send, so with nothing
       * sent it is labelled by its id.
       */
      const expectedName: string =
        destination.kind === "chat"
          ? TEAMS_CHAT_NAME
          : destination.workspaceType === WorkspaceType.Slack
            ? destination.destinationId
            : TEAMS_CHANNEL_NAME;

      const expectedLabel: string =
        destination.workspaceType === WorkspaceType.Slack
          ? `#${expectedName}`
          : `"${expectedName}"`;

      await expectBadData(
        sendTest(destination.args),
        reconnectMessage({
          destinationLabel: expectedLabel,
          displayName: destination.displayName,
        }),
      );

      expect(successLogs(mocks)).toHaveLength(0);

      const failures: Array<WorkspaceNotificationLog> = errorLogs(mocks);
      expect(failures).toHaveLength(1);
      expect(failures[0]!.channelId).toBe(destination.destinationId);
      expect(failures[0]!.channelName).toBe(expectedName);
      expect(failures[0]!.workspaceType).toBe(destination.workspaceType);
      expect(failures[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(failures[0]!.userId?.toString()).toBe(TEST_BY_USER_ID.toString());
      expect(failures[0]!.actionType).toBe(
        WorkspaceNotificationActionType.SendMessage,
      );
      expect(failures[0]!.message).toBe(
        destination.kind === "chat"
          ? FULL_CHAT_MARKDOWN
          : FULL_CHANNEL_MARKDOWN,
      );
      expect(failures[0]!.statusMessage).toBeTruthy();
    },
  );

  test("a response for the workspace with no threads and no errors", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [makeSendResponse({ workspaceType: WorkspaceType.Slack })],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      reconnectMessage({
        destinationLabel: `#${SLACK_CHANNEL_ID}`,
        displayName: "Slack",
      }),
    );

    expect(errorLogs(mocks)).toHaveLength(1);
    expect(successLogs(mocks)).toHaveLength(0);
  });

  test("a response with an explicitly empty errors array and no threads", async () => {
    const response: WorkspaceSendMessageResponse = makeSendResponse({
      workspaceType: WorkspaceType.MicrosoftTeams,
      errors: [],
    });
    expect(response.errors).toEqual([]);

    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      responses: [response],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      reconnectMessage({
        destinationLabel: `"${TEAMS_CHANNEL_NAME}"`,
        displayName: "Microsoft Teams",
      }),
    );

    expect(errorLogs(mocks)).toHaveLength(1);
  });

  test("a response only for a different workspace type counts as nothing sent", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [
        makeSendResponse({
          workspaceType: WorkspaceType.MicrosoftTeams,
          threads: [
            { id: TEAMS_CHANNEL_ID, name: "General", threadId: "teams-t" },
          ],
        }),
      ],
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      reconnectMessage({
        destinationLabel: `#${SLACK_CHANNEL_ID}`,
        displayName: "Slack",
      }),
    );

    expect(successLogs(mocks)).toHaveLength(0);
  });

  test("the chat's failure log names the chat", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      responses: [],
    });

    await captureError(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: TEAMS_CHAT_ID,
      }),
    );

    expect(errorLogs(mocks)[0]!.channelName).toBe(TEAMS_CHAT_NAME);
  });

  test("a failure-log write that fails does not mask the reconnect error", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      responses: [],
      logWriteFails: true,
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      reconnectMessage({
        destinationLabel: `#${SLACK_CHANNEL_ID}`,
        displayName: "Slack",
      }),
    );

    expect(mocks.createLogSpy).toHaveBeenCalled();
  });
});

// ============================================================ send throws

describe("sendTestNotificationToDestination: the send call itself throws", () => {
  test("a plain Error becomes a BadDataException with the prefix and the reason", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      postRejects: { error: new Error("boom") },
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      `${SEND_FAILED_PREFIX} boom`,
    );
  });

  test("a downstream BadDataException keeps its meaningful message, prefixed exactly once", async () => {
    mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      postRejects: {
        error: new BadDataException(
          "Team ID is required to send message to Microsoft Teams channel.",
        ),
      },
    });

    /*
     * Pinned exactly: rethrowing the downstream exception untouched would
     * still "contain" its text but lose the prefix that tells the admin it
     * was the send that failed.
     */
    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      `${SEND_FAILED_PREFIX} Team ID is required to send message to Microsoft Teams channel.`,
    );
  });

  test("a BadDataException that already carries the prefix is not double-prefixed", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      postRejects: {
        error: new BadDataException(
          `${SEND_FAILED_PREFIX} The bot token has been revoked.`,
        ),
      },
    });

    const err: Error = await captureError(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
    );

    expect(err).toBeInstanceOf(BadDataException);
    expect(countOccurrences(err.message, SEND_FAILED_PREFIX)).toBe(1);
    expect(err.message).toContain("The bot token has been revoked.");
  });

  test("a thrown string still produces a readable message", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      postRejects: { error: "socket hang up" },
    });

    const err: Error = await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      /socket hang up/,
    );

    expect(err.message.startsWith(SEND_FAILED_PREFIX)).toBe(true);
  });

  test("a thrown plain object with a message is not '[object Object]'", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      postRejects: { error: { message: "invalid_auth", statusCode: 401 } },
    });

    const err: Error = await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      `${SEND_FAILED_PREFIX} invalid_auth`,
    );

    expect(err.message).not.toContain("[object Object]");
  });

  /*
   * Slack's send helpers `throw response` - an HTTPErrorResponse, which is
   * not an Error but has a `message` getter - so a 429 or 5xx must surface
   * its message rather than "[object Object]".
   */
  test("a thrown HTTPErrorResponse yields its message, prefixed once", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      postRejects: {
        error: new HTTPErrorResponse(429, { error: "ratelimited" }, {}),
      },
    });

    const err: Error = await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      `${SEND_FAILED_PREFIX} ratelimited`,
    );

    expect(err.message).not.toContain("[object Object]");
    expect(countOccurrences(err.message, SEND_FAILED_PREFIX)).toBe(1);
  });

  test("a thrown HTTPErrorResponse with a nested Graph error yields the nested message", async () => {
    mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      postRejects: {
        error: new HTTPErrorResponse(
          503,
          {
            error: {
              code: "ServiceUnavailable",
              message: "The service is temporarily unavailable.",
            },
          },
          {},
        ),
      },
    });

    const err: Error = await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
      `${SEND_FAILED_PREFIX} The service is temporarily unavailable.`,
    );

    expect(err.message).not.toContain("[object Object]");
  });

  test("a thrown HTTPErrorResponse with no body message reports its HTTP status", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      postRejects: { error: new HTTPErrorResponse(500, {}, {}) },
    });

    await expectBadData(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
      `${SEND_FAILED_PREFIX} Request failed with HTTP status 500`,
    );
  });

  test("an Error with no message still yields a clean, meaningful message", async () => {
    mockDeps({
      workspaceType: WorkspaceType.Slack,
      postRejects: { error: new Error("") },
    });

    const err: Error = await captureError(
      sendTest({
        workspaceType: WorkspaceType.Slack,
        channelId: SLACK_CHANNEL_ID,
      }),
    );

    expect(err).toBeInstanceOf(BadDataException);
    expect(err.message).toBe(`${SEND_FAILED_PREFIX} ${UNKNOWN_ERROR_REASON}`);
  });

  test.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
  ])(
    "a thrown %s yields the unknown-error message",
    async (_description: string, thrown: unknown): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: WorkspaceType.Slack,
        postRejects: { error: thrown },
      });

      const err: Error = await expectBadData(
        sendTest({
          workspaceType: WorkspaceType.Slack,
          channelId: SLACK_CHANNEL_ID,
        }),
        `${SEND_FAILED_PREFIX} ${UNKNOWN_ERROR_REASON}`,
      );

      expect(err.message).not.toContain("null");
      expect(err.message).not.toContain("undefined");
      expect(successLogs(mocks)).toHaveLength(0);
    },
  );

  test("a throwing send is not recorded as a success", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      postRejects: { error: new Error("ECONNRESET") },
    });

    await captureError(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        chatId: TEAMS_CHAT_ID,
      }),
    );

    expect(mocks.postSpy).toHaveBeenCalledTimes(1);
    expect(successLogs(mocks)).toHaveLength(0);
  });
});

// ================================================== best-effort lookups

describe("sendTestNotificationToDestination: project / user lookups are best-effort", () => {
  test("a project lookup that throws omits the project fragment and still sends", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      projectLookupFails: true,
    });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    const text: string = markdownOf(onlyPayload(mocks));
    expect(text).not.toContain("from the OneUptime project");
    expect(text).toContain(` by ${USER_MARKDOWN}`);
    expect(text).toBe(NO_PROJECT_CHANNEL_MARKDOWN);
    expect(mocks.loggerErrorSpy).toHaveBeenCalled();
    expect(successLogs(mocks)).toHaveLength(1);
  });

  test("a project lookup that returns null omits the project fragment", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      projectName: null,
    });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(markdownOf(onlyPayload(mocks))).toBe(NO_PROJECT_CHANNEL_MARKDOWN);
  });

  test("a project with an empty name omits the project fragment", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      projectName: "",
    });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    const text: string = markdownOf(onlyPayload(mocks));
    expect(text).not.toContain("****");
    expect(text).toBe(NO_PROJECT_CHANNEL_MARKDOWN);
  });

  test("a user lookup that throws omits the 'by' fragment and still sends", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      userLookupFails: true,
    });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    const text: string = markdownOf(onlyPayload(mocks));
    expect(text).not.toContain(" by ");
    expect(text).toContain(`from the OneUptime project **${PROJECT_NAME}**`);
    expect(text).toBe(NO_USER_CHANNEL_MARKDOWN);
    expect(mocks.loggerErrorSpy).toHaveBeenCalled();
    expect(successLogs(mocks)).toHaveLength(1);
  });

  test("a user lookup that returns an empty string omits the 'by' fragment", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.Slack,
      userMarkdown: "",
    });

    await sendTest({
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_CHANNEL_ID,
    });

    expect(markdownOf(onlyPayload(mocks))).toBe(NO_USER_CHANNEL_MARKDOWN);
  });

  test("both lookups failing still sends the bare message", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectLookupFails: true,
      userLookupFails: true,
    });

    const thread: WorkspaceThread = await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
    });

    expect(thread).toBeDefined();
    expect(markdownOf(onlyPayload(mocks))).toBe(BARE_CHANNEL_MARKDOWN);
    expect(loggedEntries(mocks)[0]!.message).toBe(BARE_CHANNEL_MARKDOWN);
  });

  test("a chat test with both lookups failing still says 'this chat'", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectName: null,
      userMarkdown: "",
    });

    await sendTest({
      workspaceType: WorkspaceType.MicrosoftTeams,
      chatId: TEAMS_CHAT_ID,
    });

    expect(markdownOf(onlyPayload(mocks))).toBe(
      "**Test notification from OneUptime**\n\n" +
        "This is a test notification sent. " +
        "If you can see this message, OneUptime can post notifications to this chat. No action is needed.",
    );
  });
});

// ================================================== success-log failure

describe("sendTestNotificationToDestination: a success-log write failure is not a send failure", () => {
  test.each(DESTINATIONS)(
    "$label: still resolves with the thread",
    async (destination: DestinationCase): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: destination.workspaceType,
        logWriteFails: true,
        responses: [
          makeSendResponse({
            workspaceType: destination.workspaceType,
            threads: [destination.thread],
          }),
        ],
      });

      const thread: WorkspaceThread = await sendTest(destination.args);

      expect(thread.threadId).toBe(destination.thread.threadId);
      expect(thread.channel.id).toBe(destination.thread.id);
      expect(mocks.postSpy).toHaveBeenCalledTimes(1);
      expect(mocks.createLogSpy).toHaveBeenCalledTimes(1);
      expect(mocks.loggerErrorSpy).toHaveBeenCalled();
    },
  );
});

// =============================================== isolation from testRule

describe("sendTestNotificationToDestination: never touches the testRule machinery", () => {
  test.each(DESTINATIONS)(
    "$label: no rule is loaded, no channel created, nobody invited",
    async (destination: DestinationCase): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: destination.workspaceType,
        responses: [
          makeSendResponse({
            workspaceType: destination.workspaceType,
            threads: [destination.thread],
          }),
        ],
      });

      await sendTest(destination.args);

      expect(mocks.testRuleSpy).not.toHaveBeenCalled();
      expect(mocks.ruleFindOneByIdSpy).not.toHaveBeenCalled();
      expect(mocks.createChannelsSpy).not.toHaveBeenCalled();
      expect(mocks.inviteUsersSpy).not.toHaveBeenCalled();
    },
  );

  test("a failing destination test does not fall back to the testRule machinery", async () => {
    const mocks: Mocks = mockDeps({
      workspaceType: WorkspaceType.MicrosoftTeams,
      responses: [],
    });

    await captureError(
      sendTest({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
      }),
    );

    expect(mocks.testRuleSpy).not.toHaveBeenCalled();
    expect(mocks.createChannelsSpy).not.toHaveBeenCalled();
    expect(mocks.inviteUsersSpy).not.toHaveBeenCalled();
  });
});

// ======================================================== all destinations

describe("sendTestNotificationToDestination: invariants for every destination", () => {
  test.each(DESTINATIONS)(
    "$label: one send, one payload, one Success log, thread returned",
    async (destination: DestinationCase): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: destination.workspaceType,
        responses: [
          makeSendResponse({
            workspaceType: destination.workspaceType,
            threads: [destination.thread],
          }),
        ],
      });

      const thread: WorkspaceThread = await sendTest(destination.args);

      const payload: WorkspaceMessagePayload = onlyPayload(mocks);
      expect(payload.workspaceType).toBe(destination.workspaceType);
      expect(markdownOf(payload)).toContain(`this ${destination.kind}`);

      const addressed: Array<string> = [
        ...(payload.channelIds || []),
        ...(payload.chatIds || []),
      ];
      expect(addressed).toEqual([destination.destinationId]);

      expect(thread.threadId).toBe(destination.thread.threadId);
      expect(mocks.createLogSpy).toHaveBeenCalledTimes(1);
      expect(successLogs(mocks)).toHaveLength(1);
      expect(errorLogs(mocks)).toHaveLength(0);

      // Only a Microsoft Teams channel needs the team's channel listing.
      if (
        destination.workspaceType === WorkspaceType.MicrosoftTeams &&
        destination.kind === "channel"
      ) {
        expectTeamListedOnce(mocks, TEAMS_TEAM_ID);
      } else {
        expect(mocks.listTeamChannelsSpy).not.toHaveBeenCalled();
      }
    },
  );

  test.each(DESTINATIONS)(
    "$label: the project auth is loaded before anything is sent",
    async (destination: DestinationCase): Promise<void> => {
      const mocks: Mocks = mockDeps({
        workspaceType: destination.workspaceType,
        responses: [
          makeSendResponse({
            workspaceType: destination.workspaceType,
            threads: [destination.thread],
          }),
        ],
      });

      await sendTest(destination.args);

      const authOrder: number =
        mocks.getProjectAuthSpy.mock.invocationCallOrder[0]!;
      const sendOrder: number = mocks.postSpy.mock.invocationCallOrder[0]!;
      expect(authOrder).toBeLessThan(sendOrder);
    },
  );
});
