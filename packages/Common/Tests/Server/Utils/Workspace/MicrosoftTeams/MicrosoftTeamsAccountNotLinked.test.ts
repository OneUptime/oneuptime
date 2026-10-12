import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #4111: "create incident" and "create maintenance" in Microsoft Teams
 * answered "Sorry, I encountered an error processing your request" - twice.
 * Part of the fix is that the bot checks the sender before it sends either
 * form, and the commonest reason a sender cannot use a form is that they
 * never connected their Microsoft Teams account to OneUptime.
 *
 * MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId used to throw a
 * plain BadDataException for that and log it with logger.error. So a card
 * button pressed by such a user was answered "Sorry, that action failed.
 * Please try again later.", and every press filled the server log with an
 * error that was not one.
 *
 * It now throws MicrosoftTeamsAccountNotLinkedException, logged at debug.
 * That is still a BadDataException with the same message, so whatever
 * handled the old exception handles this one. A failure to read the link
 * table is not "not linked": it is rethrown as it was and logged as an error,
 * so the bot need not tell a linked user to connect an account they have
 * connected.
 *
 * The first half pins the lookup, with WorkspaceUserAuthTokenService stubbed.
 * The second runs the real lookup under the places that turn the exception
 * into guidance - a card button (handleBotInvokeActivity), the create
 * commands (MicrosoftTeamsCreateCommands) and the AI assistant ("ask ...",
 * through handleBotMessageActivity) - with only the link table, the tenant
 * and the dashboard URL stubbed (and the cache kept in memory). Each answers
 * with a card that mentions who pressed and asks them to connect their
 * account for what they pressed, with a one-click Connect button that
 * carries the press (MicrosoftTeamsConnectPrompt), and takes nothing else
 * for "not linked".
 *
 * The AI assistant used to answer every lookup failure - a database error
 * included - with "Please connect your Microsoft Teams account in OneUptime
 * User Settings", so it told a linked user to connect the account they had
 * connected. It now answers only the not-linked exception, and rethrows
 * anything else, which the message handler answers with its one generic
 * reply and logs by the command, never by the question.
 *
 * The create commands check the sender only in a personal chat, where the
 * sender is the one who will submit the form. In a team channel or a group
 * chat anyone there may submit it, so the form is posted without looking the
 * sender up, and the submit checks whoever submits it.
 */

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

/*
 * Same botbuilder module factory as MicrosoftTeamsTeamInstalls.test.ts: the
 * repo-wide manual mock (Tests/__mocks__/botbuilder.js) does not expose
 * TeamsInfo or MessageFactory.attachment, both of which MicrosoftTeams.ts
 * touches at import time.
 */
jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: {
      text: jest.fn(),
      attachment: jest.fn((attachment: unknown) => {
        return { type: "message", attachments: [attachment] };
      }),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
    },
  };
});

jest.mock("../../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../../API/WorkspaceOAuthTestHelpers") as Record<
        string,
        () => unknown
      >
    )["createInMemoryGlobalCache"]!(),
  };
});

import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import AIService from "../../../../../Server/Services/AIService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import logger, { LogAttributes } from "../../../../../Server/Utils/Logger";
import {
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions, {
  MicrosoftTeamsNewIncidentFormChoices,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions, {
  MicrosoftTeamsNewScheduledMaintenanceFormChoices,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { MicrosoftTeamsCardChoiceList } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import MicrosoftTeamsCreateCommands from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCreateCommands";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
  WorkspacePendingActionKind,
} from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { WorkspaceEventType } from "../../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import URL from "../../../../../Types/API/URL";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import ExceptionCode from "../../../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../../../Types/Workspace/ConnectCallback";

const PROJECT_ID: ObjectID = new ObjectID(
  "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f",
);
const LINKED_USER_ID: ObjectID = new ObjectID(
  "d2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f6a",
);

// The sender as Teams names them (from.aadObjectId), and their tenant.
const TEAMS_USER_ID: string = "e3f4a5b6-c7d8-4e9f-8a1b-2c3d4e5f6a7b";
const TENANT_ID: string = "f4a5b6c7-d8e9-4f0a-9b2c-3d4e5f6a7b8c";

const INCIDENT_ID: string = "a5b6c7d8-e9f0-4a1b-8c3d-4e5f6a7b8c9d";
const SEVERITY_ID: string = "b6c7d8e9-f0a1-4b2c-9d3e-5f6a7b8c9d0e";

// The message the exception carried before the fix, and still carries.
const NOT_LINKED_MESSAGE: string =
  "No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.";

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const SETTINGS_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/microsoft-teams-integration`;

// Where the log lines say it happened.
const LOG_ATTRIBUTES: JSONObject = {
  projectId: PROJECT_ID.toString(),
  workspaceUserId: TEAMS_USER_ID,
};
const NOT_LINKED_LOG_LINE: string = `No OneUptime user linked to Teams user: ${TEAMS_USER_ID}`;
const LOOKUP_FAILED_LOG_LINE: string = `Error finding OneUptime user for Teams user: ${TEAMS_USER_ID}`;

function lookUpTeamsUser(): Promise<ObjectID> {
  return MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
    teamsUserId: TEAMS_USER_ID,
    projectId: PROJECT_ID,
  });
}

// A WorkspaceUserAuthToken row: the link between a Teams and a OneUptime user.
function linkRow(userId?: ObjectID): WorkspaceUserAuthToken {
  const row: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
  row.workspaceUserId = TEAMS_USER_ID;
  row.projectId = PROJECT_ID;
  row.workspaceType = WorkspaceType.MicrosoftTeams;

  if (userId) {
    row.userId = userId;
  }

  return row;
}

// What a promise that must fail was rejected with.
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to be rejected, but it resolved.");
}

type LinkTableSpy = SpyInstance<typeof WorkspaceUserAuthTokenService.findOneBy>;

function stubLinkTable(row: WorkspaceUserAuthToken | null): LinkTableSpy {
  return jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockResolvedValue(row);
}

function stubUnreadableLinkTable(error: unknown): LinkTableSpy {
  return jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockRejectedValue(error);
}

interface UnlinkedCase {
  name: string;
  row: () => WorkspaceUserAuthToken | null;
}

const UNLINKED: ReadonlyArray<UnlinkedCase> = [
  {
    name: "no link for this Teams user in this project",
    row: (): WorkspaceUserAuthToken | null => {
      return null;
    },
  },
  {
    name: "a link that names no OneUptime user",
    row: (): WorkspaceUserAuthToken | null => {
      return linkRow();
    },
  },
];

interface LookupFailureCase {
  name: string;
  error: () => unknown;
  // How a log line names it (MicrosoftTeamsReplies.describeError).
  described: string;
}

const LOOKUP_FAILURES: ReadonlyArray<LookupFailureCase> = [
  {
    name: "the database is unreachable",
    error: (): Error => {
      return new Error("Connection terminated unexpectedly");
    },
    described: "Error: Connection terminated unexpectedly",
  },
  {
    name: "the database rejects the query",
    error: (): Error => {
      return Object.assign(
        new Error('relation "WorkspaceUserAuthToken" does not exist'),
        { name: "QueryFailedError", code: "42P01" },
      );
    },
    described:
      'QueryFailedError 42P01: relation "WorkspaceUserAuthToken" does not exist',
  },
  {
    // The not-linked exception is a BadDataException; this one is not it.
    name: "the data layer throws a BadDataException of its own",
    error: (): BadDataException => {
      return new BadDataException("Invalid select: userId");
    },
    described: "BadDataException: Invalid select: userId",
  },
];

let debugLog: SpyInstance<typeof logger.debug>;
let errorLog: SpyInstance<typeof logger.error>;

/*
 * Every logger.error call, with exactly the arguments it was given. Copied
 * into arrays made here: jest records calls in arrays of its own realm,
 * which toStrictEqual would tell apart from the literals they are compared
 * with.
 */
function errorLogCalls(): Array<Array<unknown>> {
  return Array.from(
    errorLog.mock.calls,
    (call: Parameters<typeof logger.error>): Array<unknown> => {
      return [...call];
    },
  );
}

beforeEach((): void => {
  debugLog = jest.spyOn(logger, "debug").mockImplementation((): void => {});
  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId", (): void => {
  test("a linked Teams user resolves to the OneUptime user the link names, looked up by that Teams user in this project's Microsoft Teams links", async (): Promise<void> => {
    const row: WorkspaceUserAuthToken = linkRow(LINKED_USER_ID);
    const findOneBy: LinkTableSpy = stubLinkTable(row);

    const userId: ObjectID = await lookUpTeamsUser();

    expect(userId).toBe(row.userId);
    expect(userId.toString()).toBe(LINKED_USER_ID.toString());

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(findOneBy).toHaveBeenCalledWith({
      query: {
        workspaceUserId: TEAMS_USER_ID,
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.MicrosoftTeams,
      },
      select: {
        userId: true,
      },
      props: {
        isRoot: true,
      },
    });

    expect(errorLog).not.toHaveBeenCalled();
    expect(debugLog).not.toHaveBeenCalledWith(
      NOT_LINKED_LOG_LINE,
      expect.anything(),
    );
  });

  test.each(UNLINKED)(
    "$name: throws MicrosoftTeamsAccountNotLinkedException, still a BadDataException with the same message",
    async (unlinked: UnlinkedCase): Promise<void> => {
      stubLinkTable(unlinked.row());

      const error: unknown = await rejectionOf(lookUpTeamsUser());

      expect(error).toBeInstanceOf(MicrosoftTeamsAccountNotLinkedException);
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(NOT_LINKED_MESSAGE);
      expect((error as BadDataException).code).toBe(
        ExceptionCode.BadDataException,
      );
    },
  );

  test.each(UNLINKED)(
    "$name: logged at debug, as expected - not as a server error",
    async (unlinked: UnlinkedCase): Promise<void> => {
      stubLinkTable(unlinked.row());

      await rejectionOf(lookUpTeamsUser());

      // master: logger.error("Error finding OneUptime user ...") and the error.
      expect(errorLog).not.toHaveBeenCalled();
      expect(debugLog).toHaveBeenCalledWith(
        NOT_LINKED_LOG_LINE,
        LOG_ATTRIBUTES,
      );
    },
  );

  test.each(LOOKUP_FAILURES)(
    "$name: that error is rethrown as it is - never as 'not linked' - and logged as an error",
    async (failure: LookupFailureCase): Promise<void> => {
      const lookupError: unknown = failure.error();
      stubUnreadableLinkTable(lookupError);

      const error: unknown = await rejectionOf(lookUpTeamsUser());

      expect(error).toBe(lookupError);
      expect(error).not.toBeInstanceOf(MicrosoftTeamsAccountNotLinkedException);

      expect(errorLog).toHaveBeenCalledWith(
        LOOKUP_FAILED_LOG_LINE,
        LOG_ATTRIBUTES,
      );
      expect(errorLog).toHaveBeenCalledWith(lookupError);
      expect(debugLog).not.toHaveBeenCalledWith(
        NOT_LINKED_LOG_LINE,
        expect.anything(),
      );
    },
  );
});

describe("MicrosoftTeamsAccountNotLinkedException", (): void => {
  test("is a BadDataException, so whatever handles bad data still handles it", (): void => {
    const error: MicrosoftTeamsAccountNotLinkedException =
      new MicrosoftTeamsAccountNotLinkedException(NOT_LINKED_MESSAGE);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error).toBeInstanceOf(Exception);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(ExceptionCode.BadDataException);
    expect(error.message).toBe(NOT_LINKED_MESSAGE);

    // The bot shows a BadDataException's message to the user.
    expect(MicrosoftTeamsReplies.getUserFacingErrorMessage(error)).toBe(
      NOT_LINKED_MESSAGE,
    );
  });

  test("an ordinary BadDataException is not taken for it", (): void => {
    expect(new BadDataException(NOT_LINKED_MESSAGE)).not.toBeInstanceOf(
      MicrosoftTeamsAccountNotLinkedException,
    );
  });

  test("a log line names it by its class, not as a plain Error: OneUptime's exceptions keep Error's name", (): void => {
    const error: MicrosoftTeamsAccountNotLinkedException =
      new MicrosoftTeamsAccountNotLinkedException(NOT_LINKED_MESSAGE);

    expect(error.name).toBe("Error");
    expect(MicrosoftTeamsReplies.describeError(error)).toBe(
      `MicrosoftTeamsAccountNotLinkedException: ${NOT_LINKED_MESSAGE}`,
    );
    // So the log tells it apart from the BadDataException it extends.
    expect(
      MicrosoftTeamsReplies.describeError(
        new BadDataException(NOT_LINKED_MESSAGE),
      ),
    ).toBe(`BadDataException: ${NOT_LINKED_MESSAGE}`);
  });
});

interface FakeTurn {
  activity: JSONObject;
  turnContext: TurnContext;
  replies: Array<string>;
}

function createFakeTurn(activity: JSONObject): FakeTurn {
  const replies: Array<string> = [];

  const turnContext: TurnContext = {
    activity: activity,
    sendActivity: async (reply: unknown): Promise<{ id: string }> => {
      replies.push(typeof reply === "string" ? reply : JSON.stringify(reply));
      return { id: `reply-${replies.length}` };
    },
  } as unknown as TurnContext;

  return { activity: activity, turnContext: turnContext, replies: replies };
}

function fromSender(): JSONObject {
  return { id: "29:teams-user", aadObjectId: TEAMS_USER_ID, name: "Alex" };
}

// A card button press: Acknowledge on an incident notification.
function acknowledgeButtonActivity(): JSONObject {
  return {
    type: "invoke",
    name: "adaptiveCard/action",
    id: "1727611260456",
    value: {
      action: MicrosoftTeamsIncidentActionType.AckIncident,
      actionValue: INCIDENT_ID,
    },
    from: fromSender(),
    recipient: { id: "28:oneuptime-bot" },
    conversation: { conversationType: "personal", id: "a:personal-chat" },
    channelData: { tenant: { id: TENANT_ID } },
  };
}

function commandActivity(text: string): JSONObject {
  return {
    type: "message",
    id: "1727611290789",
    text: text,
    from: fromSender(),
    recipient: { id: "28:oneuptime-bot" },
    conversation: { conversationType: "personal", id: "a:personal-chat" },
    channelData: { tenant: { id: TENANT_ID } },
  };
}

// Conversations where anyone there can submit a form the bot posts.
type SharedConversation = "channel" | "groupChat";

const SHARED_CONVERSATIONS: Record<SharedConversation, JSONObject> = {
  channel: {
    conversation: {
      conversationType: "channel",
      id: "19:general@thread.tacv2;messageid=1727611290789",
      isGroup: true,
    },
    channelData: {
      tenant: { id: TENANT_ID },
      team: { id: "19:engineering@thread.tacv2" },
      channel: { id: "19:general@thread.tacv2" },
    },
  },
  groupChat: {
    conversation: {
      conversationType: "groupChat",
      id: "19:on-call-chat@thread.v2",
      isGroup: true,
    },
  },
};

// The same activity, in a team channel or a group chat.
function inSharedConversation(
  activity: JSONObject,
  where: SharedConversation,
): JSONObject {
  return { ...activity, ...SHARED_CONVERSATIONS[where] };
}

// A question for the AI assistant, typed to the bot in a personal chat.
function askActivity(activityId: string): JSONObject {
  return {
    type: "message",
    id: activityId,
    text: "ask why is checkout failing?",
    from: fromSender(),
    recipient: { id: "28:oneuptime-bot" },
    conversation: { conversationType: "personal", id: "a:personal-chat" },
    channelData: { tenant: { id: TENANT_ID } },
  };
}

// A card the bot replied with, read back from what the fake turn recorded.
interface CardReply {
  // The card's one text block: the mention, then the answer.
  text: string;
  // What a notification shows.
  summary: string;
  // The card's buttons.
  actions: Array<JSONObject>;
  // Who the card mentions.
  mentions: Array<JSONObject>;
  // Every element of the card's body that is not its text: a form's inputs.
  otherElements: Array<JSONObject>;
}

function readCardReply(reply: string | undefined): CardReply {
  const activity: JSONObject = JSON.parse(reply || "null") as JSONObject;
  const attachments: Array<JSONObject> = activity[
    "attachments"
  ] as Array<JSONObject>;

  expect(attachments).toHaveLength(1);
  expect(attachments[0]!["contentType"]).toBe(
    MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
  );

  const card: JSONObject = attachments[0]!["content"] as JSONObject;
  const body: Array<JSONObject> = card["body"] as Array<JSONObject>;

  expect(body[0]!["type"]).toBe("TextBlock");

  return {
    text: body[0]!["text"] as string,
    summary: activity["summary"] as string,
    actions: (card["actions"] as Array<JSONObject> | undefined) || [],
    mentions:
      ((card["msteams"] as JSONObject | undefined)?.["entities"] as
        | Array<JSONObject>
        | undefined) || [],
    otherElements: body.slice(1),
  };
}

// The sender, as every reply mentions them (fromSender).
const MENTION: string = "<at>Alex</at>";
const MENTION_ENTITY: JSONObject = {
  type: "mention",
  text: MENTION,
  mentioned: { id: "29:teams-user", name: "Alex" },
};

// What a press is asked to connect the account for, and what happens then.
interface ConnectPromptCase {
  purpose: string;
  next: string;
}

const ACKNOWLEDGE_PROMPT: ConnectPromptCase = {
  purpose: "acknowledge this incident",
  next: "It takes one click, and OneUptime acknowledges it for you as soon as you're connected.",
};

const ASK_PROMPT: ConnectPromptCase = {
  purpose: "ask OneUptime AI",
  next: "It takes one click. Then ask your question again.",
};

/*
 * The one reply a press from a Teams user without a linked account gets: a
 * card that mentions them and asks them to connect their account, for what
 * they pressed, with a Connect button to their own Microsoft Teams settings
 * page in the project carrying the press - recorded, for them, to be
 * finished or answered once they connect. The record is returned.
 */
async function expectConnectPrompt(
  replies: Array<string>,
  expected: ConnectPromptCase,
): Promise<WorkspaceConnectRequestRecord> {
  expect(replies).toHaveLength(1);

  const reply: CardReply = readCardReply(replies[0]);

  expect(reply.text).toBe(
    `${MENTION} 🔗 **Connect your Microsoft Teams account to ${expected.purpose}.** ${expected.next}`,
  );
  expect(reply.summary).toBe(
    `Connect your Microsoft Teams account to ${expected.purpose}`,
  );
  expect(reply.mentions).toEqual([MENTION_ENTITY]);
  // A prompt, not a form: no inputs, and no button that submits.
  expect(reply.otherElements).toEqual([]);
  expect(reply.actions).toHaveLength(1);
  expect(reply.actions[0]).toMatchObject({
    type: "Action.OpenUrl",
    title: "Connect Microsoft Teams account",
  });

  const url: globalThis.URL = new globalThis.URL(
    reply.actions[0]!["url"] as string,
  );
  const token: string | null = url.searchParams.get("connect");

  expect(`${url.origin}${url.pathname}`).toBe(SETTINGS_LINK);
  expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

  const request: WorkspaceConnectRequestRecord | null =
    await WorkspaceConnectRequest.peek(token);

  expect(request).not.toBeNull();
  expect(request!.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
  expect(request!.projectId.toString()).toBe(PROJECT_ID.toString());
  // Only the Microsoft account that pressed can finish it when signing in.
  expect(request!.workspaceUserId).toBe(TEAMS_USER_ID);
  expect(request!.purpose).toBe(expected.purpose);

  return request!;
}

/*
 * With no address of the server's own to link to, the card says where the
 * setting is, and to press again - and has no button.
 */
function expectConnectWithoutLink(
  replies: Array<string>,
  expected: { purpose: string; again: string },
): void {
  expect(replies).toHaveLength(1);

  const reply: CardReply = readCardReply(replies[0]);

  expect(reply.text).toBe(
    `${MENTION} 🔗 **Connect your Microsoft Teams account to ${expected.purpose}.** In OneUptime, go to **User Settings → Workspace → Microsoft Teams** and press **Connect my account with Microsoft Teams**. Once you're connected, ${expected.again}.`,
  );
  expect(reply.actions).toEqual([]);
  expect(reply.mentions).toEqual([MENTION_ENTITY]);
}

// Whether a reply asks the sender to connect their account, whatever its form.
function asksToConnect(reply: string | undefined): boolean {
  return Boolean(
    reply && reply.includes("Connect your Microsoft Teams account"),
  );
}

/*
 * A private static of MicrosoftTeamsUtil, reached through a cast the way
 * MicrosoftTeamsBotMessageHandling.test.ts reaches it.
 */
interface MicrosoftTeamsUtilInternals {
  captureChatFromBotActivity: (data: {
    activity: JSONObject;
    turnContext: TurnContext;
    onlyIfMissingOrStale?: boolean | undefined;
  }) => Promise<void>;
}

describe("what a Teams user without a linked account is told (the real lookup; only the link table is stubbed)", (): void => {
  let memberPropsSpy: SpyInstance<
    typeof WorkspaceActionAuthorization.getProjectMemberProps
  >;

  beforeEach((): void => {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = PROJECT_ID;

    jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: projectAuth,
        isAmbiguous: false,
        candidateProjectIds: [PROJECT_ID],
      });
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    memberPropsSpy = jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue({ userId: LINKED_USER_ID, tenantId: PROJECT_ID });
  });

  describe("a card button (handleBotInvokeActivity)", (): void => {
    let acknowledgeSpy: SpyInstance<typeof IncidentService.acknowledgeIncident>;

    beforeEach((): void => {
      acknowledgeSpy = jest
        .spyOn(IncidentService, "acknowledgeIncident")
        .mockRejectedValue(new Error("The action must not run."));
    });

    async function pressAcknowledge(): Promise<FakeTurn> {
      const activity: JSONObject = acknowledgeButtonActivity();
      const turn: FakeTurn = createFakeTurn(activity);

      await MicrosoftTeamsUtil.handleBotInvokeActivity({
        activity: activity,
        turnContext: turn.turnContext,
      });

      return turn;
    }

    test.each(UNLINKED)(
      "$name: one reply, mentioning them, that asks them to connect the account to acknowledge it, with a one-click Connect button; the action does not run yet",
      async (unlinked: UnlinkedCase): Promise<void> => {
        stubLinkTable(unlinked.row());

        const turn: FakeTurn = await pressAcknowledge();

        // master: ["Sorry, that action failed. Please try again later."]
        const request: WorkspaceConnectRequestRecord =
          await expectConnectPrompt(turn.replies, ACKNOWLEDGE_PROMPT);

        // Kept, to be acknowledged as the member the account gets linked to.
        expect(request.pendingAction!.kind).toBe(
          WorkspacePendingActionKind.Acknowledge,
        );
        expect(request.pendingAction!.eventType).toBe(
          WorkspaceEventType.Incident,
        );
        expect(request.pendingAction!.eventId.toString()).toBe(INCIDENT_ID);

        expect(memberPropsSpy).not.toHaveBeenCalled();
        expect(acknowledgeSpy).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
      },
    );

    test("without a dashboard URL the reply still says where to connect the account, and to press again", async (): Promise<void> => {
      stubLinkTable(null);
      jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockRejectedValue(new Error("No host is configured."));

      const turn: FakeTurn = await pressAcknowledge();

      expectConnectWithoutLink(turn.replies, {
        purpose: "acknowledge this incident",
        again: "press the button again",
      });
      expect(errorLog).not.toHaveBeenCalled();
    });

    // What handleBotInvokeActivity's log lines carry for this button.
    const ACKNOWLEDGE_LOG_ATTRIBUTES: LogAttributes = {
      actionType: MicrosoftTeamsIncidentActionType.AckIncident,
      projectId: PROJECT_ID.toString(),
    };

    test("a link table that cannot be read: the generic failure, logged as an error - never 'connect your account'", async (): Promise<void> => {
      const lookupError: Error = new Error(
        "Connection terminated unexpectedly",
      );
      stubUnreadableLinkTable(lookupError);

      const turn: FakeTurn = await pressAcknowledge();

      expect(turn.replies).toEqual([
        "Sorry, that action failed. Please try again later.",
      ]);
      expect(errorLog).toHaveBeenCalledWith(
        LOOKUP_FAILED_LOG_LINE,
        LOG_ATTRIBUTES,
      );
      expect(acknowledgeSpy).not.toHaveBeenCalled();
      expect(errorLogCalls()).toStrictEqual([
        [LOOKUP_FAILED_LOG_LINE, LOG_ATTRIBUTES],
        [lookupError],
        [
          "Error handling bot invoke activity: Error: Connection terminated unexpectedly",
          ACKNOWLEDGE_LOG_ATTRIBUTES,
        ],
        [lookupError, ACKNOWLEDGE_LOG_ATTRIBUTES],
      ]);
    });

    test("a BadDataException of the data layer's own is answered with its reason, not with 'connect your account'", async (): Promise<void> => {
      const lookupError: BadDataException = new BadDataException(
        "Invalid select: userId",
      );
      stubUnreadableLinkTable(lookupError);

      const turn: FakeTurn = await pressAcknowledge();

      expect(turn.replies).toEqual([
        "Sorry, that action failed: Invalid select: userId",
      ]);
      expect(errorLog).toHaveBeenCalledWith(
        LOOKUP_FAILED_LOG_LINE,
        LOG_ATTRIBUTES,
      );
      // Named by its class, so the log does not read it as "not linked".
      expect(errorLogCalls()).toStrictEqual([
        [LOOKUP_FAILED_LOG_LINE, LOG_ATTRIBUTES],
        [lookupError],
        [
          "Error handling bot invoke activity: BadDataException: Invalid select: userId",
          ACKNOWLEDGE_LOG_ATTRIBUTES,
        ],
        [lookupError, ACKNOWLEDGE_LOG_ATTRIBUTES],
      ]);
    });
  });

  // A spy, as far as these tests read it.
  interface CallRecorder {
    mock: { calls: Array<unknown> };
  }

  interface CreateCommandCase {
    name: string;
    // What the command is asked to connect the account for.
    purpose: string;
    what: string;
    run: (turn: FakeTurn, activity: JSONObject) => Promise<void>;
    // Stubs the read of the form's lists; the returned spy must stay unused.
    stubFormLists: () => CallRecorder;
    // Stubs the read of the form's lists with a small project's.
    stubReadableFormLists: () => CallRecorder;
    // The form's heading, and the action its submit button sends.
    formTitle: string;
    submitAction: string;
    // The form filled in, as its submit carries it.
    submittedFields: JSONObject;
    // Stubs the create, which must not run: it rejects if it does.
    stubCreateThatMustNotRun: () => CallRecorder;
  }

  function noChoices(): MicrosoftTeamsCardChoiceList {
    return { choices: [], totalCount: 0 };
  }

  const CREATE_COMMANDS: ReadonlyArray<CreateCommandCase> = [
    {
      name: "create incident",
      purpose: "declare an incident",
      what: "an incident",
      run: (turn: FakeTurn, activity: JSONObject): Promise<void> => {
        return MicrosoftTeamsCreateCommands.handleCreateIncidentCommand({
          turnContext: turn.turnContext,
          activity: activity,
          projectId: PROJECT_ID,
          initialTitle: undefined,
        });
      },
      stubFormLists: (): CallRecorder => {
        return jest
          .spyOn(MicrosoftTeamsIncidentActions, "getNewIncidentFormChoices")
          .mockRejectedValue(new Error("The form's lists must not be read."));
      },
      stubReadableFormLists: (): CallRecorder => {
        const choices: MicrosoftTeamsNewIncidentFormChoices = {
          severities: {
            choices: [{ title: "Critical", value: SEVERITY_ID }],
            totalCount: 1,
          },
          monitors: noChoices(),
          monitorStatuses: noChoices(),
          labels: noChoices(),
          onCallDutyPolicies: noChoices(),
        };

        return jest
          .spyOn(MicrosoftTeamsIncidentActions, "getNewIncidentFormChoices")
          .mockResolvedValue(choices);
      },
      formTitle: "Create New Incident",
      submitAction: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      submittedFields: {
        incidentTitle: "Checkout is failing",
        incidentDescription: "Payments time out after 30 seconds.",
        incidentSeverity: SEVERITY_ID,
      },
      stubCreateThatMustNotRun: (): CallRecorder => {
        return jest
          .spyOn(IncidentService, "create")
          .mockRejectedValue(new Error("The incident must not be created."));
      },
    },
    {
      name: "create maintenance",
      purpose: "create a scheduled maintenance event",
      what: "a scheduled maintenance event",
      run: (turn: FakeTurn, activity: JSONObject): Promise<void> => {
        return MicrosoftTeamsCreateCommands.handleCreateScheduledMaintenanceCommand(
          {
            turnContext: turn.turnContext,
            activity: activity,
            projectId: PROJECT_ID,
            initialTitle: undefined,
          },
        );
      },
      stubFormLists: (): CallRecorder => {
        return jest
          .spyOn(
            MicrosoftTeamsScheduledMaintenanceActions,
            "getNewScheduledMaintenanceFormChoices",
          )
          .mockRejectedValue(new Error("The form's lists must not be read."));
      },
      stubReadableFormLists: (): CallRecorder => {
        const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices = {
          monitors: noChoices(),
          monitorStatuses: noChoices(),
          labels: noChoices(),
        };

        return jest
          .spyOn(
            MicrosoftTeamsScheduledMaintenanceActions,
            "getNewScheduledMaintenanceFormChoices",
          )
          .mockResolvedValue(choices);
      },
      formTitle: "Create New Scheduled Maintenance",
      submitAction:
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
      submittedFields: {
        scheduledMaintenanceTitle: "Database upgrade",
        scheduledMaintenanceDescription: "Upgrading the primary to 16.4.",
        startDate: "2099-06-01",
        startTime: "10:00",
        endDate: "2099-06-01",
        endTime: "11:00",
      },
      stubCreateThatMustNotRun: (): CallRecorder => {
        return jest
          .spyOn(ScheduledMaintenanceService, "create")
          .mockRejectedValue(new Error("The event must not be created."));
      },
    },
  ];

  describe("the create commands (MicrosoftTeamsCreateCommands)", (): void => {
    test.each(CREATE_COMMANDS)(
      "'$name': one reply that asks to connect the account, then to type the command again, and no form",
      async (command: CreateCommandCase): Promise<void> => {
        stubLinkTable(null);
        const formLists: { mock: { calls: Array<unknown> } } =
          command.stubFormLists();
        const activity: JSONObject = commandActivity(command.name);
        const turn: FakeTurn = createFakeTurn(activity);

        await command.run(turn, activity);

        const request: WorkspaceConnectRequestRecord =
          await expectConnectPrompt(turn.replies, {
            purpose: command.purpose,
            next: `It takes one click. Then run **${command.name}** again.`,
          });
        // A form opens only on a fresh command: nothing is finished for them.
        expect(request.pendingAction).toBeUndefined();
        expect(request.again).toEqual({
          kind: WorkspaceConnectRequestAgainKind.Command,
          label: command.name,
        });
        // Told before filling the form in: its lists were never read.
        expect(formLists.mock.calls).toHaveLength(0);
        expect(memberPropsSpy).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
      },
    );

    test.each(CREATE_COMMANDS)(
      "'$name' while the link table cannot be read: 'try again in a minute', logged as an error - never 'connect your account'",
      async (command: CreateCommandCase): Promise<void> => {
        const lookupError: Error = new Error(
          "Connection terminated unexpectedly",
        );
        stubUnreadableLinkTable(lookupError);
        const formLists: { mock: { calls: Array<unknown> } } =
          command.stubFormLists();
        const activity: JSONObject = commandActivity(command.name);
        const turn: FakeTurn = createFakeTurn(activity);

        await command.run(turn, activity);

        expect(turn.replies).toEqual([
          `Sorry, I couldn't open the form to create ${command.what} because OneUptime could not check your account just now. Please try again in a minute.`,
        ]);
        expect(formLists.mock.calls).toHaveLength(0);
        expect(errorLog).toHaveBeenCalledWith(
          LOOKUP_FAILED_LOG_LINE,
          LOG_ATTRIBUTES,
        );
        const attributes: LogAttributes = { projectId: PROJECT_ID.toString() };
        expect(errorLogCalls()).toStrictEqual([
          [LOOKUP_FAILED_LOG_LINE, LOG_ATTRIBUTES],
          [lookupError],
          [
            "Could not check the Microsoft Teams sender of a create command: Error: Connection terminated unexpectedly",
            attributes,
          ],
          [lookupError, attributes],
        ]);
      },
    );
  });

  describe("the create commands in a team channel or a group chat, where anyone there may submit the form", (): void => {
    /*
     * The form is filled in as the person who asked for it, in a channel or
     * a group chat as in a personal chat: its lists are what they may read.
     * So the sender is looked up wherever they ask, and a sender without a
     * linked account is told where to connect it instead of getting a form.
     * Whoever then submits a form in the channel is checked as themselves.
     */
    interface SharedCreateCase {
      command: CreateCommandCase;
      where: SharedConversation;
      // The conversation, as a test title names it.
      place: string;
    }

    const SHARED_CREATE_CASES: ReadonlyArray<SharedCreateCase> =
      CREATE_COMMANDS.flatMap(
        (command: CreateCommandCase): Array<SharedCreateCase> => {
          return [
            { command: command, where: "channel", place: "team channel" },
            { command: command, where: "groupChat", place: "group chat" },
          ];
        },
      );

    test.each(SHARED_CREATE_CASES)(
      "'$command.name' in a $place, from a sender without a linked account: asked to connect it, and no form",
      async (sharedCase: SharedCreateCase): Promise<void> => {
        const { command, where } = sharedCase;
        const linkTable: LinkTableSpy = stubLinkTable(null);
        const assertCanCreate: SpyInstance<
          typeof WorkspaceActionAuthorization.assertCanCreate
        > = jest.spyOn(WorkspaceActionAuthorization, "assertCanCreate");
        const formLists: CallRecorder = command.stubReadableFormLists();
        const activity: JSONObject = inSharedConversation(
          commandActivity(command.name),
          where,
        );
        const turn: FakeTurn = createFakeTurn(activity);

        await command.run(turn, activity);

        // One reply: asked to connect the account; no form posted for the channel.
        await expectConnectPrompt(turn.replies, {
          purpose: command.purpose,
          next: `It takes one click. Then run **${command.name}** again.`,
        });
        expect(turn.replies[0]).not.toContain(command.formTitle);

        // The sender was looked up; nobody's lists were read.
        expect(linkTable).toHaveBeenCalledTimes(1);
        expect(formLists.mock.calls).toHaveLength(0);
        expect(memberPropsSpy).not.toHaveBeenCalled();
        expect(assertCanCreate).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
      },
    );

    test.each(SHARED_CREATE_CASES)(
      "the '$command.name' form submitted in a $place by someone without a linked account: asked to connect it, then to type the command again, and nothing is created",
      async (sharedCase: SharedCreateCase): Promise<void> => {
        const { command, where } = sharedCase;
        stubLinkTable(null);
        const create: CallRecorder = command.stubCreateThatMustNotRun();
        const activity: JSONObject = inSharedConversation(
          {
            type: "message",
            id: "1727611320123",
            replyToId: "1727611300999",
            value: { action: command.submitAction, ...command.submittedFields },
            from: fromSender(),
            recipient: { id: "28:oneuptime-bot" },
            channelData: { tenant: { id: TENANT_ID } },
          },
          where,
        );
        const turn: FakeTurn = createFakeTurn(activity);

        await MicrosoftTeamsUtil.handleBotInvokeActivity({
          activity: activity,
          turnContext: turn.turnContext,
        });

        await expectConnectPrompt(turn.replies, {
          purpose: command.purpose,
          next: `It takes one click. Then run **${command.name}** again.`,
        });
        expect(create.mock.calls).toHaveLength(0);
        expect(memberPropsSpy).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
      },
    );
  });

  describe("the AI assistant ('ask ...', through handleBotMessageActivity)", (): void => {
    let aiEnabledSpy: SpyInstance<typeof AIService.isProjectAIEnabled>;

    beforeEach((): void => {
      // Recording the chat reads the database; it is not what this is about.
      jest
        .spyOn(
          MicrosoftTeamsUtil as unknown as MicrosoftTeamsUtilInternals,
          "captureChatFromBotActivity",
        )
        .mockResolvedValue(undefined);
      // The first thing the assistant reads once it knows who is asking.
      aiEnabledSpy = jest
        .spyOn(AIService, "isProjectAIEnabled")
        .mockResolvedValue(false);
    });

    /*
     * Each question gets an activity id of its own: handleBotMessageActivity
     * drops a second delivery of the same id, for ten minutes.
     */
    let lastAskActivityId: number = 1727611300100;

    async function ask(): Promise<FakeTurn> {
      lastAskActivityId += 1;
      const activity: JSONObject = askActivity(String(lastAskActivityId));
      const turn: FakeTurn = createFakeTurn(activity);

      await MicrosoftTeamsUtil.handleBotMessageActivity({
        activity: activity,
        turnContext: turn.turnContext,
      });

      return turn;
    }

    test.each(UNLINKED)(
      "$name: one reply that asks to connect the account, then to ask again; the assistant is not asked",
      async (unlinked: UnlinkedCase): Promise<void> => {
        stubLinkTable(unlinked.row());

        const turn: FakeTurn = await ask();

        // The same card as a button's, with the one-click Connect button.
        const request: WorkspaceConnectRequestRecord =
          await expectConnectPrompt(turn.replies, ASK_PROMPT);
        expect(request.again).toEqual({
          kind: WorkspaceConnectRequestAgainKind.Question,
        });
        expect(memberPropsSpy).not.toHaveBeenCalled();
        expect(aiEnabledSpy).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
      },
    );

    test("without a dashboard URL the reply still says where to connect the account, and to ask again", async (): Promise<void> => {
      stubLinkTable(null);
      jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockRejectedValue(new Error("No host is configured."));

      const turn: FakeTurn = await ask();

      expectConnectWithoutLink(turn.replies, {
        purpose: "ask OneUptime AI",
        again: "ask your question again",
      });
      expect(errorLog).not.toHaveBeenCalled();
    });

    /*
     * Pinned a reported bug, now fixed: answerObservabilityQuestion
     * (MicrosoftTeams.ts) caught every error of the lookup and answered
     * "I couldn't find your OneUptime account. Please connect your Microsoft
     * Teams account in OneUptime User Settings before asking me questions.",
     * the very confusion MicrosoftTeamsAccountNotLinkedException exists to
     * prevent. Any one reply that does not send the user to connect an
     * account passes here; the tests below pin which reply it is.
     */
    test("a link table that cannot be read: one reply, which does not tell a linked user to connect the account they have connected", async (): Promise<void> => {
      stubUnreadableLinkTable(new Error("Connection terminated unexpectedly"));

      const turn: FakeTurn = await ask();

      expect(turn.replies).toHaveLength(1);
      expect(asksToConnect(turn.replies[0])).toBe(false);
      expect(memberPropsSpy).not.toHaveBeenCalled();
      expect(aiEnabledSpy).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith(
        LOOKUP_FAILED_LOG_LINE,
        LOG_ATTRIBUTES,
      );
    });

    /*
     * The lookup's error is not the assistant's to answer: it is rethrown,
     * and handleBotMessageActivity answers it as any failed message, once.
     */
    test.each(LOOKUP_FAILURES)(
      "$name: the message handler's one reply, and the failure logged by the command, not by the question",
      async (failure: LookupFailureCase): Promise<void> => {
        const lookupError: unknown = failure.error();
        stubUnreadableLinkTable(lookupError);

        const turn: FakeTurn = await ask();

        expect(turn.replies).toEqual([
          MicrosoftTeamsUtil.getUnexpectedErrorMessage(turn.activity),
        ]);
        expect(memberPropsSpy).not.toHaveBeenCalled();
        expect(aiEnabledSpy).not.toHaveBeenCalled();

        const attributes: LogAttributes = { projectId: PROJECT_ID.toString() };
        expect(errorLogCalls()).toStrictEqual([
          // The lookup's own lines.
          [LOOKUP_FAILED_LOG_LINE, LOG_ATTRIBUTES],
          [lookupError],
          // The message handler's, under the reference the reply gives.
          [
            `Microsoft Teams message ${turn.activity["id"] as string} ("ask") failed: ${failure.described}`,
            attributes,
          ],
          [lookupError, attributes],
        ]);
        for (const call of errorLogCalls()) {
          expect(String(call[0])).not.toContain("checkout");
        }
      },
    );
  });
});
