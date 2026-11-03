import API from "../../../UI/Utils/API/API";
import { KEYS_KEPT_AFTER_SIGN_OUT } from "../../../UI/Utils/KeptAfterSignOut";
import ThemeUtil, {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  Theme,
  ThemePreference,
} from "../../../UI/Utils/Theme";
import UserUtil from "../../../UI/Utils/User";
import Timezone from "../../../Types/Timezone";
import OneUptimeDate from "../../../Types/Date";
import CookieName from "../../../Types/CookieName";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Signing out forgets the person, not the browser (UI/Utils/
 * KeptAfterSignOut.ts).
 *
 * Everything here is the real UserUtil.logout() on the browser's own storage;
 * only its call to the server is answered here. Issue #5404: it emptied local
 * storage, so a person's theme was gone before the sign-in page could read
 * it, and a device set the other way drew the sign-in page and the app in the
 * wrong theme from then on.
 */

const DEVICE: { prefersDark: boolean } = { prefersDark: false };

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList => {
    return {
      media: query,
      matches: query === DARK_COLOR_SCHEME_MEDIA_QUERY && DEVICE.prefersDark,
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
    } as unknown as MediaQueryList;
  },
});

const fillBrowser: (entries: Record<string, string>) => void = (
  entries: Record<string, string>,
): void => {
  for (const key of Object.keys(entries)) {
    window.localStorage.setItem(key, entries[key]!);
  }
};

const whatTheBrowserKeeps: () => Record<string, string> = (): Record<
  string,
  string
> => {
  const kept: Record<string, string> = {};

  for (let index: number = 0; index < window.localStorage.length; index++) {
    const key: string = window.localStorage.key(index)!;
    kept[key] = window.localStorage.getItem(key)!;
  }

  return kept;
};

/*
 * What stays, under the names the pages read: spelled out rather than taken
 * from the constants, as a pick is lost as surely by a key renamed on one side
 * as by a key removed.
 */
const THE_BROWSERS_OWN: Record<string, string> = {
  // The Dashboard, the Admin Dashboard and the sign-in pages.
  "oneuptime-dashboard-theme": "dark",
  oneuptimeLang: "de",
  // Status pages and public dashboards on this address.
  "oneuptime-status-page-theme": "dark",
  statusPageLang: "fr",
  statusPageLangUserChoice: "true",
  "oneuptime-public-dashboard-theme": "dark",
  // The docs and the API reference.
  "oneuptime-docs-theme": "dark",
  "oneuptime-reference-theme": "dark",
  // The answer on the cookie banner.
  cookiesAccepted: "false",
};

const DASHBOARD_ID: string = "11111111-1111-4111-8111-111111111111";
const WIDGET_ID: string = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_ID: string = "44444444-4444-4444-8444-444444444444";
const STATUS_PAGE_ID: string = "55555555-5555-4555-8555-555555555555";

const THE_PERSONS_OWN: Record<string, string> = {
  // Who they are.
  user_id: USER_ID,
  user_name: "Ada Lovelace",
  user_email: '{"_type":"Email","value":"ada@example.com"}',
  token: "a-session-token",
  profile_pic_id: USER_ID,
  is_master_admin: "true",
  // Their settings, read again from their account at sign-in.
  user_timezone: "Europe/Berlin",
  user_timezone_dismissed: "Europe/Berlin",
  // Their work.
  project: '{"_id":"' + PROJECT_ID + '","name":"Acme"}',
  ["project_" + PROJECT_ID]: '{"name":"Acme"}',
  last_accessed_project_id: PROJECT_ID,
  [PROJECT_ID + "_isSubscriptionInactive"]: "false",
  [PROJECT_ID + "_isSubscriptionOverdue"]: "false",
  global_permissions: "{}",
  "global-permissions-hash": "abc",
  // Their role in each project they opened (UI/Utils/Permission).
  ["project_permissions:" + PROJECT_ID]: "{}",
  ["project-permissions-hash:" + PROJECT_ID]: "abc",
  // The one name every project shared, as a tab of the version before left it.
  project_permissions: "{}",
  "project-permissions-hash": "abc",
  initialUrl: "https://oneuptime.example.com/dashboard/" + PROJECT_ID,
  cardRegistered: "true",
  "session-refreshed-at:dashboard": "1798761600000",
  ["backup-code-offer-skipped-at:" + USER_ID]: "1798761600000",
  // How they read tables: theirs, and the next person finds them as drawn.
  ["TableColumnWidths." + USER_ID + ".monitors"]: '{"name":320}',
  ["TableDensity." + USER_ID]: '{"density":"compact"}',
  "BaseModelTablePageSize.monitors": "50",
  "BaseModelTableColumns.monitors": "{}",
  // What they looked at on a dashboard: docs/dashboards says it is theirs alone.
  ["oneuptime-dashboard-time-range:" + DASHBOARD_ID]: "OneDay",
  ["oneuptime-dashboard-auto-refresh:" + DASHBOARD_ID]: "1m",
  ["oneuptime-dashboard-widget-sort-" + WIDGET_ID + ":" + DASHBOARD_ID]:
    "name:asc",
  // A sign-in to a status page on this address.
  [STATUS_PAGE_ID + "user_email"]:
    '{"_type":"Email","value":"ada@example.com"}',
  ["masterPasswordValidated-" + STATUS_PAGE_ID]: "true",
  // Attribution, read at sign-up, and what measurement kept.
  utm_source: "google",
  clickIds: '{"gclid":"abc"}',
  firstTouch: '{"landingUrl":"https://oneuptime.com/"}',
  ph_phc_project_posthog: "{}",
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  DEVICE.prefersDark = false;
  jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
});

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("the theme a person picked (issue #5404)", () => {
  test.each([
    {
      steps: "Dark on a light device",
      pick: ThemePreference.Dark,
      prefersDark: false,
      drawn: Theme.Dark,
    },
    {
      steps: "Light on a dark device",
      pick: ThemePreference.Light,
      prefersDark: true,
      drawn: Theme.Light,
    },
    {
      steps: "Dark on a dark device",
      pick: ThemePreference.Dark,
      prefersDark: true,
      drawn: Theme.Dark,
    },
    {
      steps: "Light on a light device",
      pick: ThemePreference.Light,
      prefersDark: false,
      drawn: Theme.Light,
    },
    {
      steps: "System on a dark device",
      pick: ThemePreference.System,
      prefersDark: true,
      drawn: Theme.Dark,
    },
    {
      steps: "System on a light device",
      pick: ThemePreference.System,
      prefersDark: false,
      drawn: Theme.Light,
    },
  ])(
    "$steps: the pick is still the pick after logging out",
    (data: { pick: ThemePreference; prefersDark: boolean; drawn: Theme }) => {
      DEVICE.prefersDark = data.prefersDark;
      ThemeUtil.setPreference(data.pick);

      UserUtil.logout();

      expect(ThemeUtil.getPreference()).toBe(data.pick);
      expect(ThemeUtil.getPreferredTheme()).toBe(data.drawn);
    },
  );

  test("a browser where nobody picked still has no pick, and the device decides", () => {
    DEVICE.prefersDark = true;

    UserUtil.logout();

    expect(window.localStorage.getItem("oneuptime-dashboard-theme")).toBeNull();
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.System);
    expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Dark);
  });

  test("the pick stands however many times the session ends", () => {
    ThemeUtil.setPreference(ThemePreference.Dark);

    UserUtil.logout();
    UserUtil.logout();
    UserUtil.logout();

    expect(ThemeUtil.getPreference()).toBe(ThemePreference.Dark);
  });

  test("a pick made after logging out replaces the kept one", () => {
    ThemeUtil.setPreference(ThemePreference.Dark);
    UserUtil.logout();

    ThemeUtil.setPreference(ThemePreference.Light);
    UserUtil.logout();

    expect(ThemeUtil.getPreference()).toBe(ThemePreference.Light);
  });

  test("a value an older or newer version wrote stays as it is, read as no pick", () => {
    window.localStorage.setItem("oneuptime-dashboard-theme", "midnight");

    UserUtil.logout();

    expect(window.localStorage.getItem("oneuptime-dashboard-theme")).toBe(
      "midnight",
    );
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.System);
  });
});

describe("what stays, and what goes", () => {
  test("everything the browser keeps for itself stays, as it was written", () => {
    fillBrowser(THE_BROWSERS_OWN);

    UserUtil.logout();

    expect(whatTheBrowserKeeps()).toEqual(THE_BROWSERS_OWN);
  });

  test("that is all that stays: everything of the person's goes", () => {
    fillBrowser({ ...THE_BROWSERS_OWN, ...THE_PERSONS_OWN });

    UserUtil.logout();

    expect(whatTheBrowserKeeps()).toEqual(THE_BROWSERS_OWN);
  });

  test.each(Object.keys(THE_PERSONS_OWN))("%s goes", (key: string) => {
    fillBrowser({ [key]: THE_PERSONS_OWN[key]! });

    UserUtil.logout();

    expect(window.localStorage.getItem(key)).toBeNull();
  });

  test.each(Object.keys(THE_BROWSERS_OWN))("%s stays", (key: string) => {
    fillBrowser({ [key]: THE_BROWSERS_OWN[key]! });

    UserUtil.logout();

    expect(window.localStorage.getItem(key)).toBe(THE_BROWSERS_OWN[key]);
  });

  test("a name nothing here has heard of goes: what is kept is named, never assumed", () => {
    fillBrowser({
      "a-setting-added-next-year": "private",
      "oneuptime-dashboard-theme-of-someone-else": "dark",
      ["oneuptime-dashboard-theme:" + USER_ID]: "dark",
      "ONEUPTIME-DASHBOARD-THEME": "dark",
      oneuptimeLangBackup: "de",
    });

    UserUtil.logout();

    expect(whatTheBrowserKeeps()).toEqual({});
  });

  test("what a person's picks on a dashboard are named goes, for that is their own", () => {
    fillBrowser({
      ["oneuptime-dashboard-time-range:" + DASHBOARD_ID]: "OneDay",
      ["oneuptime-dashboard-auto-refresh:" + DASHBOARD_ID]: "1m",
      ["oneuptime-dashboard-widget-sort-" + WIDGET_ID + ":" + DASHBOARD_ID]:
        "name:asc",
      "oneuptime-dashboard-theme": "dark",
    });

    UserUtil.logout();

    expect(whatTheBrowserKeeps()).toEqual({
      "oneuptime-dashboard-theme": "dark",
    });
  });

  test("the list names exactly what these tests call the browser's own", () => {
    expect([...KEYS_KEPT_AFTER_SIGN_OUT].sort()).toEqual(
      Object.keys(THE_BROWSERS_OWN).sort(),
    );
  });
});

describe("the rest of signing out is as it was", () => {
  test("session storage is emptied, the kept names included", () => {
    window.sessionStorage.setItem("anything", "1");
    window.sessionStorage.setItem("oneuptime-dashboard-theme", "dark");

    UserUtil.logout();

    expect(window.sessionStorage.length).toBe(0);
  });

  test("every session cookie goes", () => {
    for (const name of Object.values(CookieName)) {
      document.cookie = `${name}=value; path=/`;
    }

    UserUtil.logout();

    for (const name of Object.values(CookieName)) {
      expect(document.cookie).not.toContain(`${name}=`);
    }
  });

  test("the next person on this browser does not inherit the timezone", () => {
    UserUtil.setSavedUserTimezone(Timezone.EuropeBerlin);
    expect(OneUptimeDate.getUserTimezone()).toBe(Timezone.EuropeBerlin);

    UserUtil.logout();

    expect(OneUptimeDate.getUserTimezone()).toBeNull();
    expect(UserUtil.getSavedUserTimezone()).toBeNull();
  });

  test("the person is no longer signed in", () => {
    window.localStorage.setItem("user_email", "ada@example.com");
    expect(UserUtil.isLoggedIn()).toBe(true);

    UserUtil.logout();

    expect(UserUtil.isLoggedIn()).toBe(false);
  });

  test("the server is told, once", () => {
    UserUtil.logout();

    expect(API.post).toHaveBeenCalledTimes(1);
  });

  test("the browser is left as it should be when the server cannot be told", async () => {
    jest.spyOn(API, "post").mockRejectedValue(new Error("Network down"));
    fillBrowser({ ...THE_BROWSERS_OWN, ...THE_PERSONS_OWN });

    UserUtil.logout();

    await Promise.resolve();

    expect(whatTheBrowserKeeps()).toEqual(THE_BROWSERS_OWN);
  });
});

describe("UserUtil.clear", () => {
  test("keeps the same things logging out keeps", () => {
    fillBrowser({ ...THE_BROWSERS_OWN, ...THE_PERSONS_OWN });

    UserUtil.clear();

    expect(whatTheBrowserKeeps()).toEqual(THE_BROWSERS_OWN);
  });
});
