import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The OneUptime Health pages in the Admin Dashboard, per edition.
 *
 * Every page keeps its module (App.tsx and the route wiring never change) and
 * its layout. What differs:
 *   - Enterprise content (live datastore health, queues, diagnostic logs,
 *     telemetry, the query console, ClickHouse cluster health, the live
 *     overview) comes from the enterprise plugin, or an upsell on the
 *     Community Edition - decided from the edition the server runs (env.js),
 *     never from a per-page flag;
 *   - ClickHouse capacity and its settings, the instance log, migrations and
 *     the support bundle render on every edition;
 *   - the landing page is useful on the Community Edition (capacity and the
 *     every-edition tools), not a full-page upsell.
 *
 * Billing and the edition are pinned in every test.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;

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

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return enterpriseEditionForTest;
    },
  });

  return mocked;
});

// The plugin door reads this object; each test puts in what its build ships.
jest.mock("@oneuptime/ee-admin-dashboard", () => {
  return { __esModule: true, default: {} };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof import("react") =
    jest.requireActual("react") as typeof import("react");

  return {
    __esModule: true,
    default: (props: {
      title: string;
      children: ReactElement | Array<ReactElement>;
    }): ReactElement => {
      return react.createElement(
        "main",
        { "data-testid": "page", "data-title": props.title },
        props.children,
      );
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      getFriendlyMessage: (err: unknown): string => {
        return err instanceof Error ? err.message : String(err);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacity",
  () => {
    const react: typeof import("react") =
      jest.requireActual("react") as typeof import("react");

    return {
      __esModule: true,
      default: (): ReactElement => {
        return react.createElement("div", {
          "data-testid": "clickhouse-capacity",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacitySettings",
  () => {
    const react: typeof import("react") =
      jest.requireActual("react") as typeof import("react");

    return {
      __esModule: true,
      default: (): ReactElement => {
        return react.createElement("div", {
          "data-testid": "clickhouse-capacity-settings",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/InstanceHealthLogs",
  () => {
    const react: typeof import("react") =
      jest.requireActual("react") as typeof import("react");

    return {
      __esModule: true,
      default: (): ReactElement => {
        return react.createElement("div", {
          "data-testid": "instance-health-logs",
        });
      },
    };
  },
);

import HealthLanding from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/Index";
import HealthQueues from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/Queues";
import HealthPostgres from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/Postgres";
import HealthRedis from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/Redis";
import HealthLogs from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/Logs";
import HealthTelemetry from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/Telemetry";
import HealthQueryConsole, {
  QUERY_CONSOLE_NOT_ON_CLOUD_NOTICE,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/QueryConsole";
import HealthClickhouse from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/Clickhouse";
import HealthInstanceLogs from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/InstanceLogs";
import HealthPage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/HealthPage";
import {
  ENTERPRISE_HEALTH_NOTE_DESCRIPTION,
  EVERY_EDITION_HEALTH_NOTE,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/EnterpriseHealthUpgrade";
import { EVERY_EDITION_HEALTH_TOOLS } from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/CommunityHealthOverview";
import {
  formatBytes,
  summarizeClickhouseCapacity,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacitySummary";
import {
  AdminDashboardEnterprisePluginKey,
  AdminDashboardEnterprisePlugins,
  EnterprisePluginComponent,
} from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/EnterprisePlugins";
import { getAdminDashboardPlugins } from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/Plugins";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import API from "../../../UI/Utils/API/API";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";

/*
 * The mocked plugin module, reached through the door the shells use (core
 * never imports the plugin specifier itself).
 */
const plugins: AdminDashboardEnterprisePlugins = getAdminDashboardPlugins();

const makePlugin: (testId: string) => EnterprisePluginComponent = (
  testId: string,
): EnterprisePluginComponent => {
  const Plugin: FunctionComponent = (): ReactElement => {
    return <div data-testid={testId} />;
  };

  return Plugin;
};

const installPlugin: (key: AdminDashboardEnterprisePluginKey) => string = (
  key: AdminDashboardEnterprisePluginKey,
): string => {
  const testId: string = `plugin-${key}`;
  plugins[key] = makePlugin(testId);
  return testId;
};

const apiGet: jest.Mock = API.get as unknown as jest.Mock;

interface GatedPage {
  label: string;
  Page: FunctionComponent;
  pluginKey: AdminDashboardEnterprisePluginKey;
  featureName: string;
}

const GATED_PAGES: Array<GatedPage> = [
  {
    label: "Background Queues",
    Page: HealthQueues,
    pluginKey: "HealthQueues",
    featureName: "Background queue health",
  },
  {
    label: "PostgreSQL",
    Page: HealthPostgres,
    pluginKey: "HealthPostgres",
    featureName: "PostgreSQL cluster health",
  },
  {
    label: "Valkey",
    Page: HealthRedis,
    pluginKey: "HealthRedis",
    featureName: "Valkey health",
  },
  {
    label: "Diagnostic Logs",
    Page: HealthLogs,
    pluginKey: "HealthLogs",
    featureName: "Diagnostic logs",
  },
  {
    label: "Telemetry",
    Page: HealthTelemetry,
    pluginKey: "HealthTelemetry",
    featureName: "Telemetry ingestion",
  },
  {
    label: "Query Console",
    Page: HealthQueryConsole,
    pluginKey: "HealthQueryConsole",
    featureName: "Query console",
  },
];

const CAPACITY: JSONObject = {
  connected: true,
  dataSizeInBytes: 5 * 1024 * 1024 * 1024,
  diskTotalInBytes: 300,
  diskFreeInBytes: 150,
  diskByNode: [
    {
      shardNum: 1,
      host: "ch-1",
      diskName: "default",
      totalInBytes: 100,
      freeInBytes: 60,
    },
    {
      shardNum: 2,
      host: "ch-2",
      diskName: "default",
      totalInBytes: 200,
      freeInBytes: 20,
    },
  ],
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;

  for (const key of Object.keys(plugins)) {
    delete (plugins as Record<string, unknown>)[key];
  }

  apiGet.mockReset();
  apiGet.mockImplementation(async (): Promise<{ data: JSONObject }> => {
    return { data: CAPACITY };
  });
});

afterEach(() => {
  cleanup();
});

describe("the Health layout has no edition gate of its own", () => {
  test.each([false, true])(
    "renders its content on either edition (Enterprise=%s)",
    (isEnterprise: boolean) => {
      enterpriseEditionForTest = isEnterprise;

      render(
        <HealthPage
          title="Migrations"
          currentRoute={RouteMap[PageMap.HEALTH_MIGRATIONS] as Route}
        >
          <div data-testid="content" />
        </HealthPage>,
      );

      expect(screen.getByTestId("page")).toHaveAttribute(
        "data-title",
        "Migrations",
      );
      expect(screen.getByTestId("content")).toBeInTheDocument();
      expect(
        screen.queryByText("Learn about Enterprise Edition"),
      ).not.toBeInTheDocument();
    },
  );
});

describe.each(GATED_PAGES)("Health > $label", (page: GatedPage) => {
  test("the Community Edition shows the upsell with the Community tools note, and never the plugin", () => {
    enterpriseEditionForTest = false;
    const testId: string = installPlugin(page.pluginKey);

    render(<page.Page />);

    expect(screen.getByRole("heading", { name: page.featureName })).toBeInTheDocument();
    expect(screen.getByText(EVERY_EDITION_HEALTH_NOTE)).toBeInTheDocument();
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    expect(screen.getByTestId("page")).toHaveAttribute(
      "data-title",
      page.label,
    );
  });

  test("the Enterprise Edition renders the plugin inside the Health layout", async () => {
    enterpriseEditionForTest = true;
    const testId: string = installPlugin(page.pluginKey);

    render(<page.Page />);

    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: page.featureName })).not.toBeInTheDocument();
    expect(screen.getByTestId("page")).toHaveAttribute(
      "data-title",
      page.label,
    );
  });

  test("an Enterprise env.js with a Community bundle (no plugin) shows the upsell", () => {
    enterpriseEditionForTest = true;

    render(<page.Page />);

    expect(screen.getByRole("heading", { name: page.featureName })).toBeInTheDocument();
  });
});

describe("Health > Query Console on OneUptime Cloud", () => {
  test("says the console is not offered on Cloud, and never renders it", () => {
    billingEnabledForTest = true;
    enterpriseEditionForTest = true;
    const testId: string = installPlugin("HealthQueryConsole");

    render(<HealthQueryConsole />);

    expect(
      screen.getByText(QUERY_CONSOLE_NOT_ON_CLOUD_NOTICE),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Learn about Enterprise Edition"),
    ).not.toBeInTheDocument();
  });

  test("other Enterprise pages still render on Cloud", async () => {
    billingEnabledForTest = true;
    enterpriseEditionForTest = true;
    const testId: string = installPlugin("HealthPostgres");

    render(<HealthPostgres />);

    expect(await screen.findByTestId(testId)).toBeInTheDocument();
  });
});

describe("Health > ClickHouse", () => {
  test("the Community Edition gets capacity and its settings, with the cluster section as an upsell", () => {
    enterpriseEditionForTest = false;
    const testId: string = installPlugin("HealthClickhouseCluster");

    render(<HealthClickhouse />);

    expect(screen.getByTestId("clickhouse-capacity")).toBeInTheDocument();
    expect(
      screen.getByTestId("clickhouse-capacity-settings"),
    ).toBeInTheDocument();
    expect(screen.getByText("ClickHouse cluster health")).toBeInTheDocument();
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    // The page itself shows the Community tools, so no side-menu reminder.
    expect(
      screen.queryByText(EVERY_EDITION_HEALTH_NOTE),
    ).not.toBeInTheDocument();
  });

  test("the Enterprise Edition gets capacity, the cluster plugin and the settings, in that order", async () => {
    enterpriseEditionForTest = true;
    const testId: string = installPlugin("HealthClickhouseCluster");

    render(<HealthClickhouse />);

    const cluster: HTMLElement = await screen.findByTestId(testId);
    const capacity: HTMLElement = screen.getByTestId("clickhouse-capacity");
    const settings: HTMLElement = screen.getByTestId(
      "clickhouse-capacity-settings",
    );

    expect(
      capacity.compareDocumentPosition(cluster) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      cluster.compareDocumentPosition(settings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByText("ClickHouse cluster health"),
    ).not.toBeInTheDocument();
  });
});

describe("Health > Instance Logs", () => {
  test.each([false, true])(
    "renders the instance log on either edition (Enterprise=%s)",
    (isEnterprise: boolean) => {
      enterpriseEditionForTest = isEnterprise;

      render(<HealthInstanceLogs />);

      expect(screen.getByTestId("instance-health-logs")).toBeInTheDocument();
      expect(
        screen.queryByText("Learn about Enterprise Edition"),
      ).not.toBeInTheDocument();
    },
  );
});

describe("Health > Overview (the landing page)", () => {
  const expectCommunitySections: () => Promise<void> =
    async (): Promise<void> => {
      expect(
        await screen.findByText("Fullest of 2 disks · Shard 2 · ch-2 · default"),
      ).toBeInTheDocument();
      expect(screen.getByText("Available on every edition")).toBeInTheDocument();

      for (const tool of EVERY_EDITION_HEALTH_TOOLS) {
        expect(screen.getByText(tool.title).closest("a")).toHaveAttribute(
          "href",
          (RouteMap[tool.page] as Route).toString(),
        );
      }
    };

  test("the Community Edition shows ClickHouse capacity and the every-edition tools under a short note", async () => {
    enterpriseEditionForTest = false;
    const testId: string = installPlugin("HealthOverview");

    render(<HealthLanding />);

    expect(
      screen.getByText(ENTERPRISE_HEALTH_NOTE_DESCRIPTION),
    ).toBeInTheDocument();
    // A note, not the full-page upsell.
    expect(screen.queryByText("Live component health")).not.toBeInTheDocument();
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();

    await expectCommunitySections();
  });

  test("links to Migrations and the Support Bundle on the Community Edition", async () => {
    render(<HealthLanding />);

    await screen.findByText("Available on every edition");

    expect(screen.getByText("Migrations").closest("a")).toHaveAttribute(
      "href",
      "/admin/health/migrations",
    );
    expect(screen.getByText("Support Bundle").closest("a")).toHaveAttribute(
      "href",
      "/admin/health/support-bundle",
    );
  });

  test("the Enterprise Edition shows its live overview above the same Community sections", async () => {
    enterpriseEditionForTest = true;
    const testId: string = installPlugin("HealthOverview");

    render(<HealthLanding />);

    const overview: HTMLElement = await screen.findByTestId(testId);
    await expectCommunitySections();

    expect(
      overview.compareDocumentPosition(
        screen.getByText("Available on every edition"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByText(ENTERPRISE_HEALTH_NOTE_DESCRIPTION),
    ).not.toBeInTheDocument();
  });

  test("asks only the Community capacity endpoint on the Community Edition", async () => {
    render(<HealthLanding />);

    await screen.findByText("Available on every edition");
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(1);
    });

    const url: string = String(
      (apiGet.mock.calls[0]?.[0] as { url: { toString: () => string } }).url,
    );

    expect(url).toContain("/admin/health/clickhouse-capacity");
  });

  test("shows the capacity endpoint's error instead of numbers", async () => {
    apiGet.mockImplementation(async (): Promise<never> => {
      throw new Error("ClickHouse capacity is unavailable");
    });

    render(<HealthLanding />);

    expect(
      await screen.findByText("ClickHouse capacity is unavailable"),
    ).toBeInTheDocument();
  });

  test("says when ClickHouse cannot be reached", async () => {
    apiGet.mockImplementation(async (): Promise<{ data: JSONObject }> => {
      return { data: { connected: false } };
    });

    render(<HealthLanding />);

    expect(
      await screen.findByText(
        (content: string): boolean => {
          return content.includes("ClickHouse is not reachable");
        },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Fullest of/)).not.toBeInTheDocument();
  });
});

describe("summarizeClickhouseCapacity", () => {
  test("names the fullest disk, not the average", () => {
    expect(summarizeClickhouseCapacity(CAPACITY)).toEqual({
      connected: true,
      dataSizeInBytes: 5 * 1024 * 1024 * 1024,
      fullestDisk: {
        label: "Shard 2 · ch-2 · default",
        usedInBytes: 180,
        totalInBytes: 200,
        percent: 90,
      },
      diskCount: 2,
    });
  });

  test("falls back to the aggregate totals when no node reports", () => {
    expect(
      summarizeClickhouseCapacity({
        connected: true,
        diskTotalInBytes: 400,
        diskFreeInBytes: 100,
        diskByNode: [],
      }).fullestDisk,
    ).toEqual({
      label: "ClickHouse disk",
      usedInBytes: 300,
      totalInBytes: 400,
      percent: 75,
    });
  });

  test("skips nodes it cannot read, and a zero-sized disk", () => {
    const summary: ReturnType<typeof summarizeClickhouseCapacity> =
      summarizeClickhouseCapacity({
        connected: true,
        diskByNode: [
          { host: "broken", totalInBytes: null, freeInBytes: 1 },
          { host: "empty", totalInBytes: 0, freeInBytes: 0 },
          { host: "ok", totalInBytes: "1000", freeInBytes: "250" },
        ],
      });

    expect(summary.diskCount).toBe(1);
    expect(summary.fullestDisk?.label).toBe("ok");
    expect(summary.fullestDisk?.percent).toBe(75);
  });

  test("reports nothing it does not know", () => {
    expect(summarizeClickhouseCapacity(null)).toEqual({
      connected: false,
      dataSizeInBytes: null,
      fullestDisk: null,
      diskCount: 0,
    });
  });

  test("formatBytes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
    expect(formatBytes(20 * 1024 * 1024 * 1024)).toBe("20 GB");
  });
});

describe("the every-edition tools", () => {
  test("are the Community Health pages, each with a route", () => {
    expect(
      EVERY_EDITION_HEALTH_TOOLS.map((tool: { page: PageMap }): PageMap => {
        return tool.page;
      }),
    ).toEqual([
      PageMap.HEALTH_CLICKHOUSE,
      PageMap.HEALTH_INSTANCE_LOGS,
      PageMap.HEALTH_PROBES,
      PageMap.HEALTH_MIGRATIONS,
      PageMap.HEALTH_SUPPORT_BUNDLE,
    ]);

    for (const tool of EVERY_EDITION_HEALTH_TOOLS) {
      expect(RouteMap[tool.page]).toBeDefined();
    }
  });
});
