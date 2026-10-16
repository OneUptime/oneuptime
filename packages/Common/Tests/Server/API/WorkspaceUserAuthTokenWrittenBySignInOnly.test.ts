import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THIS FILE DEFENDS
 *
 * A Slack or Microsoft Teams account acts as the OneUptime member it is
 * connected to: a button, a command or a reaction in the chat runs with that
 * member's permissions and is credited to them, and the member's direct
 * messages, channel invitations and chat notification method go to the
 * account. So an account is connected to a member only when the member signed
 * in to the chat as it - the Slack install and sign-in callbacks and the
 * Microsoft Teams sign-in callback, each behind a single-use state issued to
 * the member's own session (SlackOAuthState, MicrosoftTeamsOAuthState) - and
 * the chat said which account signed in.
 *
 * The generic CRUD API was a second way in. Anybody signed in - a member of
 * the project or of any other - could write a link of their own to any chat
 * account id, without signing in to the chat at all: the chat then acted on
 * that account's presses as the writer, and Slack or Microsoft Teams could be
 * added as the writer's notification method, "verified", pointing at the
 * account. Driven here end to end, nothing stubbed but the tables (held in
 * memory), the membership read and the Slack name lookup:
 *
 *   - nobody, in any role, from any project, writes or changes a link
 *     through the API - for an account of their own choosing or for another
 *     member;
 *   - an account nobody signed in to is not anybody's: a press from it is
 *     answered with a Connect prompt, Microsoft Teams finds nobody, and Slack
 *     cannot be added as a notification method for it;
 *   - a Slack account is looked for among Slack links only;
 *   - the sign-in still connects the account (refreshAuthToken, as
 *     OneUptime), and what a member does with their own link - read it,
 *     disconnect it - still works, for their own link only.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendFileResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      // Read by an update before it logs; any level but DEBUG.
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import SlackAPI from "../../../Server/API/SlackAPI";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserSlackService, {
  Service as UserSlackServiceType,
} from "../../../Server/Services/UserSlackService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService, {
  Service as WorkspaceUserAuthTokenServiceType,
} from "../../../Server/Services/WorkspaceUserAuthTokenService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import SlackActionType from "../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAuthAction, {
  SlackAuthRefusalReason,
  SlackRequest,
} from "../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import SlackChannelMembers from "../../../Server/Utils/Workspace/Slack/SlackChannelMembers";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

type MockedFn = ReturnType<typeof jest.fn>;

const LINKS_ROUTE: string = "/workspace-user-auth-token";
const LINKS_LIST_ROUTE: string = "/workspace-user-auth-token/get-list";
const LINK_ROUTE: string = "/workspace-user-auth-token/:id";
const LINK_UPDATE_ITEM_ROUTE: string =
  "/workspace-user-auth-token/:id/update-item";
const SLACK_METHOD_ROUTE: string = "/user-slack";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
// The project's Slack workspace, and its bot.
const SLACK_TEAM_ID: string = "T0PROJECT";
const SLACK_BOT_TOKEN: string = "xoxb-project-bot-token";
// Microsoft Teams names its people by their Microsoft Entra object id.
const TEAMS_TENANT_ID: string = "9a1b2c3d-0000-4000-8000-00000000aaaa";

// A colleague's chat accounts: whoever writes a link names them.
const COLLEAGUE_SLACK_ID: string = "U0COLLEAGUE";
const COLLEAGUE_TEAMS_ID: string = "0c0c0c0c-1111-4222-8333-444444444444";

// A member who signed in to Slack and to Microsoft Teams, and their links.
const SIGNED_IN_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SIGNED_IN_SLACK_ID: string = "U0SIGNEDIN";
const SIGNED_IN_TEAMS_ID: string = "5e5e5e5e-1111-4222-8333-444444444444";
const SIGNED_IN_SLACK_LINK_ID: string = "44444444-4444-4444-8444-444444444444";
const SIGNED_IN_TEAMS_LINK_ID: string = "55555555-5555-4555-8555-555555555555";

const INCIDENT_ID: string = "66666666-6666-4666-8666-666666666666";

let props: DatabaseCommonInteractionProps;
let links: InMemoryTable;
let slackMethods: InMemoryTable;
// Who WorkspaceActionAuthorization takes for a member of the project.
let memberUserIds: Set<string>;

const sendEntityArrayResponseMock: MockedFn =
  Response.sendEntityArrayResponse as unknown as MockedFn;

// A signed-in person holding exactly `permissions` in the project.
function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

/*
 * Somebody signed in who is a member of another project only, sending the
 * project's id as the request's project - which names the project without
 * making them anything in it.
 */
function memberOfAnotherProject(): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: [Permission.ProjectOwner],
      projectId: OTHER_PROJECT_ID,
    }),
    tenantId: PROJECT_ID,
    ...ON_HIGHEST_PLAN,
  };
}

// One of the project's API keys, holding every project role.
function apiKey(): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: [Permission.ProjectOwner],
      projectId: PROJECT_ID,
      isApiKey: true,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// Nobody signed in.
function anonymous(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.User,
    ...ON_HIGHEST_PLAN,
  };
}

// Everybody who might try to write a link through the API.
const WRITERS: Array<[string, () => DatabaseCommonInteractionProps]> = [
  [
    "a project owner",
    (): DatabaseCommonInteractionProps => {
      return caller([Permission.ProjectOwner]);
    },
  ],
  [
    "a project admin",
    (): DatabaseCommonInteractionProps => {
      return caller([Permission.ProjectAdmin]);
    },
  ],
  [
    "a project member",
    (): DatabaseCommonInteractionProps => {
      return caller([Permission.ProjectMember]);
    },
  ],
  [
    "a viewer",
    (): DatabaseCommonInteractionProps => {
      return caller([Permission.Viewer]);
    },
  ],
  [
    "somebody holding no role in the project",
    (): DatabaseCommonInteractionProps => {
      return caller([]);
    },
  ],
  ["a member of another project", memberOfAnotherProject],
  ["a project API key", apiKey],
  ["somebody not signed in", anonymous],
];

// What a forger sends: a link of the caller's own, to somebody else's account.
function linkBody(data: {
  workspaceType: WorkspaceType;
  workspaceUserId: string;
  extra?: JSONObject;
}): JSONObject {
  return {
    data: {
      projectId: PROJECT_ID.toString(),
      workspaceType: data.workspaceType,
      workspaceUserId: data.workspaceUserId,
      authToken: "",
      miscData: { userId: data.workspaceUserId },
      ...(data.extra || {}),
    },
  };
}

// A link a sign-in wrote: as OneUptime, so it names no creator.
function signedInLink(data: {
  id: string;
  workspaceType: WorkspaceType;
  workspaceUserId: string;
  userId?: ObjectID;
}): StoredRow {
  return {
    _id: data.id,
    projectId: PROJECT_ID.toString(),
    userId: (data.userId || SIGNED_IN_USER_ID).toString(),
    workspaceType: data.workspaceType,
    workspaceUserId: data.workspaceUserId,
    authToken: "user-token-never-served",
    miscData: { userId: data.workspaceUserId },
    version: 1,
  };
}

async function callRoute(
  method: string,
  route: string,
  data: {
    body?: JSONObject;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): Promise<{ error: Error | undefined }> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: data.query || {},
    headers: {},
    body: data.body || {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(method, route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { error: next.mock.calls[0]?.[0] as Error | undefined };
}

// A Slack button pressed by `slackUserId` in the project's workspace.
async function pressInSlack(slackUserId: string): Promise<SlackRequest> {
  return await SlackAuthAction.isAuthorized({
    req: {
      body: {
        payload: JSON.stringify({
          type: "block_actions",
          user: { id: slackUserId, username: "someone", name: "someone" },
          team: { id: SLACK_TEAM_ID },
          channel: { id: "C0INCIDENTS" },
          container: { type: "message" },
          message: { ts: "1700000000.000100" },
          response_url: "https://hooks.slack.com/actions/T0PROJECT/1/abc",
          trigger_id: "1.2.3",
          actions: [
            {
              action_id: SlackActionType.AcknowledgeIncident,
              value: INCIDENT_ID,
            },
          ],
        }),
      },
    } as unknown as ExpressRequest,
  });
}

function rowsOf(table: InMemoryTable): Array<StoredRow> {
  return table.rows;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new BaseAPI<WorkspaceUserAuthToken, WorkspaceUserAuthTokenServiceType>(
    WorkspaceUserAuthToken,
    WorkspaceUserAuthTokenService,
  );
  new BaseAPI<UserSlack, UserSlackServiceType>(UserSlack, UserSlackService);
});

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  links = useInMemoryTable(WorkspaceUserAuthTokenService, [
    signedInLink({
      id: SIGNED_IN_SLACK_LINK_ID,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: SIGNED_IN_SLACK_ID,
    }),
    signedInLink({
      id: SIGNED_IN_TEAMS_LINK_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: SIGNED_IN_TEAMS_ID,
    }),
  ]);

  // The project's Slack and Microsoft Teams connections.
  useInMemoryTable(WorkspaceProjectAuthTokenService, [
    {
      _id: "77777777-7777-4777-8777-777777777777",
      projectId: PROJECT_ID.toString(),
      workspaceType: WorkspaceType.Slack,
      workspaceProjectId: SLACK_TEAM_ID,
      authToken: SLACK_BOT_TOKEN,
      miscData: {
        teamId: SLACK_TEAM_ID,
        teamName: "Project workspace",
        botUserId: "U0ONEUPTIME",
      },
      version: 1,
    },
    {
      _id: "88888888-8888-4888-8888-888888888888",
      projectId: PROJECT_ID.toString(),
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceProjectId: TEAMS_TENANT_ID,
      authToken: "graph-app-token",
      miscData: { tenantId: TEAMS_TENANT_ID },
      version: 1,
    },
  ]);

  slackMethods = useInMemoryTable(UserSlackService, []);

  memberUserIds = new Set<string>([SIGNED_IN_USER_ID.toString()]);

  jest
    .spyOn(WorkspaceActionAuthorization, "isProjectMember")
    .mockImplementation(
      async (data: { userId: ObjectID; projectId: ObjectID }) => {
        return (
          data.projectId.toString() === PROJECT_ID.toString() &&
          memberUserIds.has(data.userId.toString())
        );
      },
    );

  // The method's label only; Slack is not called.
  jest
    .spyOn(SlackUtil, "getUsernameFromUserId")
    .mockResolvedValue("someone" as never);

  jest
    .spyOn(
      UserNotificationRuleService,
      "addDefaultNotificationRulesForVerifiedMethod",
    )
    .mockResolvedValue(undefined as never);

  props = caller([Permission.ProjectMember]);
  memberUserIds.add(props.userId!.toString());

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("nobody connects a Slack or Microsoft Teams account through the API", () => {
  test.each(WRITERS)(
    "%s cannot connect somebody else's Slack account to themselves",
    async (_who: string, as: () => DatabaseCommonInteractionProps) => {
      props = as();

      const { error } = await callRoute("POST", LINKS_ROUTE, {
        body: linkBody({
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: COLLEAGUE_SLACK_ID,
        }),
      });

      expect(error).toBeInstanceOf(Exception);
      // Nothing was written: the two links the sign-ins wrote are all there is.
      expect(rowsOf(links)).toHaveLength(2);
      expect(links.inserts).toHaveLength(0);
    },
  );

  test.each(WRITERS)(
    "%s cannot connect somebody else's Microsoft Teams account to themselves",
    async (_who: string, as: () => DatabaseCommonInteractionProps) => {
      props = as();

      const { error } = await callRoute("POST", LINKS_ROUTE, {
        body: linkBody({
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceUserId: COLLEAGUE_TEAMS_ID,
        }),
      });

      expect(error).toBeInstanceOf(Exception);
      expect(rowsOf(links)).toHaveLength(2);
      expect(links.inserts).toHaveLength(0);
    },
  );

  test("the refusal is the table's, not a column's: nobody may create a link at all", async () => {
    props = caller([Permission.ProjectOwner]);

    const { error } = await callRoute("POST", LINKS_ROUTE, {
      body: linkBody({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: COLLEAGUE_SLACK_ID,
      }),
    });

    expect(error?.message).toBe(
      "create on Workspace User Auth Token is not allowed.",
    );
  });

  test("a link for another member is refused too, under either spelling of the member", async () => {
    props = caller([Permission.ProjectOwner]);

    for (const extra of [
      { userId: SIGNED_IN_USER_ID.toString() },
      { user: { _id: SIGNED_IN_USER_ID.toString() } },
    ]) {
      const { error } = await callRoute("POST", LINKS_ROUTE, {
        body: linkBody({
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: "U0SOMEBODYELSE",
          extra: extra,
        }),
      });

      expect(error).toBeInstanceOf(Exception);
    }

    expect(links.inserts).toHaveLength(0);
  });

  test.each([
    ["PUT", LINK_ROUTE],
    ["POST", LINK_UPDATE_ITEM_ROUTE],
  ])(
    "a member cannot point their own link at another account (%s %s)",
    async (method: string, route: string) => {
      props = {
        ...caller([Permission.ProjectMember]),
        userId: SIGNED_IN_USER_ID,
      };

      const { error } = await callRoute(method, route, {
        params: { id: SIGNED_IN_SLACK_LINK_ID },
        body: {
          data: {
            workspaceUserId: COLLEAGUE_SLACK_ID,
            miscData: { userId: COLLEAGUE_SLACK_ID },
          },
        },
      });

      expect(error).toBeInstanceOf(Exception);
      expect(links.updates).toHaveLength(0);
      expect(links.get(SIGNED_IN_SLACK_LINK_ID)?.["workspaceUserId"]).toBe(
        SIGNED_IN_SLACK_ID,
      );
    },
  );
});

describe("an account nobody signed in to is nobody's", () => {
  test("a Slack press from it does not act as whoever tried to connect it: it is asked to connect", async () => {
    props = caller([Permission.ProjectMember]);
    memberUserIds.add(props.userId!.toString());

    await callRoute("POST", LINKS_ROUTE, {
      body: linkBody({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: COLLEAGUE_SLACK_ID,
      }),
    });

    const press: SlackRequest = await pressInSlack(COLLEAGUE_SLACK_ID);

    expect(press.isAuthorized).toBe(false);
    expect(press.userId).toBeUndefined();
    expect(press.refusal?.reason).toBe(SlackAuthRefusalReason.NotConnected);
    expect(press.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("a press from it is not refused as a stranger's either: somebody outside the project cannot break the account's Connect prompt", async () => {
    props = memberOfAnotherProject();

    await callRoute("POST", LINKS_ROUTE, {
      body: linkBody({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: COLLEAGUE_SLACK_ID,
      }),
    });

    const press: SlackRequest = await pressInSlack(COLLEAGUE_SLACK_ID);

    // Asked to connect, as an account nobody connected - not "not a member".
    expect(press.refusal?.reason).toBe(SlackAuthRefusalReason.NotConnected);
  });

  test("Microsoft Teams finds nobody for it", async () => {
    props = caller([Permission.ProjectMember]);
    memberUserIds.add(props.userId!.toString());

    await callRoute("POST", LINKS_ROUTE, {
      body: linkBody({
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: COLLEAGUE_TEAMS_ID,
      }),
    });

    await expect(
      MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
        teamsUserId: COLLEAGUE_TEAMS_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toBeInstanceOf(MicrosoftTeamsAccountNotLinkedException);
  });

  test("Slack cannot become a notification method for it: there is nothing verified to point at", async () => {
    props = caller([Permission.ProjectMember]);

    await callRoute("POST", LINKS_ROUTE, {
      body: linkBody({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: COLLEAGUE_SLACK_ID,
      }),
    });

    const { error } = await callRoute("POST", SLACK_METHOD_ROUTE, {
      body: {
        data: {
          projectId: PROJECT_ID.toString(),
          userId: props.userId!.toString(),
        },
      },
    });

    expect(error?.message).toContain(
      "Your Slack account is not connected to OneUptime in this project yet.",
    );
    expect(rowsOf(slackMethods)).toHaveLength(0);
  });
});

describe("an email address is never who acts", () => {
  /*
   * A record's Slack Channel card, a page from chat and an on-call user
   * group find somebody who has not connected Slack by the email address
   * Slack has for them - to invite them, page them or put them in the group.
   * That match never connects the account, and never decides who a press
   * acts as: only a sign-in's link does.
   */
  test("a Slack account with a member's email address, never signed in to, is asked to connect - and no email is looked up for it", async () => {
    const byEmail: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SlackChannelMembers,
      "findPersonByEmail",
    );
    const byId: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SlackChannelMembers,
      "getPerson",
    );

    const press: SlackRequest = await pressInSlack("U0SAMEEMAIL");

    expect(press.isAuthorized).toBe(false);
    expect(press.userId).toBeUndefined();
    expect(press.refusal?.reason).toBe(SlackAuthRefusalReason.NotConnected);
    expect(byEmail).not.toHaveBeenCalled();
    expect(byId).not.toHaveBeenCalled();
    expect(links.inserts).toHaveLength(0);
  });
});

describe("a Slack account is looked for among Slack links only", () => {
  // A link of another chat whose account id reads like a Slack one.
  function teamsLinkNamedLikeSlack(userId: ObjectID): StoredRow {
    return {
      _id: "99999999-9999-4999-8999-999999999999",
      projectId: PROJECT_ID.toString(),
      userId: userId.toString(),
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: COLLEAGUE_SLACK_ID,
      authToken: "",
      miscData: {},
      version: 1,
    };
  }

  test("a button press", async () => {
    const writer: ObjectID = ObjectID.generate();
    memberUserIds.add(writer.toString());
    links.rows.push(teamsLinkNamedLikeSlack(writer));

    const press: SlackRequest = await pressInSlack(COLLEAGUE_SLACK_ID);

    expect(press.userId).toBeUndefined();
    expect(press.refusal?.reason).toBe(SlackAuthRefusalReason.NotConnected);
  });

  test("a question to OneUptime AI, or a slash command", async () => {
    const writer: ObjectID = ObjectID.generate();
    memberUserIds.add(writer.toString());
    links.rows.push(teamsLinkNamedLikeSlack(writer));

    const context: { userId?: ObjectID | undefined } | undefined = await (
      SlackAPI as unknown as {
        resolveSlackAiOpsContext: (data: {
          slackTeamId: string;
          slackUserId: string;
        }) => Promise<{ userId?: ObjectID | undefined } | undefined>;
      }
    ).resolveSlackAiOpsContext({
      slackTeamId: SLACK_TEAM_ID,
      slackUserId: COLLEAGUE_SLACK_ID,
    });

    expect(context).toBeDefined();
    expect(context?.userId).toBeUndefined();
  });

  test("the account a member signed in to Slack as is found for both", async () => {
    const press: SlackRequest = await pressInSlack(SIGNED_IN_SLACK_ID);

    expect(press.isAuthorized).toBe(true);
    expect(press.userId?.toString()).toBe(SIGNED_IN_USER_ID.toString());

    const context: { userId?: ObjectID | undefined } | undefined = await (
      SlackAPI as unknown as {
        resolveSlackAiOpsContext: (data: {
          slackTeamId: string;
          slackUserId: string;
        }) => Promise<{ userId?: ObjectID | undefined } | undefined>;
      }
    ).resolveSlackAiOpsContext({
      slackTeamId: SLACK_TEAM_ID,
      slackUserId: SIGNED_IN_SLACK_ID,
    });

    expect(context?.userId?.toString()).toBe(SIGNED_IN_USER_ID.toString());
  });
});

describe("the sign-in still connects the account", () => {
  test("its write - as OneUptime - links the account, and the link names no creator", async () => {
    const member: ObjectID = ObjectID.generate();
    memberUserIds.add(member.toString());

    await WorkspaceUserAuthTokenService.refreshAuthToken({
      projectId: PROJECT_ID,
      userId: member,
      workspaceType: WorkspaceType.Slack,
      authToken: "",
      workspaceUserId: "U0NEWMEMBER",
      miscData: { userId: "U0NEWMEMBER" },
    });

    const written: StoredRow | undefined = rowsOf(links).find(
      (row: StoredRow): boolean => {
        return row["workspaceUserId"] === "U0NEWMEMBER";
      },
    );

    expect(written).toBeDefined();
    expect(String(written?.["userId"])).toBe(member.toString());
    expect(String(written?.["projectId"])).toBe(PROJECT_ID.toString());
    expect(written?.["workspaceType"]).toBe(WorkspaceType.Slack);
    // No person wrote it: what tells a sign-in's link from one typed in.
    expect(written?.["createdByUserId"] ?? null).toBeNull();

    const press: SlackRequest = await pressInSlack("U0NEWMEMBER");

    expect(press.isAuthorized).toBe(true);
    expect(press.userId?.toString()).toBe(member.toString());
  });

  test("signing in again points the member's own link at the account they signed in as", async () => {
    await WorkspaceUserAuthTokenService.refreshAuthToken({
      projectId: PROJECT_ID,
      userId: SIGNED_IN_USER_ID,
      workspaceType: WorkspaceType.Slack,
      authToken: "",
      workspaceUserId: "U0SECONDACCOUNT",
      miscData: { userId: "U0SECONDACCOUNT" },
    });

    expect(links.get(SIGNED_IN_SLACK_LINK_ID)?.["workspaceUserId"]).toBe(
      "U0SECONDACCOUNT",
    );
    expect(links.inserts).toHaveLength(0);
  });

  test("a Microsoft Teams sign-in's link answers for its account", async () => {
    const userId: ObjectID =
      await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
        teamsUserId: SIGNED_IN_TEAMS_ID,
        projectId: PROJECT_ID,
      });

    expect(userId.toString()).toBe(SIGNED_IN_USER_ID.toString());
  });

  test("the member adds Slack as a notification method, pointing at the account they signed in as", async () => {
    props = {
      ...caller([Permission.ProjectMember]),
      userId: SIGNED_IN_USER_ID,
    };

    const { error } = await callRoute("POST", SLACK_METHOD_ROUTE, {
      body: {
        data: {
          projectId: PROJECT_ID.toString(),
          userId: SIGNED_IN_USER_ID.toString(),
        },
      },
    });

    expect(error).toBeUndefined();
    expect(rowsOf(slackMethods)).toHaveLength(1);
    expect(rowsOf(slackMethods)[0]!["slackUserId"]).toBe(SIGNED_IN_SLACK_ID);
    expect(rowsOf(slackMethods)[0]!["isVerified"]).toBe(true);
  });
});

describe("a member's own link: read it and disconnect it, never anybody else's", () => {
  function listedLinks(): Array<WorkspaceUserAuthToken> {
    return (
      (sendEntityArrayResponseMock.mock.calls[0]?.[2] as
        | Array<WorkspaceUserAuthToken>
        | undefined) || []
    );
  }

  test("the member reads their own links, without their token", async () => {
    props = {
      ...caller([Permission.ProjectMember]),
      userId: SIGNED_IN_USER_ID,
    };

    const { error } = await callRoute("POST", LINKS_LIST_ROUTE, {
      body: {
        query: {},
        select: { _id: true, workspaceUserId: true, workspaceType: true },
      },
      query: { skip: "0", limit: "10" },
    });

    expect(error).toBeUndefined();

    const listed: Array<WorkspaceUserAuthToken> = listedLinks();

    expect(
      listed
        .map((link: WorkspaceUserAuthToken): string => {
          return String(link.workspaceUserId);
        })
        .sort(),
    ).toEqual([SIGNED_IN_SLACK_ID, SIGNED_IN_TEAMS_ID].sort());

    const { error: tokenError } = await callRoute("POST", LINKS_LIST_ROUTE, {
      body: { query: {}, select: { _id: true, authToken: true } },
      query: { skip: "0", limit: "10" },
    });

    expect(tokenError).toBeInstanceOf(Exception);
  });

  test("another member lists none of them", async () => {
    props = caller([Permission.ProjectOwner]);

    const { error } = await callRoute("POST", LINKS_LIST_ROUTE, {
      body: { query: {}, select: { _id: true, workspaceUserId: true } },
      query: { skip: "0", limit: "10" },
    });

    expect(error).toBeUndefined();
    expect(listedLinks()).toHaveLength(0);
  });

  test("the member disconnects their own link", async () => {
    props = {
      ...caller([Permission.ProjectMember]),
      userId: SIGNED_IN_USER_ID,
    };

    const { error } = await callRoute("DELETE", LINK_ROUTE, {
      params: { id: SIGNED_IN_SLACK_LINK_ID },
    });

    expect(error).toBeUndefined();
    expect(links.get(SIGNED_IN_SLACK_LINK_ID)).toBeUndefined();
    expect(links.get(SIGNED_IN_TEAMS_LINK_ID)).toBeDefined();
  });

  test("nobody else disconnects it, an owner of the project included", async () => {
    props = caller([Permission.ProjectOwner]);

    await callRoute("DELETE", LINK_ROUTE, {
      params: { id: SIGNED_IN_SLACK_LINK_ID },
    });

    expect(links.get(SIGNED_IN_SLACK_LINK_ID)).toBeDefined();
  });
});
