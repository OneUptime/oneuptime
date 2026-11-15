// Must stay the first import: the client's URLs are built from HOST on load.
import "../../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  FakeTransport,
} from "../../UI/Utils/API/FakeAxiosServer";
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
import axios from "axios";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

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

import TelemetryUsagePage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/TelemetryUsage/Index";
import {
  fetchProjectUsage,
  fetchUsageByProject,
} from "../../../../App/FeatureSet/AdminDashboard/src/Utils/TelemetryUsage";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import {
  getTelemetryUsageRangeOfLastDays,
  TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE,
  TELEMETRY_USAGE_DEFAULT_PROJECTS_PAGE_SIZE,
  TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
  TelemetryProjectUsagePage,
  TelemetryUsageRange,
  TelemetryUsageSummary,
} from "../../../Types/Telemetry/TelemetryUsage";
import { APP_API_URL } from "../../../UI/Config";

/*
 * ADMIN DASHBOARD > TELEMETRY USAGE, read the way a browser reads it
 * (issue #7794).
 *
 * The page asks the admin API for one page of projects. The server answers
 * the page whole - its projects, the instance's totals, and the count,
 * skip and limit of the projects - and the browser's API client used to
 * take any answer holding count, skip and limit for a list envelope, look
 * for its rows under `data`, and throw "array is not iterable". The table
 * of projects never loaded, on any install.
 *
 * AdminTelemetryUsagePages.test.tsx stands in for the page's reads, which
 * is why it never saw this. Here only axios is a stand-in: the real page,
 * its reads (Utils/TelemetryUsage), the browser's API client and
 * HTTPResponse turn the server's JSON into the table.
 */

jest.setTimeout(60000);

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const NOW: Date = new Date("2026-11-15T09:30:00.000Z");
const PROJECT_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const PROJECT_B: string = "bbbbbbbb-0000-4000-8000-000000000002";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const DEFAULT_RANGE: TelemetryUsageRange = getTelemetryUsageRangeOfLastDays(
  TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
  NOW,
);

let server: FakeAxiosServer;

async function englishInstance(): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
        ) as Record<string, unknown>,
      },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

// The page of projects the server answers, as TelemetryUsageReads builds it.
function usagePage(
  overrides?: Partial<TelemetryProjectUsagePage>,
): TelemetryProjectUsagePage {
  return {
    startDay: DEFAULT_RANGE.startDay,
    endDay: DEFAULT_RANGE.endDay,
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
    limit: TELEMETRY_USAGE_DEFAULT_PROJECTS_PAGE_SIZE,
    ...overrides,
  };
}

// What the server's JSON reads as on the wire.
function asJson(value: unknown): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function projectsUrl(query: {
  range: TelemetryUsageRange;
  sortBy?: string;
  sortOrder?: string;
  skip?: number;
  limit?: number;
}): string {
  return URL.fromString(APP_API_URL.toString())
    .addRoute(TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE)
    .addQueryParams({
      startDay: query.range.startDay,
      endDay: query.range.endDay,
      sortBy: query.sortBy || "total",
      sortOrder: query.sortOrder || "desc",
      skip: String(query.skip || 0),
      limit: String(query.limit || TELEMETRY_USAGE_DEFAULT_PROJECTS_PAGE_SIZE),
    })
    .toString();
}

async function renderPage(): Promise<void> {
  render(
    <I18nextProvider i18n={await englishInstance()}>
      <TelemetryUsagePage />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mockedAxios.mockReset();
  server = new FakeAxiosServer(mockedAxios);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Admin Dashboard > Telemetry Usage, through the browser's API client", () => {
  test("loads the table of projects, heaviest first, with the instance's totals", async () => {
    server.on(HTTPMethod.GET, projectsUrl({ range: DEFAULT_RANGE }), [
      { data: asJson(usagePage()) },
    ]);

    await renderPage();

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
    expect(
      screen.getByTestId("telemetry-usage-instance-total"),
    ).toHaveTextContent("31 GB");
    expect(
      screen.getByTestId(`telemetry-usage-instance-signal-${ProductType.Logs}`),
    ).toHaveTextContent("30 GB");
    expect(screen.queryByText(/not iterable/i)).not.toBeInTheDocument();
    expect(
      server.requestsTo(HTTPMethod.GET, projectsUrl({ range: DEFAULT_RANGE })),
    ).toHaveLength(1);
  });

  test("says what each project cost where billing is on", async () => {
    server.on(HTTPMethod.GET, projectsUrl({ range: DEFAULT_RANGE }), [
      {
        data: asJson(
          usagePage({
            isCostIncluded: true,
            total: { dataIngestedInGB: 25, totalCostInUSD: 2.5 },
            byProduct: {
              [ProductType.Logs]: {
                dataIngestedInGB: 25,
                totalCostInUSD: 2.5,
              },
            },
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
          }),
        ),
      },
    ]);

    await renderPage();

    const link: HTMLElement = (
      await screen.findAllByTestId("telemetry-usage-project-link")
    )[0]!;

    expect(link.closest("tr")).toHaveTextContent("2.5 USD");
  });

  test("says no project has usage yet when none sent any in the range", async () => {
    server.on(HTTPMethod.GET, projectsUrl({ range: DEFAULT_RANGE }), [
      {
        data: asJson(
          usagePage({
            total: { dataIngestedInGB: 0 },
            byProduct: {},
            projects: [],
            count: 0,
          }),
        ),
      },
    ]);

    await renderPage();

    expect(
      await screen.findByTestId("telemetry-usage-projects-empty"),
    ).toHaveTextContent("No telemetry usage yet");
    expect(
      screen.queryByTestId("telemetry-usage-project-link"),
    ).not.toBeInTheDocument();
  });

  test("says why when the server refuses the read", async () => {
    server.on(HTTPMethod.GET, projectsUrl({ range: DEFAULT_RANGE }), [
      {
        status: 400,
        data: { message: "startDay must be a day, as YYYY-MM-DD." },
      },
    ]);

    await renderPage();

    expect(
      await screen.findByText("startDay must be a day, as YYYY-MM-DD."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("telemetry-usage-project-link"),
    ).not.toBeInTheDocument();
  });
});

describe("the Admin Dashboard's telemetry usage reads", () => {
  test("every project's usage comes back whole: projects, totals, count, skip and limit", async () => {
    const range: TelemetryUsageRange = {
      startDay: "2026-11-01",
      endDay: "2026-11-07",
    };
    const page: TelemetryProjectUsagePage = usagePage({
      startDay: range.startDay,
      endDay: range.endDay,
      count: 120,
      skip: 50,
      limit: 50,
    });
    const url: string = projectsUrl({
      range: range,
      sortBy: ProductType.Metrics,
      sortOrder: "asc",
      skip: 50,
      limit: 50,
    });

    server.on(HTTPMethod.GET, url, [{ data: asJson(page) }]);

    const answer: TelemetryProjectUsagePage = await fetchUsageByProject({
      range: range,
      sortBy: ProductType.Metrics,
      sortOrder: "asc",
      skip: 50,
      limit: 50,
    });

    expect(answer).toEqual(page);
    expect(server.requestsTo(HTTPMethod.GET, url)).toHaveLength(1);
  });

  test("a refused read throws the server's answer, for the page to explain", async () => {
    const url: string = projectsUrl({ range: DEFAULT_RANGE });

    server.on(HTTPMethod.GET, url, [
      { status: 400, data: { message: "limit must be from 1 to 200." } },
    ]);

    await expect(
      fetchUsageByProject({
        range: DEFAULT_RANGE,
        sortBy: "total",
        sortOrder: "desc",
        skip: 0,
        limit: TELEMETRY_USAGE_DEFAULT_PROJECTS_PAGE_SIZE,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("one project's usage comes back whole", async () => {
    const range: TelemetryUsageRange = {
      startDay: "2026-11-01",
      endDay: "2026-11-07",
    };
    const summary: TelemetryUsageSummary = {
      startDay: range.startDay,
      endDay: range.endDay,
      isCostIncluded: false,
      total: { dataIngestedInGB: 6 },
      byProduct: {
        [ProductType.Logs]: { dataIngestedInGB: 5 },
        [ProductType.Metrics]: { dataIngestedInGB: 1 },
      },
      days: [
        {
          day: "2026-11-07",
          byProduct: {
            [ProductType.Logs]: { dataIngestedInGB: 5 },
            [ProductType.Metrics]: { dataIngestedInGB: 1 },
          },
          total: { dataIngestedInGB: 6 },
        },
      ],
      resources: [],
      latestDay: "2026-11-07",
    };
    const url: string = URL.fromString(APP_API_URL.toString())
      .addRoute(`${TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE}/${PROJECT_A}`)
      .addQueryParams({ startDay: range.startDay, endDay: range.endDay })
      .toString();

    server.on(HTTPMethod.GET, url, [{ data: asJson(summary) }]);

    const answer: TelemetryUsageSummary = await fetchProjectUsage({
      projectId: new ObjectID(PROJECT_A),
      range: range,
    });

    expect(answer).toEqual(summary);
  });
});
