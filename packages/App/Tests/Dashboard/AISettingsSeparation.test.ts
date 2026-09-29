import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The four pages this file covers are React components, and react is a
 * dependency of the Dashboard package alone — App's own `npm install` never
 * provides it, which is exactly why App's tsconfig excludes
 * FeatureSet/Dashboard. Importing the pages here would pull react into
 * App's program and break `npm run compile` and this suite in CI, so the
 * separation is pinned against the source instead, the same way
 * NetworkMapWidgetInvariants pins the Network Map widget.
 *
 * What is being protected is a data-loss bug rather than a rendering one: a
 * CardModelDetail writes every field it is given on Update. If the incident
 * page ever carries an alert field — or either page carries one of the
 * removed shared fields — then saving one lane silently overwrites the
 * other lane's configuration, and nothing about that looks wrong on screen.
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
 * matters: a page that no longer has a `formFields={[` at all would
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

interface ConfiguredField {
  name: string;
  stepId: string | null;
}

/*
 * Every `field: { <name>: ... }` in a section, in source order, carrying the
 * stepId declared alongside it in the same entry.
 */
function fieldsIn(section: string): Array<ConfiguredField> {
  return section
    .split(/field:\s*\{/)
    .slice(1)
    .map((entry: string): ConfiguredField => {
      const name: RegExpMatchArray | null = entry.match(/^\s*(\w+)\s*:/);

      if (!name || !name[1]) {
        throw new Error(
          `Could not read a field name from: ${entry.slice(0, 80)}`,
        );
      }

      const stepId: RegExpMatchArray | null =
        entry.match(/stepId:\s*"([^"]+)"/);

      return { name: name[1], stepId: stepId && stepId[1] ? stepId[1] : null };
    });
}

function namesOf(fields: Array<ConfiguredField>): Array<string> {
  return fields.map((field: ConfiguredField): string => {
    return field.name;
  });
}

interface SettingsPage {
  formFields: Array<ConfiguredField>;
  detailFields: Array<ConfiguredField>;
}

function settingsCard(source: string): SettingsPage {
  return {
    formFields: fieldsIn(
      sectionBetween(source, "formFields={[", "modelDetailProps={{"),
    ),
    detailFields: fieldsIn(
      sectionBetween(source, "modelDetailProps={{", "modelId:"),
    ),
  };
}

function settingsPage(...relativeParts: Array<string>): SettingsPage {
  return settingsCard(read(...relativeParts));
}

/*
 * Every CardModelDetail on a page, in source order. Each card saves on its
 * own, so each one's fields are its whole update payload.
 */
function settingsCards(...relativeParts: Array<string>): Array<SettingsPage> {
  return read(...relativeParts)
    .split("<CardModelDetail")
    .slice(1)
    .filter((card: string): boolean => {
      return card.includes("formFields={[");
    })
    .map((card: string): SettingsPage => {
      return settingsCard(card);
    });
}

const INCIDENT_PAGE: SettingsPage = settingsPage(
  "Pages",
  "Incidents",
  "Settings",
  "IncidentAISettings.tsx",
);

const ALERT_PAGE: SettingsPage = settingsPage(
  "Pages",
  "Alerts",
  "Settings",
  "AlertAISettings.tsx",
);

const GUARDRAILS_PAGE: SettingsPage = settingsPage(
  "Pages",
  "Settings",
  "AIGuardrails.tsx",
);

const INCIDENT_CARDS: Array<SettingsPage> = settingsCards(
  "Pages",
  "Incidents",
  "Settings",
  "IncidentAISettings.tsx",
);

const ALERT_CARDS: Array<SettingsPage> = settingsCards(
  "Pages",
  "Alerts",
  "Settings",
  "AlertAISettings.tsx",
);

const AI_FEATURES_PAGE: SettingsPage = settingsPage(
  "Pages",
  "Settings",
  "AIFeatures.tsx",
);

// The project's AI switches, which live on Project Settings → AI Features.
const PROJECT_AI_SWITCH_FIELDS: Array<string> = [
  "enableAi",
  "enableAutoRemediation",
  "enableAiCommandExecution",
];

const POSTMORTEM_DRAFT_FIELDS: Array<string> = [
  "enableAutomaticPostmortemDraft",
];

const INCIDENT_FIELDS: Array<string> = [
  "enableAutomaticIncidentInvestigation",
  "incidentInvestigationMinimumSeverity",
  "incidentInvestigationDedupeWindowMinutes",
  "incidentAiMaxConcurrentInvestigations",
  "incidentAiDailyAutonomousTokenLimit",
  "enableIncidentInstrumentationFixTasks",
  "enableAutomaticIncidentCodeFixes",
  "incidentAiDailyFixTaskLimit",
];

const ALERT_FIELDS: Array<string> = [
  "enableAutomaticAlertInvestigation",
  "alertInvestigationMinimumSeverity",
  "alertInvestigationDedupeWindowMinutes",
  "alertAiMaxConcurrentInvestigations",
  "alertAiDailyAutonomousTokenLimit",
  "enableAlertInstrumentationFixTasks",
  "enableAutomaticAlertCodeFixes",
  "alertAiDailyFixTaskLimit",
];

const OTHER_AI_GUARDRAIL_FIELDS: Array<string> = [
  "aiMaxConcurrentInvestigations",
  "aiDailyAutonomousTokenLimit",
  "aiDailyFixTaskLimit",
];

const LEGACY_SHARED_FIELDS: Array<string> = [
  "aiMaxConcurrentInvestigations",
  "aiDailyAutonomousTokenLimit",
  "enableInstrumentationFixTasks",
  "enableAutomaticCodeFixes",
  "aiDailyFixTaskLimit",
];

describe("incident and alert AI settings separation", () => {
  test("incident card edits and displays only incident settings", () => {
    expect(namesOf(INCIDENT_PAGE.formFields)).toEqual(INCIDENT_FIELDS);
    expect(namesOf(INCIDENT_PAGE.detailFields)).toEqual(INCIDENT_FIELDS);
  });

  test("alert card edits and displays only alert settings", () => {
    expect(namesOf(ALERT_PAGE.formFields)).toEqual(ALERT_FIELDS);
    expect(namesOf(ALERT_PAGE.detailFields)).toEqual(ALERT_FIELDS);
  });

  test("the two update payloads have no fields in common", () => {
    const alert: Set<string> = new Set(namesOf(ALERT_PAGE.formFields));

    expect(
      namesOf(INCIDENT_PAGE.formFields).filter((field: string): boolean => {
        return alert.has(field);
      }),
    ).toEqual([]);
  });

  test("neither page can write a legacy shared setting", () => {
    const allPageFields: Array<string> = [
      ...namesOf(INCIDENT_PAGE.formFields),
      ...namesOf(ALERT_PAGE.formFields),
    ];

    for (const legacyField of LEGACY_SHARED_FIELDS) {
      expect(allPageFields).not.toContain(legacyField);
    }
  });

  test("each lane's follow-up PR controls stay on its Fix Tasks step", () => {
    const assertFixTaskStep: (
      page: SettingsPage,
      fields: Array<string>,
    ) => void = (page: SettingsPage, fields: Array<string>): void => {
      for (const configuredField of page.formFields) {
        if (fields.includes(configuredField.name)) {
          expect(configuredField.stepId).toBe("fix-tasks");
        }
      }
    };

    assertFixTaskStep(INCIDENT_PAGE, [
      "enableIncidentInstrumentationFixTasks",
      "enableAutomaticIncidentCodeFixes",
      "incidentAiDailyFixTaskLimit",
    ]);
    assertFixTaskStep(ALERT_PAGE, [
      "enableAlertInstrumentationFixTasks",
      "enableAutomaticAlertCodeFixes",
      "alertAiDailyFixTaskLimit",
    ]);
  });

  test("subjectless AI work keeps its three fallback limits on the dedicated guardrails page", () => {
    expect(namesOf(GUARDRAILS_PAGE.formFields)).toEqual(
      OTHER_AI_GUARDRAIL_FIELDS,
    );
    expect(namesOf(GUARDRAILS_PAGE.detailFields)).toEqual(
      OTHER_AI_GUARDRAIL_FIELDS,
    );
  });

  /*
   * The guardrails page is the only home the three fallback limits have
   * left, so it has to sit in the part of the AI menu that renders for
   * every project — not inside the BILLING_ENABLED branch that hides AI
   * Credits on a self-hosted install.
   */
  test("AI Guardrails is in the always-visible AI menu section", () => {
    const aiSection: string = aiMenuSection();

    expect(aiSection).toContain('title: "AI Guardrails"');

    const guardrailsAt: number = aiSection.indexOf('title: "AI Guardrails"');
    const billingBranchAt: number = aiSection.indexOf("...(BILLING_ENABLED");

    expect(billingBranchAt).toBeGreaterThan(-1);
    expect(guardrailsAt).toBeLessThan(billingBranchAt);
  });
});

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
 * The project's AI switches used to live on AI Credits — listed only when
 * billing is on, so on a self-hosted install the master switch was reachable
 * only by URL, and "Enable auto-remediation" had no screen at all. They now
 * have one home that every install shows.
 */
describe("the project's AI switches", () => {
  test("AI Features edits and displays exactly the three switches, master switch first", () => {
    expect(namesOf(AI_FEATURES_PAGE.formFields)).toEqual(
      PROJECT_AI_SWITCH_FIELDS,
    );
    expect(namesOf(AI_FEATURES_PAGE.detailFields)).toEqual(
      PROJECT_AI_SWITCH_FIELDS,
    );
  });

  test("AI Credits no longer carries any of them", () => {
    const source: string = read("Pages", "Settings", "AICredits.tsx");
    const credits: Array<string> = fieldsIn(source).map(
      (field: ConfiguredField): string => {
        return field.name;
      },
    );

    for (const field of PROJECT_AI_SWITCH_FIELDS) {
      expect(credits).not.toContain(field);
    }
    // What stays: the balance and the recharge settings.
    expect(credits).toContain("aiCurrentBalanceInUSDCents");
    expect(credits).toContain("enableAutoRechargeAiBalance");
  });

  test("no other AI settings page can write them", () => {
    const otherPages: Array<SettingsPage> = [
      ...INCIDENT_CARDS,
      ...ALERT_CARDS,
      GUARDRAILS_PAGE,
    ];

    for (const page of otherPages) {
      for (const field of PROJECT_AI_SWITCH_FIELDS) {
        expect(namesOf(page.formFields)).not.toContain(field);
      }
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
 * automatic investigation switch. It is its own switch now, on its own card:
 * a card writes every field it is given, so sharing a card with the
 * investigation settings would let either save rewrite the other.
 */
describe("the automatic postmortem draft", () => {
  test("has its own card on the incident AI settings page", () => {
    expect(INCIDENT_CARDS.length).toBe(2);
    expect(namesOf(INCIDENT_CARDS[1]!.formFields)).toEqual(
      POSTMORTEM_DRAFT_FIELDS,
    );
    expect(namesOf(INCIDENT_CARDS[1]!.detailFields)).toEqual(
      POSTMORTEM_DRAFT_FIELDS,
    );
  });

  test("is not part of the investigation card's payload", () => {
    expect(INCIDENT_CARDS[0]).toEqual(INCIDENT_PAGE);
    expect(namesOf(INCIDENT_PAGE.formFields)).not.toContain(
      "enableAutomaticPostmortemDraft",
    );
  });

  test("is an incident setting only", () => {
    for (const card of ALERT_CARDS) {
      expect(namesOf(card.formFields)).not.toContain(
        "enableAutomaticPostmortemDraft",
      );
    }
  });

  test("is labelled for what it does", () => {
    expect(
      read("Pages", "Incidents", "Settings", "IncidentAISettings.tsx"),
    ).toContain(
      'title: "Draft a postmortem automatically when an incident resolves"',
    );
  });
});
