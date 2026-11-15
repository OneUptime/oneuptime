import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Project > Subscription > Users, in the Admin Dashboard (issue #6767: "I
 * can set active monitor limits on the admin dashboard, but I cannot set
 * user limits... This should be only applicable to SaaS and not
 * self-hosted.").
 *
 * The limit is the project's seatLimit, which the server already holds
 * every new person to (TeamMemberService.readPeopleLimits) - on a billed
 * install only - and which only a plan bought from a reseller wrote. Staff
 * now see how many users the project has beside it, and set or clear it
 * there, as they do the active monitor limit on the card above.
 *
 * Everything that connects the card to the Project row is hand-written and
 * fails silently (a misspelt field renders an empty row and 400s on save),
 * and the Admin Dashboard has no React harness in App's jest, so - as the
 * sibling AdminDashboard suites do - this holds the wiring against the
 * source and the locale files. What the card draws and saves is rendered on
 * the real page in Common's AdminProjectUsersCard.test.tsx.
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

const teamMemberServiceSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(COMMON_SRC, "Server/Services/TeamMemberService.ts"),
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

// From the card's name to the next card's.
const card: string =
  subscriptionSource
    .split('name="Project Users"')[1]
    ?.split("<CardModelDetail<Project>")[0] || "";

const formFields: string =
  card.split("formFields={[")[1]?.split("modelDetailProps")[0] || "";

const detailFields: string = card.split("modelDetailProps={{")[1] || "";

// The body of readPeopleLimits: where the server reads the limit it holds.
const readPeopleLimits: string =
  teamMemberServiceSource
    .split("public async readPeopleLimits(")[1]
    ?.split("private isHeldToFreePlanPerson(")[0] || "";

const KEY_USE: RegExp =
  /t\(\s*["']pages\.projectSubscription\.([A-Za-z0-9_]+)["']/g;

describe("Project > Subscription > Users", () => {
  test("the card is where this test thinks it is", () => {
    expect(card.trim()).not.toBe("");
    expect(card).toContain('id: "model-detail-project-users"');
    expect(readPeopleLimits.trim()).not.toBe("");
  });

  test("it sits beside the active monitor limit, before the balances", () => {
    const monitors: number = subscriptionSource.indexOf(
      'name="Project Active Monitors"',
    );
    const users: number = subscriptionSource.indexOf('name="Project Users"');
    const balances: number = subscriptionSource.indexOf(
      'name="Project Balances"',
    );

    expect(monitors).toBeGreaterThan(-1);
    expect(users).toBeGreaterThan(monitors);
    expect(balances).toBeGreaterThan(users);
  });

  test("it edits the limit the Project model declares, and nothing else", () => {
    expect(projectModelSource).toContain("public seatLimit?: number");
    expect(formFields).toContain("seatLimit: true");
    expect(formFields).not.toContain("paymentProviderSubscriptionSeats");
    expect(formFields.match(/field: \{/g) || []).toHaveLength(1);
  });

  test("only a master admin writes the limit: the column's update list is empty", () => {
    /*
     * An empty update list is master admin only - a master admin's write
     * never reaches the column permissions - so a project's own owner
     * cannot lift their plan's limit through the API.
     */
    const column: string =
      projectModelSource.split("public seatLimit?: number")[0] || "";
    const accessControl: string =
      column.split("@ColumnAccessControl({").pop() || "";

    expect(compact(accessControl)).toContain(compact("update: []"));
  });

  test("it shows the count beside the limit, read-only", () => {
    expect(projectModelSource).toContain(
      "public paymentProviderSubscriptionSeats?: number",
    );
    expect(detailFields).toContain("paymentProviderSubscriptionSeats: true");
    expect(detailFields).toContain("seatLimit: true");
    expect(
      detailFields.indexOf("paymentProviderSubscriptionSeats"),
    ).toBeLessThan(detailFields.indexOf("seatLimit: true"));
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
      'text={t("pages.projectSubscription.noUserLimit")}',
    );
    expect(detailFields).toContain("getUserLimit(item.seatLimit)");
  });

  /*
   * The card reads the limit as the server holds people to it, so it never
   * says a project is limited when everyone is let in, or the other way
   * round: nothing, or 0, is no limit.
   */
  test("it reads the limit by the one rule the server holds", () => {
    expect(compact(readPeopleLimits)).toContain(
      compact("seatLimit: project.seatLimit || null"),
    );
    expect(compact(subscriptionSource)).toContain(
      compact(
        "const getUserLimit: ( seatLimit: number | null | undefined, ) => number | null = (seatLimit: number | null | undefined): number | null => { return seatLimit || null; };",
      ),
    );
  });

  test("numbers are written the way the admin's language writes them", () => {
    expect(subscriptionSource).toContain(
      "toLocaleString(getNumberLocale(i18n.language",
    );
    expect(detailFields).toContain("formatCount(count)");
    expect(detailFields).toContain("formatCount(limit)");
  });

  test("a project at or past its limit says so beside the count", () => {
    expect(compact(detailFields)).toContain(compact("count > limit"));
    expect(compact(detailFields)).toContain(
      compact(
        't("pages.projectSubscription.overUserLimit", { over: formatCount(count - limit) })',
      ),
    );
    expect(compact(detailFields)).toContain(compact("count === limit"));
    expect(compact(detailFields)).toContain(
      compact('t("pages.projectSubscription.atUserLimit")'),
    );
  });

  test("its edit form is titled after what it edits, not 'Edit Project'", () => {
    expect(compact(card)).toContain(
      compact(
        'editModalTitle={t("pages.projectSubscription.userLimitEditButton")}',
      ),
    );
    expect(compact(card)).toContain(
      compact(
        'editButtonText={t("pages.projectSubscription.userLimitEditButton")}',
      ),
    );
  });

  test("it reads and writes the project being viewed, through the admin API", () => {
    expect(card).toContain("modelAPI={AdminModelAPI}");
    expect(card).toContain("isEditable={true}");
    expect(detailFields).toContain("modelId: modelId");
    expect(detailFields).toContain("modelType: Project");
  });

  test("it refreshes with the rest of the page, through the card's own refresher", () => {
    expect(card).toContain("refresher={refresher}");
    expect(detailFields).not.toMatch(/\brefresher\s*:/);
  });

  /*
   * The issue: SaaS only, not self-hosted. The card is drawn on a billed
   * install only - the page bails out before its cards otherwise - and the
   * server holds people to the limit on a billed install only.
   */
  describe("SaaS only", () => {
    test("the card is drawn on a billed install only", () => {
      const earlyReturn: number = subscriptionSource.indexOf(
        "if (!BILLING_ENABLED) {",
      );
      const users: number = subscriptionSource.indexOf('name="Project Users"');

      expect(earlyReturn).toBeGreaterThan(-1);
      expect(earlyReturn).toBeLessThan(users);
    });

    test("the server holds people to it on a billed install only", () => {
      expect(compact(readPeopleLimits)).toContain(
        compact("if (!IsBillingEnabled) { return null; }"),
      );
      expect(readPeopleLimits.indexOf("IsBillingEnabled")).toBeLessThan(
        readPeopleLimits.indexOf("seatLimit"),
      );
    });
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

  const CARD_KEYS: Array<string> = [
    "atUserLimit",
    "fieldUserLimit",
    "fieldUserLimitDescription",
    "fieldUsers",
    "noUserLimit",
    "overUserLimit",
    "userLimitCardDescription",
    "userLimitCardTitle",
    "userLimitEditButton",
  ];

  test("the card asks for exactly its own keys", () => {
    expect(usedKeys).toEqual([...CARD_KEYS].sort());
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

      for (const key of CARD_KEYS) {
        if (block[key] === english[key]) {
          untranslated.push(`${fileName} ${key}`);
        }
      }
    }

    expect(untranslated).toEqual([]);
  });

  // The one value the card fills: how far over its limit the project is.
  const PLACEHOLDERS_SET: Record<string, Array<string>> = {
    overUserLimit: ["{{over}}"],
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

  test("the description says pending invitations count, and names the Free plan's own limit, in every language", () => {
    const english: string =
      subscriptionBlock("en.json")["userLimitCardDescription"] || "";

    expect(english).toContain("pending invitations too");
    expect(english).toContain(
      "Free plan projects are also limited to one person.",
    );

    for (const fileName of localeFileNames()) {
      expect({
        fileName,
        description: subscriptionBlock(fileName)["userLimitCardDescription"],
      }).toEqual({
        fileName,
        description: expect.stringContaining("Free"),
      });
    }
  });

  test("the card's description is one short paragraph: at most 210 characters", () => {
    expect(
      (subscriptionBlock("en.json")["userLimitCardDescription"] || "").length,
    ).toBeLessThanOrEqual(210);
    expect(
      (subscriptionBlock("en.json")["fieldUserLimitDescription"] || "").length,
    ).toBeLessThanOrEqual(150);
  });

  /*
   * "No limit" and "At the limit" say the same of users as of active
   * monitors, on the card above: in each language, the same words. "Over
   * the limit" may not: Korean and Chinese count people with a word of
   * their own (명, 人), not the one they count monitors with (개, 个, 個).
   */
  test("its limit words are the active monitor card's, in every language", () => {
    const mismatched: Array<string> = [];

    for (const fileName of localeFileNames()) {
      const block: Record<string, string> = subscriptionBlock(fileName);

      for (const [userKey, monitorKey] of [
        ["noUserLimit", "noMonitorLimit"],
        ["atUserLimit", "atMonitorLimit"],
      ] as Array<[string, string]>) {
        if (block[userKey] !== block[monitorKey]) {
          mismatched.push(`${fileName} ${userKey}`);
        }
      }
    }

    expect(mismatched).toEqual([]);
  });

  test("Korean and Chinese count the people over the limit as people", () => {
    expect(subscriptionBlock("ko.json")["overUserLimit"]).toContain(
      "{{over}}명",
    );
    expect(subscriptionBlock("zh-CN.json")["overUserLimit"]).toContain(
      "{{over}} 人",
    );
    expect(subscriptionBlock("zh-TW.json")["overUserLimit"]).toContain(
      "{{over}} 人",
    );
  });
});
