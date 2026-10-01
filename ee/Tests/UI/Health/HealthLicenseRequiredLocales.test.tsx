import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import HealthLicenseRequired, {
  HEALTH_LICENSE_REQUIRED_DESCRIPTION,
  HEALTH_LICENSE_REQUIRED_TITLE,
} from "../../../AdminDashboard/Health/HealthLicenseRequired";

/*
 * The Health screens' license notice, in every language the Admin Dashboard
 * ships.
 *
 * The notice is plain English, and Alert looks its title and description up
 * in the Admin Dashboard's locale files by their English text. This renders
 * it with the real locale files, one language at a time: every language
 * shows both in that language.
 *
 * The notice lists what else is off while the license is missing or expired:
 * SCIM provisioning and audit logging. It used to list single sign-on too;
 * single sign-on is part of every edition now, and that copy is in no locale.
 *
 * The i18next instance reaches the notice through I18nextProvider only;
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

const ALL_LOCALES: Array<string> = ["en", ...OTHER_LOCALES];

// The description from while single sign-on stopped with the license.
const RETIRED_DESCRIPTION: string = HEALTH_LICENSE_REQUIRED_DESCRIPTION.replace(
  "SCIM provisioning and audit logging are off too",
  "single sign-on, SCIM provisioning and audit logging are off too",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

// An instance like the Admin Dashboard's: one language, English as the fallback.
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

interface NoticeText {
  title: string;
  description: string;
}

async function renderNoticeIn(
  locale: string,
  resource?: Locale | undefined,
): Promise<NoticeText> {
  const instance: i18n = await instanceFor(locale, resource);

  render(
    <I18nextProvider i18n={instance}>
      <HealthLicenseRequired />
    </I18nextProvider>,
  );

  // Alert's bold title and the description under it.
  const lines: Array<Element> = Array.from(
    screen
      .getByTestId("health-license-required")
      .querySelectorAll(".alert-message > div:first-child > div"),
  );

  return {
    title: lines[0]?.textContent || "",
    description: lines[1]?.textContent || "",
  };
}

describe("the Health screens' license notice in every Admin Dashboard language", () => {
  afterEach(() => {
    cleanup();
  });

  test("lists SCIM provisioning and audit logging as off too, and not single sign-on", () => {
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).toContain(
      "SCIM provisioning and audit logging are off too",
    );
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).not.toMatch(
      /\bSSO\b|single sign-on/i,
    );
    expect(RETIRED_DESCRIPTION).not.toBe(HEALTH_LICENSE_REQUIRED_DESCRIPTION);
  });

  test("English shows the notice's own strings", async () => {
    expect(await renderNoticeIn("en")).toEqual({
      title: HEALTH_LICENSE_REQUIRED_TITLE,
      description: HEALTH_LICENSE_REQUIRED_DESCRIPTION,
    });
  });

  test.each(OTHER_LOCALES)(
    "%s shows the notice in that language",
    async (locale: string) => {
      const entries: Locale = readLocale(locale);
      const notice: NoticeText = await renderNoticeIn(locale);

      expect(notice).toEqual({
        title: entries[HEALTH_LICENSE_REQUIRED_TITLE],
        description: entries[HEALTH_LICENSE_REQUIRED_DESCRIPTION],
      });
      expect(notice.title).not.toBe(HEALTH_LICENSE_REQUIRED_TITLE);
      expect(notice.description).not.toBe(HEALTH_LICENSE_REQUIRED_DESCRIPTION);
      // SCIM keeps its name; single sign-on is not mentioned.
      expect(notice.description).toContain("SCIM");
      expect(notice.description).not.toMatch(/\bSSO\b/);
    },
  );

  // What the checks above would see if the notice changed and the locales did not follow.
  test("a language without the notice's entries shows it in English (negative control)", async () => {
    const withoutNotice: Locale = { ...readLocale("ja") };

    delete withoutNotice[HEALTH_LICENSE_REQUIRED_TITLE];
    delete withoutNotice[HEALTH_LICENSE_REQUIRED_DESCRIPTION];

    expect(await renderNoticeIn("ja", withoutNotice)).toEqual({
      title: HEALTH_LICENSE_REQUIRED_TITLE,
      description: HEALTH_LICENSE_REQUIRED_DESCRIPTION,
    });
  });

  test("the description from while single sign-on stopped with the license is in no locale", () => {
    for (const locale of ALL_LOCALES) {
      expect({
        locale,
        retired: RETIRED_DESCRIPTION in readLocale(locale),
      }).toEqual({ locale, retired: false });
    }
  });
});
