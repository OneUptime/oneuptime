import PushNotificationUtil from "../../../Server/Utils/PushNotificationUtil";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { describe, expect, test } from "@jest/globals";

/*
 * Behavioural coverage for the PushNotificationUtil creators that the sibling
 * PushNotificationUtil.test.ts does not touch. Each creator is a pure builder,
 * but each carries real display logic a responder sees on a locked screen:
 * which identifier the title shows (a prefixed number, a bare #number, or just
 * the title), whether a note reads as Private or Public, and whether a click
 * target is wired through. A regression in any of these is a page that opens
 * the wrong thing or leaks the wrong label, so they are pinned here.
 */

describe("PushNotificationUtil untested creators", () => {
  describe("defaults are applied to every creator", () => {
    test("icon and badge are stamped on by applyDefaults", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyAddedNotification({
          policyName: "Primary",
        });

      expect(message.icon).toBe(PushNotificationUtil.DEFAULT_ICON);
      expect(message.badge).toBe(PushNotificationUtil.DEFAULT_BADGE);
    });
  });

  describe("createAlertCreatedNotification - display number precedence", () => {
    test("a prefixed number wins over a bare number in title and body", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createAlertCreatedNotification({
          alertTitle: "Disk full",
          projectName: "Acme",
          alertViewLink: "https://x/alert/1",
          alertNumber: 12,
          alertNumberWithPrefix: "ALERT-12",
          alertId: "a1",
          projectId: "p1",
        });

      expect(message.title).toBe("New Alert ALERT-12: Disk full");
      expect(message.body).toContain("ALERT-12 (Disk full)");
      expect(message.body).toContain("in Acme");
    });

    test("a bare number is rendered as #number when no prefix is given", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createAlertCreatedNotification({
          alertTitle: "Disk full",
          projectName: "Acme",
          alertViewLink: "https://x/alert/1",
          alertNumber: 12,
        });

      expect(message.title).toBe("New Alert #12: Disk full");
      expect(message.body).toContain("#12 (Disk full)");
    });

    test("with neither number the identifier is just the title", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createAlertCreatedNotification({
          alertTitle: "Disk full",
          projectName: "Acme",
          alertViewLink: "https://x/alert/1",
        });

      expect(message.title).toBe("New Alert: Disk full");
      // No leading space and no parenthesised number when there is no number.
      expect(message.body).toContain("created: Disk full in Acme");
      expect(message.title).not.toContain("  ");
    });

    test("wires clickAction, url and requireInteraction, and carries the payload", () => {
      const link: string = "https://dashboard/alert/42";
      const message: PushNotificationMessage =
        PushNotificationUtil.createAlertCreatedNotification({
          alertTitle: "Disk full",
          projectName: "Acme",
          alertViewLink: link,
          alertId: "a42",
          projectId: "p9",
        });

      expect(message.clickAction).toBe(link);
      expect(message.url).toBe(link);
      expect(message.requireInteraction).toBe(true);
      expect(message.tag).toBe("alert-created");
      expect(message.data).toMatchObject({
        type: "alert-created",
        entityType: "alert",
        entityId: "a42",
        projectId: "p9",
        url: link,
      });
    });
  });

  describe("createAlertEpisodeCreatedNotification", () => {
    test("uses the alert-episode tag, title and payload type", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createAlertEpisodeCreatedNotification({
          alertEpisodeTitle: "Cascade",
          projectName: "Acme",
          alertEpisodeViewLink: "https://x/ep/1",
          episodeNumberWithPrefix: "EP-3",
        });

      expect(message.title).toBe("New Alert Episode EP-3: Cascade");
      expect(message.tag).toBe("alert-episode-created");
      expect(message.data).toMatchObject({
        type: "alert-episode-created",
        entityType: "alert-episode",
      });
    });
  });

  describe("createIncidentEpisodeCreatedNotification", () => {
    test("uses the incident-episode tag and title", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createIncidentEpisodeCreatedNotification({
          incidentEpisodeTitle: "Cascade",
          projectName: "Acme",
          incidentEpisodeViewLink: "https://x/ep/1",
          episodeNumber: 7,
        });

      expect(message.title).toBe("New Incident Episode #7: Cascade");
      expect(message.tag).toBe("incident-episode-created");
      expect(message.data).toMatchObject({
        type: "incident-episode-created",
        entityType: "incident-episode",
      });
    });
  });

  describe("createIncidentNotePostedNotification - note visibility", () => {
    test("a private note reads as Private in title, body and payload", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createIncidentNotePostedNotification({
          incidentTitle: "API down",
          projectName: "Acme",
          isPrivateNote: true,
          incidentViewLink: "https://x/i/1",
          incidentNumberWithPrefix: "INC-5",
        });

      expect(message.title).toBe(
        "Private Note Added: Incident INC-5 - API down",
      );
      expect(message.body).toContain("A private note has been posted");
      expect(message.data).toMatchObject({ isPrivateNote: true });
    });

    test("a public note reads as Public - the visibility is not swapped", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createIncidentNotePostedNotification({
          incidentTitle: "API down",
          projectName: "Acme",
          isPrivateNote: false,
          incidentViewLink: "https://x/i/1",
        });

      expect(message.title).toContain("Public Note Added");
      expect(message.body).toContain("A public note has been posted");
      expect(message.data).toMatchObject({ isPrivateNote: false });
    });
  });

  describe("on-call policy membership notifications", () => {
    test("added names the policy and uses the added tag", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyAddedNotification({
          policyName: "Primary",
        });

      expect(message.title).toBe("Added to On-Call Policy");
      expect(message.body).toContain(
        "added to the on-call duty policy Primary",
      );
      expect(message.tag).toBe("on-call-policy-added");
      expect(message.requireInteraction).toBe(false);
    });

    test("removed names the policy and uses the removed tag", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyRemovedNotification({
          policyName: "Primary",
        });

      expect(message.title).toBe("Removed from On-Call Policy");
      expect(message.body).toContain(
        "removed from the on-call duty policy Primary",
      );
      expect(message.tag).toBe("on-call-policy-removed");
    });

    test("added and removed are distinguishable - different title, body and tag", () => {
      const added: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyAddedNotification({
          policyName: "Primary",
        });
      const removed: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyRemovedNotification({
          policyName: "Primary",
        });

      expect(added.title).not.toBe(removed.title);
      expect(added.body).not.toBe(removed.body);
      expect(added.tag).not.toBe(removed.tag);
    });
  });

  describe("createProbeStatusChangedNotification - the conditional click target", () => {
    test("without a clickAction, no url/clickAction is wired", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createProbeStatusChangedNotification({
          probeName: "eu-west",
          projectName: "Acme",
          connectionStatus: "connected",
        });

      expect(message.title).toBe("Probe connected: eu-west");
      expect(message.clickAction).toBeUndefined();
      expect(message.url).toBeUndefined();
      expect(message.data).not.toHaveProperty("url");
    });

    test("with a clickAction, it is mirrored onto url and into the payload", () => {
      const link: string = "https://dashboard/probe/eu-west";
      const message: PushNotificationMessage =
        PushNotificationUtil.createProbeStatusChangedNotification({
          probeName: "eu-west",
          projectName: "Acme",
          connectionStatus: "disconnected",
          clickAction: link,
        });

      expect(message.title).toBe("Probe disconnected: eu-west");
      expect(message.clickAction).toBe(link);
      expect(message.url).toBe(link);
      expect(message.data).toMatchObject({ url: link });
    });
  });

  describe("createMonitorProbeStatusNotification", () => {
    test("passes title/body/tag straight through and stamps the type", () => {
      const message: PushNotificationMessage =
        PushNotificationUtil.createMonitorProbeStatusNotification({
          title: "Monitor degraded",
          body: "eu-west probe cannot reach API",
          tag: "monitor-probe-status-degraded",
          monitorId: "m1",
          monitorName: "API",
        });

      expect(message.title).toBe("Monitor degraded");
      expect(message.body).toBe("eu-west probe cannot reach API");
      expect(message.tag).toBe("monitor-probe-status-degraded");
      expect(message.requireInteraction).toBe(false);
      expect(message.data).toMatchObject({
        type: "monitor-probe-status",
        monitorId: "m1",
        monitorName: "API",
      });
    });
  });
});
