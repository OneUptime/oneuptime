import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import {
  SHOW_PAST_WEEK_ACTION,
  TELEMETRY_FIRST_STEPS_COPY,
  TelemetryFirstStepsCopy,
} from "../../FeatureSet/Dashboard/src/Components/Telemetry/TelemetryFirstSteps";
import {
  CAPTURE_TRIGGER_CHOICES,
  CONSENT_MODE_CHOICES,
  EDIT_SESSION_REPLAY_POLICY_TITLE,
  MASKING_MODE_CHOICES,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPolicyChoices";
import {
  BURN_RATE_DECLARES_COPY,
  BURN_RATE_DECLARES_FIELD_TITLE,
  BURN_RATE_DECLARES_REQUIRED,
  BurnRateDeclaresCopy,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateDeclares";
import {
  SERVICE_NAME_HELP,
  SERVICES_EMPTY_DESCRIPTION,
  SET_UP_TELEMETRY_ACTION,
} from "../../FeatureSet/Dashboard/src/Components/Service/ServiceListCopy";
import { SCRUB_ACTION_CHOICES } from "../../FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleForm";
import { SLO_WINDOW_TYPE_CHOICE_DESCRIPTIONS } from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import { SLO_MULTI_MONITOR_MODE_CHOICE_DESCRIPTIONS } from "../../FeatureSet/Dashboard/src/Pages/Slo/SloSettingsFormFields";

/*
 * The telemetry simplicity audit, held in place.
 *
 * Two things fail quietly and are pinned here, in plain Node:
 *
 *   - The first steps of an empty Logs, Traces, Metrics or Exceptions
 *     explorer (the setup guide, and the past week on a short range) are the
 *     product pages' alone. A service's, a host's or an incident's embedded
 *     logs or traces keep their own empty message: their emptiness says
 *     nothing about whether the project sends anything.
 *   - Every line the audit wrote is a Dashboard key with a translation in
 *     each of the sixteen other languages, and so are the answers it draws
 *     beside them: a choice whose answers are half English reads as broken.
 *
 * What the explorers, the forms and the lists do with these is rendered in
 * the Common suite (TelemetryFirstSteps, LogsViewerFirstSteps,
 * TelemetryDataRuleFormsRender, SessionReplayPolicyChoices,
 * BurnRateDeclaresChoice, TelemetryListFirstSteps).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

type Locale = Record<string, unknown>;

const locales: Record<string, Locale> = {};

for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
  if (file.endsWith(".json")) {
    locales[file.replace(/\.json$/, "")] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Locale;
  }
}

const OTHER_LANGUAGES: Array<string> = Object.keys(locales).filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

// Comments explain the old wording in prose; assertions read the code.
function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

// Every .tsx file under the Dashboard source, as a path relative to it.
function allTsxFiles(directory: string = DASHBOARD_SRC): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...allTsxFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(path.relative(DASHBOARD_SRC, full));
    }
  }

  return found;
}

// An import of one of the four explorers, from wherever the file sits.
const EXPLORER_IMPORT: RegExp =
  /from "[./]*(?:Components\/)?(?:Logs\/LogsViewer|Traces\/TracesViewer|Metrics\/MetricsViewer|Exceptions\/ExceptionsViewer)"/;

// The explorers themselves, which declare the prop and read it.
const EXPLORER_FILES: ReadonlyArray<string> = [
  "Components/Logs/LogsViewer.tsx",
  "Components/Traces/TracesViewer.tsx",
  "Components/Metrics/MetricsViewer.tsx",
  "Components/Exceptions/ExceptionsViewer.tsx",
];

// The product pages, each with the tag of the one explorer it mounts.
const PRODUCT_PAGES: Record<string, string> = {
  "Pages/Logs/Index.tsx": "DashboardLogsViewer",
  "Pages/Traces/Index.tsx": "TracesViewer",
  "Pages/Metrics/Index.tsx": "MetricsViewer",
  "Pages/Exceptions/Unresolved.tsx": "ExceptionsViewer",
  "Pages/Exceptions/Resolved.tsx": "ExceptionsViewer",
  "Pages/Exceptions/Archived.tsx": "ExceptionsViewer",
};

describe("an empty explorer offers first steps on its product page only", () => {
  test.each(Object.entries(PRODUCT_PAGES))(
    "%s mounts %s with the setup guide offered",
    (page: string, explorer: string) => {
      const code: string = readCode(page);
      const mountAt: number = code.indexOf(`<${explorer}`);

      expect(mountAt).toBeGreaterThan(-1);

      const mount: string = code.slice(mountAt, code.indexOf("/>", mountAt));

      expect(mount).toContain("offersSetupWhenEmpty={true}");
    },
  );

  test("no other mount of the four explorers offers it", () => {
    const offering: Array<string> = allTsxFiles()
      .filter((file: string): boolean => {
        return !EXPLORER_FILES.includes(file);
      })
      .filter((file: string): boolean => {
        const code: string = readCode(file);

        return (
          EXPLORER_IMPORT.test(code) && code.includes("offersSetupWhenEmpty")
        );
      })
      .sort();

    expect(offering).toEqual(Object.keys(PRODUCT_PAGES).sort());
  });

  test("the embedded explorers are still mounted elsewhere, without it", () => {
    // The check above means something only while embeds exist.
    const embeds: Array<string> = allTsxFiles().filter(
      (file: string): boolean => {
        if (EXPLORER_FILES.includes(file) || file in PRODUCT_PAGES) {
          return false;
        }

        return EXPLORER_IMPORT.test(readCode(file));
      },
    );

    expect(embeds.length).toBeGreaterThan(10);
  });

  test("each explorer shows them only while the list is empty and nothing narrows it", () => {
    for (const file of [
      "Components/Traces/TracesViewer.tsx",
      "Components/Metrics/MetricsViewer.tsx",
      "Components/Exceptions/ExceptionsViewer.tsx",
    ]) {
      const code: string = readCode(file);

      expect({
        file,
        decides: code.includes("showsTelemetryFirstSteps("),
      }).toEqual({ file, decides: true });
      expect({
        file,
        offered: code.includes(
          "hasFirstSteps: Boolean(props.offersSetupWhenEmpty),",
        ),
      }).toEqual({ file, offered: true });
    }

    /*
     * The logs list draws its own empty block: the Common viewer shows the
     * first steps only while no chip and no search narrow it.
     */
    const logs: string = readCode("Components/Logs/LogsViewer.tsx");

    expect(logs).toContain("emptyContentWhenUnfiltered={firstSteps}");
    expect(logs).toContain(
      "const firstSteps: ReactElement | undefined = props.offersSetupWhenEmpty ? (",
    );
  });

  test("the Profiler's Overview and All profiles say it the same way", () => {
    /*
     * Rendered in Common's ProfilesFirstSteps; here, that both keep reading
     * the shared copy rather than a sentence of their own.
     */
    expect(readCode("Components/Profiles/ProfilesOverview.tsx")).toContain(
      "signal={TelemetryFirstStepsSignal.Profiles}",
    );

    const table: string = readCode("Components/Profiles/ProfileTable.tsx");

    expect(table).toContain(
      "getTelemetryFirstStepsSetupAction(TelemetryFirstStepsSignal.Profiles)",
    );
    expect(table).toContain(
      "TELEMETRY_FIRST_STEPS_COPY[TelemetryFirstStepsSignal.Profiles]",
    );
    // A list a deep-link chip emptied says nothing matches instead.
    expect(table).toContain("isFiltered: true,");
  });

  test("the Traces page draws no empty chart over its first steps", () => {
    /*
     * The chart kept its card for the Count / Response time picker and said
     * "No data for this metric in the selected range" over first steps that
     * say the same with a way forward. It steps aside while they show and it
     * has no bar - only once the list's read came back empty (rendered in
     * Common's TracesFirstStepsChart).
     */
    const code: string = readCode("Components/Traces/TracesViewer.tsx");

    expect(code).toContain("showHistogram={!chartStepsAside}");
    expect(code).toContain(
      "const chartStepsAside: boolean =\n    showsFirstSteps && histogramBuckets.length === 0;",
    );
    expect(code).toContain(
      "const showsFirstSteps: boolean =\n    offersFirstSteps &&\n    listAnswer !== null &&",
    );
    expect(code).toContain("emptyContent={\n        offersFirstSteps ? (");
    expect(code).not.toContain("showHistogram={true}");
  });

  test("an empty exceptions list asks once whether the project has any exception", () => {
    const code: string = readCode("Components/Exceptions/ExceptionsViewer.tsx");

    expect(code).toContain(
      "const projectHasExceptions: boolean | null = useProjectHasExceptions(\n    isUnnarrowedEmptyList,\n  );",
    );
    expect(code).toContain(
      "isUnnarrowedEmptyList && projectHasExceptions === false ? (",
    );
  });
});

// The audit's lines that live in a page's source, not in a copy module.
const LINES_IN_PAGES: Record<string, Array<string>> = {
  "Components/Telemetry/DropFilterForm.tsx": [
    "Edit Action",
    "Discards every matching log for good.",
    "Keeps a share of the matching logs and discards the rest.",
    "The share of matching logs to keep, from 1 to 99. 10 keeps one in ten.",
    "Discards every matching span for good.",
    "Keeps a share of the matching spans and discards the rest.",
    "The share of matching spans to keep, from 1 to 99. 10 keeps one in ten.",
  ],
  "Pages/Metrics/Settings/PipelineRules.tsx": [
    "Every filter must match.",
    "At least one filter must match.",
    "The current name, exactly as it arrives.",
    "The name to store it under.",
    "The attribute to act on, such as deployment.environment.",
    "The value to give it.",
    "What to write in place of the value. Empty writes [REDACTED].",
  ],
  // The empty list's setup steps gave way to its showcase (#5289).
  "Pages/Rum/RumApplications.tsx": [
    "Your web and mobile apps, as their real users see them. Each app appears here once it sends telemetry.",
  ],
  "Pages/Rum/View/SessionReplaySettings.tsx": [
    "For other sensitive data, pick a stricter mode or add selectors below.",
  ],
  "Pages/Service/Services.tsx": [
    "e.g., checkout-api",
    "What this service does",
  ],
  "Pages/Slo/Utils/BurnRateRuleForm.ts": [
    "Off stops this rule from firing. Its history is kept.",
  ],
  "Pages/Slo/SloSettingsFormFields.ts": [
    "Only matters when this SLO measures more than one monitor.",
  ],
};

function choiceLines(choices: Array<RadioButton>): Array<string> {
  return choices.flatMap((choice: RadioButton): Array<string> => {
    return [choice.title, choice.description || ""];
  });
}

const AUDIT_LINES: Array<string> = [
  // The empty explorers' first steps.
  ...Object.values(TELEMETRY_FIRST_STEPS_COPY).flatMap(
    (copy: TelemetryFirstStepsCopy): Array<string> => {
      return [copy.title, copy.description, copy.setupAction];
    },
  ),
  SHOW_PAST_WEEK_ACTION,
  // The replay policy's three choices and its dialog.
  EDIT_SESSION_REPLAY_POLICY_TITLE,
  ...choiceLines(CAPTURE_TRIGGER_CHOICES),
  ...choiceLines(MASKING_MODE_CHOICES),
  ...choiceLines(CONSENT_MODE_CHOICES),
  // A burn rate rule's When it fires.
  BURN_RATE_DECLARES_FIELD_TITLE,
  BURN_RATE_DECLARES_REQUIRED,
  ...Object.values(BURN_RATE_DECLARES_COPY).flatMap(
    (copy: BurnRateDeclaresCopy): Array<string> => {
      return [copy.title, copy.description];
    },
  ),
  // The services list.
  SERVICES_EMPTY_DESCRIPTION,
  SET_UP_TELEMETRY_ACTION,
  SERVICE_NAME_HELP,
  // The scrub action's and the SLO choices' lines.
  ...SCRUB_ACTION_CHOICES.map((choice: RadioButton): string => {
    return choice.description || "";
  }),
  ...Object.values(SLO_WINDOW_TYPE_CHOICE_DESCRIPTIONS),
  ...Object.values(SLO_MULTI_MONITOR_MODE_CHOICE_DESCRIPTIONS),
  ...Object.values(LINES_IN_PAGES).flat(),
];

describe("the audit's lines are drawn in every language", () => {
  test("the lines kept in pages are the lines those pages draw", () => {
    for (const [file, lines] of Object.entries(LINES_IN_PAGES)) {
      const code: string = readCode(file);

      for (const line of lines) {
        expect({ file, line, drawn: code.includes(`"${line}"`) }).toEqual({
          file,
          line,
          drawn: true,
        });
      }
    }
  });

  test("every line is a Dashboard key", () => {
    expect(AUDIT_LINES.length).toBeGreaterThan(60);

    for (const line of AUDIT_LINES) {
      expect({ line, key: locales["en"]![line] }).toEqual({ line, key: line });
    }
  });

  test.each(OTHER_LANGUAGES)(
    "%s draws every line in its own words",
    (code: string) => {
      const english: Array<string> = AUDIT_LINES.filter(
        (line: string): boolean => {
          const value: unknown = locales[code]![line];

          return (
            typeof value !== "string" || value.trim() === "" || value === line
          );
        },
      );

      expect(english).toEqual([]);
    },
  );
});

describe("each edit dialog names what it edits", () => {
  test.each([
    "Pages/Logs/Settings/DropFilterView.tsx",
    "Pages/Traces/Settings/DropFilterView.tsx",
  ])(
    "%s: the Action card's button and dialog say Edit Action",
    (file: string) => {
      /*
       * The details card and the Action card both said "Edit Log Drop
       * Filter" (or Trace) while opening different fields.
       */
      const code: string = readCode(file);

      expect(code).toContain(
        "editButtonText={DROP_FILTER_EDIT_ACTION_TITLE}\n        editModalTitle={DROP_FILTER_EDIT_ACTION_TITLE}",
      );
    },
  );

  test("the SLO Settings dialogs are titled like the buttons that open them", () => {
    const code: string = readCode("Pages/Slo/View/Settings.tsx");

    for (const [key, title] of [
      ["objective", "Edit Objective"],
      ["period", "Edit Period"],
      ["downtime", "Edit Downtime Calculation"],
    ] as Array<[string, string]>) {
      expect(code).toContain(`${key}: translationKey("${title}"),`);
      expect(code).toContain(
        `editButtonText="${title}"\n        editModalTitle={SLO_SETTINGS_DIALOG_TITLES.${key}}`,
      );
    }
  });
});

describe("the descriptions that explained two modes are gone", () => {
  const OLD_DESCRIPTIONS: Record<string, Array<string>> = {
    "Pages/Rum/View/SessionReplaySettings.tsx": [
      "Always uploads every sampled session. On error or frustration uploads only",
      "Sensitive inputs only (default), every input, or all text.",
      "Require Explicit uploads nothing until your page calls grantConsent().",
      "DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(",
    ],
    "Components/Telemetry/DropFilterForm.tsx": [
      "Drop permanently discards matching logs. Sample keeps a percentage of them.",
      "Drop permanently discards matching spans. Sample keeps a percentage of them.",
    ],
    "Components/Telemetry/ScrubRuleForm.ts": [
      "How to handle matched data. Mask: partially hide",
    ],
    "Pages/Metrics/Settings/PipelineRules.tsx": [
      "'All' requires every filter to match (AND).",
    ],
    "Pages/Slo/SloFormFields.ts": [
      "Rolling suits services that should be reliable at every moment.",
    ],
    "Pages/Slo/SloSettingsFormFields.ts": [
      "How downtime is combined when this SLO measures more than one monitor.",
    ],
    // The Profiler's empty states: the first steps, not a setup paragraph.
    "Components/Profiles/ProfilesOverview.tsx": [
      "Send continuous profiles with Grafana Alloy",
      '"No profiles yet"',
    ],
    "Components/Profiles/ProfileTable.tsx": [
      "No profiles found. Send continuous profiles with Grafana Alloy",
    ],
  };

  test.each(Object.entries(OLD_DESCRIPTIONS))(
    "%s no longer says them",
    (file: string, olds: Array<string>) => {
      const code: string = readCode(file);

      for (const old of olds) {
        expect({ file, old, present: code.includes(old) }).toEqual({
          file,
          old,
          present: false,
        });
      }
    },
  );
});
