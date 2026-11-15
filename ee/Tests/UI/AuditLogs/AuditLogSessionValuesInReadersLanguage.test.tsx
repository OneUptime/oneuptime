import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import AuditLogChangesModal from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import {
  AUDIT_LOG_SESSION_NOT_USED_FOR,
  AUDIT_LOG_SESSION_SIGN_IN_WORDS,
  AUDIT_LOG_SESSION_SIGNED_IN,
  AuditLogSessionField,
  getSessionEntrySummary,
  getSessionEntryValueInLanguage,
  SESSION_END_CAUSE_DESCRIPTIONS,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import { JSONArray } from "Common/Types/JSON";
import { Translator } from "Common/Types/Translator";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import { DEFAULT_SESSION_IDLE_DAYS } from "Common/Types/UserSession/SessionLength";
import {
  SecondFactor,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * A session entry's values in the reader's language (issue #8459).
 * ---------------------------------------------------------------------------
 *
 * #8291 put a session entry's field labels in the reader's language; its
 * values stayed English, because the recorder stores English words in the
 * entry and the screens drew them as stored: "Grund: Idle timeout reached"
 * in the dialog, "Password + Security key" in the table's Changes column.
 * Those words are a closed set of OneUptime's own - why a session ended,
 * how its person signed in, the second factor - so each is a key of the
 * Dashboard's locales now and is drawn in the reader's words. Thirty days
 * without use, stored with its number, reads in the reader's plural forms
 * and digits. Anything else - a device, an address, a place, an SSO
 * provider's or a brand's name - is drawn as recorded, and the server keeps
 * storing English.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

// The names a sign-in method can be, drawn as written in every language.
const BRANDS: ReadonlyArray<string> = [
  SignInMethod.Google,
  SignInMethod.Microsoft,
  SignInMethod.Vercel,
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

const wordIn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  return readDashboardLocale(language)[english] || english;
};

// Every reason a session's end is stored with, but thirty days without use.
const WORDED_REASONS: Array<string> = Object.values(SessionEndCause)
  .filter((cause: SessionEndCause): boolean => {
    return cause !== SessionEndCause.Expired;
  })
  .map((cause: SessionEndCause): string => {
    return SESSION_END_CAUSE_DESCRIPTIONS[cause];
  });

afterEach(() => {
  cleanup();
});

describe("OneUptime's own words a session entry stores", () => {
  test("are every way of signing in and every second factor, but the names", () => {
    expect([...AUDIT_LOG_SESSION_SIGN_IN_WORDS].sort()).toEqual(
      [
        ...Object.values(SignInMethod).filter((method: string): boolean => {
          return !BRANDS.includes(method);
        }),
        ...Object.values(SecondFactor),
      ].sort(),
    );
  });

  test("the server still stores them in English, thirty days with its number", () => {
    expect(SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.IdleTimeout]).toBe(
      "Idle timeout reached",
    );
    expect(SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Expired]).toBe(
      `Not used for ${DEFAULT_SESSION_IDLE_DAYS} days`,
    );
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each of them, or keeps the English on purpose",
    (language: string) => {
      for (const word of [
        ...WORDED_REASONS,
        ...AUDIT_LOG_SESSION_SIGN_IN_WORDS,
        AUDIT_LOG_SESSION_SIGNED_IN,
        AUDIT_LOG_SESSION_NOT_USED_FOR.other,
        `${AUDIT_LOG_SESSION_NOT_USED_FOR.other}_one`,
      ]) {
        expect({
          word,
          isWorded: isWordedInDashboardLocale(word, language),
        }).toEqual({ word, isWorded: true });
      }
    },
  );
});

describe("a stored value, as the reader reads it", () => {
  test.each(LANGUAGES)(
    "%s: why a session ended, in its words",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const reason of WORDED_REASONS) {
        expect(
          getSessionEntryValueInLanguage({
            field: AuditLogSessionField.Reason,
            value: reason,
            translator,
          }),
        ).toBe(wordIn(language, reason));
      }
    },
  );

  test("thirty days without use, in each language's plural forms and digits", () => {
    const stored: string =
      SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Expired];

    const expected: Record<string, string> = {
      en: "Not used for 30 days",
      de: "30 Tage nicht genutzt",
      ar: "أيام عدم الاستخدام: 30",
      fa: "۳۰ روز بدون استفاده",
    };

    for (const language of LANGUAGES) {
      expect({
        language,
        reads: getSessionEntryValueInLanguage({
          field: AuditLogSessionField.Reason,
          value: stored,
          translator: dashboardTranslator(language),
        }),
      }).toEqual({ language, reads: expected[language] });
    }
  });

  test.each(LANGUAGES)(
    "%s: how they signed in and with which second factor, in its words; a brand as written",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const method of Object.values(SignInMethod)) {
        expect(
          getSessionEntryValueInLanguage({
            field: AuditLogSessionField.SignInMethod,
            value: method,
            translator,
          }),
        ).toBe(BRANDS.includes(method) ? method : wordIn(language, method));
      }

      for (const factor of Object.values(SecondFactor)) {
        expect(
          getSessionEntryValueInLanguage({
            field: AuditLogSessionField.SecondFactor,
            value: factor,
            translator,
          }),
        ).toBe(wordIn(language, factor));
      }
    },
  );

  test("anything else is drawn as recorded: a device, an address, a place, a provider's name, words of another field", () => {
    const german: Translator = dashboardTranslator("de");

    for (const [field, value] of [
      [AuditLogSessionField.Device, "Chrome 130 on macOS"],
      [AuditLogSessionField.IpAddress, "203.0.113.7"],
      [AuditLogSessionField.Location, "Berlin, Germany"],
      [AuditLogSessionField.SsoProvider, "Okta"],
      // A provider named like one of OneUptime's words keeps its name.
      [AuditLogSessionField.SsoProvider, "Password"],
      [AuditLogSessionField.Device, "Idle timeout reached"],
      // A reason OneUptime does not know (an older release's) as stored.
      [AuditLogSessionField.Reason, "Ended by an older release"],
    ] as Array<[AuditLogSessionField, string]>) {
      expect(
        getSessionEntryValueInLanguage({ field, value, translator: german }),
      ).toBe(value);
    }
  });

  test("without a translator, as stored: English, as the server and the export read it", () => {
    expect(
      getSessionEntryValueInLanguage({
        field: AuditLogSessionField.SecondFactor,
        value: SecondFactor.SecurityKey,
      }),
    ).toBe("Security key");
  });
});

describe("the Changes column's summary", () => {
  const SIGN_IN: JSONArray = [
    { field: AuditLogSessionField.SignInMethod, newValue: SignInMethod.Saml },
    {
      field: AuditLogSessionField.SecondFactor,
      newValue: SecondFactor.SecurityKey,
    },
    { field: AuditLogSessionField.SsoProvider, newValue: "Okta" },
  ];

  test("English reads as it always did", () => {
    expect(getSessionEntrySummary({ action: "SignIn", changes: SIGN_IN })).toBe(
      "SAML single sign-on + Security key · Okta",
    );
    expect(
      getSessionEntrySummary({
        action: "SignIn",
        changes: SIGN_IN,
        translator: dashboardTranslator("en"),
      }),
    ).toBe("SAML single sign-on + Security key · Okta");
    expect(getSessionEntrySummary({ action: "SignIn", changes: [] })).toBe(
      "Signed in",
    );
    expect(getSessionEntrySummary({ action: "SignOut", changes: [] })).toBe(
      "Session ended",
    );
  });

  test("German: each fact in German, the provider as named", () => {
    expect(
      getSessionEntrySummary({
        action: "SignIn",
        changes: SIGN_IN,
        translator: dashboardTranslator("de"),
      }),
    ).toBe("SAML-Single-Sign-on + Sicherheitsschlüssel · Okta");
    expect(
      getSessionEntrySummary({
        action: "SessionTimeout",
        changes: [
          {
            field: AuditLogSessionField.Reason,
            newValue: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Expired],
          },
        ],
        translator: dashboardTranslator("de"),
      }),
    ).toBe("30 Tage nicht genutzt");
  });

  test("Persian sets the provider apart with its own bullet", () => {
    const words: Record<string, string> = readDashboardLocale("fa");

    expect(
      getSessionEntrySummary({
        action: "SignIn",
        changes: SIGN_IN,
        translator: dashboardTranslator("fa"),
      }),
    ).toBe(
      `${words[SignInMethod.Saml]} + ${words[SecondFactor.SecurityKey]} • Okta`,
    );
  });

  test.each(LANGUAGES)(
    "%s: a sign-in that stored no way of signing in, and an end with no reason",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      expect(
        getSessionEntrySummary({ action: "SignIn", changes: [], translator }),
      ).toBe(wordIn(language, AUDIT_LOG_SESSION_SIGNED_IN));
      expect(
        getSessionEntrySummary({ action: "SignOut", changes: [], translator }),
      ).toBe(
        wordIn(language, SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Other]),
      );
    },
  );
});

describe("the changes dialog of a session", () => {
  test.each(LANGUAGES)(
    "%s: the reason, how they signed in and the second factor read in its words; the device as recorded",
    (language: string) => {
      render(
        <I18nextProvider i18n={instanceFor(language)}>
          <AuditLogChangesModal
            isOpen={true}
            onClose={jest.fn()}
            action="SessionRevoked"
            resourceType="User Session"
            resourceName="Chrome 130 on macOS"
            changes={[
              {
                field: AuditLogSessionField.Reason,
                newValue:
                  SESSION_END_CAUSE_DESCRIPTIONS[
                    SessionEndCause.PasswordChanged
                  ],
              },
              {
                field: AuditLogSessionField.SignInMethod,
                newValue: SignInMethod.Password,
              },
              {
                field: AuditLogSessionField.SecondFactor,
                newValue: SecondFactor.AuthenticatorApp,
              },
              {
                field: AuditLogSessionField.Device,
                newValue: "Chrome 130 on macOS",
              },
            ]}
          />
        </I18nextProvider>,
      );

      const details: HTMLElement = screen.getByTestId(
        "audit-log-session-details",
      );

      for (const english of [
        "Password changed",
        SignInMethod.Password,
        SecondFactor.AuthenticatorApp,
      ]) {
        expect(
          within(details).getByText(wordIn(language, english)),
        ).toBeInTheDocument();
      }

      expect(
        within(details).getByText("Chrome 130 on macOS"),
      ).toBeInTheDocument();

      if (language !== "en") {
        expect(within(details).queryByText("Password changed")).toBeNull();
        expect(within(details).queryByText("Authenticator app")).toBeNull();
      }
    },
  );
});
