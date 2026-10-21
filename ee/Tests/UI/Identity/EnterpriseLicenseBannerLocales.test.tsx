import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import EnterpriseLicenseBanner, {
  GRACE_DESCRIPTION,
  GRACE_TITLE,
  NOT_INCLUDED_SCIM_DESCRIPTION,
  NOT_INCLUDED_SCIM_TITLE,
  READ_ONLY_DESCRIPTION,
  READ_ONLY_TITLE,
} from "../../../Dashboard/Identity/License/EnterpriseLicenseBanner";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import ReadOnlyActionsNotice, {
  READ_ONLY_ACTIONS_NOTICE_TEST_ID,
  SCIM_ACTIONS_DESCRIPTION,
  SCIM_ACTIONS_TITLE,
} from "../../../Dashboard/Identity/TightenOnly/ReadOnlyActionsNotice";

/*
 * The SCIM screens' license copy, in every language the Dashboard ships.
 *
 * The banner above a SCIM screen's configuration and the notice under it are
 * plain English, and Alert looks each string up in the Dashboard's locale
 * files by its English text. Both are on the screen together while the
 * configuration is read-only, so both need an entry in every locale: a
 * German admin whose license lapsed would otherwise read an English banner
 * above a German notice. This renders the two components the way the SCIM
 * screens do - banner, then notice - with the real locale files, one
 * language at a time, in each license mode that shows them.
 *
 * The banner used to say single sign-on stops with the license too. Single
 * sign-on is part of every edition now, and that copy is in no locale.
 *
 * The generic "does not include this feature" copy is for a screen that
 * names no feature. Both SCIM screens name SCIM, so it never shows there.
 *
 * The i18next instance reaches the components through I18nextProvider only;
 * installing it globally would leak a language into the other tests in this
 * worker.
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
  "Dashboard",
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

const ALL_LOCALES: Array<string> = ["en", ...OTHER_LOCALES];

interface ModeCase {
  name: string;
  mode: EnterpriseLicenseMode;
  bannerTestId: string;
  title: string;
  description: string;
  // The notice shows while the configuration is read-only.
  showsNotice: boolean;
}

const MODES: Array<ModeCase> = [
  {
    name: "read-only (trial or grace period over)",
    mode: EnterpriseLicenseMode.ReadOnly,
    bannerTestId: "enterprise-license-read-only-banner",
    title: READ_ONLY_TITLE,
    description: READ_ONLY_DESCRIPTION,
    showsNotice: true,
  },
  {
    name: "trial or grace period",
    mode: EnterpriseLicenseMode.Grace,
    bannerTestId: "enterprise-license-grace-banner",
    title: GRACE_TITLE,
    description: GRACE_DESCRIPTION,
    showsNotice: false,
  },
  {
    name: "a license that leaves SCIM out",
    mode: EnterpriseLicenseMode.NotIncluded,
    bannerTestId: "enterprise-license-not-included-banner",
    title: NOT_INCLUDED_SCIM_TITLE,
    description: NOT_INCLUDED_SCIM_DESCRIPTION,
    showsNotice: true,
  },
];

const SCIM_SCREEN_COPY: Array<string> = [
  READ_ONLY_TITLE,
  READ_ONLY_DESCRIPTION,
  GRACE_TITLE,
  GRACE_DESCRIPTION,
  NOT_INCLUDED_SCIM_TITLE,
  NOT_INCLUDED_SCIM_DESCRIPTION,
  SCIM_ACTIONS_TITLE,
  SCIM_ACTIONS_DESCRIPTION,
];

// The banner copy from while single sign-on stopped with the license, verbatim.
const RETIRED_SSO_BANNER_COPY: Array<string> = [
  "Enterprise license required: single sign-on and SCIM are off, and this configuration is read-only.",
  'Without a valid Enterprise license, single sign-on is off and "Require SSO" is not enforced, so members sign in with their password (anyone who only ever used single sign-on can set one with "Forgot password"). Your identity provider\'s SCIM requests are refused, so it cannot provision or deprovision users until the license is back. Nothing configured here is deleted: activate or renew the Enterprise license in the Admin Dashboard and everything resumes as configured.',
  "No valid Enterprise license: single sign-on and SCIM stop when the trial or grace period ends.",
  "Your Enterprise license does not include single sign-on: single sign-on is off, and this configuration is read-only.",
  'The installed license leaves single sign-on out, so single sign-on is off and "Require SSO" is not enforced: members sign in with their password (anyone who only ever used single sign-on can set one with "Forgot password"). Nothing configured here is deleted: activate a license that includes single sign-on in the Admin Dashboard and everything resumes as configured.',
];

// The day counts, in Latin or Persian digits.
const TRIAL_DAYS: RegExp = /14|۱۴/;
const GRACE_DAYS: RegExp = /30|۳۰/;

// "SSO" as a word, in any language's text.
const SSO_WORD: RegExp = /\bSSO\b/;

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

// An instance like the Dashboard's: one language, English as the fallback.
async function instanceFor(
  locale: string,
  resource: Locale = readLocale(locale),
): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: resource },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

interface AlertText {
  title: string;
  description: string;
}

// Alert's bold title and the description under it.
function alertTextOf(alert: HTMLElement): AlertText {
  const lines: Array<Element> = Array.from(
    alert.querySelectorAll(".alert-message > div:first-child > div"),
  );

  return {
    title: lines[0]?.textContent || "",
    description: lines[1]?.textContent || "",
  };
}

// The top of a SCIM screen: the banner, then the notice.
async function renderScimScreenTop(
  locale: string,
  mode: EnterpriseLicenseMode,
  resource?: Locale | undefined,
): Promise<void> {
  const instance: i18n = await instanceFor(locale, resource);

  render(
    <I18nextProvider i18n={instance}>
      <EnterpriseLicenseBanner mode={mode} feature={LicensedFeature.SCIM} />
      <ReadOnlyActionsNotice mode={mode} />
    </I18nextProvider>,
  );
}

describe("the SCIM screens' license copy in every Dashboard language", () => {
  afterEach(() => {
    cleanup();
  });

  test("every string is an entry in every locale, and en.json maps it to itself", () => {
    const english: Locale = readLocale("en");

    for (const text of SCIM_SCREEN_COPY) {
      expect(english[text]).toBe(text);
    }

    for (const locale of OTHER_LOCALES) {
      const entries: Locale = readLocale(locale);

      expect({
        locale,
        missing: SCIM_SCREEN_COPY.filter((text: string) => {
          return typeof entries[text] !== "string";
        }),
      }).toEqual({ locale, missing: [] });
    }
  });

  describe.each(MODES)("$name", (modeCase: ModeCase) => {
    test("English shows the components' own strings", async () => {
      await renderScimScreenTop("en", modeCase.mode);

      expect(alertTextOf(screen.getByTestId(modeCase.bannerTestId))).toEqual({
        title: modeCase.title,
        description: modeCase.description,
      });

      if (modeCase.showsNotice) {
        expect(
          alertTextOf(screen.getByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID)),
        ).toEqual({
          title: SCIM_ACTIONS_TITLE,
          description: SCIM_ACTIONS_DESCRIPTION,
        });
      } else {
        expect(
          screen.queryByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID),
        ).not.toBeInTheDocument();
      }
    });

    test.each(OTHER_LOCALES)(
      "%s shows the banner and the notice in that language",
      async (locale: string) => {
        const entries: Locale = readLocale(locale);

        await renderScimScreenTop(locale, modeCase.mode);

        const banner: AlertText = alertTextOf(
          screen.getByTestId(modeCase.bannerTestId),
        );

        expect(banner).toEqual({
          title: entries[modeCase.title],
          description: entries[modeCase.description],
        });
        expect(banner.title).not.toBe(modeCase.title);
        expect(banner.description).not.toBe(modeCase.description);
        // SCIM keeps its name; single sign-on is not mentioned.
        expect(banner.title).toContain("SCIM");
        expect(`${banner.title} ${banner.description}`).not.toMatch(SSO_WORD);

        if (modeCase.showsNotice) {
          const notice: AlertText = alertTextOf(
            screen.getByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID),
          );

          expect(notice).toEqual({
            title: entries[SCIM_ACTIONS_TITLE],
            description: entries[SCIM_ACTIONS_DESCRIPTION],
          });
          expect(notice.title).not.toBe(SCIM_ACTIONS_TITLE);
        }
      },
    );
  });

  /*
   * The banner's key is the text it renders, periods included. If a period
   * changes, the key changes, and the locales have to follow.
   */
  test("the grace banner's entry is the text it renders, with the 14-day trial and the 30-day grace period", () => {
    expect(GRACE_DESCRIPTION).toContain("14-day trial");
    expect(GRACE_DESCRIPTION).toContain("30-day grace period");

    for (const locale of OTHER_LOCALES) {
      const text: string = String(readLocale(locale)[GRACE_DESCRIPTION]);

      expect({ locale, trial: TRIAL_DAYS.test(text) }).toEqual({
        locale,
        trial: true,
      });
      expect({ locale, grace: GRACE_DAYS.test(text) }).toEqual({
        locale,
        grace: true,
      });
    }
  });

  /*
   * Without the banner's entries its lookups fall back to English, under a
   * notice that is still translated: what the checks above would see if the
   * banner's copy changed and the locales did not follow.
   */
  test("a language without the banner's entries shows an English banner over a German notice (negative control)", async () => {
    const withoutBanner: Locale = { ...readLocale("de") };

    delete withoutBanner[READ_ONLY_TITLE];
    delete withoutBanner[READ_ONLY_DESCRIPTION];

    await renderScimScreenTop(
      "de",
      EnterpriseLicenseMode.ReadOnly,
      withoutBanner,
    );

    expect(
      alertTextOf(screen.getByTestId("enterprise-license-read-only-banner")),
    ).toEqual({ title: READ_ONLY_TITLE, description: READ_ONLY_DESCRIPTION });
    expect(
      alertTextOf(screen.getByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID)).title,
    ).toBe(readLocale("de")[SCIM_ACTIONS_TITLE]);
  });

  test("the banner copy from while single sign-on stopped with the license is in no locale", () => {
    for (const locale of ALL_LOCALES) {
      const entries: Locale = readLocale(locale);

      expect({
        locale,
        retired: RETIRED_SSO_BANNER_COPY.filter((text: string) => {
          return text in entries;
        }),
      }).toEqual({ locale, retired: [] });
    }
  });
});
