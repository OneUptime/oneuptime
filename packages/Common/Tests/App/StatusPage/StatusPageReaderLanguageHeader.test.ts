import StatusPageAPI, {
  getReaderLanguageHeaders,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import Headers from "../../../Types/API/Headers";
import ObjectID from "../../../Types/ObjectID";
import { getReaderLanguageFromAcceptLanguage } from "../../../Types/ReaderLanguage";
import {
  getStatusPageLanguageHead,
  SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
} from "../../../Types/StatusPage/StatusPageLanguage";
import { followLanguageForPage } from "../../../UI/Utils/PageLanguage";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import fs from "fs";
import path from "path";

/*
 * A STATUS PAGE TELLS THE SERVER THE LANGUAGE IT IS READ IN.
 *
 * Every request the page makes says, as its Accept-Language, the language
 * the page is shown in: <html lang>, which the server writes in the page's
 * default language and the page keeps on the one the reader sees, on every
 * switch. A sign-up keeps it, so the subscriber's notifications are written
 * in the language they read the page in
 * (Common/Server/Utils/StatusPage/SubscriberLanguage).
 */

const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

function setUrl(url: string): void {
  window.history.replaceState(window.history.state, "", url);
}

function setPageLanguage(language: string | null): void {
  if (language === null) {
    document.documentElement.removeAttribute("lang");
  } else {
    document.documentElement.setAttribute("lang", language);
  }
}

describe("the language a status page is read in, on each request", () => {
  beforeEach(() => {
    setUrl(`/status-page/${STATUS_PAGE_ID}/subscribe/email`);
    StatusPageUtil.setStatusPageId(new ObjectID(STATUS_PAGE_ID));
  });

  afterEach(() => {
    StatusPageUtil.setStatusPageId(null);
    setPageLanguage(null);
    document.documentElement.removeAttribute("dir");
  });

  test("a page that names no language says none", () => {
    setPageLanguage(null);

    expect(getReaderLanguageHeaders()).toEqual({});

    const headers: Headers = StatusPageAPI.getDefaultHeaders();

    expect(headers["status-page-id"]).toBe(STATUS_PAGE_ID);
    expect(Object.keys(headers)).not.toContain("accept-language");

    setPageLanguage("  ");
    expect(getReaderLanguageHeaders()).toEqual({});
  });

  test("the language the server drew the page in: its default", () => {
    setPageLanguage(getStatusPageLanguageHead("de").lang);

    expect(StatusPageAPI.getDefaultHeaders()).toEqual({
      "status-page-id": STATUS_PAGE_ID,
      tenantid: "",
      "accept-language": "de",
    });
  });

  test("the language the reader switches to, as the page follows it", async () => {
    const instance: i18n = createInstance();

    await instance.init({
      lng: "de",
      fallbackLng: "en",
      supportedLngs: SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
      resources: {
        en: { translation: {} },
        de: { translation: {} },
        fa: { translation: {} },
        "zh-TW": { translation: {} },
      },
    });

    // As the status page's Utils/i18n.ts hands its instance over.
    followLanguageForPage(instance);

    expect(StatusPageAPI.getDefaultHeaders()["accept-language"]).toBe("de");

    // The footer's language switcher.
    await instance.changeLanguage("zh-TW");
    expect(StatusPageAPI.getDefaultHeaders()["accept-language"]).toBe("zh-TW");

    await instance.changeLanguage("fa");
    expect(StatusPageAPI.getDefaultHeaders()["accept-language"]).toBe("fa");
  });

  test("a page that has not found its status page sends nothing, as before", () => {
    StatusPageUtil.setStatusPageId(null);
    setUrl("/");
    setPageLanguage("ja");

    expect(StatusPageAPI.getDefaultHeaders()).toEqual({});
  });

  test("every language the page can be read in is one the server reads back as itself", () => {
    for (const code of SUPPORTED_STATUS_PAGE_LANGUAGE_CODES) {
      expect(getReaderLanguageFromAcceptLanguage(code)).toBe(code);
    }
  });

  test("the page follows its reader's language on <html>, which the header reads", () => {
    const i18nSetup: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/StatusPage/src/Utils/i18n.ts",
      ),
      "utf8",
    );

    expect(i18nSetup).toContain("followLanguageForPage(i18n);");
  });
});
