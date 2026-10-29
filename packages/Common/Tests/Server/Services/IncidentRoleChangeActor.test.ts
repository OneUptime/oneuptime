/*
 * The monitor's incident path pulls the native isolated-vm addon through
 * its template renderer; nothing here runs it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeRoleMember from "../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeRoleMemberService from "../../../Server/Services/IncidentEpisodeRoleMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMemberService from "../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../Server/Services/IncidentRoleService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import IncidentRoleFeedText from "../../../Server/Utils/Incident/IncidentRoleFeedText";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceIncidentActions from "../../../Server/Utils/Workspace/WorkspaceIncidentActions";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO AN INCIDENT ROLE CHANGE IS BY, IN THE FEED AND IN SLACK AND TEAMS.
 *
 * The maintainer added Deane Looi as Responder on INC-18 in the Dashboard,
 * took him off, and added him as Observer; the incident's Slack channel
 * read, three times, "Deane Looi Added Deane Looi as Responder to Incident
 * INC-18" - naming Deane as the one who did it, with a link to a page that
 * no longer exists (…/settings/users/<id>).
 *
 * The feed entry already named the right person: the message in Slack and
 * Teams opened with the person it was about. This suite runs every way a
 * role changes - the Dashboard and the API as a person, a project API key,
 * Slack and Teams' Assign Role, a workflow's step, a role given on an
 * incident episode, and OneUptime itself (the first person to change the
 * state becomes Incident Commander, a monitor's criteria) - through the
 * real IncidentMemberService hooks, the real incident feed and the real
 * Slack and Teams message building, and reads what the feed stores and
 * what a person in the channel sees: who it opens with, the sentence, and
 * where each person's link goes.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000002",
);
const RESPONDER_ROLE_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000003",
);
const COMMANDER_ROLE_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000004",
);
const VALERIA_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000005",
);
const DEANE_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000006");
const API_KEY_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000007",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000008",
);
const MEMBER_ROW_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000009",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-00000000000a",
);
const ANA_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-00000000000b");

const PEOPLE: Record<string, { name: string; email: string }> = {
  [VALERIA_ID.toString()]: {
    name: "Valeria Mustafaeva",
    email: "valeria@example.com",
  },
  [DEANE_ID.toString()]: {
    name: "Deane Looi",
    email: "deane.looi.from.avepoint@gt.tech.gov.sg",
  },
  [ANA_ID.toString()]: { name: "Ana Ruiz", email: "ana@example.com" },
};

const ROLES: Record<string, string> = {
  [RESPONDER_ROLE_ID.toString()]: "Responder",
  [COMMANDER_ROLE_ID.toString()]: "Incident Commander",
};

const personPage: (userId: ObjectID) => string = (userId: ObjectID): string => {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/users/${userId.toString()}`;
};

const INCIDENT_PAGE: string = `${DASHBOARD}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

const VALERIA_LINK: string = `[Valeria Mustafaeva](${personPage(VALERIA_ID)})`;
const DEANE_LINK: string = `[Deane Looi](${personPage(DEANE_ID)})`;
const INCIDENT_LINK: string = `[Incident INC-18](${INCIDENT_PAGE})`;

const SLACK_CHANNEL: WorkspaceChannel = {
  id: "C0INC18",
  name: "incident-18",
  workspaceType: WorkspaceType.Slack,
};
const TEAMS_CHANNEL: WorkspaceChannel = {
  id: "19:incident-18@thread.tacv2",
  name: "incident-18",
  workspaceType: WorkspaceType.MicrosoftTeams,
};

// A request of a member of the project, as the Dashboard and the API make it.
const memberProps: (userId: ObjectID) => DatabaseCommonInteractionProps = (
  userId: ObjectID,
): DatabaseCommonInteractionProps => {
  return {
    tenantId: PROJECT_ID,
    userId: userId,
    userType: UserType.User,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.User],
      _type: "UserGlobalAccessPermission",
    },
  };
};

// A project API key's request: no person.
const API_KEY_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  apiKeyId: API_KEY_ID,
  apiKeyName: "Jira Automation",
};

let feedRows: Array<IncidentFeed> = [];
let posted: Array<WorkspaceMessagePayload> = [];
let logRows: Array<WorkspaceNotificationLog> = [];
let linkedAccounts: Array<{
  userId: ObjectID;
  workspaceType: WorkspaceType;
  token: WorkspaceUserAuthToken;
}> = [];

const userRow: (id: unknown) => User | null = (id: unknown): User | null => {
  const person: { name: string; email: string } | undefined =
    PEOPLE[String(id)];

  if (!person) {
    return null;
  }

  const user: User = new User();
  user._id = String(id);
  user.name = new Name(person.name);
  user.email = new Email(person.email);
  return user;
};

beforeEach(() => {
  feedRows = [];
  posted = [];
  logRows = [];
  linkedAccounts = [];

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));

  // The people, by id: for their names, emails and links.
  jest.spyOn(UserService, "findOneBy").mockImplementation((async (findBy: {
    query: { _id?: unknown };
  }) => {
    return userRow(findBy.query._id);
  }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async (findBy: {
    id: unknown;
  }) => {
    return userRow(findBy.id);
  }) as never);

  jest
    .spyOn(IncidentRoleService, "findOneById")
    .mockImplementation((async (findBy: { id: unknown }) => {
      const role: IncidentRole = new IncidentRole();
      role.name = ROLES[String(findBy.id)] || "Member";
      return role;
    }) as never);

  jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
    number: 18,
    numberWithPrefix: "INC-18",
  });
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString(INCIDENT_PAGE));

  // The feed's own row: what the Dashboard's feed shows.
  jest.spyOn(IncidentFeedService, "create").mockImplementation((async (
    createBy: CreateBy<IncidentFeed>,
  ) => {
    feedRows.push(createBy.data);
    return createBy.data;
  }) as never);

  // The incident's Slack and Teams channels.
  jest
    .spyOn(WorkspaceNotificationRuleService, "hasConnectedWorkspace")
    .mockResolvedValue(true);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "createChannelsForRulesThatNowMatch",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WorkspaceNotificationRuleService, "getMessageDestinations")
    .mockImplementation((async (data: { workspaceType: WorkspaceType }) => {
      const channel: WorkspaceChannel | undefined = [
        SLACK_CHANNEL,
        TEAMS_CHANNEL,
      ].find((candidate: WorkspaceChannel): boolean => {
        return candidate.workspaceType === data.workspaceType;
      });

      if (!channel) {
        return [];
      }

      return [
        {
          _type: "WorkspaceMessagePayload",
          workspaceType: data.workspaceType,
          messageBlocks: [],
          channelNames: [],
          channelIds: [channel.id],
        },
      ];
    }) as never);
  jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    }) => {
      posted.push(...data.messagePayloadsByWorkspace);

      return data.messagePayloadsByWorkspace.map(
        (payload: WorkspaceMessagePayload): WorkspaceSendMessageResponse => {
          return {
            workspaceType: payload.workspaceType,
            threads: [
              {
                channel:
                  payload.workspaceType === WorkspaceType.Slack
                    ? SLACK_CHANNEL
                    : TEAMS_CHANNEL,
                threadId: "thread-1",
              },
            ],
          };
        },
      );
    }) as never);
  jest
    .spyOn(WorkspaceNotificationLogService, "create")
    .mockImplementation((async (createBy: {
      data: WorkspaceNotificationLog;
    }) => {
      logRows.push(createBy.data);
      return createBy.data;
    }) as never);

  // Nobody linked a chat account unless a test says so.
  jest
    .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
    .mockImplementation((async (data: {
      userId: ObjectID;
      workspaceType: WorkspaceType;
    }) => {
      return (
        linkedAccounts.find(
          (account: {
            userId: ObjectID;
            workspaceType: WorkspaceType;
          }): boolean => {
            return (
              account.userId.toString() === data.userId.toString() &&
              account.workspaceType === data.workspaceType
            );
          },
        )?.token || null
      );
    }) as never);

  // The role's channel invites: no rule here.
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getNotificationRulesWhereInviteRolesIsTrue",
    )
    .mockResolvedValue([]);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentService, "getWorkspaceChannelForIncident")
    .mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ------------------------------------------------------------ the writes

const memberRow: (data: {
  userId: ObjectID;
  roleId?: ObjectID | undefined;
  createdByUserId?: ObjectID | undefined;
}) => IncidentMember = (data: {
  userId: ObjectID;
  roleId?: ObjectID | undefined;
  createdByUserId?: ObjectID | undefined;
}): IncidentMember => {
  const member: IncidentMember = new IncidentMember();
  member._id = MEMBER_ROW_ID.toString();
  member.projectId = PROJECT_ID;
  member.incidentId = INCIDENT_ID;
  member.userId = data.userId;
  member.incidentRoleId = data.roleId || RESPONDER_ROLE_ID;

  if (data.createdByUserId) {
    member.createdByUserId = data.createdByUserId;
  }

  return member;
};

/*
 * A create, as DatabaseService makes it: the creator stamped from the
 * person on the props (sanitizeCreateOrUpdate), then the success hook.
 */
const createAsTheDatabaseDoes: (
  createBy: CreateBy<IncidentMember>,
) => Promise<IncidentMember> = async (
  createBy: CreateBy<IncidentMember>,
): Promise<IncidentMember> => {
  const created: IncidentMember = createBy.data;

  if (createBy.props.userId) {
    created.createdByUserId = createBy.props.userId;
  }

  await IncidentMemberService.onCreateSuccess(
    { createBy: createBy, carryForward: null } as OnCreate<IncidentMember>,
    created,
  );

  return created;
};

const add: (data: {
  userId: ObjectID;
  roleId?: ObjectID | undefined;
  props: DatabaseCommonInteractionProps;
  miscDataProps?: JSONObject;
}) => Promise<void> = async (data: {
  userId: ObjectID;
  roleId?: ObjectID | undefined;
  props: DatabaseCommonInteractionProps;
  miscDataProps?: JSONObject;
}): Promise<void> => {
  await createAsTheDatabaseDoes({
    data: memberRow({ userId: data.userId, roleId: data.roleId }),
    props: data.props,
    ...(data.miscDataProps ? { miscDataProps: data.miscDataProps } : {}),
  });
};

// A delete's success hook, with the rows the delete removed.
const remove: (data: {
  userId: ObjectID;
  roleId?: ObjectID | undefined;
  props: DatabaseCommonInteractionProps;
  deletedByUser?: User | undefined;
}) => Promise<void> = async (data: {
  userId: ObjectID;
  roleId?: ObjectID | undefined;
  props: DatabaseCommonInteractionProps;
  deletedByUser?: User | undefined;
}): Promise<void> => {
  const deleteBy: DeleteBy<IncidentMember> = {
    query: { _id: MEMBER_ROW_ID.toString() },
    limit: 1,
    skip: 0,
    props: data.props,
    ...(data.deletedByUser ? { deletedByUser: data.deletedByUser } : {}),
  };

  await (
    IncidentMemberService as unknown as {
      onDeleteSuccess: (
        onDelete: OnDelete<IncidentMember>,
        ids: Array<ObjectID>,
      ) => Promise<OnDelete<IncidentMember>>;
    }
  ).onDeleteSuccess(
    {
      deleteBy: deleteBy,
      carryForward: {
        itemsToDelete: [
          memberRow({ userId: data.userId, roleId: data.roleId }),
        ],
      },
    } as OnDelete<IncidentMember>,
    [MEMBER_ROW_ID],
  );
};

// ------------------------------------------------- what people then read

const onlyFeedRow: () => IncidentFeed = (): IncidentFeed => {
  expect(feedRows).toHaveLength(1);
  return feedRows[0]!;
};

const postedTo: (workspaceType: WorkspaceType) => WorkspaceMessagePayload = (
  workspaceType: WorkspaceType,
): WorkspaceMessagePayload => {
  const payloads: Array<WorkspaceMessagePayload> = posted.filter(
    (payload: WorkspaceMessagePayload): boolean => {
      return payload.workspaceType === workspaceType;
    },
  );

  expect(payloads).toHaveLength(1);
  return payloads[0]!;
};

// Slack's `<address|words>` link, and `*bold*`.
const SLACK_LINK: RegExp = /<([^|<>]+)\|([^<>]*)>/g;
/*
 * The zero-width space Slack's converter sets beside bold, so Slack starts
 * it inside a word: a channel shows nothing for it.
 */
const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);
const SLACK_BOLD: RegExp = /\*([^*\n]+)\*/g;
// Markdown's `[words](address)`, the escapes in the words, and `**bold**`.
const MARKDOWN_LINK: RegExp = /\[((?:\\.|[^\\\]\n])*)\]\(([^()\s]*)\)/g;
const MARKDOWN_ESCAPE: RegExp = /\\(.)/g;
const MARKDOWN_BOLD: RegExp = /\*\*([^*\n]+)\*\*/g;

interface ChannelMessage {
  // What a person in the channel reads: the words, links as their words.
  reads: string;
  links: Array<{ text: string; href: string }>;
}

/*
 * What a Slack channel shows: the section blocks Slack is sent
 * (SlackUtil.getMarkdownBlocks), as Slack draws mrkdwn - a link as its
 * words, bold as plain words.
 */
const slackShows: () => ChannelMessage = (): ChannelMessage => {
  const sections: Array<JSONObject> = SlackUtil.getMarkdownBlocks({
    payloadMarkdownBlock: postedTo(WorkspaceType.Slack)
      .messageBlocks[0] as WorkspacePayloadMarkdown,
  });

  expect(sections).toHaveLength(1);

  const mrkdwn: string = (sections[0]!["text"] as JSONObject)["text"] as string;

  return {
    reads: mrkdwn
      .split(ZERO_WIDTH_SPACE)
      .join("")
      .replace(SLACK_LINK, (_whole: string, _href: string, text: string) => {
        return text;
      })
      .replace(SLACK_BOLD, "$1")
      .trim(),
    links: Array.from(mrkdwn.matchAll(SLACK_LINK)).map(
      (match: RegExpMatchArray): { text: string; href: string } => {
        return { href: match[1]!, text: match[2]! };
      },
    ),
  };
};

/*
 * What a Teams channel shows: the Adaptive Card Teams is sent
 * (MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks), its text as
 * Teams draws a TextBlock's Markdown.
 */
const teamsShows: () => ChannelMessage = (): ChannelMessage => {
  const card: JSONObject =
    MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
      messageBlocks: postedTo(WorkspaceType.MicrosoftTeams).messageBlocks,
    });
  const texts: Array<string> = (card["body"] as Array<JSONObject>)
    .filter((element: JSONObject): boolean => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject): string => {
      return element["text"] as string;
    });

  expect(texts).toHaveLength(1);

  const text: string = texts[0]!;

  return {
    reads: text
      .replace(MARKDOWN_LINK, (_whole: string, words: string) => {
        return words.replace(MARKDOWN_ESCAPE, "$1");
      })
      .replace(MARKDOWN_BOLD, "$1"),
    links: Array.from(text.matchAll(MARKDOWN_LINK)).map(
      (match: RegExpMatchArray): { text: string; href: string } => {
        return {
          text: match[1]!.replace(MARKDOWN_ESCAPE, "$1"),
          href: match[2]!,
        };
      },
    ),
  };
};

const timesIn: (text: string, part: string) => number = (
  text: string,
  part: string,
): number => {
  return text.split(part).length - 1;
};

// ---------------------------------------------------------------- suites

describe("REGRESSION: someone adds Deane as Responder in the Dashboard", () => {
  beforeEach(async () => {
    await add({ userId: DEANE_ID, props: memberProps(VALERIA_ID) });
  });

  test("the feed's entry is by them, about Deane", () => {
    const row: IncidentFeed = onlyFeedRow();

    expect(row.userId?.toString()).toBe(VALERIA_ID.toString());
    expect(row.incidentFeedEventType).toBe(
      IncidentFeedEventType.IncidentMemberAdded,
    );
    expect(row.feedInfoInMarkdown).toBe(
      `👤 Added **${DEANE_LINK}** as **Responder** to ${INCIDENT_LINK}.`,
    );
  });

  test("Slack reads '👤 Valeria Mustafaeva added Deane Looi as Responder to Incident INC-18.'", () => {
    const slack: ChannelMessage = slackShows();

    expect(slack.reads).toBe(
      "👤 Valeria Mustafaeva added Deane Looi as Responder to Incident INC-18.",
    );
    // Deane is named once: as the one added, never as the one who added.
    expect(timesIn(slack.reads, "Deane Looi")).toBe(1);
    expect(slack.reads.startsWith("Deane")).toBe(false);
  });

  test("Teams reads the same, opening with them", () => {
    const teams: ChannelMessage = teamsShows();

    expect(teams.reads).toBe(
      "👤 Valeria Mustafaeva added Deane Looi as Responder to Incident INC-18.",
    );
    expect(timesIn(teams.reads, "Deane Looi")).toBe(1);
  });

  test("every person's link opens that person's page in the project, in both", () => {
    for (const message of [slackShows(), teamsShows()]) {
      expect(message.links).toEqual([
        { text: "Valeria Mustafaeva", href: personPage(VALERIA_ID) },
        { text: "Deane Looi", href: personPage(DEANE_ID) },
        { text: "Incident INC-18", href: INCIDENT_PAGE },
      ]);

      for (const link of message.links) {
        expect(new globalThis.URL(link.href).pathname).not.toContain(
          "/settings/",
        );
      }
    }
  });

  test("the notification logs say they sent it, in Slack and in Teams", () => {
    expect(logRows).toHaveLength(2);

    for (const row of logRows) {
      expect(row.userId?.toString()).toBe(VALERIA_ID.toString());
      expect(row.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    }
  });
});

describe("REGRESSION: someone takes Deane off Responder in the Dashboard", () => {
  beforeEach(async () => {
    await remove({ userId: DEANE_ID, props: memberProps(VALERIA_ID) });
  });

  test("the feed's entry is by them", () => {
    const row: IncidentFeed = onlyFeedRow();

    expect(row.userId?.toString()).toBe(VALERIA_ID.toString());
    expect(row.incidentFeedEventType).toBe(
      IncidentFeedEventType.IncidentMemberRemoved,
    );
    expect(row.feedInfoInMarkdown).toBe(
      `👤 Removed **${DEANE_LINK}** as **Responder** from ${INCIDENT_LINK}.`,
    );
  });

  test("Slack and Teams open with them - where the line once opened with Deane", () => {
    for (const message of [slackShows(), teamsShows()]) {
      expect(message.reads).toBe(
        "👤 Valeria Mustafaeva removed Deane Looi as Responder from Incident INC-18.",
      );
      expect(message.links[0]).toEqual({
        text: "Valeria Mustafaeva",
        href: personPage(VALERIA_ID),
      });
    }
  });

  test("Deane is linked to his page, as the line that gave him the role links him - not named with his email beside", () => {
    for (const message of [slackShows(), teamsShows()]) {
      expect(message.links).toEqual([
        { text: "Valeria Mustafaeva", href: personPage(VALERIA_ID) },
        { text: "Deane Looi", href: personPage(DEANE_ID) },
        { text: "Incident INC-18", href: INCIDENT_PAGE },
      ]);
      expect(message.reads).not.toContain("@gt.tech.gov.sg");
    }
  });

  test("a person who never gave a name is named, and linked, by their email", async () => {
    feedRows = [];
    posted = [];
    PEOPLE[ANA_ID.toString()] = { name: "", email: "ana@example.com" };

    try {
      await remove({ userId: ANA_ID, props: memberProps(VALERIA_ID) });
    } finally {
      PEOPLE[ANA_ID.toString()] = {
        name: "Ana Ruiz",
        email: "ana@example.com",
      };
    }

    expect(onlyFeedRow().feedInfoInMarkdown).toBe(
      `👤 Removed **[ana@example.com](${personPage(ANA_ID)})** as **Responder** from ${INCIDENT_LINK}.`,
    );
    expect(slackShows().reads).toBe(
      "👤 Valeria Mustafaeva removed ana@example.com as Responder from Incident INC-18.",
    );
  });

  test("nobody is named for a person who is gone: no line at all", async () => {
    feedRows = [];
    posted = [];

    await remove({
      userId: new ObjectID("7d000000-0000-4000-8000-0000000000ee"),
      props: memberProps(VALERIA_ID),
    });

    expect(feedRows).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  test("the person a delete names wins over a request with nobody on it", async () => {
    feedRows = [];
    posted = [];

    await remove({
      userId: DEANE_ID,
      props: { isRoot: true },
      deletedByUser: userRow(VALERIA_ID)!,
    });

    expect(onlyFeedRow().userId?.toString()).toBe(VALERIA_ID.toString());
    expect(slackShows().reads.startsWith("👤 Valeria Mustafaeva ")).toBe(true);
  });
});

describe("an Observer added after: the third line of the screenshot", () => {
  test("is by them too", async () => {
    await add({
      userId: DEANE_ID,
      roleId: new ObjectID("7d000000-0000-4000-8000-0000000000ff"),
      props: memberProps(VALERIA_ID),
    });

    expect(onlyFeedRow().userId?.toString()).toBe(VALERIA_ID.toString());
    expect(slackShows().reads).toBe(
      "👤 Valeria Mustafaeva added Deane Looi as Member to Incident INC-18.",
    );
  });
});

describe("a person who connected their chat account", () => {
  test("Teams opens with their Teams name, Slack with their Slack name", async () => {
    const teamsAccount: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    teamsAccount.workspaceUserId = "aad-valeria";
    teamsAccount.miscData = { displayName: "Valeria M." } as never;

    const slackAccount: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    slackAccount.workspaceUserId = "U0VALERIA";

    linkedAccounts = [
      {
        userId: VALERIA_ID,
        workspaceType: WorkspaceType.MicrosoftTeams,
        token: teamsAccount,
      },
      {
        userId: VALERIA_ID,
        workspaceType: WorkspaceType.Slack,
        token: slackAccount,
      },
    ];

    jest
      .spyOn(
        WorkspaceUtil as unknown as {
          getWorkspaceUsernameForUserToken: () => Promise<string | null>;
        },
        "getWorkspaceUsernameForUserToken",
      )
      .mockImplementation((async (data: { workspaceType: WorkspaceType }) => {
        return data.workspaceType === WorkspaceType.MicrosoftTeams
          ? "Valeria M."
          : "valeria";
      }) as never);

    await add({ userId: DEANE_ID, props: memberProps(VALERIA_ID) });

    expect(slackShows().reads).toBe(
      "👤 @valeria added Deane Looi as Responder to Incident INC-18.",
    );
    expect(teamsShows().reads).toBe(
      "👤 @Valeria M. added Deane Looi as Responder to Incident INC-18.",
    );
  });

  test("Deane's own connected account never leads a line about Deane", async () => {
    const deaneSlack: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    deaneSlack.workspaceUserId = "U0DEANE";

    linkedAccounts = [
      {
        userId: DEANE_ID,
        workspaceType: WorkspaceType.Slack,
        token: deaneSlack,
      },
    ];

    jest
      .spyOn(
        WorkspaceUtil as unknown as {
          getWorkspaceUsernameForUserToken: () => Promise<string | null>;
        },
        "getWorkspaceUsernameForUserToken",
      )
      .mockResolvedValue("deane" as never);

    await add({ userId: DEANE_ID, props: memberProps(VALERIA_ID) });

    expect(slackShows().reads).not.toContain("@deane");
    expect(slackShows().reads.startsWith("👤 Valeria Mustafaeva ")).toBe(true);
  });
});

describe("a person who gives themselves a role, or leaves one", () => {
  test("Deane takes Responder: '👤 Deane Looi took the Responder role ...', named once", async () => {
    await add({ userId: DEANE_ID, props: memberProps(DEANE_ID) });

    const row: IncidentFeed = onlyFeedRow();
    expect(row.userId?.toString()).toBe(DEANE_ID.toString());
    expect(row.feedInfoInMarkdown).toBe(
      `👤 Took the **Responder** role on ${INCIDENT_LINK}.`,
    );

    for (const message of [slackShows(), teamsShows()]) {
      expect(message.reads).toBe(
        "👤 Deane Looi took the Responder role on Incident INC-18.",
      );
      expect(timesIn(message.reads, "Deane Looi")).toBe(1);
    }
  });

  test("Deane leaves it: '👤 Deane Looi left the Responder role ...'", async () => {
    await remove({ userId: DEANE_ID, props: memberProps(DEANE_ID) });

    expect(onlyFeedRow().feedInfoInMarkdown).toBe(
      `👤 Left the **Responder** role on ${INCIDENT_LINK}.`,
    );
    expect(slackShows().reads).toBe(
      "👤 Deane Looi left the Responder role on Incident INC-18.",
    );
  });
});

describe("a project API key", () => {
  test("adding: the feed names the key, and the message opens with it", async () => {
    await add({ userId: DEANE_ID, props: API_KEY_PROPS });

    const row: IncidentFeed = onlyFeedRow();
    expect(row.userId).toBeUndefined();
    expect(row.apiKeyId?.toString()).toBe(API_KEY_ID.toString());
    expect(row.apiKeyName).toBe("Jira Automation");

    for (const message of [slackShows(), teamsShows()]) {
      expect(message.reads).toBe(
        "👤 Jira Automation (API key) added Deane Looi as Responder to Incident INC-18.",
      );
    }
  });

  test("removing: the same", async () => {
    await remove({ userId: DEANE_ID, props: API_KEY_PROPS });

    expect(onlyFeedRow().apiKeyName).toBe("Jira Automation");
    expect(slackShows().reads).toBe(
      "👤 Jira Automation (API key) removed Deane Looi as Responder from Incident INC-18.",
    );
  });

  test("the log names nobody: no person sent it", async () => {
    await add({ userId: DEANE_ID, props: API_KEY_PROPS });

    expect(logRows.length).toBeGreaterThan(0);
    for (const row of logRows) {
      expect(row.userId).toBeUndefined();
    }
  });
});

describe("a workflow's step", () => {
  const workflowProps: DatabaseCommonInteractionProps =
    WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: WORKFLOW_ID,
      workflowName: "Page SRE on SEV1",
    });

  test("adding: the sentence names the workflow, and no person leads", async () => {
    await add({ userId: DEANE_ID, props: workflowProps });

    const row: IncidentFeed = onlyFeedRow();
    expect(row.userId).toBeUndefined();
    expect(row.apiKeyId).toBeUndefined();
    expect(row.feedInfoInMarkdown).toBe(
      `👤 Workflow **Page SRE on SEV1** added **${DEANE_LINK}** as **Responder** to ${INCIDENT_LINK}.`,
    );

    for (const message of [slackShows(), teamsShows()]) {
      expect(message.reads).toBe(
        "👤 Workflow Page SRE on SEV1 added Deane Looi as Responder to Incident INC-18.",
      );
    }
  });

  test("removing: the same", async () => {
    await remove({ userId: DEANE_ID, props: workflowProps });

    expect(slackShows().reads).toBe(
      "👤 Workflow Page SRE on SEV1 removed Deane Looi as Responder from Incident INC-18.",
    );
  });
});

describe("Slack and Teams' Assign Role", () => {
  test("the member who picked it is the one the line is by - and whoever it moved from is taken off by them too", async () => {
    // Incident Commander takes one person: Ana holds it.
    const commander: IncidentRole = new IncidentRole();
    commander._id = COMMANDER_ROLE_ID.toString();
    commander.name = "Incident Commander";
    commander.canAssignMultipleUsers = false;

    jest
      .spyOn(IncidentRoleService, "findOneBy")
      .mockResolvedValue(commander as never);
    jest
      .spyOn(
        WorkspaceIncidentActions as unknown as {
          readHolders: () => Promise<unknown>;
        },
        "readHolders",
      )
      .mockResolvedValue([
        {
          memberId: MEMBER_ROW_ID,
          userId: ANA_ID,
          roleId: COMMANDER_ROLE_ID,
          name: "Ana Ruiz",
        },
      ] as never);
    jest
      .spyOn(
        WorkspaceIncidentActions as unknown as {
          getPersonName: () => Promise<string>;
        },
        "getPersonName",
      )
      .mockResolvedValue("Deane Looi" as never);

    // The member's writes, as the database makes them, hooks included.
    jest
      .spyOn(IncidentMemberService, "create")
      .mockImplementation(createAsTheDatabaseDoes as never);
    jest
      .spyOn(IncidentMemberService, "deleteOneById")
      .mockImplementation((async (deleteBy: {
        props: DatabaseCommonInteractionProps;
      }) => {
        await remove({
          userId: ANA_ID,
          roleId: COMMANDER_ROLE_ID,
          props: deleteBy.props,
        });
        return 1;
      }) as never);

    const member: DatabaseCommonInteractionProps = {
      ...memberProps(VALERIA_ID),
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          userId: VALERIA_ID,
          _type: "UserTenantAccessPermission",
          isBlockPermission: false,
          permissions: [
            {
              permission: Permission.ProjectOwner,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            },
          ],
        } as never,
      },
    };

    await WorkspaceIncidentActions.assignRole({
      event: {
        id: INCIDENT_ID,
        projectId: PROJECT_ID,
      } as never,
      roleId: COMMANDER_ROLE_ID,
      userId: DEANE_ID,
      props: member,
    });

    expect(feedRows).toHaveLength(2);
    expect(feedRows[0]!.feedInfoInMarkdown).toBe(
      `👤 Added **${DEANE_LINK}** as **Incident Commander** to ${INCIDENT_LINK}.`,
    );
    expect(feedRows[1]!.feedInfoInMarkdown).toBe(
      `👤 Removed **[Ana Ruiz](${personPage(ANA_ID)})** as **Incident Commander** from ${INCIDENT_LINK}.`,
    );

    for (const row of feedRows) {
      expect(row.userId?.toString()).toBe(VALERIA_ID.toString());
    }

    const slackLines: Array<string> = posted
      .filter((payload: WorkspaceMessagePayload): boolean => {
        return payload.workspaceType === WorkspaceType.Slack;
      })
      .map((payload: WorkspaceMessagePayload): string => {
        return (payload.messageBlocks[0] as WorkspacePayloadMarkdown).text;
      });

    expect(slackLines).toHaveLength(2);
    for (const line of slackLines) {
      expect(line.startsWith(`👤 ${VALERIA_LINK} `)).toBe(true);
    }
  });
});

describe("OneUptime itself", () => {
  test("the first person to change the state becomes Incident Commander: the line says so, and is by no one", async () => {
    const primary: IncidentRole = new IncidentRole();
    primary._id = COMMANDER_ROLE_ID.toString();

    jest.spyOn(IncidentRoleService, "findOneBy").mockResolvedValue(primary);
    jest.spyOn(IncidentMemberService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockResolvedValue(true);

    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentMemberService, "create")
      .mockImplementation(createAsTheDatabaseDoes as never);

    await (
      IncidentStateTimelineService as unknown as {
        autoAssignIncidentCommander: (data: {
          incidentId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
          stateName: string;
        }) => Promise<void>;
      }
    ).autoAssignIncidentCommander({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      userId: DEANE_ID,
      stateName: "Acknowledged",
    });

    // OneUptime's own write, saying why.
    const createBy: CreateBy<IncidentMember> = create.mock
      .calls[0]![0] as CreateBy<IncidentMember>;
    expect(createBy.props).toEqual({ isRoot: true });
    expect(
      IncidentRoleFeedText.readCause({
        miscDataProps: createBy.miscDataProps,
        props: createBy.props,
      }),
    ).toEqual({ kind: "stateChange", stateName: "Acknowledged" });

    const row: IncidentFeed = onlyFeedRow();
    expect(row.userId).toBeUndefined();
    expect(row.feedInfoInMarkdown).toBe(
      `👤 **${DEANE_LINK}** became the **Incident Commander** of ${INCIDENT_LINK} when they changed its state to **Acknowledged**.`,
    );

    for (const message of [slackShows(), teamsShows()]) {
      expect(message.reads).toBe(
        "👤 Deane Looi became the Incident Commander of Incident INC-18 when they changed its state to Acknowledged.",
      );
      expect(timesIn(message.reads, "Deane Looi")).toBe(1);
    }
  });

  test("a monitor's criteria: the line names the monitor, and is by no one", async () => {
    await add({
      userId: DEANE_ID,
      props: { isRoot: true },
      miscDataProps: IncidentRoleFeedText.toMiscDataProps({
        kind: "monitor",
        monitorName: "API Health",
      }),
    });

    const row: IncidentFeed = onlyFeedRow();
    expect(row.userId).toBeUndefined();
    expect(slackShows().reads).toBe(
      "👤 Monitor API Health added Deane Looi as Responder to Incident INC-18.",
    );
    expect(teamsShows().reads).toBe(
      "👤 Monitor API Health added Deane Looi as Responder to Incident INC-18.",
    );
  });

  test("a request that sends a cause of its own is not believed: the person did it", async () => {
    await add({
      userId: DEANE_ID,
      props: memberProps(VALERIA_ID),
      miscDataProps: IncidentRoleFeedText.toMiscDataProps({
        kind: "monitor",
        monitorName: "Spoofed",
      }),
    });

    expect(onlyFeedRow().userId?.toString()).toBe(VALERIA_ID.toString());
    expect(slackShows().reads).toBe(
      "👤 Valeria Mustafaeva added Deane Looi as Responder to Incident INC-18.",
    );
  });

  test("with nothing to say why, the line is as it always was, and opens with no one", async () => {
    await add({ userId: DEANE_ID, props: { isRoot: true } });

    expect(onlyFeedRow().userId).toBeUndefined();
    expect(slackShows().reads).toBe(
      "👤 Added Deane Looi as Responder to Incident INC-18.",
    );
  });
});

describe("a role given on an incident episode, copied to its incidents", () => {
  beforeEach(() => {
    const inEpisode: IncidentEpisodeMember = new IncidentEpisodeMember();
    inEpisode.incidentId = INCIDENT_ID;

    jest
      .spyOn(IncidentEpisodeMemberService, "findBy")
      .mockResolvedValue([inEpisode]);
    jest.spyOn(IncidentMemberService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getNotificationRulesWhereInviteRolesIsTrue",
      )
      .mockResolvedValue([]);
    jest
      .spyOn(IncidentEpisodeService, "getWorkspaceChannelForEpisode")
      .mockResolvedValue([]);
  });

  test("each incident's line is by whoever gave it on the episode", async () => {
    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentMemberService, "create")
      .mockImplementation(createAsTheDatabaseDoes as never);

    const episodeRole: IncidentEpisodeRoleMember =
      new IncidentEpisodeRoleMember();
    episodeRole.projectId = PROJECT_ID;
    episodeRole.incidentEpisodeId = EPISODE_ID;
    episodeRole.userId = DEANE_ID;
    episodeRole.incidentRoleId = RESPONDER_ROLE_ID;
    episodeRole.createdByUserId = VALERIA_ID;

    await IncidentEpisodeRoleMemberService.onCreateSuccess(
      {
        createBy: { data: episodeRole, props: memberProps(VALERIA_ID) },
        carryForward: null,
      } as OnCreate<IncidentEpisodeRoleMember>,
      episodeRole,
    );

    // OneUptime's own write, naming the person - and nothing of theirs.
    expect(
      (create.mock.calls[0]![0] as CreateBy<IncidentMember>).props,
    ).toEqual({ isRoot: true, userId: VALERIA_ID });
    expect(onlyFeedRow().userId?.toString()).toBe(VALERIA_ID.toString());
    expect(slackShows().reads).toBe(
      "👤 Valeria Mustafaeva added Deane Looi as Responder to Incident INC-18.",
    );
  });

  test("taken off the episode: each incident's line is by whoever took it off", async () => {
    const deleteBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentMemberService, "deleteBy")
      .mockImplementation((async (data: {
        props: DatabaseCommonInteractionProps;
      }) => {
        await remove({ userId: DEANE_ID, props: data.props });
        return 1;
      }) as never);

    const episodeRole: IncidentEpisodeRoleMember =
      new IncidentEpisodeRoleMember();
    episodeRole.projectId = PROJECT_ID;
    episodeRole.incidentEpisodeId = EPISODE_ID;
    episodeRole.userId = DEANE_ID;
    episodeRole.incidentRoleId = RESPONDER_ROLE_ID;

    await (
      IncidentEpisodeRoleMemberService as unknown as {
        onDeleteSuccess: (
          onDelete: OnDelete<IncidentEpisodeRoleMember>,
          ids: Array<ObjectID>,
        ) => Promise<OnDelete<IncidentEpisodeRoleMember>>;
      }
    ).onDeleteSuccess(
      {
        deleteBy: {
          query: {},
          limit: 1,
          skip: 0,
          props: memberProps(VALERIA_ID),
        },
        carryForward: { itemsToDelete: [episodeRole] },
      } as OnDelete<IncidentEpisodeRoleMember>,
      [],
    );

    expect(
      (deleteBy.mock.calls[0]![0] as DeleteBy<IncidentMember>).props,
    ).toEqual({ isRoot: true, userId: VALERIA_ID });
    expect(slackShows().reads).toBe(
      "👤 Valeria Mustafaeva removed Deane Looi as Responder from Incident INC-18.",
    );
  });

  test("a grouping rule's role is OneUptime's own: the incidents' lines open with no one", async () => {
    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentMemberService, "create")
      .mockImplementation(createAsTheDatabaseDoes as never);

    const episodeRole: IncidentEpisodeRoleMember =
      new IncidentEpisodeRoleMember();
    episodeRole.projectId = PROJECT_ID;
    episodeRole.incidentEpisodeId = EPISODE_ID;
    episodeRole.userId = DEANE_ID;
    episodeRole.incidentRoleId = RESPONDER_ROLE_ID;

    await IncidentEpisodeRoleMemberService.onCreateSuccess(
      {
        createBy: { data: episodeRole, props: { isRoot: true } },
        carryForward: null,
      } as OnCreate<IncidentEpisodeRoleMember>,
      episodeRole,
    );

    expect(
      (create.mock.calls[0]![0] as CreateBy<IncidentMember>).props,
    ).toEqual({ isRoot: true });
    expect(onlyFeedRow().userId).toBeUndefined();
    expect(slackShows().reads).toBe(
      "👤 Added Deane Looi as Responder to Incident INC-18.",
    );
  });
});
