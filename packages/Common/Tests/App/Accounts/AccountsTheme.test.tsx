import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import Route from "../../../Types/API/Route";
import {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  ThemePreference,
} from "../../../Types/Theme/ThemePreference";
import Navigation from "../../../UI/Utils/Navigation";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import ThemeUtil from "../../../UI/Utils/Theme";

/*
 * The sign-in pages' theme (Accounts' Utils/AccountsTheme.ts): the person's
 * own - Light or Dark as they picked it in the Dashboard's user menu, or as
 * their device is set when they picked System or nothing - on every page of
 * the app but one kind: a public form is its owner's page, branded with the
 * owner's logo, and stays light whoever opens it.
 *
 * The page's first script (views/index.ejs, through Common's Theme partial)
 * draws the theme before the first paint; the app keeps it there - on every
 * move to another page, when the device changes, when another tab picks.
 * The routes here are the app's own (App.tsx), with each page a stand-in:
 * what is under test is which theme each address is drawn in.
 */

jest.mock(
  "../../../../App/FeatureSet/Accounts/src/Components/Footer/Footer",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

const PAGE_MODULES: Array<string> = [
  "Forbidden",
  "ForgotPassword",
  "Login",
  "MobilePasskey",
  "LoginWithSSO",
  "NotFound",
  "Register",
  "ResetPassword",
  "VerifyEmail",
  "Form",
  "McpAuthorize",
  "MarketplacePurchase",
];

for (const pageModule of PAGE_MODULES) {
  jest.doMock(
    `../../../../App/FeatureSet/Accounts/src/Pages/${pageModule}`,
    () => {
      return {
        __esModule: true,
        default: (): React.ReactElement => {
          return <div data-testid={`page-${pageModule}`} />;
        },
      };
    },
  );
}

import App from "../../../../App/FeatureSet/Accounts/src/App";
import AccountsTheme, {
  ALWAYS_LIGHT_PATH_PREFIXES,
  isAlwaysLightPath,
} from "../../../../App/FeatureSet/Accounts/src/Utils/AccountsTheme";

const ACCOUNTS: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Accounts",
);

const SHARE_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";

// The device's light / dark setting, as the page asks matchMedia for it.
type ChangeListener = () => void;

const device: { prefersDark: boolean; listeners: Array<ChangeListener> } = {
  prefersDark: false,
  listeners: [],
};

const setDevice: (prefersDark: boolean) => void = (
  prefersDark: boolean,
): void => {
  device.prefersDark = prefersDark;

  for (const listener of device.listeners) {
    listener();
  }
};

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList => {
    return {
      media: query,
      get matches(): boolean {
        return query === DARK_COLOR_SCHEME_MEDIA_QUERY && device.prefersDark;
      },
      addEventListener: (_type: string, listener: ChangeListener): void => {
        device.listeners.push(listener);
      },
      removeEventListener: (): void => {},
    } as unknown as MediaQueryList;
  },
});

const isPageDark: () => boolean = (): boolean => {
  return document.documentElement.classList.contains("dark");
};

// The browser's address, as the theme reads it, and the app's router.
const openAt: (address: string) => void = (address: string): void => {
  window.history.replaceState({}, "", address);
  render(
    <MemoryRouter initialEntries={[address]}>
      <App />
    </MemoryRouter>,
  );
};

const moveTo: (address: string) => Promise<void> = async (
  address: string,
): Promise<void> => {
  await act(async () => {
    window.history.replaceState({}, "", address);
    Navigation.navigate(new Route(address));
  });
};

const pickInAnotherTab: (pick: ThemePreference) => void = (
  pick: ThemePreference,
): void => {
  window.localStorage.setItem(THEME_STORAGE_KEY, pick);
  window.dispatchEvent(
    new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: pick }),
  );
};

beforeEach(() => {
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  device.prefersDark = false;
  document.documentElement.removeAttribute("class");
  window.history.replaceState({}, "", "/accounts/login");
});

afterEach(() => {
  cleanup();
  // Back to a page that has no always-light addresses.
  ThemeUtil.initialize();
});

describe("the addresses that are always light", () => {
  test("are the public form's, and the incident form links shared before Forms", () => {
    expect(ALWAYS_LIGHT_PATH_PREFIXES).toEqual([
      "/accounts/form/",
      "/accounts/incident-form/",
    ]);
  });

  test.each([
    [`/accounts/form/${SHARE_KEY}`, true],
    [`/accounts/incident-form/${SHARE_KEY}`, true],
    ["/accounts/form/", true],
    ["/accounts", false],
    ["/accounts/login", false],
    ["/accounts/admin-login", false],
    ["/accounts/sso", false],
    ["/accounts/register", false],
    ["/accounts/forgot-password", false],
    ["/accounts/reset-password", false],
    ["/accounts/verify-email", false],
    ["/accounts/mcp-authorize", false],
    ["/accounts/marketplace", false],
    ["/accounts/mobile-passkey", false],
    ["/accounts/forms", false],
    ["/accounts/form", false],
    [`/dashboard/form/${SHARE_KEY}`, false],
  ])("%s: %p", (address: string, isAlwaysLight: boolean) => {
    expect(isAlwaysLightPath(address)).toBe(isAlwaysLight);
  });

  test("are the ones the page's first script is given, so the first paint and the app agree", () => {
    const template: string = fs.readFileSync(
      path.join(ACCOUNTS, "views", "index.ejs"),
      "utf8",
    );
    const start: number = template.indexOf("alwaysLightPathPrefixes:");
    const list: string = template.slice(
      template.indexOf("[", start),
      template.indexOf("]", start) + 1,
    );

    expect(start).toBeGreaterThan(-1);
    expect(JSON.parse(list.split("'").join('"'))).toEqual(
      ALWAYS_LIGHT_PATH_PREFIXES,
    );
  });
});

describe("the sign-in pages", () => {
  test.each([
    [ThemePreference.Dark, false, true],
    [ThemePreference.Light, true, false],
    [ThemePreference.System, true, true],
    [ThemePreference.System, false, false],
  ])(
    "are drawn in the person's pick: %s, on a device that prefers dark: %p",
    async (pick: ThemePreference, prefersDark: boolean, dark: boolean) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, pick);
      device.prefersDark = prefersDark;
      AccountsTheme.initialize();
      openAt("/accounts/login");

      expect(await screen.findByTestId("page-Login")).toBeInTheDocument();
      expect(isPageDark()).toBe(dark);
    },
  );

  test("follow the device when nobody picked, as it changes, while the page is open", () => {
    AccountsTheme.initialize();
    openAt("/accounts/sso");

    expect(isPageDark()).toBe(false);

    act(() => {
      setDevice(true);
    });
    expect(isPageDark()).toBe(true);

    act(() => {
      setDevice(false);
    });
    expect(isPageDark()).toBe(false);
  });

  test("follow a pick made in the Dashboard in another tab", () => {
    AccountsTheme.initialize();
    openAt("/accounts/login");

    act(() => {
      pickInAnotherTab(ThemePreference.Dark);
    });
    expect(isPageDark()).toBe(true);
  });
});

describe("a public form", () => {
  test("is light whatever was picked, and whatever the device does", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    device.prefersDark = true;
    window.history.replaceState({}, "", `/accounts/form/${SHARE_KEY}`);
    AccountsTheme.initialize();
    openAt(`/accounts/form/${SHARE_KEY}`);

    expect(await screen.findByTestId("page-Form")).toBeInTheDocument();
    expect(isPageDark()).toBe(false);

    act(() => {
      setDevice(false);
      setDevice(true);
      pickInAnotherTab(ThemePreference.System);
    });
    expect(isPageDark()).toBe(false);
  });

  test("an incident form link, sent on to the form, is light too", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    window.history.replaceState({}, "", `/accounts/incident-form/${SHARE_KEY}`);
    AccountsTheme.initialize();
    openAt(`/accounts/incident-form/${SHARE_KEY}`);

    expect(isPageDark()).toBe(false);
  });

  test("moving on from it to a page of the person's own draws their theme again, and back", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    window.history.replaceState({}, "", `/accounts/form/${SHARE_KEY}`);
    AccountsTheme.initialize();
    openAt(`/accounts/form/${SHARE_KEY}`);
    expect(isPageDark()).toBe(false);

    await moveTo("/accounts/login");
    expect(await screen.findByTestId("page-Login")).toBeInTheDocument();
    expect(isPageDark()).toBe(true);

    await moveTo(`/accounts/form/${SHARE_KEY}`);
    expect(await screen.findByTestId("page-Form")).toBeInTheDocument();
    expect(isPageDark()).toBe(false);
  });
});

describe("the app's wiring", () => {
  const source: (relative: string) => string = (relative: string): string => {
    return fs.readFileSync(path.join(ACCOUNTS, "src", relative), "utf8");
  };

  test("loads the theme stylesheet and follows the person's theme before it renders anything", () => {
    const index: string = source("Index.tsx");

    expect(index).toContain('import "Common/UI/Styles/Theme.css";');
    expect(index.indexOf("AccountsTheme.initialize();")).toBeGreaterThan(-1);
    expect(index.indexOf("AccountsTheme.initialize();")).toBeLessThan(
      index.indexOf("root.render("),
    );
  });

  test("draws each page it moves to in its theme", () => {
    expect(source("App.tsx").replace(/\s+/g, " ")).toContain(
      "useEffect(() => { AccountsTheme.followPage(); }, [location.pathname]);",
    );
  });
});
