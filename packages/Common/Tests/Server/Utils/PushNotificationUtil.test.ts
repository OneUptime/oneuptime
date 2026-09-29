import PushNotificationUtil from "../../../Server/Utils/PushNotificationUtil";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { describe, expect, test } from "@jest/globals";

describe("PushNotificationUtil", () => {
  describe("default icon/badge", () => {
    test("applies the default icon and badge to every notification", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createMonitorCreatedNotification({
          monitorName: "API",
          monitorId: "m1",
        });

      expect(message.icon).toBe(PushNotificationUtil.DEFAULT_ICON);
      expect(message.badge).toBe(PushNotificationUtil.DEFAULT_BADGE);
    });
  });

  describe("createIncidentCreatedNotification", () => {
    test("includes the display number and identifier when a number is given", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createIncidentCreatedNotification({
          incidentTitle: "DB down",
          projectName: "Acme",
          incidentViewLink: "https://x/incident/1",
          incidentNumber: 42,
          incidentId: "i1",
          projectId: "p1",
        });

      expect(message.title).toBe("New Incident #42: DB down");
      expect(message.body).toBe(
        "A new incident has been created: #42 (DB down) in Acme. Click to view details.",
      );
      expect(message.tag).toBe("incident-created");
      expect(message.requireInteraction).toBe(true);
      expect(message.clickAction).toBe("https://x/incident/1");
      expect(message.url).toBe("https://x/incident/1");
      expect(message.data).toMatchObject({
        type: "incident-created",
        entityType: "incident",
        entityId: "i1",
        projectId: "p1",
        url: "https://x/incident/1",
      });
    });

    test("omits the number when none is provided", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createIncidentCreatedNotification({
          incidentTitle: "DB down",
          projectName: "Acme",
          incidentViewLink: "https://x/incident/1",
        });

      expect(message.title).toBe("New Incident: DB down");
      expect(message.body).toBe(
        "A new incident has been created: DB down in Acme. Click to view details.",
      );
    });

    test("prefers the prefixed number over the raw number", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createIncidentCreatedNotification({
          incidentTitle: "DB down",
          projectName: "Acme",
          incidentViewLink: "https://x/incident/1",
          incidentNumber: 42,
          incidentNumberWithPrefix: "INC-42",
        });

      expect(message.title).toBe("New Incident INC-42: DB down");
      expect(message.body).toContain("INC-42 (DB down)");
    });
  });

  describe("createIncidentStateChangedNotification", () => {
    test("describes the transition when a previous state is present", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createIncidentStateChangedNotification({
          incidentTitle: "DB down",
          projectName: "Acme",
          newState: "Resolved",
          previousState: "Acknowledged",
          incidentViewLink: "https://x/incident/1",
          incidentNumber: 7,
        });

      expect(message.title).toBe("Incident #7 Updated: DB down");
      expect(message.body).toBe(
        "Incident #7 (DB down) state changed from Acknowledged to Resolved in Acme. Click to view details.",
      );
      expect(message.data).toMatchObject({
        newState: "Resolved",
        previousState: "Acknowledged",
      });
    });

    test("omits the previous state when not provided", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createIncidentStateChangedNotification({
          incidentTitle: "DB down",
          projectName: "Acme",
          newState: "Resolved",
          incidentViewLink: "https://x/incident/1",
        });

      expect(message.body).toBe(
        "Incident DB down state changed to Resolved in Acme. Click to view details.",
      );
    });
  });

  describe("createMonitorStatusChangedNotification", () => {
    test("formats title from the new status and body from the transition", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createMonitorStatusChangedNotification({
          monitorName: "API",
          projectName: "Acme",
          newStatus: "Offline",
          previousStatus: "Online",
          monitorViewLink: "https://x/monitor/1",
        });

      expect(message.title).toBe("Monitor Offline: API");
      expect(message.body).toBe(
        "Monitor status changed from Online to Offline in Acme. Click to view details.",
      );
      expect(message.tag).toBe("monitor-status-changed");
    });
  });

  describe("createScheduledMaintenanceNotification", () => {
    test("lowercases the state inside the body but not the title", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createScheduledMaintenanceNotification({
          title: "DB upgrade",
          projectName: "Acme",
          state: "Started",
          viewLink: "https://x/sm/1",
          scheduledMaintenanceNumber: 3,
        });

      expect(message.title).toBe(
        "Scheduled Maintenance #3 Started: DB upgrade",
      );
      expect(message.body).toBe(
        "Scheduled maintenance #3 (DB upgrade) started in Acme. Click to view details.",
      );
      // Scheduled maintenance is informational, so no forced interaction.
      expect(message.requireInteraction).toBe(false);
    });
  });

  describe("createGenericNotification", () => {
    test("uses a default tag and no click action when none is given", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createGenericNotification({
          title: "Hello",
          body: "World",
        });

      expect(message.title).toBe("Hello");
      expect(message.body).toBe("World");
      expect(message.tag).toBe("OneUptime");
      expect(message.requireInteraction).toBe(false);
      expect(message.clickAction).toBeUndefined();
      expect(message.data).toEqual({ type: "generic" });
    });

    test("wires clickAction into url and data.url when provided", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createGenericNotification({
          title: "Hello",
          body: "World",
          clickAction: "https://x/go",
          tag: "custom",
          requireInteraction: true,
        });

      expect(message.tag).toBe("custom");
      expect(message.requireInteraction).toBe(true);
      expect(message.clickAction).toBe("https://x/go");
      expect(message.url).toBe("https://x/go");
      expect(message.data).toMatchObject({
        type: "generic",
        url: "https://x/go",
      });
    });
  });

  describe("createProbeDisconnectedNotification", () => {
    test("builds the fixed probe-disconnected copy", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createProbeDisconnectedNotification({
          probeName: "edge-1",
        });

      expect(message.title).toBe("OneUptime: Probe Disconnected");
      expect(message.body).toBe(
        "Your probe edge-1 is disconnected. It was last seen 5 minutes ago.",
      );
      expect(message.tag).toBe("probe-disconnected");
      expect(message.data).toMatchObject({
        type: "probe-disconnected",
        probeName: "edge-1",
      });
    });
  });

  describe("createAIAgentStatusChangedNotification", () => {
    test("omits url wiring when no click action is provided", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createAIAgentStatusChangedNotification({
          aiAgentName: "triage-bot",
          projectName: "Acme",
          connectionStatus: "Connected",
        });

      expect(message.title).toBe("AI Agent Connected: triage-bot");
      expect(message.body).toBe(
        "AI Agent triage-bot is Connected in Acme. Click to view details.",
      );
      expect(message.clickAction).toBeUndefined();
      expect(message.url).toBeUndefined();
    });
  });
});
