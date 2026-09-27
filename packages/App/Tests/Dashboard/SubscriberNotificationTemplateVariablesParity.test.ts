import { describe, expect, test } from "@jest/globals";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberNotificationTemplateVariables, {
  SubscriberNotificationTemplateDynamicVariable,
} from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import { getSubscriberNotificationTemplateVariablesDocumentation } from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateVariables";
import { getDefaultSubscriberNotificationTemplate } from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";

/*
 * Three things describe the variables of a custom subscriber notification
 * template, and they must agree:
 *   - SubscriberNotificationTemplateVariables, which the workers are tested
 *     against (each worker must pass every variable it lists);
 *   - the variable reference the template form shows the author;
 *   - the starter templates the form pre-fills.
 * A variable the reference shows but the list lacks is one no worker is held
 * to, so it renders empty; a starter that uses an unlisted variable ships an
 * empty placeholder to subscribers on day one.
 *
 * The uptime report is rendered through Handlebars with a structured `report`
 * object and loop-scoped `this.*` fields, so its reference is richer than a
 * flat list and is left out of the exact comparison.
 *
 * Some variables come in families listed by prefix rather than by name - an
 * incident's {{customFields.<key>}}, one per custom field of the project. The
 * reference documents a family as one row with its key left open
 * (`{{customFields.<key>}}`), and a starter may use any member of a family
 * the event offers.
 */

const FLAT_EVENTS: Array<StatusPageSubscriberNotificationEventType> =
  Object.values(StatusPageSubscriberNotificationEventType).filter(
    (event: StatusPageSubscriberNotificationEventType): boolean => {
      return (
        event !== StatusPageSubscriberNotificationEventType.SubscriberReport
      );
    },
  );

function listed(
  event: StatusPageSubscriberNotificationEventType,
): Array<string> {
  return [
    ...SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
      event,
    ),
  ].sort();
}

function documented(
  event: StatusPageSubscriberNotificationEventType,
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

// The families the reference documents, as "prefix<placeholder>".
function documentedFamilies(
  event: StatusPageSubscriberNotificationEventType,
): Array<string> {
  const markdown: string =
    getSubscriberNotificationTemplateVariablesDocumentation(event);

  return Array.from(
    new Set(
      Array.from(
        markdown.matchAll(/^\|\s*`\{\{([\w.]+<\w+>)\}\}`\s*\|/gm),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  ).sort();
}

function listedFamilies(
  event: StatusPageSubscriberNotificationEventType,
): Array<string> {
  return SubscriberNotificationTemplateVariables.getDynamicVariablesForEventType(
    event,
  )
    .map((family: SubscriberNotificationTemplateDynamicVariable): string => {
      return `${family.prefix}${family.placeholder}`;
    })
    .sort();
}

function usedByStarters(
  event: StatusPageSubscriberNotificationEventType,
): Array<string> {
  const used: Set<string> = new Set<string>();

  for (const method of Object.values(StatusPageSubscriberNotificationMethod)) {
    const starter: ReturnType<typeof getDefaultSubscriberNotificationTemplate> =
      getDefaultSubscriberNotificationTemplate(event, method);

    if (!starter) {
      continue;
    }

    for (const match of `${starter.subject || ""}\n${starter.body}`.matchAll(
      /\{\{\s*([\w.]+)\s*\}\}/g,
    )) {
      used.add(match[1]!);
    }
  }

  return Array.from(used).sort();
}

describe("subscriber template variables agree across the list, the reference and the starters", () => {
  test.each(FLAT_EVENTS)(
    "the template form documents exactly the variables %s offers",
    (event: StatusPageSubscriberNotificationEventType) => {
      expect(documented(event)).toEqual(listed(event));
    },
  );

  test.each(FLAT_EVENTS)(
    "the template form documents exactly the variable families %s offers",
    (event: StatusPageSubscriberNotificationEventType) => {
      expect(documentedFamilies(event)).toEqual(listedFamilies(event));
    },
  );

  test.each(FLAT_EVENTS)(
    "the %s starters only use offered variables",
    (event: StatusPageSubscriberNotificationEventType) => {
      for (const variable of usedByStarters(event)) {
        expect({
          variable,
          offered: SubscriberNotificationTemplateVariables.isVariableOffered(
            event,
            variable,
          ),
        }).toEqual({ variable, offered: true });
      }
    },
  );

  test("the incident events document their custom fields, labels and pages", () => {
    for (const event of [
      StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
      StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
      StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished,
    ]) {
      expect(documentedFamilies(event)).toEqual(["customFields.<key>"]);
      expect(documented(event)).toEqual(
        expect.arrayContaining(["incidentLabels", "affectedStatusPages"]),
      );
    }

    expect(
      documentedFamilies(
        StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated,
      ),
    ).toEqual([]);
  });

  test("the parser finds variables, so the comparison cannot pass on empty input", () => {
    expect(
      documented(
        StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated,
      ),
    ).toEqual(
      expect.arrayContaining([
        "scheduledMaintenanceDescription",
        "scheduledMaintenanceState",
        "postedAt",
        "note",
        "resourcesAffected",
      ]),
    );
    expect(
      usedByStarters(
        StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
      ),
    ).toEqual(expect.arrayContaining(["incidentState", "postedAt", "note"]));
  });

  test("the report reference still covers every top-level report variable the list offers", () => {
    const reference: string =
      getSubscriberNotificationTemplateVariablesDocumentation(
        StatusPageSubscriberNotificationEventType.SubscriberReport,
      );

    for (const variable of listed(
      StatusPageSubscriberNotificationEventType.SubscriberReport,
    ).filter((name: string): boolean => {
      return name.startsWith("report.");
    })) {
      expect(reference).toContain(`{{${variable}}}`);
    }
  });
});
