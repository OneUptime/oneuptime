import { describe, expect, test } from "@jest/globals";
import IdentityPlugins, {
  IDENTITY_PAGE_LOADERS,
  IdentityPageLoader,
  IdentityPluginKey,
} from "../../../Dashboard/Identity/Plugins";
import DashboardPlugin from "../../../Dashboard/Index";
import AdminDashboardPlugin from "../../../AdminDashboard/Index";
import SettingsSCIMPage from "../../../Dashboard/Identity/Pages/Settings/SCIM";
import StatusPageSCIMPage from "../../../Dashboard/Identity/Pages/StatusPages/SCIM";
import { DASHBOARD_ENTERPRISE_PLUGIN_KEYS } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "@oneuptime/dashboard/Enterprise/Plugins";
import { getAdminDashboardPlugins } from "@oneuptime/admin-dashboard/Enterprise/Plugins";

/*
 * The identity plugin keys the core SCIM shells read, and the screens they
 * load.
 *
 * Each key is React.lazy over a loader; the loaders are exported so this can
 * prove every key opens the page it names (a swapped pair - Settings SCIM
 * opening the status page SCIM screen - would type-check fine). The ee ui jest
 * project resolves "@oneuptime/ee-dashboard" to the real ee/Dashboard/Index,
 * so the door core reads is checked too.
 *
 * Single sign-on has no key: its screens are core pages in every edition, on
 * both frontends, so neither assembled Enterprise plugin carries one.
 */

const REACT_LAZY_TYPE: symbol = Symbol.for("react.lazy");

const DASHBOARD_PAGES: Record<IdentityPluginKey, unknown> = {
  SettingsSCIM: SettingsSCIMPage,
  StatusPageSCIM: StatusPageSCIMPage,
};

const DASHBOARD_KEYS: Array<IdentityPluginKey> = Object.keys(
  DASHBOARD_PAGES,
) as Array<IdentityPluginKey>;

// The keys that served the single sign-on screens from ee/ before they became core.
const RETIRED_DASHBOARD_SSO_KEYS: Array<string> = [
  "SettingsSSO",
  "SettingsOIDC",
  "StatusPageSSO",
  "StatusPageOIDC",
];

const RETIRED_ADMIN_SSO_KEYS: Array<string> = [
  "GlobalSSOList",
  "GlobalSSOView",
  "GlobalOIDCList",
  "GlobalOIDCView",
];

const isLazy: (value: unknown) => boolean = (value: unknown): boolean => {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $$typeof?: symbol }).$$typeof === REACT_LAZY_TYPE
  );
};

describe("Dashboard identity plugins (ee/Dashboard/Identity)", () => {
  test("provide exactly the two SCIM screens", () => {
    expect(Object.keys(IdentityPlugins).sort()).toEqual(
      [...DASHBOARD_KEYS].sort(),
    );
    expect(Object.keys(IDENTITY_PAGE_LOADERS).sort()).toEqual(
      [...DASHBOARD_KEYS].sort(),
    );
    expect([...DASHBOARD_KEYS].sort()).toEqual([
      "SettingsSCIM",
      "StatusPageSCIM",
    ]);
  });

  test("every key is one the Dashboard's plugin contract knows", () => {
    for (const key of DASHBOARD_KEYS) {
      expect(DASHBOARD_ENTERPRISE_PLUGIN_KEYS).toContain(key);
    }
  });

  test.each(DASHBOARD_KEYS)(
    "%s loads its own page",
    async (key: IdentityPluginKey) => {
      const loader: IdentityPageLoader = IDENTITY_PAGE_LOADERS[key];
      const loaded: { default: unknown } = await loader();

      expect(loaded.default).toBe(DASHBOARD_PAGES[key]);
    },
  );

  test.each(DASHBOARD_KEYS)(
    "%s is React.lazy, so the screen downloads only when opened",
    (key: IdentityPluginKey) => {
      expect(isLazy(IdentityPlugins[key])).toBe(true);
    },
  );

  test("the two pages are two different screens", () => {
    expect(new Set(Object.values(DASHBOARD_PAGES)).size).toBe(2);
  });

  test("the assembled Dashboard plugin carries them, and so does the door core reads", () => {
    const door: Record<string, unknown> = getDashboardPlugins() as Record<
      string,
      unknown
    >;

    expect(door).toBe(DashboardPlugin);

    for (const key of DASHBOARD_KEYS) {
      expect((DashboardPlugin as Record<string, unknown>)[key]).toBe(
        IdentityPlugins[key],
      );
      expect(door[key]).toBe(IdentityPlugins[key]);
    }
  });
});

describe("single sign-on is not an Enterprise plugin", () => {
  test("the Dashboard's plugin contract has no single sign-on screen", () => {
    for (const key of RETIRED_DASHBOARD_SSO_KEYS) {
      expect(
        DASHBOARD_ENTERPRISE_PLUGIN_KEYS as ReadonlyArray<string>,
      ).not.toContain(key);
    }
  });

  test("the assembled Dashboard plugin, and the door core reads, carry no single sign-on screen", () => {
    const pluginKeys: Array<string> = Object.keys(DashboardPlugin);
    const doorKeys: Array<string> = Object.keys(getDashboardPlugins());

    for (const key of RETIRED_DASHBOARD_SSO_KEYS) {
      expect(pluginKeys).not.toContain(key);
      expect(doorKeys).not.toContain(key);
    }
  });

  test("the assembled Admin Dashboard plugin, and its door, carry no Global SSO or Global OIDC screen", () => {
    const pluginKeys: Array<string> = Object.keys(AdminDashboardPlugin);
    const doorKeys: Array<string> = Object.keys(getAdminDashboardPlugins());

    for (const key of RETIRED_ADMIN_SSO_KEYS) {
      expect(pluginKeys).not.toContain(key);
      expect(doorKeys).not.toContain(key);
    }
  });
});
