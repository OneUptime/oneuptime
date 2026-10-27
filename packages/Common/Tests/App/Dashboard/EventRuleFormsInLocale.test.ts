import { beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import fs from "fs";
import path from "path";
import type Field from "../../../UI/Components/Forms/Types/Field";
import {
  MAINTENANCE_REMINDER_INTERVAL_DESCRIPTION,
  ON_CALL_RULE_NAME_DESCRIPTION,
  ON_CALL_RULE_NAME_WORDING,
  ON_CALL_RULE_POLICIES_DESCRIPTION,
  PRIVACY_RULE_NAMES,
  PRIVACY_RULE_NAME_DESCRIPTIONS,
  PrivacyRuleRecord,
  REMINDER_INTERVAL_DESCRIPTIONS,
  REMINDER_RULE_NAME_DESCRIPTION,
  REMINDER_RULE_NAME_WORDING,
  REMINDER_STOP_OPTION_DESCRIPTIONS,
  RUNBOOK_RULE_NAME_DESCRIPTION,
  RUNBOOK_RULE_NAME_WORDING,
  RUNBOOK_RULE_RUNBOOKS_DESCRIPTION,
  SLA_RULE_NAME_DESCRIPTION,
  SLA_RULE_NAME_WORDING,
  getMaintenanceReminderRuleName,
  getNewSlaRuleValues,
  getOnCallRuleActionFields,
  getOnCallRuleFormSteps,
  getOnCallRuleName,
  getPrivacyRuleActionFields,
  getReminderRuleActionFields,
  getReminderRuleFormSteps,
  getReminderRuleName,
  getRunbookRuleActionFields,
  getRunbookRuleName,
  getSlaRuleFormSteps,
  getSlaRuleName,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/EventRuleForm";
import { OnCallRuleRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText";
import {
  MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE,
  MAINTENANCE_REMINDER_NEVER_REMINDS_TEXT,
  MAINTENANCE_REMINDER_RULE_NAME_WORDING,
  MAINTENANCE_REMINDER_TIMINGS,
  MAINTENANCE_REMINDER_TIMING_COLUMNS,
  MAINTENANCE_REMINDER_TIMING_COPY,
  MAINTENANCE_REMINDER_TIMING_FIELD_TITLE,
  MaintenanceReminderTiming,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/MaintenanceReminderTiming";
import ReminderStopState from "../../../Types/Reminder/ReminderStopState";
import ReminderRuleScope from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/ReminderRuleScope";
import {
  REMINDERS_SWITCH_SCOPE_COPY,
  RemindersSwitchScopeCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/RemindersSwitchCopy";

/*
 * The on-call, privacy, SLA, reminder and runbook rule forms of Incidents,
 * Alerts and Scheduled Maintenance, and the create forms' plainer help, in every
 * language the Dashboard ships - read from the locale files themselves:
 *
 *   - every word these forms add is the language's own, and every sentence
 *     listed for a page is still on that page;
 *   - a new rule's name is filled in in the reader's language: "Alle 30
 *     Minuten erinnern, bis behoben", not the English one;
 *   - a language that has not worded a name's sentence reads one English
 *     name, its duration English too - never "Remind every 30 Minuten until
 *     resolved".
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const LANGUAGES: Array<string> = [
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

// A language with German's words but not the reminder rule's name sentence.
const PARTLY_WORDED: string = "zz";

const PRIVACY_RECORDS: Array<PrivacyRuleRecord> = [
  "incident",
  "incidentEpisode",
  "alert",
  "alertEpisode",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

/*
 * The sentences the pages hand their cards, help panels and fields, by page.
 * Written out here so a language that lost one is caught; the first test
 * holds each to its page, so a reworded page is caught too.
 */
const PAGE_SENTENCES: Record<string, Array<string>> = {
  "Pages/Incidents/Settings/IncidentOnCallRules.tsx": [
    "Page on-call policies automatically for new incidents that match.",
    "Which new incidents page which on-call policies.",
    "Page on-call policies automatically for new incident episodes that match.",
    "Which new episodes page which on-call policies.",
  ],
  "Pages/Alerts/Settings/AlertOnCallRules.tsx": [
    "Page on-call policies automatically for new alerts that match.",
    "Which new alerts page which on-call policies.",
    "Page on-call policies automatically for new alert episodes that match.",
    "Which new episodes page which on-call policies.",
  ],
  "Pages/Incidents/Settings/IncidentPrivacyRules.tsx": [
    "Make new incidents private when they match.",
    "Which new incidents become private.",
    "Make new incident episodes private when they match.",
    "Which new episodes become private.",
  ],
  "Pages/Alerts/Settings/AlertPrivacyRules.tsx": [
    "Make new alerts private when they match.",
    "Which new alerts become private.",
    "Make new alert episodes private when they match.",
    "Which new episodes become private.",
  ],
  "Pages/Incidents/Settings/IncidentSlaRules.tsx": [
    "Track how fast incidents are acknowledged and resolved. The first rule that matches an incident applies - drag a rule to change its place.",
    "What an SLA rule tracks, which incidents it applies to, and the notes it can post.",
    "How long the team has to acknowledge the incident. Leave empty to not track it.",
    "How long the team has to resolve the incident. Leave empty to not track it.",
    "The SLA is at risk once this much of a deadline has passed. Default is 80%.",
    "e.g. Respond in 15 minutes",
  ],
  "Pages/Incidents/Create.tsx": [
    "How serious is it?",
    "The on-call policies to page as soon as the incident is declared.",
  ],
  "Pages/Incidents/Settings/IncidentTemplates.tsx": [
    "How serious is it?",
    "The on-call policies to page as soon as the incident is declared.",
  ],
  "Pages/Incidents/Settings/IncidentTemplatesView.tsx": [
    "How serious is it?",
    "The on-call policies to page as soon as the incident is declared.",
  ],
  "Pages/Incidents/View/Index.tsx": ["How serious is it?"],
  "Pages/Incidents/EpisodeCreate.tsx": [
    "How serious is it?",
    "The on-call policies to page as soon as the episode is created.",
  ],
  "Pages/Alerts/Create.tsx": [
    "How serious is it?",
    "The on-call policies to page as soon as the alert is created.",
  ],
  "Pages/Alerts/EpisodeCreate.tsx": [
    "How serious is it?",
    "The on-call policies to page as soon as the episode is created.",
  ],
  "Pages/ScheduledMaintenanceEvents/Create.tsx": [
    "Plan maintenance ahead, and tell your team and your status page subscribers when it happens.",
  ],
  // The reminder rules' help panels: what a rule decides, in plain words.
  "Pages/Incidents/Settings/IncidentReminderRules.tsx": [
    "How often an open incident's owners are reminded, and until when.",
  ],
  "Pages/Alerts/Settings/AlertReminderRules.tsx": [
    "How often an open alert's owners are reminded, and until when.",
  ],
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceReminderRules.tsx":
    ["How often an event's owners are reminded, and when."],
};

function fieldTitlesAndDescriptions(
  fields: Array<Field<Record<string, unknown>>>,
): Array<string> {
  const words: Array<string> = [];

  for (const field of fields) {
    for (const text of [field.title, field.description, field.placeholder]) {
      if (typeof text === "string" && text) {
        words.push(text);
      }
    }

    for (const option of field.radioButtonOptions || []) {
      words.push(option.title);

      if (option.description) {
        words.push(option.description);
      }
    }
  }

  return words;
}

// What the shared form pieces read the same in every language, or own elsewhere.
const SHARED_WORDS: Set<string> = new Set([
  "Match",
  "Name",
  "Enabled",
  "Description",
  "On-Call Duty Policies",
  "Select On-Call Policies",
  "Resolved",
  "Acknowledged",
  "30",
  // OneUptime AI's default hold time, the placeholder of its field.
  "10",
  // A loanword in several languages (German, French, Spanish ...).
  "Runbooks",
]);

// Every word the rule forms add, from the modules that draw them.
function ruleFormWords(): Array<string> {
  const words: Array<string> = [
    ...getOnCallRuleFormSteps().map((step: { title: string }): string => {
      return step.title;
    }),
    ...getSlaRuleFormSteps().map((step: { title: string }): string => {
      return step.title;
    }),
    ...getReminderRuleFormSteps().map((step: { title: string }): string => {
      return step.title;
    }),
    ON_CALL_RULE_NAME_WORDING.allPicks,
    ON_CALL_RULE_NAME_WORDING.somePicks.other,
    ON_CALL_RULE_POLICIES_DESCRIPTION,
    ON_CALL_RULE_NAME_DESCRIPTION,
    ...Object.values(PRIVACY_RULE_NAMES),
    ...Object.values(PRIVACY_RULE_NAME_DESCRIPTIONS),
    SLA_RULE_NAME_WORDING.both,
    SLA_RULE_NAME_WORDING.response,
    SLA_RULE_NAME_WORDING.resolution,
    SLA_RULE_NAME_DESCRIPTION,
    ...Object.values(REMINDER_RULE_NAME_WORDING),
    REMINDER_RULE_NAME_DESCRIPTION,
    ...Object.values(REMINDER_INTERVAL_DESCRIPTIONS),
    ...Object.values(REMINDER_STOP_OPTION_DESCRIPTIONS).flatMap(
      (descriptions: Record<ReminderStopState, string>): Array<string> => {
        return Object.values(descriptions);
      },
    ),
    ...fieldTitlesAndDescriptions(
      getOnCallRuleActionFields<Record<string, unknown>>(
        OnCallRuleRecord.Alert,
      ),
    ),
    ...fieldTitlesAndDescriptions(
      getReminderRuleActionFields<Record<string, unknown>>("incident"),
    ),
    RUNBOOK_RULE_NAME_WORDING.allPicks,
    RUNBOOK_RULE_NAME_WORDING.somePicks.other,
    RUNBOOK_RULE_RUNBOOKS_DESCRIPTION,
    RUNBOOK_RULE_NAME_DESCRIPTION,
    ...fieldTitlesAndDescriptions(
      getRunbookRuleActionFields<Record<string, unknown>>(),
    ),
    MAINTENANCE_REMINDER_INTERVAL_DESCRIPTION,
    MAINTENANCE_REMINDER_TIMING_FIELD_TITLE,
    MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE,
    MAINTENANCE_REMINDER_NEVER_REMINDS_TEXT,
    // The Reminders card on a record's Settings page, which these rules drive.
    ...Object.values(REMINDERS_SWITCH_SCOPE_COPY).flatMap(
      (copy: RemindersSwitchScopeCopy): Array<string> => {
        return [copy.cardDescription, copy.switchOnDescription];
      },
    ),
    ...Object.values(MAINTENANCE_REMINDER_RULE_NAME_WORDING),
    ...Object.values(MAINTENANCE_REMINDER_TIMING_COPY).flatMap(
      (copy: { title: string; description: string }): Array<string> => {
        return [copy.title, copy.description];
      },
    ),
    ...Object.values(PAGE_SENTENCES).flat(),
  ];

  return Array.from(new Set(words)).filter((word: string): boolean => {
    return !SHARED_WORDS.has(word);
  });
}

function fill(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const [key, value] of Object.entries(values)) {
    text = text.split(`{{${key}}}`).join(value);
  }

  return text;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: LOCALES[language]! };
  }

  const partly: Record<string, string> = { ...LOCALES["de"]! };
  delete partly[REMINDER_RULE_NAME_WORDING[ReminderStopState.Resolved]];
  resources[PARTLY_WORDED] = { translation: partly };

  await i18next.init({
    lng: "de",
    fallbackLng: false,
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

describe("the sentences listed for each page", () => {
  test.each(Object.entries(PAGE_SENTENCES))(
    "are on %s",
    (file: string, sentences: Array<string>) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, file),
        "utf8",
      );

      for (const sentence of sentences) {
        expect({
          file,
          sentence,
          onPage: source.includes(`"${sentence}"`),
        }).toEqual({ file, sentence, onPage: true });
      }
    },
  );
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  const words: Record<string, string> = LOCALES[language]!;

  beforeAll(async () => {
    await i18next.changeLanguage(language);
  });

  test("every word the rule and create forms add is the language's own", () => {
    for (const english of ruleFormWords()) {
      expect({
        english,
        translated: words[english] !== undefined && words[english] !== english,
      }).toEqual({ english, translated: true });
    }
  });

  test("an on-call rule is named after its policies in the language", () => {
    expect(getOnCallRuleName(["Platform on-call"])).toBe(
      fill(words[ON_CALL_RULE_NAME_WORDING.allPicks]!, {
        policies: "Platform on-call",
      }),
    );
  });

  test("a runbook rule is named after its runbooks in the language", () => {
    expect(getRunbookRuleName(["Database failover"])).toBe(
      fill(words[RUNBOOK_RULE_NAME_WORDING.allPicks]!, {
        runbooks: "Database failover",
      }),
    );
    // The runbook's own name is never translated.
    expect(getRunbookRuleName(["Database failover"])).toContain(
      "Database failover",
    );
  });

  test("a privacy rule starts with the language's name for what it does", () => {
    for (const record of PRIVACY_RECORDS) {
      const name: Field<Record<string, unknown>> =
        getPrivacyRuleActionFields<Record<string, unknown>>(record)[0]!;

      expect(name.defaultValue).toBe(words[PRIVACY_RULE_NAMES[record]]);
      expect(name.description).toBe(PRIVACY_RULE_NAME_DESCRIPTIONS[record]);
    }
  });

  test("a new reminder rule's name says how often and until when, in the language", () => {
    const name: Field<Record<string, unknown>> | undefined =
      getReminderRuleActionFields<Record<string, unknown>>("alert").find(
        (field: Field<Record<string, unknown>>): boolean => {
          return Object.keys(field.field || {})[0] === "name";
        },
      );

    expect(name?.defaultValue).toBe(
      fill(words[REMINDER_RULE_NAME_WORDING[ReminderStopState.Resolved]]!, {
        interval: fill(words["{{count}} minutes"]!, { count: "30" }),
      }),
    );

    expect(
      getReminderRuleName({
        reminderIntervalInMinutes: 60,
        stopRemindersOnState: ReminderStopState.Acknowledged,
      }),
    ).toBe(
      fill(words[REMINDER_RULE_NAME_WORDING[ReminderStopState.Acknowledged]]!, {
        interval: words["1 hour"]!,
      }),
    );
  });

  test("an SLA rule is named after its targets in the language", () => {
    expect(
      getSlaRuleName({
        responseTimeInMinutes: 15,
        resolutionTimeInMinutes: 240,
      }),
    ).toBe(
      fill(words[SLA_RULE_NAME_WORDING.both]!, {
        response: fill(words["{{count}} minutes"]!, { count: "15" }),
        resolution: fill(words["{{count}} hours"]!, { count: "4" }),
      }),
    );

    expect(getSlaRuleName({ resolutionTimeInMinutes: 1440 })).toBe(
      fill(words[SLA_RULE_NAME_WORDING.resolution]!, {
        resolution: words["1 day"]!,
      }),
    );
  });

  test("a new SLA rule starts named after its targets, in the language", () => {
    expect(getNewSlaRuleValues<Record<string, unknown>>()).toEqual({
      responseTimeInMinutes: 15,
      resolutionTimeInMinutes: 240,
      name: fill(words[SLA_RULE_NAME_WORDING.both]!, {
        response: fill(words["{{count}} minutes"]!, { count: "15" }),
        resolution: fill(words["{{count}} hours"]!, { count: "4" }),
      }),
    });
  });

  test("the Reminders card leaves when reminders stop to the rules, in the language", () => {
    for (const scope of Object.values(ReminderRuleScope)) {
      const english: string =
        REMINDERS_SWITCH_SCOPE_COPY[scope].switchOnDescription;

      // No stop of its own: the rule decides it.
      expect(english).toContain("for as long");
      expect(words[english]).toBeDefined();
      expect(words[english]).not.toBe(english);
    }
  });

  test("a maintenance reminder rule is named after its one choice in the language", () => {
    for (const timing of MAINTENANCE_REMINDER_TIMINGS) {
      expect(
        getMaintenanceReminderRuleName({
          reminderIntervalInMinutes: 60,
          ...MAINTENANCE_REMINDER_TIMING_COLUMNS[timing],
        }),
      ).toBe(
        fill(words[MAINTENANCE_REMINDER_RULE_NAME_WORDING[timing]]!, {
          interval: words["1 hour"]!,
        }),
      );
    }
  });
});

describe("a language that has not worded a name's sentence", () => {
  beforeAll(async () => {
    await i18next.changeLanguage(PARTLY_WORDED);
  });

  test("reads the whole name in English, its duration too", () => {
    // Its duration is worded: German's.
    expect(LOCALES["de"]!["{{count}} minutes"]).toBe("{{count}} Minuten");

    expect(
      getReminderRuleName({
        reminderIntervalInMinutes: 30,
        stopRemindersOnState: ReminderStopState.Resolved,
      }),
    ).toBe("Remind every 30 minutes until resolved");

    // The sentences it does word still take its own duration.
    expect(
      getMaintenanceReminderRuleName({
        reminderIntervalInMinutes: 30,
        ...MAINTENANCE_REMINDER_TIMING_COLUMNS[
          MaintenanceReminderTiming.WhileInProgress
        ],
      }),
    ).toBe("Alle 30 Minuten erinnern, solange es läuft");
  });
});
