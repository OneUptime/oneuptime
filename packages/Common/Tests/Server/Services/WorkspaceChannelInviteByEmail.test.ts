import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  WorkspaceInvitees,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import ChannelMembersNotAddedNotice, {
  ChannelMembersNotAdded,
} from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import SlackAccountByEmail from "../../../Server/Utils/Workspace/Slack/SlackAccountByEmail";
import SlackChannelMembers, {
  SlackChannelMembersError,
  SlackPersonFacts,
} from "../../../Server/Utils/Workspace/Slack/SlackChannelMembers";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * A RULE'S CHANNEL HAS ITS PEOPLE, CONNECTED OR NOT.
 *
 * A customer bringing a thousand people into OneUptime asked whether every
 * one of them has to connect their Slack account "for things to work". The
 * channels OneUptime creates for an incident invited only people whose
 * account was connected, so everybody else was missing from the incident's
 * channel and named in its note. Add people on the record's page, a page
 * from chat and an on-call user group already found somebody who had not
 * connected by the Slack account with their OneUptime email address; a
 * rule's invitations now do too (findWorkspaceUserIdsToInvite), and the
 * note names only the people found neither way.
 *
 * Driven through both invite paths - the people of a new channel, and the
 * people who join a record later (owners, paged on-call responders) - with
 * Slack's answers stubbed at SlackChannelMembers and the workspace's invite
 * call recorded.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RULE_ID: ObjectID = ObjectID.generate();

const CONNECTED: ObjectID = ObjectID.generate();
const BY_EMAIL: ObjectID = ObjectID.generate();
const NOWHERE: ObjectID = ObjectID.generate();
const GUEST: ObjectID = ObjectID.generate();
const BOT: ObjectID = ObjectID.generate();
const DEACTIVATED: ObjectID = ObjectID.generate();
const SLACK_BUSY: ObjectID = ObjectID.generate();
const NO_EMAIL: ObjectID = ObjectID.generate();

const EMAILS: Record<string, string> = {
  [CONNECTED.toString()]: "connected@example.com",
  [BY_EMAIL.toString()]: "Found@Example.com",
  [NOWHERE.toString()]: "nowhere@example.com",
  [GUEST.toString()]: "guest@example.com",
  [BOT.toString()]: "bot@example.com",
  [DEACTIVATED.toString()]: "gone@example.com",
  [SLACK_BUSY.toString()]: "busy@example.com",
};

function person(
  id: string,
  facts: Partial<SlackPersonFacts> = {},
): SlackPersonFacts {
  return {
    id: id,
    name: id,
    email: "",
    isBot: false,
    isDeactivated: false,
    isGuest: false,
    ...facts,
  };
}

// What Slack answers users.lookupByEmail with, by address.
const SLACK_PEOPLE: Record<string, SlackPersonFacts | null> = {
  "found@example.com": person("U0FOUND"),
  "guest@example.com": person("U0GUEST", { isGuest: true }),
  "bot@example.com": person("U0BOT", { isBot: true }),
  "gone@example.com": person("U0GONE", { isDeactivated: true }),
};

const RULE_CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "C0INC8",
  name: "inc-inc-8",
  workspaceType: WorkspaceType.Slack,
  notificationRuleId: RULE_ID.toString(),
};

function rule(workspaceType: WorkspaceType): WorkspaceNotificationRule {
  const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  model.id = RULE_ID;
  model.workspaceType = workspaceType;
  model.notificationRule = {
    shouldCreateNewChannel: true,
    inviteUsersToNewChannel: true,
  } as never;
  return model;
}

let invite: Mock<(data: unknown) => Promise<void>>;
let lookup: SpyInstance<typeof SlackChannelMembers.findPersonByEmail>;
let noticeSpy: SpyInstance<
  typeof ChannelMembersNotAddedNotice.noteMembersNotAdded
>;
let inviteLogSpy: SpyInstance<
  typeof WorkspaceNotificationLogService.logInviteUser
>;
let cache: Map<string, string>;

beforeEach(() => {
  cache = new Map<string, string>();

  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation(
      async (data: {
        userIds: Array<ObjectID | string>;
      }): Promise<Set<string>> => {
        return new Set<string>(
          data.userIds.map((userId: ObjectID | string): string => {
            return userId.toString();
          }),
        );
      },
    );

  jest.spyOn(WorkspaceProjectAuthTokenService, "findOneBy").mockResolvedValue({
    authToken: "xoxb-project",
    workspaceProjectId: "T0001",
  } as unknown as WorkspaceProjectAuthToken);

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getWorkspaceUserIdFromOneUptimeUserId",
    )
    .mockImplementation(
      async (data: { oneuptimeUserId: ObjectID }): Promise<string | null> => {
        return data.oneuptimeUserId.toString() === CONNECTED.toString()
          ? "U0CONNECTED"
          : null;
      },
    );

  // Everybody's address, whoever is asked for: the service picks its own.
  jest.spyOn(UserService, "findBy").mockImplementation((async (): Promise<
    Array<User>
  > => {
    return Object.keys(EMAILS).map((id: string): User => {
      const model: User = new User();
      model.id = new ObjectID(id);
      model.email = new Email(EMAILS[id]!);
      return model;
    });
  }) as never);

  lookup = jest
    .spyOn(SlackChannelMembers, "findPersonByEmail")
    .mockImplementation(
      async (data: { email: string }): Promise<SlackPersonFacts | null> => {
        if (data.email === "busy@example.com") {
          throw new SlackChannelMembersError("ratelimited");
        }

        return SLACK_PEOPLE[data.email] || null;
      },
    );

  // The cache, in memory: what SlackAccountByEmail remembers.
  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        return cache.get(`${namespace}-${key}`) || null;
      },
    );

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string): Promise<void> => {
        cache.set(`${namespace}-${key}`, value);
      },
    );

  invite = jest.fn(async (): Promise<void> => {
    return undefined;
  });

  jest.spyOn(WorkspaceUtil, "getWorkspaceTypeUtil").mockReturnValue({
    inviteUsersToChannels: invite,
    sendMessage: jest.fn(),
  } as never);

  noticeSpy = jest
    .spyOn(ChannelMembersNotAddedNotice, "noteMembersNotAdded")
    .mockResolvedValue(undefined);

  inviteLogSpy = jest
    .spyOn(WorkspaceNotificationLogService, "logInviteUser")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function invitedSlackIds(): Array<string> {
  return (
    invite.mock.calls[0]![0] as {
      workspaceChannelInvitationPayload: { workspaceUserIds: Array<string> };
    }
  ).workspaceChannelInvitationPayload.workspaceUserIds;
}

function loggedUserIds(): Array<string> {
  return inviteLogSpy.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { userId: ObjectID }).userId.toString();
  });
}

describe("the people who join a record later: owners, paged on-call responders", () => {
  async function inviteAll(userIds: Array<ObjectID>): Promise<void> {
    await WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        projectId: PROJECT_ID,
        notificationRules: [rule(WorkspaceType.Slack)],
        workspaceChannels: [RULE_CHANNEL],
        userIds: userIds,
      },
    );
  }

  test("somebody who never connected Slack is invited by the account with their email address, in the same call as the connected", async () => {
    await inviteAll([CONNECTED, BY_EMAIL]);

    expect(invite).toHaveBeenCalledTimes(1);
    expect(invitedSlackIds()).toEqual(["U0CONNECTED", "U0FOUND"]);

    // Looked up by the address in OneUptime, lower-cased; the connected not at all.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0]![0]).toEqual({
      authToken: "xoxb-project",
      email: "found@example.com",
    });

    // Both are logged as invited, and nobody is named in the channel's note.
    expect(loggedUserIds()).toEqual([
      CONNECTED.toString(),
      BY_EMAIL.toString(),
    ]);
    expect(noticeSpy.mock.calls[0]![0].userIds).toEqual([]);
  });

  test("whoever no Slack account has the address of is named in the channel's note, and not invited", async () => {
    await inviteAll([CONNECTED, NOWHERE]);

    expect(invitedSlackIds()).toEqual(["U0CONNECTED"]);
    expect(noticeSpy.mock.calls[0]![0].userIds).toEqual([NOWHERE]);
    expect(loggedUserIds()).toEqual([CONNECTED.toString()]);
  });

  test("a guest, a bot or a deactivated account with the address is nobody to invite: named in the note", async () => {
    await inviteAll([CONNECTED, GUEST, BOT, DEACTIVATED]);

    /*
     * Slack refuses a guest in a channel the app invites to, and its refusal
     * would stop everybody else's invitation with it.
     */
    expect(invitedSlackIds()).toEqual(["U0CONNECTED"]);
    expect(noticeSpy.mock.calls[0]![0].userIds).toEqual([
      GUEST,
      BOT,
      DEACTIVATED,
    ]);
  });

  test("a lookup Slack refuses names that person in the note and invites everybody else", async () => {
    await inviteAll([SLACK_BUSY, BY_EMAIL, CONNECTED]);

    expect(invitedSlackIds()).toEqual(["U0CONNECTED", "U0FOUND"]);
    expect(noticeSpy.mock.calls[0]![0].userIds).toEqual([SLACK_BUSY]);
  });

  test("somebody without an email address is not looked up", async () => {
    await inviteAll([NO_EMAIL]);

    expect(lookup).not.toHaveBeenCalled();
    expect(noticeSpy.mock.calls[0]![0].userIds).toEqual([NO_EMAIL]);
  });

  test("email addresses that cannot be read find nobody by email, and the connected are still invited", async () => {
    (UserService.findBy as unknown as SpyInstance<() => Promise<never>>)
      .mockReset()
      .mockRejectedValue(new Error("Database is not connected"));

    await inviteAll([CONNECTED, BY_EMAIL]);

    expect(invitedSlackIds()).toEqual(["U0CONNECTED"]);
    expect(lookup).not.toHaveBeenCalled();
    expect(noticeSpy.mock.calls[0]![0].userIds).toEqual([BY_EMAIL]);
  });

  test("Slack is asked about a person once an hour: the answer is remembered, a guest's as a guest's", async () => {
    await inviteAll([BY_EMAIL, GUEST, NOWHERE]);
    await inviteAll([BY_EMAIL, GUEST, NOWHERE]);

    // Three people, each asked about once.
    expect(lookup).toHaveBeenCalledTimes(3);

    // The second time, as the first: the found invited, the guest named.
    expect(
      (
        invite.mock.calls[1]![0] as {
          workspaceChannelInvitationPayload: {
            workspaceUserIds: Array<string>;
          };
        }
      ).workspaceChannelInvitationPayload.workspaceUserIds,
    ).toEqual(["U0FOUND"]);
    expect(noticeSpy.mock.calls[1]![0].userIds).toEqual([GUEST, NOWHERE]);
  });
});

describe("the people of a channel a rule has just created", () => {
  test("they are invited by their email address too, and only the ones found neither way are handed back for the note", async () => {
    jest
      .spyOn(WorkspaceNotificationRuleService, "getUsersIdsToInviteToChannel")
      .mockResolvedValue([
        {
          notificationRuleId: RULE_ID.toString(),
          userIds: [CONNECTED, BY_EMAIL, NOWHERE],
        },
      ]);

    const membersNotAdded: Array<ChannelMembersNotAdded> =
      await WorkspaceNotificationRuleService.inviteUsersAndTeamsToChannelsBasedOnRules(
        {
          projectId: PROJECT_ID,
          projectAuth: {
            authToken: "xoxb-project",
          } as WorkspaceProjectAuthToken,
          workspaceType: WorkspaceType.Slack,
          notificationRules: [rule(WorkspaceType.Slack)],
          notificationChannels: [RULE_CHANNEL],
        },
      );

    expect(invite).toHaveBeenCalledTimes(1);
    expect(invitedSlackIds()).toEqual(["U0CONNECTED", "U0FOUND"]);
    expect(loggedUserIds()).toEqual([
      CONNECTED.toString(),
      BY_EMAIL.toString(),
    ]);

    expect(membersNotAdded).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        channels: [{ id: "C0INC8", name: "inc-inc-8" }],
        userIds: [NOWHERE],
      },
    ]);
  });
});

describe("findWorkspaceUserIdsToInvite", () => {
  test("Microsoft Teams adds nobody to a channel, so nobody is looked up by email there", async () => {
    const found: WorkspaceInvitees =
      await WorkspaceNotificationRuleService.findWorkspaceUserIdsToInvite({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.MicrosoftTeams,
        authToken: "teams-token",
        userIds: [CONNECTED, BY_EMAIL],
      });

    expect(lookup).not.toHaveBeenCalled();
    expect(found.notFoundUserIds).toEqual([BY_EMAIL]);
  });

  test("an account somebody else connected is not invited a second time for a person whose address it has", async () => {
    (SLACK_PEOPLE as Record<string, SlackPersonFacts | null>)[
      "found@example.com"
    ] = person("U0CONNECTED");

    try {
      const found: WorkspaceInvitees =
        await WorkspaceNotificationRuleService.findWorkspaceUserIdsToInvite({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          authToken: "xoxb-project",
          userIds: [CONNECTED, BY_EMAIL],
        });

      expect(
        found.invitees.map((invitee: { workspaceUserId: string }) => {
          return invitee.workspaceUserId;
        }),
      ).toEqual(["U0CONNECTED"]);
      expect(found.notFoundUserIds).toEqual([BY_EMAIL]);
    } finally {
      SLACK_PEOPLE["found@example.com"] = person("U0FOUND");
    }
  });

  test("without the project's token, nobody is looked up by email", async () => {
    const found: WorkspaceInvitees =
      await WorkspaceNotificationRuleService.findWorkspaceUserIdsToInvite({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        authToken: "",
        userIds: [BY_EMAIL],
      });

    expect(lookup).not.toHaveBeenCalled();
    expect(found).toEqual({ invitees: [], notFoundUserIds: [BY_EMAIL] });
  });
});

describe("SlackAccountByEmail's cache", () => {
  test("a guest's account is remembered as a guest's, and read back so", () => {
    expect(
      SlackAccountByEmail.fromCacheValue(
        SlackAccountByEmail.toCacheValue({
          slackUserId: "U0GUEST",
          isGuest: true,
        }),
      ),
    ).toEqual({ slackUserId: "U0GUEST", isGuest: true });

    expect(
      SlackAccountByEmail.fromCacheValue(
        SlackAccountByEmail.toCacheValue({
          slackUserId: "U0MEMBER",
          isGuest: false,
        }),
      ),
    ).toEqual({ slackUserId: "U0MEMBER", isGuest: false });
  });

  test("without the cache, Slack is asked every time and its answer stands", async () => {
    (GlobalCache.getString as unknown as SpyInstance<() => Promise<never>>)
      .mockReset()
      .mockRejectedValue(new Error("Cache is not connected"));

    for (let i: number = 0; i < 2; i++) {
      expect(
        await SlackAccountByEmail.find({
          projectId: PROJECT_ID,
          authToken: "xoxb-project",
          userId: BY_EMAIL,
          email: "found@example.com",
          useCache: true,
        }),
      ).toEqual({ slackUserId: "U0FOUND", isGuest: false });
    }

    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
