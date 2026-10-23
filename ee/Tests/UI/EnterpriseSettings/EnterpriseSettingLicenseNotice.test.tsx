import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * What the custom role, IP allowlist and status page cards show above
 * themselves when the Enterprise license has lapsed, leaves their feature
 * out, or is about to lapse (EnterpriseSettingLicenseNotice).
 *
 * The rules: nothing with a valid license, on the Cloud or while the state is
 * unknown; a danger notice once the configuration is read-only, a warning
 * before; and each one says what keeps applying - custom roles, allowlists
 * and access controls keep applying and can be removed, while Powered by
 * OneUptime is shown again on every status page.
 */

import EnterpriseSettingLicenseNotice, {
  EnterpriseSettingFeature,
  EnterpriseSettingNoticeCopy,
  getEnterpriseSettingNoticeCopy,
} from "../../../Dashboard/EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import { AlertType } from "Common/UI/Components/Alerts/Alert";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";

const FEATURES: Array<EnterpriseSettingFeature> = [
  LicensedFeature.CustomRoles,
  LicensedFeature.IpAllowlists,
  LicensedFeature.StatusPageAccessControls,
  LicensedFeature.StatusPageBranding,
];

afterEach(() => {
  cleanup();
});

describe("getEnterpriseSettingNoticeCopy", () => {
  test.each(FEATURES)(
    "%s: nothing with a valid license, or while the license state is unknown",
    (feature: EnterpriseSettingFeature) => {
      expect(
        getEnterpriseSettingNoticeCopy(EnterpriseLicenseMode.Editable, feature),
      ).toBeNull();
      expect(
        getEnterpriseSettingNoticeCopy(EnterpriseLicenseMode.Unknown, feature),
      ).toBeNull();
    },
  );

  test.each(FEATURES)(
    "%s: a danger notice once the license has lapsed, naming the feature in its test id",
    (feature: EnterpriseSettingFeature) => {
      const copy: EnterpriseSettingNoticeCopy | null =
        getEnterpriseSettingNoticeCopy(EnterpriseLicenseMode.ReadOnly, feature);

      expect(copy?.type).toBe(AlertType.DANGER);
      expect(copy?.title).toMatch(/^Enterprise license required: /);
      expect(copy?.description).toContain(
        "Activate or renew the Enterprise license in the Admin Dashboard",
      );
      expect(copy?.dataTestId).toBe(
        `enterprise-setting-license-read-only-notice-${feature}`,
      );
    },
  );

  test.each(FEATURES)(
    "%s: a danger notice when the license leaves it out, which never blames a missing license",
    (feature: EnterpriseSettingFeature) => {
      const copy: EnterpriseSettingNoticeCopy | null =
        getEnterpriseSettingNoticeCopy(
          EnterpriseLicenseMode.NotIncluded,
          feature,
        );

      expect(copy?.type).toBe(AlertType.DANGER);
      expect(copy?.title).toMatch(/^Your Enterprise license does not include /);
      expect(copy?.description).toContain(
        "Activate a license that includes it",
      );
      expect(copy?.description).not.toContain("renew");
      expect(copy?.dataTestId).toBe(
        `enterprise-setting-license-not-included-notice-${feature}`,
      );
    },
  );

  test.each(FEATURES)(
    "%s: a warning in the trial or the grace period, naming both lengths",
    (feature: EnterpriseSettingFeature) => {
      const copy: EnterpriseSettingNoticeCopy | null =
        getEnterpriseSettingNoticeCopy(EnterpriseLicenseMode.Grace, feature);

      expect(copy?.type).toBe(AlertType.WARNING);
      expect(copy?.title).toMatch(/^No valid Enterprise license: /);
      expect(copy?.description).toContain(
        `${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial`,
      );
      expect(copy?.description).toContain(
        `${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period`,
      );
    },
  );

  test.each([
    [LicensedFeature.CustomRoles, "keep giving teams their permissions"],
    [LicensedFeature.IpAllowlists, "is still enforced"],
    [LicensedFeature.StatusPageAccessControls, "still apply"],
  ] as Array<[EnterpriseSettingFeature, string]>)(
    "%s says what is set keeps applying, and can still be removed",
    (feature: EnterpriseSettingFeature, keepsApplying: string) => {
      for (const mode of [
        EnterpriseLicenseMode.ReadOnly,
        EnterpriseLicenseMode.NotIncluded,
        EnterpriseLicenseMode.Grace,
      ]) {
        const description: string =
          getEnterpriseSettingNoticeCopy(mode, feature)?.description || "";

        expect(description).toContain(keepsApplying);
        expect(description).toMatch(/remove|delete/);
      }
    },
  );

  test("Powered by OneUptime says every status page shows it again, and that the switch is kept", () => {
    const copy: EnterpriseSettingNoticeCopy | null =
      getEnterpriseSettingNoticeCopy(
        EnterpriseLicenseMode.ReadOnly,
        LicensedFeature.StatusPageBranding,
      );

    expect(copy?.title).toBe(
      "Enterprise license required: Powered by OneUptime is shown on every status page.",
    );
    expect(copy?.description).toContain(
      "Every status page shows Powered by OneUptime, whatever this switch says.",
    );
    expect(copy?.description).toContain("The switch is kept");
  });
});

describe("EnterpriseSettingLicenseNotice", () => {
  test("draws nothing with a valid license", () => {
    const { container } = render(
      <EnterpriseSettingLicenseNotice
        mode={EnterpriseLicenseMode.Editable}
        feature={LicensedFeature.IpAllowlists}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("draws the read-only notice, with its title and description", () => {
    render(
      <EnterpriseSettingLicenseNotice
        mode={EnterpriseLicenseMode.ReadOnly}
        feature={LicensedFeature.CustomRoles}
      />,
    );

    const notice: HTMLElement = screen.getByTestId(
      "enterprise-setting-license-read-only-notice-custom-roles",
    );

    expect(notice).toHaveTextContent(
      "Enterprise license required: custom roles cannot be created or changed.",
    );
    expect(notice).toHaveTextContent(
      "The custom roles you have keep giving teams their permissions",
    );
  });

  test("draws the grace warning", () => {
    render(
      <EnterpriseSettingLicenseNotice
        mode={EnterpriseLicenseMode.Grace}
        feature={LicensedFeature.StatusPageAccessControls}
      />,
    );

    expect(
      screen.getByTestId(
        "enterprise-setting-license-grace-notice-status-page-access-controls",
      ),
    ).toBeInTheDocument();
  });
});
