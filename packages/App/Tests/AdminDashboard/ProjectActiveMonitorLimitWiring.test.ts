import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Project > Subscription > Active Monitors, in the Admin Dashboard.
 *
 * The support report was found by reading a project's row in the database:
 * activeMonitorsLimit 500, currentActiveMonitorsCount 2881. The limit a plan
 * bought from a reseller writes is now held on every monitor create
 * (Common/Server/Utils/Billing/ActiveMonitorLimit), and staff see the two
 * numbers side by side on the project's Subscription page - and can raise or
 * clear the limit there, as the reseller's own change of tier does.
 *
 * Everything that connects the card to the Project row is hand-written and
 * fails silently (a misspelt field renders an empty row and 400s on save),
 * and the Admin Dashboard has no React harness in App's jest, so - as the
 * sibling AdminDashboard suites do - this holds the wiring against the
 * source and the locale files. What the card draws (2,881 with "2,381 over
 * the limit" beside it, "No limit", the edit form's title) is rendered on
 * the real page in Common's AdminProjectActiveMonitorsCard.test.tsx.
 */

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

const COMMON_SRC: string = nodePath.join(__dirname, "../../../Common");

const COMMENTS: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENTS: RegExp = /(^|[^:])\/\/[^\n]*/g;

// Prose explaining a pattern must not satisfy an assertion about the code.
function stripComments(source: string): string {
  return source.replace(COMMENTS, "").replace(LINE_COMMENTS, "$1");
}

const WHITESPACE: RegExp = /\s+/g;
const TRAILING_COMMA: RegExp = /,(?=[)}\]])/g;

/*
 * Code with no whitespace and no trailing commas, so an assertion holds
 * however prettier wraps it.
 */
function compact(code: string): string {
  return code.replace(WHITESPACE, "").replace(TRAILING_COMMA, "");
}

const subscriptionSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(ADMIN_DASHBOARD_SRC, "Pages/Projects/View/Subscription.tsx"),
    "utf8",
  ),
);

const projectModelSource: string = fs.readFileSync(
  nodePath.join(COMMON_SRC, "Models/DatabaseModels/Project.ts"),
  "utf8",
);

const LOCALES_DIR: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");

function localeFileNames(): Array<string> {
  return fs.readdirSync(LOCALES_DIR).filter((file: string) => {
    return file.endsWith(".json");
  });
}

function subscriptionBlock(fileName: string): Record<string, string> {
  return (
    JSON.parse(fs.readFileSync(nodePath.join(LOCALES_DIR, fileName), "utf8"))[
      "pages"
    ]?.["projectSubscription"] || {}
  );
}

// From the card's name to the next card's.
const card: string =
  subscriptionSource
    .split('name="Project Active Monitors"')[1]
    ?.split("<CardModelDetail<Project>")[0] || "";

const formFields: string =
  card.split("formFields={[")[1]?.split("modelDetailProps")[0] || "";

const detailFields: string = card.split("modelDetailProps={{")[1] || "";

const KEY_USE: RegExp =
  /t\(\s*["']pages\.projectSubscription\.([A-Za-z0-9_]+)["']/g;

describe("Project > Subscription > Active Monitors", () => {
  test("the card is where this test thinks it is", () => {
    expect(card.trim()).not.toBe("");
    expect(card).toContain('id: "model-detail-project-active-monitors"');
  });

  test("it sits between the plan and the balances", () => {
    const plan: number = subscriptionSource.indexOf(
      'name="Project Subscription"',
    );
    const monitors: number = subscriptionSource.indexOf(
      'name="Project Active Monitors"',
    );
    const balances: number = subscriptionSource.indexOf(
      'name="Project Balances"',
    );

    expect(plan).toBeGreaterThan(-1);
    expect(monitors).toBeGreaterThan(plan);
    expect(balances).toBeGreaterThan(monitors);
  });

  test("it edits the limit the Project model declares, and nothing else", () => {
    expect(projectModelSource).toContain("public activeMonitorsLimit?: number");
    expect(formFields).toContain("activeMonitorsLimit: true");
    expect(formFields).not.toContain("currentActiveMonitorsCount");
  });

  test("it shows the count beside the limit, read-only", () => {
    expect(projectModelSource).toContain(
      "public currentActiveMonitorsCount?: number",
    );
    expect(detailFields).toContain("currentActiveMonitorsCount: true");
    expect(detailFields).toContain("activeMonitorsLimit: true");
    expect(detailFields.indexOf("currentActiveMonitorsCount")).toBeLessThan(
      detailFields.indexOf("activeMonitorsLimit"),
    );
  });

  test("the limit is a number, optional, and at least one: empty is no limit", () => {
    expect(formFields).toContain("FormFieldSchemaType.Number");
    expect(formFields).toContain("required: false");
    expect(formFields).not.toContain("required: true");
    expect(formFields).toContain("minValue: 1");
  });

  test("an unset limit reads as 'No limit' rather than a blank row", () => {
    expect(detailFields).toContain("<PlaceholderText");
    expect(detailFields).toContain(
      'text={t("pages.projectSubscription.noMonitorLimit")}',
    );
    // Nothing, or 0, is no limit: the one rule the server holds.
    expect(detailFields).toContain("ActiveMonitorLimitUtil.getProjectLimit(");
  });

  test("numbers are written the way the admin's language writes them", () => {
    expect(subscriptionSource).toContain("toLocaleString(i18n.language");
    expect(detailFields).toContain("formatCount(count)");
    expect(detailFields).toContain("formatCount(limit)");
  });

  test("a project at or past its limit says so beside the count", () => {
    // However prettier wraps the calls.
    expect(compact(detailFields)).toContain(compact("count > limit"));
    expect(compact(detailFields)).toContain(
      compact(
        't("pages.projectSubscription.overMonitorLimit", { over: formatCount(count - limit) })',
      ),
    );
    expect(compact(detailFields)).toContain(compact("count === limit"));
    expect(compact(detailFields)).toContain(
      compact('t("pages.projectSubscription.atMonitorLimit")'),
    );
  });

  test("its edit form is titled after what it edits, not 'Edit Project'", () => {
    expect(compact(card)).toContain(
      compact(
        'editModalTitle={t("pages.projectSubscription.monitorLimitEditButton")}',
      ),
    );
  });

  test("it reads and writes the project being viewed, through the admin API", () => {
    expect(card).toContain("modelAPI={AdminModelAPI}");
    expect(card).toContain("isEditable={true}");
    expect(detailFields).toContain("modelId: modelId");
    expect(detailFields).toContain("modelType: Project");
  });

  test("it refreshes with the rest of the page", () => {
    expect(card).toContain("refresher={refresher}");
    expect(detailFields).toContain("refresher: refresher");
  });

  test("it is shown on a billed install only: the page bails out before it otherwise", () => {
    const earlyReturn: number = subscriptionSource.indexOf(
      "if (!BILLING_ENABLED) {",
    );
    const monitors: number = subscriptionSource.indexOf(
      'name="Project Active Monitors"',
    );

    expect(earlyReturn).toBeGreaterThan(-1);
    expect(earlyReturn).toBeLessThan(monitors);
  });
});

describe("translations", () => {
  const usedKeys: Array<string> = Array.from(
    new Set(
      [...card.matchAll(KEY_USE)].map((match: RegExpMatchArray): string => {
        return match[1]!;
      }),
    ),
  ).sort();

  test("the card asks for exactly its own keys", () => {
    expect(usedKeys).toEqual(
      [
        "atMonitorLimit",
        "fieldActiveMonitors",
        "fieldMonitorLimit",
        "fieldMonitorLimitDescription",
        "monitorLimitCardDescription",
        "monitorLimitCardTitle",
        "monitorLimitEditButton",
        "noMonitorLimit",
        "overMonitorLimit",
      ].sort(),
    );
  });

  test.each(localeFileNames())(
    "%s has a sentence for every key the card asks for",
    (fileName: string) => {
      const block: Record<string, string> = subscriptionBlock(fileName);

      expect(
        usedKeys.filter((key: string): boolean => {
          return typeof block[key] !== "string" || !block[key]!.trim();
        }),
      ).toEqual([]);
    },
  );

  test("every other locale has its own words for the card", () => {
    const english: Record<string, string> = subscriptionBlock("en.json");

    const untranslated: Array<string> = [];

    for (const fileName of localeFileNames()) {
      if (fileName === "en.json") {
        continue;
      }

      const block: Record<string, string> = subscriptionBlock(fileName);

      for (const key of [
        "monitorLimitCardTitle",
        "monitorLimitCardDescription",
        "monitorLimitEditButton",
        "fieldMonitorLimit",
        "fieldMonitorLimitDescription",
        "noMonitorLimit",
        "overMonitorLimit",
        "atMonitorLimit",
      ]) {
        if (block[key] === english[key]) {
          untranslated.push(`${fileName} ${key}`);
        }
      }
    }

    expect(untranslated).toEqual([]);
  });

  // The one value the card fills: how far over its limit the project is.
  const PLACEHOLDERS_SET: Record<string, Array<string>> = {
    overMonitorLimit: ["{{over}}"],
  };

  const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

  test("the card's words fill no placeholder the card never sets", () => {
    for (const fileName of localeFileNames()) {
      const block: Record<string, string> = subscriptionBlock(fileName);

      for (const key of usedKeys) {
        expect({
          fileName,
          key,
          placeholders: (block[key] || "").match(PLACEHOLDER) || [],
        }).toEqual({
          fileName,
          key,
          placeholders: PLACEHOLDERS_SET[key] || [],
        });
      }
    }
  });

  test("the description names the Free plan's own limit, in every language", () => {
    expect(
      subscriptionBlock("en.json")["monitorLimitCardDescription"],
    ).toContain("Free plan projects are also held to the Free plan's limit.");

    for (const fileName of localeFileNames()) {
      expect({
        fileName,
        description: subscriptionBlock(fileName)["monitorLimitCardDescription"],
      }).toEqual({
        fileName,
        description: expect.stringContaining("Free"),
      });
    }
  });
});
