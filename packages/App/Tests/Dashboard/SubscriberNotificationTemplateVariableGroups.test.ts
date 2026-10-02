import { describe, expect, test } from "@jest/globals";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import {
  TemplateVariable,
  TemplateVariableGroup,
} from "Common/Types/Template/TemplateVariable";
import {
  SUBSCRIBER_REPORT_LOOP_DOCUMENTATION,
  SUBSCRIBER_TEMPLATE_STATUS_PAGE_GROUP_TITLE,
  getSubscriberNotificationTemplateVariableGroups,
  getSubscriberNotificationTemplateVariablesDocumentation,
  isIncidentSubscriberNotificationEvent,
} from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateVariables";

/*
 * A custom subscriber notification template's fields offer the event's
 * variables under them (and behind the code editor's Insert variable, and
 * when "{{" is typed), from the same rows the template's reference card
 * renders as a table. They must be the variables the reference documents and
 * the workers fill (SubscriberNotificationTemplateVariables) - no more, no
 * fewer, each once - and only ones that can be picked as they are: never the
 * custom field family's "<key>" pattern (the form lists the project's own
 * fields) and never a report loop's {{this.*}}, which only means something
 * inside its loop.
 */

const EVENTS: Array<StatusPageSubscriberNotificationEventType> = Object.values(
  StatusPageSubscriberNotificationEventType,
);

const FLAT_EVENTS: Array<StatusPageSubscriberNotificationEventType> =
  EVENTS.filter((event: StatusPageSubscriberNotificationEventType): boolean => {
    return event !== StatusPageSubscriberNotificationEventType.SubscriberReport;
  });

function namesOf(groups: Array<TemplateVariableGroup>): Array<string> {
  return groups.flatMap((group: TemplateVariableGroup): Array<string> => {
    return group.variables.map((variable: TemplateVariable): string => {
      return variable.name;
    });
  });
}

// The names the reference table documents for the event, families excluded.
function documented(
  event: StatusPageSubscriberNotificationEventType | undefined,
): Array<string> {
  const markdown: string =
    getSubscriberNotificationTemplateVariablesDocumentation(event);

  return Array.from(
    new Set(
      Array.from(
        markdown.matchAll(/^\|\s*`\{\{([\w.]+)\}\}`\s*\|/gm),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  ).sort();
}

describe("the subscriber template editor's variables", () => {
  test.each(FLAT_EVENTS)(
    "for %s: exactly the variables the event offers, each once",
    (event: StatusPageSubscriberNotificationEventType) => {
      const names: Array<string> = namesOf(
        getSubscriberNotificationTemplateVariableGroups(event),
      );

      expect(new Set(names).size).toBe(names.length);
      expect([...names].sort()).toEqual(documented(event));
      expect([...names].sort()).toEqual(
        [
          ...SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
            event,
          ),
        ].sort(),
      );
    },
  );

  test.each(EVENTS)(
    "for %s: nothing that cannot be picked as it is",
    (event: StatusPageSubscriberNotificationEventType) => {
      for (const name of namesOf(
        getSubscriberNotificationTemplateVariableGroups(event),
      )) {
        expect(name).not.toContain("<");
        expect(name.startsWith("this.")).toBe(false);
        expect(name.startsWith("customFields.")).toBe(false);
        expect(name).toMatch(/^[\w.]+$/);
      }
    },
  );

  test.each(FLAT_EVENTS)(
    "for %s: the status page's own first, then the event's",
    (event: StatusPageSubscriberNotificationEventType) => {
      const groups: Array<TemplateVariableGroup> =
        getSubscriberNotificationTemplateVariableGroups(event);

      expect(groups[0]!.title).toBe(
        SUBSCRIBER_TEMPLATE_STATUS_PAGE_GROUP_TITLE,
      );
      expect(namesOf([groups[0]!])).toEqual(
        expect.arrayContaining(["statusPageName", "statusPageUrl"]),
      );

      for (const group of groups) {
        expect(group.variables.length).toBeGreaterThan(0);
      }
    },
  );

  test("an incident event's own group is the incident's, with its labels and status pages", () => {
    for (const event of FLAT_EVENTS) {
      if (!isIncidentSubscriberNotificationEvent(event)) {
        continue;
      }

      const groups: Array<TemplateVariableGroup> =
        getSubscriberNotificationTemplateVariableGroups(event);

      expect(groups[1]!.title).toBe("Incident");
      expect(namesOf([groups[1]!])).toEqual(
        expect.arrayContaining(["incidentLabels", "affectedStatusPages"]),
      );
    }
  });

  test("the other events' groups are named after what they are about", () => {
    const titleOf: (
      event: StatusPageSubscriberNotificationEventType,
    ) => string | undefined = (
      event: StatusPageSubscriberNotificationEventType,
    ): string | undefined => {
      return getSubscriberNotificationTemplateVariableGroups(event)[1]?.title;
    };

    expect(
      titleOf(
        StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated,
      ),
    ).toBe("Incident Episode");
    expect(
      titleOf(
        StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
      ),
    ).toBe("Scheduled Maintenance");
    expect(
      titleOf(
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
      ),
    ).toBe("Announcement");
  });

  test("a subscription message is about no resource: no resourcesAffected", () => {
    for (const event of [
      StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation,
      StatusPageSubscriberNotificationEventType.SubscriberSubscribed,
      StatusPageSubscriberNotificationEventType.SubscriberManageSubscription,
    ]) {
      expect(
        namesOf(getSubscriberNotificationTemplateVariableGroups(event)),
      ).not.toContain("resourcesAffected");
    }
  });

  test("the report offers its top-level variables, and documents its loops apart", () => {
    const names: Array<string> = namesOf(
      getSubscriberNotificationTemplateVariableGroups(
        StatusPageSubscriberNotificationEventType.SubscriberReport,
      ),
    );

    expect(names).toEqual(
      expect.arrayContaining([
        "statusPageName",
        "report.averageUptimePercent",
        "report.rows",
      ]),
    );
    expect([...names].sort()).toEqual(
      documented(
        StatusPageSubscriberNotificationEventType.SubscriberReport,
      ).filter((name: string): boolean => {
        return !name.startsWith("this.");
      }),
    );

    // The loop fields are in the documentation that goes with the list.
    expect(SUBSCRIBER_REPORT_LOOP_DOCUMENTATION).toContain(
      "{{this.resourceName}}",
    );
    expect(
      getSubscriberNotificationTemplateVariablesDocumentation(
        StatusPageSubscriberNotificationEventType.SubscriberReport,
      ),
    ).toContain(SUBSCRIBER_REPORT_LOOP_DOCUMENTATION);
  });

  test("descriptions are plain words: the table's code marks are gone", () => {
    for (const event of EVENTS) {
      for (const group of getSubscriberNotificationTemplateVariableGroups(
        event,
      )) {
        for (const variable of group.variables) {
          expect(variable.description).not.toContain("`");
          expect(variable.description.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("before an event is picked, the status page's variables are there", () => {
    const names: Array<string> = namesOf(
      getSubscriberNotificationTemplateVariableGroups(undefined),
    );

    expect(names).toContain("statusPageName");
    expect([...names].sort()).toEqual(documented(undefined));
  });
});
