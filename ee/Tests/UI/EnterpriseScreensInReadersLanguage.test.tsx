import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * The SCIM, retention override and Enterprise license screens, in the
 * reader's language (#8296, #8461).
 * ---------------------------------------------------------------------------
 *
 * The SCIM pages' OAuth 2.0 client credentials, the retention override form
 * and its summary, and the notice an Enterprise setting's screen shows when
 * the license lapses drew their words as written English, or glued a
 * sentence together around a number or a resource's kind. Each is looked up
 * now, a date or a count a value of its sentence, and drawn here in English,
 * German, Arabic and Persian from the Dashboard's own locale files.
 */

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (): Promise<unknown> => {
        return new Promise(() => {});
      },
      getFriendlyMessage: (): string => {
        return "";
      },
    },
  };
});

import ScimOAuthClientCredentials from "../../Dashboard/Identity/Components/ScimOAuthClientCredentials";
import {
  MIN_SCIM_BEARER_TOKEN_LENGTH,
  SCIM_BEARER_TOKEN_TOO_SHORT_MESSAGE,
  SCIM_BEARER_TOKEN_UNAVAILABLE_MESSAGE,
} from "../../Dashboard/Identity/TightenOnly/TightenOnlyUpdates";
import RolesPageLink, {
  ROLES_PAGE_LINK_TEST_ID,
} from "../../Dashboard/CustomRoles/RolesPageLink";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { MemoryRouter } from "react-router-dom";
import TelemetryRetentionConfigForm from "../../Dashboard/TelemetryRetention/TelemetryRetentionConfigForm";
import TelemetryRetentionConfigSummary from "../../Dashboard/TelemetryRetention/TelemetryRetentionConfigSummary";
import TelemetryRetentionLicenseNotice, {
  getTelemetryRetentionGraceDescription,
  TELEMETRY_RETENTION_GRACE_DESCRIPTION,
} from "../../Dashboard/TelemetryRetention/TelemetryRetentionLicenseNotice";
import EnterpriseSettingLicenseNotice, {
  EnterpriseSettingFeature,
  getEnterpriseSettingNoticeCopy,
} from "../../Dashboard/EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../../Dashboard/Identity/License/EnterpriseLicenseMode";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { Translator } from "Common/Types/Translator";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const TRANSLATED: ReadonlyArray<string> = ["de", "ar", "fa"];

const CONNECTION_ID: string = "62000000-0000-4000-8000-000000000001";

const FEATURES: ReadonlyArray<EnterpriseSettingFeature> = [
  LicensedFeature.CustomRoles,
  LicensedFeature.IpAllowlists,
  LicensedFeature.StatusPageBranding,
  LicensedFeature.StatusPageAccessControls,
  LicensedFeature.CustomNotificationChannels,
  LicensedFeature.SessionLength,
];

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

const drawIn: (language: string, element: ReactElement) => HTMLElement = (
  language: string,
  element: ReactElement,
): HTMLElement => {
  return render(
    <I18nextProvider i18n={instanceFor(language)}>{element}</I18nextProvider>,
  ).container;
};

const wordIn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  return readDashboardLocale(language)[english] || english;
};

afterEach(() => {
  cleanup();
});

describe("the SCIM OAuth 2.0 client credentials", () => {
  test.each(LANGUAGES)(
    "%s: its labels and what the secret is",
    (language: string) => {
      const container: HTMLElement = drawIn(
        language,
        <ScimOAuthClientCredentials
          connectionType="project"
          connectionId={CONNECTION_ID}
          canChange={true}
        />,
      );

      for (const text of [
        "OAuth 2.0 Client Credentials:",
        "Token Endpoint:",
        "Client ID:",
        "Client Secret:",
        "None yet.",
        "For identity providers that ask for a token endpoint, client ID and client secret instead of a bearer token.",
      ]) {
        expect(screen.getByText(wordIn(language, text))).toBeInTheDocument();
      }

      if (TRANSLATED.includes(language)) {
        expect(container.textContent || "").not.toMatch(
          /identity providers|None yet/,
        );
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: a set secret's date is a value of its sentence",
    (language: string) => {
      const expiresAt: Date = new Date("2027-03-01T10:00:00.000Z");

      drawIn(
        language,
        <ScimOAuthClientCredentials
          connectionType="project"
          connectionId={CONNECTION_ID}
          clientSecretExpiresAt={expiresAt}
          canChange={true}
        />,
      );

      const line: HTMLElement = screen.getByText((text: string): boolean => {
        return text.includes("2027");
      });

      if (language === "en") {
        expect(line.textContent || "").toMatch(
          /^Set\. It works until .+2027.*, and is never shown again\.$/,
        );
      } else {
        expect(line.textContent || "").not.toMatch(/works until|shown again/);
      }
    },
  );
});

describe("the retention override form and its summary", () => {
  test.each(LANGUAGES)(
    "%s: the form's headings, lines and labels",
    (language: string) => {
      const container: HTMLElement = drawIn(
        language,
        <TelemetryRetentionConfigForm value={undefined} onChange={() => {}} />,
      );

      for (const text of [
        "Per-severity overrides",
        "Per-status overrides",
        "Retention in days for metric data points.",
        "Retention in days for profile samples.",
      ]) {
        expect(screen.getByText(wordIn(language, text))).toBeInTheDocument();
      }

      if (TRANSLATED.includes(language)) {
        expect(container.textContent || "").not.toMatch(
          /Retention in days|overrides|default \(days\)/,
        );
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the summary, with nothing set and with a count of days",
    (language: string) => {
      const empty: HTMLElement = drawIn(
        language,
        <TelemetryRetentionConfigSummary config={null} />,
      );

      expect(
        screen.getByText(wordIn(language, "No overrides set.")),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(wordIn(language, "Uses default retention")).length,
      ).toBe(4);

      if (TRANSLATED.includes(language)) {
        expect(empty.textContent || "").not.toMatch(
          /Uses default|No overrides|Log records/,
        );
      }

      cleanup();

      drawIn(
        language,
        <TelemetryRetentionConfigSummary
          config={{
            logs: { default: 30, bySeverity: { [LogSeverity.Error]: 90 } },
          }}
        />,
      );

      const translator: Translator = dashboardTranslator(language);

      // An override chip's days, in the form the count takes.
      expect(
        screen.getByText(
          translator.translatePlural(
            { one: "{{count}} day", other: "{{count}} days" },
            90,
          ),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(wordIn(language, "Specific overrides")),
      ).toBeInTheDocument();
    },
  );

  test("German: thirty days reads as German says it", () => {
    drawIn(
      "de",
      <TelemetryRetentionConfigSummary config={{ logs: { default: 30 } }} />,
    );

    expect(screen.getByText("Tage")).toBeInTheDocument();
  });
});

describe("the retention override license notice", () => {
  test("the grace period's sentence keeps its days as values, in English word for word", () => {
    expect(TELEMETRY_RETENTION_GRACE_DESCRIPTION).toBe(
      `Retention overrides apply as configured during the ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial of an installation with no license, or the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period after a license expires. When it ends, new telemetry is kept for the project's default retention until an Enterprise license is activated in the Admin Dashboard.`,
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words the grace period's sentence, with its days",
    (language: string) => {
      const sentence: string = getTelemetryRetentionGraceDescription(
        dashboardTranslator(language),
      );

      expect(sentence).not.toBe(TELEMETRY_RETENTION_GRACE_DESCRIPTION);
      expect(sentence).not.toContain("{{");
    },
  );

  test.each(LANGUAGES)(
    "%s: every mode's notice reads in the reader's words",
    (language: string) => {
      for (const mode of [
        EnterpriseLicenseMode.ReadOnly,
        EnterpriseLicenseMode.NotIncluded,
        EnterpriseLicenseMode.Grace,
      ]) {
        const container: HTMLElement = drawIn(
          language,
          <TelemetryRetentionLicenseNotice mode={mode} />,
        );

        if (TRANSLATED.includes(language)) {
          expect({ mode, text: container.textContent || "" }).not.toEqual(
            expect.objectContaining({
              text: expect.stringMatching(/retention|license|telemetry/),
            }),
          );
        } else {
          expect(container.textContent || "").toMatch(/retention/);
        }

        cleanup();
      }
    },
  );
});

describe("an Enterprise setting's license notice", () => {
  test("English reads word for word as before", () => {
    expect(
      getEnterpriseSettingNoticeCopy(
        EnterpriseLicenseMode.ReadOnly,
        LicensedFeature.CustomRoles,
      )?.description,
    ).toBe(
      "The custom roles you have keep giving teams their permissions, and you can still take them away from teams or delete them. Activate or renew the Enterprise license in the Admin Dashboard to change this again.",
    );
    expect(
      getEnterpriseSettingNoticeCopy(
        EnterpriseLicenseMode.Grace,
        LicensedFeature.IpAllowlists,
      )?.description,
    ).toBe(
      `Everything here can be changed during the ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial of an installation with no license, or the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period after a license expires. When it ends: An allowlist already set is still enforced, and you can still remove it.`,
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every feature's notice, in every mode",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const feature of FEATURES) {
        for (const mode of [
          EnterpriseLicenseMode.ReadOnly,
          EnterpriseLicenseMode.NotIncluded,
          EnterpriseLicenseMode.Grace,
        ]) {
          const ours: string | undefined = getEnterpriseSettingNoticeCopy(
            mode,
            feature,
            translator,
          )?.description;
          const theirs: string | undefined = getEnterpriseSettingNoticeCopy(
            mode,
            feature,
          )?.description;

          expect({ feature, mode, same: ours === theirs }).toEqual({
            feature,
            mode,
            same: false,
          });
          expect(ours).not.toContain("{{");
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the notice's title and its description are drawn in the reader's words",
    (language: string) => {
      const container: HTMLElement = drawIn(
        language,
        <EnterpriseSettingLicenseNotice
          mode={EnterpriseLicenseMode.ReadOnly}
          feature={LicensedFeature.CustomRoles}
        />,
      );

      expect(container.textContent || "").toContain(
        wordIn(
          language,
          "Enterprise license required: custom roles cannot be created or changed.",
        ),
      );
      expect(container.textContent || "").toContain(
        getEnterpriseSettingNoticeCopy(
          EnterpriseLicenseMode.ReadOnly,
          LicensedFeature.CustomRoles,
          dashboardTranslator(language),
        )?.description || "",
      );
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The rest of the Enterprise screens (#8634).
 * ---------------------------------------------------------------------------
 *
 * A SCIM connection's Reset Bearer Token dialog says why a token could not
 * be made or was refused; the error dialog looks its sentence up, and both
 * sentences are keys now - the second one was an English template filled
 * with the length, which no locale could word. The custom roles' link to
 * the Roles page drew its word with an English fallback around the lookup.
 */
describe("the SCIM token's errors, and the link to the Roles page", () => {
  test.each(LANGUAGES)(
    "%s: why a new bearer token is refused, as the reset dialog draws it",
    (language: string) => {
      for (const message of [
        SCIM_BEARER_TOKEN_TOO_SHORT_MESSAGE,
        SCIM_BEARER_TOKEN_UNAVAILABLE_MESSAGE,
      ]) {
        drawIn(
          language,
          <ConfirmModal
            title="Reset Error"
            description={message}
            onSubmit={() => {}}
          />,
        );

        expect(
          screen.getByTestId("confirm-modal-description"),
        ).toHaveTextContent(wordIn(language, message));

        if (TRANSLATED.includes(language)) {
          expect(wordIn(language, message)).not.toBe(message);
        }

        cleanup();
      }
    },
  );

  test("the too-short message states the length the server asks for, in every language", () => {
    expect(SCIM_BEARER_TOKEN_TOO_SHORT_MESSAGE).toBe(
      `A new bearer token must be at least ${MIN_SCIM_BEARER_TOKEN_LENGTH} characters long.`,
    );

    for (const language of DASHBOARD_LANGUAGES) {
      const worded: string = wordIn(
        language,
        SCIM_BEARER_TOKEN_TOO_SHORT_MESSAGE,
      );

      // In the language's own digits, as its sentences write numbers.
      const LENGTH: RegExp = /32|\u06F3\u06F2/;

      expect({ language, hasLength: LENGTH.test(worded) }).toEqual({
        language,
        hasLength: true,
      });
    }
  });

  test.each(LANGUAGES)(
    "%s: the link to the Roles page reads in the reader's word",
    (language: string) => {
      drawIn(
        language,
        <MemoryRouter>
          <RolesPageLink />
        </MemoryRouter>,
      );

      expect(screen.getByTestId(ROLES_PAGE_LINK_TEST_ID)).toHaveTextContent(
        wordIn(language, "Roles"),
      );
    },
  );
});
