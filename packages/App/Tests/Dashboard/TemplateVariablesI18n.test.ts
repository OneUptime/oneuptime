import TemplateVariablesCopy, {
  TYPING_HINT_SLOT,
} from "Common/UI/Components/TemplateVariables/TemplateVariablesCopy";
import {
  ALERT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
  INCIDENT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
} from "Common/Utils/Episode/EpisodeTemplateVariables";
import { INCIDENT_SLA_NOTE_TEMPLATE_VARIABLES } from "Common/Utils/Incident/IncidentSlaNoteTemplateVariables";
import {
  TemplateVariable,
  TemplateVariableGroup,
  TemplateVariableGroups,
} from "Common/Types/Template/TemplateVariable";
import NoteTemplateFormCopy from "../../FeatureSet/Dashboard/src/Components/NoteTemplate/NoteTemplateFormCopy";
import IncidentSlaNoteReminderCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentSlaNoteReminderCopy";
import MonitorCriteriaTemplateCopy from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaTemplateCopy";
import EpisodeTemplateVariablesCopy from "../../FeatureSet/Dashboard/src/Components/IncidentGroupingRule/EpisodeTemplateVariablesCopy";
import SubscriberTemplateVariablesCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberTemplateVariablesCopy";
import { SUBSCRIBER_TEMPLATE_STATUS_PAGE_GROUP_TITLE } from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateVariables";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The words the template variable pickers bring to the Dashboard - the
 * collapsed Template variables list, the Insert variable button, the "{{"
 * suggestions - and the words around the template fields that now offer
 * them, reach the screen by looking their English text up in the Dashboard
 * locale files. A string with no entry silently stays English, so this pins:
 *
 *   - en.json maps every string to itself, and all sixteen other locales
 *     carry a translation of their own with the same {{placeholders}};
 *   - only the typing hint holds braces, and they are its {{braces}} slot,
 *     which the list fills with a key it draws itself;
 *   - the labels the variables reuse ("Title", "Severity") are there too.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function wordsOf(groups: TemplateVariableGroups): Array<string> {
  return groups.flatMap((group: TemplateVariableGroup): Array<string> => {
    return [
      ...(group.title ? [group.title] : []),
      ...(group.description ? [group.description] : []),
      ...group.variables.map((variable: TemplateVariable): string => {
        return variable.description;
      }),
    ];
  });
}

// New with the pickers: each must have a translation of its own.
const NEW_STRINGS: Array<string> = Array.from(
  new Set([
    ...Object.values(TemplateVariablesCopy),
    ...Object.values(NoteTemplateFormCopy).filter((text: string): boolean => {
      return text !== NoteTemplateFormCopy.noteFieldTitle;
    }),
    ...Object.values(IncidentSlaNoteReminderCopy),
    ...Object.values(MonitorCriteriaTemplateCopy),
    ...Object.values(EpisodeTemplateVariablesCopy),
    ...Object.values(SubscriberTemplateVariablesCopy),
    "Time Open",
    "SLA Status",
    "Response Deadline",
    "Resolution Deadline",
    "Time Left to Respond",
    "Time Left to Resolve",
    "From the first incident",
    "Updated as incidents join",
    "From the first alert",
    "Updated as alerts join",
    "Number of incidents in the episode",
    "Number of alerts in the episode",
  ]),
);

// Labels other pages had first, which the variables reuse.
const SHARED_STRINGS: Array<string> = [
  "Note",
  "Title",
  "Description",
  "Severity",
  "Monitor Name",
  "Incident Number",
  "Incident",
  "Custom Fields",
  "Incident Custom Fields",
  "Incident Episode",
  "Scheduled Maintenance",
  "Announcement",
  SUBSCRIBER_TEMPLATE_STATUS_PAGE_GROUP_TITLE,
];

// Every word a template field's variables show, looked up.
const VARIABLE_WORDS: Array<string> = Array.from(
  new Set([
    ...INCIDENT_SLA_NOTE_TEMPLATE_VARIABLES.map(
      (variable: TemplateVariable): string => {
        return variable.description;
      },
    ),
    ...wordsOf(INCIDENT_EPISODE_TEMPLATE_VARIABLE_GROUPS),
    ...wordsOf(ALERT_EPISODE_TEMPLATE_VARIABLE_GROUPS),
  ]),
);

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("the template variable strings in every Dashboard locale", () => {
  test("there are strings to check, and every variable's words are among them", () => {
    expect(NEW_STRINGS.length).toBeGreaterThan(30);

    for (const word of VARIABLE_WORDS) {
      expect([...NEW_STRINGS, ...SHARED_STRINGS]).toContain(word);
    }
  });

  test("only the typing hint holds braces, and they are its slot", () => {
    for (const text of NEW_STRINGS) {
      if (text === TemplateVariablesCopy.typingHint) {
        expect(placeholders(text)).toEqual([`{{${TYPING_HINT_SLOT}}}`]);
        continue;
      }

      expect(text).not.toContain("{{");
    }
  });

  test.each([...NEW_STRINGS, ...SHARED_STRINGS])(
    "en.json maps %j to itself",
    (text: string) => {
      expect(readLocale("en")[text]).toBe(text);
    },
  );

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(NEW_STRINGS)("translates %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(placeholders(value as string)).toEqual(placeholders(text));
      expect(value).not.toBe(text);
    });

    test.each(SHARED_STRINGS)("has %j", (text: string) => {
      expect(typeof translations[text]).toBe("string");
    });
  });
});

describe("the strings the variables replaced are gone from the locales", () => {
  // Nothing looks them up any more: the variables are under the fields now.
  const REPLACED: Array<string> = [
    "When this template is used in an incident's notes, these placeholders are filled in with the incident's values. A placeholder with no value stays as written.",
    "An incident custom field, by the Template Variable shown in the incident custom field settings",
    "Markdown. Variables: {{incidentTitle}}, {{elapsedTime}}, {{responseDeadline}}, {{resolutionDeadline}}, {{slaStatus}}.",
    "You can use template variables like {{statusPageName}}, etc. Please refer to the documentation below for available variables.",
    "Subject line for email notifications. You can use template variables like {{incidentTitle}}.",
    "Public or Private note template.",
  ];

  test.each(["en", ...OTHER_LOCALES])(
    "%s.json keeps none of them",
    (locale: string) => {
      const keys: Array<string> = Object.keys(readLocale(locale));

      for (const text of REPLACED) {
        expect(keys).not.toContain(text);
      }
    },
  );
});
