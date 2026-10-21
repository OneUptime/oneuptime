import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * The retention-override area of the Enterprise Dashboard plugin:
 *
 *   - both keys are on the assembled plugin (ee/Dashboard/Index.tsx), lazy,
 *     and resolve to the ee cards;
 *   - the cards import core only through "@oneuptime/dashboard/..." and
 *     "Common/...", and never import back the core shells that read the
 *     plugins (that import cycle crashes the Enterprise bundle);
 *   - the retention form and summary live here now, not in Common (so the
 *     Community image does not ship them);
 *   - the license notice says the right thing for each license mode.
 */

import TelemetryRetentionPlugins from "../../../Dashboard/TelemetryRetention/Plugins";
import EnterpriseDashboardPlugins from "../../../Dashboard/Index";
import TelemetryRetentionLicenseNotice, {
  getTelemetryRetentionNoticeCopy,
  TELEMETRY_RETENTION_GRACE_DESCRIPTION,
  TELEMETRY_RETENTION_GRACE_TITLE,
  TELEMETRY_RETENTION_LAPSED_DESCRIPTION,
  TELEMETRY_RETENTION_LAPSED_TITLE,
  TELEMETRY_RETENTION_NOT_INCLUDED_DESCRIPTION,
  TELEMETRY_RETENTION_NOT_INCLUDED_TITLE,
  TelemetryRetentionNoticeCopy,
} from "../../../Dashboard/TelemetryRetention/TelemetryRetentionLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
  getEnterpriseLicenseMode,
} from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { JSONObject } from "Common/Types/JSON";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import { AlertType } from "Common/UI/Components/Alerts/Alert";

const EE_DIR: string = path.resolve(__dirname, "..", "..", "..");
const AREA_DIR: string = path.join(EE_DIR, "Dashboard", "TelemetryRetention");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const IMPORT_SPECIFIER: RegExp =
  /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;

const importsOf: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const source: string = fs
    .readFileSync(path.join(AREA_DIR, file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1");
  const specifiers: Array<string> = [];
  const pattern: RegExp = new RegExp(IMPORT_SPECIFIER.source, "g");
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    specifiers.push(match[1] as string);
    match = pattern.exec(source);
  }

  return specifiers;
};

const TYPESCRIPT_SOURCE: RegExp = new RegExp("\\.tsx?$");
// A relative path into packages/: ee must use the mapped specifiers instead.
const INTO_PACKAGES: RegExp = new RegExp("(^|/)packages/");

const AREA_FILES: Array<string> = fs
  .readdirSync(AREA_DIR)
  .filter((file: string): boolean => {
    return TYPESCRIPT_SOURCE.test(file);
  });

afterEach(() => {
  cleanup();
});

describe("the retention-override plugin keys", () => {
  test("the assembled Enterprise plugin carries both screens", () => {
    const plugins: DashboardEnterprisePlugins = EnterpriseDashboardPlugins;

    expect(plugins.TelemetryResourceRetentionSettings).toBe(
      TelemetryRetentionPlugins.TelemetryResourceRetentionSettings,
    );
    expect(plugins.SettingsTelemetryRetentionByType).toBe(
      TelemetryRetentionPlugins.SettingsTelemetryRetentionByType,
    );
  });

  test("both are lazy, so the retention code downloads only where it is shown", () => {
    const lazyType: symbol = Symbol.for("react.lazy");

    for (const plugin of [
      TelemetryRetentionPlugins.TelemetryResourceRetentionSettings,
      TelemetryRetentionPlugins.SettingsTelemetryRetentionByType,
    ]) {
      expect(plugin).toBeDefined();
      expect((plugin as unknown as { $$typeof: symbol }).$$typeof).toBe(
        lazyType,
      );
    }
  });

  test("the lazy plugins resolve to the ee cards", async () => {
    const load: (plugin: unknown) => Promise<unknown> = async (
      plugin: unknown,
    ): Promise<unknown> => {
      const payload: { _result: () => Promise<{ default: unknown }> } = (
        plugin as { _payload: { _result: () => Promise<{ default: unknown }> } }
      )._payload;

      return (await payload._result()).default;
    };

    expect(
      await load(TelemetryRetentionPlugins.TelemetryResourceRetentionSettings),
    ).toBe(
      (
        await import(
          "../../../Dashboard/TelemetryRetention/TelemetryResourceRetentionSettings"
        )
      ).default,
    );
    expect(
      await load(TelemetryRetentionPlugins.SettingsTelemetryRetentionByType),
    ).toBe(
      (
        await import(
          "../../../Dashboard/TelemetryRetention/ProjectTelemetryRetentionByType"
        )
      ).default,
    );
  });
});

describe("the retention-override sources", () => {
  test.each(AREA_FILES)(
    "%s reaches core only through the mapped specifiers, never a core shell",
    (file: string) => {
      for (const specifier of importsOf(file)) {
        expect({
          file,
          specifier,
          intoPackages: INTO_PACKAGES.test(specifier),
        }).toEqual({
          file,
          specifier,
          intoPackages: false,
        });
        // The core shells read the plugins: importing one back is a cycle.
        expect(specifier).not.toBe(
          "@oneuptime/dashboard/Components/TelemetryResource/TelemetryResourceRetentionSettings",
        );
        expect(specifier).not.toBe("@oneuptime/dashboard/Enterprise/Plugins");
        expect(specifier).not.toBe(
          "@oneuptime/dashboard/Pages/Settings/TelemetrySettings",
        );
      }
    },
  );

  test("the retention form and summary moved out of Common", () => {
    for (const file of [
      "TelemetryRetentionConfigForm.tsx",
      "TelemetryRetentionConfigSummary.tsx",
    ]) {
      expect(fs.existsSync(path.join(AREA_DIR, file))).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            REPOSITORY_ROOT,
            "packages",
            "Common",
            "UI",
            "Components",
            "Telemetry",
            file,
          ),
        ),
      ).toBe(false);
    }
  });
});

describe("the license feature a retention screen names", () => {
  test("is the server's TelemetryRetention value (the license format)", () => {
    expect(LicensedFeature.TelemetryRetention).toBe(
      EnterpriseFeature.TelemetryRetention,
    );
    expect(LicensedFeature.TelemetryRetention).toBe("telemetry-retention");
  });

  test("a license listing other features only reads as NotIncluded for retention", () => {
    const payload: JSONObject = {
      status: "valid",
      licenseValid: true,
      features: ["scim", "audit-logs"],
    };

    expect(
      getEnterpriseLicenseMode(payload, LicensedFeature.TelemetryRetention),
    ).toBe(EnterpriseLicenseMode.NotIncluded);
    expect(getEnterpriseLicenseMode(payload, LicensedFeature.SCIM)).toBe(
      EnterpriseLicenseMode.Editable,
    );
    expect(
      getEnterpriseLicenseMode(
        { ...payload, features: ["*"] },
        LicensedFeature.TelemetryRetention,
      ),
    ).toBe(EnterpriseLicenseMode.Editable);
  });
});

describe("the retention license notice", () => {
  test.each([
    [
      EnterpriseLicenseMode.ReadOnly,
      AlertType.DANGER,
      TELEMETRY_RETENTION_LAPSED_TITLE,
      TELEMETRY_RETENTION_LAPSED_DESCRIPTION,
      "telemetry-retention-license-lapsed-notice",
    ],
    [
      EnterpriseLicenseMode.NotIncluded,
      AlertType.DANGER,
      TELEMETRY_RETENTION_NOT_INCLUDED_TITLE,
      TELEMETRY_RETENTION_NOT_INCLUDED_DESCRIPTION,
      "telemetry-retention-license-not-included-notice",
    ],
    [
      EnterpriseLicenseMode.Grace,
      AlertType.WARNING,
      TELEMETRY_RETENTION_GRACE_TITLE,
      TELEMETRY_RETENTION_GRACE_DESCRIPTION,
      "telemetry-retention-license-grace-notice",
    ],
  ])(
    "%s: says so, with its own copy",
    (
      mode: EnterpriseLicenseMode,
      type: AlertType,
      title: string,
      description: string,
      testId: string,
    ) => {
      const copy: TelemetryRetentionNoticeCopy | null =
        getTelemetryRetentionNoticeCopy(mode);

      expect(copy).toEqual({
        type,
        title,
        description,
        dataTestId: testId,
      });

      render(<TelemetryRetentionLicenseNotice mode={mode} />);

      const notice: HTMLElement = screen.getByTestId(testId);

      expect(notice).toHaveTextContent(title);
      expect(notice).toHaveTextContent(description);
    },
  );

  test.each([EnterpriseLicenseMode.Editable, EnterpriseLicenseMode.Unknown])(
    "%s: nothing (a valid license, the Cloud, or a state the server keeps applying overrides in)",
    (mode: EnterpriseLicenseMode) => {
      expect(getTelemetryRetentionNoticeCopy(mode)).toBeNull();

      const { container } = render(
        <TelemetryRetentionLicenseNotice mode={mode} />,
      );

      expect(container).toBeEmptyDOMElement();
    },
  );

  test("the stopped copy says what happens to new and stored telemetry, and that nothing is deleted", () => {
    for (const description of [
      TELEMETRY_RETENTION_LAPSED_DESCRIPTION,
      TELEMETRY_RETENTION_NOT_INCLUDED_DESCRIPTION,
    ]) {
      expect(description).toContain(
        "new telemetry is kept for the project's default retention",
      );
      expect(description).toContain("Nothing configured here is deleted");
    }

    expect(TELEMETRY_RETENTION_LAPSED_DESCRIPTION).toContain(
      "Telemetry already stored keeps the retention it was written with.",
    );
  });

  test("the grace copy states the trial and grace period with the license classifier's lengths", () => {
    expect(TELEMETRY_RETENTION_GRACE_DESCRIPTION).toContain(
      `${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial`,
    );
    expect(TELEMETRY_RETENTION_GRACE_DESCRIPTION).toContain(
      `${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period`,
    );
  });
});
