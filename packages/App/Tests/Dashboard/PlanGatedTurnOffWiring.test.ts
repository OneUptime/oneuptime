import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A paid feature can always be switched off, on any plan.
 *
 * The server lets a plan-gated column go back to its default whatever the
 * plan (Common/Types/Billing/PlanGatedColumnDefault, asked by
 * ColumnPermission). The dashboard asks the same rule, per value, so it
 * offers exactly the moves the server allows:
 *
 *   - a settings switch a trial left on (ModelSwitchRow) says it can still
 *     be switched off, and which plan it takes to switch it on again;
 *   - a choice that leaves a paid one - making a public dashboard private,
 *     a private status page public - needs no plan, and its dialog says what
 *     coming back takes (ChoiceRows' CHOICE_PLAN_LEFTOVER_COPY);
 *   - "Require SSO for Login" stays reachable under the Scale upsell while a
 *     project still requires SSO, and locks once off (turning it on again
 *     needs Scale);
 *   - a retention override a trial left set is shown, with a Remove button,
 *     under the retention pages' upsell (RetentionOverrideLeftover).
 *
 * What a page draws under its upsell waits until the project is known to be
 * below the plan (isKnownToBeBelowPlan), so a project on the plan never
 * reads anything for it while its plan loads.
 *
 * This holds the source to that, and the new sentences to a translation in
 * every language. The behaviour is tested in Common/Tests (PlanGatedTurnOff,
 * PlanGatedTurnOffWrites, PlanGatedColumnDefault, PlanGatedChoice,
 * ModelSwitchRow, ModelSwitchUtil, ModelSwitchCard, DashboardSharingCard,
 * StatusPageAccessCard, StatusPageReportsCard, PlanGatedPage,
 * EnterprisePluginPage, SsoPages, TelemetryRetentionShells,
 * RetentionOverrideLeftover).
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

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

const NEW_SENTENCES: Array<string> = [
  "Your plan does not include this setting. You can turn it off, but turning it on again needs the {{planName}} plan.",
  "Your plan does not include this setting. You can turn it on, but turning it off again needs the {{planName}} plan.",
  "Your plan does not include “{{choiceName}}”, so picking it again later needs the {{planName}} plan.",
  "Changing this setting needs the {{planName}} plan.",
];

// The retention override card's, written once in RetentionOverrideLeftoverCopy.
const RETENTION_SENTENCES: Array<string> = [
  "Retention Override",
  "Telemetry from here is kept for its own retention, not the project's. Your plan does not include retention overrides: you can remove this one, but setting one again needs the {{planName}} plan.",
  "From now on, telemetry from here is kept for the project's retention. What is already stored keeps the retention it was stored with.",
  "Removed. Telemetry from here is kept for the project's retention from now on.",
  "Some types of telemetry are kept for their own retention, not the project's default. Your plan does not include retention by telemetry type: you can remove it, but setting it again needs the {{planName}} plan.",
  "From now on, each type of telemetry is kept for the project's default retention, unless a service or resource has its own. What is already stored keeps the retention it was stored with.",
  "Removed. Telemetry is kept for the project's default retention from now on.",
  "Remove Override",
  "Remove the retention override?",
];

const ALL_NEW_SENTENCES: Array<string> = [
  ...NEW_SENTENCES,
  ...RETENTION_SENTENCES,
];

// Source with comments dropped and whitespace collapsed.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;
const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales" && entry.name !== "node_modules") {
        found.push(...listSources(full));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe("the sentences that say a paid feature can still be switched off", () => {
  test("are written once, in the shared switch and choice components", () => {
    const switchUtil: string = readSource(
      path.join(
        COMMON_ROOT,
        "UI",
        "Components",
        "ModelSwitch",
        "ModelSwitchUtil.ts",
      ),
    );
    const choiceRows: string = readSource(
      path.join(
        COMMON_ROOT,
        "UI",
        "Components",
        "ChoiceRows",
        "ChoiceRows.tsx",
      ),
    );

    expect(switchUtil).toContain(NEW_SENTENCES[0]);
    expect(switchUtil).toContain(NEW_SENTENCES[1]);
    expect(choiceRows).toContain(NEW_SENTENCES[2]);
    expect(switchUtil).toContain(NEW_SENTENCES[3]);

    const retentionCopy: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Components/TelemetryResource/RetentionOverrideLeftoverCopy.ts",
      ),
    );

    for (const sentence of RETENTION_SENTENCES) {
      expect([sentence, retentionCopy.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }
  });

  test("are keys of the English locale", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const sentence of ALL_NEW_SENTENCES) {
      expect([sentence, english[sentence]]).toEqual([sentence, sentence]);
    }
  });

  test.each(OTHER_LOCALES)(
    "are translated in %s, with the same placeholders",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const sentence of ALL_NEW_SENTENCES) {
        const translated: unknown = translations[sentence];

        expect([locale, typeof translated]).toEqual([locale, "string"]);
        expect([locale, translated === sentence]).toEqual([locale, false]);
        expect(placeholdersOf(translated as string)).toEqual(
          placeholdersOf(sentence),
        );
      }
    },
  );
});

describe("the dashboard asks the server's rule, per value", () => {
  test("the switch row shows the leftover sentence, for someone who may change it", () => {
    const row: string = readSource(
      path.join(
        COMMON_ROOT,
        "UI",
        "Components",
        "ModelSwitch",
        "ModelSwitchRow.tsx",
      ),
    );

    expect(row).toContain(
      "const leftover: SwitchPlanLeftover | null = updateGate.isAllowed ? getSwitchPlanLeftover({",
    );
    expect(row).toContain("SWITCH_PLAN_LEFTOVER_COPY[leftover.canTurn]");
  });

  test("the plan helper the dashboard uses is the server's own rule", () => {
    const switchUtil: string = readSource(
      path.join(
        COMMON_ROOT,
        "UI",
        "Components",
        "ModelSwitch",
        "ModelSwitchUtil.ts",
      ),
    );

    expect(switchUtil).toContain(
      'import { isPlanGatedColumnDefault } from "../../../Types/Billing/PlanGatedColumnDefault";',
    );
    expect(switchUtil).toContain(
      "if (isPlanGatedColumnDefault(getColumnMetadata(model, column), value)) { return null; }",
    );

    const columnPermission: string = readSource(
      path.join(
        COMMON_ROOT,
        "Server",
        "Types",
        "Database",
        "Permissions",
        "ColumnPermission.ts",
      ),
    );

    expect(columnPermission).toContain(
      "isPlanGatedColumnDefault(tableColumnMetadata, (data as any)[key])",
    );
  });

  test("every page that offers choices names a plan by the value a move writes, never by the column alone", () => {
    const offenders: Array<string> = [];
    let choicePages: number = 0;

    for (const file of listSources(DASHBOARD_SRC)) {
      const source: string = readSource(file);

      if (!source.includes("<ChoiceRows") || !source.includes("planNeeded")) {
        continue;
      }

      choicePages++;

      if (
        source.includes("getPlanNeededToChangeColumn") ||
        !source.includes("getPlanNeededToWriteColumn")
      ) {
        offenders.push(path.relative(DASHBOARD_SRC, file));
      }
    }

    // The status page's Access card and the dashboard's Sharing card, at least.
    expect(choicePages).toBeGreaterThanOrEqual(2);
    expect(offenders).toEqual([]);
  });

  test("the Access and Sharing dialogs say what coming back takes", () => {
    for (const file of [
      "Components/StatusPage/StatusPageAccessCard.tsx",
      "Components/Dashboard/Sharing/DashboardSharingCard.tsx",
    ]) {
      const card: string = readSource(path.join(DASHBOARD_SRC, file));

      expect([
        file,
        card.includes("getChoicePlanLeftoverText(translator, {"),
      ]).toEqual([file, true]);
    }

    expect(
      readSource(
        path.join(
          DASHBOARD_SRC,
          "Components/StatusPage/StatusPageAccessCard.tsx",
        ),
      ),
    ).toContain("getPlanNeededToComeBackToAccess({");
    expect(
      readSource(
        path.join(
          DASHBOARD_SRC,
          "Components/Dashboard/Sharing/DashboardSharingCard.tsx",
        ),
      ),
    ).toContain("getPlanNeededToComeBackToDashboardAccess({");
  });

  test("a plan-gated page draws what can still be switched off under its upsell, once the plan is known to be below", () => {
    const gate: string = readSource(
      path.join(DASHBOARD_SRC, "Components/Billing/PlanGatedPage.tsx"),
    );

    expect(gate).toContain(
      "{props.belowPlan && isKnownToBeBelowPlan(props.requiredPlan) ? ( props.belowPlan ) : ( <></> )}",
    );

    const pluginPage: string = readSource(
      path.join(DASHBOARD_SRC, "Enterprise/EnterprisePluginPage.tsx"),
    );

    // Under the plan upsell only: never the edition one.
    expect(pluginPage).toContain(
      "props.belowPlan && !isEligible && isKnownToBeBelowPlan(props.requiredPlan)",
    );
  });

  test("the retention pages hand their override card to the upsell", () => {
    const resourceShell: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Components/TelemetryResource/TelemetryResourceRetentionSettings.tsx",
      ),
    );

    expect(resourceShell).toContain(
      "belowPlan={ <RetentionOverrideLeftover<TModel> modelType={props.modelType} modelId={props.modelId} kind={RetentionOverrideLeftoverKind.Resource} /> }",
    );

    const projectPage: string = readSource(
      path.join(DASHBOARD_SRC, "Pages/Settings/TelemetrySettings.tsx"),
    );

    expect(projectPage).toContain(
      "belowPlan={ <RetentionOverrideLeftover<Project> modelType={Project} modelId={ProjectUtil.getCurrentProjectId()!} kind={RetentionOverrideLeftoverKind.Project} /> }",
    );

    const card: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Components/TelemetryResource/RetentionOverrideLeftover.tsx",
      ),
    );

    // It removes the override by writing the columns' default: nothing set.
    expect(card).toContain("isPlanGatedColumnOff(");
    expect(card).toContain("ModelAPI.updateById<TModel>({");
  });
});
