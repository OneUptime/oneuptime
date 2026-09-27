import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables, {
  SubscriberNotificationTemplateDynamicVariable,
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

// What every incident event offers on top of its own variables.
const INCIDENT: Array<string> = ["incidentLabels", "affectedStatusPages"];

const INCIDENT_EVENTS: Array<StatusPageSubscriberNotificationEventType> = [
  StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
  StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
  StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
  StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
  StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished,
];

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
        ...INCIDENT,
      ],
    ],
    [
      Event.SubscriberIncidentCreated,
      [
        "incidentTitle",
        "incidentDescription",
        "incidentSeverity",
        "detailsUrl",
        ...INCIDENT,
      ],
    ],
    [
      Event.SubscriberIncidentStateChanged,
      [
        "incidentTitle",
        "incidentDescription",
        "incidentSeverity",
        "incidentState",
        "detailsUrl",
        ...INCIDENT,
      ],
    ],
    [
      Event.SubscriberIncidentPostmortemPublished,
      [
        "incidentTitle",
        "incidentSeverity",
        "postmortemNote",
        "detailsUrl",
        ...INCIDENT,
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

  /*
   * In the body of an email template, a variable is either HTML already
   * (rendered Markdown, or the resource list built from escaped names) or
   * plain text, which the body escapes. The workers' tests hold each worker
   * to this split, so it has to be exactly the HTML ones: a title marked as
   * HTML would go into the email unescaped.
   */
  test.each([
    [
      Event.SubscriberIncidentCreated,
      ["resourcesAffected", "incidentDescription"],
    ],
    [
      Event.SubscriberIncidentStateChanged,
      ["resourcesAffected", "incidentDescription"],
    ],
    [Event.SubscriberIncidentNoteCreated, ["resourcesAffected", "note"]],
    [Event.SubscriberIncidentNoteUpdated, ["resourcesAffected", "note"]],
    [
      Event.SubscriberIncidentPostmortemPublished,
      ["resourcesAffected", "postmortemNote"],
    ],
    [
      Event.SubscriberAnnouncementCreated,
      ["resourcesAffected", "announcementDescription"],
    ],
    [
      Event.SubscriberAnnouncementUpdated,
      ["resourcesAffected", "announcementDescription"],
    ],
    [
      Event.SubscriberScheduledMaintenanceCreated,
      ["resourcesAffected", "scheduledMaintenanceDescription"],
    ],
    [
      Event.SubscriberScheduledMaintenanceStateChanged,
      ["resourcesAffected", "scheduledMaintenanceDescription"],
    ],
    [
      Event.SubscriberScheduledMaintenanceNoteCreated,
      ["resourcesAffected", "scheduledMaintenanceDescription", "note"],
    ],
    [
      Event.SubscriberScheduledMaintenanceNoteUpdated,
      ["resourcesAffected", "scheduledMaintenanceDescription", "note"],
    ],
    [
      Event.SubscriberEpisodeCreated,
      ["resourcesAffected", "episodeDescription"],
    ],
    [Event.SubscriberEpisodeStateChanged, ["resourcesAffected"]],
    [Event.SubscriberEpisodeNoteCreated, ["resourcesAffected", "note"]],
    [Event.SubscriberEpisodeNoteUpdated, ["resourcesAffected", "note"]],
    [Event.SubscriberSubscriptionConfirmation, []],
    [Event.SubscriberSubscribed, []],
    [Event.SubscriberManageSubscription, []],
  ] as Array<[StatusPageSubscriberNotificationEventType, Array<string>]>)(
    "%s marks exactly its HTML variables as HTML in an email body",
    (
      event: StatusPageSubscriberNotificationEventType,
      htmlVariables: Array<string>,
    ) => {
      expect(
        [
          ...SubscriberNotificationTemplateVariables.getEmailBodyHtmlVariableNamesForEventType(
            event,
          ),
        ].sort(),
      ).toEqual([...htmlVariables].sort());
    },
  );

  test.each(ALL_EVENTS)(
    "%s never marks a title, name, severity, state, time or URL as HTML",
    (event: StatusPageSubscriberNotificationEventType) => {
      for (const name of SubscriberNotificationTemplateVariables.getEmailBodyHtmlVariableNamesForEventType(
        event,
      )) {
        expect(name).not.toMatch(
          /Title$|Name$|Severity$|State$|Url$|At$|Time$/,
        );
      }
    },
  );

  /*
   * The incident custom fields: one variable per field, by the field's
   * Template Variable key, so they are listed as a family by prefix.
   */
  describe("the custom field variables", () => {
    test.each(INCIDENT_EVENTS)(
      "%s offers {{customFields.<key>}}",
      (event: StatusPageSubscriberNotificationEventType) => {
        const dynamic: Array<SubscriberNotificationTemplateDynamicVariable> =
          SubscriberNotificationTemplateVariables.getDynamicVariablesForEventType(
            event,
          );

        expect(
          dynamic.map(
            (variable: SubscriberNotificationTemplateDynamicVariable) => {
              return [variable.prefix, variable.placeholder];
            },
          ),
        ).toEqual([["customFields.", "<key>"]]);
        expect(dynamic[0]!.description).toMatch(/Internal/);
        // A Rich text field's value is rendered Markdown in an email body.
        expect(dynamic[0]!.mayBeHtmlInEmailBody).toBe(true);
      },
    );

    test.each(
      ALL_EVENTS.filter(
        (event: StatusPageSubscriberNotificationEventType): boolean => {
          return !INCIDENT_EVENTS.includes(event);
        },
      ),
    )(
      "%s offers no custom fields",
      (event: StatusPageSubscriberNotificationEventType) => {
        expect(
          SubscriberNotificationTemplateVariables.getDynamicVariablesForEventType(
            event,
          ),
        ).toEqual([]);
        expect(
          SubscriberNotificationTemplateVariables.isVariableOffered(
            event,
            "customFields.site",
          ),
        ).toBe(false);
      },
    );

    test.each([
      ["customFields.site", true],
      ["customFields.affected_location_2", true],
      ["customFields.", false],
      ["customFields.Site", false],
      ["customFields.site-name", false],
      ["customFields.site.name", false],
      ["customFields._site", false],
      ["customFieldssite", false],
      ["incidentTitle", true],
      ["affectedStatusPages", true],
      ["episodeTitle", false],
    ] as Array<[string, boolean]>)(
      "an incident template can use {{%s}}: %s",
      (name: string, offered: boolean) => {
        expect(
          SubscriberNotificationTemplateVariables.isVariableOffered(
            Event.SubscriberIncidentCreated,
            name,
          ),
        ).toBe(offered);
      },
    );

    test("a listed variable is not taken for a custom field", () => {
      expect(
        SubscriberNotificationTemplateVariables.getDynamicVariableForName(
          Event.SubscriberIncidentCreated,
          "incidentTitle",
        ),
      ).toBeNull();
      expect(
        SubscriberNotificationTemplateVariables.getDynamicVariableForName(
          Event.SubscriberIncidentCreated,
          "customFields.site",
        )?.prefix,
      ).toBe("customFields.");
    });

    test("returns a new list each time", () => {
      const first: Array<SubscriberNotificationTemplateDynamicVariable> =
        SubscriberNotificationTemplateVariables.getDynamicVariablesForEventType(
          Event.SubscriberIncidentCreated,
        );
      first[0]!.prefix = "changed.";

      expect(
        SubscriberNotificationTemplateVariables.getDynamicVariablesForEventType(
          Event.SubscriberIncidentCreated,
        )[0]!.prefix,
      ).toBe("customFields.");
    });

    test.each(INCIDENT_EVENTS)(
      "%s marks the affected status pages and labels as plain text",
      (event: StatusPageSubscriberNotificationEventType) => {
        const html: Array<string> =
          SubscriberNotificationTemplateVariables.getEmailBodyHtmlVariableNamesForEventType(
            event,
          );

        expect(html).not.toContain("affectedStatusPages");
        expect(html).not.toContain("incidentLabels");
      },
    );

    test.each(INCIDENT_EVENTS)(
      "%s warns that the affected status pages are internal",
      (event: StatusPageSubscriberNotificationEventType) => {
        const affected: SubscriberNotificationTemplateVariable | undefined =
          SubscriberNotificationTemplateVariables.getAvailableVariablesForEventType(
            event,
          ).find((variable: SubscriberNotificationTemplateVariable) => {
            return variable.name === "affectedStatusPages";
          });

        expect(affected?.description).toMatch(/Internal/);
      },
    );
  });

  test("the report documents its structured fields rather than flat values", () => {
    const report: Array<string> = names(Event.SubscriberReport);

    expect(report).toContain("report.averageUptimePercent");
    expect(report).toContain("report.rows");
  });
});
