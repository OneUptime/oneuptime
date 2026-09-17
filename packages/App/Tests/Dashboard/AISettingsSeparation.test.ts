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

function settingsPage(...relativeParts: Array<string>): SettingsPage {
  const source: string = read(...relativeParts);

  return {
    formFields: fieldsIn(
      sectionBetween(source, "formFields={[", "modelDetailProps={{"),
    ),
    detailFields: fieldsIn(
      sectionBetween(source, "modelDetailProps={{", "modelId:"),
    ),
  };
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
    const source: string = read("Pages", "Settings", "SideMenu.tsx");
    const sections: Array<string> = source.split(/^ {6}title: "/m);
    const aiSection: string | undefined = sections.find(
      (section: string): boolean => {
        return section.startsWith('AI",');
      },
    );

    expect(aiSection).toBeDefined();
    expect(aiSection).toContain('title: "AI Guardrails"');

    const guardrailsAt: number = aiSection!.indexOf('title: "AI Guardrails"');
    const billingBranchAt: number = aiSection!.indexOf("BILLING_ENABLED");

    expect(billingBranchAt).toBeGreaterThan(-1);
    expect(guardrailsAt).toBeLessThan(billingBranchAt);
  });
});
