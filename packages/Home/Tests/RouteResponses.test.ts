import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import HomeFeatureSet from "../Routes";
import { LegacyRedirect, LegacyRedirects } from "../Utils/LegacyRedirects";
import {
  CONTRIBUTORS_PER_PAGE,
  MAX_CONTRIBUTOR_PAGES,
} from "../Utils/GitHubContributors";

/*
 * THE ROUTE TABLE, ANSWERING REAL REQUESTS.
 *
 * Routes.test.ts and Redirect.test.ts read Routes.ts as text, because booting
 * the whole Home server drags in its database, the blog's git checkout and
 * jobs that call GitHub. Here those are stubbed instead, and the real route
 * table is registered on a real Express app and asked over HTTP: what status
 * each address answers, exactly where it points, and which template a page
 * renders. Templates are not rendered - the view engine is a stand-in that
 * records what it was handed - but Express still has to find each template
 * file on disk, so a page whose template is missing answers 500 here.
 */

jest.setTimeout(120 * 1000);

jest.mock("Common/Server/Utils/Express", () => {
  const actual: {
    createExpressApp: () => unknown;
    ExpressStatic: unknown;
  } = jest.requireActual("Common/Server/Utils/Express");
  const mockState: { app: unknown } = { app: actual.createExpressApp() };

  return {
    __esModule: true,
    ExpressStatic: actual.ExpressStatic,
    createExpressApp: actual.createExpressApp,
    mockState: mockState,
    default: {
      getExpressApp: (): unknown => {
        return mockState.app;
      },
    },
  };
});

// Views and static files from this checkout rather than the image's paths.
jest.mock("../Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path");
  const homeFolder: string = nodePath.join(__dirname, "..");

  return {
    __esModule: true,
    ViewsPath: nodePath.join(homeFolder, "Views"),
    StaticPath: nodePath.join(homeFolder, "Static"),
    BlogRootPath: nodePath.join(homeFolder, "no-blog-checkout"),
    InstallScriptPath: nodePath.join(homeFolder, "Scripts", "Install.sh"),
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHomeUrl: async (): Promise<{ toString: () => string }> => {
        return {
          toString: (): string => {
            return "https://oneuptime.com/";
          },
        };
      },
    },
  };
});

// The jobs Routes.ts imports register crons that would call GitHub and git.
jest.mock("Common/Server/Utils/BasicCron", () => {
  return { __esModule: true, default: (): void => {} };
});

jest.mock("../Jobs/UpdateBlog", () => {
  return {};
});

jest.mock("../Utils/BlogPost", () => {
  return {
    __esModule: true,
    default: {
      getBlogPost: jest.fn().mockResolvedValue(null),
      getBlogPostList: jest.fn().mockResolvedValue([]),
      getTags: jest.fn().mockResolvedValue([]),
      getValidationSummaryHtml: jest.fn().mockResolvedValue(null),
      getHomeUrl: jest.fn().mockResolvedValue({
        toString: (): string => {
          return "https://oneuptime.com/";
        },
      }),
    },
  };
});

// BlogAPI serves files and HTML through it; none of that is asked for here.
jest.mock("Common/Server/Utils/Response", () => {
  return { __esModule: true, default: {} };
});

type GitHubAnswer = HTTPResponse<Array<JSONObject>> | HTTPErrorResponse | Error;

// What GitHub answers the Nth request (1-based) of the current test.
let mockGitHubAnswer: (requestNumber: number) => GitHubAnswer = () => {
  return new Error("No answer was set up for this request.");
};
let mockGitHubRequests: number = 0;

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      get: async (): Promise<
        HTTPResponse<Array<JSONObject>> | HTTPErrorResponse
      > => {
        mockGitHubRequests++;

        // A walk that never stops is the bug: fail it instead of spinning.
        if (mockGitHubRequests > 1000) {
          throw new Error("The about page never stopped asking GitHub.");
        }

        await new Promise<void>((resolve: () => void) => {
          setImmediate(resolve);
        });

        const answer: GitHubAnswer = mockGitHubAnswer(mockGitHubRequests);

        if (answer instanceof Error) {
          throw answer;
        }

        return answer;
      },
    },
  };
});

interface RenderedView {
  view: string;
  locals: Record<string, unknown>;
}

interface Answer {
  status: number;
  location: string | undefined;
  contentType: string;
  body: string;
}

interface BootedHome {
  renders: Array<RenderedView>;
  request: (method: string, url: string) => Promise<Answer>;
  close: () => Promise<void>;
}

const VIEWS_FOLDER: string = path.join(__dirname, "..", "Views");

const expressState: { app: ExpressApplication } = (
  jest.requireMock("Common/Server/Utils/Express") as {
    mockState: { app: ExpressApplication };
  }
).mockState;

const createExpressApp: () => ExpressApplication = (
  jest.requireMock("Common/Server/Utils/Express") as {
    createExpressApp: () => ExpressApplication;
  }
).createExpressApp;

/*
 * Register the route table on `app` and serve it on a free local port. The
 * first boot uses the app BlogAPI registered its routes on when Routes.ts
 * imported it; a later boot gets a fresh app, and with it a fresh /about
 * cache.
 */
async function bootHome(app: ExpressApplication): Promise<BootedHome> {
  const renders: Array<RenderedView> = [];

  expressState.app = app;
  expect(Express.getExpressApp()).toBe(app);

  app.set("view engine", "ejs");
  app.engine(
    "ejs",
    (
      filePath: string,
      options: unknown,
      callback: (error: Error | null, html?: string) => void,
    ): void => {
      renders.push({
        view: path.relative(VIEWS_FOLDER, filePath),
        locals: options as Record<string, unknown>,
      });
      callback(null, `<html>${path.basename(filePath)}</html>`);
    },
  );

  await HomeFeatureSet.init();

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (server.address() as AddressInfo).port;

  const request: (method: string, url: string) => Promise<Answer> = (
    method: string,
    url: string,
  ): Promise<Answer> => {
    return new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
        const outgoing: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            method: method,
            path: url,
            agent: false,
          },
          (response: http.IncomingMessage) => {
            let body: string = "";

            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              body += chunk;
            });
            response.on("end", () => {
              resolve({
                status: response.statusCode || 0,
                location: response.headers["location"],
                contentType: String(response.headers["content-type"] || ""),
                body: body,
              });
            });
          },
        );

        outgoing.setTimeout(60 * 1000, () => {
          outgoing.destroy(new Error(`${method} ${url} got no answer`));
        });
        outgoing.on("error", reject);
        outgoing.end();
      },
    );
  };

  return {
    renders: renders,
    request: request,
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function contributor(index: number): JSONObject {
  return { login: `contributor-${index}`, contributions: 500 - index };
}

function pageOf(entries: Array<unknown>): HTTPResponse<Array<JSONObject>> {
  const response: HTTPResponse<Array<JSONObject>> = new HTTPResponse<
    Array<JSONObject>
  >(200, [], {});

  response.data = entries as Array<JSONObject>;

  return response;
}

function fullPage(page: number): HTTPResponse<Array<JSONObject>> {
  return pageOf(
    Array.from({ length: CONTRIBUTORS_PER_PAGE }, (_: unknown, i: number) => {
      return contributor((page - 1) * CONTRIBUTORS_PER_PAGE + i);
    }),
  );
}

function rateLimited(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    403,
    {
      message: "API rate limit exceeded for 203.0.113.7.",
      documentation_url:
        "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
    },
    {},
  );
}

// The short addresses Routes.ts itself keeps, and where each points.
const ALIASES: Array<[string, string]> = [
  ["/status-page", "/product/status-page"],
  ["/logs-management", "/product/logs-management"],
  ["/workflows", "/product/workflows"],
  ["/runbooks", "/product/runbooks"],
  ["/on-call", "/product/on-call"],
  ["/scheduled-maintenance", "/product/scheduled-maintenance"],
  ["/incident-management", "/product/incident-management"],
  ["/ai-agent", "/product/ai-agent"],
  ["/self-hosted", "/enterprise/self-hosted"],
  ["/self-hosting", "/enterprise/self-hosted"],
  ["/on-premise", "/enterprise/self-hosted"],
  ["/security", "/trust"],
  ["/security-center", "/trust"],
  ["/trust-center", "/trust"],
];

const LEGACY: Array<[string, string]> = [
  ...LegacyRedirects.map((redirect: LegacyRedirect): [string, string] => {
    return [redirect.from, redirect.to];
  }),
  ["/enterprise/download-resource/soc-2-report", "/enterprise/overview"],
  ["/enterprise/download-resource", "/enterprise/overview"],
];

describe("the route table over HTTP", () => {
  let home: BootedHome;

  beforeAll(async () => {
    // The app BlogAPI registered on, so the blog's routes are served too.
    home = await bootHome(expressState.app);
  });

  afterAll(async () => {
    await home.close();
  });

  describe("addresses earlier versions of the site published", () => {
    test.each(LEGACY)(
      "%s answers 301 to %s",
      async (from: string, to: string) => {
        const answer: Answer = await home.request("GET", from);

        expect([from, answer.status, answer.location]).toEqual([from, 301, to]);
      },
    );

    test("keep the query a paid click carries", async () => {
      const answer: Answer = await home.request(
        "GET",
        "/product/api-monitoring?gclid=EAIaIQobChMI&utm_source=google&utm_campaign=a%20b",
      );

      expect(answer.status).toBe(301);
      expect(answer.location).toBe(
        "/product/monitoring?gclid=EAIaIQobChMI&utm_source=google&utm_campaign=a%20b",
      );
    });

    test("are matched whatever their letter case, with one trailing slash", async () => {
      for (const [from, to] of [
        ["/Product/Public-StatusPage", "/product/status-page"],
        ["/product/private-statuspage", "/product/status-page"],
        ["/Customers/", "/"],
        ["/RSS", "/blog/rss.xml"],
      ] as Array<[string, string]>) {
        const answer: Answer = await home.request("GET", from);

        expect([from, answer.status, answer.location]).toEqual([from, 301, to]);
      }
    });

    test("answer HEAD as they answer GET", async () => {
      const answer: Answer = await home.request("HEAD", "/files/soc-3.pdf");

      expect(answer.status).toBe(301);
      expect(answer.location).toBe("/legal/soc-3");
    });

    test("leave other methods alone", async () => {
      const answer: Answer = await home.request("POST", "/customers");

      expect(answer.status).toBe(404);
      expect(answer.location).toBeUndefined();
    });

    test("leave every other address to the not-found page", async () => {
      for (const url of [
        "/table/datadog",
        "/product/api-monitoring/extra",
        "/enterprise/download-resources",
        "/files/soc-2.pdf",
        "/pricing-2",
        "/no-such-page",
      ]) {
        const before: number = home.renders.length;
        const answer: Answer = await home.request("GET", url);

        expect([url, answer.status, answer.location]).toEqual([
          url,
          404,
          undefined,
        ]);
        expect(
          home.renders.slice(before).map((r: RenderedView) => {
            return r.view;
          }),
        ).toEqual(["not-found.ejs"]);
      }
    });
  });

  describe("the site's own short addresses", () => {
    test.each(ALIASES)(
      "%s answers a permanent 301 to %s",
      async (from: string, to: string) => {
        const answer: Answer = await home.request("GET", `${from}?gclid=abc`);

        expect([from, answer.status, answer.location]).toEqual([
          from,
          301,
          `${to}?gclid=abc`,
        ]);
      },
    );

    test("an old blog post address moves permanently to the post", async () => {
      const answer: Answer = await home.request(
        "GET",
        "/blog/post/2026-03-02-how-to-install-google-chrome-on-ubuntu?utm_source=x",
      );

      expect(answer.status).toBe(301);
      expect(answer.location).toBe(
        "/blog/post/2026-03-02-how-to-install-google-chrome-on-ubuntu/view?utm_source=x",
      );
    });

    test("the infrastructure agent installer stays a temporary redirect to GitHub", async () => {
      const answer: Answer = await home.request(
        "GET",
        "/infrastructure-agent/install.sh",
      );

      expect(answer.status).toBe(302);
      expect(answer.location).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/OneUptime\/oneuptime\/release\//,
      );
    });
  });

  describe("every page a redirect points at", () => {
    const targets: Array<string> = Array.from(
      new Set([
        ...LEGACY.map(([, to]: [string, string]): string => {
          return to;
        }),
        ...ALIASES.map(([, to]: [string, string]): string => {
          return to;
        }),
      ]),
    );

    test.each(
      targets.map((target: string): [string] => {
        return [target];
      }),
    )("%s answers 200 itself", async (target: string) => {
      const answer: Answer = await home.request("GET", target);

      expect([target, answer.status, answer.location]).toEqual([
        target,
        200,
        undefined,
      ]);
    });

    test("the RSS feed the old /rss address points at is a feed", async () => {
      const answer: Answer = await home.request("GET", "/blog/rss.xml");

      expect(answer.contentType).toContain("application/rss+xml");
      expect(answer.body).toContain("<rss");
    });
  });

  describe("the routes that were registered twice", () => {
    function lastRender(): RenderedView {
      return home.renders[home.renders.length - 1]!;
    }

    test("/product/status-page renders its page with its SEO data", async () => {
      const answer: Answer = await home.request("GET", "/product/status-page");

      expect(answer.status).toBe(200);
      expect(lastRender().view).toBe("status-page.ejs");
      expect(
        (lastRender().locals["seo"] as { canonicalPath: string }).canonicalPath,
      ).toBe("/product/status-page");
      // What only the dead copy passed never reaches the page.
      expect(lastRender().locals["footerCtaText"]).toBeUndefined();
    });

    test.each([["iso-27017"], ["iso-27018"]])(
      "/legal/%s renders its own section of the legal center",
      async (section: string) => {
        const answer: Answer = await home.request("GET", `/legal/${section}`);

        expect(answer.status).toBe(200);
        expect(lastRender().view).toBe("legal.ejs");
        expect(lastRender().locals["section"]).toBe(section);
      },
    );

    test("/status-page still answers with its redirect", async () => {
      const answer: Answer = await home.request("GET", "/status-page");

      expect(answer.status).toBe(301);
      expect(answer.location).toBe("/product/status-page");
    });
  });
});

describe("/about while GitHub misbehaves", () => {
  let home: BootedHome;
  let quietWarnings: jest.SpyInstance;

  beforeEach(async () => {
    // A fresh app per test, and with it an empty contributor cache.
    mockGitHubRequests = 0;
    home = await bootHome(createExpressApp());
    // Each refusal is logged; GitHubContributors.test.ts asserts on that.
    quietWarnings = jest
      .spyOn(console, "warn")
      .mockImplementation((): void => {});
  });

  afterEach(async () => {
    quietWarnings.mockRestore();
    await home.close();
  });

  async function visitAbout(): Promise<Array<JSONObject>> {
    const answer: Answer = await home.request("GET", "/about");
    const render: RenderedView = home.renders[home.renders.length - 1]!;

    expect(answer.status).toBe(200);
    expect(render.view).toBe("about.ejs");

    return render.locals["contributors"] as Array<JSONObject>;
  }

  test("a rate-limit error object renders the page without contributors, after one request", async () => {
    mockGitHubAnswer = (): GitHubAnswer => {
      return rateLimited();
    };

    await expect(visitAbout()).resolves.toEqual([]);
    expect(mockGitHubRequests).toBe(1);
  });

  test("an answer that is not a list renders the page without contributors", async () => {
    mockGitHubAnswer = (): GitHubAnswer => {
      return pageOf({ message: "Not Found" } as unknown as Array<unknown>);
    };

    await expect(visitAbout()).resolves.toEqual([]);
    expect(mockGitHubRequests).toBe(1);
  });

  test("a request that fails renders the page with the contributors already read", async () => {
    mockGitHubAnswer = (requestNumber: number): GitHubAnswer => {
      return requestNumber === 1
        ? fullPage(1)
        : new Error("Request failed to api.github.com. Connection timed out");
    };

    const contributors: Array<JSONObject> = await visitAbout();

    expect(contributors).toHaveLength(CONTRIBUTORS_PER_PAGE);
    expect(mockGitHubRequests).toBe(2);
  });

  test(`full pages without end stop after ${MAX_CONTRIBUTOR_PAGES} requests`, async () => {
    mockGitHubAnswer = (requestNumber: number): GitHubAnswer => {
      return fullPage(requestNumber);
    };

    const contributors: Array<JSONObject> = await visitAbout();

    expect(mockGitHubRequests).toBe(MAX_CONTRIBUTOR_PAGES);
    expect(contributors).toHaveLength(
      MAX_CONTRIBUTOR_PAGES * CONTRIBUTORS_PER_PAGE,
    );
  });

  test("a refused visit asks again next time, and a list that arrived is kept", async () => {
    mockGitHubAnswer = (requestNumber: number): GitHubAnswer => {
      return requestNumber === 1
        ? rateLimited()
        : pageOf([contributor(1), contributor(2)]);
    };

    await expect(visitAbout()).resolves.toEqual([]);
    await expect(visitAbout()).resolves.toEqual([
      contributor(1),
      contributor(2),
    ]);
    await expect(visitAbout()).resolves.toEqual([
      contributor(1),
      contributor(2),
    ]);
    expect(mockGitHubRequests).toBe(2);
  });
});
