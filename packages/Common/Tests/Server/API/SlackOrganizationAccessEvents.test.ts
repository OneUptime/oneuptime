import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SlackOrganizationWorkspace } from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import SlackOrganization, {
  SlackOrganizationConnection,
} from "../../../Server/Utils/Workspace/Slack/SlackOrganization";
import {
  httpRequest,
  ProbeResponse,
  RunningApp,
  startApp,
} from "./WorkspaceOAuthTestHelpers";
import {
  EAST,
  FakeSlack,
  InMemorySlackConnections,
  LAB,
  ORG_ID,
  ORG_NAME,
  ORG_TOKEN,
  OTHER_ORG_ID,
  OTHER_ORG_WORKSPACE_ID,
  SlackCall,
  StoredSlackConnection,
  SlackWorkspaceRow,
  WEST,
} from "./SlackOrganizationTestHelpers";

/*
 * SLACK TELLING AN ORGANIZATION'S INSTALLATION THAT ITS WORKSPACES CHANGED
 * (#6748).
 *
 * OneUptime installed for a whole Slack Enterprise organization works in
 * the workspaces an admin added it to, as Slack lists them
 * (auth.teams.list), read again when they are needed and more than 10
 * minutes old. Slack tells such an app at once when an admin adds it to
 * workspaces (team_access_granted) or removes it (team_access_revoked), on
 * the events route, once its manifest subscribes to them. Each project
 * connected to that organization then reads its workspaces again: one
 * OneUptime was added to is listed, one it was removed from is kept among
 * the removed by the name it had, and a default it was removed from moves
 * to the first workspace left by name, for good. Projects connected to
 * another organization, or to one workspace of this one, are left alone.
 *
 * Through the real SlackAPI router and the real SlackOrganization and
 * WorkspaceProjectAuthTokenService, on an in-memory table of connections,
 * against a recorded Slack. Each connection has its own token, so the
 * tokens Slack was asked with say which projects read their workspaces.
 */

jest.mock("../../../Server/Middleware/SlackAuthorization", () => {
  return {
    __esModule: true,
    default: {
      // The signature check has its own tests; these drive what follows it.
      isAuthorizedSlackRequest: (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): void => {
        next();
      },
    },
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("./WorkspaceOAuthTestHelpers") as {
        createInMemoryGlobalCache: () => unknown;
      }
    ).createInMemoryGlobalCache(),
  };
});

const STAGING_TOKEN: string = "xoxb-acme-organization-staging";
const GLOBEX_TOKEN: string = "xoxb-globex-organization";
const EAST_TOKEN: string = "xoxb-acme-east";

const GLOBEX_HQ: SlackWorkspaceRow = {
  id: OTHER_ORG_WORKSPACE_ID,
  name: "Globex HQ",
};

function minutesAgo(minutes: number): string {
  return OneUptimeDate.toString(
    OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), -minutes),
  );
}

/*
 * What Slack posts to an organization-wide app: the organization in the
 * envelope and in authorizations[0] - whose team_id is null for the
 * organization's installation - and the workspaces in the event's team_ids.
 */
function accessEvent(data: {
  type: "team_access_granted" | "team_access_revoked";
  teamIds: Array<string>;
  enterpriseId?: string | undefined;
}): JSONObject {
  const enterpriseId: string | null =
    data.enterpriseId === undefined ? ORG_ID : data.enterpriseId || null;

  return {
    token: "verification-token",
    team_id: null,
    enterprise_id: enterpriseId,
    api_app_id: "A0ONEUPTIME",
    event: {
      type: data.type,
      team_ids: data.teamIds,
      event_ts: "1762850000.000100",
    },
    type: "event_callback",
    event_id: "Ev0ACCESS42",
    event_time: 1762850000,
    authorizations: [
      {
        enterprise_id: enterpriseId,
        team_id: null,
        user_id: "U0ONEUPTIMEBOT",
        is_bot: true,
        is_enterprise_install: true,
      },
    ],
    is_ext_shared_channel: false,
  };
}

describe("an admin adding OneUptime to a workspace of the organization, or removing it, over POST /slack/events", () => {
  let app: RunningApp;
  let connections: InMemorySlackConnections;
  let slack: FakeSlack;
  // Each read again the route started, to wait for after its 200.
  let refreshes: Array<Promise<Array<ObjectID>>>;
  // Holds each read again back until it is opened, when set.
  let gate: Promise<void> | null;

  const EVERYWHERE: ObjectID = new ObjectID(
    "e5000000-0000-4000-8000-000000000001",
  );
  const STAGING: ObjectID = new ObjectID(
    "e5000000-0000-4000-8000-000000000002",
  );
  const GLOBEX: ObjectID = new ObjectID("e5000000-0000-4000-8000-000000000003");
  const EAST_OPS: ObjectID = new ObjectID(
    "e5000000-0000-4000-8000-000000000004",
  );

  beforeAll(async () => {
    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;

    app = await startApp([new SlackAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    connections = new InMemorySlackConnections();
    connections.install();

    slack = new FakeSlack();
    slack.install();

    refreshes = [];
    gate = null;

    const refreshOrganization: typeof SlackOrganization.refreshOrganization =
      SlackOrganization.refreshOrganization.bind(SlackOrganization);

    jest
      .spyOn(SlackOrganization, "refreshOrganization")
      .mockImplementation((data: { enterpriseId: string | undefined }) => {
        const refresh: Promise<Array<ObjectID>> = (async (): Promise<
          Array<ObjectID>
        > => {
          if (gate) {
            await gate;
          }

          return await refreshOrganization(data);
        })();

        refreshes.push(refresh);

        return refresh;
      });

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

  function connectToOrganization(data: {
    projectId: ObjectID;
    authToken?: string | undefined;
    miscData?: JSONObject | undefined;
  }): StoredSlackConnection {
    return connections.add({
      projectId: data.projectId,
      workspaceProjectId: ORG_ID,
      authToken: data.authToken || ORG_TOKEN,
      miscData: {
        teamId: ORG_ID,
        teamName: ORG_NAME,
        botUserId: "U0ONEUPTIMEBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
        isEnterpriseInstall: true,
        workspaces: [EAST, WEST],
        // Read a minute ago: without the event, not read again for nine more.
        workspacesReadAt: minutesAgo(1),
        defaultWorkspaceId: EAST.id,
        ...(data.miscData || {}),
      },
    });
  }

  function deliver(
    payload: JSONObject,
    headers?: Record<string, string> | undefined,
  ): Promise<ProbeResponse> {
    return httpRequest({
      port: app.port,
      method: "POST",
      path: "/api/slack/events",
      body: payload,
      headers: headers,
      timeoutMs: 20000,
    });
  }

  // Waits for every read again the route started.
  async function settled(): Promise<Array<Array<ObjectID>>> {
    for (let attempt: number = 0; attempt < 400; attempt++) {
      if (refreshes.length > 0) {
        break;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 5);
      });
    }

    expect(refreshes.length).toBeGreaterThan(0);

    return await Promise.all(refreshes);
  }

  function organizationOf(
    projectId: ObjectID,
  ): SlackOrganizationConnection | null {
    return SlackOrganization.readConnection(
      connections.slackOf(projectId) as never,
    );
  }

  function idsOf(workspaces: Array<SlackOrganizationWorkspace>): Array<string> {
    return workspaces.map((workspace: SlackOrganizationWorkspace): string => {
      return workspace.id;
    });
  }

  function tokensOf(method: string): Array<string> {
    return slack.callsOf(method).map((call: SlackCall): string => {
      return call.token;
    });
  }

  function projectIdsOf(refreshed: Array<Array<ObjectID>>): Array<string> {
    return refreshed.flat().map((projectId: ObjectID): string => {
      return projectId.toString();
    });
  }

  test("team_access_granted: the workspace OneUptime was added to is listed at once - though the list was read a minute ago - and Slack has its 200 first", async () => {
    connectToOrganization({ projectId: EVERYWHERE });
    slack.workspacesOfToken.set(ORG_TOKEN, [EAST, LAB, WEST]);

    let open: () => void = (): void => {};
    gate = new Promise<void>((resolve: () => void) => {
      open = resolve;
    });

    const response: ProbeResponse = await deliver(
      accessEvent({ type: "team_access_granted", teamIds: [LAB.id] }),
    );

    // Answered before Slack was asked anything, or anything was stored.
    expect(response.status).toBe(200);
    expect(response.body).toBe("ok");
    expect(slack.calls).toEqual([]);
    expect(connections.writes).toEqual([]);

    open();

    expect(projectIdsOf(await settled())).toEqual([EVERYWHERE.toString()]);

    expect(tokensOf("auth.teams.list")).toEqual([ORG_TOKEN]);

    const organization: SlackOrganizationConnection =
      organizationOf(EVERYWHERE)!;

    expect(idsOf(organization.workspaces)).toEqual([EAST.id, LAB.id, WEST.id]);
    expect(organization.defaultWorkspaceId).toBe(EAST.id);
    expect(organization.removedWorkspaces).toEqual([]);
    expect(SlackOrganization.isFresh(organization)).toBe(true);
  });

  test("team_access_revoked: the workspace is listed no more and kept by its name; the default it was moves to the first left by name, and the channels cached as other workspaces' are looked up again", async () => {
    connectToOrganization({
      projectId: EVERYWHERE,
      miscData: {
        workspaces: [EAST, LAB, WEST],
        channelCache: {
          "inc-42-checkout": {
            id: "C0EASTINC42",
            name: "inc-42-checkout",
            lastUpdated: "2026-11-10T10:00:00.000Z",
            teamId: EAST.id,
          },
          "lab-alerts": {
            id: "C0LABALERTS",
            name: "lab-alerts",
            lastUpdated: "2026-11-10T10:00:00.000Z",
            teamId: LAB.id,
          },
          "west-ops": {
            id: "C0WESTOPS",
            name: "west-ops",
            lastUpdated: "2026-11-10T10:00:00.000Z",
            teamId: WEST.id,
          },
          // Typed into the channel list by hand: no workspace, kept.
          general: {
            id: "C0GENERAL",
            name: "general",
            lastUpdated: "2026-11-10T10:00:00.000Z",
          },
        },
      },
    });
    slack.workspacesOfToken.set(ORG_TOKEN, [WEST, LAB]);

    const response: ProbeResponse = await deliver(
      accessEvent({ type: "team_access_revoked", teamIds: [EAST.id] }),
    );

    expect(response.status).toBe(200);
    await settled();

    const stored: JSONObject = connections.slackOf(EVERYWHERE)!.miscData;
    const organization: SlackOrganizationConnection =
      organizationOf(EVERYWHERE)!;

    // "Acme Lab" before "Acme West".
    expect(stored["defaultWorkspaceId"]).toBe(LAB.id);
    expect(organization.defaultWorkspaceId).toBe(LAB.id);
    expect(idsOf(organization.workspaces)).toEqual([LAB.id, WEST.id]);
    expect(organization.removedWorkspaces).toEqual([EAST]);
    expect(Object.keys(stored["channelCache"] as JSONObject).sort()).toEqual([
      "general",
      "lab-alerts",
    ]);

    // Added to Acme East again later: listed again, and the default stays.
    refreshes = [];
    slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST, LAB]);

    await deliver(
      accessEvent({ type: "team_access_granted", teamIds: [EAST.id] }),
    );
    await settled();

    const again: SlackOrganizationConnection = organizationOf(EVERYWHERE)!;

    expect(again.defaultWorkspaceId).toBe(LAB.id);
    expect(idsOf(again.workspaces)).toEqual([LAB.id, EAST.id, WEST.id]);
    expect(again.removedWorkspaces).toEqual([]);
  });

  test("team_access_revoked for a workspace that is not the default: the default and the cached channels stay", async () => {
    connectToOrganization({
      projectId: EVERYWHERE,
      miscData: {
        workspaces: [EAST, LAB, WEST],
        channelCache: {
          "west-ops": {
            id: "C0WESTOPS",
            name: "west-ops",
            lastUpdated: "2026-11-10T10:00:00.000Z",
            teamId: WEST.id,
          },
        },
      },
    });
    slack.workspacesOfToken.set(ORG_TOKEN, [EAST, LAB]);

    await deliver(
      accessEvent({ type: "team_access_revoked", teamIds: [WEST.id] }),
    );
    await settled();

    const stored: JSONObject = connections.slackOf(EVERYWHERE)!.miscData;

    expect(stored["defaultWorkspaceId"]).toBe(EAST.id);
    expect(Object.keys(stored["channelCache"] as JSONObject)).toEqual([
      "west-ops",
    ]);
    expect(organizationOf(EVERYWHERE)!.removedWorkspaces).toEqual([WEST]);
  });

  test("every project connected to the organization reads its workspaces again, each with its own token; one connected to another organization, or to one workspace of this one, is left alone", async () => {
    connectToOrganization({ projectId: EVERYWHERE });
    connectToOrganization({ projectId: STAGING, authToken: STAGING_TOKEN });

    const globex: StoredSlackConnection = connections.add({
      projectId: GLOBEX,
      workspaceProjectId: OTHER_ORG_ID,
      authToken: GLOBEX_TOKEN,
      miscData: {
        teamId: OTHER_ORG_ID,
        teamName: "Globex",
        enterpriseId: OTHER_ORG_ID,
        enterpriseName: "Globex",
        isEnterpriseInstall: true,
        workspaces: [GLOBEX_HQ],
        workspacesReadAt: minutesAgo(1),
      },
    });

    const eastOps: StoredSlackConnection = connections.add({
      projectId: EAST_OPS,
      workspaceProjectId: EAST.id,
      authToken: EAST_TOKEN,
      miscData: {
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
      },
    });

    const globexBefore: JSONObject = JSON.parse(
      JSON.stringify(globex.miscData),
    ) as JSONObject;
    const eastOpsBefore: JSONObject = JSON.parse(
      JSON.stringify(eastOps.miscData),
    ) as JSONObject;

    // Had either of the others been asked, it would have had an answer.
    slack.workspacesOfToken.set(ORG_TOKEN, [EAST, LAB, WEST]);
    slack.workspacesOfToken.set(STAGING_TOKEN, [EAST, LAB, WEST]);
    slack.workspacesOfToken.set(GLOBEX_TOKEN, []);
    slack.workspacesOfToken.set(EAST_TOKEN, []);

    await deliver(
      accessEvent({ type: "team_access_granted", teamIds: [LAB.id] }),
    );

    expect(projectIdsOf(await settled())).toEqual([
      EVERYWHERE.toString(),
      STAGING.toString(),
    ]);

    expect(tokensOf("auth.teams.list")).toEqual([ORG_TOKEN, STAGING_TOKEN]);
    expect(idsOf(organizationOf(EVERYWHERE)!.workspaces)).toContain(LAB.id);
    expect(idsOf(organizationOf(STAGING)!.workspaces)).toContain(LAB.id);

    expect(connections.slackOf(GLOBEX)!.miscData).toEqual(globexBefore);
    expect(connections.slackOf(EAST_OPS)!.miscData).toEqual(eastOpsBefore);
    expect(connections.writes).toHaveLength(2);
  });

  test("Slack's retry is read again too: it may be the first this server hears of the change", async () => {
    connectToOrganization({ projectId: EVERYWHERE });
    slack.workspacesOfToken.set(ORG_TOKEN, [EAST, LAB, WEST]);

    const response: ProbeResponse = await deliver(
      accessEvent({ type: "team_access_granted", teamIds: [LAB.id] }),
      { "x-slack-retry-num": "1", "x-slack-retry-reason": "http_timeout" },
    );

    expect(response.status).toBe(200);
    expect(projectIdsOf(await settled())).toEqual([EVERYWHERE.toString()]);
    expect(idsOf(organizationOf(EVERYWHERE)!.workspaces)).toContain(LAB.id);
  });

  test("an event naming no organization: nothing is read or stored, and Slack has its 200", async () => {
    connectToOrganization({ projectId: EVERYWHERE });
    slack.workspacesOfToken.set(ORG_TOKEN, [EAST, LAB, WEST]);

    const response: ProbeResponse = await deliver(
      accessEvent({
        type: "team_access_revoked",
        teamIds: [EAST.id],
        enterpriseId: "",
      }),
    );

    expect(response.status).toBe(200);
    expect(projectIdsOf(await settled())).toEqual([]);
    expect(slack.calls).toEqual([]);
    expect(connections.writes).toEqual([]);
  });

  test("Slack not listing the workspaces: those listed last are kept, nothing is stored, and Slack has its 200", async () => {
    connectToOrganization({ projectId: EVERYWHERE });
    // No answer for the token: Slack refuses it (invalid_auth).

    const response: ProbeResponse = await deliver(
      accessEvent({ type: "team_access_revoked", teamIds: [WEST.id] }),
    );

    expect(response.status).toBe(200);
    await settled();

    expect(tokensOf("auth.teams.list")).toEqual([ORG_TOKEN]);
    expect(connections.writes).toEqual([]);
    expect(idsOf(organizationOf(EVERYWHERE)!.workspaces)).toEqual([
      EAST.id,
      WEST.id,
    ]);
  });
});
