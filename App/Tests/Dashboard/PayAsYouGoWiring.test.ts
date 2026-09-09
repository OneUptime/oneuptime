import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Telemetry ingest and every non-Manual monitor are metered, and nothing about
 * either is included in the Free plan. The dashboard says so before the
 * charge starts. Bulk monitor creation also requires consent.
 *
 * The behaviour itself is exercised against the real form in
 * Common/Tests/App/Dashboard/PayAsYouGoConsentGate.test.tsx. What is pinned
 * here is the wiring: the notices and telemetry form fields are one-line
 * call sites that can be dropped in a refactor without breaking a type or a
 * render, which would silently take the warning away and leave Free plan users
 * billed with no notice.
 *
 * Pinned against source rather than exercised, for the same reason as
 * StripeOfflineLoading.test.ts: react is a dependency of the Dashboard
 * package, not of App, so importing these pages here would not resolve.
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

describe("Pay as you go wiring", () => {
  describe("telemetry ingestion keys page", () => {
    const source: string = read(
      "Pages",
      "Settings",
      "TelemetryIngestionKeys.tsx",
    );

    test("renders the pay as you go card above the table", () => {
      expect(source).toContain("<TelemetryPayAsYouGoCard />");
    });

    test("spreads the pricing notice into the create modal's form", () => {
      expect(source).toContain("...getTelemetryPayAsYouGoFormFields()");
    });

    test("imports both from the billing component", () => {
      expect(source).toContain('from "../../Components/Billing/PayAsYouGo"');
    });
  });

  describe("ingestion key selector", () => {
    /*
     * The second door onto creating a key. It used to live inside
     * Components/Telemetry/Documentation.tsx; it was extracted here when the
     * security events setup guide needed the same key step, so both guides
     * now share one modal and its pricing notice.
     */
    const source: string = read(
      "Components",
      "Telemetry",
      "IngestionKeySelector.tsx",
    );

    test("includes the pricing notice in its create key modal", () => {
      expect(source).toContain("...getTelemetryPayAsYouGoFormFields()");
      expect(source).toContain('from "../Billing/PayAsYouGo"');
    });

    test("has exactly one create key modal", () => {
      expect(
        (source.match(/<ModelFormModal<TelemetryIngestionKey>/g) || []).length,
      ).toBe(1);
    });

    test("the guides reach it rather than rolling their own modal", () => {
      /*
       * Both setup guides render the key step through this component. If
       * either grew a create-key modal of its own it would be a third door,
       * which the sweep below would then have to catch.
       */
      for (const guide of [
        read("Components", "Telemetry", "Documentation.tsx"),
        read("Components", "SecurityEvents", "SecurityEventsSetupGuide.tsx"),
      ]) {
        expect(guide).toContain("<IngestionKeySelector");
        expect(guide).not.toContain("<ModelFormModal<TelemetryIngestionKey>");
      }
    });
  });

  describe("every surface that creates an ingestion key shows billing information", () => {
    test("no create form for TelemetryIngestionKey exists without the notice fields", () => {
      /*
       * Guards against a third door being added later. Any file that builds a
       * create form over TelemetryIngestionKey has to include the notice.
       */
      const creatingFiles: Array<string> = collectSourceFiles(
        DASHBOARD_SRC,
      ).filter((file: string) => {
        const source: string = fs.readFileSync(file, "utf8");

        const buildsACreateForm: boolean =
          source.includes("<ModelFormModal<TelemetryIngestionKey>") ||
          (source.includes("ModelTable<TelemetryIngestionKey>") &&
            source.includes("isCreateable={true}"));

        return buildsACreateForm;
      });

      expect(creatingFiles.length).toBeGreaterThan(0);

      for (const file of creatingFiles) {
        expect({
          file: path.relative(DASHBOARD_SRC, file),
          hasBillingNotice: fs
            .readFileSync(file, "utf8")
            .includes("getTelemetryPayAsYouGoFormFields()"),
        }).toEqual({
          file: path.relative(DASHBOARD_SRC, file),
          hasBillingNotice: true,
        });
      }
    });
  });

  describe("create monitor page", () => {
    const source: string = read("Pages", "Monitor", "Create.tsx");

    test("renders the pay as you go card above the create form", () => {
      expect(source).toContain("<MonitorPayAsYouGoCard />");
    });

    test("does not add a duplicate billing acknowledgement to the form", () => {
      expect(source).not.toContain("getMonitorPayAsYouGoFormFields");
      expect(source).not.toContain("monitorPayAsYouGoAcknowledged");
      expect(source).not.toContain("validateMonitorConsent");
    });

    test("keeps the monitor-info step for the monitor details and type picker", () => {
      expect(source).toContain('id: "monitor-info"');
    });

    test("imports the warning card from the billing component", () => {
      expect(source).toContain('from "../../Components/Billing/PayAsYouGo"');
    });
  });

  describe("monitor recommendations (bulk create)", () => {
    const listSource: string = read(
      "Components",
      "Recommendations",
      "MonitorRecommendations.tsx",
    );
    const sideOverSource: string = read(
      "Components",
      "Recommendations",
      "MonitorRecommendationCreateSideOver.tsx",
    );

    test("shows the pay as you go card - this is the largest charge one click can start", () => {
      expect(listSource).toContain("<MonitorPayAsYouGoCard />");
    });

    test("disables its submit until the batch charge is acknowledged", () => {
      expect(sideOverSource).toContain("MonitorBatchPayAsYouGoConsent");
      expect(sideOverSource).toContain(
        "needsBillingConsent && !hasAcknowledgedBilling",
      );
    });

    test("refuses in the create loop too, not only in the side over", () => {
      /*
       * The loop calls ModelAPI.createOrUpdate directly - there is no
       * ModelForm to validate it - so the guard has to live next to the calls.
       */
      expect(listSource).toContain("isMonitorBatchConsentRequired");
      expect(listSource).toContain("MONITOR_CONSENT_ERROR");
    });
  });

  describe("every surface that creates a monitor shows billing information", () => {
    test("no create path for Monitor exists without a PayAsYouGo reference", () => {
      /*
       * The telemetry half of this change had an invariant like this from the
       * start; the monitor half did not, which is how the recommendations
       * bulk-create path was missed. Any file that creates a Monitor has to
       * reference the pay-as-you-go notice or consent component.
       */
      const creatingFiles: Array<string> = collectSourceFiles(
        DASHBOARD_SRC,
      ).filter((file: string) => {
        const source: string = fs.readFileSync(file, "utf8");

        return (
          source.includes("modelType: Monitor,") &&
          source.includes("FormType.Create")
        );
      });

      expect(creatingFiles.length).toBeGreaterThan(0);

      for (const file of creatingFiles) {
        const relative: string = path.relative(DASHBOARD_SRC, file);

        expect({
          file: relative,
          hasBillingNotice: fs
            .readFileSync(file, "utf8")
            .includes("PayAsYouGo"),
        }).toEqual({ file: relative, hasBillingNotice: true });
      }
    });
  });

  describe("the notices themselves", () => {
    const source: string = read("Components", "Billing", "PayAsYouGo.tsx");

    /*
     * Each of these decides whether a price is shown or a charge is gated, so
     * each must consult the plan itself rather than trust its caller to. What
     * they actually render on each plan is covered by
     * Common/Tests/App/Dashboard/PayAsYouGoNotices.test.tsx; this only pins
     * that a new entry point cannot be added without its own guard.
     */
    const PLAN_GATED_ENTRY_POINTS: Array<string> = [
      "TelemetryPayAsYouGoCard",
      "MonitorPayAsYouGoCard",
      "getTelemetryPayAsYouGoFormFields",
      "isMonitorBatchConsentRequired",
    ];

    test.each(PLAN_GATED_ENTRY_POINTS)("%s is exported", (name: string) => {
      expect(source).toMatch(new RegExp(`export (const|function) ${name}\\b`));
    });

    test("has exactly one Free-plan guard per entry point", () => {
      const gateCount: number = (
        source.match(/if \(!isProjectOnFreePlan\(\)\)/g) || []
      ).length;

      expect(gateCount).toBe(PLAN_GATED_ENTRY_POINTS.length);
    });

    test("quote the rates from the shared pricing constants, not from literals", () => {
      expect(source).toContain('from "Common/Types/Billing/PayAsYouGoPricing"');

      /*
       * A hardcoded price in the copy is a price that drifts away from what is
       * actually billed. There is one source for these numbers.
       */
      expect(source).not.toMatch(/\$0\.10/);
      expect(source).not.toMatch(/\$1 per/);
    });

    test("does not add an acknowledgement requirement to telemetry key creation", () => {
      expect(source).not.toContain("telemetryPayAsYouGoAcknowledged");
      expect(source).not.toContain("validateTelemetryConsent");
      expect(source).not.toContain("telemetry-pay-as-you-go-consent");
    });

    test("use the shared billing predicate for which monitors cost money", () => {
      expect(source).toContain("isBilledAsActiveMonitor");
    });
  });
});
