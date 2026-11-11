import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import logger from "../../../Server/Utils/Logger";
import SlackOrganization from "../../../Server/Utils/Workspace/Slack/SlackOrganization";
import {
  httpRequest,
  ProbeResponse,
  RunningApp,
  startApp,
  TEST_MEMBER_OF_HEADER,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";
import {
  EAST,
  FakeSlack,
  InMemorySlackConnections,
  LAB,
  ORG_ID,
  ORG_NAME,
  ORG_TOKEN,
  SlackCall,
  StoredSlackConnection,
  WEST,
} from "./SlackOrganizationTestHelpers";

/*
 * A PROJECT'S SLACK, AS PROJECT SETTINGS AND THE RULE FORM READ IT, FOR AN
 * ENTERPRISE ORGANIZATION.
 *
 * GET /slack/workspaces says how the project is connected: to a whole Slack
 * Enterprise organization - its name, the workspaces OneUptime was added
 * to, the default first, and the default - or to one workspace, and
 * whether that workspace is part of an organization (which could install
 * OneUptime for all of its workspaces instead). PUT /slack/default-workspace
 * makes another of the organization's workspaces the default: where a rule
 * that names no workspace creates its channel. GET /slack/channels lists
 * the channels of every workspace of the organization, each naming its
 * workspace.
 *
 * Through the real routes and the real WorkspaceProjectAuthTokenService, on
 * an in-memory table of connections, against a recorded Slack.
 */

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: (...args: Array<any>) => {
        return (
          jest.requireActual("./WorkspaceOAuthTestHelpers") as any
        ).fakeGetUserMiddleware(...args);
      },
    },
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("./WorkspaceOAuthTestHelpers") as any
    ).createInMemoryGlobalCache(),
  };
});

jest.mock("../../../Server/Services/WorkspaceUserAuthTokenService", () => {
  return {
    __esModule: true,
    default: {},
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      }),
    },
  };
});

const NOT_CONNECTED: string =
  "Slack is not connected for this project. Please connect Slack first.";

describe("a project's Slack Enterprise organization, over HTTP", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  let connections: InMemorySlackConnections;
  let slack: FakeSlack;

  beforeAll(async () => {
    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;

    app = await startApp([new SlackAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    connections = new InMemorySlackConnections();
    connections.install();

    slack = new FakeSlack();
    slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST]);
    slack.install();

    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function headers(options?: {
    permissions?: Array<Permission> | undefined;
    memberOf?: ObjectID | undefined;
  }): Record<string, string> {
    const result: Record<string, string> = {
      [TEST_USER_HEADER]: userId.toString(),
      tenantid: projectId.toString(),
      [TEST_PERMISSIONS_HEADER]: (
        options?.permissions || [Permission.ProjectMember]
      ).join(","),
    };

    if (options?.memberOf) {
      result[TEST_MEMBER_OF_HEADER] = options.memberOf.toString();
    }

    return result;
  }

  function request(data: {
    method: string;
    path: string;
    headers?: Record<string, string> | undefined;
    body?: unknown;
  }): Promise<ProbeResponse> {
    return httpRequest({
      port: app.port,
      method: data.method,
      path: data.path,
      headers: data.headers === undefined ? headers() : data.headers,
      body: data.body,
      timeoutMs: 20000,
    });
  }

  function minutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * 60 * 1000).toISOString();
  }

  function connectToOrganization(miscData?: JSONObject): StoredSlackConnection {
    return connections.add({
      projectId: projectId,
      workspaceProjectId: ORG_ID,
      authToken: ORG_TOKEN,
      miscData: {
        teamId: ORG_ID,
        teamName: ORG_NAME,
        botUserId: "U0ONEUPTIMEBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
        isEnterpriseInstall: true,
        workspaces: [EAST, LAB, WEST],
        workspacesReadAt: minutesAgo(1),
        ...(miscData || {}),
      },
    });
  }

  function connectToEast(miscData?: JSONObject): StoredSlackConnection {
    return connections.add({
      projectId: projectId,
      workspaceProjectId: EAST.id,
      authToken: "xoxb-east-token",
      miscData: miscData || {
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
      },
    });
  }

  function stored(): StoredSlackConnection {
    return connections.slackOf(projectId)!;
  }

  function tokensOf(method: string): Array<string> {
    return slack.callsOf(method).map((call: SlackCall): string => {
      return call.token;
    });
  }

  describe("GET /slack/workspaces", () => {
    function getWorkspaces(query: string = ""): Promise<ProbeResponse> {
      return request({ method: "GET", path: `/api/slack/workspaces${query}` });
    }

    test("an anonymous caller is told to sign in", async () => {
      connectToOrganization();

      const response: ProbeResponse = await request({
        method: "GET",
        path: "/api/slack/workspaces",
        headers: { tenantid: projectId.toString() },
      });

      expect(response.status).toBe(401);
      expect(slack.calls).toEqual([]);
    });

    test("somebody who is not a member of the project is refused", async () => {
      connectToOrganization();

      const response: ProbeResponse = await request({
        method: "GET",
        path: "/api/slack/workspaces",
        headers: headers({ memberOf: ObjectID.generate() }),
      });

      expect(response.status).toBe(422);
    });

    test("any member may read it - a Viewer too", async () => {
      connectToOrganization();

      const response: ProbeResponse = await request({
        method: "GET",
        path: "/api/slack/workspaces",
        headers: headers({ permissions: [Permission.Viewer] }),
      });

      expect(response.status).toBe(200);
    });

    test("a project not connected to Slack is told so", async () => {
      const response: ProbeResponse = await getWorkspaces();

      expect(response.status).toBe(400);
      expect((response.body as JSONObject)["message"]).toBe(NOT_CONNECTED);
    });

    test("the organization: its name, its workspaces with the default first and then by name, and the default - read as stored while fresh", async () => {
      connectToOrganization({ defaultWorkspaceId: WEST.id });

      const response: ProbeResponse = await getWorkspaces();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        isOrganization: true,
        isInOrganization: true,
        organizationName: ORG_NAME,
        workspaces: [WEST, EAST, LAB],
        defaultWorkspaceId: WEST.id,
        removedWorkspaces: [],
      });
      expect(slack.calls).toEqual([]);
    });

    test("a workspace Slack no longer lists - OneUptime was removed from it - is answered among the removed, by the name it had, and kept", async () => {
      connectToOrganization({
        workspacesReadAt: minutesAgo(
          SlackOrganization.WORKSPACES_FRESH_FOR_SECONDS / 60 + 1,
        ),
        defaultWorkspaceId: WEST.id,
      });
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST]);

      const response: ProbeResponse = await getWorkspaces();

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        workspaces: [WEST, EAST],
        removedWorkspaces: [LAB],
      });
      expect(stored().miscData["removedWorkspaces"]).toEqual([LAB]);

      // Read again while fresh: as kept, Slack not asked.
      const again: ProbeResponse = await getWorkspaces();

      expect((again.body as JSONObject)["removedWorkspaces"]).toEqual([LAB]);
      expect(tokensOf("auth.teams.list")).toEqual([ORG_TOKEN]);
    });

    test("a workspace OneUptime was added to again leaves the removed: listed as Slack names it now", async () => {
      connectToOrganization({
        workspaces: [EAST, WEST],
        removedWorkspaces: [{ id: LAB.id, name: "Acme Lab, as it was" }],
      });
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, LAB, WEST]);

      const before: ProbeResponse = await getWorkspaces();

      expect((before.body as JSONObject)["removedWorkspaces"]).toEqual([
        { id: LAB.id, name: "Acme Lab, as it was" },
      ]);

      const response: ProbeResponse = await getWorkspaces("?refresh=true");

      expect(response.body).toMatchObject({
        workspaces: [EAST, LAB, WEST],
        removedWorkspaces: [],
      });
      expect(stored().miscData["removedWorkspaces"]).toEqual([]);
    });

    test("with no default chosen, the first by name is the default", async () => {
      connectToOrganization();

      const response: ProbeResponse = await getWorkspaces();

      expect(response.body).toMatchObject({
        workspaces: [EAST, LAB, WEST],
        defaultWorkspaceId: EAST.id,
      });
    });

    test("workspaces listed longer ago than a few minutes are listed again, and kept", async () => {
      connectToOrganization({
        workspacesReadAt: minutesAgo(
          SlackOrganization.WORKSPACES_FRESH_FOR_SECONDS / 60 + 1,
        ),
        defaultWorkspaceId: WEST.id,
      });
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST]);

      const response: ProbeResponse = await getWorkspaces();

      expect(response.body).toMatchObject({
        workspaces: [WEST, EAST],
        defaultWorkspaceId: WEST.id,
      });
      expect(tokensOf("auth.teams.list")).toEqual([ORG_TOKEN]);
      expect(stored().miscData["workspaces"]).toEqual([EAST, WEST]);
      expect(
        Date.now() -
          Date.parse(stored().miscData["workspacesReadAt"] as string),
      ).toBeLessThan(60 * 1000);
    });

    test("?refresh=true lists them again however fresh - an admin just added OneUptime to a workspace", async () => {
      connectToOrganization();
      slack.workspacesOfToken.set(ORG_TOKEN, [
        EAST,
        LAB,
        WEST,
        {
          id: "T0NORTH",
          name: "Acme North",
        },
      ]);

      const response: ProbeResponse = await getWorkspaces("?refresh=true");

      expect(response.status).toBe(200);
      expect(tokensOf("auth.teams.list")).toEqual([ORG_TOKEN]);
      expect(
        ((response.body as JSONObject)["workspaces"] as Array<JSONObject>).map(
          (workspace: JSONObject): unknown => {
            return workspace["name"];
          },
        ),
      ).toEqual(["Acme East", "Acme Lab", "Acme North", "Acme West"]);
    });

    test("a default OneUptime has since been removed from is no longer the default: the first by name is", async () => {
      connectToOrganization({ defaultWorkspaceId: LAB.id });
      slack.workspacesOfToken.set(ORG_TOKEN, [WEST, EAST]);

      const response: ProbeResponse = await getWorkspaces("?refresh=true");

      expect(response.body).toMatchObject({
        workspaces: [EAST, WEST],
        defaultWorkspaceId: EAST.id,
      });
    });

    test("Slack failing to list them again answers with those listed last, not an error", async () => {
      connectToOrganization({ defaultWorkspaceId: WEST.id });
      slack.answers.set("auth.teams.list", (): JSONObject => {
        return { ok: false, error: "ratelimited" };
      });

      const response: ProbeResponse = await getWorkspaces("?refresh=true");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        isOrganization: true,
        workspaces: [WEST, EAST, LAB],
        defaultWorkspaceId: WEST.id,
      });
    });

    test("an organization's installation Slack has listed no workspace of: none, and no default", async () => {
      connectToOrganization({
        workspaces: [],
        workspacesReadAt: minutesAgo(1),
      });

      const response: ProbeResponse = await getWorkspaces();

      expect(response.body).toEqual({
        isOrganization: true,
        isInOrganization: true,
        organizationName: ORG_NAME,
        workspaces: [],
        defaultWorkspaceId: null,
        removedWorkspaces: [],
      });
    });

    test("one workspace of an organization, as its install recorded: not the organization's, but in one - Slack is not asked", async () => {
      connectToEast({
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
      });

      const response: ProbeResponse = await getWorkspaces();

      expect(response.body).toEqual({
        isOrganization: false,
        isInOrganization: true,
        organizationName: ORG_NAME,
        workspaces: [],
        defaultWorkspaceId: null,
        removedWorkspaces: [],
      });
      expect(slack.calls).toEqual([]);
    });

    test("one workspace recorded as part of no organization: in none - Slack is not asked", async () => {
      connectToEast({
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
        enterpriseId: "",
      });

      const response: ProbeResponse = await getWorkspaces();

      expect(response.body).toMatchObject({
        isOrganization: false,
        isInOrganization: false,
      });
      expect(slack.calls).toEqual([]);
    });

    test("one workspace connected before installs recorded it: Slack is asked once, with the workspace's token, and the answer is kept", async () => {
      connectToEast();
      slack.authTestOfToken.set("xoxb-east-token", {
        ok: true,
        team_id: EAST.id,
        enterprise_id: ORG_ID,
      });

      const first: ProbeResponse = await getWorkspaces();
      const second: ProbeResponse = await getWorkspaces();

      expect(first.body).toMatchObject({
        isOrganization: false,
        isInOrganization: true,
      });
      expect(second.body).toMatchObject({ isInOrganization: true });
      expect(tokensOf("auth.test")).toEqual(["xoxb-east-token"]);
      expect(stored().miscData["enterpriseId"]).toBe(ORG_ID);
    });

    test("…and a workspace of no organization is kept as such, so Slack is not asked again", async () => {
      connectToEast();
      slack.authTestOfToken.set("xoxb-east-token", {
        ok: true,
        team_id: EAST.id,
      });

      await getWorkspaces();
      const second: ProbeResponse = await getWorkspaces();

      expect(second.body).toMatchObject({ isInOrganization: false });
      expect(tokensOf("auth.test")).toEqual(["xoxb-east-token"]);
      expect(stored().miscData["enterpriseId"]).toBe("");
    });

    test("…while Slack cannot say, nothing is kept and the workspace reads as in no organization", async () => {
      connectToEast();
      slack.answers.set("auth.test", (): JSONObject => {
        return { ok: false, error: "account_inactive" };
      });

      const response: ProbeResponse = await getWorkspaces();

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ isInOrganization: false });
      expect(stored().miscData["enterpriseId"]).toBeUndefined();
    });
  });

  describe("PUT /slack/default-workspace", () => {
    function setDefault(
      body: unknown,
      requestHeaders?: Record<string, string>,
    ): Promise<ProbeResponse> {
      return request({
        method: "PUT",
        path: "/api/slack/default-workspace",
        headers: requestHeaders,
        body: body,
      });
    }

    test("a member who may only view the project is refused, and nothing changes", async () => {
      connectToOrganization({ defaultWorkspaceId: EAST.id });

      const response: ProbeResponse = await setDefault(
        { workspaceId: WEST.id },
        headers({ permissions: [Permission.Viewer] }),
      );

      expect(response.status).toBe(422);
      expect((response.body as JSONObject)["message"]).toBe(
        "You do not have permission to change this project's Slack settings.",
      );
      expect(stored().miscData["defaultWorkspaceId"]).toBe(EAST.id);
      expect(connections.writes).toEqual([]);
    });

    test("somebody who is not a member of the project is refused", async () => {
      connectToOrganization({ defaultWorkspaceId: EAST.id });

      const response: ProbeResponse = await setDefault(
        { workspaceId: WEST.id },
        headers({
          permissions: [Permission.ProjectOwner],
          memberOf: ObjectID.generate(),
        }),
      );

      expect(response.status).toBe(422);
      expect(stored().miscData["defaultWorkspaceId"]).toBe(EAST.id);
    });

    test("an anonymous caller is told to sign in", async () => {
      connectToOrganization({ defaultWorkspaceId: EAST.id });

      const response: ProbeResponse = await setDefault(
        { workspaceId: WEST.id },
        { tenantid: projectId.toString() },
      );

      expect(response.status).toBe(401);
      expect(stored().miscData["defaultWorkspaceId"]).toBe(EAST.id);
    });

    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ])(
      "%s may make another workspace the default",
      async (permission: Permission) => {
        connectToOrganization({ defaultWorkspaceId: EAST.id });

        const response: ProbeResponse = await setDefault(
          { workspaceId: WEST.id },
          headers({ permissions: [permission] }),
        );

        expect(response.status).toBe(200);
        expect(stored().miscData["defaultWorkspaceId"]).toBe(WEST.id);
      },
    );

    test("a workspace OneUptime was added to: kept as the default, and the answer lists it first", async () => {
      connectToOrganization({ defaultWorkspaceId: EAST.id });

      const response: ProbeResponse = await setDefault({
        workspaceId: WEST.id,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        isOrganization: true,
        isInOrganization: true,
        organizationName: ORG_NAME,
        workspaces: [WEST, EAST, LAB],
        defaultWorkspaceId: WEST.id,
        removedWorkspaces: [],
      });
      // Only the default changed: the workspaces and everything else as they were.
      expect(stored().miscData).toMatchObject({
        defaultWorkspaceId: WEST.id,
        workspaces: [EAST, LAB, WEST],
        isEnterpriseInstall: true,
        botUserId: "U0ONEUPTIMEBOT",
      });
      expect(slack.calls).toEqual([]);

      // Read back, as Project Settings does next.
      const read: ProbeResponse = await request({
        method: "GET",
        path: "/api/slack/workspaces",
      });
      expect((read.body as JSONObject)["defaultWorkspaceId"]).toBe(WEST.id);
    });

    test("a workspace an admin added OneUptime to since Slack listed them: listed again, once, and made the default", async () => {
      connectToOrganization({
        workspaces: [EAST, WEST],
        defaultWorkspaceId: EAST.id,
      });
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, LAB, WEST]);

      const response: ProbeResponse = await setDefault({ workspaceId: LAB.id });

      expect(response.status).toBe(200);
      expect(tokensOf("auth.teams.list")).toEqual([ORG_TOKEN]);
      expect(response.body).toMatchObject({
        workspaces: [LAB, EAST, WEST],
        defaultWorkspaceId: LAB.id,
      });
      expect(stored().miscData["defaultWorkspaceId"]).toBe(LAB.id);
    });

    test("a workspace OneUptime is not added to, even listed again: refused, and the default stays", async () => {
      connectToOrganization({
        workspaces: [EAST, WEST],
        defaultWorkspaceId: EAST.id,
      });
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST]);

      const response: ProbeResponse = await setDefault({
        workspaceId: "T0SOMEWHEREELSE",
      });

      expect(response.status).toBe(400);
      expect((response.body as JSONObject)["message"]).toBe(
        "OneUptime is not added to this Slack workspace. Add it to the workspace in Slack's organization settings first.",
      );
      // Asked once, no more.
      expect(tokensOf("auth.teams.list")).toEqual([ORG_TOKEN]);
      expect(stored().miscData["defaultWorkspaceId"]).toBe(EAST.id);
    });

    test.each([
      ["no workspace", {}],
      ["an empty one", { workspaceId: "" }],
      ["only spaces", { workspaceId: "   " }],
      ["not text", { workspaceId: { id: WEST.id } }],
      ["a number", { workspaceId: 42 }],
    ])(
      "%s: told to choose one, and nothing changes",
      async (_label: string, body: JSONObject) => {
        connectToOrganization({ defaultWorkspaceId: EAST.id });

        const response: ProbeResponse = await setDefault(body);

        expect(response.status).toBe(400);
        expect((response.body as JSONObject)["message"]).toBe(
          "Choose a Slack workspace.",
        );
        expect(stored().miscData["defaultWorkspaceId"]).toBe(EAST.id);
        expect(connections.writes).toEqual([]);
      },
    );

    test("an id with spaces around it is the id", async () => {
      connectToOrganization({ defaultWorkspaceId: EAST.id });

      const response: ProbeResponse = await setDefault({
        workspaceId: `  ${WEST.id}  `,
      });

      expect(response.status).toBe(200);
      expect(stored().miscData["defaultWorkspaceId"]).toBe(WEST.id);
    });

    test("a project connected to one workspace has no default workspace to set", async () => {
      connectToEast({
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
        enterpriseId: ORG_ID,
      });

      const response: ProbeResponse = await setDefault({
        workspaceId: WEST.id,
      });

      expect(response.status).toBe(400);
      expect((response.body as JSONObject)["message"]).toBe(
        "This project is connected to one Slack workspace. A default workspace is for OneUptime installed for a whole Slack Enterprise organization.",
      );
      expect(stored().miscData["defaultWorkspaceId"]).toBeUndefined();
      expect(connections.writes).toEqual([]);
    });

    test("a project not connected to Slack is told so", async () => {
      const response: ProbeResponse = await setDefault({
        workspaceId: WEST.id,
      });

      expect(response.status).toBe(400);
      expect((response.body as JSONObject)["message"]).toBe(NOT_CONNECTED);
    });

    test("another project's connection is never touched", async () => {
      const otherProjectId: ObjectID = ObjectID.generate();
      connections.add({
        projectId: otherProjectId,
        workspaceProjectId: ORG_ID,
        authToken: ORG_TOKEN,
        miscData: {
          isEnterpriseInstall: true,
          enterpriseId: ORG_ID,
          workspaces: [EAST, WEST],
          workspacesReadAt: minutesAgo(1),
          defaultWorkspaceId: EAST.id,
        },
      });
      connectToOrganization({ defaultWorkspaceId: EAST.id });

      const response: ProbeResponse = await setDefault({
        workspaceId: WEST.id,
      });

      expect(response.status).toBe(200);
      expect(stored().miscData["defaultWorkspaceId"]).toBe(WEST.id);
      expect(
        connections.slackOf(otherProjectId)!.miscData["defaultWorkspaceId"],
      ).toBe(EAST.id);
    });
  });

  describe("GET /slack/channels", () => {
    function getChannels(
      requestHeaders?: Record<string, string>,
    ): Promise<ProbeResponse> {
      return request({
        method: "GET",
        path: "/api/slack/channels",
        headers: requestHeaders,
      });
    }

    beforeEach(() => {
      slack.channelsOfTeam.set(EAST.id, [
        { id: "C0EASTOPS", name: "ops" },
        { id: "C0EASTGENERAL", name: "general" },
      ]);
      slack.channelsOfTeam.set(WEST.id, [
        { id: "C0WESTOPS", name: "ops" },
        { id: "C0WESTALERTS", name: "alerts" },
      ]);
      slack.channelsOfTeam.set(LAB.id, []);
      // A workspace's own token, which names no workspace.
      slack.channelsOfTeam.set("", [
        { id: "C0EASTOPS", name: "ops" },
        { id: "C0EASTGENERAL", name: "general" },
      ]);
    });

    test("the organization's: every workspace's channels, by name and then by workspace, each saying its workspace", async () => {
      connectToOrganization({ defaultWorkspaceId: EAST.id });

      const response: ProbeResponse = await getChannels();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        channels: [
          {
            id: "C0WESTALERTS",
            name: "alerts",
            teamId: WEST.id,
            workspaceName: WEST.name,
          },
          {
            id: "C0EASTGENERAL",
            name: "general",
            teamId: EAST.id,
            workspaceName: EAST.name,
          },
          {
            id: "C0EASTOPS",
            name: "ops",
            teamId: EAST.id,
            workspaceName: EAST.name,
          },
          {
            id: "C0WESTOPS",
            name: "ops",
            teamId: WEST.id,
            workspaceName: WEST.name,
          },
        ],
        organizationName: ORG_NAME,
      });
    });

    test("each workspace is listed with the organization's token and its own team_id - the default first", async () => {
      connectToOrganization({ defaultWorkspaceId: WEST.id });

      await getChannels();

      const listings: Array<SlackCall> = slack.callsOf("conversations.list");

      expect(
        listings.map((call: SlackCall): unknown => {
          return call.data["team_id"];
        }),
      ).toEqual([WEST.id, EAST.id, LAB.id]);
      expect(
        listings.every((call: SlackCall): boolean => {
          return call.token === ORG_TOKEN;
        }),
      ).toBe(true);
    });

    test("the channels are kept by name, with their workspace - the default workspace's where names meet", async () => {
      connectToOrganization({ defaultWorkspaceId: WEST.id });

      await getChannels();

      const cache: JSONObject = stored().miscData["channelCache"] as JSONObject;

      expect(Object.keys(cache).sort()).toEqual(["alerts", "general", "ops"]);
      expect(cache["ops"]).toMatchObject({
        id: "C0WESTOPS",
        name: "ops",
        teamId: WEST.id,
      });
      expect(cache["general"]).toMatchObject({
        id: "C0EASTGENERAL",
        teamId: EAST.id,
      });
      // The connection is still the organization's.
      expect(stored().workspaceProjectId).toBe(ORG_ID);
    });

    test("a workspace Slack will not list - OneUptime removed from it since - leaves the others' channels", async () => {
      connectToOrganization({ defaultWorkspaceId: EAST.id });
      slack.channelsOfTeam.delete(WEST.id);

      const response: ProbeResponse = await getChannels();

      expect(response.status).toBe(200);
      expect(
        ((response.body as JSONObject)["channels"] as Array<JSONObject>).map(
          (channel: JSONObject): unknown => {
            return channel["id"];
          },
        ),
      ).toEqual(["C0EASTGENERAL", "C0EASTOPS"]);
    });

    test("no workspace Slack will list: what Slack refused with", async () => {
      connectToOrganization({ defaultWorkspaceId: EAST.id });
      slack.channelsOfTeam.delete(EAST.id);
      slack.channelsOfTeam.delete(WEST.id);
      slack.channelsOfTeam.delete(LAB.id);

      const response: ProbeResponse = await getChannels();

      expect(response.status).toBe(400);
      expect((response.body as JSONObject)["message"]).toContain(
        "team_not_found",
      );
    });

    test("one workspace's: its channels as always - no team_id, no workspace names, no organization", async () => {
      connectToEast();

      const response: ProbeResponse = await getChannels();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        channels: [
          { id: "C0EASTGENERAL", name: "general" },
          { id: "C0EASTOPS", name: "ops" },
        ],
      });
      expect(
        slack.callsOf("conversations.list").map((call: SlackCall): unknown => {
          return call.data["team_id"];
        }),
      ).toEqual([undefined]);
      // Nothing asked of Slack about any organization.
      expect(slack.callsOf("auth.teams.list")).toEqual([]);
      expect(slack.callsOf("auth.test")).toEqual([]);
    });

    test("a project not connected to Slack is told so", async () => {
      const response: ProbeResponse = await getChannels();

      expect(response.status).toBe(400);
      expect((response.body as JSONObject)["message"]).toBe(NOT_CONNECTED);
    });

    test("somebody who is not a member of the project is refused, and Slack is not asked", async () => {
      connectToOrganization();

      const response: ProbeResponse = await getChannels(
        headers({ memberOf: ObjectID.generate() }),
      );

      expect(response.status).toBe(422);
      expect(slack.calls).toEqual([]);
    });
  });
});
