// Must stay the first import: the client's URLs are built from HOST on load.
import "../../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  FakeTransport,
  settle,
} from "../../UI/Utils/API/FakeAxiosServer";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import axios from "axios";
import App from "../../../../App/FeatureSet/PublicDashboard/src/App";
import { PUBLIC_DASHBOARD_API_URL } from "../../../../App/FeatureSet/PublicDashboard/src/Utils/Config";
import PublicDashboardUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/PublicDashboard";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import Navigation from "../../../UI/Utils/Navigation";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * The pages the app loads lazily. The dashboard view and the password form
 * pull in the whole widget tree and are not what is under test here, so they
 * are stand-ins; the not-found and access-denied pages are the real ones.
 */
jest.mock(
  "../../../../App/FeatureSet/PublicDashboard/src/Pages/AllPages",
  () => {
    const ReactInMock: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      DashboardViewPage: (): React.ReactElement => {
        return ReactInMock.createElement("div", null, "The dashboard itself");
      },
      MasterPassword: (): React.ReactElement => {
        return ReactInMock.createElement("div", null, "The password prompt");
      },
      NotFoundPage: (
        jest.requireActual(
          "../../../../App/FeatureSet/PublicDashboard/src/Pages/NotFound/NotFound",
        ) as { default: React.FunctionComponent }
      ).default,
      ForbiddenPage: (
        jest.requireActual(
          "../../../../App/FeatureSet/PublicDashboard/src/Pages/Forbidden/Forbidden",
        ) as { default: React.FunctionComponent }
      ).default,
    };
  },
);

/*
 * THE PUBLIC DASHBOARD APP SHOWS WHAT THE METADATA SAYS THIS VISITOR MAY SEE.
 *
 * The metadata (POST /public-dashboard-api/metadata/:id) is the app's first
 * request, and it now answers only for a dashboard the visitor may see:
 *
 *   - 404 for a dashboard shared only with its project, an archived one and
 *     a missing one alike: the app shows "Dashboard Not Found";
 *   - 403 for an address the dashboard's IP allowlist refuses: the app shows
 *     "Access Denied", on the forbidden page the client sends a 403 to;
 *   - 200 with only the name, page title and favicon for a dashboard shared
 *     with a password the visitor has not entered: the app titles the tab,
 *     sets the favicon and goes to its password prompt.
 *
 * The real app, the real public dashboard API client and the real Common
 * client run here; a scripted server stands in for axios and answers only
 * the requests each test expects.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const DASHBOARD_ID: string = "ab000000-0000-4000-8000-0000000000a1";

const PREVIEW_PATH: string = `/public-dashboard/${DASHBOARD_ID}`;

const METADATA_URL: string = `${PUBLIC_DASHBOARD_API_URL.toString()}/metadata/${DASHBOARD_ID}`;

const DOMAIN_URL: string = `${PUBLIC_DASHBOARD_API_URL.toString()}/domain`;

let server: FakeAxiosServer;

let navigateSpy: SpyInstance<typeof Navigation.navigate>;

const renderApp: (path?: string) => void = (
  path: string = PREVIEW_PATH,
): void => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
};

const navigatedTo: () => Array<string> = (): Array<string> => {
  return navigateSpy.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // The preview address: the app reads the dashboard id from it.
  window.history.replaceState(null, "", PREVIEW_PATH);
  document.title = "Dashboard";

  server = new FakeAxiosServer(mockedAxios);

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
});

afterEach(async () => {
  cleanup();
  await settle();

  mockedAxios.mockReset();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("the public dashboard app shows what the metadata says this visitor may see", () => {
  test("a dashboard the link answers nobody for (404) shows Dashboard Not Found, and nothing about it", async () => {
    server.on(HTTPMethod.POST, METADATA_URL, [
      { status: 404, data: { error: "Dashboard not found" } },
    ]);

    renderApp();

    expect(
      await screen.findByText("Dashboard Not Found", undefined, {
        timeout: 15000,
      }),
    ).toBeTruthy();

    expect(server.sent.length).toBe(1);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(document.title).toBe("Dashboard");
    expect(PublicDashboardUtil.requiresMasterPassword()).toBe(false);
  });

  test("an address the IP allowlist refuses (403) shows Access Denied, on the forbidden page", async () => {
    server.on(HTTPMethod.POST, METADATA_URL, [
      {
        status: 403,
        data: {
          error:
            "Your IP address 198.51.100.5 is blocked from accessing this dashboard.",
        },
      },
    ]);

    renderApp();

    expect(
      await screen.findByText("Access Denied", undefined, { timeout: 15000 }),
    ).toBeTruthy();

    expect(screen.queryByText("Dashboard Not Found")).toBeNull();
    expect(server.sent.length).toBe(1);
    expect(navigatedTo()).toEqual([`${PREVIEW_PATH}/forbidden`]);
    expect(document.title).toBe("Dashboard");
  });

  test("a password-protected dashboard titles the tab, sets its favicon and goes to the password prompt", async () => {
    const promptAnswer: JSONObject = {
      _id: DASHBOARD_ID,
      name: "Checkout",
      isPublicDashboard: true,
      enableMasterPassword: true,
      pageTitle: "Checkout status",
      faviconFile: {
        file: Buffer.from("favicon").toString("base64"),
        fileType: "image/png",
      },
      description: "",
      pageDescription: "",
      logoFile: null,
    };

    server.on(HTTPMethod.POST, METADATA_URL, [
      { status: 200, data: promptAnswer },
    ]);

    renderApp();

    await waitFor(
      () => {
        expect(navigateSpy).toHaveBeenCalled();
      },
      { timeout: 15000 },
    );

    const target: string = navigatedTo()[0] || "";

    expect(target.startsWith(`${PREVIEW_PATH}/master-password`)).toBe(true);
    expect(navigateSpy.mock.calls[0]![0]).toBeInstanceOf(Route);
    expect(document.title).toBe("Checkout status");
    expect(
      document.querySelector('link[rel="icon"]')?.getAttribute("href"),
    ).toBe(
      `data:image/png;base64,${Buffer.from("favicon").toString("base64")}`,
    );
    expect(PublicDashboardUtil.requiresMasterPassword()).toBe(true);
    expect(server.sent.length).toBe(1);
  });

  test("a dashboard anyone with the link may view opens", async () => {
    server.on(HTTPMethod.POST, METADATA_URL, [
      {
        status: 200,
        data: {
          _id: DASHBOARD_ID,
          name: "Checkout",
          isPublicDashboard: true,
          enableMasterPassword: false,
          pageTitle: "",
          faviconFile: null,
          description: "Orders and payments",
          pageDescription: "",
          logoFile: null,
        },
      },
    ]);

    renderApp();

    expect(
      await screen.findByText("The dashboard itself", undefined, {
        timeout: 15000,
      }),
    ).toBeTruthy();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(document.title).toBe("Checkout");
    expect(PublicDashboardUtil.requiresMasterPassword()).toBe(false);
  });

  test.each([
    [
      "a rate limit (429)",
      429,
      "Too many requests. Please try again in a minute.",
    ],
    ["a server error (500)", 500, "Server Error"],
  ])(
    "%s is shown as an error, not as a missing dashboard",
    async (_label: string, status: number, message: string) => {
      server.on(HTTPMethod.POST, METADATA_URL, [
        { status, data: { error: message } },
      ]);

      renderApp();

      expect(
        await screen.findByText(message, undefined, { timeout: 15000 }),
      ).toBeTruthy();

      expect(screen.queryByText("Dashboard Not Found")).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
    },
  );
});

describe("on a custom domain, the public dashboard app asks which dashboard the domain shows", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("a domain no dashboard shows on (404) - none added, or its dashboard private or archived - shows Dashboard Not Found", async () => {
    server.on(HTTPMethod.POST, DOMAIN_URL, [
      { status: 404, data: { error: "Dashboard not found" } },
    ]);

    renderApp("/");

    expect(
      await screen.findByText("Dashboard Not Found", undefined, {
        timeout: 15000,
      }),
    ).toBeTruthy();

    // The metadata is never asked for.
    expect(server.sent.length).toBe(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("a domain lookup that fails otherwise is shown as an error", async () => {
    server.on(HTTPMethod.POST, DOMAIN_URL, [
      { status: 500, data: { error: "Server Error" } },
    ]);

    renderApp("/");

    expect(
      await screen.findByText("Server Error", undefined, { timeout: 15000 }),
    ).toBeTruthy();

    expect(screen.queryByText("Dashboard Not Found")).toBeNull();
    expect(server.sent.length).toBe(1);
  });

  test("a domain that names its dashboard goes on to that dashboard's metadata", async () => {
    server.on(HTTPMethod.POST, DOMAIN_URL, [
      { status: 200, data: { dashboardId: DASHBOARD_ID } },
    ]);
    server.on(HTTPMethod.POST, METADATA_URL, [
      { status: 404, data: { error: "Dashboard not found" } },
    ]);

    renderApp("/");

    expect(
      await screen.findByText("Dashboard Not Found", undefined, {
        timeout: 15000,
      }),
    ).toBeTruthy();

    expect(server.sent.length).toBe(2);
    expect(PublicDashboardUtil.getDashboardId()?.toString()).toBe(DASHBOARD_ID);
  });
});
