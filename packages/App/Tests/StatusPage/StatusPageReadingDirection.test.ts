/**
 * The language and reading direction a status page's HTML is served in.
 *
 * A status page's owner picks its default language (Status Page > Branding >
 * Languages). Both servers that render a status page - the standalone
 * status-page container and the combined App container - read it from the
 * API's /seo and serve the page's <html> in it, with the direction it is
 * read in: a Persian page arrives as <html lang="fa" dir="rtl">, so it is
 * laid out from the right from its first paint, before its app runs and
 * follows a visitor's own choice (Common/UI/Utils/PageLanguage). The
 * combined container used to drop the language on the way, and served every
 * page in English.
 *
 * Everything runs against both servers, through their real renderers
 * (PageServerHarness).
 */

jest.mock("Common/Server/Utils/StartServer", () => {
  return {
    __esModule: true,
    default: {
      init: jest.fn(),
      addDefaultRoutes: jest.fn(),
    },
  };
});

import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  getStatusPageLanguageHead,
  SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
} from "Common/Types/StatusPage/StatusPageLanguage";
import { getStatusPageData as getFrontendStatusPageData } from "../../FeatureSet/Frontend/Utils/StatusPage";
import { getStatusPageData as getStandaloneStatusPageData } from "../../FeatureSet/StatusPage/src/Server/Utils/StatusPage";
import {
  FakeResponse,
  PageRenderer,
  PageServers,
  SpiedApi,
  answerSeo,
  loadPageServers,
  pageRequest,
  spyOnApi,
} from "./PageServerHarness";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

const PAGE_ID: string = "5c000000-0000-4000-8000-000000000001";
const DOMAIN: string = "status.acme.example";

// What /seo answers for the page, in the default language given.
function seoInLanguage(
  defaultLanguage: string | null | undefined,
): HTTPResponse<JSONObject> {
  const body: JSONObject = {
    _id: PAGE_ID,
    title: "Acme Status",
    description: "How Acme is doing.",
    enableSearchEngineIndexing: true,
  };

  if (defaultLanguage !== undefined) {
    body["defaultLanguage"] = defaultLanguage;
  }

  return new HTTPResponse<JSONObject>(200, body, {});
}

let apiGet: SpiedApi;

function answerInLanguage(defaultLanguage: string | null | undefined): void {
  answerSeo(apiGet, {
    [PAGE_ID]: seoInLanguage(defaultLanguage),
    [DOMAIN]: seoInLanguage(defaultLanguage),
  });
}

function onCustomDomain(): ExpressRequest {
  return pageRequest({ host: DOMAIN, path: "/" });
}

function onPreviewUrl(): ExpressRequest {
  return pageRequest({
    host: "oneuptime.example",
    path: `/status-page/${PAGE_ID}`,
  });
}

beforeEach(() => {
  apiGet = spyOnApi("get");
  answerInLanguage(undefined);

  // A custom domain here is a status page's, not a public dashboard's.
  jest.spyOn(DashboardDomainService, "findOneBy").mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getStatusPageLanguageHead", () => {
  it("serves Persian right to left", () => {
    expect(getStatusPageLanguageHead("fa")).toEqual({
      lang: "fa",
      dir: "rtl",
    });
  });

  it("serves every other language a status page can show left to right", () => {
    for (const code of SUPPORTED_STATUS_PAGE_LANGUAGE_CODES) {
      if (code === "fa") {
        continue;
      }

      expect(getStatusPageLanguageHead(code)).toEqual({
        lang: code,
        dir: "ltr",
      });
    }
  });

  it.each([
    ["no default language", null],
    ["an unset one", undefined],
    ["an empty one", ""],
    ["one a status page cannot show", "xx"],
    ["a right-to-left one a status page cannot show yet", "ar"],
  ])(
    "serves %s in English, left to right",
    (_label: string, defaultLanguage: string | null | undefined) => {
      expect(getStatusPageLanguageHead(defaultLanguage)).toEqual({
        lang: "en",
        dir: "ltr",
      });
    },
  );
});

type GetStatusPageData = typeof getFrontendStatusPageData;

const IMPLEMENTATIONS: Array<[string, GetStatusPageData]> = [
  ["standalone status-page container", getStandaloneStatusPageData],
  ["combined App container", getFrontendStatusPageData],
];

describe.each(IMPLEMENTATIONS)(
  "getStatusPageData (%s)",
  (_name: string, getStatusPageData: GetStatusPageData) => {
    it("carries the page's default language", async () => {
      answerInLanguage("fa");

      await expect(getStatusPageData(onCustomDomain())).resolves.toMatchObject({
        defaultLanguage: "fa",
      });

      await expect(getStatusPageData(onPreviewUrl())).resolves.toMatchObject({
        defaultLanguage: "fa",
      });
    });

    it("carries none when the page has none", async () => {
      answerInLanguage(null);

      await expect(getStatusPageData(onCustomDomain())).resolves.toMatchObject({
        defaultLanguage: null,
      });
    });

    it("carries none from an API that does not send it", async () => {
      answerInLanguage(undefined);

      await expect(getStatusPageData(onCustomDomain())).resolves.toMatchObject({
        defaultLanguage: null,
      });
    });
  },
);

let servers: PageServers;

beforeAll(async () => {
  servers = await loadPageServers();
});

const SHELLS: Array<[string, () => PageRenderer, () => PageRenderer]> = [
  [
    "combined App container",
    () => {
      return servers.combined.statusPage;
    },
    () => {
      return servers.combined.customDomain;
    },
  ],
  [
    "standalone status-page container",
    () => {
      return servers.standalone.statusPage;
    },
    () => {
      return servers.standalone.statusPage;
    },
  ],
];

function languageOf(res: FakeResponse): { lang: unknown; dir: unknown } {
  return {
    lang: res.rendered?.variables["lang"],
    dir: res.rendered?.variables["dir"],
  };
}

describe.each(SHELLS)(
  "the status page shell in the %s",
  (
    _name: string,
    previewShell: () => PageRenderer,
    customDomainShell: () => PageRenderer,
  ) => {
    it("serves a Persian page right to left, on its domain and on its own URL", async () => {
      answerInLanguage("fa");

      expect(languageOf(await customDomainShell()(onCustomDomain()))).toEqual({
        lang: "fa",
        dir: "rtl",
      });
      expect(languageOf(await previewShell()(onPreviewUrl()))).toEqual({
        lang: "fa",
        dir: "rtl",
      });
    });

    it("serves a German page in German, left to right", async () => {
      answerInLanguage("de");

      expect(languageOf(await customDomainShell()(onCustomDomain()))).toEqual({
        lang: "de",
        dir: "ltr",
      });
    });

    it("serves a page with no default language in English, left to right", async () => {
      answerInLanguage(null);

      expect(languageOf(await customDomainShell()(onCustomDomain()))).toEqual({
        lang: "en",
        dir: "ltr",
      });
    });

    it("serves the placeholder in English, left to right, when the lookup fails", async () => {
      answerSeo(apiGet, {
        [PAGE_ID]: new HTTPErrorResponse(500, {}, {}),
        [DOMAIN]: new HTTPErrorResponse(500, {}, {}),
      });

      expect(languageOf(await previewShell()(onPreviewUrl()))).toEqual({
        lang: "en",
        dir: "ltr",
      });
    });
  },
);

describe("the status page's <html> tag", () => {
  const template: string = fs.readFileSync(
    path.join(__dirname, "../../FeatureSet/StatusPage/views/index.ejs"),
    "utf8",
  );

  // The tag alone: the rest of the template needs a whole page's variables.
  const htmlTag: string = ((): string => {
    const match: RegExpMatchArray | null = template.match(/<html[^\n]*>/);

    if (!match) {
      throw new Error("index.ejs has no <html> tag.");
    }

    return match[0];
  })();

  const renderTag: (variables: JSONObject) => string = (
    variables: JSONObject,
  ): string => {
    return ejs.render(htmlTag, {
      themeHead: { htmlClassName: "", setting: "light" },
      ...variables,
    });
  };

  it("says the page's language and the way it is read", () => {
    expect(renderTag({ lang: "fa", dir: "rtl" })).toContain(
      '<html lang="fa" dir="rtl"',
    );
    expect(renderTag({ lang: "de", dir: "ltr" })).toContain(
      '<html lang="de" dir="ltr"',
    );
  });

  it("reads left to right whenever it is not told right to left", () => {
    expect(renderTag({ lang: "en" })).toContain('<html lang="en" dir="ltr"');
    expect(renderTag({ lang: "en", dir: "" })).toContain('dir="ltr"');
    expect(renderTag({ lang: "en", dir: 'rtl" onload="x' })).toContain(
      'dir="ltr"',
    );
  });

  it("falls back to English with no language at all", () => {
    expect(renderTag({})).toContain('<html lang="en" dir="ltr"');
  });
});
