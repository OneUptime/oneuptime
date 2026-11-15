import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Project > Subscription > Change Plan, in the Admin Dashboard (issue
 * #6771: "I'm not able to change plan for the project on the admin
 * dashboard").
 *
 * The Trial and Subscription card showed the plan with Extend Trial beside
 * it, and nothing to change it with. It now has Change Plan: the customer's
 * own plan picker in a dialog, which moves the project through a
 * master-admin route of its own (PUT /project/:id/admin-change-plan) - the
 * customer's change-plan route is held to the caller's own project and
 * billing permissions, which staff acting from here do not have.
 *
 * What connects the dialog to the route and the locales is hand-written and
 * fails silently (a misspelt route 404s, a missing key draws the key), and
 * the Admin Dashboard has no React harness in App's jest - so, as the
 * sibling AdminDashboard suites do, this holds the wiring against the
 * source and the locale files. What the dialog draws and sends is rendered
 * on the real page in Common's AdminProjectChangePlan.test.tsx; what the
 * route does, in Common's ProjectAPIAdminChangePlan.test.ts.
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

const projectApiSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(COMMON_SRC, "Server/API/ProjectAPI.ts"),
    "utf8",
  ),
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

// The Trial and Subscription card: from its name to the next card's.
const subscriptionCard: string =
  subscriptionSource
    .split('name="Project Subscription"')[1]
    ?.split("<CardModelDetail<Project>")[0] || "";

// The card's header buttons, in the order they are drawn.
const cardButtons: string =
  subscriptionCard.split("buttons: [")[1]?.split("isEditable=")[0] || "";

// The Change Plan dialog: from its flag to the Extend Trial dialog's.
const changePlanDialog: string =
  subscriptionSource
    .split("{showChangePlanModal ? (")[1]
    ?.split("{showExtendTrialModal ? (")[0] || "";

// What Change Plan sends: from its function to the plan-pick check after it.
const changePlanRequest: string =
  subscriptionSource
    .split("const changePlan: ChangePlanFunction")[1]
    ?.split("const getChangePlanError")[0] || "";

const KEY_USE: RegExp =
  /t\(\s*["']pages\.projectSubscription\.([A-Za-z0-9_]+)["']/g;

// The keys Change Plan says its words with, and nothing else on the page does.
const CHANGE_PLAN_KEYS: Array<string> = [
  "changePlanTitle",
  "changePlanDescription",
  "changePlanSubmitButton",
  "changePlanSuccess",
  "changePlanFailure",
  "planRequired",
  "samePlan",
];

describe("Project > Subscription > Change Plan", () => {
  test("the parts are where this test thinks they are", () => {
    expect(subscriptionCard).toContain(
      'id: "model-detail-project-subscription"',
    );
    expect(cardButtons.trim()).not.toBe("");
    expect(changePlanDialog).toContain("<BasicFormModal");
    expect(changePlanRequest).toContain("API.put(");
  });

  test("Change Plan sits on the Trial and Subscription card, before Extend Trial", () => {
    const changePlan: number = cardButtons.indexOf(
      't("pages.projectSubscription.changePlanTitle")',
    );
    const extendTrial: number = cardButtons.indexOf(
      't("pages.projectSubscription.extendTitle")',
    );

    expect(changePlan).toBeGreaterThan(-1);
    expect(extendTrial).toBeGreaterThan(changePlan);
    expect(cardButtons).toContain("setShowChangePlanModal(true)");
  });

  test("the card reads the price the project is on and who bills it, for the dialog", () => {
    expect(compact(subscriptionCard)).toContain(
      compact(
        "selectMoreFields: { paymentProviderPlanId: true, billingMarketplace: true }",
      ),
    );
    expect(subscriptionCard).toContain("setProject(item)");
  });

  test("it sends the plan picked to the master-admin route, which the server has", () => {
    expect(compact(subscriptionSource)).toContain(
      compact(".addRoute(`/${modelId.toString()}/admin-change-plan`)"),
    );
    expect(compact(changePlanRequest)).toContain(
      compact(
        "data: { data: { paymentProviderPlanId: paymentProviderPlanId } }",
      ),
    );

    // The route it calls, behind the master admin middleware alone.
    expect(compact(projectApiSource)).toContain(
      compact(
        "`${new this.entityType().getCrudApiPath()?.toString()}/:id/admin-change-plan`, MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware, async",
      ),
    );
  });

  test("a change that went through says so, and the card reads the project again", () => {
    expect(changePlanRequest).toContain(
      't("pages.projectSubscription.changePlanSuccess"',
    );
    expect(changePlanRequest).toContain("setShowChangePlanModal(false)");
    expect(changePlanRequest).toContain("setRefresher(!refresher)");
  });

  test("a refused change is said in the dialog, in the reader's words", () => {
    expect(changePlanRequest).toContain(
      "setError(API.getFriendlyMessage(err))",
    );
    expect(changePlanDialog).toContain("error: error");
  });

  test("the dialog is the customer's own plan picker, for a plan change", () => {
    expect(subscriptionSource).toContain(
      'import PlanPicker from "Common/UI/Components/Billing/PlanPicker/PlanPicker"',
    );
    expect(changePlanDialog).toContain("<PlanPicker");
    expect(changePlanDialog).toContain("isPlanChange={true}");
    expect(compact(changePlanDialog)).toContain(
      compact("currentPlanId={ project?.paymentProviderPlanId || undefined }"),
    );
    // A cloud marketplace bills month to month: its project sees those prices alone.
    expect(compact(changePlanDialog)).toContain(
      compact(
        "periods={ project?.billingMarketplace ? [BillingPeriod.Monthly] : undefined }",
      ),
    );
    expect(compact(changePlanDialog)).toContain(
      compact(
        'initialValues: { paymentProviderPlanId: project?.paymentProviderPlanId || "" }',
      ),
    );
  });

  test("the plan the project is already on is refused under the plans, not sent", () => {
    expect(changePlanDialog).toContain("customValidation:");
    expect(changePlanDialog).toContain("getChangePlanError(");
    expect(compact(subscriptionSource)).toContain(
      compact(
        "isSamePlanChoice(plans, project?.paymentProviderPlanId, pickedPlanId)",
      ),
    );
  });

  test("a refused change keeps the plan picked on screen: the dialog is busy, not reloaded", () => {
    expect(changePlanDialog).toContain("isSubmitting={isChangingPlan}");
    expect(changePlanDialog).not.toContain("isLoading=");
  });

  test("its button says what it does, as the customer's Change Plan does", () => {
    expect(compact(changePlanDialog)).toContain(
      compact(
        'submitButtonText={t( "pages.projectSubscription.changePlanSubmitButton", )}',
      ),
    );
  });

  test("it is shown on a billed install only: the page bails out before it otherwise", () => {
    const earlyReturn: number = subscriptionSource.indexOf(
      "if (!BILLING_ENABLED) {",
    );
    const button: number = subscriptionSource.indexOf(
      't("pages.projectSubscription.changePlanTitle")',
      earlyReturn,
    );

    expect(earlyReturn).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(earlyReturn);
  });
});

describe("translations", () => {
  const usedKeys: Array<string> = Array.from(
    new Set(
      [...subscriptionSource.matchAll(KEY_USE)].map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  );

  test("the page asks for every Change Plan key", () => {
    expect(
      CHANGE_PLAN_KEYS.filter((key: string): boolean => {
        return !usedKeys.includes(key);
      }),
    ).toEqual([]);
  });

  test.each(localeFileNames())(
    "%s has a sentence for every Change Plan key",
    (fileName: string) => {
      const block: Record<string, string> = subscriptionBlock(fileName);

      expect(
        CHANGE_PLAN_KEYS.filter((key: string): boolean => {
          return typeof block[key] !== "string" || !block[key]!.trim();
        }),
      ).toEqual([]);
    },
  );

  test("every other locale has its own words for Change Plan", () => {
    const english: Record<string, string> = subscriptionBlock("en.json");

    const untranslated: Array<string> = [];

    for (const fileName of localeFileNames()) {
      if (fileName === "en.json") {
        continue;
      }

      const block: Record<string, string> = subscriptionBlock(fileName);

      for (const key of CHANGE_PLAN_KEYS) {
        if (block[key] === english[key]) {
          untranslated.push(`${fileName} ${key}`);
        }
      }
    }

    expect(untranslated).toEqual([]);
  });

  // The one value Change Plan fills: the name of the plan the project moved to.
  const PLACEHOLDERS_SET: Record<string, Array<string>> = {
    changePlanSuccess: ["{{plan}}"],
  };

  const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

  test("its words fill no placeholder it never sets, and keep the one it does", () => {
    for (const fileName of localeFileNames()) {
      const block: Record<string, string> = subscriptionBlock(fileName);

      for (const key of CHANGE_PLAN_KEYS) {
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

  test("the success message fills the plan's name", () => {
    expect(compact(changePlanRequest)).toContain(
      compact('t("pages.projectSubscription.changePlanSuccess", { plan:'),
    );
  });

  /*
   * The title and the button are the customer's Change Plan: in each
   * language, the Dashboard's own wording of it, so staff and the customer
   * they are on the phone with name it alike.
   */
  test("its title and its button are worded as the customer's Change Plan", () => {
    const dashboardLocales: string = nodePath.join(
      __dirname,
      "../../FeatureSet/Dashboard/src/Locales",
    );

    const mismatched: Array<string> = [];

    for (const fileName of localeFileNames()) {
      const dashboard: Record<string, unknown> = JSON.parse(
        fs.readFileSync(nodePath.join(dashboardLocales, fileName), "utf8"),
      );
      const block: Record<string, string> = subscriptionBlock(fileName);

      const pairs: Array<[string, string]> = [
        ["changePlanTitle", "Change Plan"],
        ["changePlanSubmitButton", "Change Plan"],
      ];

      for (const [key, dashboardKey] of pairs) {
        if (block[key] !== dashboard[dashboardKey]) {
          mismatched.push(
            `${fileName} ${key}: ${block[key]} / ${String(dashboard[dashboardKey])}`,
          );
        }
      }
    }

    expect(mismatched).toEqual([]);
  });
});
