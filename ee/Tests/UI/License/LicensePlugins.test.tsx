import LicenseManager from "../../../AdminDashboard/License/LicenseManager";
import AdminLicensePlugins from "../../../AdminDashboard/License/Plugins";
import AdminDashboardPlugin from "../../../AdminDashboard/Index";
import DashboardLicensePlugins from "../../../Dashboard/License/Plugins";
import DashboardPlugin from "../../../Dashboard/Index";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import { LicenseManagerComponent } from "Common/UI/Components/EditionLabel/LicenseManager";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import { getAdminDashboardPlugins } from "@oneuptime/admin-dashboard/Enterprise/Plugins";
import AdminDashboardHeader from "@oneuptime/admin-dashboard/Components/Header/Header";
import { getDashboardPlugins } from "@oneuptime/dashboard/Enterprise/Plugins";
import DashboardFooter from "@oneuptime/dashboard/Components/Footer/Footer";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The license manager as the Enterprise image wires it: both Enterprise UI
 * plugins carry it under LicenseManager, the core plugin doors hand it out
 * (resolved here to the REAL ee plugins, as in the Enterprise bundle), and the
 * core Header and Footer pass it to their edition pill, whose dialog then
 * offers a master admin the license controls. Also pins what the shared
 * implementation may import, so it keeps bundling into both frontends.
 */

let isEnterpriseEdition: boolean = true;
let billingEnabled: boolean = false;
let isMasterAdmin: boolean = true;

jest.mock("Common/UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return isEnterpriseEdition;
    },
  });

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabled;
    },
  });

  return mockedConfig;
});

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdmin;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
        i18n: { language: "en", changeLanguage: (): void => {} },
      };
    },
  };
});

/*
 * The header logo reads its image as a data URL; the jest asset stub is an
 * object.
 */
jest.mock("Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return "data:image/svg+xml;base64,bG9nbw==";
});

// The footer's language menu is not what this suite is about.
jest.mock("@oneuptime/dashboard/Components/LanguageSwitcher/LanguageSwitcher", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <span data-testid="language-switcher" />;
    },
  };
});

interface FetchCall {
  method: string;
  url: string;
  data: JSONObject | undefined;
}

const fetchCalls: Array<FetchCall> = [];

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (options: {
        method: { toString: () => string };
        url: { toString: () => string };
        data?: JSONObject | undefined;
      }): Promise<HTTPResponse<JSONObject>> => {
        fetchCalls.push({
          method: options.method.toString(),
          url: options.url.toString(),
          data: options.data,
        });

        // A master admin's view of an installation that has no license yet.
        return Promise.resolve(
          new HTTPResponse<JSONObject>(
            200,
            {
              edition: isEnterpriseEdition ? "enterprise" : "community",
              status: isEnterpriseEdition ? "missing" : null,
              verification: "none",
              licenseValid: false,
              licenseKey: null,
              token: null,
              instances: [],
              currentVersion: "13.0.0",
              latestVersion: "13.0.0",
            },
            {},
          ),
        );
      },
      get: (): Promise<HTTPResponse<JSONObject>> => {
        return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
      },
      getFriendlyMessage: (err: unknown): string => {
        if (err instanceof HTTPErrorResponse) {
          return err.message;
        }

        return String(err);
      },
    },
  };
});

const REACT_LAZY_TYPE: symbol = Symbol.for("react.lazy");
const LICENSE_KEY_PLACEHOLDER: string = "Enter your enterprise license key";

const openPill: (name: RegExp) => Promise<void> = async (
  name: RegExp,
): Promise<void> => {
  await waitFor(() => {
    expect(fetchCalls.length).toBeGreaterThan(0);
  });

  fireEvent.click(screen.getByRole("button", { name }));
};

beforeEach(() => {
  fetchCalls.length = 0;
  isEnterpriseEdition = true;
  billingEnabled = false;
  isMasterAdmin = true;
});

afterEach(() => {
  cleanup();
});

describe("the LicenseManager plugin key", () => {
  it("is the shared license manager in both Enterprise plugins", () => {
    expect(AdminLicensePlugins.LicenseManager).toBe(LicenseManager);
    expect(DashboardLicensePlugins.LicenseManager).toBe(LicenseManager);
    expect(AdminDashboardPlugin.LicenseManager).toBe(LicenseManager);
    expect(DashboardPlugin.LicenseManager).toBe(LicenseManager);
  });

  it("is what the core plugin doors hand out in the Enterprise build", () => {
    expect(getAdminDashboardPlugins().LicenseManager).toBe(LicenseManager);
    expect(getDashboardPlugins().LicenseManager).toBe(LicenseManager);
  });

  /*
   * It wraps the dialog and is mounted with the pill on every page: a lazy
   * component would suspend the pill's dialog with no boundary to catch it.
   */
  it("is a plain component, never React.lazy", () => {
    const manager: LicenseManagerComponent = getAdminDashboardPlugins()
      .LicenseManager as LicenseManagerComponent;

    expect(typeof manager).toBe("function");
    expect(
      (manager as unknown as { $$typeof?: symbol }).$$typeof,
    ).not.toBe(REACT_LAZY_TYPE);
  });

  it("each area plugin provides that key only", () => {
    expect(Object.keys(AdminLicensePlugins)).toEqual(["LicenseManager"]);
    expect(Object.keys(DashboardLicensePlugins)).toEqual(["LicenseManager"]);
  });
});

describe("the edition dialog with the manager from each plugin door", () => {
  it.each([
    ["Admin Dashboard", getAdminDashboardPlugins],
    ["Dashboard", getDashboardPlugins],
  ])(
    "%s: a master admin is offered the license input",
    async (
      _name: string,
      getPlugins: () => { LicenseManager?: LicenseManagerComponent | undefined },
    ) => {
      render(<EditionLabel licenseManager={getPlugins().LicenseManager} />);

      await openPill(/Enterprise Edition/);

      expect(
        await screen.findByPlaceholderText(LICENSE_KEY_PLACEHOLDER),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("switch-license-activation-mode"),
      ).toBeInTheDocument();
    },
  );
});

describe("the core header and footer in the Enterprise build", () => {
  it("the Admin Dashboard header's edition pill manages the license", async () => {
    render(<AdminDashboardHeader />);

    await openPill(/Enterprise Edition/);

    expect(
      await screen.findByPlaceholderText(LICENSE_KEY_PLACEHOLDER),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Validate License" }),
    ).toBeInTheDocument();
  });

  it("the Dashboard footer's edition pill manages the license", async () => {
    render(<DashboardFooter />);

    await openPill(/Enterprise Edition/);

    expect(
      await screen.findByPlaceholderText(LICENSE_KEY_PLACEHOLDER),
    ).toBeInTheDocument();
  });

  it("somebody who is not a master admin gets no license controls from either", async () => {
    isMasterAdmin = false;

    render(<AdminDashboardHeader />);
    await openPill(/Enterprise Edition/);

    expect(
      await screen.findByText("A master admin has to activate this license"),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(LICENSE_KEY_PLACEHOLDER),
    ).not.toBeInTheDocument();

    cleanup();
    fetchCalls.length = 0;

    render(<DashboardFooter />);
    await openPill(/Enterprise Edition/);

    expect(
      await screen.findByText("A master admin has to activate this license"),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(LICENSE_KEY_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });
});

/*
 * ONEUPTIME_EDITION=community on the Enterprise image: the bundle carries the
 * manager, but the server runs the Community Edition, so there is no license
 * to manage and the dialog is the Community one.
 */
describe("the Community Edition, with the manager in the bundle", () => {
  it("shows no license controls and sends nothing", async () => {
    isEnterpriseEdition = false;

    render(<EditionLabel licenseManager={LicenseManager} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Community Edition, Learn more" }),
    );

    expect(
      await screen.findByText(/You are running the Community Edition/),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(LICENSE_KEY_PLACEHOLDER),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("switch-license-activation-mode"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("refresh-enterprise-license"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Talk to Sales" }),
    ).toBeInTheDocument();
    expect(
      fetchCalls.filter((call: FetchCall): boolean => {
        return call.method !== "GET";
      }),
    ).toEqual([]);
  });

  it("renders nothing with billing enabled (oneuptime.com)", () => {
    billingEnabled = true;

    const { container } = render(
      <EditionLabel licenseManager={LicenseManager} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(fetchCalls).toHaveLength(0);
  });
});

/*
 * ee/Dashboard/License/Plugins.ts imports the manager from
 * ee/AdminDashboard/License, so the file has to bundle into BOTH frontends:
 * Common/..., react and its own directory only. "@oneuptime/admin-dashboard/..."
 * would bundle into the Admin Dashboard and break the Dashboard.
 */
describe("what the shared license manager imports", () => {
  const LICENSE_DIR: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "AdminDashboard",
    "License",
  );

  const SPECIFIER: RegExp =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

  type FindForbiddenFunction = (source: string) => Array<string>;

  const findForbiddenSpecifiers: FindForbiddenFunction = (
    source: string,
  ): Array<string> => {
    const forbidden: Array<string> = [];

    for (const match of source.matchAll(SPECIFIER)) {
      const specifier: string = match[1] || "";

      const allowed: boolean =
        specifier === "react" ||
        specifier.startsWith("Common/") ||
        (specifier.startsWith("./") && !specifier.includes(".."));

      if (!allowed) {
        forbidden.push(specifier);
      }
    }

    return forbidden;
  };

  it("imports only Common/..., react and its own directory", () => {
    const source: string = fs.readFileSync(
      path.join(LICENSE_DIR, "LicenseManager.tsx"),
      "utf8",
    );

    expect(source).toContain('from "Common/UI/Utils/API/API"');
    expect(findForbiddenSpecifiers(source)).toEqual([]);
  });

  it("the check flags a frontend-only or relative-outside import (negative control)", () => {
    expect(
      findForbiddenSpecifiers(
        [
          'import A from "@oneuptime/admin-dashboard/Utils/PageMap";',
          'import B from "../Health/Queues";',
          'import C from "react-router-dom";',
          'const D = await import("@oneuptime/dashboard/Utils/Foo");',
          'import E from "Common/UI/Components/Icon/Icon";',
        ].join("\n"),
      ),
    ).toEqual([
      "@oneuptime/admin-dashboard/Utils/PageMap",
      "../Health/Queues",
      "react-router-dom",
      "@oneuptime/dashboard/Utils/Foo",
    ]);
  });
});
