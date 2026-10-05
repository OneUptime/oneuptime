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
 *     project still requires SSO.
 *
 * This holds the source to that, and the new sentences to a translation in
 * every language. The behaviour is tested in Common/Tests (PlanGatedTurnOff,
 * PlanGatedTurnOffWrites, PlanGatedColumnDefault, ModelSwitchRow,
 * ModelSwitchUtil, DashboardSharingCard, StatusPageAccessCard,
 * StatusPageReportsCard, PlanGatedPage, SsoPages).
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
  });

  test("are keys of the English locale", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const sentence of NEW_SENTENCES) {
      expect([sentence, english[sentence]]).toEqual([sentence, sentence]);
    }
  });

  test.each(OTHER_LOCALES)(
    "are translated in %s, with the same placeholders",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const sentence of NEW_SENTENCES) {
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
      "if (isPlanGatedColumnDefault(metadata, value)) { return null; }",
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

  test("a plan-gated page draws what can still be switched off under its upsell", () => {
    const gate: string = readSource(
      path.join(DASHBOARD_SRC, "Components/Billing/PlanGatedPage.tsx"),
    );

    expect(gate).toContain("{props.belowPlan || <></>}");
  });
});
