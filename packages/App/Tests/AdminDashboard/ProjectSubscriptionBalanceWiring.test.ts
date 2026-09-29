import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The admin dashboard has no React render harness (App's jest environment is
 * "node" and the package carries no react/testing-library), so this asserts
 * the page's wiring the way the other AdminDashboard suites do: against the
 * source text and the locale files.
 *
 * What is worth pinning here is everything that silently breaks the feature
 * without breaking a compile - a locale missing a key renders the raw key
 * string to staff, and the client-side amount ceiling drifting from the
 * server's turns a helpful form error into an opaque 400.
 */

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

const COMMON_SRC: string = nodePath.join(__dirname, "../../../Common");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(ADMIN_DASHBOARD_SRC, relativePath), "utf8"),
  );
}

const subscriptionSource: string = readSource(
  "Pages/Projects/View/Subscription.tsx",
);

const sideMenuSource: string = readSource("Pages/Projects/View/SideMenu.tsx");

const projectServiceSource: string = fs.readFileSync(
  nodePath.join(COMMON_SRC, "Server/Services/ProjectService.ts"),
  "utf8",
);

const LOCALES_DIR: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");

function localeFileNames(): Array<string> {
  return fs.readdirSync(LOCALES_DIR).filter((file: string) => {
    return file.endsWith(".json");
  });
}

function readLocale(fileName: string): Record<string, any> {
  return JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, fileName), "utf8"),
  );
}

describe("Project > Subscription > balance adjustment", () => {
  describe("the balances card", () => {
    test("renders both prepaid balances", () => {
      expect(subscriptionSource).toContain(
        "smsOrCallCurrentBalanceInUSDCents: true",
      );
      expect(subscriptionSource).toContain("aiCurrentBalanceInUSDCents: true");
    });

    test("renders them as money rather than a raw cent count", () => {
      /*
       * The columns store cents. Without FieldType.USDCents a balance of
       * 2500 renders as "2500" and reads as $2500 at a glance.
       */
      const balancesCard: string =
        subscriptionSource.split("model-detail-project-balances")[1] || "";

      expect(balancesCard).toContain("FieldType.USDCents");
      expect(
        (balancesCard.match(/FieldType\.USDCents/g) || []).length,
      ).toBeGreaterThanOrEqual(2);
    });

    test("is read-only - the balance moves through the endpoint, not a CRUD update", () => {
      /*
       * Both balance columns declare `update: []` in their access control, so
       * an inline edit could never write them anyway; it would just fail.
       */
      const balancesCard: string =
        subscriptionSource
          .split('name="Project Balances"')[1]
          ?.split("modelDetailProps")[0] || "";

      expect(balancesCard).toContain("isEditable={false}");
    });
  });

  describe("the adjust endpoint", () => {
    test("posts to the project's adjust-balance route", () => {
      expect(subscriptionSource).toContain("/adjust-balance");
    });

    /*
     * Scoped to the API.put payload rather than the whole file. Every one of
     * these names also appears in the dropdown builders, the validators, the
     * form field descriptors and the locale keys - roughly eighteen times
     * each - so a file-wide `toContain` stays green even with the request
     * body deleted outright, which is exactly the regression worth catching:
     * the wire keys are untyped (API.put takes a JSONObject), so renaming one
     * compiles cleanly and 400s every adjustment at runtime.
     */
    const requestPayload: string =
      subscriptionSource
        .split("url: adjustBalanceApiUrl,")[1]
        ?.split("});")[0] || "";

    test("the payload block is where this test thinks it is", () => {
      // Guards the guard: a moved call site must fail loudly, not vacuously.
      expect(requestPayload.trim()).not.toBe("");
      expect(requestPayload).toContain("data:");
    });

    test.each(["balanceType", "adjustmentType", "amountInUSD", "reason"])(
      "sends %s in the request body",
      (field: string) => {
        expect(requestPayload).toContain(`${field}: values.${field}`);
      },
    );

    test("refreshes the card after a successful adjustment", () => {
      // Otherwise the card keeps showing the balance from before the write.
      const handler: string =
        subscriptionSource
          .split("const adjustBalance:")[1]
          ?.split("const onAdjustBalanceSubmit")[0] || "";

      expect(handler).toContain("setRefresher(!refresher)");
    });
  });

  describe("SaaS gating", () => {
    test("the whole page bails out when billing is disabled", () => {
      /*
       * Self-hosted installs have no prepaid balances. The early return above
       * the balances card is what keeps the feature hosted-only, so it has to
       * stay above it.
       */
      const earlyReturnIndex: number = subscriptionSource.indexOf(
        "if (!BILLING_ENABLED)",
      );
      const balancesCardIndex: number =
        subscriptionSource.indexOf('"Project Balances"');

      expect(earlyReturnIndex).toBeGreaterThan(-1);
      expect(balancesCardIndex).toBeGreaterThan(-1);
      expect(earlyReturnIndex).toBeLessThan(balancesCardIndex);
    });

    test("the side menu only links to this page on the hosted edition", () => {
      expect(sideMenuSource).toContain("BILLING_ENABLED ?");
      expect(sideMenuSource).toContain("PROJECT_SUBSCRIPTION");
    });
  });

  describe("the client-side amount ceiling", () => {
    test("matches the server's, so the form catches a fat-fingered amount first", () => {
      /*
       * If these drift, an amount the form accepts comes back as a 400 the
       * admin cannot act on - and one the form rejects is not actually
       * refused by the API.
       */
      const clientMatch: RegExpMatchArray | null = subscriptionSource.match(
        /MAX_BALANCE_ADJUSTMENT_IN_USD:\s*number\s*=\s*([\d_]+)/,
      );

      const serverMatch: RegExpMatchArray | null = projectServiceSource.match(
        /MAX_BALANCE_ADJUSTMENT_IN_USD_CENTS:\s*number\s*=\s*([\d_]+)\s*\*\s*100/,
      );

      expect(clientMatch).not.toBeNull();
      expect(serverMatch).not.toBeNull();

      expect(Number(clientMatch![1]!.replace(/_/g, ""))).toBe(
        Number(serverMatch![1]!.replace(/_/g, "")),
      );
    });
  });

  describe("translations", () => {
    const usedKeys: Array<string> = Array.from(
      new Set(
        [
          ...subscriptionSource.matchAll(
            /t\(\s*["']pages\.projectSubscription\.([A-Za-z0-9_]+)["']/g,
          ),
        ].map((match: RegExpMatchArray) => {
          return match[1]!;
        }),
      ),
    );

    test("the page actually uses the new balance keys", () => {
      // Guards the guard: a typo'd regex above would otherwise assert nothing.
      expect(usedKeys).toContain("adjustBalanceTitle");
      expect(usedKeys).toContain("balancesCardTitle");
      expect(usedKeys.length).toBeGreaterThan(20);
    });

    test.each(localeFileNames())(
      "%s defines every key the page asks for",
      (fileName: string) => {
        /*
         * i18next falls back to rendering the key itself, so a missing key
         * shows staff "pages.projectSubscription.amountLabel" as a form label
         * rather than failing anywhere a compile or a render test would see.
         */
        const locale: Record<string, any> = readLocale(fileName);
        const block: Record<string, string> =
          locale["pages"]?.["projectSubscription"] || {};

        const missing: Array<string> = usedKeys.filter((key: string) => {
          return typeof block[key] !== "string" || block[key]!.trim() === "";
        });

        expect(missing).toEqual([]);
      },
    );

    test.each(localeFileNames())(
      "%s keeps the interpolation placeholders intact",
      (fileName: string) => {
        /*
         * "{{max}}" is substituted by i18next. A translation that localises
         * the token, or drops it, renders the literal braces to staff or
         * silently loses the number.
         */
        const english: Record<string, string> =
          readLocale("en.json")["pages"]["projectSubscription"];
        const block: Record<string, string> =
          readLocale(fileName)["pages"]["projectSubscription"];

        const broken: Array<string> = [];

        for (const [key, englishValue] of Object.entries(english)) {
          for (const token of ["{{max}}", "{{balance}}", "{{date}}"]) {
            if (englishValue.includes(token) && !block[key]?.includes(token)) {
              broken.push(`${key} is missing ${token}`);
            }
          }
        }

        expect(broken).toEqual([]);
      },
    );

    test("every locale carries the same keys as English, in the same order", () => {
      /*
       * Order is not functionally required, but keeping it identical is what
       * makes a missing key obvious in review rather than buried at the end.
       */
      const englishKeys: Array<string> = Object.keys(
        readLocale("en.json")["pages"]["projectSubscription"],
      );

      const mismatched: Array<string> = [];

      for (const fileName of localeFileNames()) {
        const keys: Array<string> = Object.keys(
          readLocale(fileName)["pages"]?.["projectSubscription"] || {},
        );

        if (JSON.stringify(keys) !== JSON.stringify(englishKeys)) {
          mismatched.push(fileName);
        }
      }

      expect(mismatched).toEqual([]);
    });
  });
});
