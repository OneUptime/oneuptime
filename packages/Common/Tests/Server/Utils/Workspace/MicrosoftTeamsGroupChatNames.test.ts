import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #4106: Microsoft Teams group chats were listed by their members'
 * names ("Alice, Bob, Carol + 4 more") instead of the name the group chat has
 * in Teams.
 *
 * Teams does not reliably put a group chat's name on the bot activities
 * OneUptime captures chats from, so the name is read from Microsoft Graph
 * (GET /chats/{id}, which needs the ChatSettings.Read.Chat RSC permission or
 * the tenant-wide Chat.ReadBasic.WhereInstalled). Member names are only the
 * fallback, for chats with no name or whose name cannot be read — and a name
 * that was read once is kept when a later read fails.
 *
 * Covered here:
 * - getChatDisplayName: surrogate-safe truncation and the stored member count.
 * - buildCapturedChat: the record a capture stores, on top of the stored one.
 * - getTenantChatContext: the one read a capture makes before storing.
 * - capture (conversationUpdate / installationUpdate / message backfill).
 * - isChatCapturedForTenant: group chats without a member count are stale.
 * - getGroupChatTopicFromGraph: the Graph read and how each answer maps.
 * - refreshChatNamesForProject: what Refresh Chats does.
 * - renameChatsInProjectAuthTokens: the write behind a refresh.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

/*
 * The repo-wide botbuilder manual mock (Tests/__mocks__/botbuilder.js) does
 * not expose TeamsInfo or MessageFactory.attachment, both of which the chat
 * code paths use — so this file supplies its own richer factory.
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

import MicrosoftTeamsUtil, {
  MICROSOFT_TEAMS_CHAT_TOPIC_READ_PERMISSION,
  MicrosoftTeamsChatNameRefreshResult,
  MicrosoftTeamsChatNameUpdate,
  MicrosoftTeamsChatTopicLookup,
  MicrosoftTeamsChatTopicLookupStatus,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../../Types/ObjectID";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import logger from "../../../../Server/Utils/Logger";
import {
  TeamsInfo,
  type TeamsChannelAccount,
  type TeamsPagedMembersResult,
  type TurnContext,
} from "botbuilder";

const BOT_RECIPIENT_ID: string = "bot-recipient-id";
const TENANT_ID: string = "tenant-1";
const ACCESS_TOKEN: string = "header.payload.signature";
const SERVICE_URL: string = "https://smba.trafficmanager.net/amer/";
const OLD_SERVICE_URL: string = "https://smba.trafficmanager.net/emea/";
const NOW: string = "2026-09-28T12:00:00.000Z";
const ADDED_AT: string = "2026-09-01T00:00:00.000Z";

const GROUP_CHAT_ID: string = "19:3a9c1f0e5b7d4e2f8a6b0c1d2e3f4a5b@thread.v2";
// The same id as Graph's path wants it: ':' and '@' percent-encoded.
const ENCODED_GROUP_CHAT_ID: string =
  "19%3A3a9c1f0e5b7d4e2f8a6b0c1d2e3f4a5b%40thread.v2";
const PERSONAL_CHAT_ID: string = "a:1personal-chat";

// The chat from the issue: named in Teams, listed by its members in OneUptime.
const ISSUE_MEMBERS: Array<string> = [
  "Bibishek G S Steephensen [Contractor]",
  "Karthik Kallam [Contractor]",
  "Robin Example",
  "Sam Example",
];
const ISSUE_AAD_IDS: Array<string> = ["aad-0", "aad-1", "aad-2", "aad-3"];
// Only the names a member-named chat shows are stored — never the roster.
const ISSUE_MEMBERS_SHOWN: Array<string> = [
  "Bibishek G S Steephensen [Contractor]",
  "Karthik Kallam [Contractor]",
  "Robin Example",
];
// Cut at 80 characters, which is why the chats in the issue ended in "...".
const ISSUE_MEMBER_NAME: string =
  "Bibishek G S Steephensen [Contractor], Karthik Kallam [Contractor], Robin Examp…";

const TEAMS_NAME: string = "Platform On-Call";

const FOUND: MicrosoftTeamsChatTopicLookup = {
  status: MicrosoftTeamsChatTopicLookupStatus.Found,
  topic: TEAMS_NAME,
};
const NO_TOPIC: MicrosoftTeamsChatTopicLookup = {
  status: MicrosoftTeamsChatTopicLookupStatus.NoTopic,
};
const DENIED: MicrosoftTeamsChatTopicLookup = {
  status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
};
const UNKNOWN: MicrosoftTeamsChatTopicLookup = {
  status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
};

type CaptureInput = Parameters<typeof MicrosoftTeamsUtil.buildCapturedChat>[0];
type Roster = NonNullable<CaptureInput["roster"]>;

interface TenantChatContext {
  projectId: ObjectID | null;
  storedChat: MicrosoftTeamsChat | undefined;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;

  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: unknown) => void) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    },
  );

  return {
    promise: promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

/*
 * A macrotask (setTimeout 0) drains every pending microtask first, so the
 * code under test runs as far as it can before the test looks. The jsdom
 * test environment has no setImmediate.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

// Drains the queue until the condition holds; never waits on the clock.
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 50; attempt++) {
    if (condition()) {
      return;
    }
    await flushMicrotasks();
  }
  throw new Error("Condition never became true");
}

// True when the string holds half of an emoji: what Postgres jsonb refuses.
function hasLoneSurrogate(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const codeUnit: number = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit: number = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
        return true;
      }
      index++; // a whole pair.
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
}

// What a promise rejected with; undefined when it resolved.
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

function tenantChatContext(): (data: {
  tenantId: string;
  chatId: string;
}) => Promise<TenantChatContext> {
  return (MicrosoftTeamsUtil as any).getTenantChatContext.bind(
    MicrosoftTeamsUtil,
  );
}

function isChatCapturedForTenant(data: {
  tenantId: string;
  chatId: string;
  serviceUrl?: string | undefined;
}): Promise<boolean> {
  return (MicrosoftTeamsUtil as any).isChatCapturedForTenant(data);
}

function buildTurnContext(): TurnContext {
  return {
    activity: {
      recipient: { id: BOT_RECIPIENT_ID },
      serviceUrl: SERVICE_URL,
      conversation: { id: "ctx-conversation-id" },
    },
  } as unknown as TurnContext;
}

function mockMembers(members: Array<Partial<TeamsChannelAccount>>): void {
  (TeamsInfo.getPagedMembers as jest.Mock).mockResolvedValue({
    members: members as Array<TeamsChannelAccount>,
    continuationToken: undefined,
  } as unknown as TeamsPagedMembersResult);
}

function mockIssueMembers(): void {
  mockMembers([
    { id: BOT_RECIPIENT_ID, name: "OneUptime" },
    ...ISSUE_MEMBERS.map((name: string, index: number) => {
      return {
        id: `user-${index}`,
        name: name,
        aadObjectId: `aad-${index}`,
      };
    }),
  ]);
}

function mockRosterFailure(): void {
  (TeamsInfo.getPagedMembers as jest.Mock).mockRejectedValue(
    new Error("roster unavailable"),
  );
}

function issueRoster(): Roster {
  return {
    memberNames: [...ISSUE_MEMBERS],
    memberAadObjectIds: [...ISSUE_AAD_IDS],
  };
}

function graphOk(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

// Built the way API.fetch builds one: the status and Graph's own error body.
function graphError(statusCode: number, body: JSONObject): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, body, {});
}

// A group chat as this version captures it when Graph gave no name.
function buildChat(
  overrides?: Partial<MicrosoftTeamsChat>,
): MicrosoftTeamsChat {
  return {
    id: GROUP_CHAT_ID,
    name: ISSUE_MEMBER_NAME,
    chatType: "groupChat",
    serviceUrl: SERVICE_URL,
    addedAt: ADDED_AT,
    memberAadObjectIds: [...ISSUE_AAD_IDS],
    memberNames: [...ISSUE_MEMBERS_SHOWN],
    memberCount: 4,
    ...(overrides || {}),
  };
}

// A group chat as this version captures it when Graph shared its name.
function buildNamedChat(
  overrides?: Partial<MicrosoftTeamsChat>,
): MicrosoftTeamsChat {
  return buildChat({
    name: TEAMS_NAME,
    topic: TEAMS_NAME,
    ...(overrides || {}),
  });
}

/*
 * A group chat captured before this shipped: no Teams name, no member names,
 * no member count — only the name built from the members back then.
 */
function buildLegacyChat(
  overrides?: Partial<MicrosoftTeamsChat>,
): MicrosoftTeamsChat {
  const chat: MicrosoftTeamsChat = buildChat({
    name: "Alice, Bob, Carol + 4 more",
    ...(overrides || {}),
  });
  delete chat.memberNames;
  delete chat.memberCount;
  delete chat.memberAadObjectIds;
  return chat;
}

function buildPersonalChat(
  overrides?: Partial<MicrosoftTeamsChat>,
): MicrosoftTeamsChat {
  return {
    id: PERSONAL_CHAT_ID,
    name: "Jane Doe",
    chatType: "personal",
    serviceUrl: SERVICE_URL,
    addedAt: ADDED_AT,
    memberAadObjectIds: ["aad-jane"],
    memberNames: ["Jane Doe"],
    memberCount: 1,
    ...(overrides || {}),
  };
}

function chatsById(
  chats: Array<MicrosoftTeamsChat>,
): Record<string, MicrosoftTeamsChat> {
  const availableChats: Record<string, MicrosoftTeamsChat> = {};
  for (const chat of chats) {
    availableChats[chat.id] = chat;
  }
  return availableChats;
}

// A deep copy, so a stored row never shares objects with the test's fixtures.
function cloneChats(
  chats: Record<string, MicrosoftTeamsChat>,
): Record<string, MicrosoftTeamsChat> {
  return JSON.parse(JSON.stringify(chats)) as Record<
    string,
    MicrosoftTeamsChat
  >;
}

function buildAuthRow(data: {
  projectId?: ObjectID | undefined;
  workspaceProjectId?: string | undefined;
  availableChats?: Record<string, MicrosoftTeamsChat> | undefined;
  miscData?: MicrosoftTeamsMiscData | undefined;
  withoutMiscData?: boolean | undefined;
}): WorkspaceProjectAuthToken {
  const row: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  row._id = ObjectID.generate().toString();
  if (data.projectId) {
    row.projectId = data.projectId;
  }
  if (data.workspaceProjectId !== undefined) {
    row.workspaceProjectId = data.workspaceProjectId;
  }
  if (!data.withoutMiscData) {
    row.miscData = (data.miscData ||
      (data.availableChats
        ? { availableChats: data.availableChats }
        : {})) as MicrosoftTeamsMiscData;
  }
  return row;
}

let apiGetSpy: jest.SpyInstance;
let tokenSpy: jest.SpyInstance;

beforeEach(() => {
  (TeamsInfo.getPagedMembers as jest.Mock).mockReset();
  (TeamsInfo.getMembers as jest.Mock).mockReset();

  tokenSpy = jest
    .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
    .mockResolvedValue(ACCESS_TOKEN);

  // Every test that reaches Graph sets its own answer; the default is loud.
  apiGetSpy = jest.spyOn(API, "get").mockImplementation(async () => {
    throw new Error("Unexpected Graph call in test");
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ChatSettings.Read.Chat permission constant", () => {
  test("names the RSC permission Graph's GET /chats/{id} accepts for app-only tokens", () => {
    expect(MICROSOFT_TEAMS_CHAT_TOPIC_READ_PERMISSION).toBe(
      "ChatSettings.Read.Chat",
    );
  });
});

describe("MicrosoftTeamsUtil.getChatDisplayName — truncation and member count", () => {
  test("an emoji straddling the cut is dropped whole, never split in half", () => {
    // 78 x's put the emoji's two halves at positions 78 and 79: the cut is 79.
    const topic: string = `${"x".repeat(78)}🔥 incident war room`;

    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: topic,
      memberNames: [],
    });

    expect(name).toBe(`${"x".repeat(78)}…`);
    expect(name.length).toBeLessThanOrEqual(80);
    // The character before the ellipsis is not the first half of an emoji.
    const beforeEllipsis: number = name.charCodeAt(name.length - 2);
    expect(beforeEllipsis >= 0xd800 && beforeEllipsis <= 0xdbff).toBe(false);
    expect(JSON.stringify(name)).not.toContain("\\ud83d");
    expect(hasLoneSurrogate(name)).toBe(false);
  });

  test("an emoji entirely before the cut is kept whole", () => {
    // 77 x's put the emoji at positions 77 and 78 — both inside the 79 kept.
    const topic: string = `${"x".repeat(77)}🔥${"y".repeat(20)}`;

    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: topic,
      memberNames: [],
    });

    expect(name).toBe(`${"x".repeat(77)}🔥…`);
    expect(name).toHaveLength(80);
    expect(hasLoneSurrogate(name)).toBe(false);
  });

  test("an emoji at the start of a long name survives the cut", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: `🔥 ${"Incident bridge ".repeat(8)}`,
      memberNames: [],
    });

    expect(name.startsWith("🔥 Incident bridge")).toBe(true);
    expect(name).toHaveLength(80);
    expect(name.endsWith("…")).toBe(true);
    expect(hasLoneSurrogate(name)).toBe(false);
  });

  test("member names are cut surrogate-safely too", () => {
    // The joined names put an emoji's first half at position 78.
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["x".repeat(40), `${"y".repeat(36)}😀 Smith`, "Carol"],
    });

    expect(name).toBe(`${"x".repeat(40)}, ${"y".repeat(36)}…`);
    expect(hasLoneSurrogate(name)).toBe(false);
  });

  test("a name with an emoji that fits is returned untouched", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: "🔥 Incident war room",
      memberNames: [],
    });

    expect(name).toBe("🔥 Incident war room");
  });

  test("the issue's chat, stored as its first three members and a count, keeps its '+ 1 more'", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: [...ISSUE_MEMBERS_SHOWN],
      memberCount: 4,
    });

    expect(name).toBe(ISSUE_MEMBER_NAME);
  });

  test("memberCount drives '+ N more' when memberNames holds only the first three", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["Alice", "Bob", "Carol"],
      memberCount: 7,
    });

    expect(name).toBe("Alice, Bob, Carol + 4 more");
  });

  test("a memberCount equal to the names shown adds nothing", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["Alice", "Bob", "Carol"],
      memberCount: 3,
    });

    expect(name).toBe("Alice, Bob, Carol");
  });

  test("a memberCount smaller than the names given is ignored — the names are counted", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["Alice", "Bob", "Carol", "Dave", "Erin"],
      memberCount: 2,
    });

    expect(name).toBe("Alice, Bob, Carol + 2 more");
  });

  test("a memberCount of 0 counts the names given", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["Alice", "Bob"],
      memberCount: 0,
    });

    expect(name).toBe("Alice, Bob");
  });

  test("a memberCount without any names is still 'Group chat'", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: [],
      memberCount: 5,
    });

    expect(name).toBe("Group chat");
  });

  test("a Teams name wins over the member count", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: TEAMS_NAME,
      memberNames: ["Alice", "Bob", "Carol"],
      memberCount: 9,
    });

    expect(name).toBe(TEAMS_NAME);
  });

  test("a personal chat is the other person's name whatever the count", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "personal",
      memberNames: ["Jane Doe"],
      memberCount: 3,
    });

    expect(name).toBe("Jane Doe");
  });
});

describe("MicrosoftTeamsUtil.buildCapturedChat", () => {
  function capture(overrides?: Partial<CaptureInput>): MicrosoftTeamsChat {
    return MicrosoftTeamsUtil.buildCapturedChat({
      chatId: GROUP_CHAT_ID,
      chatType: "groupChat",
      serviceUrl: SERVICE_URL,
      roster: issueRoster(),
      now: NOW,
      ...(overrides || {}),
    });
  }

  describe("first capture (nothing stored yet)", () => {
    test("the issue: Graph's name is stored, with only the first three members and a count", () => {
      expect(capture({ topicLookup: FOUND })).toStrictEqual({
        id: GROUP_CHAT_ID,
        name: TEAMS_NAME,
        chatType: "groupChat",
        serviceUrl: SERVICE_URL,
        addedAt: NOW,
        memberAadObjectIds: ISSUE_AAD_IDS,
        topic: TEAMS_NAME,
        memberNames: ISSUE_MEMBERS_SHOWN,
        memberCount: 4,
      });
    });

    test.each([
      ["NoTopic (the chat has no name)", NO_TOPIC],
      ["PermissionDenied", DENIED],
      ["Unknown", UNKNOWN],
      ["not asked (no project, or no Graph call)", undefined],
    ])(
      "Graph %s: the members name the chat and no topic is stored",
      (_label: string, lookup: MicrosoftTeamsChatTopicLookup | undefined) => {
        expect(capture({ topicLookup: lookup })).toStrictEqual({
          id: GROUP_CHAT_ID,
          name: ISSUE_MEMBER_NAME,
          chatType: "groupChat",
          serviceUrl: SERVICE_URL,
          addedAt: NOW,
          memberAadObjectIds: ISSUE_AAD_IDS,
          memberNames: ISSUE_MEMBERS_SHOWN,
          memberCount: 4,
        });
      },
    );

    test("a name on the activity wins over Graph's, and is stored as the topic", () => {
      const chat: MicrosoftTeamsChat = capture({
        activityTopic: "Ops War Room",
        topicLookup: FOUND,
      });

      expect(chat.name).toBe("Ops War Room");
      expect(chat.topic).toBe("Ops War Room");
    });

    test("the activity's name is trimmed", () => {
      const chat: MicrosoftTeamsChat = capture({
        activityTopic: "  Ops War Room \n",
      });

      expect(chat.name).toBe("Ops War Room");
      expect(chat.topic).toBe("Ops War Room");
    });

    test("a whitespace-only activity name is no name: Graph's is used", () => {
      const chat: MicrosoftTeamsChat = capture({
        activityTopic: "   ",
        topicLookup: FOUND,
      });

      expect(chat.name).toBe(TEAMS_NAME);
      expect(chat.topic).toBe(TEAMS_NAME);
    });

    test("a long Teams name is cut for display, but stored whole as the topic", () => {
      const longTopic: string =
        "Payments platform — production incident bridge for the EMEA and APAC on-call rotations";

      const chat: MicrosoftTeamsChat = capture({
        topicLookup: {
          status: MicrosoftTeamsChatTopicLookupStatus.Found,
          topic: longTopic,
        },
      });

      expect(chat.name).toBe(
        "Payments platform — production incident bridge for the EMEA and APAC on-call ro…",
      );
      expect(chat.topic).toBe(longTopic);
    });

    test("only the first three names are stored, with a count of all of them", () => {
      const chat: MicrosoftTeamsChat = capture({
        roster: {
          memberNames: [
            "Alice",
            "Bob",
            "Carol",
            "Dave",
            "Erin",
            "Frank",
            "Grace",
          ],
          memberAadObjectIds: ["a", "b", "c", "d", "e", "f", "g"],
        },
      });

      expect(chat.memberNames).toEqual(["Alice", "Bob", "Carol"]);
      expect(chat.memberCount).toBe(7);
      expect(chat.name).toBe("Alice, Bob, Carol + 4 more");
      // The Entra ids are what match personal chats to users; all are kept.
      expect(chat.memberAadObjectIds).toEqual([
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
      ]);
    });

    test("blank names are neither stored nor counted", () => {
      const chat: MicrosoftTeamsChat = capture({
        roster: {
          memberNames: ["", "Alice", "  ", "Bob", "Carol", "", "Dave"],
          memberAadObjectIds: ["aad-alice", "aad-bob"],
        },
      });

      expect(chat.memberNames).toEqual(["Alice", "Bob", "Carol"]);
      expect(chat.memberCount).toBe(4);
      expect(chat.name).toBe("Alice, Bob, Carol + 1 more");
    });

    test("fewer than three members are all stored", () => {
      const chat: MicrosoftTeamsChat = capture({
        roster: {
          memberNames: ["Alice", "Bob"],
          memberAadObjectIds: ["aad-alice", "aad-bob"],
        },
      });

      expect(chat.memberNames).toEqual(["Alice", "Bob"]);
      expect(chat.memberCount).toBe(2);
      expect(chat.name).toBe("Alice, Bob");
    });

    test("an empty roster is stored as an empty list and a count of 0 — it was read", () => {
      expect(
        capture({ roster: { memberNames: [], memberAadObjectIds: [] } }),
      ).toStrictEqual({
        id: GROUP_CHAT_ID,
        name: "Group chat",
        chatType: "groupChat",
        serviceUrl: SERVICE_URL,
        addedAt: NOW,
        memberAadObjectIds: [],
        memberNames: [],
        memberCount: 0,
      });
    });

    test("no roster and no name: 'Group chat', and no member keys at all (so it is retried)", () => {
      const chat: MicrosoftTeamsChat = capture({ roster: null });

      expect(chat).toStrictEqual({
        id: GROUP_CHAT_ID,
        name: "Group chat",
        chatType: "groupChat",
        serviceUrl: SERVICE_URL,
        addedAt: NOW,
        memberAadObjectIds: [],
      });
      expect(Object.keys(chat)).not.toContain("topic");
      expect(Object.keys(chat)).not.toContain("memberNames");
      expect(Object.keys(chat)).not.toContain("memberCount");
    });

    test("no roster but Graph's name: the name is stored, and still no member keys", () => {
      expect(capture({ roster: null, topicLookup: FOUND })).toStrictEqual({
        id: GROUP_CHAT_ID,
        name: TEAMS_NAME,
        chatType: "groupChat",
        serviceUrl: SERVICE_URL,
        addedAt: NOW,
        memberAadObjectIds: [],
        topic: TEAMS_NAME,
      });
    });
  });

  describe("re-capture (building on the stored record)", () => {
    const newRoster: Roster = {
      memberNames: ["Alice", "Bob", "Carol", "Dave", "Erin"],
      memberAadObjectIds: ["aad-a", "aad-b", "aad-c", "aad-d", "aad-e"],
    };

    test.each([
      ["PermissionDenied", DENIED],
      ["Unknown", UNKNOWN],
      ["not asked", undefined],
    ])(
      "Graph %s: the stored Teams name is kept, never replaced by member names",
      (_label: string, lookup: MicrosoftTeamsChatTopicLookup | undefined) => {
        const chat: MicrosoftTeamsChat = capture({
          storedChat: buildNamedChat({ serviceUrl: OLD_SERVICE_URL }),
          roster: newRoster,
          topicLookup: lookup,
        });

        expect(chat).toStrictEqual({
          id: GROUP_CHAT_ID,
          name: TEAMS_NAME,
          chatType: "groupChat",
          serviceUrl: SERVICE_URL,
          addedAt: ADDED_AT,
          memberAadObjectIds: ["aad-a", "aad-b", "aad-c", "aad-d", "aad-e"],
          topic: TEAMS_NAME,
          memberNames: ["Alice", "Bob", "Carol"],
          memberCount: 5,
        });
      },
    );

    test.each([
      ["PermissionDenied", DENIED],
      ["Unknown", UNKNOWN],
      ["not asked", undefined],
    ])(
      "Graph %s and no roster: the whole stored record is kept, with the new serviceUrl",
      (_label: string, lookup: MicrosoftTeamsChatTopicLookup | undefined) => {
        const storedChat: MicrosoftTeamsChat = buildNamedChat({
          serviceUrl: OLD_SERVICE_URL,
        });

        const chat: MicrosoftTeamsChat = capture({
          storedChat: storedChat,
          roster: null,
          topicLookup: lookup,
        });

        expect(chat).toStrictEqual({
          ...buildNamedChat(),
          serviceUrl: SERVICE_URL,
        });
      },
    );

    test("a chat renamed in Teams takes the new name", () => {
      const chat: MicrosoftTeamsChat = capture({
        storedChat: buildNamedChat(),
        topicLookup: {
          status: MicrosoftTeamsChatTopicLookupStatus.Found,
          topic: "Payments On-Call",
        },
      });

      expect(chat.name).toBe("Payments On-Call");
      expect(chat.topic).toBe("Payments On-Call");
    });

    test("a name on the activity replaces the stored one", () => {
      const chat: MicrosoftTeamsChat = capture({
        storedChat: buildNamedChat(),
        activityTopic: "Ops War Room",
      });

      expect(chat.name).toBe("Ops War Room");
      expect(chat.topic).toBe("Ops War Room");
    });

    test("NoTopic (the name was removed in Teams): the topic is dropped and the new roster names the chat", () => {
      const chat: MicrosoftTeamsChat = capture({
        storedChat: buildNamedChat(),
        roster: newRoster,
        topicLookup: NO_TOPIC,
      });

      expect(chat.name).toBe("Alice, Bob, Carol + 2 more");
      expect(Object.keys(chat)).not.toContain("topic");
    });

    test("NoTopic and no roster: the stored member names and count name the chat", () => {
      const chat: MicrosoftTeamsChat = capture({
        storedChat: buildNamedChat(),
        roster: null,
        topicLookup: NO_TOPIC,
      });

      expect(chat).toStrictEqual({
        id: GROUP_CHAT_ID,
        name: ISSUE_MEMBER_NAME,
        chatType: "groupChat",
        serviceUrl: SERVICE_URL,
        addedAt: ADDED_AT,
        memberAadObjectIds: ISSUE_AAD_IDS,
        memberNames: ISSUE_MEMBERS_SHOWN,
        memberCount: 4,
      });
    });

    test("NoTopic, no roster, no stored members, and the stored name was the Teams name: 'Group chat'", () => {
      // The removed name must not live on as if it were still the chat's.
      const storedChat: MicrosoftTeamsChat = buildLegacyChat({
        name: TEAMS_NAME,
        topic: TEAMS_NAME,
      });

      const chat: MicrosoftTeamsChat = capture({
        storedChat: storedChat,
        roster: null,
        topicLookup: NO_TOPIC,
      });

      expect(chat.name).toBe("Group chat");
      expect(Object.keys(chat)).not.toContain("topic");
    });

    test("NoTopic, no roster, no stored members, and a member-built stored name: the stored name is kept", () => {
      const chat: MicrosoftTeamsChat = capture({
        storedChat: buildLegacyChat(),
        roster: null,
        topicLookup: NO_TOPIC,
      });

      expect(chat.name).toBe("Alice, Bob, Carol + 4 more");
      expect(Object.keys(chat)).not.toContain("topic");
    });

    test.each([
      ["PermissionDenied", DENIED],
      ["Unknown", UNKNOWN],
      ["not asked", undefined],
      ["NoTopic", NO_TOPIC],
    ])(
      "a legacy record, no roster, no name (Graph %s): the stored name is kept, never 'Group chat'",
      (_label: string, lookup: MicrosoftTeamsChatTopicLookup | undefined) => {
        const chat: MicrosoftTeamsChat = capture({
          storedChat: buildLegacyChat({ name: "Alice, Bob" }),
          roster: null,
          topicLookup: lookup,
        });

        expect(chat.name).toBe("Alice, Bob");
        // Still no count: the next message re-captures it and tries again.
        expect(Object.keys(chat)).not.toContain("memberCount");
        expect(Object.keys(chat)).not.toContain("memberNames");
        expect(Object.keys(chat)).not.toContain("topic");
      },
    );

    test("no roster: the stored member names, count and Entra ids are kept", () => {
      const storedChat: MicrosoftTeamsChat = buildChat({
        name: "Alice, Bob, Carol + 3 more",
        memberNames: ["Alice", "Bob", "Carol"],
        memberCount: 6,
        memberAadObjectIds: ["aad-a", "aad-b"],
      });

      const chat: MicrosoftTeamsChat = capture({
        storedChat: storedChat,
        roster: null,
        topicLookup: UNKNOWN,
      });

      expect(chat.memberNames).toEqual(["Alice", "Bob", "Carol"]);
      expect(chat.memberCount).toBe(6);
      expect(chat.memberAadObjectIds).toEqual(["aad-a", "aad-b"]);
      expect(chat.name).toBe("Alice, Bob, Carol + 3 more");
    });

    test("a roster that was read replaces the stored members", () => {
      const chat: MicrosoftTeamsChat = capture({
        storedChat: buildChat(),
        roster: newRoster,
        topicLookup: UNKNOWN,
      });

      expect(chat.memberNames).toEqual(["Alice", "Bob", "Carol"]);
      expect(chat.memberCount).toBe(5);
      expect(chat.memberAadObjectIds).toEqual(newRoster.memberAadObjectIds);
      expect(chat.name).toBe("Alice, Bob, Carol + 2 more");
    });

    test("a legacy record read in full gains its Teams name and member count", () => {
      expect(
        capture({ storedChat: buildLegacyChat(), topicLookup: FOUND }),
      ).toStrictEqual({
        id: GROUP_CHAT_ID,
        name: TEAMS_NAME,
        chatType: "groupChat",
        serviceUrl: SERVICE_URL,
        addedAt: ADDED_AT,
        memberAadObjectIds: ISSUE_AAD_IDS,
        topic: TEAMS_NAME,
        memberNames: ISSUE_MEMBERS_SHOWN,
        memberCount: 4,
      });
    });

    test("the stored addedAt is kept: hearing from a chat again is not connecting it", () => {
      expect(capture({ storedChat: buildChat() }).addedAt).toBe(ADDED_AT);
    });

    test("a stored record without addedAt gets now", () => {
      const storedChat: MicrosoftTeamsChat = buildChat();
      delete storedChat.addedAt;

      expect(capture({ storedChat: storedChat }).addedAt).toBe(NOW);
    });

    test("the stored record is not mutated", () => {
      const storedChat: MicrosoftTeamsChat = buildNamedChat();
      const snapshot: string = JSON.stringify(storedChat);

      capture({
        storedChat: storedChat,
        roster: newRoster,
        topicLookup: NO_TOPIC,
      });

      expect(JSON.stringify(storedChat)).toBe(snapshot);
    });
  });

  describe("personal chats", () => {
    test("are named after the other person, with their roster stored", () => {
      expect(
        capture({
          chatId: PERSONAL_CHAT_ID,
          chatType: "personal",
          roster: {
            memberNames: ["Jane Doe"],
            memberAadObjectIds: ["aad-jane"],
          },
        }),
      ).toStrictEqual({
        id: PERSONAL_CHAT_ID,
        name: "Jane Doe",
        chatType: "personal",
        serviceUrl: SERVICE_URL,
        addedAt: NOW,
        memberAadObjectIds: ["aad-jane"],
        memberNames: ["Jane Doe"],
        memberCount: 1,
      });
    });

    test("no roster: the stored name and Entra ids are kept (it stays a DM target)", () => {
      const chat: MicrosoftTeamsChat = capture({
        chatId: PERSONAL_CHAT_ID,
        chatType: "personal",
        roster: null,
        storedChat: buildPersonalChat({ serviceUrl: OLD_SERVICE_URL }),
      });

      expect(chat).toStrictEqual(buildPersonalChat());
    });

    test("no roster and nothing stored: 'Personal chat'", () => {
      const chat: MicrosoftTeamsChat = capture({
        chatId: PERSONAL_CHAT_ID,
        chatType: "personal",
        roster: null,
      });

      expect(chat.name).toBe("Personal chat");
      expect(chat.memberAadObjectIds).toEqual([]);
    });
  });
});

describe("MicrosoftTeamsUtil.getTenantChatContext", () => {
  test("reads the tenant's Microsoft Teams connections once, as root, with their chats", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([]);

    await tenantChatContext()({ tenantId: TENANT_ID, chatId: GROUP_CHAT_ID });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(findBySpy).toHaveBeenCalledWith({
      query: {
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: TENANT_ID,
      },
      select: { _id: true, projectId: true, miscData: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("the project is the first connection that has one", async () => {
    const projectId: ObjectID = ObjectID.generate();
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([
        buildAuthRow({}),
        buildAuthRow({ projectId: projectId }),
        buildAuthRow({ projectId: ObjectID.generate() }),
      ]);

    const context: TenantChatContext = await tenantChatContext()({
      tenantId: TENANT_ID,
      chatId: GROUP_CHAT_ID,
    });

    expect(context.projectId).toBe(projectId);
  });

  test("the stored chat is the first connection's copy of it, and may come from another row than the project", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const firstCopy: MicrosoftTeamsChat = buildNamedChat();
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildAuthRow({ projectId: projectId }),
      buildAuthRow({ withoutMiscData: true }),
      buildAuthRow({ availableChats: { [GROUP_CHAT_ID]: firstCopy } }),
      buildAuthRow({
        projectId: ObjectID.generate(),
        availableChats: {
          [GROUP_CHAT_ID]: buildChat({ name: "A later copy" }),
        },
      }),
    ]);

    const context: TenantChatContext = await tenantChatContext()({
      tenantId: TENANT_ID,
      chatId: GROUP_CHAT_ID,
    });

    expect(context.projectId).toBe(projectId);
    expect(context.storedChat).toBe(firstCopy);
  });

  test("only this chat is returned, not another stored chat", async () => {
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildAuthRow({
        projectId: ObjectID.generate(),
        availableChats: {
          "19:other@thread.v2": buildChat({ id: "19:other@thread.v2" }),
        },
      }),
    ]);

    const context: TenantChatContext = await tenantChatContext()({
      tenantId: TENANT_ID,
      chatId: GROUP_CHAT_ID,
    });

    expect(context.storedChat).toBeUndefined();
  });

  test("no connections: no project and no stored chat", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([]);

    await expect(
      tenantChatContext()({ tenantId: TENANT_ID, chatId: GROUP_CHAT_ID }),
    ).resolves.toEqual({ projectId: null, storedChat: undefined });
  });

  test("a failed read throws: capturing blind would overwrite what is stored", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockRejectedValue(new Error("db down"));

    await expect(
      tenantChatContext()({ tenantId: TENANT_ID, chatId: GROUP_CHAT_ID }),
    ).rejects.toThrow("db down");
  });
});

describe("chat capture reads the group chat's name from Graph", () => {
  const projectId: ObjectID = ObjectID.generate();
  let saveSpy: jest.SpyInstance;
  let tenantContextSpy: jest.SpyInstance;
  let topicSpy: jest.SpyInstance;

  beforeEach(() => {
    saveSpy = jest
      .spyOn(MicrosoftTeamsUtil, "saveChatToProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MicrosoftTeamsUtil, "removeChatFromProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MicrosoftTeamsUtil as any, "sendWelcomeAdaptiveCard")
      .mockResolvedValue(undefined as never);
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(new Date(NOW));
    tenantContextSpy = jest
      .spyOn(MicrosoftTeamsUtil as any, "getTenantChatContext")
      .mockResolvedValue({
        projectId: projectId,
        storedChat: undefined,
      } as never);
    topicSpy = jest.spyOn(MicrosoftTeamsUtil, "getGroupChatTopicFromGraph");
  });

  function mockTopic(lookup: MicrosoftTeamsChatTopicLookup): void {
    topicSpy.mockResolvedValue(lookup);
  }

  function mockStoredChat(storedChat: MicrosoftTeamsChat): void {
    tenantContextSpy.mockResolvedValue({
      projectId: projectId,
      storedChat: storedChat,
    } as never);
  }

  function botAddedToGroupChat(conversation?: JSONObject): JSONObject {
    return {
      membersAdded: [{ id: BOT_RECIPIENT_ID }],
      conversation: conversation || {
        conversationType: "groupChat",
        id: GROUP_CHAT_ID,
      },
      channelData: { tenant: { id: TENANT_ID } },
      serviceUrl: SERVICE_URL,
    };
  }

  async function addBot(conversation?: JSONObject): Promise<void> {
    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: botAddedToGroupChat(conversation),
      turnContext: buildTurnContext(),
    });
  }

  async function installationUpdate(action: string): Promise<void> {
    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: {
        action: action,
        conversation: { conversationType: "groupChat", id: GROUP_CHAT_ID },
        channelData: { tenant: { id: TENANT_ID } },
        serviceUrl: SERVICE_URL,
      },
      turnContext: buildTurnContext(),
    });
  }

  function savedChat(): MicrosoftTeamsChat {
    expect(saveSpy).toHaveBeenCalledTimes(1);
    return (saveSpy.mock.calls[0]![0] as { chat: MicrosoftTeamsChat }).chat;
  }

  test("the issue: a named group chat is saved under its name, with three member names and a count", async () => {
    mockIssueMembers();
    mockTopic(FOUND);

    await addBot();

    expect(savedChat()).toStrictEqual({
      id: GROUP_CHAT_ID,
      name: TEAMS_NAME,
      chatType: "groupChat",
      serviceUrl: SERVICE_URL,
      addedAt: NOW,
      memberAadObjectIds: ISSUE_AAD_IDS,
      topic: TEAMS_NAME,
      memberNames: ISSUE_MEMBERS_SHOWN,
      memberCount: 4,
    });
    expect(savedChat().name).not.toContain("Contractor");
    expect(saveSpy.mock.calls[0]![0]).toMatchObject({ tenantId: TENANT_ID });
  });

  test("when the stored chat cannot be read, nothing is saved and Graph is not asked", async () => {
    /*
     * Saving without knowing what is stored would replace a chat's real name
     * with whatever this activity could supply (e.g. member names).
     */
    mockIssueMembers();
    tenantContextSpy.mockRejectedValue(new Error("db down"));
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    await addBot();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("the tenant's context is read for this chat, and Graph is asked with its project", async () => {
    mockIssueMembers();
    mockTopic(FOUND);

    await addBot();

    expect(tenantContextSpy).toHaveBeenCalledTimes(1);
    expect(tenantContextSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      chatId: GROUP_CHAT_ID,
    });
    expect(topicSpy).toHaveBeenCalledTimes(1);
    // One chat, so no token is handed in: the lookup fetches its own.
    expect(topicSpy.mock.calls[0]![0]).toStrictEqual({
      projectId: projectId,
      chatId: GROUP_CHAT_ID,
    });
  });

  test("the bot and blank names are left out of the stored members", async () => {
    mockMembers([
      { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      { id: "user-1", name: "Alice", aadObjectId: "aad-1" },
      { id: "user-2", name: "   " },
      { id: "user-3", name: "Bob", aadObjectId: "aad-3" },
    ]);
    mockTopic(FOUND);

    await addBot();

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.memberNames).toEqual(["Alice", "Bob"]);
    expect(chat.memberCount).toBe(2);
    expect(chat.memberAadObjectIds).toEqual(["aad-1", "aad-3"]);
  });

  test.each([
    ["NoTopic", NO_TOPIC],
    ["PermissionDenied", DENIED],
    ["Unknown", UNKNOWN],
  ])(
    "a first capture with Graph %s is still saved, under its members' names",
    async (_label: string, lookup: MicrosoftTeamsChatTopicLookup) => {
      mockIssueMembers();
      mockTopic(lookup);

      await addBot();

      const chat: MicrosoftTeamsChat = savedChat();
      expect(chat.name).toBe(ISSUE_MEMBER_NAME);
      expect(chat.memberNames).toEqual(ISSUE_MEMBERS_SHOWN);
      expect(chat.memberCount).toBe(4);
      expect(Object.keys(chat)).not.toContain("topic");
    },
  );

  test.each([
    ["Unknown", UNKNOWN],
    ["PermissionDenied", DENIED],
  ])(
    "re-adding the bot to a chat whose Teams name is stored keeps that name when Graph is %s",
    async (_label: string, lookup: MicrosoftTeamsChatTopicLookup) => {
      mockIssueMembers();
      mockStoredChat(buildNamedChat({ serviceUrl: OLD_SERVICE_URL }));
      mockTopic(lookup);

      await addBot();

      const chat: MicrosoftTeamsChat = savedChat();
      expect(chat.name).toBe(TEAMS_NAME);
      expect(chat.topic).toBe(TEAMS_NAME);
      expect(chat.serviceUrl).toBe(SERVICE_URL);
    },
  );

  test("a re-capture keeps the date the chat was first connected", async () => {
    mockIssueMembers();
    mockStoredChat(buildChat({ addedAt: ADDED_AT }));
    mockTopic(UNKNOWN);

    await addBot();

    expect(savedChat().addedAt).toBe(ADDED_AT);
  });

  test("a name on the activity itself is used as is, and Graph is not called", async () => {
    mockIssueMembers();

    await addBot({
      conversationType: "groupChat",
      id: GROUP_CHAT_ID,
      name: "Ops War Room",
    });

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.name).toBe("Ops War Room");
    expect(chat.topic).toBe("Ops War Room");
    expect(topicSpy).not.toHaveBeenCalled();
  });

  test("a whitespace-only name on the activity is ignored and Graph is asked", async () => {
    mockIssueMembers();
    mockTopic(FOUND);

    await addBot({
      conversationType: "groupChat",
      id: GROUP_CHAT_ID,
      name: "   ",
    });

    expect(savedChat().name).toBe(TEAMS_NAME);
    expect(topicSpy).toHaveBeenCalledTimes(1);
  });

  test("a name on the activity that is not a string is ignored and Graph is asked", async () => {
    mockIssueMembers();
    mockTopic(FOUND);

    await addBot({
      conversationType: "groupChat",
      id: GROUP_CHAT_ID,
      name: 42,
    });

    expect(savedChat().name).toBe(TEAMS_NAME);
    expect(topicSpy).toHaveBeenCalledTimes(1);
  });

  test("personal chats are never looked up — they have no name, and keep the other person's", async () => {
    mockMembers([
      { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      { id: "user-1", name: "Jane Doe", aadObjectId: "aad-jane" },
    ]);

    await addBot({ conversationType: "personal", id: PERSONAL_CHAT_ID });

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.chatType).toBe("personal");
    expect(chat.name).toBe("Jane Doe");
    expect(chat.memberAadObjectIds).toEqual(["aad-jane"]);
    expect(topicSpy).not.toHaveBeenCalled();
  });

  test("channels are still ignored: no read, no lookup, no save", async () => {
    mockIssueMembers();

    await addBot({ conversationType: "channel", id: "19:chan@thread.tacv2" });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(tenantContextSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
  });

  test("no project connected to the tenant: Graph is skipped and members name the chat", async () => {
    mockIssueMembers();
    tenantContextSpy.mockResolvedValue({
      projectId: null,
      storedChat: undefined,
    } as never);

    await addBot();

    expect(topicSpy).not.toHaveBeenCalled();
    expect(savedChat().name).toBe(ISSUE_MEMBER_NAME);
  });

  test("a failed roster fetch still gets the Graph name, and leaves the member count unset", async () => {
    mockRosterFailure();
    mockTopic(FOUND);

    await addBot();

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.name).toBe(TEAMS_NAME);
    expect(Object.keys(chat)).not.toContain("memberNames");
    expect(Object.keys(chat)).not.toContain("memberCount");
  });

  test("a failed roster fetch and no Graph name falls back to 'Group chat'", async () => {
    mockRosterFailure();
    mockTopic(NO_TOPIC);

    await addBot();

    expect(savedChat().name).toBe("Group chat");
  });

  test("a long Graph name is cut to 80 characters like any other name", async () => {
    mockIssueMembers();
    const longTopic: string =
      "Payments platform — production incident bridge for the EMEA and APAC on-call rotations";
    expect(longTopic.length).toBeGreaterThan(80);
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: longTopic,
    });

    await addBot();

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.name).toHaveLength(80);
    expect(chat.name.endsWith("…")).toBe(true);
    expect(chat.name.startsWith("Payments platform — production")).toBe(true);
    expect(chat.topic).toBe(longTopic);
  });

  test("group chats with the same members are told apart by their names", async () => {
    mockIssueMembers();
    topicSpy
      .mockResolvedValueOnce({
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Payments on-call",
      })
      .mockResolvedValueOnce({
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Search on-call",
      });

    await addBot({ conversationType: "groupChat", id: "19:one@thread.v2" });
    await addBot({ conversationType: "groupChat", id: "19:two@thread.v2" });

    const names: Array<string> = saveSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { chat: MicrosoftTeamsChat }).chat.name;
      },
    );
    expect(names).toEqual(["Payments on-call", "Search on-call"]);
  });

  test("installationUpdate 'add' in a group chat also stores the Graph name", async () => {
    mockIssueMembers();
    mockTopic(FOUND);

    await installationUpdate("add");

    expect(savedChat().name).toBe(TEAMS_NAME);
    expect(savedChat().memberCount).toBe(4);
  });

  test("installationUpdate 'add-upgrade' (an upgrade that adds the bot) captures the chat like 'add'", async () => {
    mockIssueMembers();
    mockStoredChat(buildLegacyChat());
    mockTopic(FOUND);

    await installationUpdate("add-upgrade");

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.name).toBe(TEAMS_NAME);
    expect(chat.topic).toBe(TEAMS_NAME);
    expect(chat.addedAt).toBe(ADDED_AT);
  });

  test("the tenant falls back to conversation.tenantId", async () => {
    mockIssueMembers();
    mockTopic(FOUND);

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: {
        membersAdded: [{ id: BOT_RECIPIENT_ID }],
        conversation: {
          conversationType: "groupChat",
          id: GROUP_CHAT_ID,
          tenantId: "tenant-from-conversation",
        },
        channelData: {},
        serviceUrl: SERVICE_URL,
      },
      turnContext: buildTurnContext(),
    });

    expect(tenantContextSpy).toHaveBeenCalledWith({
      tenantId: "tenant-from-conversation",
      chatId: GROUP_CHAT_ID,
    });
    expect(savedChat().name).toBe(TEAMS_NAME);
  });

  test("end to end through the real tenant read: the stored Teams name survives a Graph refusal", async () => {
    tenantContextSpy.mockRestore();
    mockIssueMembers();
    mockTopic(DENIED);
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildAuthRow({
        projectId: projectId,
        workspaceProjectId: TENANT_ID,
        availableChats: { [GROUP_CHAT_ID]: buildNamedChat() },
      }),
    ]);

    await addBot();

    expect(topicSpy.mock.calls[0]![0]).toMatchObject({ projectId: projectId });
    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.name).toBe(TEAMS_NAME);
    expect(chat.topic).toBe(TEAMS_NAME);
    expect(chat.addedAt).toBe(ADDED_AT);
  });
});

describe("message backfill re-captures group chats stored before names were read", () => {
  const projectId: ObjectID = ObjectID.generate();
  let saveSpy: jest.SpyInstance;
  let topicSpy: jest.SpyInstance;
  let findBySpy: jest.SpyInstance;

  function groupChatMessage(): JSONObject {
    // No @mention, so the handler returns right after the backfill.
    return {
      type: "message",
      text: "hello there",
      from: { id: "user-0", name: ISSUE_MEMBERS[0] },
      recipient: { id: BOT_RECIPIENT_ID },
      conversation: { conversationType: "groupChat", id: GROUP_CHAT_ID },
      channelData: { tenant: { id: TENANT_ID } },
      serviceUrl: SERVICE_URL,
      entities: [],
    };
  }

  async function sendMessage(): Promise<void> {
    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: groupChatMessage(),
      turnContext: buildTurnContext(),
    });
  }

  function storeChat(chat: MicrosoftTeamsChat): void {
    // Both the staleness check and the tenant read go through findBy.
    findBySpy.mockResolvedValue([
      buildAuthRow({
        projectId: projectId,
        workspaceProjectId: TENANT_ID,
        availableChats: { [chat.id]: chat },
      }),
    ]);
  }

  function savedChats(): Array<MicrosoftTeamsChat> {
    return saveSpy.mock.calls.map((call: Array<unknown>) => {
      return (call[0] as { chat: MicrosoftTeamsChat }).chat;
    });
  }

  beforeEach(() => {
    saveSpy = jest
      .spyOn(MicrosoftTeamsUtil, "saveChatToProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    findBySpy = jest.spyOn(WorkspaceProjectAuthTokenService, "findBy");
    topicSpy = jest
      .spyOn(MicrosoftTeamsUtil, "getGroupChatTopicFromGraph")
      .mockResolvedValue(FOUND);
    mockIssueMembers();
  });

  test("a legacy record (no member count) is re-captured with its Teams name and a count", async () => {
    storeChat(buildLegacyChat());

    await sendMessage();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const chat: MicrosoftTeamsChat = savedChats()[0]!;
    expect(chat.name).toBe(TEAMS_NAME);
    expect(chat.topic).toBe(TEAMS_NAME);
    expect(chat.memberNames).toEqual(ISSUE_MEMBERS_SHOWN);
    expect(chat.memberCount).toBe(4);
    expect(chat.addedAt).toBe(ADDED_AT);
    expect(topicSpy).toHaveBeenCalledWith({
      projectId: projectId,
      chatId: GROUP_CHAT_ID,
    });
  });

  test("a legacy record, a failed roster and a Graph 403: the legacy name is kept and the count stays unset, so the next message retries", async () => {
    topicSpy.mockRestore();
    const legacyChat: MicrosoftTeamsChat = buildLegacyChat();
    storeChat(legacyChat);
    mockRosterFailure();
    apiGetSpy.mockResolvedValue(
      graphError(403, {
        error: {
          code: "Forbidden",
          message:
            "Missing role permissions on the request. API requires one of 'ChatSettings.Read.Chat, Chat.ReadBasic.WhereInstalled'.",
        },
      }),
    );

    await sendMessage();

    expect(apiGetSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const firstTry: MicrosoftTeamsChat = savedChats()[0]!;
    expect(firstTry.name).toBe("Alice, Bob, Carol + 4 more");
    expect(firstTry.addedAt).toBe(ADDED_AT);
    expect(Object.keys(firstTry)).not.toContain("memberCount");
    expect(Object.keys(firstTry)).not.toContain("topic");

    // What was saved is still stale, so it is not the end of the story.
    storeChat(firstTry);
    await expect(
      isChatCapturedForTenant({
        tenantId: TENANT_ID,
        chatId: GROUP_CHAT_ID,
        serviceUrl: SERVICE_URL,
      }),
    ).resolves.toBe(false);

    // The next message, with the roster and the permission back, completes it.
    mockIssueMembers();
    apiGetSpy.mockResolvedValue(
      graphOk({ id: GROUP_CHAT_ID, topic: TEAMS_NAME }),
    );

    await sendMessage();

    expect(saveSpy).toHaveBeenCalledTimes(2);
    const secondTry: MicrosoftTeamsChat = savedChats()[1]!;
    expect(secondTry.name).toBe(TEAMS_NAME);
    expect(secondTry.memberCount).toBe(4);
    expect(secondTry.addedAt).toBe(ADDED_AT);
  });

  test("a record captured by this version is left alone: no roster, Graph or write", async () => {
    storeChat(buildNamedChat());

    await sendMessage();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
    expect(TeamsInfo.getPagedMembers).not.toHaveBeenCalled();
  });

  test("a record whose roster was read empty (count 0) is not re-captured on every message", async () => {
    storeChat(
      buildChat({ name: "Group chat", memberNames: [], memberCount: 0 }),
    );

    await sendMessage();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
  });

  test("a moved serviceUrl re-captures a named chat without losing its name when Graph fails", async () => {
    storeChat(buildNamedChat({ serviceUrl: OLD_SERVICE_URL }));
    topicSpy.mockResolvedValue(UNKNOWN);

    await sendMessage();

    const chat: MicrosoftTeamsChat = savedChats()[0]!;
    expect(chat.serviceUrl).toBe(SERVICE_URL);
    expect(chat.name).toBe(TEAMS_NAME);
    expect(chat.topic).toBe(TEAMS_NAME);
  });
});

describe("MicrosoftTeamsUtil.isChatCapturedForTenant — group chat member count", () => {
  function mockRows(chats: Array<MicrosoftTeamsChat | undefined>): void {
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue(
      chats.map((chat: MicrosoftTeamsChat | undefined) => {
        return buildAuthRow({
          availableChats: chat ? { [chat.id]: chat } : {},
        });
      }),
    );
  }

  async function isCaptured(chatId: string): Promise<boolean> {
    return isChatCapturedForTenant({
      tenantId: TENANT_ID,
      chatId: chatId,
      serviceUrl: SERVICE_URL,
    });
  }

  test("a group chat without a member count is stale (captured before names were read)", async () => {
    mockRows([buildLegacyChat()]);

    await expect(isCaptured(GROUP_CHAT_ID)).resolves.toBe(false);
  });

  test("member names without a count are still stale — the count is what marks a full capture", async () => {
    const chat: MicrosoftTeamsChat = buildChat();
    delete chat.memberCount;
    mockRows([chat]);

    await expect(isCaptured(GROUP_CHAT_ID)).resolves.toBe(false);
  });

  test("a group chat with a member count is captured", async () => {
    mockRows([buildChat()]);

    await expect(isCaptured(GROUP_CHAT_ID)).resolves.toBe(true);
  });

  test("a member count of 0 is captured (no re-capture loop for a chat with no named members)", async () => {
    mockRows([buildChat({ memberNames: [], memberCount: 0 })]);

    await expect(isCaptured(GROUP_CHAT_ID)).resolves.toBe(true);
  });

  test("the count rule is for group chats only — a personal chat without one is captured", async () => {
    const personalChat: MicrosoftTeamsChat = buildPersonalChat();
    delete personalChat.memberNames;
    delete personalChat.memberCount;
    mockRows([personalChat]);

    await expect(isCaptured(PERSONAL_CHAT_ID)).resolves.toBe(true);
  });

  test("one legacy row among several complete rows makes the chat stale", async () => {
    mockRows([buildChat(), buildLegacyChat(), buildChat()]);

    await expect(isCaptured(GROUP_CHAT_ID)).resolves.toBe(false);
  });
});

describe("MicrosoftTeamsUtil.getGroupChatTopicFromGraph", () => {
  const projectId: ObjectID = ObjectID.generate();
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
      return;
    });
  });

  async function lookup(data?: {
    chatId?: string | undefined;
    accessToken?: string | undefined;
  }): Promise<MicrosoftTeamsChatTopicLookup> {
    const chatId: string | undefined = data?.chatId;

    return MicrosoftTeamsUtil.getGroupChatTopicFromGraph({
      projectId: projectId,
      chatId: chatId === undefined ? GROUP_CHAT_ID : chatId,
      accessToken: data?.accessToken,
    });
  }

  function requestUrl(): string {
    const args: { url: { toString: () => string } } =
      apiGetSpy.mock.calls[0]![0];
    return args.url.toString();
  }

  function requestHeaders(): JSONObject {
    const args: { headers: JSONObject } = apiGetSpy.mock.calls[0]![0];
    return args.headers;
  }

  test("a named chat comes back as Found with its topic", async () => {
    apiGetSpy.mockResolvedValue(
      graphOk({ id: GROUP_CHAT_ID, topic: TEAMS_NAME, chatType: "group" }),
    );

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: TEAMS_NAME,
    });
  });

  test("calls GET /v1.0/chats/{id} with the chat id URL-encoded, and no $select", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ topic: TEAMS_NAME }));

    await lookup();

    expect(apiGetSpy).toHaveBeenCalledTimes(1);
    expect(requestUrl()).toBe(
      `https://graph.microsoft.com/v1.0/chats/${ENCODED_GROUP_CHAT_ID}`,
    );
    expect(requestUrl()).not.toContain("$select");
    expect(requestUrl()).not.toContain("?");
  });

  test("the lookup has its own timeout, so a stalled read cannot hold a refresh", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ topic: TEAMS_NAME }));

    await lookup();

    const options: { timeout?: number } | undefined =
      apiGetSpy.mock.calls[0]![0].options;
    expect(options?.timeout).toBe(15000);
  });

  test("uses the access token it is given, without fetching one", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ topic: TEAMS_NAME }));

    await lookup({ accessToken: "token-from-refresh" });

    expect(tokenSpy).not.toHaveBeenCalled();
    expect(requestHeaders()["Authorization"]).toBe("Bearer token-from-refresh");
  });

  test("without a token, fetches the project's app-only Graph token", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ topic: TEAMS_NAME }));

    await lookup();

    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(tokenSpy).toHaveBeenCalledWith({
      authToken: "",
      projectId: projectId,
    });
    expect(requestHeaders()["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  test("an empty token counts as none: the project's token is fetched", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ topic: TEAMS_NAME }));

    await lookup({ accessToken: "" });

    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(requestHeaders()["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  test("the topic is trimmed", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ topic: "   Platform On-Call  \n" }));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: TEAMS_NAME,
    });
  });

  test("a topic is returned whole — truncation is the display name's job", async () => {
    const longTopic: string = "Incident bridge ".repeat(12).trim();
    apiGetSpy.mockResolvedValue(graphOk({ topic: longTopic }));

    const result: MicrosoftTeamsChatTopicLookup = await lookup();
    expect(result.topic).toBe(longTopic);
  });

  test.each([
    ["null (Graph's answer for an unnamed group chat)", null],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a number", 42],
    ["an object", { value: TEAMS_NAME }],
  ])("topic that is %s is NoTopic", async (_label: string, topic: unknown) => {
    apiGetSpy.mockResolvedValue(graphOk({ id: GROUP_CHAT_ID, topic } as any));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.NoTopic,
    });
  });

  test("a response without a topic field is NoTopic", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ id: GROUP_CHAT_ID }));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.NoTopic,
    });
  });

  test("403 (the chat has not granted ChatSettings.Read.Chat) is PermissionDenied", async () => {
    apiGetSpy.mockResolvedValue(
      graphError(403, {
        error: {
          code: "Forbidden",
          message:
            "Missing role permissions on the request. API requires one of 'ChatSettings.Read.Chat, Chat.ReadBasic.WhereInstalled'.",
        },
      }),
    );

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Graph's Authorization_RequestDenied code is PermissionDenied whatever the status", async () => {
    // Graph's body for this error: a code and no message of its own.
    const response: HTTPErrorResponse = graphError(400, {
      error: { code: "Authorization_RequestDenied" },
    });
    // What the real getter derives from that body, which is what is matched.
    expect(response.message).toContain("Authorization_RequestDenied");
    apiGetSpy.mockResolvedValue(response);

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
    });
  });

  test("Graph's 'Insufficient privileges' message is PermissionDenied whatever the status", async () => {
    const response: HTTPErrorResponse = graphError(400, {
      error: {
        code: "Authorization_RequestDenied",
        message: "Insufficient privileges to complete the operation.",
      },
    });
    expect(response.message).toBe(
      "Insufficient privileges to complete the operation.",
    );
    apiGetSpy.mockResolvedValue(response);

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
    });
  });

  test("a 400 about something else is Unknown, not PermissionDenied", async () => {
    apiGetSpy.mockResolvedValue(
      graphError(400, {
        error: { code: "BadRequest", message: "Invalid thread id." },
      }),
    );

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
    });
  });

  test("404 is Unknown, and is logged as a warning: the chat id may not be Graph's", async () => {
    apiGetSpy.mockResolvedValue(
      graphError(404, {
        error: { code: "NotFound", message: "Resource not found." },
      }),
    );

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain(GROUP_CHAT_ID);
  });

  test.each([401, 429, 500, 503])(
    "HTTP %s is Unknown, without a warning (a passing throttle or outage)",
    async (statusCode: number) => {
      apiGetSpy.mockResolvedValue(
        graphError(statusCode, {
          error: { code: "Something", message: "Try again later." },
        }),
      );

      await expect(lookup()).resolves.toEqual({
        status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  test("no Graph token (getValidAccessToken throws) is Unknown and never calls Graph", async () => {
    tokenSpy.mockRejectedValue(new Error("no token"));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
    });
    expect(apiGetSpy).not.toHaveBeenCalled();
  });

  test("a network failure (API.get throws) is Unknown — the lookup never throws", async () => {
    apiGetSpy.mockRejectedValue(new Error("ECONNRESET"));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
    });
  });

  test("an empty chat id is Unknown and makes no calls at all", async () => {
    await expect(lookup({ chatId: "" })).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
    });
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(apiGetSpy).not.toHaveBeenCalled();
  });
});

describe("MicrosoftTeamsUtil.refreshChatNamesForProject (Refresh Chats)", () => {
  /*
   * The project's one Microsoft Teams connection, in memory. The rename and
   * the re-read after it run for real against it, so what a refresh returns
   * is what it actually stored.
   */
  let storedChats: Record<string, MicrosoftTeamsChat>;
  let connectionHasTenant: boolean;
  let projectId: ObjectID;
  let topicSpy: jest.SpyInstance;
  let renameSpy: jest.SpyInstance;
  let getProjectAuthSpy: jest.SpyInstance;
  let getChatsSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;

  function connectionRow(): WorkspaceProjectAuthToken {
    return buildAuthRow({
      projectId: projectId,
      workspaceProjectId: connectionHasTenant ? TENANT_ID : undefined,
      availableChats: cloneChats(storedChats),
    });
  }

  beforeEach(() => {
    /*
     * A fresh project per test: refreshes in flight are kept per project, so
     * a test that holds one open cannot leak into the next.
     */
    projectId = ObjectID.generate();
    storedChats = {};
    connectionHasTenant = true;

    topicSpy = jest.spyOn(MicrosoftTeamsUtil, "getGroupChatTopicFromGraph");
    renameSpy = jest.spyOn(
      MicrosoftTeamsUtil,
      "renameChatsInProjectAuthTokens",
    );
    getChatsSpy = jest.spyOn(MicrosoftTeamsUtil, "getChatsForProject");

    getProjectAuthSpy = jest.spyOn(
      WorkspaceProjectAuthTokenService,
      "getProjectAuth",
    );
    getProjectAuthSpy.mockImplementation(
      async (): Promise<WorkspaceProjectAuthToken> => {
        return connectionRow();
      },
    );

    const findBySpy: jest.SpyInstance = jest.spyOn(
      WorkspaceProjectAuthTokenService,
      "findBy",
    );
    findBySpy.mockImplementation(
      async (): Promise<Array<WorkspaceProjectAuthToken>> => {
        return [connectionRow()];
      },
    );

    updateSpy = jest.spyOn(WorkspaceProjectAuthTokenService, "updateOneById");
    updateSpy.mockImplementation(
      async (args: {
        data: { miscData: MicrosoftTeamsMiscData };
      }): Promise<void> => {
        storedChats = cloneChats(args.data.miscData.availableChats || {});
      },
    );
  });

  function storeChats(chats: Array<MicrosoftTeamsChat>): void {
    storedChats = cloneChats(chatsById(chats));
  }

  function topics(
    byChatId: Record<string, MicrosoftTeamsChatTopicLookup>,
  ): void {
    topicSpy.mockImplementation(
      async (data: {
        chatId: string;
      }): Promise<MicrosoftTeamsChatTopicLookup> => {
        return byChatId[data.chatId] || UNKNOWN;
      },
    );
  }

  function chatNamesWritten(): Record<string, MicrosoftTeamsChatNameUpdate> {
    expect(renameSpy).toHaveBeenCalledTimes(1);
    return (
      renameSpy.mock.calls[0]![0] as {
        chatNames: Record<string, MicrosoftTeamsChatNameUpdate>;
      }
    ).chatNames;
  }

  async function refresh(
    forProjectId?: ObjectID,
  ): Promise<MicrosoftTeamsChatNameRefreshResult> {
    return MicrosoftTeamsUtil.refreshChatNamesForProject({
      projectId: forProjectId || projectId,
    });
  }

  test("reads the project's own Microsoft Teams connection", async () => {
    await refresh();

    expect(getProjectAuthSpy).toHaveBeenCalledWith({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });

  test("the issue: a chat stored under its members' names gets its Teams name and topic written", async () => {
    storeChats([buildChat()]);
    topics({ [GROUP_CHAT_ID]: FOUND });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(renameSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } },
    });
    expect(result.chats[GROUP_CHAT_ID]).toStrictEqual(buildNamedChat());
    expect(storedChats[GROUP_CHAT_ID]).toStrictEqual(buildNamedChat());
    expect(result.permissionDeniedChatIds).toEqual([]);
    expect(result.failedChatIds).toEqual([]);
  });

  test("the Graph token is fetched once for every chat, and handed to each lookup", async () => {
    const chats: Array<MicrosoftTeamsChat> = [];
    for (let index: number = 0; index < 7; index++) {
      chats.push(buildChat({ id: `19:chat-${index}@thread.v2` }));
    }
    storeChats(chats);
    topics({});

    await refresh();

    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(tokenSpy).toHaveBeenCalledWith({
      authToken: "",
      projectId: projectId,
    });
    expect(topicSpy).toHaveBeenCalledTimes(7);
    for (const chat of chats) {
      expect(topicSpy).toHaveBeenCalledWith({
        projectId: projectId,
        chatId: chat.id,
        accessToken: ACCESS_TOKEN,
      });
    }
  });

  test("no Graph token: the refresh fails loudly, and nothing is looked up or written", async () => {
    storeChats([buildChat()]);
    tokenSpy.mockRejectedValue(new Error("token endpoint down"));

    await expect(refresh()).rejects.toThrow("token endpoint down");
    expect(topicSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("a chat renamed in Teams picks up the new name", async () => {
    storeChats([buildNamedChat()]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Payments On-Call",
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(chatNamesWritten()).toStrictEqual({
      [GROUP_CHAT_ID]: { name: "Payments On-Call", topic: "Payments On-Call" },
    });
    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Payments On-Call");
    expect(result.chats[GROUP_CHAT_ID]!.topic).toBe("Payments On-Call");
  });

  test("nothing is written when the name and topic are already right (the list is still re-read)", async () => {
    storeChats([buildNamedChat()]);
    topics({ [GROUP_CHAT_ID]: FOUND });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(renameSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(getChatsSpy).toHaveBeenCalledTimes(1);
    expect(result.chats[GROUP_CHAT_ID]).toStrictEqual(buildNamedChat());
  });

  test("a chat removed mid-refresh is not returned even when nothing was written", async () => {
    storeChats([
      buildNamedChat(),
      buildChat({ id: "19:removed@thread.v2", name: "Soon gone" }),
    ]);
    topicSpy.mockImplementation(
      async (data: {
        chatId: string;
      }): Promise<MicrosoftTeamsChatTopicLookup> => {
        // The bot is removed from the other chat while this one is read.
        delete storedChats["19:removed@thread.v2"];
        return data.chatId === GROUP_CHAT_ID ? FOUND : DENIED;
      },
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(renameSpy).not.toHaveBeenCalled();
    expect(Object.keys(result.chats)).toEqual([GROUP_CHAT_ID]);
  });

  test("a chat already listed under its Teams name, but without the topic, gets the topic written", async () => {
    // Captured by an earlier build: the right name, but no topic to keep it by.
    const chat: MicrosoftTeamsChat = buildChat({ name: TEAMS_NAME });
    storeChats([chat]);
    topics({ [GROUP_CHAT_ID]: FOUND });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(chatNamesWritten()).toStrictEqual({
      [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME },
    });
    expect(result.chats[GROUP_CHAT_ID]!.topic).toBe(TEAMS_NAME);
  });

  test("a new topic that cuts to the same display name is still written", async () => {
    // Both topics share their first 79 characters, so both display the same.
    const sharedStart: string = "x".repeat(79);
    const oldTopic: string = `${sharedStart} old ending`;
    const newTopic: string = `${sharedStart} new ending`;
    const displayName: string = `${sharedStart}…`;
    storeChats([buildChat({ name: displayName, topic: oldTopic })]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: newTopic,
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(chatNamesWritten()).toStrictEqual({
      [GROUP_CHAT_ID]: { name: displayName, topic: newTopic },
    });
    expect(result.chats[GROUP_CHAT_ID]!.topic).toBe(newTopic);
    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(displayName);
  });

  test("a chat whose name was removed in Teams goes back to its stored members and count, and loses its topic", async () => {
    storeChats([buildNamedChat()]);
    topics({ [GROUP_CHAT_ID]: NO_TOPIC });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    // No topic key at all: the write removes the stored one.
    expect(chatNamesWritten()).toStrictEqual({
      [GROUP_CHAT_ID]: { name: ISSUE_MEMBER_NAME },
    });
    expect(result.chats[GROUP_CHAT_ID]).toStrictEqual(buildChat());
    expect(Object.keys(storedChats[GROUP_CHAT_ID]!)).not.toContain("topic");
  });

  test("the stored member count, not just the three names, sets '+ N more' after a name is removed", async () => {
    storeChats([
      buildNamedChat({
        memberNames: ["Alice", "Bob", "Carol"],
        memberCount: 6,
      }),
    ]);
    topics({ [GROUP_CHAT_ID]: NO_TOPIC });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(
      "Alice, Bob, Carol + 3 more",
    );
  });

  test("a removed Teams name with no stored members becomes 'Group chat', not the old name", async () => {
    storeChats([buildLegacyChat({ name: TEAMS_NAME, topic: TEAMS_NAME })]);
    topics({ [GROUP_CHAT_ID]: NO_TOPIC });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(chatNamesWritten()).toStrictEqual({
      [GROUP_CHAT_ID]: { name: "Group chat" },
    });
    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Group chat");
    expect(Object.keys(result.chats[GROUP_CHAT_ID]!)).not.toContain("topic");
  });

  test("an unnamed chat with no stored members and no stored topic keeps its current name", async () => {
    storeChats([buildLegacyChat({ name: "Alice, Bob" })]);
    topics({ [GROUP_CHAT_ID]: NO_TOPIC });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Alice, Bob");
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("an unnamed chat with an empty stored roster keeps its current name", async () => {
    storeChats([
      buildChat({ name: "Alice, Bob", memberNames: [], memberCount: 0 }),
    ]);
    topics({ [GROUP_CHAT_ID]: NO_TOPIC });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Alice, Bob");
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("a legacy record without members still gets its Graph name", async () => {
    storeChats([buildLegacyChat()]);
    topics({ [GROUP_CHAT_ID]: FOUND });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(TEAMS_NAME);
    expect(result.chats[GROUP_CHAT_ID]!.topic).toBe(TEAMS_NAME);
  });

  test("PermissionDenied is reported by chat id, and the chat keeps its name", async () => {
    storeChats([buildNamedChat()]);
    topics({ [GROUP_CHAT_ID]: DENIED });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.permissionDeniedChatIds).toEqual([GROUP_CHAT_ID]);
    expect(result.failedChatIds).toEqual([]);
    expect(result.chats[GROUP_CHAT_ID]).toStrictEqual(buildNamedChat());
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("Unknown is reported as failed by chat id, separately from PermissionDenied", async () => {
    storeChats([buildChat()]);
    topics({ [GROUP_CHAT_ID]: UNKNOWN });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.permissionDeniedChatIds).toEqual([]);
    expect(result.failedChatIds).toEqual([GROUP_CHAT_ID]);
    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(ISSUE_MEMBER_NAME);
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("mixed answers: writes what changed once, and reports the rest by id", async () => {
    storeChats([
      buildChat({ id: "19:found@thread.v2" }),
      buildNamedChat({ id: "19:same@thread.v2" }),
      buildChat({ id: "19:denied-1@thread.v2" }),
      buildChat({ id: "19:unknown@thread.v2" }),
      buildChat({ id: "19:denied-2@thread.v2" }),
      buildNamedChat({ id: "19:cleared@thread.v2" }),
      buildPersonalChat(),
    ]);
    topics({
      "19:found@thread.v2": {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Payments on-call",
      },
      "19:same@thread.v2": FOUND,
      "19:denied-1@thread.v2": DENIED,
      "19:denied-2@thread.v2": DENIED,
      "19:unknown@thread.v2": UNKNOWN,
      "19:cleared@thread.v2": NO_TOPIC,
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.permissionDeniedChatIds).toEqual([
      "19:denied-1@thread.v2",
      "19:denied-2@thread.v2",
    ]);
    expect(result.failedChatIds).toEqual(["19:unknown@thread.v2"]);
    expect(chatNamesWritten()).toStrictEqual({
      "19:found@thread.v2": {
        name: "Payments on-call",
        topic: "Payments on-call",
      },
      "19:cleared@thread.v2": { name: ISSUE_MEMBER_NAME },
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(result.chats["19:found@thread.v2"]!.name).toBe("Payments on-call");
    expect(result.chats["19:same@thread.v2"]!.name).toBe(TEAMS_NAME);
    expect(result.chats["19:denied-1@thread.v2"]!.name).toBe(ISSUE_MEMBER_NAME);
    expect(result.chats["19:cleared@thread.v2"]!.name).toBe(ISSUE_MEMBER_NAME);
    expect(result.chats[PERSONAL_CHAT_ID]).toStrictEqual(buildPersonalChat());
  });

  test("personal chats are returned untouched and never looked up", async () => {
    storeChats([buildPersonalChat(), buildChat()]);
    topics({ [GROUP_CHAT_ID]: FOUND });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(topicSpy).toHaveBeenCalledTimes(1);
    expect(topicSpy.mock.calls[0]![0]).toMatchObject({
      chatId: GROUP_CHAT_ID,
    });
    expect(result.chats[PERSONAL_CHAT_ID]).toStrictEqual(buildPersonalChat());
  });

  test("only personal chats: no token, no Graph calls, no writes, nothing reported", async () => {
    storeChats([
      buildPersonalChat({ id: "a:1", name: "Jane" }),
      buildPersonalChat({ id: "a:2", name: "John" }),
    ]);

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(tokenSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
    expect(Object.keys(result.chats).sort()).toEqual(["a:1", "a:2"]);
    expect(result.permissionDeniedChatIds).toEqual([]);
    expect(result.failedChatIds).toEqual([]);
  });

  test("no Microsoft Teams connection: an empty result, no token and no calls", async () => {
    getProjectAuthSpy.mockResolvedValue(null);

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result).toEqual({
      chats: {},
      permissionDeniedChatIds: [],
      failedChatIds: [],
    });
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("a connection without miscData: an empty result and no calls", async () => {
    getProjectAuthSpy.mockResolvedValue(
      buildAuthRow({
        projectId: projectId,
        workspaceProjectId: TENANT_ID,
        withoutMiscData: true,
      }),
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats).toEqual({});
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
  });

  test("a connection without a tenant id returns the stored chats without a token or lookups", async () => {
    storeChats([buildChat()]);
    connectionHasTenant = false;

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats).toStrictEqual({ [GROUP_CHAT_ID]: buildChat() });
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("the chats returned after a write are re-read: a chat removed mid-refresh is not returned", async () => {
    storeChats([
      buildChat(),
      buildChat({ id: "19:removed@thread.v2", name: "Soon gone" }),
    ]);
    topicSpy.mockImplementation(
      async (data: {
        chatId: string;
      }): Promise<MicrosoftTeamsChatTopicLookup> => {
        // The bot is removed from the other chat while this one is read.
        delete storedChats["19:removed@thread.v2"];
        return data.chatId === GROUP_CHAT_ID ? FOUND : UNKNOWN;
      },
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(getChatsSpy).toHaveBeenCalledTimes(1);
    expect(getChatsSpy).toHaveBeenCalledWith({ projectId: projectId });
    expect(Object.keys(result.chats)).toEqual([GROUP_CHAT_ID]);
    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(TEAMS_NAME);
    expect(storedChats["19:removed@thread.v2"]).toBeUndefined();
    // The id is still reported; dropping ids of chats that are gone is the route's job.
    expect(result.failedChatIds).toEqual(["19:removed@thread.v2"]);
  });

  test("a chat removed mid-refresh is not brought back by the write, even when its name was read", async () => {
    storeChats([
      buildChat(),
      buildChat({ id: "19:removed@thread.v2", name: "Soon gone" }),
    ]);
    topicSpy.mockImplementation(
      async (data: {
        chatId: string;
      }): Promise<MicrosoftTeamsChatTopicLookup> => {
        delete storedChats["19:removed@thread.v2"];
        return {
          status: MicrosoftTeamsChatTopicLookupStatus.Found,
          topic: `Name of ${data.chatId}`,
        };
      },
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(Object.keys(chatNamesWritten()).sort()).toEqual(
      [GROUP_CHAT_ID, "19:removed@thread.v2"].sort(),
    );
    expect(storedChats["19:removed@thread.v2"]).toBeUndefined();
    expect(result.chats["19:removed@thread.v2"]).toBeUndefined();
  });

  test("the connection row it read is not mutated in place", async () => {
    storeChats([buildChat()]);
    const readRow: WorkspaceProjectAuthToken = connectionRow();
    const snapshot: string = JSON.stringify(readRow.miscData);
    getProjectAuthSpy.mockResolvedValueOnce(readRow);
    topics({ [GROUP_CHAT_ID]: FOUND });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(TEAMS_NAME);
    expect(JSON.stringify(readRow.miscData)).toBe(snapshot);
  });

  test("long Teams names are cut for display on refresh too, and the topic is kept whole", async () => {
    storeChats([buildChat()]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "x".repeat(200),
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(`${"x".repeat(79)}…`);
    expect(result.chats[GROUP_CHAT_ID]!.topic).toBe("x".repeat(200));
  });

  test("lookups run at most 5 at a time, and every chat is looked up", async () => {
    const chats: Array<MicrosoftTeamsChat> = [];
    for (let index: number = 0; index < 12; index++) {
      chats.push(buildChat({ id: `19:chat-${index}@thread.v2` }));
    }
    storeChats(chats);

    // Each lookup stays pending until the test answers it.
    const pending: Array<{
      chatId: string;
      answer: Deferred<MicrosoftTeamsChatTopicLookup>;
    }> = [];
    let inFlight: number = 0;
    let maxInFlight: number = 0;

    topicSpy.mockImplementation(
      (data: { chatId: string }): Promise<MicrosoftTeamsChatTopicLookup> => {
        const answer: Deferred<MicrosoftTeamsChatTopicLookup> =
          createDeferred<MicrosoftTeamsChatTopicLookup>();
        pending.push({ chatId: data.chatId, answer: answer });
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return answer.promise.then(
          (
            lookupResult: MicrosoftTeamsChatTopicLookup,
          ): MicrosoftTeamsChatTopicLookup => {
            inFlight--;
            return lookupResult;
          },
        );
      },
    );

    const answerAll: (from: number, to: number) => void = (
      from: number,
      to: number,
    ): void => {
      for (const lookup of pending.slice(from, to)) {
        lookup.answer.resolve({
          status: MicrosoftTeamsChatTopicLookupStatus.Found,
          topic: `Name of ${lookup.chatId}`,
        });
      }
    };

    const refreshing: Promise<MicrosoftTeamsChatNameRefreshResult> = refresh();

    await waitUntil(() => {
      return pending.length === 5;
    });
    // Every chance to start a sixth before the first five are answered.
    await flushMicrotasks();
    await flushMicrotasks();
    expect(pending).toHaveLength(5);
    expect(inFlight).toBe(5);

    answerAll(0, 5);
    await waitUntil(() => {
      return pending.length === 10;
    });
    await flushMicrotasks();
    expect(pending).toHaveLength(10);
    expect(inFlight).toBe(5);

    answerAll(5, 10);
    await waitUntil(() => {
      return pending.length === 12;
    });
    await flushMicrotasks();
    expect(pending).toHaveLength(12);
    expect(inFlight).toBe(2);

    answerAll(10, 12);
    const result: MicrosoftTeamsChatNameRefreshResult = await refreshing;

    expect(maxInFlight).toBe(5);
    expect(
      pending.map(
        (lookup: {
          chatId: string;
          answer: Deferred<MicrosoftTeamsChatTopicLookup>;
        }) => {
          return lookup.chatId;
        },
      ),
    ).toEqual(
      chats.map((chat: MicrosoftTeamsChat) => {
        return chat.id;
      }),
    );
    expect(Object.keys(chatNamesWritten())).toHaveLength(12);
    expect(result.chats["19:chat-11@thread.v2"]!.name).toBe(
      "Name of 19:chat-11@thread.v2",
    );
  });

  test("two refreshes of one project at once share a single run and a single result", async () => {
    storeChats([buildChat()]);
    topics({ [GROUP_CHAT_ID]: FOUND });
    const heldConnection: Deferred<WorkspaceProjectAuthToken> =
      createDeferred<WorkspaceProjectAuthToken>();
    getProjectAuthSpy.mockImplementationOnce(
      (): Promise<WorkspaceProjectAuthToken> => {
        return heldConnection.promise;
      },
    );

    const first: Promise<MicrosoftTeamsChatNameRefreshResult> = refresh();
    const second: Promise<MicrosoftTeamsChatNameRefreshResult> = refresh();
    await waitUntil(() => {
      return getProjectAuthSpy.mock.calls.length > 0;
    });
    await flushMicrotasks();
    expect(getProjectAuthSpy).toHaveBeenCalledTimes(1);

    heldConnection.resolve(connectionRow());
    const results: Array<MicrosoftTeamsChatNameRefreshResult> =
      await Promise.all([first, second]);

    expect(results[0]).toBe(results[1]);
    expect(results[0]!.chats[GROUP_CHAT_ID]!.name).toBe(TEAMS_NAME);
    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(topicSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    // getChatsForProject reads the connection once more, after the write.
    expect(getProjectAuthSpy).toHaveBeenCalledTimes(2);
  });

  test("refreshes of different projects run separately", async () => {
    const otherProjectId: ObjectID = ObjectID.generate();
    storeChats([buildChat()]);
    topics({ [GROUP_CHAT_ID]: DENIED });
    const heldConnection: Deferred<WorkspaceProjectAuthToken> =
      createDeferred<WorkspaceProjectAuthToken>();
    getProjectAuthSpy.mockImplementation(
      (): Promise<WorkspaceProjectAuthToken> => {
        return heldConnection.promise;
      },
    );

    const first: Promise<MicrosoftTeamsChatNameRefreshResult> = refresh();
    const second: Promise<MicrosoftTeamsChatNameRefreshResult> =
      refresh(otherProjectId);
    await waitUntil(() => {
      return getProjectAuthSpy.mock.calls.length === 2;
    });

    expect(getProjectAuthSpy).toHaveBeenCalledWith({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
    expect(getProjectAuthSpy).toHaveBeenCalledWith({
      projectId: otherProjectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    heldConnection.resolve(connectionRow());
    const results: Array<MicrosoftTeamsChatNameRefreshResult> =
      await Promise.all([first, second]);

    expect(results[0]).not.toBe(results[1]);
    expect(topicSpy).toHaveBeenCalledTimes(2);
  });

  test("once a refresh has finished, the next one is a new run", async () => {
    storeChats([buildChat()]);
    topics({ [GROUP_CHAT_ID]: UNKNOWN });

    const first: MicrosoftTeamsChatNameRefreshResult = await refresh();
    const second: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(first).not.toBe(second);
    // Each run reads the connection, then re-reads the stored chats.
    expect(getProjectAuthSpy).toHaveBeenCalledTimes(4);
    expect(topicSpy).toHaveBeenCalledTimes(2);
  });

  test("a refresh that failed is not reused: both callers see the failure, and the next call runs again", async () => {
    storeChats([buildChat()]);
    topics({ [GROUP_CHAT_ID]: FOUND });
    tokenSpy.mockRejectedValueOnce(new Error("token endpoint down"));
    const heldConnection: Deferred<WorkspaceProjectAuthToken> =
      createDeferred<WorkspaceProjectAuthToken>();
    getProjectAuthSpy.mockImplementationOnce(
      (): Promise<WorkspaceProjectAuthToken> => {
        return heldConnection.promise;
      },
    );

    // Both callers are listening before the shared run is let go.
    const rejections: Promise<Array<unknown>> = Promise.all([
      rejectionOf(refresh()),
      rejectionOf(refresh()),
    ]);
    heldConnection.resolve(connectionRow());
    const errors: Array<unknown> = await rejections;

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("token endpoint down");
    }
    expect(errors[0]).toBe(errors[1]);
    expect(getProjectAuthSpy).toHaveBeenCalledTimes(1);

    const retried: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(retried.chats[GROUP_CHAT_ID]!.name).toBe(TEAMS_NAME);
    expect(tokenSpy).toHaveBeenCalledTimes(2);
  });

  test("a failing rename write surfaces as an error (the caller shows it)", async () => {
    storeChats([buildChat()]);
    topics({ [GROUP_CHAT_ID]: FOUND });
    renameSpy.mockRejectedValue(new Error("write failed"));

    await expect(refresh()).rejects.toThrow("write failed");
  });

  test("end to end through the real Graph lookup: one token, every chat, and the names written", async () => {
    topicSpy.mockRestore();
    storeChats([
      buildChat({ id: "19:one@thread.v2" }),
      buildChat({ id: "19:two@thread.v2" }),
      buildChat({ id: "19:three@thread.v2" }),
    ]);
    // Graph names each chat after its own id, read back from the request.
    apiGetSpy.mockImplementation(
      async (options: {
        url: { toString: () => string };
      }): Promise<HTTPResponse<JSONObject>> => {
        const encodedChatId: string =
          options.url.toString().split("/chats/")[1] || "";
        return graphOk({ topic: `Named ${decodeURIComponent(encodedChatId)}` });
      },
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(apiGetSpy).toHaveBeenCalledTimes(3);
    for (const call of apiGetSpy.mock.calls) {
      expect(
        (call[0] as { headers: JSONObject }).headers["Authorization"],
      ).toBe(`Bearer ${ACCESS_TOKEN}`);
    }
    for (const chatId of [
      "19:one@thread.v2",
      "19:two@thread.v2",
      "19:three@thread.v2",
    ]) {
      expect(result.chats[chatId]!.name).toBe(`Named ${chatId}`);
      expect(result.chats[chatId]!.topic).toBe(`Named ${chatId}`);
    }
  });

  test("end to end through the real Graph lookup: a 403 is reported as a permission problem", async () => {
    topicSpy.mockRestore();
    storeChats([buildChat()]);
    apiGetSpy.mockResolvedValue(
      graphError(403, {
        error: { code: "Forbidden", message: "Missing role permissions." },
      }),
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.permissionDeniedChatIds).toEqual([GROUP_CHAT_ID]);
    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(ISSUE_MEMBER_NAME);
  });
});

describe("MicrosoftTeamsUtil.renameChatsInProjectAuthTokens", () => {
  let updateSpy: jest.SpyInstance;

  beforeEach(() => {
    updateSpy = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  function mockRows(rows: Array<WorkspaceProjectAuthToken>): jest.SpyInstance {
    return jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue(rows);
  }

  async function rename(
    chatNames: Record<string, MicrosoftTeamsChatNameUpdate>,
  ): Promise<void> {
    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: chatNames,
    });
  }

  function writtenChats(callIndex: number): Record<string, MicrosoftTeamsChat> {
    return updateSpy.mock.calls[callIndex]![0].data.miscData.availableChats;
  }

  test("queries every Microsoft Teams connection of the tenant as root", async () => {
    const findBySpy: jest.SpyInstance = mockRows([]);

    await rename({ [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } });

    expect(findBySpy).toHaveBeenCalledWith({
      query: {
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: TENANT_ID,
      },
      select: { _id: true, miscData: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("writes the name and topic on every project of the tenant", async () => {
    const rowOne: WorkspaceProjectAuthToken = buildAuthRow({
      availableChats: { [GROUP_CHAT_ID]: buildChat() },
    });
    const rowTwo: WorkspaceProjectAuthToken = buildAuthRow({
      availableChats: { [GROUP_CHAT_ID]: buildChat() },
    });
    mockRows([rowOne, rowTwo]);

    await rename({ [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } });

    expect(updateSpy).toHaveBeenCalledTimes(2);
    const updatedIds: Array<string> = updateSpy.mock.calls.map(
      (call: Array<any>) => {
        return call[0].id.toString();
      },
    );
    expect(updatedIds.sort()).toEqual(
      [rowOne.id!.toString(), rowTwo.id!.toString()].sort(),
    );
    for (let index: number = 0; index < 2; index++) {
      expect(writtenChats(index)[GROUP_CHAT_ID]).toStrictEqual(
        buildNamedChat(),
      );
      expect(updateSpy.mock.calls[index]![0].props).toEqual({ isRoot: true });
    }
  });

  test("the name and topic are merged onto the row's current record, not a stale copy", async () => {
    // The chat was re-captured (fresh serviceUrl and roster) after the refresh read it.
    const current: MicrosoftTeamsChat = buildChat({
      serviceUrl: OLD_SERVICE_URL,
      addedAt: "2026-09-28T00:00:00.000Z",
      memberNames: ["Alice", "Bob", "Carol"],
      memberCount: 9,
      memberAadObjectIds: ["aad-a"],
    });
    mockRows([buildAuthRow({ availableChats: { [GROUP_CHAT_ID]: current } })]);

    await rename({ [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } });

    expect(writtenChats(0)[GROUP_CHAT_ID]).toStrictEqual({
      ...current,
      name: TEAMS_NAME,
      topic: TEAMS_NAME,
    });
  });

  test("an update without a topic removes the stored one", async () => {
    const current: MicrosoftTeamsChat = buildNamedChat();
    mockRows([buildAuthRow({ availableChats: { [GROUP_CHAT_ID]: current } })]);

    await rename({ [GROUP_CHAT_ID]: { name: ISSUE_MEMBER_NAME } });

    const expected: MicrosoftTeamsChat = {
      ...current,
      name: ISSUE_MEMBER_NAME,
    };
    delete expected.topic;
    expect(writtenChats(0)[GROUP_CHAT_ID]).toStrictEqual(expected);
    expect(Object.keys(writtenChats(0)[GROUP_CHAT_ID]!)).not.toContain("topic");
  });

  test("the same name without a topic still removes a stored topic", async () => {
    // Graph now says the chat has no name, and the member name happens to match.
    mockRows([
      buildAuthRow({
        availableChats: {
          [GROUP_CHAT_ID]: buildChat({ topic: "An old Teams name" }),
        },
      }),
    ]);

    await rename({ [GROUP_CHAT_ID]: { name: ISSUE_MEMBER_NAME } });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(writtenChats(0)[GROUP_CHAT_ID]).toStrictEqual(buildChat());
  });

  test("the same name with a new topic is written", async () => {
    mockRows([
      buildAuthRow({
        availableChats: { [GROUP_CHAT_ID]: buildChat({ name: TEAMS_NAME }) },
      }),
    ]);

    await rename({ [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(writtenChats(0)[GROUP_CHAT_ID]!.topic).toBe(TEAMS_NAME);
  });

  test("a chat removed while names were being read is not brought back", async () => {
    mockRows([
      buildAuthRow({
        availableChats: {
          "19:other@thread.v2": buildChat({ id: "19:other@thread.v2" }),
        },
      }),
    ]);

    await rename({ [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a row that already has the same name and topic is not written", async () => {
    mockRows([
      buildAuthRow({ availableChats: { [GROUP_CHAT_ID]: buildNamedChat() } }),
    ]);

    await rename({ [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a row that already has the name and no topic is not written for a topic-less update", async () => {
    mockRows([
      buildAuthRow({ availableChats: { [GROUP_CHAT_ID]: buildChat() } }),
    ]);

    await rename({ [GROUP_CHAT_ID]: { name: ISSUE_MEMBER_NAME } });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("only the rows that need it are written", async () => {
    const staleRow: WorkspaceProjectAuthToken = buildAuthRow({
      availableChats: { [GROUP_CHAT_ID]: buildChat() },
    });
    mockRows([
      buildAuthRow({ availableChats: { [GROUP_CHAT_ID]: buildNamedChat() } }),
      staleRow,
      buildAuthRow({ availableChats: {} }),
    ]);

    await rename({ [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].id.toString()).toBe(
      staleRow.id!.toString(),
    );
  });

  test("several chats are renamed in a single write per row", async () => {
    mockRows([
      buildAuthRow({
        availableChats: {
          "19:one@thread.v2": buildChat({ id: "19:one@thread.v2" }),
          "19:two@thread.v2": buildNamedChat({ id: "19:two@thread.v2" }),
        },
      }),
    ]);

    await rename({
      "19:one@thread.v2": { name: "One", topic: "One" },
      "19:two@thread.v2": { name: ISSUE_MEMBER_NAME },
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const availableChats: Record<string, MicrosoftTeamsChat> = writtenChats(0);
    expect(availableChats["19:one@thread.v2"]!.name).toBe("One");
    expect(availableChats["19:one@thread.v2"]!.topic).toBe("One");
    expect(availableChats["19:two@thread.v2"]!.name).toBe(ISSUE_MEMBER_NAME);
    expect(Object.keys(availableChats["19:two@thread.v2"]!)).not.toContain(
      "topic",
    );
  });

  test("other chats and the rest of miscData are kept", async () => {
    const otherChat: MicrosoftTeamsChat = buildChat({
      id: "19:other@thread.v2",
      name: "Other chat",
    });
    mockRows([
      buildAuthRow({
        miscData: {
          botId: "bot-1",
          tenantId: TENANT_ID,
          availableChats: {
            [GROUP_CHAT_ID]: buildChat(),
            [otherChat.id]: otherChat,
          },
        } as unknown as MicrosoftTeamsMiscData,
      }),
    ]);

    await rename({ [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } });

    const miscData: JSONObject = updateSpy.mock.calls[0]![0].data.miscData;
    expect(miscData["botId"]).toBe("bot-1");
    expect(miscData["tenantId"]).toBe(TENANT_ID);
    expect(writtenChats(0)[GROUP_CHAT_ID]).toStrictEqual(buildNamedChat());
    expect(writtenChats(0)[otherChat.id]).toStrictEqual(otherChat);
  });

  test("rows without miscData or without chats are skipped", async () => {
    mockRows([
      buildAuthRow({ withoutMiscData: true }),
      buildAuthRow({ miscData: {} as MicrosoftTeamsMiscData }),
    ]);

    await rename({ [GROUP_CHAT_ID]: { name: TEAMS_NAME, topic: TEAMS_NAME } });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("the row's original miscData object is not mutated", async () => {
    const row: WorkspaceProjectAuthToken = buildAuthRow({
      availableChats: { [GROUP_CHAT_ID]: buildNamedChat() },
    });
    const snapshot: string = JSON.stringify(row.miscData);
    mockRows([row]);

    await rename({ [GROUP_CHAT_ID]: { name: ISSUE_MEMBER_NAME } });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(row.miscData)).toBe(snapshot);
  });
});
