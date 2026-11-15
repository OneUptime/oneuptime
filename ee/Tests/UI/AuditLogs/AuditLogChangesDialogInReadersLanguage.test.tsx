import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import AuditLogChangesModal, {
  AUDIT_LOG_CHANGES_DESCRIPTIONS,
  AUDIT_LOG_FIELDS_CHANGED,
  AUDIT_LOG_NO_FIELD_CHANGES,
  AUDIT_LOG_NO_SESSION_DETAILS,
  getAuditLogChangesDescription,
  getSessionDetailsDescription,
  readSessionDetailRows,
  SessionDetailRow,
} from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import {
  AUDIT_LOG_SESSION_FIELD_LABELS,
  AUDIT_LOG_SESSION_FIELDS,
  AuditLogSessionField,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import { JSONArray } from "Common/Types/JSON";
import { Translator } from "Common/Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * Everything under the audit log dialog's title, in the reader's language
 * (issue #8291).
 * ---------------------------------------------------------------------------
 *
 * #8076 put the dialog's title in the reader's language; everything under it
 * stayed English: the description ("3 fields changed", an English plural
 * glued in code, "Created snapshot", "How the session ended"), the value
 * labels ("Before", "After", "Value", "empty"), the empty states and a
 * session's field labels. They were English literals no locale had, and
 * ee/Dashboard was not read by the string extractor, so nothing could add
 * them. Each is a key of the Dashboard's locales now, looked up where it is
 * drawn, and the count goes through the reader's plural forms and digits.
 *
 * Drawn here in English, German, Arabic (whose general form serves 0, 2, 3
 * to 10, 11 to 99 and 100 and up) and Persian (its own digits).
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const TRANSLATED: ReadonlyArray<string> = ["de", "ar", "fa"];

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

// The dialog for an entry, drawn in `language`.
const drawDialog: (data: {
  language: string;
  action: string;
  changes: JSONArray;
}) => void = (data: {
  language: string;
  action: string;
  changes: JSONArray;
}): void => {
  render(
    <I18nextProvider i18n={instanceFor(data.language)}>
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action={data.action}
        resourceType="Monitor"
        resourceName="Checkout API"
        changes={data.changes}
      />
    </I18nextProvider>,
  );
};

// A word as `language` writes it: its locale's, or English's for English.
const wordIn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  return readDashboardLocale(language)[english] || english;
};

const THREE_CHANGES: JSONArray = [
  { field: "name", oldValue: "Checkout", newValue: "Checkout API" },
  { field: "description", oldValue: null, newValue: "Pays for orders" },
  { field: "isEnabled", oldValue: false, newValue: true },
];

const SESSION_SIGN_IN: JSONArray = [
  { field: AuditLogSessionField.SignInMethod, newValue: "Password" },
  { field: AuditLogSessionField.SecondFactor, newValue: "Security key" },
  { field: AuditLogSessionField.Device, newValue: "Chrome 130 on macOS" },
  { field: AuditLogSessionField.IpAddress, newValue: "203.0.113.7" },
];

afterEach(() => {
  cleanup();
});

describe("the dialog's words are worded in every language it is drawn in here", () => {
  const words: Array<string> = [
    ...Object.values(AUDIT_LOG_CHANGES_DESCRIPTIONS),
    AUDIT_LOG_FIELDS_CHANGED.other,
    `${AUDIT_LOG_FIELDS_CHANGED.other}_one`,
    AUDIT_LOG_NO_FIELD_CHANGES,
    AUDIT_LOG_NO_SESSION_DETAILS,
    "Before",
    "After",
    "Value",
    "empty",
    "Close",
    ...AUDIT_LOG_SESSION_FIELDS.map((field: AuditLogSessionField): string => {
      return AUDIT_LOG_SESSION_FIELD_LABELS[field];
    }),
  ];

  test("each is a key of the English locale, as itself", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const word of words) {
      expect({ word, english: english[word] }).toEqual({
        word,
        english: word.endsWith("_one") ? AUDIT_LOG_FIELDS_CHANGED.one : word,
      });
    }
  });

  // Every language the Dashboard offers, not only the four drawn below.
  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each of them, or keeps the English on purpose",
    (language: string) => {
      for (const word of words) {
        expect({
          word,
          isWorded: isWordedInDashboardLocale(word, language),
        }).toEqual({ word, isWorded: true });
      }
    },
  );

  test.each(TRANSLATED)(
    "%s, drawn below, words each of them in its own words",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);
      const english: Record<string, string> = readDashboardLocale("en");

      for (const word of words) {
        expect({ word, isOwn: locale[word] !== english[word] }).toEqual({
          word,
          isOwn: true,
        });
      }
    },
  );
});

describe("an update's dialog", () => {
  test.each(LANGUAGES)(
    "%s: how many fields changed, in its plural forms and digits, then Before and After for each",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      drawDialog({ language, action: "Update", changes: THREE_CHANGES });

      const expected: string = translator.translatePlural(
        AUDIT_LOG_FIELDS_CHANGED,
        3,
      );

      expect(screen.getByTestId("modal-description")).toHaveTextContent(
        expected,
      );
      expect(screen.getAllByText(wordIn(language, "Before"))).toHaveLength(3);
      expect(screen.getAllByText(wordIn(language, "After"))).toHaveLength(3);
      // The description that was empty before the change.
      expect(screen.getAllByText(wordIn(language, "empty"))).toHaveLength(1);
      expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
        wordIn(language, "Close"),
      );

      if (language !== "en") {
        expect(screen.queryByText("Before")).not.toBeInTheDocument();
        expect(screen.queryByText("After")).not.toBeInTheDocument();
        expect(screen.queryByText("3 fields changed")).not.toBeInTheDocument();
      }
    },
  );

  test("English reads as it always did: 3 fields changed, and 1 field changed", () => {
    const english: Translator = dashboardTranslator("en");

    for (const [count, text] of [
      [0, "0 fields changed"],
      [1, "1 field changed"],
      [3, "3 fields changed"],
      [1200, "1,200 fields changed"],
    ] as Array<[number, string]>) {
      expect(
        getAuditLogChangesDescription({
          action: "Update",
          fieldCount: count,
          translator: english,
        }),
      ).toBe(text);
    }
  });

  test("German has a one form and an other form", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      getAuditLogChangesDescription({
        action: "Update",
        fieldCount: 1,
        translator: german,
      }),
    ).toBe("1 Feld geändert");
    expect(
      getAuditLogChangesDescription({
        action: "Update",
        fieldCount: 3,
        translator: german,
      }),
    ).toBe("3 Felder geändert");
  });

  test("Arabic's general form reads right for every count it serves, and its one form for one", () => {
    const arabic: Translator = dashboardTranslator("ar");
    const locale: Record<string, string> = readDashboardLocale("ar");

    for (const count of [0, 2, 3, 10, 11, 99, 100, 101]) {
      expect(
        getAuditLogChangesDescription({
          action: "Update",
          fieldCount: count,
          translator: arabic,
        }),
      ).toBe(
        locale[AUDIT_LOG_FIELDS_CHANGED.other]!.replace(
          "{{count}}",
          String(count),
        ),
      );
    }

    expect(
      getAuditLogChangesDescription({
        action: "Update",
        fieldCount: 1,
        translator: arabic,
      }),
    ).toBe(
      locale[`${AUDIT_LOG_FIELDS_CHANGED.other}_one`]!.replace(
        "{{count}}",
        "1",
      ),
    );
    // A label and its count, as ARABIC.md has a general form read.
    expect(locale[AUDIT_LOG_FIELDS_CHANGED.other]).toMatch(/: \{\{count\}\}$/);
  });

  test("Persian writes the count in its own digits", () => {
    const persian: Translator = dashboardTranslator("fa");

    expect(
      getAuditLogChangesDescription({
        action: "Update",
        fieldCount: 3,
        translator: persian,
      }),
    ).toBe("۳ فیلد تغییر کرد");
    expect(
      getAuditLogChangesDescription({
        action: "Update",
        fieldCount: 12,
        translator: persian,
      }),
    ).toBe("۱۲ فیلد تغییر کرد");
  });

  test.each(LANGUAGES)(
    "%s: an update that recorded no field says so in its words",
    (language: string) => {
      drawDialog({ language, action: "Update", changes: [] });

      expect(
        screen.getByText(wordIn(language, AUDIT_LOG_NO_FIELD_CHANGES)),
      ).toBeInTheDocument();
    },
  );
});

describe("a created, deleted or downloaded entry's dialog", () => {
  test.each(
    LANGUAGES.flatMap((language: string): Array<[string, string, string]> => {
      return [
        [language, "Create", AUDIT_LOG_CHANGES_DESCRIPTIONS.created],
        [language, "Delete", AUDIT_LOG_CHANGES_DESCRIPTIONS.deleted],
        [language, "Download", AUDIT_LOG_CHANGES_DESCRIPTIONS.downloaded],
        [language, "Restore", AUDIT_LOG_CHANGES_DESCRIPTIONS.details],
      ];
    }),
  )(
    "%s: %s says what it shows, and labels each field's value",
    (language: string, action: string, description: string) => {
      drawDialog({
        language,
        action,
        changes: [
          { field: "name", newValue: "Checkout API", oldValue: "Checkout API" },
        ],
      });

      expect(screen.getByTestId("modal-description")).toHaveTextContent(
        wordIn(language, description),
      );

      // One value, labelled the same for a created and a deleted record.
      expect(screen.getAllByText(wordIn(language, "Value"))).toHaveLength(1);
      expect(screen.queryByText(wordIn(language, "Before"))).toBeNull();
    },
  );

  test("the description is drawn once, as worded: never looked up again as a key", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      getAuditLogChangesDescription({
        action: "Create",
        fieldCount: 4,
        translator: german,
      }),
    ).toBe(readDashboardLocale("de")[AUDIT_LOG_CHANGES_DESCRIPTIONS.created]);

    drawDialog({ language: "de", action: "Update", changes: THREE_CHANGES });

    expect(
      within(screen.getByTestId("modal-description")).getByText(
        "3 Felder geändert",
      ),
    ).toBeInTheDocument();
  });
});

describe("a session's dialog", () => {
  test.each(LANGUAGES)(
    "%s: says what it shows, and names each field it recorded in its words, a device and an address as recorded",
    (language: string) => {
      drawDialog({ language, action: "SignIn", changes: SESSION_SIGN_IN });

      expect(screen.getByTestId("modal-description")).toHaveTextContent(
        wordIn(language, AUDIT_LOG_CHANGES_DESCRIPTIONS.signIn),
      );

      const details: HTMLElement = screen.getByTestId(
        "audit-log-session-details",
      );

      for (const field of [
        AuditLogSessionField.SignInMethod,
        AuditLogSessionField.SecondFactor,
        AuditLogSessionField.Device,
        AuditLogSessionField.IpAddress,
      ]) {
        expect(
          within(details).getByText(
            wordIn(language, AUDIT_LOG_SESSION_FIELD_LABELS[field]),
          ),
        ).toBeInTheDocument();
      }

      // What was recorded, as it was recorded.
      expect(
        within(details).getByText("Chrome 130 on macOS"),
      ).toBeInTheDocument();
      expect(within(details).getByText("203.0.113.7")).toBeInTheDocument();
    },
  );

  test.each(LANGUAGES)(
    "%s: a session's end says how it ended, and a session with nothing recorded says so",
    (language: string) => {
      drawDialog({ language, action: "SessionTimeout", changes: [] });

      expect(screen.getByTestId("modal-description")).toHaveTextContent(
        wordIn(language, AUDIT_LOG_CHANGES_DESCRIPTIONS.sessionEnd),
      );
      expect(
        screen.getByText(wordIn(language, AUDIT_LOG_NO_SESSION_DETAILS)),
      ).toBeInTheDocument();
    },
  );

  test("the session's description is an English key the dialog looks up, whichever action", () => {
    expect(getSessionDetailsDescription("SignIn")).toBe(
      "How and where they signed in",
    );
    expect(getSessionDetailsDescription("SignOut")).toBe(
      "How the session ended",
    );
    expect(getSessionDetailsDescription("SessionRevoked")).toBe(
      "How the session ended",
    );
  });

  test("without a translator the rows are English, as the server and a plain test read them", () => {
    const rows: Array<SessionDetailRow> =
      readSessionDetailRows(SESSION_SIGN_IN);

    expect(
      rows.map((row: SessionDetailRow): string => {
        return row.label;
      }),
    ).toEqual(["Signed in with", "Second factor", "Device", "IP address"]);
  });

  test("with the German translator, the labels are German, OneUptime's own words German (#8459) and the rest as recorded", () => {
    const rows: Array<SessionDetailRow> = readSessionDetailRows(
      SESSION_SIGN_IN,
      dashboardTranslator("de"),
    );

    expect(
      rows.map((row: SessionDetailRow): [string, string] => {
        return [row.label, row.value];
      }),
    ).toEqual([
      ["Angemeldet mit", "Passwort"],
      ["Zweiter Faktor", "Sicherheitsschlüssel"],
      ["Gerät", "Chrome 130 on macOS"],
      ["IP-Adresse", "203.0.113.7"],
    ]);
  });
});
