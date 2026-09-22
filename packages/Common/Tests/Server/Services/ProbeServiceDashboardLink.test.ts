/*
 * https://github.com/OneUptime/oneuptime/issues/2486
 *
 * ProbeService.getLinkInDashboard is the "View Probes" link of the probe
 * connection-status notification (email button, push click-through, WhatsApp
 * link). It used to build /dashboard/<projectId>/settings/probes/<probeId>.
 * The dashboard has no such route: custom probes live under Monitors >
 * Settings > Probes (PageMap.MONITORS_SETTINGS_PROBE_VIEW, route
 * /dashboard/<projectId>/monitors/settings/probes/<probeId> in the
 * Dashboard's RouteMap), and nothing redirects the old path, so every
 * "View Probes" click landed on a missing page.
 *
 * Everything below the service boundary is spied - no database.
 */

import ProbeService from "../../../Server/Services/ProbeService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROBE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OWNER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const PROBE_VIEW_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/monitors/settings/probes/${PROBE_ID.toString()}`;
// The pre-fix link, which no dashboard route matches.
const ROUTELESS_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/settings/probes/${PROBE_ID.toString()}`;

type SentNotification = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

describe("ProbeService.getLinkInDashboard", () => {
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

    it("points at the probe's page under Monitors > Settings > Probes", async () => {
      const link: URL = await ProbeService.getLinkInDashboard(
        PROJECT_ID,
        PROBE_ID,
      );

      expect(link.toString()).toBe(PROBE_VIEW_LINK);
      expect(link.toString()).not.toBe(ROUTELESS_LINK);
    });

    it("puts the project and the probe in the path, in that order", async () => {
      const otherProbeId: ObjectID = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );

      const link: URL = await ProbeService.getLinkInDashboard(
        PROJECT_ID,
        otherProbeId,
      );

      expect(link.toString()).toBe(
        `${DASHBOARD_URL}/${PROJECT_ID.toString()}/monitors/settings/probes/${otherProbeId.toString()}`,
      );
    });
  });

  describe("with the dashboard URL taken from the environment", () => {
    /*
     * No stub here: DatabaseConfig.getDashboardUrl reads HOST and
     * HTTP_PROTOCOL at call time and appends the /dashboard route, so this
     * pins that the probe path lands under the real dashboard root.
     */
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

    it("builds https://<host>/dashboard/<projectId>/monitors/settings/probes/<probeId>", async () => {
      const link: URL = await ProbeService.getLinkInDashboard(
        PROJECT_ID,
        PROBE_ID,
      );

      expect(link.toString()).toBe(
        `https://oneuptime.acme.test/dashboard/${PROJECT_ID.toString()}/monitors/settings/probes/${PROBE_ID.toString()}`,
      );
    });
  });

  describe("the 'View Probes' link of the probe status notification", () => {
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

      const probe: Probe = new Probe();
      probe.id = PROBE_ID;
      probe.projectId = PROJECT_ID;
      probe.project = project;
      probe.name = "Frankfurt probe";
      probe.connectionStatus = ProbeConnectionStatus.Disconnected;
      probe.isGlobalProbe = false;
      probe.lastAlive = new Date("2026-09-22T08:00:00.000Z");

      getJestSpyOn(ProbeService, "findOneById").mockImplementation(
        async (): Promise<Probe | null> => {
          return probe;
        },
      );

      getJestSpyOn(ProbeService, "getOwners").mockImplementation(
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

    it("uses the routed probe page for the email button, the push click-through and the WhatsApp link", async () => {
      await ProbeService.notifyOwnersOnStatusChange({ probeId: PROBE_ID });

      expect(sent).toHaveLength(1);
      const notification: SentNotification = sent[0]!;

      expect(notification.userId.toString()).toBe(OWNER_ID.toString());
      expect(notification.emailEnvelope.vars["viewProbesLink"]).toBe(
        PROBE_VIEW_LINK,
      );
      expect(notification.pushNotificationMessage.clickAction).toBe(
        PROBE_VIEW_LINK,
      );
      expect(notification.pushNotificationMessage.url).toBe(PROBE_VIEW_LINK);
      expect(notification.whatsAppMessage?.templateVariables).toMatchObject({
        probe_link: PROBE_VIEW_LINK,
      });
    });
  });
});
