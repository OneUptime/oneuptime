import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables, {
  SubscriberNotificationTemplateVariable,
} from "../../../Types/StatusPage/SubscriberNotificationTemplateVariables";
import { describe, expect, test } from "@jest/globals";

/*
 * The variables a custom subscriber notification template may use, per event
 * type. The dashboard shows this list to template authors and the workers are
 * tested against it, so it has to answer for every event type the template
 * form offers - it used to throw for the episode and subscription events.
 */

const Event: typeof StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType;

const ALL_EVENTS: Array<StatusPageSubscriberNotificationEventType> =
  Object.values(StatusPageSubscriberNotificationEventType);

const STATUS_PAGE: Array<string> = [
  "statusPageName",
  "statusPageUrl",
  "unsubscribeUrl",
];

const COMMON: Array<string> = [...STATUS_PAGE, "resourcesAffected"];

// Messages about the subscription itself, or the report - not about a resource.
const ACCOUNT_EVENTS: Array<StatusPageSubscriberNotificationEventType> = [
  StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation,
  StatusPageSubscriberNotificationEventType.SubscriberSubscribed,
  StatusPageSubscriberNotificationEventType.SubscriberManageSubscription,
  StatusPageSubscriberNotificationEventType.SubscriberReport,
];

const EVENT_EVENTS: Array<StatusPageSubscriberNotificationEventType> =
  Object.values(StatusPageSubscriberNotificationEventType).filter(
    (event: StatusPageSubscriberNotificationEventType): boolean => {
      return !ACCOUNT_EVENTS.includes(event);
    },
  );

function names(
  event: StatusPageSubscriberNotificationEventType,
): Array<string> {
  return SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
    event,
  );
}

describe("SubscriberNotificationTemplateVariables", () => {
  test.each(ALL_EVENTS)(
    "%s has a variable list",
    (event: StatusPageSubscriberNotificationEventType) => {
      expect(() => {
        return SubscriberNotificationTemplateVariables.getAvailableVariablesForEventType(
          event,
        );
      }).not.toThrow();
    },
  );

  test.each(ALL_EVENTS)(
    "%s lists the status page variables",
    (event: StatusPageSubscriberNotificationEventType) => {
      expect(names(event)).toEqual(expect.arrayContaining(STATUS_PAGE));
    },
  );

  test.each(EVENT_EVENTS)(
    "%s offers the resources it affects",
    (event: StatusPageSubscriberNotificationEventType) => {
      expect(names(event)).toContain("resourcesAffected");
    },
  );

  test.each(ACCOUNT_EVENTS)(
    "%s is not about a resource, so it does not offer resourcesAffected",
    (event: StatusPageSubscriberNotificationEventType) => {
      expect(names(event)).not.toContain("resourcesAffected");
    },
  );

  test("every event type is either an event or an account message", () => {
    expect(EVENT_EVENTS.length + ACCOUNT_EVENTS.length).toBe(ALL_EVENTS.length);
    expect(EVENT_EVENTS.length).toBeGreaterThan(10);
  });

  test.each(ALL_EVENTS)(
    "%s lists each variable once, with a description",
    (event: StatusPageSubscriberNotificationEventType) => {
      const variables: Array<SubscriberNotificationTemplateVariable> =
        SubscriberNotificationTemplateVariables.getAvailableVariablesForEventType(
          event,
        );

      expect(new Set(names(event)).size).toBe(variables.length);

      for (const variable of variables) {
        expect(variable.name).toMatch(/^[A-Za-z][\w.]*$/);
        expect(variable.description.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test("returns a new list each time, so callers cannot change it for others", () => {
    const first: Array<SubscriberNotificationTemplateVariable> =
      SubscriberNotificationTemplateVariables.getAvailableVariablesForEventType(
        Event.SubscriberIncidentCreated,
      );
    first.push({ name: "injected", description: "x" });
    first[0]!.name = "renamed";

    expect(names(Event.SubscriberIncidentCreated)).not.toContain("injected");
    expect(names(Event.SubscriberIncidentCreated)).toContain("statusPageName");
  });

  test("refuses an event type it does not know", () => {
    expect(() => {
      SubscriberNotificationTemplateVariables.getAvailableVariablesForEventType(
        "Subscriber Something Else" as StatusPageSubscriberNotificationEventType,
      );
    }).toThrow(/Unknown event type/);
  });

  test.each([
    [Event.SubscriberAnnouncementCreated, Event.SubscriberAnnouncementUpdated],
    [Event.SubscriberIncidentNoteCreated, Event.SubscriberIncidentNoteUpdated],
    [Event.SubscriberEpisodeNoteCreated, Event.SubscriberEpisodeNoteUpdated],
    [
      Event.SubscriberScheduledMaintenanceNoteCreated,
      Event.SubscriberScheduledMaintenanceNoteUpdated,
    ],
  ])(
    "%s and its update twin %s offer the same variables",
    (
      created: StatusPageSubscriberNotificationEventType,
      updated: StatusPageSubscriberNotificationEventType,
    ) => {
      expect(names(updated)).toEqual(names(created));
    },
  );

  test.each([
    [
      Event.SubscriberIncidentNoteCreated,
      [
        "incidentTitle",
        "incidentSeverity",
        "incidentState",
        "postedAt",
        "note",
        "detailsUrl",
      ],
    ],
    [
      Event.SubscriberScheduledMaintenanceNoteCreated,
      [
        "scheduledMaintenanceTitle",
        "scheduledMaintenanceDescription",
        "scheduledMaintenanceState",
        "postedAt",
        "note",
        "detailsUrl",
      ],
    ],
    [
      Event.SubscriberEpisodeNoteCreated,
      ["episodeTitle", "episodeSeverity", "note", "detailsUrl"],
    ],
    [
      Event.SubscriberAnnouncementCreated,
      ["announcementTitle", "announcementDescription", "detailsUrl"],
    ],
    [
      Event.SubscriberEpisodeCreated,
      ["episodeTitle", "episodeDescription", "episodeSeverity", "detailsUrl"],
    ],
    [
      Event.SubscriberEpisodeStateChanged,
      ["episodeTitle", "episodeSeverity", "episodeState", "detailsUrl"],
    ],
  ] as Array<[StatusPageSubscriberNotificationEventType, Array<string>]>)(
    "%s offers exactly its event variables on top of the common ones",
    (
      event: StatusPageSubscriberNotificationEventType,
      eventVariables: Array<string>,
    ) => {
      expect([...names(event)].sort()).toEqual(
        [...COMMON, ...eventVariables].sort(),
      );
    },
  );

  test.each([
    [Event.SubscriberSubscriptionConfirmation, ["confirmationUrl"]],
    [Event.SubscriberManageSubscription, ["manageSubscriptionUrl"]],
    [Event.SubscriberSubscribed, []],
  ] as Array<[StatusPageSubscriberNotificationEventType, Array<string>]>)(
    "%s offers exactly its own variables on top of the status page ones",
    (
      event: StatusPageSubscriberNotificationEventType,
      eventVariables: Array<string>,
    ) => {
      expect([...names(event)].sort()).toEqual(
        [...STATUS_PAGE, ...eventVariables].sort(),
      );
    },
  );

  test("the report documents its structured fields rather than flat values", () => {
    const report: Array<string> = names(Event.SubscriberReport);

    expect(report).toContain("report.averageUptimePercent");
    expect(report).toContain("report.rows");
  });
});
