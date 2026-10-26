import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import OneUptimeDate from "../../../Types/Date";
import {
  getDateDisplayLanguage,
  getDateLocale,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";

/*
 * Every frontend that translates its pages writes its dates in the same
 * language: its i18n set-up hands its i18next instance to
 * followLanguageForDates, which sets OneUptimeDate's display language when
 * i18next resolves the reader's language and again on every switch.
 */

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet",
);

afterEach(() => {
  setDateDisplayLanguage(null);
});

const startI18n: (language: string) => Promise<i18n> = async (
  language: string,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  followLanguageForDates(instance);

  await instance.init({
    lng: language,
    fallbackLng: "en",
    supportedLngs: ["en", "de", "ja", "fa", "zh-CN"],
    resources: {
      en: { translation: {} },
      de: { translation: {} },
      ja: { translation: {} },
      fa: { translation: {} },
      "zh-CN": { translation: {} },
    },
  });

  return instance;
};

describe("dates follow the page's language", () => {
  test("from the language i18next starts in", async () => {
    await startI18n("de");

    expect(getDateDisplayLanguage()).toBe("de");
  });

  test("on every switch, English included", async () => {
    const instance: i18n = await startI18n("de");

    await instance.changeLanguage("ja");
    expect(getDateDisplayLanguage()).toBe("ja");

    await instance.changeLanguage("zh-CN");
    expect(getDateDisplayLanguage()).toBe("zh-CN");

    await instance.changeLanguage("en");
    expect(getDateDisplayLanguage()).toBe("en");
  });

  test("an instance set up before it is followed is read at once", async () => {
    const instance: i18n = createInstance();

    await instance.init({
      lng: "fa",
      fallbackLng: "en",
      resources: { en: { translation: {} }, fa: { translation: {} } },
    });

    expect(getDateDisplayLanguage()).toBe("en");

    followLanguageForDates(instance);

    expect(getDateDisplayLanguage()).toBe("fa");
  });

  test("a language Intl does not know writes English dates", async () => {
    await startI18n("xx");

    expect(getDateLocale(getDateDisplayLanguage())).toBe(
      "en-u-ca-gregory-nu-latn",
    );
    expect(OneUptimeDate.fromNow(new Date(Date.now() - 5 * 3600000))).toBe(
      "5 hours ago",
    );
  });
});

describe("each translated frontend follows its language", () => {
  test.each(["Dashboard", "StatusPage", "AdminDashboard", "Accounts"])(
    "%s's i18n set-up hands its instance over",
    (frontend: string) => {
      const source: string = fs.readFileSync(
        path.join(FEATURE_SETS, frontend, "src", "Utils", "i18n.ts"),
        "utf8",
      );

      expect(source).toContain(
        'import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";',
      );
      expect(source).toContain("followLanguageForDates(i18n);");
    },
  );
});
