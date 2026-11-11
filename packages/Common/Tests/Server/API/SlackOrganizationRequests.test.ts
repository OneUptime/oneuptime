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
import http from "http";
import { AddressInfo } from "net";
import express from "express";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Name from "../../../Types/Name";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { SlackOrganizationWorkspace } from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AIService from "../../../Server/Services/AIService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ObservabilityAssistant from "../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import logger from "../../../Server/Utils/Logger";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestRecord,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { useInMemoryWorkspaceHomeChoices } from "../../Helpers/InMemoryWorkspaceHomeChoices";
import {
  EAST,
  FakeSlack,
  InMemorySlackConnections,
  LAB,
  LONE_WORKSPACE_ID,
  ORG_ID,
  ORG_NAME,
  ORG_TOKEN,
  OTHER_ORG_ID,
  OTHER_ORG_WORKSPACE_ID,
  SlackCall,
  WEST,
} from "./SlackOrganizationTestHelpers";

/*
 * REQUESTS FROM THE WORKSPACES OF A SLACK ENTERPRISE ORGANIZATION.
 *
 * A project connected to a whole Slack Enterprise organization is stored
 * under the organization's id (E...), and Slack's requests come from its
 * workspaces (T...): a slash command names the workspace, the organization
 * and is_enterprise_install as text; an event names the installation in
 * authorizations[0] - its team_id null for the organization's - and the
 * workspace in team_id; a press names no team at all (team: null), the
 * person's team_id, and the organization (SlackRequestWorkspace).
 *
 * These post what Slack posts, through the real SlackAPI router, the real
 * authorization and project resolution (WorkspaceProjectResolution) and
 * the real handlers, on an in-memory table of connections read by the real
 * WorkspaceProjectAuthTokenService, and pin which project answered by the
 * token every request to Slack was made with: each connection has its own.
 * Only the reads of the project's records are stood in for.
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

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";

// Connected to the whole organization.
const EVERYWHERE: ObjectID = new ObjectID(
  "e3000000-0000-4000-8000-000000000001",
);
// Connected to the whole organization too, later: one Slack, two projects.
const STAGING: ObjectID = new ObjectID("e3000000-0000-4000-8000-000000000002");
const STAGING_TOKEN: string = "xoxb-acme-organization-staging";
// Connected to Acme East alone.
const EAST_OPS: ObjectID = new ObjectID("e3000000-0000-4000-8000-000000000003");
const EAST_TOKEN: string = "xoxb-acme-east";

const PROJECT_NAMES: Record<string, string> = {
  [EVERYWHERE.toString()]: "Acme Everywhere",
  [STAGING.toString()]: "Acme Staging",
  [EAST_OPS.toString()]: "Acme East Ops",
};

// Slack users of an Enterprise organization: one id in all its workspaces.
const ALICE: string = "W0ALICE";
const ALICE_ID: ObjectID = new ObjectID("e3000000-0000-4000-8000-0000000000a1");
const DEANE: string = "W0DEANE";
const DEANE_ID: ObjectID = new ObjectID("e3000000-0000-4000-8000-0000000000a2");
// Nobody connected this one.
const NOBODY: string = "W0NOBODY";

const OPS_CHANNEL_ID: string = "C0EASTOPS";
const TRIGGER_ID: string = "1762800000.trigger";
const COMMAND_RESPONSE_URL: string =
  "https://hooks.slack.com/commands/T0EAST/1762800000/cmdAbc123";
const CHOICE_RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0EAST/1762800001/choiceDef456";
const CHOICE_TRIGGER_ID: string = "1762800001.choice-trigger";
const HOME_TRIGGER_ID: string = "1762800002.home-trigger";

// Slack's own: a zero-width space around a bold span it draws.
const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

const NOT_CONNECTED: string =
  "This Slack workspace is not connected to a OneUptime project yet. A project admin can connect it in OneUptime under Project Settings → Workspace → Slack.";

interface RoutePort {
  port: number;
  close: () => Promise<void>;
}

interface RouteAnswer {
  status: number;
  body: JSONObject | null;
}

// Where a request was made, as Slack names it.
interface Origin {
  workspaceId: string;
  enterpriseId?: string | undefined;
  // Made for OneUptime's installation in the whole organization.
  isEnterpriseInstall: boolean;
}

// In Acme East, for the organization's installation.
const IN_EAST: Origin = {
  workspaceId: EAST.id,
  enterpriseId: ORG_ID,
  isEnterpriseInstall: true,
};

/*
 * The SlackAPI router on an app that reads bodies as the server does:
 * Slack posts commands and presses as forms, events as JSON.
 */
async function startSlackApp(): Promise<RoutePort> {
  const SlackAPI: { new (): { getRouter: () => express.Router } } = (
    (await import("../../../Server/API/SlackAPI")) as unknown as {
      default: { new (): { getRouter: () => express.Router } };
    }
  ).default;

  const app: express.Express = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use("/api", new SlackAPI().getRouter());

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function post(data: {
  port: number;
  path: string;
  contentType: string;
  body: string;
}): Promise<RouteAnswer> {
  return new Promise<RouteAnswer>(
    (
      resolve: (answer: RouteAnswer) => void,
      reject: (error: Error) => void,
    ) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: "POST",
          headers: {
            "content-type": data.contentType,
            "content-length": Buffer.byteLength(data.body),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = null;
            }

            resolve({ status: response.statusCode || 0, body: body });
          });
        },
      );

      request.setTimeout(20000, () => {
        request.destroy(new Error("no answer"));
      });
      request.on("error", reject);
      request.write(data.body);
      request.end();
    },
  );
}

/*
 * What Slack posts for /oneuptime <text>: the workspace it was run in, and
 * - from a workspace of an organization - the organization, and whether
 * for its installation, as text.
 */
function slashCommand(data: {
  text: string;
  slackUserId?: string | undefined;
  origin?: Origin | undefined;
}): Record<string, string> {
  const origin: Origin = data.origin || IN_EAST;

  const fields: Record<string, string> = {
    token: "verification-token",
    team_id: origin.workspaceId,
    team_domain: "acme",
    channel_id: OPS_CHANNEL_ID,
    channel_name: "ops",
    user_id: data.slackUserId || ALICE,
    user_name: "someone",
    command: "/oneuptime",
    text: data.text,
    api_app_id: "A0ONEUPTIME",
    is_enterprise_install: origin.isEnterpriseInstall ? "true" : "false",
    response_url: COMMAND_RESPONSE_URL,
    trigger_id: TRIGGER_ID,
  };

  if (origin.enterpriseId) {
    fields["enterprise_id"] = origin.enterpriseId;
    fields["enterprise_name"] = ORG_NAME;
  }

  return fields;
}

let eventNumber: number = 0;

/*
 * An event, as Slack delivers it to an organization's installation: the
 * installation in authorizations[0] - no workspace of its own - and the
 * workspace it happened in, in team_id.
 */
function eventCallback(event: JSONObject, origin: Origin): JSONObject {
  eventNumber++;

  const payload: JSONObject = {
    token: "verification-token",
    team_id: origin.workspaceId,
    api_app_id: "A0ONEUPTIME",
    event: event,
    type: "event_callback",
    event_id: `Ev0ORG${String(eventNumber).padStart(4, "0")}`,
    event_time: 1762800000 + eventNumber,
    authorizations: [
      {
        enterprise_id: origin.enterpriseId || null,
        team_id: origin.isEnterpriseInstall ? null : origin.workspaceId,
        user_id: "W0ONEUPTIMEBOT",
        is_bot: true,
        is_enterprise_install: origin.isEnterpriseInstall,
      },
    ],
    is_ext_shared_channel: false,
  };

  if (origin.enterpriseId) {
    payload["enterprise_id"] = origin.enterpriseId;
  }

  return payload;
}

function openHome(slackUserId: string, origin: Origin): JSONObject {
  return eventCallback(
    {
      type: "app_home_opened",
      user: slackUserId,
      channel: `D${slackUserId.substring(1)}`,
      tab: "home",
      event_ts: "1762800000.000100",
    },
    origin,
  );
}

/*
 * A press, as Slack posts it for an organization's installation: no team -
 * the person's team_id says theirs - and the organization.
 */
function pressFrom(data: {
  slackUserId: string;
  personWorkspaceId: string;
  origin: Origin;
  rest: JSONObject;
}): JSONObject {
  const payload: JSONObject = {
    type: "block_actions",
    user: {
      id: data.slackUserId,
      username: data.slackUserId.toLowerCase(),
      name: data.slackUserId.toLowerCase(),
      team_id: data.personWorkspaceId,
    },
    api_app_id: "A0ONEUPTIME",
    token: "verification-token",
    team: data.origin.isEnterpriseInstall
      ? null
      : { id: data.origin.workspaceId, domain: "acme" },
    enterprise: data.origin.enterpriseId
      ? { id: data.origin.enterpriseId, name: ORG_NAME }
      : null,
    is_enterprise_install: data.origin.isEnterpriseInstall,
    ...data.rest,
  };

  return payload;
}

// A button of the Home tab: Slack names the view, and no channel.
function homeButton(data: {
  slackUserId: string;
  personWorkspaceId: string;
  actionId: string;
  origin?: Origin | undefined;
}): JSONObject {
  return pressFrom({
    slackUserId: data.slackUserId,
    personWorkspaceId: data.personWorkspaceId,
    origin: data.origin || IN_EAST,
    rest: {
      container: { type: "view", view_id: "V0HOME" },
      view: {
        id: "V0HOME",
        type: "home",
        blocks: [],
        private_metadata: "",
        callback_id: "",
        state: { values: {} },
      },
      trigger_id: HOME_TRIGGER_ID,
      actions: [{ action_id: data.actionId, type: "button" }],
    },
  });
}

describe("requests from the workspaces of a Slack Enterprise organization", () => {
  let app: RoutePort;
  let connections: InMemorySlackConnections;
  let slack: FakeSlack;
  // Who connected their Slack account in which project.
  let links: Array<{
    slackUserId: string;
    projectId: ObjectID;
    userId: ObjectID;
  }>;
  let assistantProjects: Array<string>;
  let errorLines: Array<string>;

  beforeAll(async () => {
    app = await startSlackApp();
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    connections = new InMemorySlackConnections();
    connections.install();

    slack = new FakeSlack();
    slack.answers.set("views.publish", (): JSONObject => {
      return {
        ok: true,
        view: { id: "V0HOME", type: "home", hash: "1762800000.000001" },
      };
    });
    slack.install();

    useInMemoryWorkspaceHomeChoices();

    links = [{ slackUserId: ALICE, projectId: EVERYWHERE, userId: ALICE_ID }];
    assistantProjects = [];
    errorLines = [];

    function linksOf(slackUserId: string): Array<WorkspaceUserAuthToken> {
      return links
        .filter((link: { slackUserId: string }): boolean => {
          return link.slackUserId === slackUserId;
        })
        .map((link: { projectId: ObjectID; userId: ObjectID }) => {
          const row: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
          row.projectId = link.projectId;
          row.userId = link.userId;
          row.authToken = "xoxp-user-token";
          return row;
        });
    }

    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockImplementation((async (options: {
        query: { workspaceUserId: string; projectId?: ObjectID };
      }) => {
        return (
          linksOf(options.query.workspaceUserId).find(
            (row: WorkspaceUserAuthToken): boolean => {
              return (
                !options.query.projectId ||
                row.projectId!.toString() === options.query.projectId.toString()
              );
            },
          ) || null
        );
      }) as never);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async (options: {
        query: { workspaceUserId: string };
      }) => {
        return linksOf(options.query.workspaceUserId);
      }) as never);

    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockResolvedValue(true);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          return { userId: data.userId, tenantId: data.projectId };
        },
      );
    // The permission check itself has its own tests.
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          return { userId: data.userId, tenantId: data.projectId };
        },
      );
    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockResolvedValue([] as never);

    // No record owns the channel, and no project has posted in it.
    for (const service of [
      IncidentService,
      AlertService,
      IncidentEpisodeService,
      AlertEpisodeService,
      ScheduledMaintenanceService,
      MonitorService,
      OnCallDutyPolicyService,
    ] as unknown as Array<{
      findBy: () => Promise<unknown>;
      findOneBy: () => Promise<unknown>;
    }>) {
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);
      jest.spyOn(service, "findOneBy").mockResolvedValue(null as never);
    }
    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockResolvedValue(null);

    // What the Home reads.
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([ObjectID.generate()]);
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([ObjectID.generate()]);
    jest.spyOn(OnCallDutyPolicyScheduleService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation((async (options: { id: ObjectID }) => {
        const project: Project = new Project();
        project.id = options.id;
        project.name = PROJECT_NAMES[options.id.toString()] || "";
        return project;
      }) as never);
    jest.spyOn(ProjectService, "findBy").mockImplementation((async () => {
      return Object.keys(PROJECT_NAMES).map((id: string): Project => {
        const project: Project = new Project();
        project.id = new ObjectID(id);
        project.name = PROJECT_NAMES[id]!;
        return project;
      });
    }) as never);
    jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
      const user: User = new User();
      user.name = new Name("Alice Admin");
      return user;
    }) as never);

    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("OneUptime");

    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null);
    // No AI credits used up: with billing on, as CI runs Common, the real check reads Postgres.
    jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockImplementation((async (data: { projectId: ObjectID }) => {
        assistantProjects.push(data.projectId.toString());
        return {
          contentInMarkdown: "Two monitors are down: **API** and **Checkout**.",
          citations: [],
          totalTokens: 10,
          llmCallCount: 1,
          toolCallCount: 1,
        };
      }) as never);

    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(logger, "error").mockImplementation(((line: unknown) => {
      errorLines.push(String(line));
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The project of the whole organization, as its install stored it.
  function connectEverywhere(): void {
    connections.add({
      projectId: EVERYWHERE,
      workspaceProjectId: ORG_ID,
      authToken: ORG_TOKEN,
      miscData: {
        teamId: ORG_ID,
        teamName: ORG_NAME,
        botUserId: "W0ONEUPTIMEBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
        isEnterpriseInstall: true,
        workspaces: [EAST, LAB, WEST],
        workspacesReadAt: new Date().toISOString(),
        defaultWorkspaceId: EAST.id,
      },
    });
  }

  function connectStaging(): void {
    connections.add({
      projectId: STAGING,
      workspaceProjectId: ORG_ID,
      authToken: STAGING_TOKEN,
      miscData: {
        teamId: ORG_ID,
        teamName: ORG_NAME,
        botUserId: "W0ONEUPTIMEBOT",
        enterpriseId: ORG_ID,
        isEnterpriseInstall: true,
        workspaces: [EAST, WEST],
        workspacesReadAt: new Date().toISOString(),
      },
    });
  }

  function connectEastOps(): void {
    connections.add({
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
  }

  function command(fields: Record<string, string>): Promise<RouteAnswer> {
    return post({
      port: app.port,
      path: "/api/slack/command",
      contentType: "application/x-www-form-urlencoded",
      body: new globalThis.URLSearchParams(fields).toString(),
    });
  }

  function deliverEvent(payload: JSONObject): Promise<RouteAnswer> {
    return post({
      port: app.port,
      path: "/api/slack/events",
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  }

  function press(payload: JSONObject): Promise<RouteAnswer> {
    return post({
      port: app.port,
      path: "/api/slack/interactive",
      contentType: "application/x-www-form-urlencoded",
      body: new globalThis.URLSearchParams({
        payload: JSON.stringify(payload),
      }).toString(),
    });
  }

  async function until(
    condition: () => boolean,
    what: string,
    attempts: number = 400,
  ): Promise<void> {
    for (let attempt: number = 0; attempt < attempts; attempt++) {
      if (condition()) {
        return;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 10);
      });
    }

    throw new Error(
      `Waited in vain for ${what}. Slack was asked: ${JSON.stringify(
        slack.calls.map((call: SlackCall): string => {
          return call.method;
        }),
      )}; errors: ${JSON.stringify(errorLines)}`,
    );
  }

  // Gives what OneUptime does after its 200 the time to do it.
  async function settle(): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 150);
    });
  }

  function opened(): Array<SlackCall> {
    return slack.callsOf("views.open");
  }

  function authorizedProjects(): Array<string> {
    return (
      WorkspaceActionAuthorization.authorize as unknown as {
        mock: {
          calls: Array<Array<{ projectId: ObjectID; userId: ObjectID }>>;
        };
      }
    ).mock.calls.map(
      (call: Array<{ projectId: ObjectID; userId: ObjectID }>): string => {
        return `${call[0]!.projectId.toString()} as ${call[0]!.userId.toString()}`;
      },
    );
  }

  function inputValue(view: JSONObject, actionId: string): unknown {
    const block: JSONObject | undefined = (
      view["blocks"] as Array<JSONObject>
    ).find((candidate: JSONObject): boolean => {
      return (
        (candidate["element"] as JSONObject | undefined)?.["action_id"] ===
        actionId
      );
    });

    return (block?.["element"] as JSONObject | undefined)?.["initial_value"];
  }

  // The buttons of the question of which project, as Slack was sent them.
  function offeredButtons(): Array<{
    title: string;
    actionId: string;
    value: string;
  }> {
    for (const call of [...slack.calls].reverse()) {
      const blocks: unknown =
        call.data["blocks"] ||
        (call.data["view"] as JSONObject | undefined)?.["blocks"];

      if (!Array.isArray(blocks)) {
        continue;
      }

      const buttons: Array<JSONObject> = (blocks as Array<JSONObject>)
        .filter((block: JSONObject): boolean => {
          return block["type"] === "actions";
        })
        .flatMap((block: JSONObject): Array<JSONObject> => {
          return block["elements"] as Array<JSONObject>;
        })
        .filter((element: JSONObject): boolean => {
          return String(element["action_id"] || "").startsWith("ChooseProject");
        });

      if (buttons.length > 0) {
        return buttons.map((button: JSONObject) => {
          return {
            title: String((button["text"] as JSONObject)["text"]),
            actionId: String(button["action_id"]),
            value: String(button["value"]),
          };
        });
      }
    }

    return [];
  }

  describe("a slash command", () => {
    beforeEach(() => {
      connectEverywhere();
    });

    test("/oneuptime incident in Acme East, for the organization's installation: the organization's project's New Incident form, opened with the organization's token, as the member", async () => {
      const answer: RouteAnswer = await command(
        slashCommand({ text: "incident Checkout is down" }),
      );

      expect(answer.status).toBe(200);
      expect(answer.body).toBeNull();

      await until((): boolean => {
        return opened().length === 1;
      }, "the form opened");

      const open: SlackCall = opened()[0]!;
      expect(open.token).toBe(ORG_TOKEN);
      expect(open.data["trigger_id"]).toBe(TRIGGER_ID);

      const view: JSONObject = open.data["view"] as JSONObject;
      expect(view["callback_id"]).toBe("SubmitNewIncident");
      expect(inputValue(view, "incidentTitle")).toBe("Checkout is down");
      expect(authorizedProjects()).toEqual([
        `${EVERYWHERE.toString()} as ${ALICE_ID.toString()}`,
      ]);
    });

    test.each([
      ["Acme East", EAST],
      ["Acme West", WEST],
      ["Acme Lab", LAB],
    ])(
      "run in %s: the same project, by the one connection",
      async (_name: string, workspace: SlackOrganizationWorkspace) => {
        await command(
          slashCommand({
            text: "maintenance Database upgrade",
            origin: {
              workspaceId: workspace.id,
              enterpriseId: ORG_ID,
              isEnterpriseInstall: true,
            },
          }),
        );

        await until((): boolean => {
          return opened().length === 1;
        }, "the form opened");

        expect(opened()[0]!.token).toBe(ORG_TOKEN);
        expect((opened()[0]!.data["view"] as JSONObject)["callback_id"]).toBe(
          "SubmitNewScheduledMaintenance",
        );
        expect(authorizedProjects()).toEqual([
          `${EVERYWHERE.toString()} as ${ALICE_ID.toString()}`,
        ]);
      },
    );

    test("a command that does not say it is for the organization's installation still finds the organization's project: the workspace is read first, then its organization", async () => {
      await command(
        slashCommand({
          text: "incident Checkout is down",
          origin: {
            workspaceId: WEST.id,
            enterpriseId: ORG_ID,
            isEnterpriseInstall: false,
          },
        }),
      );

      await until((): boolean => {
        return opened().length === 1;
      }, "the form opened");

      expect(opened()[0]!.token).toBe(ORG_TOKEN);
    });

    test("/oneuptime ask in Acme West: answered by OneUptime AI in the organization's project, in the channel", async () => {
      const answer: RouteAnswer = await command(
        slashCommand({
          text: "ask which monitors are down?",
          origin: {
            workspaceId: WEST.id,
            enterpriseId: ORG_ID,
            isEnterpriseInstall: true,
          },
        }),
      );

      expect(answer.body).toEqual({
        response_type: "ephemeral",
        text: "On it… :hourglass_flowing_sand:",
      });

      await until((): boolean => {
        return slack.callsOf(COMMAND_RESPONSE_URL).length === 1;
      }, "the answer");

      expect(assistantProjects).toEqual([EVERYWHERE.toString()]);
      expect(slack.callsOf(COMMAND_RESPONSE_URL)[0]!.data).toEqual({
        response_type: "in_channel",
        text: `Two monitors are down: ${ZERO_WIDTH_SPACE}*API*${ZERO_WIDTH_SPACE} and ${ZERO_WIDTH_SPACE}*Checkout*${ZERO_WIDTH_SPACE}.\n`,
      });
    });

    test("somebody who has not connected their Slack account: asked to connect it in the organization's project - and taken back to the workspace's channel", async () => {
      await command(
        slashCommand({
          text: "incident Checkout is down",
          slackUserId: NOBODY,
        }),
      );

      await until((): boolean => {
        return slack.callsOf(COMMAND_RESPONSE_URL).length === 1;
      }, "the answer");

      expect(opened()).toEqual([]);

      const blocks: Array<JSONObject> = slack.callsOf(COMMAND_RESPONSE_URL)[0]!
        .data["blocks"] as Array<JSONObject>;
      const button: JSONObject = (
        blocks.find((block: JSONObject): boolean => {
          return block["type"] === "actions";
        })!["elements"] as Array<JSONObject>
      )[0]!;
      const connectUrl: globalThis.URL = new globalThis.URL(
        button["url"] as string,
      );

      expect(`${connectUrl.origin}${connectUrl.pathname}`).toBe(
        `${DASHBOARD_URL}/${EVERYWHERE.toString()}/user-settings/slack-integration`,
      );

      const request: WorkspaceConnectRequestRecord | null =
        await WorkspaceConnectRequest.peek(
          connectUrl.searchParams.get("connect"),
        );

      expect(request).toMatchObject({
        workspaceUserId: NOBODY,
        slack: {
          teamId: EAST.id,
          channelId: OPS_CHANNEL_ID,
          responseUrl: COMMAND_RESPONSE_URL,
        },
      });
    });

    test.each([
      [
        "a workspace of another organization",
        {
          workspaceId: OTHER_ORG_WORKSPACE_ID,
          enterpriseId: OTHER_ORG_ID,
          isEnterpriseInstall: true,
        },
      ],
      [
        "a workspace of no organization",
        { workspaceId: LONE_WORKSPACE_ID, isEnterpriseInstall: false },
      ],
      [
        "a workspace that names this organization's workspace but another organization",
        {
          workspaceId: EAST.id,
          enterpriseId: OTHER_ORG_ID,
          isEnterpriseInstall: true,
        },
      ],
    ])(
      "from %s: not connected, said so at once - nothing asked of Slack, nothing read in the project",
      async (_label: string, origin: Origin) => {
        const answer: RouteAnswer = await command(
          slashCommand({ text: "incident Checkout is down", origin: origin }),
        );

        expect(answer.status).toBe(200);
        expect((answer.body as JSONObject)["text"]).toBe(NOT_CONNECTED);

        await settle();

        expect(slack.calls).toEqual([]);
        expect(WorkspaceActionAuthorization.authorize).not.toHaveBeenCalled();
      },
    );
  });

  describe("an event", () => {
    beforeEach(() => {
      connectEverywhere();
    });

    test("the Home opened in Acme East, for the organization's installation: drawn for the person, in the organization's project, with its token", async () => {
      const answer: RouteAnswer = await deliverEvent(openHome(ALICE, IN_EAST));

      expect(answer.status).toBe(200);

      await until((): boolean => {
        return slack.callsOf("views.publish").length === 1;
      }, "the Home drawn");

      const publish: SlackCall = slack.callsOf("views.publish")[0]!;
      expect(publish.token).toBe(ORG_TOKEN);
      expect(publish.data["user_id"]).toBe(ALICE);
      expect(JSON.stringify(publish.data["view"])).toContain("Acme Everywhere");
    });

    test("opened in Acme West too: the same project", async () => {
      await deliverEvent(
        openHome(ALICE, {
          workspaceId: WEST.id,
          enterpriseId: ORG_ID,
          isEnterpriseInstall: true,
        }),
      );

      await until((): boolean => {
        return slack.callsOf("views.publish").length === 1;
      }, "the Home drawn");

      expect(slack.callsOf("views.publish")[0]!.token).toBe(ORG_TOKEN);
    });

    test("the Home opened in a workspace of another organization: nothing drawn, nothing asked of Slack", async () => {
      await deliverEvent(
        openHome(ALICE, {
          workspaceId: OTHER_ORG_WORKSPACE_ID,
          enterpriseId: OTHER_ORG_ID,
          isEnterpriseInstall: true,
        }),
      );

      await settle();

      expect(slack.calls).toEqual([]);
    });
  });

  describe("a press", () => {
    beforeEach(() => {
      connectEverywhere();
    });

    test("the Home's Declare incident, pressed by somebody of Acme West - team null, their own team_id: the New Incident form, opened with the organization's token", async () => {
      const answer: RouteAnswer = await press(
        homeButton({
          slackUserId: ALICE,
          personWorkspaceId: WEST.id,
          actionId: "/incident",
        }),
      );

      expect(answer.status).toBe(200);

      await until((): boolean => {
        return opened().length === 1;
      }, "the form opened");

      expect(opened()[0]!.token).toBe(ORG_TOKEN);
      expect(opened()[0]!.data["trigger_id"]).toBe(HOME_TRIGGER_ID);
      expect((opened()[0]!.data["view"] as JSONObject)["callback_id"]).toBe(
        "SubmitNewIncident",
      );
      expect(authorizedProjects()).toEqual([
        `${EVERYWHERE.toString()} as ${ALICE_ID.toString()}`,
      ]);
    });

    test("a press of another organization's installation: nothing opened, nothing read in the project", async () => {
      const answer: RouteAnswer = await press(
        homeButton({
          slackUserId: ALICE,
          personWorkspaceId: OTHER_ORG_WORKSPACE_ID,
          actionId: "/incident",
          origin: {
            workspaceId: OTHER_ORG_WORKSPACE_ID,
            enterpriseId: OTHER_ORG_ID,
            isEnterpriseInstall: true,
          },
        }),
      );

      expect(answer.status).toBe(200);

      await settle();

      expect(opened()).toEqual([]);
      expect(WorkspaceActionAuthorization.authorize).not.toHaveBeenCalled();
    });
  });

  describe("one Slack organization, two projects connected to it", () => {
    beforeEach(() => {
      connectEverywhere();
      connectStaging();
      links = [
        { slackUserId: ALICE, projectId: EVERYWHERE, userId: ALICE_ID },
        { slackUserId: DEANE, projectId: EVERYWHERE, userId: DEANE_ID },
        { slackUserId: DEANE, projectId: STAGING, userId: DEANE_ID },
      ];
    });

    test("somebody connected in one of them: that one, at once - with its own token", async () => {
      await command(slashCommand({ text: "incident Checkout is down" }));

      await until((): boolean => {
        return opened().length === 1;
      }, "the form opened");

      expect(opened()[0]!.token).toBe(ORG_TOKEN);
      expect(authorizedProjects()).toEqual([
        `${EVERYWHERE.toString()} as ${ALICE_ID.toString()}`,
      ]);
    });

    test("somebody in both runs it in Acme East: asked which; chosen with a press that names their own workspace, Acme West - the command is run again in the project chosen", async () => {
      await command(
        slashCommand({ text: "incident Checkout is down", slackUserId: DEANE }),
      );

      await until((): boolean => {
        return offeredButtons().length === 2;
      }, "the question of which project");

      expect(opened()).toEqual([]);
      expect(
        offeredButtons().map((button: { title: string }): string => {
          return button.title;
        }),
      ).toEqual(["Acme Everywhere", "Acme Staging"]);

      const staging: { title: string; actionId: string; value: string } =
        offeredButtons()[1]!;

      // Slack's press, for the organization's installation: no team.
      const answer: RouteAnswer = await press(
        pressFrom({
          slackUserId: DEANE,
          personWorkspaceId: WEST.id,
          origin: IN_EAST,
          rest: {
            channel: { id: OPS_CHANNEL_ID, name: "ops" },
            container: {
              type: "message",
              channel_id: OPS_CHANNEL_ID,
              message_ts: "1762800001.000100",
              is_ephemeral: true,
            },
            response_url: CHOICE_RESPONSE_URL,
            trigger_id: CHOICE_TRIGGER_ID,
            actions: [
              {
                type: "button",
                action_id: staging.actionId,
                block_id: "choose-project",
                text: { type: "plain_text", text: staging.title, emoji: true },
                value: staging.value,
                action_ts: "1762800001.000300",
              },
            ],
          },
        }),
      );

      expect(answer.status).toBe(200);

      await until((): boolean => {
        return opened().length === 1;
      }, "the form opened in the project chosen");

      expect(opened()[0]!.token).toBe(STAGING_TOKEN);
      expect(opened()[0]!.data["trigger_id"]).toBe(CHOICE_TRIGGER_ID);
      expect(
        inputValue(opened()[0]!.data["view"] as JSONObject, "incidentTitle"),
      ).toBe("Checkout is down");
      expect(authorizedProjects()).toEqual([
        `${STAGING.toString()} as ${DEANE_ID.toString()}`,
      ]);
    });
  });

  describe("a workspace of the organization connected on its own", () => {
    beforeEach(() => {
      connectEastOps();
      links = [{ slackUserId: ALICE, projectId: EAST_OPS, userId: ALICE_ID }];
    });

    test("a request in it made for the organization's installation still finds it - a project connected before OneUptime was installed for the organization", async () => {
      await command(slashCommand({ text: "incident Checkout is down" }));

      await until((): boolean => {
        return opened().length === 1;
      }, "the form opened");

      expect(opened()[0]!.token).toBe(EAST_TOKEN);
      expect(authorizedProjects()).toEqual([
        `${EAST_OPS.toString()} as ${ALICE_ID.toString()}`,
      ]);
    });

    test("a request from another workspace of the organization does not reach it", async () => {
      const answer: RouteAnswer = await command(
        slashCommand({
          text: "incident Checkout is down",
          origin: {
            workspaceId: WEST.id,
            enterpriseId: ORG_ID,
            isEnterpriseInstall: true,
          },
        }),
      );

      expect((answer.body as JSONObject)["text"]).toBe(NOT_CONNECTED);

      await settle();

      expect(slack.calls).toEqual([]);
    });

    test("the Home opened in another workspace of the organization: nothing drawn", async () => {
      await deliverEvent(
        openHome(ALICE, {
          workspaceId: WEST.id,
          enterpriseId: ORG_ID,
          isEnterpriseInstall: true,
        }),
      );

      await settle();

      expect(slack.callsOf("views.publish")).toEqual([]);
    });
  });
});
