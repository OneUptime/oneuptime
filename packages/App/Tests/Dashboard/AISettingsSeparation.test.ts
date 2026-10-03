import {
  AI_INSIGHTS_SWITCHES,
  AI_LANE_SWITCHES,
  AiLane,
  AiLaneAdvancedCard,
  AI_LANE_ADVANCED_CARDS,
  ENABLE_AI_COLUMN,
  getAiLaneAdvancedCardColumns,
  ProjectAiSwitchDefinition,
} from "../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The pages this file covers are React components, and react is a
 * dependency of the Dashboard package alone — App's own `npm install` never
 * provides it, which is exactly why App's tsconfig excludes
 * FeatureSet/Dashboard. Importing the pages here would pull react into
 * App's program and break `npm run compile` and this suite in CI, so the
 * separation is pinned against the source instead (and against the
 * React-free ProjectAiSettingsCopy, which says which switch writes which
 * column).
 *
 * What is being protected is a data-loss bug rather than a rendering one: a
 * CardModelDetail writes every field it is given on save. If the incident
 * page ever carried an alert field — or either page one of the removed
 * shared fields, or a card a switch's column — then saving one setting
 * would silently overwrite another, and nothing about that looks wrong on
 * screen. The AI behaviours are switches now, each saving its own column
 * alone; only the limits under Advanced are cards, three to a page, each
 * writing its own two columns.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function read(...relativeParts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8");
}

/*
 * The source between two markers. Throwing rather than returning empty
 * matters: a card that no longer has a `formFields={[` at all would
 * otherwise pass every assertion below with zero fields.
 */
function sectionBetween(source: string, start: string, end: string): string {
  const startsAt: number = source.indexOf(start);

  if (startsAt < 0) {
    throw new Error(`Expected to find ${start} in the page source.`);
  }

  const from: number = startsAt + start.length;
  const to: number = source.indexOf(end, from);

  if (to < 0) {
    throw new Error(`Expected to find ${end} after ${start}.`);
  }

  return source.slice(from, to);
}

// Every `field: { <name>: ... }` in a section, in source order.
function fieldsIn(section: string): Array<string> {
  return section
    .split(/field:\s*\{/)
    .slice(1)
    .map((entry: string): string => {
      const name: RegExpMatchArray | null = entry.match(/^\s*(\w+)\s*:/);

      if (!name || !name[1]) {
        throw new Error(
          `Could not read a field name from: ${entry.slice(0, 80)}`,
        );
      }

      return name[1];
    });
}

interface SettingsCard {
  name: string;
  formFields: Array<string>;
  detailFields: Array<string>;
}

/*
 * Every CardModelDetail on a page, in source order. Each card saves on its
 * own, so each one's fields are its whole update payload.
 */
function settingsCards(...relativeParts: Array<string>): Array<SettingsCard> {
  return read(...relativeParts)
    .split("<CardModelDetail")
    .slice(1)
    .map((card: string): SettingsCard => {
      const name: RegExpMatchArray | null = card.match(/name="([^"]+)"/);

      return {
        name: name && name[1] ? name[1] : "",
        formFields: fieldsIn(
          sectionBetween(card, "formFields={[", "modelDetailProps={{"),
        ),
        detailFields: fieldsIn(
          sectionBetween(card, "modelDetailProps={{", "modelId:"),
        ),
      };
    });
}

const INCIDENT_PAGE: Array<string> = [
  "Pages",
  "Incidents",
  "Settings",
  "IncidentAISettings.tsx",
];

const ALERT_PAGE: Array<string> = [
  "Pages",
  "Alerts",
  "Settings",
  "AlertAISettings.tsx",
];

const INCIDENT_CARDS: Array<SettingsCard> = settingsCards(...INCIDENT_PAGE);
const ALERT_CARDS: Array<SettingsCard> = settingsCards(...ALERT_PAGE);

function formFieldsOf(cards: Array<SettingsCard>): Array<string> {
  return cards.flatMap((card: SettingsCard): Array<string> => {
    return card.formFields;
  });
}

function columnsOf(
  switches: Array<ProjectAiSwitchDefinition<string>>,
): Array<string> {
  return switches.map(
    (definition: ProjectAiSwitchDefinition<string>): string => {
      return definition.column;
    },
  );
}

// The project's AI switch, which lives on Project Settings → AI Features.
const PROJECT_AI_SWITCH_FIELDS: Array<string> = ["enableAi"];

/*
 * The project switches folded into Enable AI. They are not Project columns
 * any more, so nothing in the dashboard may read, write or name them.
 */
const RETIRED_PROJECT_AI_SWITCH_FIELDS: Array<string> = [
  "enableAutoRemediation",
  "enableAiCommandExecution",
];

// The titles their toggles had on the AI Features card.
const RETIRED_PROJECT_AI_SWITCH_TITLES: Array<string> = [
  "Enable Auto-Remediation",
  "Enable AI Command Execution",
];

const POSTMORTEM_DRAFT_COLUMN: string = "enableAutomaticPostmortemDraft";

const INCIDENT_SWITCH_COLUMNS: Array<string> = [
  "enableAutomaticIncidentInvestigation",
  POSTMORTEM_DRAFT_COLUMN,
  "enableAutomaticIncidentCodeFixes",
  "enableIncidentInstrumentationFixTasks",
];

const ALERT_SWITCH_COLUMNS: Array<string> = [
  "enableAutomaticAlertInvestigation",
  "enableAutomaticAlertCodeFixes",
  "enableAlertInstrumentationFixTasks",
];

const INCIDENT_LIMIT_COLUMNS: Array<string> = [
  "incidentInvestigationMinimumSeverity",
  "incidentInvestigationDedupeWindowMinutes",
  "incidentAiMaxConcurrentInvestigations",
  "incidentAiInvestigationTimeLimitInMinutes",
  "incidentAiDailyAutonomousTokenLimit",
  "incidentAiDailyFixTaskLimit",
];

const ALERT_LIMIT_COLUMNS: Array<string> = [
  "alertInvestigationMinimumSeverity",
  "alertInvestigationDedupeWindowMinutes",
  "alertAiMaxConcurrentInvestigations",
  "alertAiInvestigationTimeLimitInMinutes",
  "alertAiDailyAutonomousTokenLimit",
  "alertAiDailyFixTaskLimit",
];

const LEGACY_SHARED_FIELDS: Array<string> = [
  "aiMaxConcurrentInvestigations",
  "aiDailyAutonomousTokenLimit",
  "enableInstrumentationFixTasks",
  "enableAutomaticCodeFixes",
  "aiDailyFixTaskLimit",
];

describe("incident and alert AI settings separation", () => {
  test("the incident page's switches are the incident behaviours, and only those", () => {
    expect(columnsOf(AI_LANE_SWITCHES[AiLane.Incident])).toEqual(
      INCIDENT_SWITCH_COLUMNS,
    );
  });

  test("the alert page's switches are the alert behaviours, and only those", () => {
    expect(columnsOf(AI_LANE_SWITCHES[AiLane.Alert])).toEqual(
      ALERT_SWITCH_COLUMNS,
    );
  });

  test.each([
    ["incident", AiLane.Incident, INCIDENT_CARDS, INCIDENT_LIMIT_COLUMNS],
    ["alert", AiLane.Alert, ALERT_CARDS, ALERT_LIMIT_COLUMNS],
  ] as Array<[string, AiLane, Array<SettingsCard>, Array<string>]>)(
    "the %s page's three cards each edit and show exactly their own two limits",
    (
      _kind: string,
      lane: AiLane,
      cards: Array<SettingsCard>,
      limits: Array<string>,
    ) => {
      expect(cards).toHaveLength(AI_LANE_ADVANCED_CARDS.length);

      AI_LANE_ADVANCED_CARDS.forEach(
        (card: AiLaneAdvancedCard, index: number): void => {
          const columns: Array<string> = getAiLaneAdvancedCardColumns(
            lane,
            card,
          );

          expect([card, cards[index]!.formFields]).toEqual([card, columns]);
          expect([card, cards[index]!.detailFields]).toEqual([card, columns]);
        },
      );

      // Together, every limit of the lane, once.
      expect(formFieldsOf(cards)).toEqual(limits);
    },
  );

  test("the two pages' payloads have no field in common", () => {
    const alert: Set<string> = new Set(formFieldsOf(ALERT_CARDS));

    expect(
      formFieldsOf(INCIDENT_CARDS).filter((field: string): boolean => {
        return alert.has(field);
      }),
    ).toEqual([]);

    const alertSwitches: Set<string> = new Set(ALERT_SWITCH_COLUMNS);

    expect(
      INCIDENT_SWITCH_COLUMNS.filter((column: string): boolean => {
        return alertSwitches.has(column);
      }),
    ).toEqual([]);
  });

  test("no card writes an AI switch: each switch saves its own column alone", () => {
    const switchColumns: Array<string> = [
      ...INCIDENT_SWITCH_COLUMNS,
      ...ALERT_SWITCH_COLUMNS,
      ...PROJECT_AI_SWITCH_FIELDS,
    ];

    for (const field of [
      ...formFieldsOf(INCIDENT_CARDS),
      ...formFieldsOf(ALERT_CARDS),
    ]) {
      expect([field, switchColumns.includes(field)]).toEqual([field, false]);
    }
  });

  test("neither page can write a legacy shared setting", () => {
    const allPageFields: Array<string> = [
      ...formFieldsOf(INCIDENT_CARDS),
      ...formFieldsOf(ALERT_CARDS),
      ...INCIDENT_SWITCH_COLUMNS,
      ...ALERT_SWITCH_COLUMNS,
    ];

    for (const legacyField of LEGACY_SHARED_FIELDS) {
      expect(allPageFields).not.toContain(legacyField);
    }
  });

  test("each lane's investigation time limit is on its Investigation limits card", () => {
    expect(
      getAiLaneAdvancedCardColumns(
        AiLane.Incident,
        AiLaneAdvancedCard.InvestigationLimits,
      ),
    ).toContain("incidentAiInvestigationTimeLimitInMinutes");
    expect(
      getAiLaneAdvancedCardColumns(
        AiLane.Alert,
        AiLaneAdvancedCard.InvestigationLimits,
      ),
    ).toContain("alertAiInvestigationTimeLimitInMinutes");
  });

  test("each lane's daily fix limit sits with its token limit, not with the switches", () => {
    expect(
      getAiLaneAdvancedCardColumns(AiLane.Incident, AiLaneAdvancedCard.DailyLimits),
    ).toEqual([
      "incidentAiDailyAutonomousTokenLimit",
      "incidentAiDailyFixTaskLimit",
    ]);
    expect(
      getAiLaneAdvancedCardColumns(AiLane.Alert, AiLaneAdvancedCard.DailyLimits),
    ).toEqual(["alertAiDailyAutonomousTokenLimit", "alertAiDailyFixTaskLimit"]);
  });

  test("the pages hand the shared switch card their own lane's switches", () => {
    expect(read(...INCIDENT_PAGE)).toContain(
      "switches={AI_LANE_SWITCHES[AiLane.Incident]}",
    );
    expect(read(...ALERT_PAGE)).toContain(
      "switches={AI_LANE_SWITCHES[AiLane.Alert]}",
    );
    expect(read(...INCIDENT_PAGE)).not.toContain("AiLane.Alert");
    expect(read(...ALERT_PAGE)).not.toContain("AiLane.Incident");
  });

  /*
   * The "Other AI Workload Guardrails" page was removed: AI work with no
   * incident or alert subject runs on the built-in defaults, so nothing in
   * the dashboard should link to or write those legacy columns any more.
   */
  test("the Other AI Workload Guardrails page stays removed", () => {
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Pages", "Settings", "AIGuardrails.tsx"),
      ),
    ).toBe(false);
    expect(aiMenuSection()).not.toContain("AI Guardrails");
    expect(read("Utils", "PageMap.ts")).not.toContain("SETTINGS_AI_GUARDRAILS");
  });
});

// Every .ts and .tsx file under the Dashboard source, relative to it.
function dashboardSourceFiles(
  directory: string = DASHBOARD_SRC,
): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...dashboardSourceFiles(entryPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(path.relative(DASHBOARD_SRC, entryPath));
    }
  }

  return files;
}

// The settings side menu's AI section, as source.
function aiMenuSection(): string {
  const source: string = read("Pages", "Settings", "SideMenu.tsx");
  const sections: Array<string> = source.split(/^ {6}title: "/m);
  const aiSection: string | undefined = sections.find(
    (section: string): boolean => {
      return section.startsWith('AI",');
    },
  );

  if (!aiSection) {
    throw new Error("Expected an AI section in the settings side menu.");
  }

  return aiSection;
}

/*
 * The project's AI switch used to live on AI Credits — listed only when
 * billing is on, so on a self-hosted install the master switch was reachable
 * only by URL. It now has one home that every install shows. It is also the
 * only one: "Enable auto-remediation" and "Enable AI command execution" were
 * folded into it, so auto-remediation and AI commands on Runners are on
 * exactly when Enable AI is.
 */
describe("the project's AI switches", () => {
  test("AI Features is Enable AI's own switch, saving on flip, and no card", () => {
    // Code only: the comment that says what it replaced may name it.
    const source: string = read("Pages", "Settings", "AIFeatures.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(ENABLE_AI_COLUMN).toBe("enableAi");
    expect(source).toContain("<ModelSwitchCard<Project>");
    expect(source).toContain("column={ENABLE_AI_COLUMN}");
    expect(source).toContain("getConfirmation={getEnableAiConfirmation}");
    expect(source).not.toContain("<CardModelDetail");
    expect(source).not.toContain("Edit AI Features");
  });

  test("AI Features never shows the switches folded into Enable AI", () => {
    const source: string = read("Pages", "Settings", "AIFeatures.tsx");

    for (const retired of [
      ...RETIRED_PROJECT_AI_SWITCH_TITLES,
      ...RETIRED_PROJECT_AI_SWITCH_FIELDS,
    ]) {
      expect({ retired, named: source.includes(retired) }).toEqual({
        retired,
        named: false,
      });
    }
  });

  /*
   * The columns are gone from the model and the database. A page that still
   * selected or wrote one would fail against the API, and copy that still
   * named a toggle would send people looking for one that does not exist.
   */
  test("no Dashboard source reads, writes or names a retired switch", () => {
    const files: Array<string> = dashboardSourceFiles();
    const offenders: Array<string> = [];

    // A walk that found nothing would pass vacuously.
    expect(files).toContain(path.join("Pages", "Settings", "AIFeatures.tsx"));
    expect(files.length).toBeGreaterThan(100);

    for (const file of files) {
      const source: string = read(file);

      for (const retired of [
        ...RETIRED_PROJECT_AI_SWITCH_FIELDS,
        ...RETIRED_PROJECT_AI_SWITCH_TITLES,
      ]) {
        if (source.includes(retired)) {
          offenders.push(`${file}: ${retired}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("AI Credits no longer carries any of them", () => {
    const source: string = read("Pages", "Settings", "AICredits.tsx");
    const credits: Array<string> = fieldsIn(source);

    for (const field of [
      ...PROJECT_AI_SWITCH_FIELDS,
      ...RETIRED_PROJECT_AI_SWITCH_FIELDS,
    ]) {
      expect(credits).not.toContain(field);
    }
    // What stays: the balance and the recharge settings.
    expect(credits).toContain("aiCurrentBalanceInUSDCents");
    expect(credits).toContain("enableAutoRechargeAiBalance");
  });

  test("no other AI settings page can write them", () => {
    for (const field of PROJECT_AI_SWITCH_FIELDS) {
      expect(formFieldsOf([...INCIDENT_CARDS, ...ALERT_CARDS])).not.toContain(
        field,
      );
      expect([
        ...INCIDENT_SWITCH_COLUMNS,
        ...ALERT_SWITCH_COLUMNS,
        ...columnsOf(AI_INSIGHTS_SWITCHES),
      ]).not.toContain(field);
    }
  });

  test("AI Features is the first item of the AI menu section, outside the billing branch", () => {
    const aiSection: string = aiMenuSection();
    const featuresAt: number = aiSection.indexOf('title: "AI Features"');
    const firstItemAt: number = aiSection.indexOf("title: ");
    const billingBranchAt: number = aiSection.indexOf("...(BILLING_ENABLED");

    expect(billingBranchAt).toBeGreaterThan(-1);
    expect(featuresAt).toBeGreaterThan(-1);
    expect(featuresAt).toBe(firstItemAt);
    expect(featuresAt).toBeLessThan(billingBranchAt);
    expect(aiSection).toContain("PageMap.SETTINGS_AI_FEATURES");
  });

  test("the page is routed", () => {
    const routes: string = read("Routes", "SettingsRoutes.tsx");

    expect(routes).toContain(
      'import SettingsAIFeatures from "../Pages/Settings/AIFeatures";',
    );
    expect(routes).toContain(
      "path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_FEATURES)}",
    );
    expect(read("Utils", "RouteMap.ts")).toContain(
      '[PageMap.SETTINGS_AI_FEATURES]: "ai-features",',
    );
  });
});

/*
 * Drafting a postmortem when an incident resolves used to ride on the
 * automatic investigation switch. It is its own switch, saving its own
 * column: no other switch or card on the page can write it.
 */
describe("the automatic postmortem draft", () => {
  test("is a switch of its own on the incident AI settings page", () => {
    const postmortem: ProjectAiSwitchDefinition<string> | undefined =
      AI_LANE_SWITCHES[AiLane.Incident].find(
        (definition: ProjectAiSwitchDefinition<string>): boolean => {
          return definition.column === POSTMORTEM_DRAFT_COLUMN;
        },
      );

    expect(postmortem?.title).toBe(
      "Draft a postmortem when an incident resolves",
    );
  });

  test("is not part of any card's payload", () => {
    expect(formFieldsOf(INCIDENT_CARDS)).not.toContain(POSTMORTEM_DRAFT_COLUMN);
    expect(formFieldsOf(ALERT_CARDS)).not.toContain(POSTMORTEM_DRAFT_COLUMN);
  });

  test("is an incident setting only", () => {
    expect(columnsOf(AI_LANE_SWITCHES[AiLane.Alert])).not.toContain(
      POSTMORTEM_DRAFT_COLUMN,
    );
    expect(read(...ALERT_PAGE)).not.toContain(POSTMORTEM_DRAFT_COLUMN);
  });
});
