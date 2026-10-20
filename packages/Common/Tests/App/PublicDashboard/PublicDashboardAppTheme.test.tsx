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
import axios from "axios";
import App from "../../../../App/FeatureSet/PublicDashboard/src/App";
import { PUBLIC_DASHBOARD_API_URL } from "../../../../App/FeatureSet/PublicDashboard/src/Utils/Config";
import DashboardThemeUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import { JSONObject } from "../../../Types/JSON";
import DashboardTheme, {
  DASHBOARD_THEME_ATTRIBUTE,
  DASHBOARD_VISITOR_THEME_STORAGE_KEY,
} from "../../../Types/Dashboard/DashboardTheme";
import Navigation from "../../../UI/Utils/Navigation";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

// The pages themselves are not under test: stand-ins, as the metadata suite has.
jest.mock(
  "../../../../App/FeatureSet/PublicDashboard/src/Pages/AllPages",
  () => {
    const ReactInMock: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    const page: (text: string) => () => React.ReactElement = (
      text: string,
    ): (() => React.ReactElement) => {
      return (): React.ReactElement => {
        return ReactInMock.createElement("div", null, text);
      };
    };

    return {
      DashboardViewPage: page("The dashboard itself"),
      MasterPassword: page("The password prompt"),
      NotFoundPage: page("Dashboard Not Found"),
      ForbiddenPage: page("Access Denied"),
    };
  },
);

/*
 * THE PUBLIC DASHBOARD APP DRAWS THE DASHBOARD'S OWN THEME ONCE ITS METADATA
 * SAYS IT (App.tsx, DashboardThemeUtil.setDashboardTheme).
 *
 * The page's HTML was sent in the theme its server read (/seo); the
 * metadata, the app's first request, says it again, and the app draws it -
 * so a dashboard whose server could not read it is still drawn in its own
 * theme once it loads. A dashboard the link does not answer (404) and one
 * the IP allowlist refuses (403) show nothing of a dashboard: the page
 * follows the visitor. Any other failure keeps the theme the page was sent
 * in.
 *
 * The real app, the real public dashboard API client and the real theme
 * util run here; a scripted server stands in for axios.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const DASHBOARD_ID: string = "ab000000-0000-4000-8000-0000000000b1";

const PREVIEW_PATH: string = `/public-dashboard/${DASHBOARD_ID}`;

const METADATA_URL: string = `${PUBLIC_DASHBOARD_API_URL.toString()}/metadata/${DASHBOARD_ID}`;

const DARK_QUERY: string = "(prefers-color-scheme: dark)";

let server: FakeAxiosServer;

const installDevice: (prefersDark: boolean) => void = (
  prefersDark: boolean,
): void => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      return {
        matches: query === DARK_QUERY && prefersDark,
        media: query,
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
      } as unknown as MediaQueryList;
    },
  });
};

/*
 * The util keeps the dashboard's theme, the link's and the visitor's pick
 * for the page's life; each test is a fresh page.
 */
const forgetPage: () => void = (): void => {
  const state: {
    dashboardTheme: DashboardTheme | null;
    linkTheme: string | null | undefined;
    visitorColorScheme: string | null | undefined;
  } = DashboardThemeUtil as unknown as {
    dashboardTheme: DashboardTheme | null;
    linkTheme: string | null | undefined;
    visitorColorScheme: string | null | undefined;
  };

  state.dashboardTheme = null;
  state.linkTheme = undefined;
  state.visitorColorScheme = undefined;
};

const metadata: (theme?: unknown) => JSONObject = (
  theme?: unknown,
): JSONObject => {
  const answer: JSONObject = {
    _id: DASHBOARD_ID,
    name: "Checkout",
    isPublicDashboard: true,
    enableMasterPassword: false,
    pageTitle: "",
    faviconFile: null,
    description: "",
    pageDescription: "",
    logoFile: null,
  };

  if (theme !== undefined) {
    answer["theme"] = theme as string;
  }

  return answer;
};

const renderApp: () => void = (): void => {
  render(
    <MemoryRouter initialEntries={[PREVIEW_PATH]}>
      <App />
    </MemoryRouter>,
  );
};

const isDark: () => boolean = (): boolean => {
  return document.documentElement.classList.contains("dark");
};

// What the server sent the page in.
const sentAs: (setting: "light" | "dark" | "system") => void = (
  setting: "light" | "dark" | "system",
): void => {
  document.documentElement.setAttribute(DASHBOARD_THEME_ATTRIBUTE, setting);
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", PREVIEW_PATH);
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute(DASHBOARD_THEME_ATTRIBUTE);
  document.head.innerHTML = '<meta name="theme-color" content="#f9fafb">';
  installDevice(false);
  forgetPage();

  server = new FakeAxiosServer(mockedAxios);

  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(async () => {
  cleanup();
  await settle();

  mockedAxios.mockReset();
  jest.restoreAllMocks();
  window.localStorage.clear();
  forgetPage();
});

describe("the dashboard's theme, from its metadata", () => {
  test.each([
    [DashboardTheme.Light, "dark", false],
    [DashboardTheme.Dark, "light", true],
    [DashboardTheme.System, "light", false],
  ])(
    "%s is drawn, whatever the page was sent in (%s), on a light device",
    async (
      theme: DashboardTheme,
      sent: string,
      expectedDark: boolean,
    ): Promise<void> => {
      sentAs(sent as "light" | "dark");
      server.on(HTTPMethod.POST, METADATA_URL, [
        { status: 200, data: metadata(theme) },
      ]);

      renderApp();

      expect(
        await screen.findByText("The dashboard itself", undefined, {
          timeout: 15000,
        }),
      ).toBeTruthy();
      expect(DashboardThemeUtil.getDashboardTheme()).toBe(theme);
      expect(isDark()).toBe(expectedDark);
      expect(
        document.documentElement.getAttribute(DASHBOARD_THEME_ATTRIBUTE),
      ).toBe(theme.toLowerCase());
    },
  );

  test("System is drawn as the visitor's device asks: dark on a dark device", async () => {
    installDevice(true);
    sentAs("light");
    server.on(HTTPMethod.POST, METADATA_URL, [
      { status: 200, data: metadata(DashboardTheme.System) },
    ]);

    renderApp();

    await waitFor(
      () => {
        expect(isDark()).toBe(true);
      },
      { timeout: 15000 },
    );
  });

  test.each([
    ["no theme (an older server)", undefined],
    ["a theme nobody knows", "Sepia"],
  ])(
    "%s is the light page",
    async (_what: string, theme: unknown): Promise<void> => {
      sentAs("dark");
      server.on(HTTPMethod.POST, METADATA_URL, [
        { status: 200, data: metadata(theme) },
      ]);

      renderApp();

      await waitFor(
        () => {
          expect(DashboardThemeUtil.getDashboardTheme()).toBe(
            DashboardTheme.Light,
          );
        },
        { timeout: 15000 },
      );
      expect(isDark()).toBe(false);
    },
  );

  test("the visitor's own pick wins over the dashboard's theme", async () => {
    window.localStorage.setItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY, "light");
    sentAs("dark");
    server.on(HTTPMethod.POST, METADATA_URL, [
      { status: 200, data: metadata(DashboardTheme.Dark) },
    ]);

    renderApp();

    expect(
      await screen.findByText("The dashboard itself", undefined, {
        timeout: 15000,
      }),
    ).toBeTruthy();
    expect(DashboardThemeUtil.getDashboardTheme()).toBe(DashboardTheme.Dark);
    expect(isDark()).toBe(false);
  });

  test("a password-protected dashboard's prompt is drawn in the dashboard's theme", async () => {
    sentAs("light");
    server.on(HTTPMethod.POST, METADATA_URL, [
      {
        status: 200,
        data: {
          ...metadata(DashboardTheme.Dark),
          enableMasterPassword: true,
        },
      },
    ]);

    renderApp();

    await waitFor(
      () => {
        expect(Navigation.navigate).toHaveBeenCalled();
      },
      { timeout: 15000 },
    );
    expect(isDark()).toBe(true);
  });
});

describe("a page that shows no dashboard follows the visitor", () => {
  test.each([
    ["not found (404)", 404, "Dashboard Not Found"],
    ["Access Denied (403)", 403, "Access Denied"],
  ])(
    "%s: the visitor's device, not the theme the page was sent in",
    async (_what: string, status: number, shown: string): Promise<void> => {
      installDevice(true);
      sentAs("light");
      server.on(HTTPMethod.POST, METADATA_URL, [
        { status, data: { error: "No." } },
      ]);

      renderApp();

      expect(
        await screen.findByText(shown, undefined, { timeout: 15000 }),
      ).toBeTruthy();
      expect(DashboardThemeUtil.getDashboardTheme()).toBe(
        DashboardTheme.System,
      );
      expect(isDark()).toBe(true);
    },
  );

  test("not found keeps the visitor's own pick", async () => {
    installDevice(true);
    window.localStorage.setItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY, "light");
    sentAs("dark");
    server.on(HTTPMethod.POST, METADATA_URL, [
      { status: 404, data: { error: "Dashboard not found" } },
    ]);

    renderApp();

    expect(
      await screen.findByText("Dashboard Not Found", undefined, {
        timeout: 15000,
      }),
    ).toBeTruthy();
    expect(isDark()).toBe(false);
  });
});

describe("a failure that is not an answer", () => {
  test("keeps the theme the page was sent in", async () => {
    sentAs("dark");
    server.on(HTTPMethod.POST, METADATA_URL, [
      { status: 500, data: { error: "Server Error" } },
    ]);

    renderApp();

    expect(
      await screen.findByText("Server Error", undefined, { timeout: 15000 }),
    ).toBeTruthy();
    expect(DashboardThemeUtil.getDashboardTheme()).toBe(DashboardTheme.Dark);
  });
});
