import StatusPageAPI, {
  getReaderLanguageHeaders,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import Headers from "../../../Types/API/Headers";
import ObjectID from "../../../Types/ObjectID";
import { getReaderLanguageFromAcceptLanguage } from "../../../Types/ReaderLanguage";
import { SUPPORTED_STATUS_PAGE_LANGUAGE_CODES } from "../../../Types/StatusPage/StatusPageLanguage";
import { afterAll, beforeEach, describe, expect, test } from "@jest/globals";
import i18next from "i18next";

/*
 * A STATUS PAGE TELLS THE SERVER THE LANGUAGE IT IS READ IN.
 *
 * Every request the page makes says, as its Accept-Language, the language
 * the page is shown in - the one the reader picked, or the one the page
 * found for them. A sign-up keeps it, so the subscriber's notifications are
 * written in the language they read the page in
 * (Common/Server/Utils/StatusPage/SubscriberLanguage).
 */

const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

function setUrl(url: string): void {
  window.history.replaceState(window.history.state, "", url);
}

describe("the language a status page is read in, on each request", () => {
  beforeEach(() => {
    setUrl(`/status-page/${STATUS_PAGE_ID}/subscribe/email`);
    StatusPageUtil.setStatusPageId(new ObjectID(STATUS_PAGE_ID));
  });

  afterAll(() => {
    StatusPageUtil.setStatusPageId(null);
  });

  test("before the page's translation is set up, no language is said", () => {
    expect(getReaderLanguageHeaders()).toEqual({});

    const headers: Headers = StatusPageAPI.getDefaultHeaders();

    expect(headers["status-page-id"]).toBe(STATUS_PAGE_ID);
    expect(Object.keys(headers)).not.toContain("accept-language");
  });

  test("the language the page is shown in, and the one the reader switches to", async () => {
    await i18next.init({
      lng: "fr",
      fallbackLng: "en",
      supportedLngs: SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
      resources: {
        en: { translation: {} },
        fr: { translation: {} },
        "zh-TW": { translation: {} },
      },
    });

    expect(StatusPageAPI.getDefaultHeaders()).toEqual({
      "status-page-id": STATUS_PAGE_ID,
      tenantid: "",
      "accept-language": "fr",
    });

    // The language switcher's choice is what the next request says.
    await i18next.changeLanguage("zh-TW");

    expect(StatusPageAPI.getDefaultHeaders()["accept-language"]).toBe("zh-TW");
  });

  test("a page that has not found its status page sends nothing, as before", () => {
    StatusPageUtil.setStatusPageId(null);
    setUrl("/");

    expect(StatusPageAPI.getDefaultHeaders()).toEqual({});
  });

  test("every language the page can be read in is one the server reads back as itself", () => {
    for (const code of SUPPORTED_STATUS_PAGE_LANGUAGE_CODES) {
      expect(getReaderLanguageFromAcceptLanguage(code)).toBe(code);
    }
  });
});
