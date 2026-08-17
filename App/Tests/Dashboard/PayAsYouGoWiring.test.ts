import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Telemetry ingest and every non-Manual monitor are metered, and nothing about
 * either is included in the Free plan. The dashboard now says so before the
 * charge starts, and makes the user acknowledge it.
 *
 * The behaviour itself is exercised against the real form in
 * Common/Tests/App/Dashboard/PayAsYouGoConsentGate.test.tsx. What is pinned
 * here is the wiring: both notices and both sets of form fields are one-line
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

    test("spreads the notice and consent fields into the create modal's form", () => {
      expect(source).toContain("...getTelemetryPayAsYouGoFormFields()");
    });

    test("imports both from the billing component", () => {
      expect(source).toContain('from "../../Components/Billing/PayAsYouGo"');
    });
  });

  describe("telemetry documentation component", () => {
    const source: string = read("Components", "Telemetry", "Documentation.tsx");

    test("gates its own create key modal too - it is the second door onto the same thing", () => {
      /*
       * This component has a ModelFormModal of its own. A consent gate that
       * only covers the settings page is a gate with a way around it.
       */
      expect(source).toContain("...getTelemetryPayAsYouGoFormFields()");
      expect(source).toContain('from "../Billing/PayAsYouGo"');
    });

    test("has exactly one create key modal, so one gate is enough", () => {
      expect(
        (source.match(/<ModelFormModal<TelemetryIngestionKey>/g) || []).length,
      ).toBe(1);
    });
  });

  describe("every surface that creates an ingestion key is gated", () => {
    test("no create form for TelemetryIngestionKey exists without the notice fields", () => {
      /*
       * Guards against a third door being added later. Any file that builds a
       * create form over TelemetryIngestionKey has to spread the notice and
       * consent fields into it.
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
          gated: fs
            .readFileSync(file, "utf8")
            .includes("getTelemetryPayAsYouGoFormFields()"),
        }).toEqual({ file: path.relative(DASHBOARD_SRC, file), gated: true });
      }
    });
  });

  describe("create monitor page", () => {
    const source: string = read("Pages", "Monitor", "Create.tsx");

    test("renders the pay as you go card above the create form", () => {
      expect(source).toContain("<MonitorPayAsYouGoCard />");
    });

    test("puts the consent field on the step that holds the monitor type picker", () => {
      /*
       * The step id matters: the form only validates fields belonging to the
       * step being submitted, so a consent box parked on a step the user never
       * submits would never block anything.
       */
      expect(source).toContain(
        'getMonitorPayAsYouGoFormFields({ stepId: "monitor-info" })',
      );

      // The call site, not the import at the top of the file.
      const consentIndex: number = source.indexOf(
        'getMonitorPayAsYouGoFormFields({ stepId: "monitor-info" })',
      );
      const monitorTypeIndex: number = source.indexOf(
        "monitorTypesAsCategorizedCardSelectOptions",
      );

      expect(monitorTypeIndex).toBeGreaterThan(-1);
      expect(consentIndex).toBeGreaterThan(monitorTypeIndex);
    });

    test("declares a monitor-info step for that field to be validated on", () => {
      expect(source).toContain('id: "monitor-info"');
    });

    test("imports both from the billing component", () => {
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

  describe("every surface that creates a monitor is gated", () => {
    test("no create path for Monitor exists without a PayAsYouGo reference", () => {
      /*
       * The telemetry half of this change had an invariant like this from the
       * start; the monitor half did not, which is how the recommendations
       * bulk-create path was missed. Any file that creates a Monitor has to
       * reference the pay-as-you-go gate.
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
          gated: fs.readFileSync(file, "utf8").includes("PayAsYouGo"),
        }).toEqual({ file: relative, gated: true });
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
      "getMonitorPayAsYouGoFormFields",
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

    test("gate the submit with customValidation rather than required", () => {
      /*
       * The form's `required` check stringifies the value, so an unticked box
       * reads as the non-empty string "false" and passes it. customValidation
       * is the only thing that actually blocks - and it only runs when the key
       * is present, which is what getDefaultValue is for.
       */
      expect(source).toContain("customValidation");
      expect(source).toContain("getDefaultValue");
    });

    test("use the shared billing predicate for which monitors cost money", () => {
      expect(source).toContain("isBilledAsActiveMonitor");
    });
  });
});
