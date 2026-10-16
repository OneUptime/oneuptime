/*
 * AIAgentService.getLinkInDashboard is the link of an AI agent's owner
 * notifications: the connection-status email's "View Tasks" button, its push
 * click-through and WhatsApp link, and the owner-added notification's. It
 * used to build /dashboard/<projectId>/settings/ai-agents/<aiAgentId>, the
 * AI Agents page under Project Settings - retired when Runners replaced the
 * agent container (d9be2958f5) - and the email said "You can view this AI
 * agent by going to Project Settings > AI Agents", a menu entry nobody has.
 * Nothing redirects that path, so every click landed on a missing page.
 *
 * The link is the project's Tasks page now (PageMap.AI_AGENT_TASKS, route
 * /dashboard/<projectId>/ai/agents in the Dashboard's RouteMap), whose
 * readiness card says which agent is online.
 *
 * Everything below the service boundary is spied - no database.
 */

import AIAgentService from "../../../Server/Services/AIAgentService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../../Models/DatabaseModels/AIAgent";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const AI_AGENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OWNER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const TASKS_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/ai/agents`;
// The old link, to a page the Dashboard no longer has.
const RETIRED_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/settings/ai-agents/${AI_AGENT_ID.toString()}`;

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

type SentNotification = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

describe("AIAgentService.getLinkInDashboard", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("with a known dashboard URL", () => {
    beforeEach(() => {
      getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(
        async (): Promise<URL> => {
          return URL.fromString(DASHBOARD_URL);
        },
      );
    });

    it("points at the project's Tasks page, not the retired AI Agents page", async () => {
      const link: URL = await AIAgentService.getLinkInDashboard(PROJECT_ID);

      expect(link.toString()).toBe(TASKS_LINK);
      expect(link.toString()).not.toBe(RETIRED_LINK);
    });

    it("is the project's own page: another project gets another link", async () => {
      const otherProject: ObjectID = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );
      const link: URL = await AIAgentService.getLinkInDashboard(otherProject);

      expect(link.toString()).toBe(
        `${DASHBOARD_URL}/${otherProject.toString()}/ai/agents`,
      );
    });
  });

  describe("with the dashboard URL taken from the environment", () => {
    let savedHost: string | undefined;
    let savedProtocol: string | undefined;

    beforeEach(() => {
      savedHost = process.env["HOST"];
      savedProtocol = process.env["HTTP_PROTOCOL"];
      process.env["HOST"] = "oneuptime.acme.test";
      process.env["HTTP_PROTOCOL"] = "https";
    });

    afterEach(() => {
      if (savedHost === undefined) {
        delete process.env["HOST"];
      } else {
        process.env["HOST"] = savedHost;
      }

      if (savedProtocol === undefined) {
        delete process.env["HTTP_PROTOCOL"];
      } else {
        process.env["HTTP_PROTOCOL"] = savedProtocol;
      }
    });

    it("builds https://<host>/dashboard/<projectId>/ai/agents", async () => {
      const link: URL = await AIAgentService.getLinkInDashboard(PROJECT_ID);

      expect(link.toString()).toBe(
        `https://oneuptime.acme.test/dashboard/${PROJECT_ID.toString()}/ai/agents`,
      );
    });
  });

  it("is a route the Dashboard has: the Tasks page, and no AI Agents page under Project Settings", () => {
    const routeMap: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Utils/RouteMap.ts"),
      "utf8",
    );

    expect(routeMap).toContain(
      "[PageMap.AI_AGENT_TASKS]: new Route(\n    `/dashboard/${RouteParams.ProjectID}/ai/agents`,",
    );
    expect(routeMap).not.toContain("ai-agents");
  });

  describe("the connection-status notification", () => {
    let sent: Array<SentNotification> = [];

    beforeEach(() => {
      sent = [];

      getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(
        async (): Promise<URL> => {
          return URL.fromString(DASHBOARD_URL);
        },
      );

      const project: Project = new Project();
      project.name = "Acme Corp";

      const aiAgent: AIAgent = new AIAgent();
      aiAgent.id = AI_AGENT_ID;
      aiAgent.projectId = PROJECT_ID;
      aiAgent.project = project;
      aiAgent.name = "Code fixer";
      aiAgent.connectionStatus = AIAgentConnectionStatus.Disconnected;
      aiAgent.isGlobalAIAgent = false;
      aiAgent.lastAlive = new Date("2026-10-16T08:00:00.000Z");

      getJestSpyOn(AIAgentService, "findOneById").mockImplementation(
        async (): Promise<AIAgent | null> => {
          return aiAgent;
        },
      );

      getJestSpyOn(AIAgentService, "getOwners").mockImplementation(
        async (): Promise<Array<User>> => {
          const owner: User = new User();
          owner.id = OWNER_ID;
          return [owner];
        },
      );

      getJestSpyOn(
        UserNotificationSettingService,
        "sendUserNotification",
      ).mockImplementation(async (data: SentNotification): Promise<void> => {
        sent.push(data);
      });
    });

    it("sends the email button, the push click-through and the WhatsApp link to the Tasks page", async () => {
      await AIAgentService.notifyOwnersOnStatusChange({
        aiAgentId: AI_AGENT_ID,
      });

      expect(sent).toHaveLength(1);

      const notification: SentNotification = sent[0]!;

      expect(notification.userId.toString()).toBe(OWNER_ID.toString());
      expect(notification.emailEnvelope.vars["viewAIAgentsLink"]).toBe(
        TASKS_LINK,
      );
      expect(notification.pushNotificationMessage.clickAction).toBe(TASKS_LINK);
      expect(notification.whatsAppMessage?.templateVariables).toMatchObject({
        ai_agent_link: TASKS_LINK,
      });
    });
  });
});
