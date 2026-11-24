import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";

import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import IncidentGroupingConfig from "../../../Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * AN INCOMING REQUEST CRITERIA'S GROUPING SETTINGS, IN EVERY LANGUAGE
 * (#10584).
 *
 * The settings that split one webhook's incidents and alerts by a payload
 * field (MonitorCriteriaInstance) were worded in Japanese, Persian and
 * Arabic, and in German, French and Spanish but for a few lines. They read
 * English in Italian, Portuguese, Dutch, Danish, Norwegian, Swedish,
 * Russian, Korean, Chinese (Simplified and Traditional) and Hindi: the
 * switch, both steps, the help under them, the recovery field and value and
 * the safety cap. The docs quote each of them as the Dashboard draws it, so
 * they read English there too (IncomingRequestGroupingDocsLabels).
 *
 * Each is now worded in every language the Dashboard ships, with that
 * language's own word for an incident and an alert, and is drawn so: the
 * form below is rendered in every language and must not show one English
 * line of its grouping settings.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const PROGRESS_DIR: string = path.join(
  LOCALES_DIR,
  "..",
  "..",
  "i18n",
  "Progress",
);

const SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Form",
  "Monitor",
  "MonitorCriteriaInstance.tsx",
);

// Each line of the grouping settings, as en.json keys it.
const GROUP_SWITCH: string = "Group incidents and alerts by a payload field";
const GROUP_SWITCH_HELP: string =
  "Open a separate incident and alert for each value of a field in the request body, so one webhook can keep several open.";
const STEP_ONE: string = "Open a separate incident for each…";
const STEP_ONE_HELP: string =
  "A path into the request body — the same {{requestBody}} you reference in incident templates. Every distinct value opens its own incident; add {{wildcard}} to fan out over an array.";
const STEP_ONE_EXAMPLE: string = "e.g. one incident per Grafana alert name.";
const STEP_TWO: string = "Auto-resolve each incident when…";
const OPTIONAL: string = "(optional)";
const STEP_TWO_HELP: string =
  "A webhook only describes what is firing right now, so OneUptime cannot tell an incident has recovered unless the payload says so. Set the field and value that signal recovery. Leave blank to resolve these incidents manually.";
const RECOVERY_FIELD: string = "Field that signals recovery";
const RECOVERY_VALUE: string = "Value that means recovered";
const MAX_INCIDENTS: string = "Max incidents per request";
const MAX_INCIDENTS_HELP: string =
  "Safety cap so a high-cardinality field cannot open unbounded incidents. Defaults to 100.";

const GROUPING_SETTINGS: ReadonlyArray<string> = [
  GROUP_SWITCH,
  GROUP_SWITCH_HELP,
  STEP_ONE,
  STEP_ONE_HELP,
  STEP_ONE_EXAMPLE,
  STEP_TWO,
  OPTIONAL,
  STEP_TWO_HELP,
  RECOVERY_FIELD,
  RECOVERY_VALUE,
  MAX_INCIDENTS,
  MAX_INCIDENTS_HELP,
];

/*
 * The description of a criteria's Filters, beside the grouping settings in
 * the same form, which read English in the same eleven languages.
 */
const FILTERS_HELP_METRICS: string =
  "Define when this alert should trigger based on metric values.";
const FILTERS_HELP: string = "Add criteria for different monitor properties.";

const EVERY_LINE: ReadonlyArray<string> = [
  ...GROUPING_SETTINGS,
  FILTERS_HELP_METRICS,
  FILTERS_HELP,
];

// What the help under step one puts in its slots.
const STEP_ONE_SLOTS: Record<string, string> = {
  "{{requestBody}}": "requestBody",
  "{{wildcard}}": "[*]",
};

/*
 * Each language's word for an incident, an alert and a monitor: the word
 * its Incidents, Alerts and Monitors pages say (the first test holds each to
 * the locale's own keys), which every line naming one says too
 * (OneWordInSentencesPerThing).
 */
interface Words {
  incident: RegExp;
  alert: RegExp;
  monitor: RegExp;
}

const WORDS: Record<string, Words> = {
  de: { incident: /Vorf[aä]ll/, alert: /Warnung/, monitor: /Monitor/ },
  fr: { incident: /incident/i, alert: /alerte/i, monitor: /moniteur/i },
  es: { incident: /incidente/i, alert: /alerta/i, monitor: /monitor/i },
  it: { incident: /incident[ei]/i, alert: /avvis[oi]/i, monitor: /monitor/i },
  pt: { incident: /incidente/i, alert: /alerta/i, monitor: /monitor/i },
  nl: { incident: /incident/i, alert: /waarschuwing/i, monitor: /monitor/i },
  da: { incident: /hændelse/i, alert: /advars/i, monitor: /monitor/i },
  no: { incident: /hendelse/i, alert: /varsel|varsl/i, monitor: /monitor/i },
  sv: { incident: /incident/i, alert: /larm/i, monitor: /monitor/i },
  ru: { incident: /инцидент/i, alert: /оповещени/i, monitor: /монитор/i },
  ja: { incident: /インシデント/, alert: /アラート/, monitor: /モニター/ },
  ko: { incident: /인시던트/, alert: /경고/, monitor: /모니터/ },
  "zh-CN": { incident: /事件/, alert: /警报/, monitor: /监视器/ },
  "zh-TW": { incident: /事件/, alert: /警示/, monitor: /監測器/ },
  hi: {
    incident: /घटना|घटनाएं|घटनाएँ|घटनाओं/,
    alert: /अलर्ट/,
    monitor: /मॉनिटर/,
  },
  fa: { incident: /حادثه|حوادث/, alert: /هشدار/, monitor: /مانیتور/ },
  ar: { incident: /حادث|حوادث/, alert: /تنبيه|تنبيهات/, monitor: /مراقب/ },
};

// The words Korean, Chinese, German and Swedish dropped for an alert (#8628, #8769).
const DROPPED_ALERT_WORDS: Record<string, RegExp> = {
  ko: /알림/,
  "zh-CN": /(?<!警)告警/,
  de: /\bAlarm(?!ier)/,
  sv: /\bavisering/i,
};

// The words Danish and Norwegian dropped for a monitor (#8628).
const DROPPED_MONITOR_WORDS: Record<string, RegExp> = {
  da: /overvågning/i,
  no: /overvåking/i,
};

// Whether a line's English names an incident, an alert or a monitor.
const NAMES_AN_INCIDENT: RegExp = /\bincidents?\b/i;
const NAMES_AN_ALERT: RegExp = /\balerts?\b/i;
const NAMES_A_MONITOR: RegExp = /\bmonitor\b/i;

type Locale = Record<string, unknown>;

const LOCALES: Record<string, Locale> = {};

function readLocale(code: string): Locale {
  if (!LOCALES[code]) {
    LOCALES[code] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
    ) as Locale;
  }

  return LOCALES[code]!;
}

// The English a language records as reading the same in its own words.
function sameAsEnglish(code: string): ReadonlyArray<string> {
  const file: string = path.join(PROGRESS_DIR, `${code}.json`);

  if (!fs.existsSync(file)) {
    return [];
  }

  return (
    (JSON.parse(fs.readFileSync(file, "utf8")) as { sameAsEnglish?: string[] })
      .sameAsEnglish || []
  );
}

function wordedIn(code: string, english: string): string {
  return String(readLocale(code)[english]);
}

// Whether a language words a line, or records that it reads the same.
function isWorded(code: string, english: string): boolean {
  const worded: unknown = readLocale(code)[english];

  if (typeof worded !== "string" || worded.trim() === "") {
    return false;
  }

  return worded !== english || sameAsEnglish(code).includes(english);
}

function placeholdersOf(text: string): Array<string> {
  return Array.from(new Set(text.match(/\{\{\s*\w+\s*\}\}/g) || [])).sort();
}

/*
 * The text as a person reads it: every run of space, a no-break one too, one
 * space, and without the invisible marks that keep a Latin slot in its place
 * in a right-to-left sentence.
 */
function asRead(text: string): string {
  return text
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const GROUPING: IncidentGroupingConfig = {
  groupByJSONPath: "requestBody.alerts[*].labels.alertname",
  resolvedWhenJSONPath: "requestBody.alerts[*].status",
  resolvedWhenValue: "resolved",
};

function groupedCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "firing",
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: "Grafana alert",
    description: "",
    incidentGrouping: GROUPING,
  };

  return instance;
}

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of [...DASHBOARD_LANGUAGES, "en"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: code,
      resources: { [code]: { translation: readLocale(code) as never } },
      interpolation: { escapeValue: false },
    });

    instances[code] = instance;
  }
});

afterEach(() => {
  cleanup();
});

// The criteria's form, with its grouping settings open, in one language.
function renderIn(code: string): string {
  render(
    <I18nextProvider i18n={instances[code]!}>
      <MemoryRouter>
        <MonitorCriteriaInstanceElement
          monitorType={MonitorType.IncomingRequest}
          monitorStep={new MonitorStep()}
          monitorStatusDropdownOptions={[]}
          incidentSeverityDropdownOptions={[]}
          alertSeverityDropdownOptions={[]}
          userDropdownOptions={[]}
          value={groupedCriteria()}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  return asRead(document.body.textContent || "");
}

// A line as the form draws it: the help under step one with its slots filled.
function asDrawn(code: string, english: string): string {
  let text: string = wordedIn(code, english);

  for (const [placeholder, slot] of Object.entries(STEP_ONE_SLOTS)) {
    text = text.split(placeholder).join(slot);
  }

  return asRead(text);
}

describe("the grouping settings' lines", () => {
  const source: string = fs.readFileSync(SOURCE, "utf8");

  test.each(
    EVERY_LINE.map((line: string): [string] => {
      return [line];
    }),
  )("%s is a line the form draws, keyed in en.json", (line: string) => {
    expect(source).toContain(JSON.stringify(line));
    expect(readLocale("en")[line]).toBe(line);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "the words %s is checked with are its Incidents, Alerts and Monitors pages' words",
    (code: string) => {
      const words: Words = WORDS[code]!;

      for (const english of ["Incident", "Incidents"]) {
        expect({ code, english, worded: wordedIn(code, english) }).toEqual({
          code,
          english,
          worded: expect.stringMatching(words.incident),
        });
      }

      for (const english of ["Alert", "Alerts"]) {
        expect({ code, english, worded: wordedIn(code, english) }).toEqual({
          code,
          english,
          worded: expect.stringMatching(words.alert),
        });
      }

      expect(wordedIn(code, "Monitors")).toMatch(words.monitor);
    },
  );

  test("every language the Dashboard ships has words to check", () => {
    expect(Object.keys(WORDS).sort()).toEqual([...DASHBOARD_LANGUAGES].sort());
  });
});

describe.each([...DASHBOARD_LANGUAGES])("in %s", (code: string) => {
  test("every line is worded, or recorded as reading the same", () => {
    const inEnglish: Array<string> = EVERY_LINE.filter(
      (english: string): boolean => {
        return !isWorded(code, english);
      },
    );

    expect({ code, inEnglish }).toEqual({ code, inEnglish: [] });
  });

  test("every line keeps its placeholders, and what it ends with", () => {
    for (const english of EVERY_LINE) {
      const worded: string = wordedIn(code, english);

      expect({ code, english, placeholders: placeholdersOf(worded) }).toEqual({
        code,
        english,
        placeholders: placeholdersOf(english),
      });

      // A step's label runs on into its field: it ends with "…" as the English does.
      if (english.endsWith("…")) {
        expect({ code, english, worded }).toEqual({
          code,
          english,
          worded: expect.stringMatching(/…$/),
        });
      }
    }
  });

  test("a line that names an incident, an alert or a monitor says the language's word for it", () => {
    const words: Words = WORDS[code]!;

    for (const english of EVERY_LINE) {
      const worded: string = wordedIn(code, english).replace(
        /\{\{\s*\w+\s*\}\}/g,
        " ",
      );

      if (NAMES_AN_INCIDENT.test(english)) {
        expect({ code, english, worded }).toEqual({
          code,
          english,
          worded: expect.stringMatching(words.incident),
        });
      }

      if (NAMES_AN_ALERT.test(english)) {
        expect({ code, english, worded }).toEqual({
          code,
          english,
          worded: expect.stringMatching(words.alert),
        });

        if (DROPPED_ALERT_WORDS[code]) {
          expect({ code, english, worded }).toEqual({
            code,
            english,
            worded: expect.not.stringMatching(DROPPED_ALERT_WORDS[code]!),
          });
        }
      }

      if (NAMES_A_MONITOR.test(english)) {
        expect({ code, english, worded }).toEqual({
          code,
          english,
          worded: expect.stringMatching(words.monitor),
        });

        if (DROPPED_MONITOR_WORDS[code]) {
          expect({ code, english, worded }).toEqual({
            code,
            english,
            worded: expect.not.stringMatching(DROPPED_MONITOR_WORDS[code]!),
          });
        }
      }
    }
  });

  test("the form draws every grouping setting in the language's words, and none in English", () => {
    const drawn: string = renderIn(code);

    for (const english of [...GROUPING_SETTINGS, FILTERS_HELP]) {
      expect({
        code,
        english,
        isDrawn: drawn.includes(asDrawn(code, english)),
      }).toEqual({ code, english, isDrawn: true });

      // A line the language reads the same, as German "(optional)", is English on purpose.
      if (!sameAsEnglish(code).includes(english)) {
        expect({
          code,
          english,
          isDrawnInEnglish: drawn.includes(asDrawn("en", english)),
        }).toEqual({ code, english, isDrawnInEnglish: false });
      }
    }
  });
});

describe("drawn in English", () => {
  test("the form still reads as it always has", () => {
    renderIn("en");

    expect(screen.getByText(GROUP_SWITCH)).toBeInTheDocument();
    expect(screen.getByText(STEP_ONE)).toBeInTheDocument();
    expect(screen.getByText(RECOVERY_FIELD)).toBeInTheDocument();
    expect(screen.getByText(RECOVERY_VALUE)).toBeInTheDocument();
    expect(screen.getByText(MAX_INCIDENTS)).toBeInTheDocument();

    const drawn: string = asRead(document.body.textContent || "");

    expect(drawn).toContain(`${STEP_TWO} ${OPTIONAL}`);
    expect(drawn).toContain(
      "A path into the request body — the same requestBody you reference in incident templates.",
    );
  });
});
