/**
 * A form on its owner's own domain, as the App answers a visit to it
 * (Frontend/FormDomainPage.ts, Frontend/Index.ts's custom-domain fallback).
 *
 * report.acme.com shows one form, at its root, and nothing else:
 *
 *   - "/" renders the sign-in app's index.ejs as that form's page - marked
 *     as the form's (isFormDomainPage), titled with the form's name when the
 *     visitor would be shown it and with the domain otherwise, without
 *     OneUptime's measurement, and with the link page's headers: never
 *     stored, never framed;
 *   - every other page address is sent to "/" with its query, so a template
 *     link (?template=<id>) opens its template there, and a sign-in address
 *     typed onto the customer's domain never draws a OneUptime sign-in page;
 *   - an /api address the App has no route for is no page at all;
 *   - the form domain is told by the request's own Host, never by the name
 *     Express takes from X-Forwarded-Host; a dashboard's domain is still a
 *     dashboard's, and any other custom domain still a status page's;
 *   - the sign-in app's built files and env.js answer on every host, so the
 *     page can load on the customer's domain, while its pages stay on
 *     OneUptime's own.
 *
 * The combined App container's real routes run here (PageServerHarness);
 * which domains are whose, and the form's name, are stand-ins.
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

import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import FormDomainService from "Common/Server/Services/FormDomainService";
import FormService from "Common/Server/Services/FormService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import {
  FORM_DOMAIN_NOT_A_PAGE_PREFIXES,
  FORM_DOMAIN_PAGE_HEADERS,
  FORM_DOMAIN_PAGE_PATH,
  FormDomainPageAnswer,
  getFormDomainPageAnswer,
  getFormDomainPageLocation,
  getFormDomainPageVariables,
} from "../../FeatureSet/Frontend/FormDomainPage";
import {
  FakeResponse,
  PageServers,
  answerSeo,
  loadPageServers,
  pageRequest,
  spyOnApi,
} from "../StatusPage/PageServerHarness";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

const FORM_DOMAIN: string = "report.acme.com";
const STATUS_PAGE_DOMAIN: string = "status.acme.com";
const DASHBOARD_DOMAIN: string = "metrics.acme.com";

const ACCOUNTS_VIEW: string =
  "/usr/src/app/FeatureSet/Accounts/views/index.ejs";
const STATUS_PAGE_VIEW: string =
  "/usr/src/app/FeatureSet/StatusPage/views/index.ejs";
const PUBLIC_DASHBOARD_VIEW: string =
  "/usr/src/app/FeatureSet/PublicDashboard/views/index.ejs";

describe("the rules (FormDomainPage)", () => {
  it("the root is the form's page", () => {
    expect(FORM_DOMAIN_PAGE_PATH).toBe("/");
    expect(getFormDomainPageAnswer("/")).toBe(FormDomainPageAnswer.Page);
  });

  it.each([
    ["/accounts/login"],
    ["/accounts/form/7c9e6679-7425-40de-944b-e07fc1f90ae7"],
    ["/accounts"],
    ["/report"],
    ["/index.html"],
    ["//evil.example"],
    ["/apikeys"],
  ])("any other page address (%s) is sent to the root", (path: string) => {
    expect(getFormDomainPageAnswer(path)).toBe(
      FormDomainPageAnswer.RedirectToPage,
    );
  });

  it.each([["/api"], ["/api/form/unknown"], ["/api/status-page/x"]])(
    "an /api address (%s) is no page",
    (path: string) => {
      expect(FORM_DOMAIN_NOT_A_PAGE_PREFIXES).toEqual(["/api"]);
      expect(getFormDomainPageAnswer(path)).toBe(FormDomainPageAnswer.NotAPage);
    },
  );

  it.each([
    ["/accounts/login", "/"],
    ["/anything?template=t-1", "/?template=t-1"],
    ["/a/b?x=1&y=2", "/?x=1&y=2"],
    ["/?", "/"],
    ["/x?", "/"],
    // Never another host: the query cannot make "//".
    ["//evil.example/path?next=//evil.example", "/?next=//evil.example"],
  ])("sends %s to %s, on the same domain", (url: string, location: string) => {
    expect(getFormDomainPageLocation(url)).toBe(location);
    expect(location.startsWith("//")).toBe(false);
  });

  it("goes out never stored, never framed, its type never guessed", () => {
    expect(FORM_DOMAIN_PAGE_HEADERS).toEqual({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
  });

  it("is marked as the form's page, and titled with the form's name, else the domain", () => {
    expect(
      getFormDomainPageVariables({
        hostname: FORM_DOMAIN,
        formName: " Report a Problem ",
      }),
    ).toEqual({
      isFormDomainPage: true,
      formDomainPageTitle: "Report a Problem",
    });

    for (const formName of [null, "", "   "]) {
      expect(
        getFormDomainPageVariables({ hostname: FORM_DOMAIN, formName }),
      ).toEqual({
        isFormDomainPage: true,
        formDomainPageTitle: FORM_DOMAIN,
      });
    }
  });
});

describe("a visit to a form's own domain, in the combined App container", () => {
  let servers: PageServers;
  let formName: string | null;
  let formDomains: Array<string>;
  let dashboardDomains: Array<string>;

  beforeAll(async () => {
    servers = await loadPageServers();
  });

  beforeEach(() => {
    formName = "Report a Problem";
    formDomains = [FORM_DOMAIN];
    dashboardDomains = [DASHBOARD_DOMAIN];

    jest
      .spyOn(FormDomainService, "isFormDomain")
      .mockImplementation(async (hostname: string | null | undefined) => {
        return formDomains.includes(String(hostname));
      });

    jest
      .spyOn(FormService, "getFormNameOnCustomDomain")
      .mockImplementation(async () => {
        return formName;
      });

    jest
      .spyOn(DashboardDomainService, "findOneBy")
      .mockImplementation((async (call: { query: { fullDomain?: string } }) => {
        return dashboardDomains.includes(String(call.query.fullDomain))
          ? new DashboardDomain()
          : null;
      }) as never);

    // A status page that does not exist, for the visits that fall through.
    answerSeo(spyOnApi("get"), {
      [STATUS_PAGE_DOMAIN]: new HTTPErrorResponse(404, {}, {}),
      [DASHBOARD_DOMAIN]: new HTTPErrorResponse(404, {}, {}),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const visit: (data: {
    host: string;
    path: string;
    originalUrl?: string;
    hostname?: string;
  }) => Promise<FakeResponse> = async (data: {
    host: string;
    path: string;
    originalUrl?: string;
    hostname?: string;
  }): Promise<FakeResponse> => {
    return await servers.combined.customDomain(pageRequest(data));
  };

  it("renders the sign-in app's page as the form's, titled with its name, at the root", async () => {
    const res: FakeResponse = await visit({ host: FORM_DOMAIN, path: "/" });

    expect(res.rendered?.view).toBe(ACCOUNTS_VIEW);
    expect(res.rendered?.variables).toEqual(
      expect.objectContaining({
        isFormDomainPage: true,
        formDomainPageTitle: "Report a Problem",
        // Not OneUptime's to measure: the page is its owner's.
        enableGoogleTagManager: false,
      }),
    );
    expect(FormService.getFormNameOnCustomDomain).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: FORM_DOMAIN }),
    );
  });

  it("titles it with the domain when the visitor would not be shown the form", async () => {
    formName = null;

    const res: FakeResponse = await visit({ host: FORM_DOMAIN, path: "/" });

    expect(res.rendered?.variables["formDomainPageTitle"]).toBe(FORM_DOMAIN);
    expect(res.rendered?.variables["isFormDomainPage"]).toBe(true);
  });

  it("goes out with the link page's headers", async () => {
    const res: FakeResponse = await visit({ host: FORM_DOMAIN, path: "/" });

    expect(res.headers["cache-control"]).toBe(
      "no-cache, no-store, must-revalidate",
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it.each([
    ["/accounts/login", "/accounts/login", "/"],
    ["/accounts/register", "/accounts/register?ref=1", "/?ref=1"],
    ["/somewhere", "/somewhere?template=t-1", "/?template=t-1"],
  ])(
    "sends %s to the root, with its query",
    async (path: string, originalUrl: string, location: string) => {
      const res: FakeResponse = await visit({
        host: FORM_DOMAIN,
        path,
        originalUrl,
      });

      expect(res.redirected).toEqual({ status: 302, location: location });
      expect(res.rendered).toBeNull();
    },
  );

  it("leaves an unknown /api address to the App's not found", async () => {
    await expect(
      visit({ host: FORM_DOMAIN, path: "/api/nothing-here" }),
    ).rejects.toThrow("passed /api/nothing-here on");
  });

  it("tells a form's domain by the Host the browser connected to, never by X-Forwarded-Host", async () => {
    const res: FakeResponse = await visit({
      host: STATUS_PAGE_DOMAIN,
      // What Express makes of a forged X-Forwarded-Host under trust proxy.
      hostname: FORM_DOMAIN,
      path: "/",
    });

    expect(FormDomainService.isFormDomain).toHaveBeenCalledWith(
      STATUS_PAGE_DOMAIN,
    );
    expect(res.rendered?.view).toBe(STATUS_PAGE_VIEW);
  });

  it("a dashboard's domain is still a dashboard's", async () => {
    // A name both had before names were refused when in use.
    formDomains = [FORM_DOMAIN, DASHBOARD_DOMAIN];

    const res: FakeResponse = await visit({
      host: DASHBOARD_DOMAIN,
      path: "/",
    });

    expect(res.rendered?.view).toBe(PUBLIC_DASHBOARD_VIEW);
  });

  it("any other custom domain is still a status page's", async () => {
    const res: FakeResponse = await visit({
      host: STATUS_PAGE_DOMAIN,
      path: "/incidents",
    });

    expect(res.rendered?.view).toBe(STATUS_PAGE_VIEW);
    expect(res.rendered?.variables["isFormDomainPage"]).toBeUndefined();
  });

  describe("the sign-in app's files, on every host", () => {
    const request: (host: string, path: string) => ExpressRequest = (
      host: string,
      path: string,
    ): ExpressRequest => {
      return pageRequest({ host, path });
    };

    it("a built file it does not have is a 404 on the form's domain, not the page", async () => {
      const result: { res: FakeResponse; passedOn: boolean } =
        await servers.combined.route(
          "get",
          "/accounts/dist/*",
        )(request(FORM_DOMAIN, "/accounts/dist/chunk-gone.js"));

      expect(result.passedOn).toBe(false);
      expect(result.res.statusCode).toBe(404);
      expect(result.res.headers["cache-control"]).toBe("no-store");
    });

    it("the Dashboard's files stay on OneUptime's own host", async () => {
      const result: { res: FakeResponse; passedOn: boolean } =
        await servers.combined.route(
          "get",
          "/dashboard/dist/*",
        )(request(FORM_DOMAIN, "/dashboard/dist/chunk.js"));

      expect(result.passedOn).toBe(true);
    });

    it("the sign-in pages themselves stay on OneUptime's own host", async () => {
      const result: { res: FakeResponse; passedOn: boolean } =
        await servers.combined.route(
          "get",
          "/accounts/*",
        )(request(FORM_DOMAIN, "/accounts/login"));

      expect(result.passedOn).toBe(true);
      expect(result.res.rendered).toBeNull();
    });
  });
});
