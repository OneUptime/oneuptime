/** @timezone UTC */

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
  act,
  cleanup,
  configure,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import MetricsDashboard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsDashboard";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { getJestSpyOn } from "../../Spy";

/*
 * METRICS > INSIGHTS: HOW MANY METRIC TYPES THE PROJECT HAS, WHEN NONE
 * REPORTED IN THE WINDOW (#10921).
 *
 * The empty state says "Your project has 10,050 catalogued metric types,
 * but none reported during this window." The page read the project's first
 * 10,000 metric types by name - their names, units and descriptions - only
 * to count them, so a project with more read "10,000", and every visit read
 * 10,000 rows for one number. It is one row and the count now, counted on
 * the server. ModelAPI answers from a project faked whole (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

let server: CappedListServer;

beforeEach(() => {
  server = new CappedListServer();
  TelemetryEntityNameResolver.clearCache();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  // No point reported in the window: the page draws its empty state.
  getJestSpyOn(AnalyticsModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 5000,
  } as never);

  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

function addMetricTypes(count: number): void {
  server.add(
    MetricType,
    namesSortingFirst(count, "metric.").map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name: name,
          unit: "ms",
          description: `What ${name} measures.`,
        };
      },
    ),
  );
}

async function renderPage(): Promise<void> {
  server.install();

  await act(async () => {
    render(
      <MemoryRouter>
        <MetricsDashboard />
      </MemoryRouter>,
    );
  });
}

function metricTypeReads(): Array<CappedListCall> {
  return server.callsFor(MetricType);
}

describe("Metrics Insights: the metric types the project has, in its empty state", () => {
  test("a project past 10,000 metric types reads its whole count, never 10,000", async () => {
    addMetricTypes(LIMIT_PER_PROJECT + 50);

    await renderPage();

    expect(
      await screen.findByText(
        /Your project has 10,050 catalogued metric types, but none reported during this window\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/10,000 catalogued/)).toBeNull();
  });

  test("the count is one row and the count, never the first 10,000 by name", async () => {
    addMetricTypes(LIMIT_PER_PROJECT + 50);

    await renderPage();
    await screen.findByText(/catalogued metric types/);

    const reads: Array<CappedListCall> = metricTypeReads();

    expect(reads).toHaveLength(1);
    expect(reads[0]!.limit).toBe(1);
    expect(reads[0]!.skip).toBe(0);
    // Neither names, units nor descriptions: nothing the page draws.
    expect(Object.keys(reads[0]!.select)).toEqual(["_id"]);
    // Counted in any order: no sort for the server to spend on one row.
    expect(reads[0]!.sort).toEqual({});
  });

  test("one metric type reads in the singular", async () => {
    addMetricTypes(1);

    await renderPage();

    expect(
      await screen.findByText(
        /Your project has 1 catalogued metric type, but none reported during this window\./,
      ),
    ).toBeInTheDocument();
  });

  test("a project with no metric types is told how to send its first metrics", async () => {
    await renderPage();

    expect(
      await screen.findByText(
        /Once your services start sending metrics via OpenTelemetry/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/catalogued metric type/)).toBeNull();
  });

  test("a count the server could not give falls back to the row it read", async () => {
    addMetricTypes(3);
    server.install();

    const list: typeof server.list = server.list.bind(server);

    // A list route that answers without a count: the row read still counts.
    jest.spyOn(server, "list").mockImplementation(((
      options: Parameters<typeof server.list>[0],
    ) => {
      const page: ReturnType<typeof server.list> = list(options);

      return options.modelType === MetricType
        ? { ...page, count: undefined as unknown as number }
        : page;
    }) as never);

    await act(async () => {
      render(
        <MemoryRouter>
          <MetricsDashboard />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByText(
        /Your project has 1 catalogued metric type, but none reported during this window\./,
      ),
    ).toBeInTheDocument();
  });
});
