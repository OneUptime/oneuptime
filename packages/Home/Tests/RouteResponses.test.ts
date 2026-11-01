import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import HomeFeatureSet from "../Routes";
import { LegacyRedirect, LegacyRedirects } from "../Utils/LegacyRedirects";
import { DEMO_PAGE_PATH, DEMO_SHORT_PATHS } from "../Utils/DemoPage";
import {
  ResellerCard,
  ResellerRegionGroup,
  ResellersPageContent,
  getResellersPageContent,
} from "../Utils/Resellers";
import {
  CONTRIBUTORS_PER_PAGE,
  MAX_CONTRIBUTOR_PAGES,
} from "../Utils/GitHubContributors";
import {
  CloudMarketplacesContent,
  getCloudMarketplacesContent,
} from "../Utils/CloudMarketplaces";
import { SelfHostedContent } from "../Utils/SelfHosted";
import { OPEN_TELEMETRY_GUIDE_PAGES } from "../Utils/Integrations/OpenTelemetry/OpenTelemetryGuides";
import { getFeaturedOpenTelemetryGuides } from "Common/Types/Telemetry/OpenTelemetryGuides";

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
    // The addresses it names (InfrastructureAgentInstallScriptPath) as they are.
    ...jest.requireActual("../Utils/Config"),
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

/*
 * The Resellers page's form emails through it (API/ResellerInquiryAPI.ts);
 * the real one would load the whole database layer.
 */
jest.mock("Common/Server/Services/MailService", () => {
  return { __esModule: true, default: { sendMail: jest.fn() } };
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

// A request body, and the headers it is sent with.
interface Outgoing {
  headers: Record<string, string>;
  body: string;
}

interface BootedHome {
  renders: Array<RenderedView>;
  request: (
    method: string,
    url: string,
    outgoing?: Outgoing,
  ) => Promise<Answer>;
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

  const request: (
    method: string,
    url: string,
    send?: Outgoing,
  ) => Promise<Answer> = (
    method: string,
    url: string,
    send?: Outgoing,
  ): Promise<Answer> => {
    return new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
        const outgoing: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            method: method,
            path: url,
            headers: send ? send.headers : {},
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

        if (send) {
          outgoing.write(send.body);
        }

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
  // The demo page's (Utils/DemoPage.ts), oneuptime.com/demo first.
  ...DEMO_SHORT_PATHS.map((shortPath: string): [string, string] => {
    return [shortPath, DEMO_PAGE_PATH];
  }),
];

// Each <loc> of a sitemap.
const SITEMAP_LOC: RegExp = /<loc>([^<]*)<\/loc>/g;

// "/request-a-demo" as someone might type it: "/Request-A-Demo".
function capitalized(sitePath: string): string {
  return sitePath
    .split("/")
    .map((segment: string): string => {
      return segment
        .split("-")
        .map((word: string): string => {
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join("-");
    })
    .join("/");
}

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

  describe("the demo page, and the addresses people type for it", () => {
    /*
     * oneuptime.com/demo answered 404. It and the other addresses for the
     * demo page (Utils/DemoPage.ts) move permanently to /enterprise/demo,
     * matched the way every route is, carrying the campaign along.
     */
    function lastRender(): RenderedView {
      return home.renders[home.renders.length - 1]!;
    }

    test("oneuptime.com/demo answers a permanent 301 to the demo page", async () => {
      const answer: Answer = await home.request("GET", "/demo");

      expect([answer.status, answer.location]).toEqual([
        301,
        "/enterprise/demo",
      ]);
    });

    test.each(
      DEMO_SHORT_PATHS.map((shortPath: string): [string] => {
        return [shortPath];
      }),
    )(
      "%s moves to the page with or without a trailing slash, in any letter case",
      async (shortPath: string) => {
        for (const requested of [
          shortPath,
          `${shortPath}/`,
          shortPath.toUpperCase(),
          capitalized(shortPath),
        ]) {
          const answer: Answer = await home.request("GET", requested);

          expect([requested, answer.status, answer.location]).toEqual([
            requested,
            301,
            DEMO_PAGE_PATH,
          ]);
        }
      },
    );

    test("a campaign's query string arrives on the page byte for byte", async () => {
      /*
       * Percent-encoding, the order of the keys and a repeated key all kept:
       * the attribution capture on the page stores whatever bytes arrive.
       */
      const query: string =
        "utm_source=linkedin&utm_medium=social&utm_campaign=q4%20launch%20%2B%20demo&gclid=EAIaIQobChMI&utm_source=repeated";

      for (const requested of [
        `/demo?${query}`,
        `/demo/?${query}`,
        `/Book-A-Demo?${query}`,
        `/enterprise/request-demo?${query}`,
      ]) {
        const answer: Answer = await home.request("GET", requested);

        expect([requested, answer.status, answer.location]).toEqual([
          requested,
          301,
          `${DEMO_PAGE_PATH}?${query}`,
        ]);
      }
    });

    test("a bare question mark leaves no question mark behind", async () => {
      const answer: Answer = await home.request("GET", "/demo?");

      expect([answer.status, answer.location]).toEqual([301, DEMO_PAGE_PATH]);
    });

    test("HEAD is answered as GET is", async () => {
      const answer: Answer = await home.request("HEAD", "/demo?gclid=abc");

      expect([answer.status, answer.location]).toEqual([
        301,
        `${DEMO_PAGE_PATH}?gclid=abc`,
      ]);
    });

    test("one hop: the redirect points at the demo page itself, which names itself as canonical", async () => {
      const moved: Answer = await home.request("GET", "/demo?gclid=abc");
      const answer: Answer = await home.request("GET", moved.location!);

      expect([answer.status, answer.location]).toEqual([200, undefined]);
      expect(lastRender().view).toBe("demo.ejs");
      expect(lastRender().locals["seo"]).toMatchObject({
        canonicalPath: DEMO_PAGE_PATH,
        fullCanonicalUrl: "https://oneuptime.com/enterprise/demo",
      });
    });

    test.each([
      ["/enterprise/demo/"],
      ["/Enterprise/Demo"],
      ["/enterprise/demo?utm_source=x&gclid=abc"],
    ])(
      "%s is the page itself, naming the same canonical address",
      async (url: string) => {
        const answer: Answer = await home.request("GET", url);

        expect([url, answer.status, answer.location]).toEqual([
          url,
          200,
          undefined,
        ]);
        expect(lastRender().view).toBe("demo.ejs");
        expect(lastRender().locals["seo"]).toMatchObject({
          canonicalPath: DEMO_PAGE_PATH,
          fullCanonicalUrl: "https://oneuptime.com/enterprise/demo",
        });
      },
    );

    test("only the addresses themselves move: what is under or beside them is the not-found page", async () => {
      for (const url of [
        "/demo/extra",
        "/demos",
        "/demo-video",
        "/requestdemo",
        "/book-a-demo.html",
        "/enterprise/request-demo/now",
        "/enterprise/demo/extra",
        "/enterprise/demos",
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

    test("other methods are left alone", async () => {
      for (const method of ["POST", "PUT", "DELETE"]) {
        const answer: Answer = await home.request(method, "/demo");

        expect([method, answer.status, answer.location]).toEqual([
          method,
          404,
          undefined,
        ]);
      }
    });

    test("the pages sitemap lists the page once, and none of the addresses that lead to it", async () => {
      const answer: Answer = await home.request("GET", "/sitemap-pages.xml");
      const locs: Array<string> = Array.from(
        answer.body.matchAll(SITEMAP_LOC),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      expect(answer.status).toBe(200);
      expect(locs.length).toBeGreaterThan(50);
      expect(
        locs.filter((loc: string): boolean => {
          return loc === "https://oneuptime.com/enterprise/demo";
        }),
      ).toHaveLength(1);

      for (const shortPath of DEMO_SHORT_PATHS) {
        expect(locs).not.toContain(`https://oneuptime.com${shortPath}`);
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

    test("the infrastructure agent installer stays a temporary redirect, to the copy this host serves with its docs", async () => {
      const answer: Answer = await home.request(
        "GET",
        "/infrastructure-agent/install.sh",
      );

      expect(answer.status).toBe(302);
      expect(answer.location).toBe(
        "/docs/static/scripts/infrastructure-agent/install.sh",
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

  describe("the Resellers page", () => {
    function lastRender(): RenderedView {
      return home.renders[home.renders.length - 1]!;
    }

    test("/resellers renders its page with its SEO data and the resellers", async () => {
      const answer: Answer = await home.request("GET", "/resellers");

      expect(answer.status).toBe(200);
      expect(lastRender().view).toBe("resellers.ejs");
      expect(
        (lastRender().locals["seo"] as { canonicalPath: string }).canonicalPath,
      ).toBe("/resellers");

      const content: ResellersPageContent = lastRender().locals[
        "resellers"
      ] as ResellersPageContent;

      expect(content).toEqual(
        getResellersPageContent({
          inquiryInbox: content.form.fallbackEmail,
        }),
      );
      expect(
        content.regions.flatMap((group: ResellerRegionGroup) => {
          return group.resellers.map((card: ResellerCard) => {
            return card.name;
          });
        }),
      ).toContain("SLEXN");
      expect(content.form.endpoint).toBe("/resellers/contact");
    });

    test("/resellers.md lists the resellers for machines", async () => {
      const answer: Answer = await home.request("GET", "/resellers.md");

      expect(answer.status).toBe(200);
      expect(answer.contentType).toContain("text/markdown");
      expect(answer.body).toContain("# Resellers");
      expect(answer.body).toContain("[SLEXN](https://www.slexn.com)");
      expect(answer.body).toContain("## Become a reseller");
    });

    test("the form's address answers a post, as JSON", async () => {
      const answer: Answer = await home.request("POST", "/resellers/contact", {
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      // No body parser in this boot: the route reads no form, and says so.
      expect(answer.status).toBe(400);
      expect(answer.contentType).toContain("application/json");
      expect(JSON.parse(answer.body)).toMatchObject({ sent: false });
    });

    test("the form's address refuses another site's page", async () => {
      const answer: Answer = await home.request("POST", "/resellers/contact", {
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: "{}",
      });

      expect(answer.status).toBe(403);
      expect(JSON.parse(answer.body)).toMatchObject({ sent: false });
    });

    test("the form's address is no page: a GET is not found", async () => {
      const before: number = home.renders.length;
      const answer: Answer = await home.request("GET", "/resellers/contact");

      expect(answer.status).toBe(404);
      expect(
        home.renders.slice(before).map((r: RenderedView) => {
          return r.view;
        }),
      ).toEqual(["not-found.ejs"]);
    });
  });

  describe("the pages that name the cloud marketplaces", () => {
    function lastRender(): RenderedView {
      return home.renders[home.renders.length - 1]!;
    }

    test("/resellers renders the marketplaces' section from the list", async () => {
      const answer: Answer = await home.request("GET", "/resellers");

      expect(answer.status).toBe(200);
      expect(lastRender().view).toBe("resellers.ejs");
      expect(
        (lastRender().locals["resellers"] as ResellersPageContent)
          .cloudMarketplaces,
      ).toEqual(getCloudMarketplacesContent());
    });

    test("/pricing renders its plans with OneUptime Cloud's marketplace listings", async () => {
      const answer: Answer = await home.request("GET", "/pricing");

      expect(answer.status).toBe(200);
      expect(lastRender().view).toBe("pricing.ejs");

      const content: CloudMarketplacesContent = lastRender().locals[
        "cloudMarketplaces"
      ] as CloudMarketplacesContent;

      expect(content).toEqual(getCloudMarketplacesContent());
      expect(content.publicListings.cloud.length).toBeGreaterThan(0);
    });

    test("/enterprise/self-hosted renders with OneUptime Enterprise's marketplace listings", async () => {
      const answer: Answer = await home.request(
        "GET",
        "/enterprise/self-hosted",
      );

      expect(answer.status).toBe(200);
      expect(lastRender().view).toBe("self-hosted.ejs");
      expect(
        (lastRender().locals["selfHosted"] as SelfHostedContent)
          .cloudMarketplaces,
      ).toEqual(getCloudMarketplacesContent());
    });

    test("/resellers.md lists the marketplaces and their listings for machines", async () => {
      const answer: Answer = await home.request("GET", "/resellers.md");

      expect(answer.status).toBe(200);
      expect(answer.body).toContain("## Buy through your cloud marketplace");
      expect(answer.body).toContain(
        "  - [OneUptime Cloud](https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw): Hosted by OneUptime",
      );
      expect(answer.body).toContain("- Google Cloud Marketplace: coming soon");
      // After the resellers, before how to become one.
      expect(answer.body.indexOf("## Resellers by region")).toBeLessThan(
        answer.body.indexOf("## Buy through your cloud marketplace"),
      );
      expect(
        answer.body.indexOf("## Buy through your cloud marketplace"),
      ).toBeLessThan(answer.body.indexOf("## Become a reseller"));
    });

    test("/pricing.md names OneUptime Cloud's listings for machines", async () => {
      const answer: Answer = await home.request("GET", "/pricing.md");

      expect(answer.status).toBe(200);
      expect(answer.body).toContain(
        "Prefer to pay on your cloud bill? Buy OneUptime Cloud on [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw) or [Microsoft Marketplace](https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-cloud), at the same prices. Every marketplace: https://oneuptime.com/resellers#cloud-marketplaces",
      );
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

  describe("the integrations", () => {
    function lastRender(): RenderedView {
      return home.renders[home.renders.length - 1]!;
    }

    test("/integrations renders the index of every guide, with its SEO entry", async () => {
      const answer: Answer = await home.request("GET", "/integrations");

      expect(answer.status).toBe(200);
      expect(lastRender().view).toBe("integrations/index.ejs");
      expect(
        (lastRender().locals["seo"] as { canonicalPath: string }).canonicalPath,
      ).toBe("/integrations");
      expect(
        (lastRender().locals["integrations"] as { guideCount: number })
          .guideCount,
      ).toBe(OPEN_TELEMETRY_GUIDE_PAGES.length);
      expect(lastRender().locals["integrationsScript"]).toMatch(
        /^\/js\/integrations\.js\?v=/,
      );
    });

    test.each(
      OPEN_TELEMETRY_GUIDE_PAGES.map((guide: { slug: string }): [string] => {
        return [guide.slug];
      }),
    )(
      "/integrations/opentelemetry/%s renders its guide",
      async (slug: string) => {
        const answer: Answer = await home.request(
          "GET",
          `/integrations/opentelemetry/${slug}`,
        );

        expect(answer.status).toBe(200);
        expect(lastRender().view).toBe("integrations/opentelemetry-guide.ejs");
        expect((lastRender().locals["guide"] as { slug: string }).slug).toBe(
          slug,
        );
        expect(
          (lastRender().locals["seo"] as { canonicalPath: string })
            .canonicalPath,
        ).toBe(`/integrations/opentelemetry/${slug}`);
      },
    );

    test("every page is handed the featured guides' cards, for the product pages' strip", async () => {
      const answer: Answer = await home.request("GET", "/product/traces");

      expect(answer.status).toBe(200);
      expect(
        (lastRender().locals["frameworkGuides"] as Array<{ href: string }>).map(
          (card: { href: string }): string => {
            return card.href;
          },
        ),
      ).toEqual(
        getFeaturedOpenTelemetryGuides().map(
          (guide: { slug: string }): string => {
            return `/integrations/opentelemetry/${guide.slug}`;
          },
        ),
      );
    });

    test("a framework the catalog does not know is the not-found page", async () => {
      const before: number = home.renders.length;
      const answer: Answer = await home.request(
        "GET",
        "/integrations/opentelemetry/cobol",
      );

      expect(answer.status).toBe(404);
      expect(
        home.renders.slice(before).map((r: RenderedView) => {
          return r.view;
        }),
      ).toEqual(["not-found.ejs"]);
    });

    test("/integrations/opentelemetry answers 301 to the index, keeping the query", async () => {
      const answer: Answer = await home.request(
        "GET",
        "/integrations/opentelemetry?utm_source=x",
      );

      expect(answer.status).toBe(301);
      expect(answer.location).toBe("/integrations?utm_source=x");
    });

    test("each guide and the index have a Markdown copy, kept out of search", async () => {
      for (const [url, heading] of [
        ["/integrations.md", "# OpenTelemetry integrations"],
        [
          "/integrations/opentelemetry/fastify.md",
          "# OpenTelemetry for Fastify",
        ],
      ] as Array<[string, string]>) {
        const answer: Answer = await home.request("GET", url);

        expect([url, answer.status, answer.contentType]).toEqual([
          url,
          200,
          "text/markdown; charset=utf-8",
        ]);
        expect(answer.body.startsWith(`${heading}\n`)).toBe(true);
      }

      const missing: Answer = await home.request(
        "GET",
        "/integrations/opentelemetry/cobol.md",
      );
      expect(missing.status).toBe(404);
    });

    test("/sitemap-integrations.xml lists the index's guides", async () => {
      const answer: Answer = await home.request(
        "GET",
        "/sitemap-integrations.xml",
      );

      expect(answer.status).toBe(200);
      for (const guide of OPEN_TELEMETRY_GUIDE_PAGES) {
        expect(answer.body).toContain(
          `<loc>https://oneuptime.com/integrations/opentelemetry/${guide.slug}</loc>`,
        );
      }
    });

    test("serves the logos the guides show, and nothing else from their folder", async () => {
      for (const name of ["react", "express", "nextjs", "koa"]) {
        const logo: Answer = await home.request(
          "GET",
          `/img/provider-logos/${name}.svg`,
        );

        expect([name, logo.status]).toEqual([name, 200]);
        expect(logo.contentType).toContain("image/svg+xml");
        expect(logo.body).toContain("<svg");
      }

      for (const url of [
        "/img/provider-logos/no-such-logo.svg",
        "/img/provider-logos/..%2F..%2Fpackage.json.svg",
      ]) {
        const answer: Answer = await home.request("GET", url);
        expect([url, answer.status]).toEqual([url, 404]);
      }
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
