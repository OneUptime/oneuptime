/**
 * The servers that render a public page ask the App's own API what the page
 * is - at the App's internal address, not out through the public one.
 *
 * Before a status page's HTML is sent, its server reads the page's title,
 * description, search engine indexing and theme from the status page API's
 * /seo, so a dark page is sent dark - and a page that follows each visitor's
 * device is sent as one - before any script runs. A public dashboard's server
 * reads its title and description the same way.
 *
 * They used to ask at the public address, HTTP_PROTOCOL + HOST, out through
 * Nginx and back in. On the e2e stack HOST is localhost, which inside the App
 * container is the container itself, where nothing listens on port 80: every
 * lookup failed, and every status page was sent as the placeholder - the
 * light page, titled "Status Page", with the zero id's favicon - whatever its
 * own theme. StatusPagePublic.spec.ts caught it: a page made to follow each
 * visitor's device was sent with data-status-page-theme="light", and stayed
 * light after its owner turned it Dark. A self-hosted install whose App cannot
 * reach its own public address - HOST=localhost, split DNS, egress rules, a
 * self-signed certificate - had the same pages.
 *
 * Here the App's API is a real HTTP server at the internal address
 * (SERVER_APP_HOSTNAME:APP_PORT), running the real status page API router over
 * a stubbed data layer, and the public address is a port nothing listens on.
 * The page servers' real routes render each page (PageServerHarness), and the
 * real index.ejs draws the status page's HTML from what they hand it.
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

import type {
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import type { JSONObject } from "Common/Types/JSON";
import type StatusPageTheme from "Common/Types/StatusPage/StatusPageTheme";
import type { FakeResponse, PageServers } from "./PageServerHarness";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import http from "http";
import net, { AddressInfo } from "net";
import path from "path";

const PAGE_ID: string = "5e000000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "5e000000-0000-4000-8000-0000000000a1";
const DOMAIN: string = "status.acme.example";
const PAGE_TITLE: string = "Acme Status";

const DASHBOARD_ID: string = "da5e0000-0000-4000-8000-000000000001";
const DASHBOARD_TITLE: string = "Acme Metrics";

const STATUS_PAGE_TEMPLATE: string = path.resolve(
  __dirname,
  "../../FeatureSet/StatusPage/views/index.ejs",
);

const ENVIRONMENT_KEYS: Array<string> = [
  "HOST",
  "HTTP_PROTOCOL",
  "SERVER_APP_HOSTNAME",
  "APP_PORT",
];

const savedEnvironment: Record<string, string | undefined> = {};

// The page's theme as its row holds it: its owner changes it between requests.
let storedTheme: string = "System";

// The paths the App's API was asked for, at its internal address.
const apiRequests: Array<string> = [];

let answerApiRequest: http.RequestListener | null = null;

const appApi: http.Server = http.createServer(
  (req: http.IncomingMessage, res: http.ServerResponse): void => {
    apiRequests.push(req.url || "");

    if (!answerApiRequest) {
      res.statusCode = 503;
      res.end();
      return;
    }

    answerApiRequest(req, res);
  },
);

let servers: PageServers;

type PageRequestFunction = (data: {
  host: string;
  path: string;
}) => ExpressRequest;

let pageRequest: PageRequestFunction;

type ListenFunction = (server: net.Server) => Promise<number>;

const listen: ListenFunction = async (server: net.Server): Promise<number> => {
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return (server.address() as AddressInfo).port;
};

/*
 * A port on this machine that nothing listens on: the public address, as the
 * App container sees HOST=localhost on the e2e stack.
 */
const portNothingListensOn: () => Promise<number> =
  async (): Promise<number> => {
    const probe: net.Server = net.createServer();
    const port: number = await listen(probe);

    await new Promise<void>((resolve: () => void) => {
      probe.close(() => {
        resolve();
      });
    });

    return port;
  };

/*
 * The App's API: the real status page API router over a stubbed data layer,
 * and the public dashboard API's /seo, answering as it does for a dashboard
 * open to everyone. Loaded from the same module registry as the page servers.
 */
const buildAppApi: () => Promise<http.RequestListener> =
  async (): Promise<http.RequestListener> => {
    const ExpressUtil: typeof import("Common/Server/Utils/Express") =
      await import("Common/Server/Utils/Express");
    const StatusPageAPI: typeof import("Common/Server/API/StatusPageAPI").default =
      (await import("Common/Server/API/StatusPageAPI")).default;
    const StatusPageService: typeof import("Common/Server/Services/StatusPageService").default =
      (await import("Common/Server/Services/StatusPageService")).default;
    const StatusPageDomainService: typeof import("Common/Server/Services/StatusPageDomainService").default =
      (await import("Common/Server/Services/StatusPageDomainService")).default;
    const ProjectService: typeof import("Common/Server/Services/ProjectService").default =
      (await import("Common/Server/Services/ProjectService")).default;
    const DashboardDomainService: typeof import("Common/Server/Services/DashboardDomainService").default =
      (await import("Common/Server/Services/DashboardDomainService")).default;
    const StatusPage: typeof import("Common/Models/DatabaseModels/StatusPage").default =
      (await import("Common/Models/DatabaseModels/StatusPage")).default;
    const StatusPageDomain: typeof import("Common/Models/DatabaseModels/StatusPageDomain").default =
      (await import("Common/Models/DatabaseModels/StatusPageDomain")).default;
    const ObjectID: typeof import("Common/Types/ObjectID").default = (
      await import("Common/Types/ObjectID")
    ).default;

    jest.spyOn(StatusPageService, "findOneBy").mockImplementation((async () => {
      const statusPage: InstanceType<typeof StatusPage> = new StatusPage();
      statusPage.id = new ObjectID(PAGE_ID);
      statusPage.projectId = new ObjectID(PROJECT_ID);
      statusPage.name = PAGE_TITLE;
      statusPage.pageTitle = PAGE_TITLE;
      statusPage.pageDescription = "How Acme is doing.";
      statusPage.enableSearchEngineIndexing = true;
      statusPage.isArchived = false;
      statusPage.theme = storedTheme as StatusPageTheme;

      return statusPage;
    }) as never);

    jest
      .spyOn(StatusPageService, "getProjectIdOfStatusPage")
      .mockResolvedValue(new ObjectID(PROJECT_ID) as never);
    jest
      .spyOn(ProjectService, "isProjectBlocked")
      .mockResolvedValue(false as never);

    jest
      .spyOn(StatusPageDomainService, "findOneBy")
      .mockImplementation((async (options: {
        query: { fullDomain?: unknown };
      }) => {
        if (options.query.fullDomain !== DOMAIN) {
          return null;
        }

        const domain: InstanceType<typeof StatusPageDomain> =
          new StatusPageDomain();
        domain.statusPageId = new ObjectID(PAGE_ID);

        return domain;
      }) as never);

    // A host that is not OneUptime's own is first asked after as a public dashboard's.
    jest
      .spyOn(DashboardDomainService, "findOneBy")
      .mockResolvedValue(null as never);

    const app: ReturnType<typeof ExpressUtil.createExpressApp> =
      ExpressUtil.createExpressApp();

    app.use("/api", new StatusPageAPI().getRouter());

    app.get(
      "/api/dashboard/seo/:dashboardIdOrDomain",
      (req: ExpressRequest, res: ExpressResponse): void => {
        if (req.params["dashboardIdOrDomain"] !== DASHBOARD_ID) {
          res.status(404).json({ message: "Dashboard not found" });
          return;
        }

        res.json({
          _id: DASHBOARD_ID,
          title: DASHBOARD_TITLE,
          description: "How Acme's services are doing.",
        });
      },
    );

    return app as unknown as http.RequestListener;
  };

type ThemeHeadFunction = (theme: string) => JSONObject;

let themeHeadOf: ThemeHeadFunction;

beforeAll(async () => {
  const apiPort: number = await listen(appApi);
  const publicPort: number = await portNothingListensOn();

  for (const key of ENVIRONMENT_KEYS) {
    savedEnvironment[key] = process.env[key];
  }

  // The address people use, which the App cannot reach from where it runs.
  process.env["HOST"] = `127.0.0.1:${publicPort}`;
  process.env["HTTP_PROTOCOL"] = "http";
  // The App's own address, where its API answers.
  process.env["SERVER_APP_HOSTNAME"] = "127.0.0.1";
  process.env["APP_PORT"] = String(apiPort);

  /*
   * EnvironmentConfig reads the environment once, when it loads, so the page
   * servers - and everything the App's API runs - load afresh under it.
   */
  jest.resetModules();

  const harness: typeof import("./PageServerHarness") = await import(
    "./PageServerHarness"
  );
  const themes: typeof import("Common/Types/StatusPage/StatusPageTheme") =
    await import("Common/Types/StatusPage/StatusPageTheme");

  pageRequest = harness.pageRequest;
  themeHeadOf = (theme: string): JSONObject => {
    return themes.getStatusPageThemeHead(theme as StatusPageTheme);
  };

  servers = await harness.loadPageServers();
  answerApiRequest = await buildAppApi();
});

afterAll(async () => {
  for (const key of ENVIRONMENT_KEYS) {
    if (savedEnvironment[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnvironment[key];
    }
  }

  await new Promise<void>((resolve: () => void) => {
    appApi.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  storedTheme = "System";
  apiRequests.length = 0;
});

// What the page server handed index.ejs.
const variablesOf: (res: FakeResponse) => JSONObject = (
  res: FakeResponse,
): JSONObject => {
  expect(res.rendered).not.toBeNull();

  return res.rendered!.variables;
};

// The HTML the page is sent as: the real index.ejs, drawn from those variables.
const htmlOf: (res: FakeResponse) => string = (res: FakeResponse): string => {
  return ejs.render(
    fs.readFileSync(STATUS_PAGE_TEMPLATE, "utf8"),
    variablesOf(res),
    { filename: STATUS_PAGE_TEMPLATE },
  );
};

const onItsOwnUrl: () => ExpressRequest = (): ExpressRequest => {
  return pageRequest({ host: "localhost", path: `/status-page/${PAGE_ID}` });
};

describe("a status page's HTML, where the App cannot reach its public address", () => {
  it("is sent as a page that follows each visitor's device, from the App's API at its internal address", async () => {
    const res: FakeResponse = await servers.combined.statusPage(onItsOwnUrl());

    expect(apiRequests).toEqual([`/api/status-page/seo/${PAGE_ID}`]);
    expect(res.statusCode).toBe(200);

    const variables: JSONObject = variablesOf(res);

    expect(variables["statusPageTheme"]).toEqual(themeHeadOf("System"));
    expect(variables["title"]).toBe(PAGE_TITLE);
    expect(variables["faviconUrl"]).toBe(`/status-page-api/favicon/${PAGE_ID}`);

    const html: string = htmlOf(res);

    expect(html).toContain('data-status-page-theme="system"');
    expect(html).toContain('<meta name="color-scheme" content="light dark" />');
    expect(html).toContain(`<title>${PAGE_TITLE}</title>`);
  });

  it("is sent dark on the next request once its owner turns it Dark: nothing on the way keeps the old theme", async () => {
    await servers.combined.statusPage(onItsOwnUrl());

    storedTheme = "Dark";

    const html: string = htmlOf(
      await servers.combined.statusPage(onItsOwnUrl()),
    );

    expect(html).toContain('data-status-page-theme="dark"');
    expect(html).toContain('class="dark"');
    expect(html).toContain('<meta name="color-scheme" content="dark" />');
    expect(html).toContain('<meta name="theme-color" content="#0f172a" />');
    expect(apiRequests).toEqual([
      `/api/status-page/seo/${PAGE_ID}`,
      `/api/status-page/seo/${PAGE_ID}`,
    ]);
  });

  it("is sent in its theme on its custom domain", async () => {
    const res: FakeResponse = await servers.combined.customDomain(
      pageRequest({ host: DOMAIN, path: "/" }),
    );

    expect(apiRequests).toEqual([`/api/status-page/seo/${DOMAIN}`]);
    expect(variablesOf(res)["statusPageTheme"]).toEqual(themeHeadOf("System"));
    expect(htmlOf(res)).toContain('data-status-page-theme="system"');
  });

  it("is sent in its theme by the standalone status-page container", async () => {
    const res: FakeResponse =
      await servers.standalone.statusPage(onItsOwnUrl());

    expect(apiRequests).toEqual([`/api/status-page/seo/${PAGE_ID}`]);
    expect(variablesOf(res)["statusPageTheme"]).toEqual(themeHeadOf("System"));
    expect(variablesOf(res)["title"]).toBe(PAGE_TITLE);
  });
});

describe("a public dashboard's HTML, where the App cannot reach its public address", () => {
  it("is sent with the dashboard's own title, from the App's API at its internal address", async () => {
    const res: FakeResponse = await servers.combined.publicDashboard(
      pageRequest({
        host: "localhost",
        path: `/public-dashboard/${DASHBOARD_ID}`,
      }),
    );

    expect(apiRequests).toEqual([`/api/dashboard/seo/${DASHBOARD_ID}`]);
    expect(res.statusCode).toBe(200);
    expect(variablesOf(res)["title"]).toBe(DASHBOARD_TITLE);
  });
});
