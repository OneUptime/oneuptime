import StateChangeNoteMessage from "../../../Types/StatusPage/StateChangeNoteMessage";
import { describe, expect, test } from "@jest/globals";

/*
 * The words a public note posted with a state change adds to its default
 * messages, so subscribers learn the state the event moved to. They are the
 * words the state change's own messages used (the state change jobs in
 * App/FeatureSet/Workers/Jobs/*StateTimeline), so a subscriber reads the
 * same subject and the same sentence whether the change came with a note
 * or not.
 */

describe("StateChangeNoteMessage", () => {
  test("names a state as the state change messages always did: first letter up, trimmed", () => {
    expect(StateChangeNoteMessage.formatStateName("resolved")).toBe("Resolved");
    expect(StateChangeNoteMessage.formatStateName("  Acknowledged ")).toBe(
      "Acknowledged",
    );
    expect(StateChangeNoteMessage.formatStateName("in progress")).toBe(
      "In progress",
    );
    expect(StateChangeNoteMessage.formatStateName("")).toBe("");
  });

  describe("email subjects", () => {
    test("an incident's default email: the state change email's subject", () => {
      expect(
        StateChangeNoteMessage.getIncidentEmailSubject({
          stateName: "resolved",
          incidentTitle: "Checkout is down",
        }),
      ).toBe("[Resolved Incident] Checkout is down");
    });

    test("an incident's custom template with no subject: the state change's custom subject", () => {
      expect(
        StateChangeNoteMessage.getIncidentCustomTemplateEmailSubject({
          stateName: "Resolved",
          incidentTitle: "Checkout is down",
        }),
      ).toBe("[Incident Resolved] Checkout is down");
    });

    test("a scheduled maintenance event's default email", () => {
      expect(
        StateChangeNoteMessage.getScheduledMaintenanceEmailSubject({
          stateName: "Ongoing",
          eventTitle: "Database upgrade",
        }),
      ).toBe("[Ongoing Scheduled Maintenance] Database upgrade");
    });

    test("a scheduled maintenance event's custom template with no subject", () => {
      expect(
        StateChangeNoteMessage.getScheduledMaintenanceCustomTemplateEmailSubject(
          {
            stateName: "completed",
            eventTitle: "Database upgrade",
          },
        ),
      ).toBe("[Scheduled Maintenance Completed] Database upgrade");
    });

    test("a title is used as it is: subjects are sent as written", () => {
      expect(
        StateChangeNoteMessage.getIncidentEmailSubject({
          stateName: "Resolved",
          incidentTitle: "<b>Checkout</b> & payments",
        }),
      ).toBe("[Resolved Incident] <b>Checkout</b> & payments");
    });
  });

  describe("SMS", () => {
    test("an incident: 'Incident <title> on <page> is <State>.'", () => {
      expect(
        StateChangeNoteMessage.getIncidentSmsHeadline({
          stateName: "resolved",
          incidentTitle: "Checkout is down",
          statusPageName: "Acme Status",
        }),
      ).toBe("Incident Checkout is down on Acme Status is Resolved.");
    });

    test("a scheduled maintenance event: 'Maintenance <title> on <page> is <State>.'", () => {
      expect(
        StateChangeNoteMessage.getScheduledMaintenanceSmsHeadline({
          stateName: "Ongoing",
          eventTitle: "Database upgrade",
          statusPageName: "Acme Status",
        }),
      ).toBe("Maintenance Database upgrade on Acme Status is Ongoing.");
    });
  });

  describe("Slack and Microsoft Teams", () => {
    test("a Status line, as the incident state change message has", () => {
      expect(StateChangeNoteMessage.getChatStatusLine("Resolved")).toBe(
        "**Status:** Resolved",
      );
      expect(StateChangeNoteMessage.getChatStatusLine(" Monitoring ")).toBe(
        "**Status:** Monitoring",
      );
    });

    test("the label is the one the email row uses", () => {
      expect(StateChangeNoteMessage.statusLabel).toBe("Status");
      expect(StateChangeNoteMessage.getChatStatusLine("Resolved")).toContain(
        `**${StateChangeNoteMessage.statusLabel}:**`,
      );
    });
  });
});
