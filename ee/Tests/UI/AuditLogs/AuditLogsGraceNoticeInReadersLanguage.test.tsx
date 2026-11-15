import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import AuditLogsLicenseNotice, {
  AUDIT_LOGS_GRACE_DESCRIPTION,
  AUDIT_LOGS_GRACE_DESCRIPTION_TEMPLATE,
  AUDIT_LOGS_GRACE_TITLE,
  getAuditLogsGraceDescription,
} from "../../../Dashboard/AuditLogs/AuditLogsLicenseNotice";
import { EnterpriseLicenseMode } from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import { Translator } from "Common/Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * Settings > Audit Logs' trial and grace period notice, in the reader's
 * language (issue #8460).
 * ---------------------------------------------------------------------------
 *
 * #8319 put the notices of a lapsed license, or one that leaves audit logs
 * out, in the reader's language. The notice shown during the trial or the
 * grace period stayed English: its title was no key, and its description
 * was a template literal with the trial's and the grace period's lengths
 * in it, which no locale could hold. The title is a key now, and the
 * description a template with {{trialDays}} and {{graceDays}}, filled in
 * the reader's language and digits and handed to Alert as worded.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const instanceFor: (language: string) => i18n = (language: string): i18n => {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: readDashboardLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
};

afterEach(() => {
  cleanup();
});

describe("the notice's words", () => {
  test("English reads as it always did, each length from its constant", () => {
    expect(AUDIT_LOGS_GRACE_DESCRIPTION).toBe(
      `Audit logging records as configured during the ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial of an installation with no license, or the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period after a license expires. When it ends, nothing more is recorded until an Enterprise license is activated in the Admin Dashboard. Entries recorded so far are kept.`,
    );
    expect(getAuditLogsGraceDescription(dashboardTranslator("en"))).toBe(
      AUDIT_LOGS_GRACE_DESCRIPTION,
    );
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words the title and the description, keeping both lengths",
    (language: string) => {
      for (const word of [
        AUDIT_LOGS_GRACE_TITLE,
        AUDIT_LOGS_GRACE_DESCRIPTION_TEMPLATE,
      ]) {
        expect({
          word,
          isWorded: isWordedInDashboardLocale(word, language),
        }).toEqual({ word, isWorded: true });
      }

      const template: string =
        readDashboardLocale(language)[AUDIT_LOGS_GRACE_DESCRIPTION_TEMPLATE]!;

      expect(template).toContain("{{trialDays}}");
      expect(template).toContain("{{graceDays}}");
    },
  );

  test("each length in the reader's digits", () => {
    const persian: Translator = dashboardTranslator("fa");
    const description: string = getAuditLogsGraceDescription(persian);

    expect(description).toContain(
      persian.formatNumber(ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS),
    );
    expect(description).toContain(
      persian.formatNumber(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS),
    );
    expect(description).not.toMatch(/[0-9]/);

    // Arabic in OneUptime writes Latin digits.
    expect(getAuditLogsGraceDescription(dashboardTranslator("ar"))).toContain(
      String(ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS),
    );
  });
});

describe("Settings > Audit Logs during the trial or the grace period", () => {
  test.each(LANGUAGES)(
    "%s: the notice reads in its words",
    (language: string) => {
      render(
        <I18nextProvider i18n={instanceFor(language)}>
          <AuditLogsLicenseNotice mode={EnterpriseLicenseMode.Grace} />
        </I18nextProvider>,
      );

      const notice: HTMLElement = screen.getByTestId(
        "audit-logs-license-grace-notice",
      );
      const words: Record<string, string> = readDashboardLocale(language);

      expect(notice).toHaveTextContent(
        words[AUDIT_LOGS_GRACE_TITLE] || AUDIT_LOGS_GRACE_TITLE,
      );
      expect(notice).toHaveTextContent(
        getAuditLogsGraceDescription(dashboardTranslator(language)),
      );

      if (language !== "en") {
        expect(notice).not.toHaveTextContent("grace period");
        expect(notice).not.toHaveTextContent("trial");
      }
    },
  );
});
