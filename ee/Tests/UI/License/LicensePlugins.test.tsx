import LicenseDetails from "../../../AdminDashboard/License/LicenseDetails";
import AdminLicensePlugins from "../../../AdminDashboard/License/Plugins";
import LicenseSideMenuItem from "../../../AdminDashboard/License/LicenseSideMenuItem";
import { isLicenseSettingsAvailable } from "../../../AdminDashboard/License/LicenseSettingsAPI";
import {
  ENTERPRISE_SETTINGS_AREAS,
  EnterpriseSettingsSideMenuItems,
} from "../../../AdminDashboard/EnterpriseSettings";
import AdminDashboardPlugin from "../../../AdminDashboard/Index";
import DashboardLicensePlugins from "../../../Dashboard/License/Plugins";
import DashboardPlugin from "../../../Dashboard/Index";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import { LicenseDetailsComponent } from "Common/UI/Components/EditionLabel/LicenseDetails";
import { LICENSE_SETTINGS_PAGE_PATH } from "Common/UI/Components/EditionLabel/LicenseSettingsPage";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import Navigation from "Common/UI/Utils/Navigation";
import { getAdminDashboardPlugins } from "@oneuptime/admin-dashboard/Enterprise/Plugins";
import {
  EnterpriseSettingsPage,
  getEnterpriseSettingsPageRoute,
} from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import SettingsSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
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
 * The license as the Enterprise image wires it: both Enterprise UI plugins
 * carry the read-only LicenseDetails, the core plugin doors hand it out
 * (resolved here to the REAL ee plugins, as in the Enterprise bundle), and the
 * core Header and Footer pass it to their edition pill, whose dialog shows the
 * license and sends a master admin to Settings > License. That page is the
 * Admin Dashboard's alone.
 *
 * Also pins the line all of this is for: nothing in any frontend writes the
 * license but that page, and the Dashboard's bundle cannot reach it. And what
 * the shared details may import, so they keep bundling into both frontends.
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

// An import of any kind, for the checks that read source.
const SPECIFIER: RegExp =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

const LICENSE_KEY_PLACEHOLDER: string = "Enter your enterprise license key";

// Nothing that changes the license is on screen.
const expectNoWriteControls: () => void = (): void => {
  expect(
    screen.queryByPlaceholderText(LICENSE_KEY_PLACEHOLDER),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("enterprise-license-token-input"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("switch-license-activation-mode"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("refresh-enterprise-license"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("change-enterprise-license"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Change license key")).not.toBeInTheDocument();
  expect(screen.queryByText("Replace license")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Validate License|Activate License/ }),
  ).not.toBeInTheDocument();
};

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

describe("the LicenseDetails plugin key", () => {
  it("is the shared license details in both Enterprise plugins", () => {
    expect(AdminLicensePlugins.LicenseDetails).toBe(LicenseDetails);
    expect(DashboardLicensePlugins.LicenseDetails).toBe(LicenseDetails);
    expect(AdminDashboardPlugin.LicenseDetails).toBe(LicenseDetails);
    expect(DashboardPlugin.LicenseDetails).toBe(LicenseDetails);
  });

  it("is what the core plugin doors hand out in the Enterprise build", () => {
    expect(getAdminDashboardPlugins().LicenseDetails).toBe(LicenseDetails);
    expect(getDashboardPlugins().LicenseDetails).toBe(LicenseDetails);
  });

  /*
   * The dialog has no Suspense around it: a lazy component would suspend the
   * edition pill's dialog with no boundary to catch it.
   */
  it("is a plain component, never React.lazy", () => {
    const details: LicenseDetailsComponent = getAdminDashboardPlugins()
      .LicenseDetails as LicenseDetailsComponent;

    expect(typeof details).toBe("function");
    expect(
      (details as unknown as { $$typeof?: symbol }).$$typeof,
    ).not.toBe(REACT_LAZY_TYPE);
  });

  it("is all the Dashboard's area plugin provides", () => {
    expect(Object.keys(DashboardLicensePlugins)).toEqual(["LicenseDetails"]);
  });

  it("comes with the settings page in the Admin Dashboard's", () => {
    expect(Object.keys(AdminLicensePlugins).sort()).toEqual([
      "LicenseDetails",
      "SettingsPages",
      "SettingsSideMenuItems",
    ]);
  });
});

describe("the edition dialog with the details from each plugin door", () => {
  it.each([
    ["Admin Dashboard", getAdminDashboardPlugins],
    ["Dashboard", getDashboardPlugins],
  ])(
    "%s: a master admin is shown the license and led to the page that changes it",
    async (
      _name: string,
      getPlugins: () => { LicenseDetails?: LicenseDetailsComponent | undefined },
    ) => {
      render(<EditionLabel licenseDetails={getPlugins().LicenseDetails} />);

      await openPill(/Enterprise Edition/);

      expect(
        await screen.findByRole("button", { name: "Manage license" }),
      ).toBeInTheDocument();
      expectNoWriteControls();
    },
  );
});

describe("the core header and footer in the Enterprise build", () => {
  it("the Admin Dashboard header's edition pill only shows the license", async () => {
    render(<AdminDashboardHeader />);

    await openPill(/Enterprise Edition/);

    expect(
      await screen.findByRole("button", { name: "Manage license" }),
    ).toBeInTheDocument();
    expectNoWriteControls();
  });

  it("the Dashboard footer's edition pill only shows the license", async () => {
    render(<DashboardFooter />);

    await openPill(/Enterprise Edition/);

    expect(
      await screen.findByRole("button", { name: "Manage license" }),
    ).toBeInTheDocument();
    expectNoWriteControls();
  });

  /*
   * Everybody with a Dashboard has the footer's pill, and it says what the
   * license is. Only a master admin is led anywhere from it.
   */
  it("somebody who is not a master admin gets no license controls from either", async () => {
    isMasterAdmin = false;

    render(<AdminDashboardHeader />);
    await openPill(/Enterprise Edition/);

    expect(
      await screen.findByText("A master admin has to activate this license"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Manage license" }),
    ).not.toBeInTheDocument();
    expectNoWriteControls();

    cleanup();
    fetchCalls.length = 0;

    render(<DashboardFooter />);
    await openPill(/Enterprise Edition/);

    expect(
      await screen.findByText("A master admin has to activate this license"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Manage license" }),
    ).not.toBeInTheDocument();
    expectNoWriteControls();
  });

  it("tells somebody who is not a master admin where a master admin does it", async () => {
    isMasterAdmin = false;

    render(<DashboardFooter />);
    await openPill(/Enterprise Edition/);

    expect(
      await screen.findByText(
        "This installation does not have a valid enterprise license. Ask a master admin of this OneUptime installation to add or refresh the license in the Admin Dashboard.",
      ),
    ).toBeInTheDocument();
  });

  it("sends nothing from the dialog, whoever opens it", async () => {
    render(<DashboardFooter />);

    await openPill(/Enterprise Edition/);

    await screen.findByRole("button", { name: "Manage license" });

    expect(
      fetchCalls.filter((call: FetchCall): boolean => {
        return call.method !== "GET";
      }),
    ).toEqual([]);
  });
});

describe("Settings > License", () => {
  const pages: ReadonlyArray<EnterpriseSettingsPage> =
    AdminLicensePlugins.SettingsPages || [];

  it("is one settings page at /admin/settings/license, downloaded only when opened", () => {
    expect(pages).toHaveLength(1);
    expect(pages[0]?.path).toBe(LICENSE_SETTINGS_PAGE_PATH);
    expect(
      getEnterpriseSettingsPageRoute(pages[0]?.path as string).toString(),
    ).toBe("/admin/settings/license");
    // React.lazy: an exotic component with a $$typeof, not a plain function.
    expect(
      (pages[0]?.component as unknown as { $$typeof?: symbol }).$$typeof,
    ).toBe(REACT_LAZY_TYPE);
  });

  /*
   * The edition dialog builds this address on its own, from core: if the
   * plugin moved the page, Manage license would lead nowhere.
   */
  it("is where the edition dialog's Manage license leads", () => {
    const address: string = getEnterpriseSettingsPageRoute(
      LICENSE_SETTINGS_PAGE_PATH,
    ).toString();

    expect(address.startsWith("/admin/settings/")).toBe(true);
    expect(address.endsWith(`/${LICENSE_SETTINGS_PAGE_PATH}`)).toBe(true);
  });

  it("is part of the plugin the Enterprise image builds, and the first settings area", () => {
    expect(AdminDashboardPlugin.SettingsPages).toEqual(
      expect.arrayContaining([...pages]),
    );
    expect(ENTERPRISE_SETTINGS_AREAS[0]).toBe(AdminLicensePlugins);
    expect(
      ENTERPRISE_SETTINGS_AREAS.filter((area: unknown): boolean => {
        return area === AdminLicensePlugins;
      }),
    ).toHaveLength(1);
  });

  it("leaves the other Enterprise settings pages in place", () => {
    expect(
      (AdminDashboardPlugin.SettingsPages || []).map(
        (page: EnterpriseSettingsPage): string => {
          return page.path;
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        "license",
        "audit-log-export",
        "backups",
        "white-label",
      ]),
    );
  });

  it("has a side menu entry that links to the page, by the Admin Dashboard's word for it", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<LicenseSideMenuItem />);

    expect(
      screen.getByText("breadcrumbs.enterpriseLicense").closest("a"),
    ).toHaveAttribute("href", "/admin/settings/license");
  });

  it("is in core's Settings side menu, first of the Enterprise entries", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<SettingsSideMenu />);

    const license: HTMLElement = screen.getByText(
      "breadcrumbs.enterpriseLicense",
    );
    const auditLogExport: HTMLElement = screen.getByText("Audit Log Export");

    expect(
      license.compareDocumentPosition(auditLogExport) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is in the Enterprise settings entries whatever the license says", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<EnterpriseSettingsSideMenuItems />);

    expect(
      screen.getByText("breadcrumbs.enterpriseLicense"),
    ).toBeInTheDocument();
  });

  it.each([
    [
      "the Community Edition, on the Enterprise image",
      (): void => {
        isEnterpriseEdition = false;
      },
    ],
    [
      "OneUptime Cloud",
      (): void => {
        billingEnabled = true;
      },
    ],
  ])("has no entry on %s", (_name: string, setUp: () => void) => {
    setUp();

    expect(isLicenseSettingsAvailable()).toBe(false);

    const { container } = render(<LicenseSideMenuItem />);

    expect(container).toBeEmptyDOMElement();
  });

  it("has an entry on a self-hosted Enterprise installation", () => {
    expect(isLicenseSettingsAvailable()).toBe(true);
  });
});

/*
 * ONEUPTIME_EDITION=community on the Enterprise image: the bundle carries the
 * details, but the server runs the Community Edition, so there is no license
 * to manage and the dialog is the Community one.
 */
describe("the Community Edition, with the details in the bundle", () => {
  it("shows no license controls and sends nothing", async () => {
    isEnterpriseEdition = false;

    render(<EditionLabel licenseDetails={LicenseDetails} />);

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
      <EditionLabel licenseDetails={LicenseDetails} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(fetchCalls).toHaveLength(0);
  });
});

/*
 * ee/Dashboard/License/Plugins.ts imports the details from
 * ee/AdminDashboard/License, so that file has to bundle into BOTH frontends:
 * Common/..., react and its own directory only. "@oneuptime/admin-dashboard/..."
 * would bundle into the Admin Dashboard and break the Dashboard.
 */
describe("what the shared license details import", () => {
  const LICENSE_DIR: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "AdminDashboard",
    "License",
  );

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
      path.join(LICENSE_DIR, "LicenseDetails.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'from "Common/UI/Components/EditionLabel/LicenseDetails"',
    );
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

/*
 * The license is changed in one place. The server would refuse anybody else
 * whatever a client does, but a write path that crept back into a shared
 * component would put the controls back in everybody's footer, which is what
 * moving them to Settings > License was for.
 */
describe("who writes the license", () => {
  const REPOSITORY_ROOT: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "..",
  );

  // Every frontend, and everything they share.
  const FRONTEND_DIRECTORIES: Array<string> = [
    "ee/Dashboard",
    "ee/AdminDashboard",
    "packages/Common/UI",
    "packages/App/FeatureSet/Dashboard/src",
    "packages/App/FeatureSet/AdminDashboard/src",
    "packages/App/FeatureSet/Accounts/src",
    "packages/App/FeatureSet/StatusPage/src",
    "packages/App/FeatureSet/PublicDashboard/src",
  ];

  const THE_ONE_WRITER: string = "ee/AdminDashboard/License/LicenseSettingsAPI.ts";

  const SOURCE_FILE: RegExp = /\.tsx?$/;

  type ListSourcesFunction = (directory: string) => Array<string>;

  const listSources: ListSourcesFunction = (
    directory: string,
  ): Array<string> => {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "build") {
          files.push(...listSources(entryPath));
        }
      } else if (SOURCE_FILE.test(entry.name)) {
        files.push(entryPath);
      }
    }

    return files;
  };

  type WritesTheLicenseFunction = (source: string) => boolean;

  const writesTheLicense: WritesTheLicenseFunction = (
    source: string,
  ): boolean => {
    return (
      (/\/global-config\/license\/refresh/).test(source) ||
      ((/\/global-config\/license/).test(source) &&
        (/HTTPMethod\.(POST|PUT|PATCH|DELETE)\b|\bAPI\.(post|put|patch|delete)\b/).test(
          source,
        ))
    );
  };

  const writers: Array<string> = FRONTEND_DIRECTORIES.flatMap(
    (directory: string): Array<string> => {
      return listSources(path.join(REPOSITORY_ROOT, directory));
    },
  )
    .filter((file: string): boolean => {
      return writesTheLicense(fs.readFileSync(file, "utf8"));
    })
    .map((file: string): string => {
      return path.relative(REPOSITORY_ROOT, file);
    });

  it("is the Admin Dashboard's license page, and nothing else", () => {
    expect(writers).toEqual([THE_ONE_WRITER]);
  });

  // Negative control: the check fires on the code that used to be in the dialog.
  it.each([
    ['new Route("/global-config/license/refresh")'],
    [
      'url: new Route("/global-config/license"), method: HTTPMethod.POST',
    ],
    ['await API.post({ url: "/global-config/license" })'],
  ])("the check flags %s", (source: string) => {
    expect(writesTheLicense(source)).toBe(true);
  });

  it("the check leaves a read of the license alone (negative control)", () => {
    expect(
      writesTheLicense(
        'new Route("/global-config/license"), method: HTTPMethod.GET',
      ),
    ).toBe(false);
  });

  /*
   * What a file imports, and what those import, as far as ee/ goes: the
   * Dashboard's bundle is what its plugin reaches.
   */
  type ReachedFromFunction = (entry: string) => Array<string>;

  const reachedFrom: ReachedFromFunction = (entry: string): Array<string> => {
    const reached: Set<string> = new Set<string>();

    const visit: (file: string) => void = (file: string): void => {
      if (reached.has(file)) {
        return;
      }

      reached.add(file);

      for (const match of fs.readFileSync(file, "utf8").matchAll(SPECIFIER)) {
        const specifier: string = match[1] || "";

        if (!specifier.startsWith(".")) {
          continue;
        }

        const resolved: string = path.resolve(path.dirname(file), specifier);
        const found: string | undefined = [
          `${resolved}.ts`,
          `${resolved}.tsx`,
          path.join(resolved, "Index.ts"),
          path.join(resolved, "Index.tsx"),
        ].find((candidate: string): boolean => {
          return fs.existsSync(candidate);
        });

        if (found) {
          visit(found);
        }
      }
    };

    visit(entry);

    return Array.from(reached).map((file: string): string => {
      return path.relative(REPOSITORY_ROOT, file);
    });
  };

  // The details and their words: the words are data, with no React in them.
  const DETAILS_FILES: ReadonlyArray<string> = [
    "ee/AdminDashboard/License/LicenseDetails.tsx",
    "ee/AdminDashboard/License/LicenseDetailsCopy.ts",
  ];

  it("is out of the Dashboard's reach: its plugin bundles the details alone", () => {
    const reached: Array<string> = reachedFrom(
      path.join(REPOSITORY_ROOT, "ee/Dashboard/License/Plugins.ts"),
    );

    expect(reached).toEqual(expect.arrayContaining([...DETAILS_FILES]));
    expect(
      reached.filter((file: string): boolean => {
        return (
          file.startsWith("ee/AdminDashboard/License/") &&
          !DETAILS_FILES.includes(file)
        );
      }),
    ).toEqual([]);
  });

  it("is out of the whole Dashboard plugin's reach too", () => {
    expect(
      reachedFrom(path.join(REPOSITORY_ROOT, "ee/Dashboard/Index.tsx")),
    ).not.toContain(THE_ONE_WRITER);
  });

  it("the check follows imports to the writer from the Admin Dashboard (negative control)", () => {
    expect(
      reachedFrom(
        path.join(REPOSITORY_ROOT, "ee/AdminDashboard/License/Plugins.ts"),
      ),
    ).toContain(THE_ONE_WRITER);
  });
});
