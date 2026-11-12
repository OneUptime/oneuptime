import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import { DocsSearchAnswer } from "../../../FeatureSet/Docs/Utils/DocsSearch";
import Express, {
  ExpressApplication,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import type * as Path from "path";
import type * as FileSystem from "fs";

/*
 * DOCS SEARCH AND "WAS THIS PAGE HELPFUL?", THROUGH THE DOCS' REAL ROUTES
 * (issue #6822), without the database-backed application:
 *
 *   - /docs/search/<lang>.json?q= answers the search box and Search
 *     (Cmd/Ctrl+K) in the reader's language, small and cacheable, and is no
 *     old page address to redirect;
 *   - every page ends with "Was this page helpful?": on a self-hosted
 *     server it posts nothing and a no offers the GitHub issue, already
 *     written; where product analytics is set up it posts to /docs/feedback,
 *     which sends docs/feedback_given on and nothing else.
 */

const mockConfig: { AnalyticsKey: string; AnalyticsHost: string } = {
  AnalyticsKey: "",
  AnalyticsHost: "",
};
const mockPost: Mock = jest.fn();

jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    ContentPath: path.join(root, "Content"),
    StaticPath: path.join(root, "Static"),
    ViewsPath: path.join(root, "Views"),
  };
});
jest.mock("Common/Server/Utils/LocalFile", () => {
  const fs: typeof FileSystem = jest.requireActual("fs") as typeof FileSystem;
  return {
    __esModule: true,
    default: {
      doesFileExist: async (file: string): Promise<boolean> => {
        return fs.existsSync(file);
      },
      read: (file: string): Promise<string> => {
        return fs.promises.readFile(file, "utf8");
      },
    },
  };
});
jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendMarkdownResponse: (
        _req: unknown,
        res: ExpressResponse,
        content: string,
      ): ExpressResponse => {
        return res.type("text/markdown").send(content);
      },
    },
  };
});
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn() },
  };
});
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    GoogleTagManagerEnabled: false,
    IsBillingEnabled: true,
    IsEnterpriseEdition: false,
    get AnalyticsKey(): string {
      return mockConfig.AnalyticsKey;
    },
    get AnalyticsHost(): string {
      return mockConfig.AnalyticsHost;
    },
  };
});
jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
    },
  };
});
jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _name: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/LlmsTxt", () => {
  return {
    __esModule: true,
    default: {},
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/Placeholders", () => {
  return {
    __esModule: true,
    default: {
      render: (content: string): string => {
        return content;
      },
    },
  };
});

let server: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();
  app.set("view engine", "ejs");
  await DocsFeatureSet.init();
  server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120000);

afterAll(async () => {
  if (!server) {
    return;
  }
  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.close((error?: Error) => {
        return error ? reject(error) : resolve();
      });
    },
  );
});

beforeEach(() => {
  mockConfig.AnalyticsKey = "";
  mockConfig.AnalyticsHost = "";
  mockPost.mockReset();
  mockPost.mockImplementation(async () => {
    return new HTTPResponse(200, {}, {});
  });
});

const searchFor: (
  lang: string,
  query: string,
  extra?: string,
) => Promise<{
  status: number;
  answer: DocsSearchAnswer;
  cache: string;
}> = async (
  lang: string,
  query: string,
  extra?: string,
): Promise<{ status: number; answer: DocsSearchAnswer; cache: string }> => {
  const response: Response = await fetch(
    `${origin}/docs/search/${lang}.json?q=${encodeURIComponent(query)}${extra || ""}`,
  );
  return {
    status: response.status,
    answer: (await response.json()) as DocsSearchAnswer,
    cache: response.headers.get("cache-control") || "",
  };
};

const postFeedback: (body: unknown) => Promise<number> = async (
  body: unknown,
): Promise<number> => {
  const response: Response = await fetch(`${origin}/docs/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.status;
};

const pageHtml: (pathname: string) => Promise<string> = async (
  pathname: string,
): Promise<string> => {
  const response: Response = await fetch(`${origin}${pathname}`);
  expect(response.status).toBe(200);
  return response.text();
};

describe("/docs/search/<lang>.json", () => {
  it("answers what was typed, forgiving a typo, with the section and a line of it", async () => {
    const { status, answer, cache } = await searchFor("en", "escalaton");

    expect(status).toBe(200);
    expect(cache).toContain("max-age");
    expect(answer.query).toBe("escalaton");
    expect(answer.results[0]!.url).toMatch(
      /^\/docs\/en\/on-call\/escalation-rules/,
    );
    expect(answer.results[0]!.snippet.length).toBeGreaterThan(0);
    expect(answer.words).toContain("escalation");
  }, 600000);

  it("answers in the reader's language", async () => {
    const { answer } = await searchFor("de", "pager");

    expect(answer.results.length).toBeGreaterThan(0);
    for (const result of answer.results) {
      expect(result.url.startsWith("/docs/de/")).toBe(true);
    }
  }, 600000);

  it("keeps to the limit asked, and to thirty", async () => {
    expect(
      (await searchFor("en", "monitor", "&limit=3")).answer.results,
    ).toHaveLength(3);
    expect(
      (await searchFor("en", "monitor", "&limit=1000")).answer.results.length,
    ).toBeLessThanOrEqual(30);
    expect(
      (await searchFor("en", "monitor", "&limit=nonsense")).answer.results
        .length,
    ).toBeGreaterThan(3);
  }, 600000);

  it("answers nothing for nothing typed, and is not found for a language the docs do not have", async () => {
    expect(await searchFor("en", "  ")).toEqual(
      expect.objectContaining({
        status: 200,
        answer: { query: "", results: [], words: [] },
      }),
    );
    expect((await searchFor("xx", "monitor")).status).toBe(404);
  }, 600000);

  it("is an endpoint, never an old page address to redirect", async () => {
    const response: Response = await fetch(`${origin}/docs/search/en`, {
      redirect: "manual",
    });

    expect(response.status).not.toBe(301);
    expect(response.headers.get("location") || "").not.toMatch(
      /^\/docs\/en\/search/,
    );
  }, 600000);
});

describe("Was this page helpful?, on a self-hosted server", () => {
  it("ends the page, asks in the reader's language, and sends nothing", async () => {
    const html: string = await pageHtml("/docs/de/monitor/website-monitor");

    expect(html).toContain("data-docs-feedback");
    expect(html).toContain('data-feedback-mode="local"');
    expect(html).toContain('data-feedback-page="monitor/website-monitor"');
    expect(html).toContain('data-feedback-language="de"');
    expect(html).toContain("War diese Seite hilfreich?");
    // No reasons to click: nothing would carry them anywhere.
    expect(html).not.toContain("data-feedback-reason=");
    // "Tell us on GitHub", the page's name filled in.
    expect(html).toContain("Auf GitHub mitteilen");
    expect(html).toContain(
      "https://github.com/OneUptime/oneuptime/issues/new?labels=documentation&amp;title=Docs%3A%20Website%20Monitor",
    );
    // Before the pager and the edit card, after the page.
    expect(html.indexOf("data-docs-feedback")).toBeGreaterThan(
      html.indexOf('id="docs-content"'),
    );
    expect(html.indexOf("data-docs-feedback")).toBeLessThan(
      html.indexOf("docs-editcard"),
    );
  }, 600000);

  it("drops an answer posted anyway, and never sends it", async () => {
    expect(
      await postFeedback({
        page: "monitor/website-monitor",
        isHelpful: true,
        language: "en",
      }),
    ).toBe(204);
    expect(mockPost).not.toHaveBeenCalled();
  }, 600000);
});

describe("Was this page helpful?, where product analytics is set up", () => {
  beforeEach(() => {
    mockConfig.AnalyticsKey = "phc_key";
    mockConfig.AnalyticsHost = "https://analytics.example.com";
  });

  it("offers what went wrong in four clicks after a no", async () => {
    const html: string = await pageHtml("/docs/en/monitor/website-monitor");

    expect(html).toContain('data-feedback-mode="send"');
    for (const reason of ["unclear", "missing", "wrong", "not_found"]) {
      expect(html).toContain(`data-feedback-reason="${reason}"`);
    }
    expect(html).toContain("Not what I was looking for");
  }, 600000);

  it("sends an answer on as docs/feedback_given", async () => {
    expect(
      await postFeedback({
        page: "monitor/website-monitor",
        isHelpful: false,
        reason: "wrong",
        language: "fr",
      }),
    ).toBe(204);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(
      (
        mockPost.mock.calls[0]![0] as {
          data: { event: string; properties: unknown };
        }
      ).data,
    ).toEqual(
      expect.objectContaining({
        event: "docs/feedback_given",
        properties: expect.objectContaining({
          page: "monitor/website-monitor",
          is_helpful: false,
          reason: "wrong",
          language: "fr",
        }),
      }),
    );
  }, 600000);

  it("refuses anything that is not an answer, and sends nothing for it", async () => {
    expect(await postFeedback({ page: "nope/nope", isHelpful: true })).toBe(
      400,
    );
    expect(
      await postFeedback({
        page: "monitor/website-monitor",
        isHelpful: false,
        reason: "Your docs are bad and here is my email",
      }),
    ).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  }, 600000);
});
