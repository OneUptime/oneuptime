import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * @stripe/stripe-js injects <script src="https://js.stripe.com/v3"> when the
 * MODULE is imported, not when loadStripe is called. Billing.tsx is part of
 * the dashboard bundle, so that request went out on every dashboard page load
 * of every install - including self-hosted ones with billing switched off and
 * air-gapped ones with no route to Stripe at all, where it is one of the
 * failures reported in
 * https://github.com/OneUptime/oneuptime/issues/2570.
 *
 * The /pure entrypoint defers the injection to the first loadStripe call. The
 * import style is the entire fix, and reverting it is a one-word edit that
 * changes nothing visible in development, so it is pinned against the source.
 *
 * Pinned against source rather than exercised, for the same reason as
 * AISettingsSeparation.test.ts: react and @stripe/* are dependencies of the
 * Dashboard package, not of App, so importing these pages here would not
 * resolve.
 */

const DASHBOARD_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
);

const DASHBOARD_SRC: string = path.join(DASHBOARD_ROOT, "src");

function read(...relativeParts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8");
}

function collectSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath));
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(absolutePath);
    }
  }

  return files;
}

/*
 * The rule is about where loadStripe comes from. Type-only imports from the
 * bare package (Stripe, StripeError, PaymentIntentResult) are erased by the
 * compiler and inject nothing, so they stay legal.
 */
const LOAD_STRIPE_FROM_BARE_PACKAGE: RegExp =
  /import\s*\{[^}]*\bloadStripe\b[^}]*\}\s*from\s*["']@stripe\/stripe-js["']/;

const LOAD_STRIPE_FROM_PURE: RegExp =
  /import\s*\{[^}]*\bloadStripe\b[^}]*\}\s*from\s*["']@stripe\/stripe-js\/pure["']/;

describe("Stripe.js is never fetched just because the dashboard loaded", () => {
  test.each([["Pages/Settings/Billing.tsx"], ["Pages/Settings/Invoices.tsx"]])(
    "%s imports loadStripe from the pure entrypoint",
    (relativePath: string) => {
      const source: string = read(...relativePath.split("/"));

      expect(LOAD_STRIPE_FROM_PURE.test(source)).toBe(true);
      expect(LOAD_STRIPE_FROM_BARE_PACKAGE.test(source)).toBe(false);
    },
  );

  test("no file anywhere in the dashboard imports loadStripe from the bare package", () => {
    const offenders: Array<string> = collectSourceFiles(DASHBOARD_SRC)
      .filter((file: string): boolean => {
        return LOAD_STRIPE_FROM_BARE_PACKAGE.test(
          fs.readFileSync(file, "utf8"),
        );
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(offenders).toEqual([]);
  });

  test("the pure entrypoint exists in the version the dashboard depends on", () => {
    /*
     * A typo in the specifier would fail the bundle, not this test - but a
     * major bump that dropped /pure would fail the bundle at release time
     * instead of here.
     */
    const stripeRoot: string = path.join(
      DASHBOARD_ROOT,
      "node_modules",
      "@stripe",
      "stripe-js",
    );

    if (!fs.existsSync(stripeRoot)) {
      /* Dashboard deps are not installed in every CI job that runs App's suite. */
      return;
    }

    expect(fs.existsSync(path.join(stripeRoot, "pure.js"))).toBe(true);
  });

  test("Billing.tsx only calls loadStripe when billing is enabled", () => {
    /*
     * /pure alone moves the request from page load to the moment the billing
     * settings page mounts. That page is still routable on a self-hosted
     * install, and the request would still hang there, so the call is guarded
     * too.
     */
    const source: string = read("Pages", "Settings", "Billing.tsx");

    const guardedCall: RegExp =
      /if\s*\(\s*BILLING_ENABLED\s*\)\s*\{[\s\S]{0,400}?loadStripe\(/;

    expect(guardedCall.test(source)).toBe(true);
    expect(source).toContain("BILLING_ENABLED");
  });

  test("Invoices.tsx only reaches for Stripe inside the pay-invoice flow", () => {
    /*
     * There is no top-level call here to guard: loadStripe is reached only
     * after the API hands back a client secret for an invoice that needs
     * further authentication, which cannot happen with billing off.
     */
    const source: string = read("Pages", "Settings", "Invoices.tsx");

    const loadStripeCalls: number = (source.match(/loadStripe\(/g) || [])
      .length;

    expect(loadStripeCalls).toBe(1);
    expect(source).toContain("clientSecret");
  });
});
