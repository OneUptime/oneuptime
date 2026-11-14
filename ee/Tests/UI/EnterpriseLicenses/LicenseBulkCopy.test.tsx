import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { getDeleteConsequence } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import LicenseBulkCopy, {
  expiresOnDay,
  getLicenseItemName,
  LICENSE_NAME_SEPARATOR,
  toCalendarDay,
} from "../../../AdminDashboard/EnterpriseLicenses/Components/LicenseBulkCopy";
import useLicenseBulkActions, {
  LicenseBulkActionsResult,
} from "../../../AdminDashboard/EnterpriseLicenses/Components/useLicenseBulkActions";

/*
 * What the Enterprise Licenses list says when licenses are deleted or have
 * their expiry changed, and that it says it in every language the Admin
 * Dashboard ships.
 *
 * The Admin Dashboard looks every string up by its English text in its own
 * locale files (packages/App/FeatureSet/AdminDashboard/src/Locales), so a
 * string with no entry there stays English for everyone. That goes for the
 * list's own new strings, for what deleting a license does (the shared
 * DeleteConsequences catalog), and for the shared bulk bar and Delete dialog
 * strings this list is the Admin Dashboard's first to show in full.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

type Locale = Record<string, unknown>;

const readLocale: (locale: string) => Locale = (locale: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
};

const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

const placeholdersOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(PLACEHOLDER) || []).sort();
};

// The list's own sentences, the plural ones as their two keys.
const LICENSE_KEYS: Array<[string, string]> = [
  [LicenseBulkCopy.changeExpiryTitle, LicenseBulkCopy.changeExpiryTitle],
  [
    LicenseBulkCopy.changeExpiryDescription.other,
    LicenseBulkCopy.changeExpiryDescription.other,
  ],
  [
    `${LicenseBulkCopy.changeExpiryDescription.other}_one`,
    LicenseBulkCopy.changeExpiryDescription.one,
  ],
  [LicenseBulkCopy.newExpiryDateTitle, LicenseBulkCopy.newExpiryDateTitle],
  [
    LicenseBulkCopy.newExpiryDateDescription,
    LicenseBulkCopy.newExpiryDateDescription,
  ],
  [LicenseBulkCopy.alreadyExpiresOnDay, LicenseBulkCopy.alreadyExpiresOnDay],
  [LicenseBulkCopy.updatedCount.other, LicenseBulkCopy.updatedCount.other],
  [
    `${LicenseBulkCopy.updatedCount.other}_one`,
    LicenseBulkCopy.updatedCount.one,
  ],
  [
    LicenseBulkCopy.notUpdatedCount.other,
    LicenseBulkCopy.notUpdatedCount.other,
  ],
  [
    `${LicenseBulkCopy.notUpdatedCount.other}_one`,
    LicenseBulkCopy.notUpdatedCount.one,
  ],
  [
    getDeleteConsequence("EnterpriseLicense"),
    getDeleteConsequence("EnterpriseLicense"),
  ],
  ["Enterprise License", "Enterprise License"],
  ["Enterprise Licenses", "Enterprise Licenses"],
];

// The shared bar's and the Delete dialogs' strings the list shows.
const SHARED_KEYS: Array<string> = [
  "{{count}} {{itemsName}} Selected",
  "{{count}} {{itemsName}} Selected_one",
  "Select All {{itemsName}}",
  "Selecting All {{itemsName}}...",
  "Clear Selection",
  "Bulk Actions",
  "Keep this page open until this finishes. You can stop at any time: what is already done stays done.",
  "Keep this page open until this finishes.",
  "Stopping. The ones already started are finishing.",
  "Less than a minute left",
  "About {{count}} minutes left",
  "About {{count}} minutes left_one",
  "About {{count}} hours left",
  "About {{count}} hours left_one",
  "{{count}} {{itemsName}} succeeded",
  "{{count}} {{itemsName}} failed",
  "{{count}} {{itemsName}} not changed",
  "{{count}} {{itemsName}} not started: you stopped the action",
  "{{count}} {{itemsName}} not started: you stopped the action_one",
  "In Progress",
  "Completed",
  "Stop",
  "Stopping…",
  "Stopped",
  "Delete {{count}} {{itemsName}}",
  "Delete {{count}} {{itemsName}}_one",
  "Are you sure you want to delete {{count}} {{itemsName}}? This action cannot be undone.",
  "{{count}} {{itemsName}} deleted",
  "{{count}} {{itemsName}} not deleted",
  "Delete {{itemName}}",
  "Show ID",
  "{{field}} should be a future date.",
  "Are you sure you want to delete {{name}}?",
  "This action cannot be undone.",
  "and {{remaining}} more",
];

describe("naming a license", () => {
  test("by its company and its masked key, as the row shows them", () => {
    expect(
      getLicenseItemName({
        companyName: "Netlock.hu",
        licenseKey: `da74${"0".repeat(56)}7c7a`,
      }),
    ).toBe(`Netlock.hu${LICENSE_NAME_SEPARATOR}da74••••7c7a`);
  });

  test("two licenses of one company read apart", () => {
    expect(
      getLicenseItemName({
        companyName: "Netlock.hu",
        licenseKey: "da74aaaabbbb7c7a",
      }),
    ).not.toBe(
      getLicenseItemName({
        companyName: "Netlock.hu",
        licenseKey: "e639aaaabbbbe1f4",
      }),
    );
  });

  test("never by the key itself", () => {
    const key: string = `1d94${"9".repeat(56)}91eb`;

    expect(
      getLicenseItemName({ companyName: "Portainer.io", licenseKey: key }),
    ).not.toContain(key);
  });

  test("either half alone when the other is missing", () => {
    expect(
      getLicenseItemName({ companyName: " Edarat Group ", licenseKey: "" }),
    ).toBe("Edarat Group");
    expect(getLicenseItemName({ licenseKey: "0734aaaabbbb8516" })).toBe(
      "0734••••8516",
    );
    expect(getLicenseItemName({})).toBe("");
  });
});

describe("the day a license expires", () => {
  test("is the calendar day of its stored midnight, and of the day picked", () => {
    expect(toCalendarDay(new Date("2027-10-14T00:00:00.000Z"))).toBe(
      "2027-10-14",
    );
    expect(toCalendarDay("2027-10-14T00:00:00.000Z")).toBe("2027-10-14");
    expect(toCalendarDay("2027-10-14")).toBe("2027-10-14");
    expect(toCalendarDay("")).toBe("");
    expect(toCalendarDay(undefined)).toBe("");
    expect(toCalendarDay(null)).toBe("");
    expect(toCalendarDay("not a date")).toBe("");
  });

  test("a license already expiring on the day picked is told apart from one that is not", () => {
    expect(
      expiresOnDay(new Date("2027-10-14T00:00:00.000Z"), "2027-10-14"),
    ).toBe(true);
    expect(expiresOnDay("2027-10-14T00:00:00.000Z", "2027-10-15")).toBe(false);
    expect(expiresOnDay(undefined, "2027-10-14")).toBe(false);
    expect(expiresOnDay(new Date("2027-10-14T00:00:00.000Z"), "")).toBe(false);
  });
});

describe("the strings in every Admin Dashboard language", () => {
  const english: Locale = readLocale("en");

  test.each(LICENSE_KEYS)(
    "%s: English, and translated in every other language",
    (key: string, englishText: string) => {
      expect(english[key]).toBe(englishText);

      for (const locale of OTHER_LOCALES) {
        const translated: unknown = readLocale(locale)[key];

        expect({ locale, isText: typeof translated === "string" }).toEqual({
          locale,
          isText: true,
        });
        expect({ locale, same: translated === englishText }).toEqual({
          locale,
          same: false,
        });
        expect(placeholdersOf(translated as string)).toEqual(
          placeholdersOf(englishText),
        );
      }
    },
  );

  test.each(SHARED_KEYS)(
    "%s: in every language, with its placeholders",
    (key: string) => {
      expect(typeof english[key]).toBe("string");

      for (const locale of OTHER_LOCALES) {
        const translated: unknown = readLocale(locale)[key];

        expect({ locale, isText: typeof translated === "string" }).toEqual({
          locale,
          isText: true,
        });
        expect(placeholdersOf(translated as string)).toEqual(
          placeholdersOf(english[key] as string),
        );
      }
    },
  );

  /*
   * The customer's Settings > License page is in its reader's language
   * (#7132), its Refresh license button among its words: the sentence names
   * the button as the same language's Admin Dashboard draws it, never in
   * English.
   */
  test("the customer's button is named as the reader's Admin Dashboard draws it", () => {
    for (const locale of [...OTHER_LOCALES, "ar"]) {
      const button: unknown = readLocale(locale)["Refresh license"];
      const sentence: string = String(
        readLocale(locale)[LicenseBulkCopy.newExpiryDateDescription],
      );

      expect({ locale, isText: typeof button === "string" }).toEqual({
        locale,
        isText: true,
      });
      expect({ locale, button: button !== "Refresh license" }).toEqual({
        locale,
        button: true,
      });
      expect({ locale, names: sentence.includes(button as string) }).toEqual({
        locale,
        names: true,
      });
      expect({ locale, english: sentence.includes("Refresh license") }).toEqual(
        { locale, english: false },
      );
    }
  });

  /*
   * The delete question is a string the two dashboards share, and the Admin
   * Dashboard says a shared string as the same language's Dashboard does
   * (App/Tests/AdminDashboard/AdminSharedStringsLocales, 2807833b3d5). The
   * Dashboard's Spanish addresses its reader as tú (7281e405ef), so the
   * Admin's question does too: one voice in both dashboards.
   */
  test("the Admin Dashboard's Spanish asks as the Dashboard's does", () => {
    const question: string =
      "Are you sure you want to delete {{count}} {{itemsName}}? This action cannot be undone.";
    const dashboardSpanish: unknown = JSON.parse(
      fs.readFileSync(
        path.join(
          LOCALES_DIR,
          "..",
          "..",
          "..",
          "Dashboard",
          "src",
          "Locales",
          "es.json",
        ),
        "utf8",
      ),
    )[question];

    expect(dashboardSpanish).toContain("¿Seguro que quieres eliminar");
    expect(readLocale("es")[question]).toBe(dashboardSpanish);
  });

  test("Japanese never puts a half-width question mark after Japanese text", () => {
    const japanese: Locale = readLocale("ja");
    const keys: Array<string> = [
      ...LICENSE_KEYS.map(([key]: [string, string]): string => {
        return key;
      }),
      ...SHARED_KEYS,
    ];

    for (const key of keys) {
      const value: string = String(japanese[key]);

      expect({ key, halfWidth: value.includes("?") }).toEqual({
        key,
        halfWidth: false,
      });
    }
  });
});

describe("the Change Expiry Date dialog in every language", () => {
  // An instance like the Admin Dashboard's: one language, English as the fallback.
  const instanceFor: (locale: string) => Promise<i18n> = async (
    locale: string,
  ): Promise<i18n> => {
    const instance: i18n = createInstance();

    await instance.init({
      lng: locale,
      fallbackLng: "en",
      resources: {
        en: { translation: readLocale("en") },
        [locale]: { translation: readLocale(locale) },
      },
      interpolation: { escapeValue: false },
    });

    return instance;
  };

  function Harness(props: { count: number }): ReactElement {
    const result: LicenseBulkActionsResult = useLicenseBulkActions();
    const action: BulkActionButtonSchema<EnterpriseLicense> =
      result.bulkActions[0]!;

    return (
      <>
        <button
          type="button"
          data-testid="open-change-expiry"
          onClick={() => {
            void action.onClick({
              items: Array.from({ length: props.count }).map(() => {
                return new EnterpriseLicense();
              }),
              onProgressInfo: () => {},
              onBulkActionStart: () => {},
              onBulkActionEnd: () => {},
            });
          }}
        />
        {result.modals}
      </>
    );
  }

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test.each(["en", ...OTHER_LOCALES])(
    "%s: the title, the count and the field are in that language",
    async (locale: string) => {
      const entries: Locale = readLocale(locale);
      const instance: i18n = await instanceFor(locale);

      render(
        <I18nextProvider i18n={instance}>
          <Harness count={3} />
        </I18nextProvider>,
      );

      await act(async () => {
        screen.getByTestId("open-change-expiry").click();
      });

      const dialog: HTMLElement = await screen.findByRole("dialog");
      // The count is written the reader's way (Persian digits in Persian).
      const description: string = (
        entries[LicenseBulkCopy.changeExpiryDescription.other] as string
      ).replace("{{count}}", new Intl.NumberFormat(locale).format(3));

      expect(
        within(dialog).getAllByText(
          entries[LicenseBulkCopy.changeExpiryTitle] as string,
        ).length,
      ).toBeGreaterThan(0);
      expect(within(dialog).getByText(description)).toBeVisible();
      expect(
        within(dialog).getByText(
          entries[LicenseBulkCopy.newExpiryDateTitle] as string,
          { exact: false },
        ),
      ).toBeVisible();
      expect(
        within(dialog).getByText(
          entries[LicenseBulkCopy.newExpiryDateDescription] as string,
        ),
      ).toBeVisible();
    },
  );
});
