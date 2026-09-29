import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * Settings > Enterprise Licenses and one license: the core shells left at the
 * old page paths after the license server's screens moved to
 * ee/AdminDashboard/EnterpriseLicenses.
 *
 * The screens belong to the OneUptime Cloud license server, so the shells
 * render the Enterprise plugin only when billing is enabled, and otherwise
 * keep the "Only available on OneUptime Cloud" state the page has always shown
 * on self-hosted installs. A Cloud deployment whose Admin Dashboard was built
 * without the Enterprise plugin says so instead.
 *
 * Billing is pinned in every test (CI's config.env sets BILLING_ENABLED=true).
 * The plugins are the Community stub unless a test hands in a fake - this is
 * core, and must pass with ee/ deleted.
 */

let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
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

// The page frame is not what this suite is about; keep its title and children.
jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { title?: string; children: ReactNode }): ReactElement => {
      return (
        <div data-testid="page" data-title={props.title}>
          {props.children}
        </div>
      );
    },
  };
});

/*
 * The plugin door, pointed at whatever the test sets. Starts as the real
 * Community stub (what "@oneuptime/ee-admin-dashboard" is in core).
 */
let mockPluginsForTest: Record<string, unknown> = {};

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/Plugins",
  () => {
    return {
      getAdminDashboardPlugins: (): Record<string, unknown> => {
        return mockPluginsForTest;
      },
    };
  },
);

import CommunityPlugins from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/CommunityPlugins";
import EnterpriseLicenses from "../../../../App/FeatureSet/AdminDashboard/src/Pages/EnterpriseLicenses/Index";
import EnterpriseLicenseView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/EnterpriseLicenses/View/Index";

const FakeLicensesList: FunctionComponent = (): ReactElement => {
  return <div data-testid="ee-licenses-list" />;
};

const FakeLicenseView: FunctionComponent = (): ReactElement => {
  return <div data-testid="ee-license-view" />;
};

const CLOUD_ONLY_TITLE: string = "Only available on OneUptime Cloud";
const ENTERPRISE_BUILD_TITLE: string =
  "Requires the OneUptime Enterprise Edition";

interface ShellCase {
  name: string;
  Shell: FunctionComponent;
  pluginKey: "EnterpriseLicensesList" | "EnterpriseLicenseView";
  Fake: FunctionComponent;
  testId: string;
}

const SHELLS: Array<ShellCase> = [
  {
    name: "the license list",
    Shell: EnterpriseLicenses,
    pluginKey: "EnterpriseLicensesList",
    Fake: FakeLicensesList,
    testId: "ee-licenses-list",
  },
  {
    name: "one license",
    Shell: EnterpriseLicenseView,
    pluginKey: "EnterpriseLicenseView",
    Fake: FakeLicenseView,
    testId: "ee-license-view",
  },
];

beforeEach(() => {
  billingEnabledForTest = false;
  mockPluginsForTest = CommunityPlugins as unknown as Record<string, unknown>;
});

afterEach(() => {
  cleanup();
});

describe.each(SHELLS)(
  "Enterprise Licenses shell: $name",
  (shell: ShellCase) => {
    test("the Community build has no license screens at all", () => {
      expect(CommunityPlugins).toEqual({});
    });

    test("self-hosted Community Edition: the Cloud-only empty state", () => {
      const { Shell } = shell;

      render(<Shell />);

      expect(screen.getByText(CLOUD_ONLY_TITLE)).toBeInTheDocument();
      expect(
        screen.getByText(
          "Enterprise licenses are issued and tracked on the hosted oneuptime.com, where billing is enabled. This self-hosted instance does not manage licenses.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("page")).toHaveAttribute(
        "data-title",
        "pages.enterpriseLicenses.title",
      );
    });

    test("self-hosted Enterprise Edition: still the Cloud-only empty state - the plugin is never rendered", () => {
      const { Shell, Fake } = shell;

      mockPluginsForTest = { [shell.pluginKey]: Fake };

      render(<Shell />);

      expect(screen.getByText(CLOUD_ONLY_TITLE)).toBeInTheDocument();
      expect(screen.queryByTestId(shell.testId)).not.toBeInTheDocument();
    });

    test("OneUptime Cloud with the Enterprise plugin: the Enterprise screen", () => {
      const { Shell, Fake } = shell;

      billingEnabledForTest = true;
      mockPluginsForTest = { [shell.pluginKey]: Fake };

      render(<Shell />);

      expect(screen.getByTestId(shell.testId)).toBeInTheDocument();
      expect(screen.queryByText(CLOUD_ONLY_TITLE)).not.toBeInTheDocument();
    });

    test("OneUptime Cloud built without the plugin: says the Enterprise Edition is required", () => {
      const { Shell } = shell;

      billingEnabledForTest = true;

      render(<Shell />);

      expect(screen.getByText(ENTERPRISE_BUILD_TITLE)).toBeInTheDocument();
      expect(screen.queryByText(CLOUD_ONLY_TITLE)).not.toBeInTheDocument();
    });

    test("reads only its own plugin key", () => {
      const { Shell, Fake } = shell;
      const otherKey: string =
        shell.pluginKey === "EnterpriseLicensesList"
          ? "EnterpriseLicenseView"
          : "EnterpriseLicensesList";

      billingEnabledForTest = true;
      mockPluginsForTest = { [otherKey]: Fake };

      render(<Shell />);

      expect(screen.queryByTestId(shell.testId)).not.toBeInTheDocument();
      expect(screen.getByText(ENTERPRISE_BUILD_TITLE)).toBeInTheDocument();
    });
  },
);
