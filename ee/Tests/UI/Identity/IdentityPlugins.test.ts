import { describe, expect, test } from "@jest/globals";
import SSOPlugins, {
  SSO_PAGE_LOADERS,
  SSOPageLoader,
  SSOPluginKey,
} from "../../../Dashboard/SSO/Plugins";
import GlobalSSOPlugins, {
  GLOBAL_SSO_PAGE_LOADERS,
  GlobalSSOPageLoader,
  GlobalSSOPluginKey,
} from "../../../AdminDashboard/GlobalSSO/Plugins";
import DashboardPlugin from "../../../Dashboard/Index";
import AdminDashboardPlugin from "../../../AdminDashboard/Index";
import SettingsSSOPage from "../../../Dashboard/SSO/Pages/Settings/SSO";
import SettingsOIDCPage from "../../../Dashboard/SSO/Pages/Settings/OIDC";
import SettingsSCIMPage from "../../../Dashboard/SSO/Pages/Settings/SCIM";
import StatusPageSSOPage from "../../../Dashboard/SSO/Pages/StatusPages/SSO";
import StatusPageOIDCPage from "../../../Dashboard/SSO/Pages/StatusPages/OIDC";
import StatusPageSCIMPage from "../../../Dashboard/SSO/Pages/StatusPages/SCIM";
import GlobalSSOListPage from "../../../AdminDashboard/GlobalSSO/Pages/GlobalSSO/Index";
import GlobalSSOViewPage from "../../../AdminDashboard/GlobalSSO/Pages/GlobalSSO/View";
import GlobalOIDCListPage from "../../../AdminDashboard/GlobalSSO/Pages/GlobalOIDC/Index";
import GlobalOIDCViewPage from "../../../AdminDashboard/GlobalSSO/Pages/GlobalOIDC/View";
import { DASHBOARD_ENTERPRISE_PLUGIN_KEYS } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "@oneuptime/dashboard/Enterprise/Plugins";
import { getAdminDashboardPlugins } from "@oneuptime/admin-dashboard/Enterprise/Plugins";

/*
 * The identity plugin keys the core shells read, and the screens they load.
 *
 * Each key is React.lazy over a loader; the loaders are exported so this can
 * prove every key opens the page it names (a swapped pair - Settings OIDC
 * opening the status page OIDC screen - would type-check fine). The ee ui jest
 * project resolves "@oneuptime/ee-dashboard" to the real ee/Dashboard/Index,
 * so the door core reads is checked too.
 */

const REACT_LAZY_TYPE: symbol = Symbol.for("react.lazy");

const DASHBOARD_PAGES: Record<SSOPluginKey, unknown> = {
  SettingsSSO: SettingsSSOPage,
  SettingsOIDC: SettingsOIDCPage,
  SettingsSCIM: SettingsSCIMPage,
  StatusPageSSO: StatusPageSSOPage,
  StatusPageOIDC: StatusPageOIDCPage,
  StatusPageSCIM: StatusPageSCIMPage,
};

const ADMIN_PAGES: Record<GlobalSSOPluginKey, unknown> = {
  GlobalSSOList: GlobalSSOListPage,
  GlobalSSOView: GlobalSSOViewPage,
  GlobalOIDCList: GlobalOIDCListPage,
  GlobalOIDCView: GlobalOIDCViewPage,
};

const DASHBOARD_KEYS: Array<SSOPluginKey> = Object.keys(
  DASHBOARD_PAGES,
) as Array<SSOPluginKey>;

const ADMIN_KEYS: Array<GlobalSSOPluginKey> = Object.keys(
  ADMIN_PAGES,
) as Array<GlobalSSOPluginKey>;

const isLazy: (value: unknown) => boolean = (value: unknown): boolean => {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $$typeof?: symbol }).$$typeof === REACT_LAZY_TYPE
  );
};

describe("Dashboard identity plugins (ee/Dashboard/SSO)", () => {
  test("provide exactly the six identity screens", () => {
    expect(Object.keys(SSOPlugins).sort()).toEqual([...DASHBOARD_KEYS].sort());
    expect(Object.keys(SSO_PAGE_LOADERS).sort()).toEqual(
      [...DASHBOARD_KEYS].sort(),
    );
  });

  test("every key is one the Dashboard's plugin contract knows", () => {
    for (const key of DASHBOARD_KEYS) {
      expect(DASHBOARD_ENTERPRISE_PLUGIN_KEYS).toContain(key);
    }
  });

  test.each(DASHBOARD_KEYS)(
    "%s loads its own page",
    async (key: SSOPluginKey) => {
      const loader: SSOPageLoader = SSO_PAGE_LOADERS[key];
      const loaded: { default: unknown } = await loader();

      expect(loaded.default).toBe(DASHBOARD_PAGES[key]);
    },
  );

  test.each(DASHBOARD_KEYS)(
    "%s is React.lazy, so the screen downloads only when opened",
    (key: SSOPluginKey) => {
      expect(isLazy(SSOPlugins[key])).toBe(true);
    },
  );

  test("the six pages are six different screens", () => {
    expect(new Set(Object.values(DASHBOARD_PAGES)).size).toBe(6);
  });

  test("the assembled Dashboard plugin carries them, and so does the door core reads", () => {
    const door: Record<string, unknown> = getDashboardPlugins() as Record<
      string,
      unknown
    >;

    expect(door).toBe(DashboardPlugin);

    for (const key of DASHBOARD_KEYS) {
      expect((DashboardPlugin as Record<string, unknown>)[key]).toBe(
        SSOPlugins[key],
      );
      expect(door[key]).toBe(SSOPlugins[key]);
    }
  });
});

describe("Admin Dashboard identity plugins (ee/AdminDashboard/GlobalSSO)", () => {
  test("provide exactly the four Global SSO / OIDC screens", () => {
    expect(Object.keys(GlobalSSOPlugins).sort()).toEqual(
      [...ADMIN_KEYS].sort(),
    );
    expect(Object.keys(GLOBAL_SSO_PAGE_LOADERS).sort()).toEqual(
      [...ADMIN_KEYS].sort(),
    );
  });

  test("every key is one the Admin Dashboard's plugin contract knows", () => {
    for (const key of ADMIN_KEYS) {
      expect(ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS).toContain(key);
    }
  });

  test.each(ADMIN_KEYS)(
    "%s loads its own page",
    async (key: GlobalSSOPluginKey) => {
      const loader: GlobalSSOPageLoader = GLOBAL_SSO_PAGE_LOADERS[key];
      const loaded: { default: unknown } = await loader();

      expect(loaded.default).toBe(ADMIN_PAGES[key]);
    },
  );

  test.each(ADMIN_KEYS)(
    "%s is React.lazy, so the screen downloads only when opened",
    (key: GlobalSSOPluginKey) => {
      expect(isLazy(GlobalSSOPlugins[key])).toBe(true);
    },
  );

  test("the four pages are four different screens", () => {
    expect(new Set(Object.values(ADMIN_PAGES)).size).toBe(4);
  });

  test("the assembled Admin Dashboard plugin carries them, and so does the door core reads", () => {
    const door: Record<string, unknown> = getAdminDashboardPlugins() as Record<
      string,
      unknown
    >;

    expect(door).toBe(AdminDashboardPlugin);

    for (const key of ADMIN_KEYS) {
      expect((AdminDashboardPlugin as Record<string, unknown>)[key]).toBe(
        GlobalSSOPlugins[key],
      );
      expect(door[key]).toBe(GlobalSSOPlugins[key]);
    }
  });
});
