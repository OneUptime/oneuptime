import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import fs from "fs";
import path from "path";

/*
 * The core Header (Admin Dashboard) and Footer (Dashboard) hand their edition
 * pill the Enterprise plugin's LicenseManager, read from the plugin door
 * inside render. With the Community stub - which is what this jest config
 * resolves the plugin specifiers to - they hand it nothing, and the pill
 * shows the license status only.
 *
 * EditionLabel is replaced with a probe that records the prop, and each door
 * with one that returns whatever the test sets (the real Community stub by
 * default). This is core, and must pass with ee/ deleted.
 */

const receivedManagers: Array<unknown> = [];

jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (props: { licenseManager?: unknown }): ReactElement => {
      receivedManagers.push(props.licenseManager);

      return <span data-testid="edition-label" />;
    },
  };
});

jest.mock("../../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return "data:image/svg+xml;base64,bG9nbw==";
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/LanguageSwitcher/LanguageSwitcher",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <span data-testid="language-switcher" />;
      },
    };
  },
);

let mockAdminPlugins: Record<string, unknown> = {};
let mockDashboardPlugins: Record<string, unknown> = {};
let adminDoorReads: number = 0;
let dashboardDoorReads: number = 0;

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/Plugins",
  () => {
    return {
      getAdminDashboardPlugins: (): Record<string, unknown> => {
        adminDoorReads += 1;
        return mockAdminPlugins;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins", () => {
  return {
    getDashboardPlugins: (): Record<string, unknown> => {
      dashboardDoorReads += 1;
      return mockDashboardPlugins;
    },
  };
});

import AdminCommunityPlugins from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/CommunityPlugins";
import DashboardCommunityPlugins from "../../../../App/FeatureSet/Dashboard/src/Enterprise/CommunityPlugins";
import AdminDashboardHeader from "../../../../App/FeatureSet/AdminDashboard/src/Components/Header/Header";
import DashboardFooter from "../../../../App/FeatureSet/Dashboard/src/Components/Footer/Footer";
import { ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS } from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/EnterprisePlugins";
import { DASHBOARD_ENTERPRISE_PLUGIN_KEYS } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePlugins";

const FakeAdminLicenseManager: () => ReactElement = (): ReactElement => {
  return <span />;
};

const FakeDashboardLicenseManager: () => ReactElement = (): ReactElement => {
  return <span />;
};

const APP_DIR: string = path.resolve(__dirname, "..", "..", "..", "..", "App");

interface Caller {
  name: string;
  file: string;
  render: () => void;
  setPlugins: (plugins: Record<string, unknown>) => void;
  communityStub: Record<string, unknown>;
  fake: () => ReactElement;
  doorReads: () => number;
}

const CALLERS: Array<Caller> = [
  {
    name: "the Admin Dashboard header",
    file: path.join(
      APP_DIR,
      "FeatureSet/AdminDashboard/src/Components/Header/Header.tsx",
    ),
    render: (): void => {
      render(<AdminDashboardHeader />);
    },
    setPlugins: (plugins: Record<string, unknown>): void => {
      mockAdminPlugins = plugins;
    },
    communityStub: AdminCommunityPlugins as Record<string, unknown>,
    fake: FakeAdminLicenseManager,
    doorReads: (): number => {
      return adminDoorReads;
    },
  },
  {
    name: "the Dashboard footer",
    file: path.join(
      APP_DIR,
      "FeatureSet/Dashboard/src/Components/Footer/Footer.tsx",
    ),
    render: (): void => {
      render(<DashboardFooter />);
    },
    setPlugins: (plugins: Record<string, unknown>): void => {
      mockDashboardPlugins = plugins;
    },
    communityStub: DashboardCommunityPlugins as Record<string, unknown>,
    fake: FakeDashboardLicenseManager,
    doorReads: (): number => {
      return dashboardDoorReads;
    },
  },
];

beforeEach(() => {
  receivedManagers.length = 0;
  adminDoorReads = 0;
  dashboardDoorReads = 0;
  mockAdminPlugins = AdminCommunityPlugins as Record<string, unknown>;
  mockDashboardPlugins = DashboardCommunityPlugins as Record<string, unknown>;
});

afterEach(() => {
  cleanup();
});

describe("LicenseManager is a key of both plugin contracts", () => {
  test("the Admin Dashboard's", () => {
    expect(ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS).toContain("LicenseManager");
  });

  test("the Dashboard's", () => {
    expect(DASHBOARD_ENTERPRISE_PLUGIN_KEYS).toContain("LicenseManager");
  });

  test("and neither Community stub provides it", () => {
    expect(
      (AdminCommunityPlugins as Record<string, unknown>)["LicenseManager"],
    ).toBeUndefined();
    expect(
      (DashboardCommunityPlugins as Record<string, unknown>)["LicenseManager"],
    ).toBeUndefined();
  });
});

describe.each(CALLERS)("$name", (caller: Caller) => {
  test("passes the plugin's LicenseManager to the edition pill", async () => {
    caller.setPlugins({ LicenseManager: caller.fake });

    await act(async () => {
      caller.render();
    });

    expect(receivedManagers).toContain(caller.fake);
    expect(
      receivedManagers.every((value: unknown): boolean => {
        return value === caller.fake;
      }),
    ).toBe(true);
  });

  test("passes nothing with the Community stub (negative control)", async () => {
    caller.setPlugins(caller.communityStub);

    await act(async () => {
      caller.render();
    });

    expect(receivedManagers.length).toBeGreaterThan(0);
    expect(
      receivedManagers.every((value: unknown): boolean => {
        return value === undefined;
      }),
    ).toBe(true);
  });

  test("reads the door while rendering, not when the module loads", async () => {
    // The module was imported above; no render has happened yet.
    expect(caller.doorReads()).toBe(0);

    await act(async () => {
      caller.render();
    });

    expect(caller.doorReads()).toBeGreaterThan(0);
  });

  test("names the prop in its source, so the wiring is not a coincidence", () => {
    const source: string = fs.readFileSync(caller.file, "utf8");

    expect(source).toMatch(
      /licenseManager=\{get(AdminDashboard|Dashboard)Plugins\(\)\.LicenseManager\}/,
    );
  });
});
