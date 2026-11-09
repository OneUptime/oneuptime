import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ADMIN DASHBOARD > TELEMETRY USAGE, and PROJECTS > (PROJECT) > TELEMETRY
 * USAGE (issue #5916), on the real pages, in the real locales.
 *
 * The instance admin finds the projects that send the most telemetry - with
 * billing on or off - sorted and paged on the server, and opens one to see
 * its usage by day, signal and resource. The admin API's reads and the page
 * chrome are stand-ins; the i18next instance reaches the pages through
 * I18nextProvider only.
 */

jest.setTimeout(60000);

const mockFetchUsageByProject: MockFunction = getJestMockFunction();
const mockFetchProjectUsage: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/TelemetryUsage",
  () => {
    return {
      __esModule: true,
      fetchUsageByProject: (...args: Array<unknown>): unknown => {
        return mockFetchUsageByProject(...args);
      },
      fetchProjectUsage: (...args: Array<unknown>): unknown => {
        return mockFetchProjectUsage(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getItem: async (): Promise<unknown> => {
          return null;
        },
      },
    };
  },
);

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { title?: string; children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "page", "data-title": props.title },
        props.children,
      );
    },
  };
});

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "model-page" },
        props.children,
      );
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryUsage/TelemetryUsageDailyChart",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      getChartedSignals: (
        jest.requireActual(
          "../../../UI/Components/TelemetryUsage/TelemetryUsageDailyChart",
        ) as { getChartedSignals: unknown }
      ).getChartedSignals,
      default: () => {
        return react.createElement("div", { "data-testid": "daily-chart" });
      },
    };
  },
);

import TelemetryUsagePage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/TelemetryUsage/Index";
import ProjectTelemetryUsage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/TelemetryUsage";
import OneUptimeDate from "../../../Types/Date";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import {
  TelemetryProjectUsagePage,
  TelemetryUsageSummary,
} from "../../../Types/Telemetry/TelemetryUsage";

const ADMIN_DASHBOARD: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
);
const LOCALES_DIR: string = path.join(ADMIN_DASHBOARD, "Locales");

const NOW: Date = new Date("2026-11-08T09:30:00.000Z");
const PROJECT_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const PROJECT_B: string = "bbbbbbbb-0000-4000-8000-000000000002";

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

function page(
  overrides?: Partial<TelemetryProjectUsagePage>,
): TelemetryProjectUsagePage {
  return {
    startDay: "2026-10-09",
    endDay: "2026-11-07",
    isCostIncluded: false,
    total: { dataIngestedInGB: 31 },
    byProduct: {
      [ProductType.Logs]: { dataIngestedInGB: 30 },
      [ProductType.Metrics]: { dataIngestedInGB: 1 },
    },
    projects: [
      {
        projectId: PROJECT_B,
        projectName: "Beta Production",
        byProduct: { [ProductType.Logs]: { dataIngestedInGB: 25 } },
        total: { dataIngestedInGB: 25 },
      },
      {
        projectId: PROJECT_A,
        projectName: "Alpha Staging",
        byProduct: {
          [ProductType.Logs]: { dataIngestedInGB: 5 },
          [ProductType.Metrics]: { dataIngestedInGB: 1 },
        },
        total: { dataIngestedInGB: 6 },
      },
    ],
    count: 2,
    skip: 0,
    limit: 50,
    ...overrides,
  };
}

async function renderInstancePage(locale: string = "en"): Promise<void> {
  render(
    <I18nextProvider i18n={await instanceFor(locale)}>
      <TelemetryUsagePage />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  mockFetchUsageByProject.mockReset();
  mockFetchProjectUsage.mockReset();
  mockFetchUsageByProject.mockResolvedValue(page() as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Admin Dashboard > Telemetry Usage", () => {
  test("reads the last 30 days of every project, heaviest first, 50 a page", async () => {
    await renderInstancePage();

    await waitFor(() => {
      expect(mockFetchUsageByProject).toHaveBeenCalledTimes(1);
    });

    expect(mockFetchUsageByProject).toHaveBeenCalledWith({
      range: { startDay: "2026-10-09", endDay: "2026-11-07" },
      sortBy: "total",
      sortOrder: "desc",
      skip: 0,
      limit: 50,
    });
  });

  test("is titled and described from the Admin locale", async () => {
    await renderInstancePage();

    expect(screen.getByTestId("page")).toHaveAttribute(
      "data-title",
      "Telemetry Usage",
    );
    expect(
      await screen.findByText("Telemetry Usage by Project"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "How much telemetry each project sent, heaviest first. A day is counted once it has ended in UTC.",
      ),
    ).toBeInTheDocument();
  });

  test("shows the instance's totals, and each project linked to its own usage", async () => {
    await renderInstancePage();

    expect(
      await screen.findByTestId("telemetry-usage-instance-total"),
    ).toHaveTextContent("31 GB");

    const links: Array<HTMLElement> = await screen.findAllByTestId(
      "telemetry-usage-project-link",
    );

    expect(
      links.map((link: HTMLElement): string => {
        return link.textContent || "";
      }),
    ).toEqual(["Beta Production", "Alpha Staging"]);
    expect(links[0]).toHaveAttribute(
      "href",
      `/admin/projects/${PROJECT_B}/telemetry-usage`,
    );
  });

  test("draws a column for each signal any project sent, and no cost where billing is off", async () => {
    await renderInstancePage();

    await screen.findAllByTestId("telemetry-usage-project-link");

    const headers: string = screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return header.textContent || "";
      })
      .join("|");

    expect(headers).toContain("Project");
    expect(headers).toContain("Logs");
    expect(headers).toContain("Metrics");
    expect(headers).toContain("Total");
    expect(headers).not.toContain("Traces");
    expect(headers).not.toContain("Cost");
  });

  test("says what each project cost where billing is on", async () => {
    mockFetchUsageByProject.mockResolvedValue(
      page({
        isCostIncluded: true,
        total: { dataIngestedInGB: 31, totalCostInUSD: 3.1 },
        projects: [
          {
            projectId: PROJECT_B,
            projectName: "Beta Production",
            byProduct: {
              [ProductType.Logs]: {
                dataIngestedInGB: 25,
                totalCostInUSD: 2.5,
              },
            },
            total: { dataIngestedInGB: 25, totalCostInUSD: 2.5 },
          },
        ],
        count: 1,
      }) as never,
    );

    await renderInstancePage();

    const link: HTMLElement = (
      await screen.findAllByTestId("telemetry-usage-project-link")
    )[0]!;
    const row: HTMLElement = link.closest("tr") || link.parentElement!;

    expect(row).toHaveTextContent("2.5 USD");
  });

  test("sorts on the server when a column's title is clicked", async () => {
    await renderInstancePage();

    await screen.findAllByTestId("telemetry-usage-project-link");

    const logsHeader: HTMLElement = screen
      .getAllByRole("columnheader")
      .find((header: HTMLElement): boolean => {
        return (header.textContent || "").includes("Logs");
      })!;

    fireEvent.click(within(logsHeader).getByText("Logs"));

    await waitFor(() => {
      expect(mockFetchUsageByProject).toHaveBeenCalledTimes(2);
    });

    expect(mockFetchUsageByProject.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ sortBy: ProductType.Logs, skip: 0 }),
    );
  });

  test("says when no project has usage yet", async () => {
    mockFetchUsageByProject.mockResolvedValue(
      page({
        total: { dataIngestedInGB: 0 },
        byProduct: {},
        projects: [],
        count: 0,
      }) as never,
    );

    await renderInstancePage();

    expect(
      await screen.findByTestId("telemetry-usage-projects-empty"),
    ).toHaveTextContent("No telemetry usage yet");
  });

  test("reads in the admin's language", async () => {
    await renderInstancePage("de");

    const german: Record<string, unknown> = readLocale("de");
    const pages: Record<string, Record<string, string>> = german[
      "pages"
    ] as Record<string, Record<string, string>>;

    expect(
      await screen.findByText(pages["telemetryUsage"]!["cardTitle"]!),
    ).toBeInTheDocument();
    expect(pages["telemetryUsage"]!["cardTitle"]).not.toBe(
      "Telemetry Usage by Project",
    );
  });
});

describe("Admin Dashboard > Projects > (project) > Telemetry Usage", () => {
  test("reads that project's usage, as the master admin, and draws it", async () => {
    window.history.pushState(
      {},
      "",
      `/admin/projects/${PROJECT_A}/telemetry-usage`,
    );

    const usage: TelemetryUsageSummary = {
      startDay: "2026-10-09",
      endDay: "2026-11-07",
      isCostIncluded: false,
      total: { dataIngestedInGB: 6 },
      byProduct: { [ProductType.Logs]: { dataIngestedInGB: 6 } },
      days: [
        {
          day: "2026-11-07",
          byProduct: { [ProductType.Logs]: { dataIngestedInGB: 6 } },
          total: { dataIngestedInGB: 6 },
        },
      ],
      resources: [
        {
          primaryEntityId: "cccccccc-0000-4000-8000-000000000003",
          primaryEntityType: null,
          name: "payments",
          byProduct: { [ProductType.Logs]: { dataIngestedInGB: 6 } },
          total: { dataIngestedInGB: 6 },
          retentionInDays: 15,
          sessionReplayRetentionInDays: null,
        },
      ],
      latestDay: "2026-11-07",
    };

    mockFetchProjectUsage.mockResolvedValue(usage as never);

    render(
      <I18nextProvider i18n={await instanceFor("en")}>
        <ProjectTelemetryUsage />
      </I18nextProvider>,
    );

    expect(await screen.findByText("payments")).toBeInTheDocument();
    expect(mockFetchProjectUsage).toHaveBeenCalledTimes(1);

    const call: { projectId: ObjectID; range: unknown } = mockFetchProjectUsage
      .mock.calls[0]![0] as { projectId: ObjectID; range: unknown };

    expect(call.projectId.toString()).toBe(PROJECT_A);
    expect(call.range).toEqual({
      startDay: "2026-10-09",
      endDay: "2026-11-07",
    });

    // Resources have no pages in the Admin Dashboard: named, never linked.
    expect(screen.queryByTestId("telemetry-usage-resource-link")).toBeNull();
  });
});
