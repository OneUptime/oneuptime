import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A CLOUD ENVIRONMENT'S OVERVIEW SAYS WHY A NUMBER IS EMPTY (#6792, #6840).
 *
 * PR #6792 had the environment's overview (App Platforms > an environment)
 * say why a tile has no number, as an app's overview does: a 0 the
 * environment never measured reads as nothing running, or as nothing
 * served. These render the page for real and read what each tile and the
 * Requests chart draw:
 *
 *   - Instances: "Not reported" for an environment seen in the live window
 *     that never named an instance; its 0 over the live window otherwise;
 *   - Requests, Error rate and p95 latency: "No traces received" when the
 *     range holds no request AND none of the environment's apps has ever
 *     sent a trace - with no error-rate meter - and the Requests chart says
 *     the same; zeros when an app has sent traces before, or when the apps
 *     could not be counted;
 *   - a span read that failed is unknown, not a note: "could not load" on
 *     the tiles, and the Requests chart says something went wrong.
 *
 * The notes' rules on their own are held in CloudAppTelemetrySetup.test.ts;
 * App's Tests/Dashboard/CloudResourcePages reads the page's code.
 */

interface SpanReply {
  total: number;
  errors: number;
  errorRatePercent: number | null;
  p95DurationMs: number | null;
  failed?: boolean;
}

interface ListRequest {
  modelType: { name: string };
  query: Record<string, unknown>;
}

// What the reads answer, set by each test.
const mockReads: {
  environment: Record<string, unknown>;
  instances: Array<Record<string, unknown>>;
  span: SpanReply;
  // The apps of the environment that sent a trace, or a failed count.
  appsWithTraces: number | "fail";
  countQueries: Array<Record<string, unknown>>;
} = {
  environment: {},
  instances: [],
  span: { total: 0, errors: 0, errorRatePercent: null, p95DurationMs: null },
  appsWithTraces: 0,
  countQueries: [],
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
    ) as Record<string, unknown>;

    return {
      ...actual,
      fetchSpanMetrics: async (): Promise<unknown> => {
        if (mockReads.span.failed) {
          // What fetchSpanMetrics answers when its aggregates fail.
          return {
            total: 0,
            errors: 0,
            errorRatePercent: null,
            p95DurationMs: null,
            countSeries: [],
            errorSeries: [],
            p95Series: [],
            failed: true,
          };
        }

        return {
          ...mockReads.span,
          countSeries: [],
          errorSeries: [],
          p95Series: [],
        };
      },
      fetchMetricSeries: async (): Promise<Array<unknown>> => {
        return [];
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        // A fresh object per read, as the API answers.
        return { ...mockReads.environment };
      },
      getList: async (request: ListRequest): Promise<unknown> => {
        const data: Array<unknown> =
          request.modelType.name === "CloudResourceInstance"
            ? mockReads.instances
            : [];

        return { data, count: data.length, skip: 0, limit: 50 };
      },
      count: async (request: ListRequest): Promise<number> => {
        mockReads.countQueries.push(request.query);

        if (mockReads.appsWithTraces === "fail") {
          throw new Error("403 Forbidden");
        }

        return mockReads.appsWithTraces;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("aaaaaaaa-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("cccccccc-0000-4000-8000-000000000003");
      },
      navigate: (): void => {},
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (): string => {
        return "failed";
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

import CloudEnvironmentOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  formatCompact,
  formatDurationMs,
  formatPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics";
import {
  CLOUD_APP_CHART_LOAD_FAILED,
  CLOUD_APP_LOAD_FAILED_SUBLABEL,
  CLOUD_APP_NO_TRACES_NOTE,
  CLOUD_APP_NOT_REPORTED_NOTE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import ObjectID from "../../../Types/ObjectID";

const ENVIRONMENT_ID: string = "cccccccc-0000-4000-8000-000000000003";
const MINUTE_MS: number = 60 * 1000;
const NO_DATA: string = "No data in this time range";
const LIVE_WINDOW_LINE: string = `live in the last ${CLOUD_INSTANCE_LIVE_WINDOW_MINUTES} min`;
const TRACE_TILES: Array<string> = ["Requests", "Error rate", "p95 latency"];

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

// An ECS environment, last seen at the given time.
function environment(lastSeenAt: Date): Record<string, unknown> {
  return {
    name: "prod · us-east-1",
    resourceIdentifier: "aws_ecs|123456789012|us-east-1",
    otelCollectorStatus: "connected",
    cloudPlatform: "aws_ecs",
    cloudProvider: "aws",
    cloudRegion: "us-east-1",
    cloudAccountId: "123456789012",
    lastSeenAt: lastSeenAt,
  };
}

function instance(name: string, lastSeenAt: Date): Record<string, unknown> {
  return {
    instanceName: name,
    latestCpuPercent: 40,
    latestMemoryBytes: 256 * 1024 * 1024,
    lastSeenAt: lastSeenAt,
  };
}

async function settle(): Promise<void> {
  // The model, then the instances, the app count and the metrics, a tick each.
  for (let tick: number = 0; tick < 4; tick++) {
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void): void => {
        setTimeout(resolve, 0);
      });
    });
  }
}

async function renderOverview(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CloudEnvironmentOverview {...({} as PageComponentProps)} />
      </MemoryRouter>,
    );
  });
  await settle();
}

interface DrawnTile {
  value: string | null;
  note: string | null;
  sublabel: string | null;
  // Whether the tile draws a meter under its value (the error rate's).
  hasMeter: boolean;
}

/*
 * A tile, by its title, as drawn: its value, or the note in its place, the
 * line under it, and its meter. The first "About <title>" is the tile's; a
 * chart card may share the title.
 */
function tile(title: string): DrawnTile {
  const element: HTMLElement = screen
    .getAllByRole("button", { name: `About ${title}` })[0]!
    .closest(".rounded-xl") as HTMLElement;
  const note: Element | null = element.querySelector(
    "[data-testid='resource-overview-tile-value-note']",
  );
  const value: Element | null = element.querySelector(".text-2xl");
  const sublabel: Element | null = element.querySelector("div.line-clamp-2");

  return {
    value: value ? (value.textContent || "").trim() : null,
    note: note ? (note.textContent || "").trim() : null,
    sublabel: sublabel ? (sublabel.textContent || "").trim() : null,
    hasMeter: element.querySelector("[style*='width']") !== null,
  };
}

// A chart's card, by its title: the last "About <title>", after the tiles.
function chartText(title: string): string {
  const abouts: Array<HTMLElement> = screen.getAllByRole("button", {
    name: `About ${title}`,
  });

  return (
    (abouts[abouts.length - 1]!.closest(".rounded-xl") as HTMLElement)
      .textContent || ""
  );
}

beforeEach(() => {
  mockReads.environment = environment(minutesAgo(1));
  mockReads.instances = [];
  mockReads.span = {
    total: 0,
    errors: 0,
    errorRatePercent: null,
    p95DurationMs: null,
  };
  mockReads.appsWithTraces = 0;
  mockReads.countQueries = [];
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("the environment's Instances tile", () => {
  test("seen in the live window, and never naming an instance: Not reported, not a 0 that reads as nothing running", async () => {
    await renderOverview();

    expect(tile("Instances")).toEqual({
      value: null,
      note: CLOUD_APP_NOT_REPORTED_NOTE,
      // The note says it all: no live-window line under it.
      sublabel: null,
      hasMeter: false,
    });
  });

  test("not seen in the live window, with no instance: its 0, over the live window", async () => {
    mockReads.environment = environment(
      minutesAgo(CLOUD_INSTANCE_LIVE_WINDOW_MINUTES + 5),
    );

    await renderOverview();

    expect(tile("Instances")).toEqual({
      value: "0",
      note: null,
      sublabel: LIVE_WINDOW_LINE,
      hasMeter: false,
    });
  });

  test("instances it named, none live now: a 0 it measured, not Not reported", async () => {
    mockReads.instances = [
      instance("task-a", minutesAgo(CLOUD_INSTANCE_LIVE_WINDOW_MINUTES + 30)),
    ];

    await renderOverview();

    expect(tile("Instances")).toEqual({
      value: "0",
      note: null,
      sublabel: LIVE_WINDOW_LINE,
      hasMeter: false,
    });
  });

  test("live instances: their count", async () => {
    mockReads.instances = [
      instance("task-a", minutesAgo(1)),
      instance("task-b", minutesAgo(2)),
    ];

    await renderOverview();

    expect(tile("Instances")).toEqual({
      value: "2",
      note: null,
      sublabel: LIVE_WINDOW_LINE,
      hasMeter: false,
    });
  });
});

describe("the environment's trace tiles and Requests chart", () => {
  test("no request in the range, and no app ever sent a trace: No traces received, with no meter, on each and in the chart", async () => {
    await renderOverview();

    for (const title of TRACE_TILES) {
      expect({ title, tile: tile(title) }).toEqual({
        title,
        tile: {
          value: null,
          note: CLOUD_APP_NO_TRACES_NOTE,
          sublabel: null,
          // No error-rate meter for a rate that was never measured.
          hasMeter: false,
        },
      });
    }

    expect(chartText("Requests")).toContain(CLOUD_APP_NO_TRACES_NOTE);
    expect(chartText("Requests")).not.toContain(NO_DATA);
    // The memory chart has nothing to say about traces.
    expect(chartText("Memory")).toContain(NO_DATA);
    expect(chartText("Memory")).not.toContain(CLOUD_APP_NO_TRACES_NOTE);
  });

  test("the apps that sent a trace are counted for this environment only", async () => {
    await renderOverview();

    expect(mockReads.countQueries.length).toBeGreaterThan(0);

    for (const query of mockReads.countQueries) {
      expect(Object.keys(query).sort()).toEqual([
        "cloudResourceId",
        "tracesLastReceivedAt",
      ]);
      expect((query["cloudResourceId"] as ObjectID).toString()).toBe(
        ENVIRONMENT_ID,
      );
      expect(query["tracesLastReceivedAt"]).toBeInstanceOf(NotNull);
    }
  });

  test("an app has sent traces before, none in the range: the zeros it measured", async () => {
    mockReads.appsWithTraces = 2;

    await renderOverview();

    expect(tile("Requests")).toEqual({
      value: formatCompact(0),
      note: null,
      sublabel: "selected range",
      hasMeter: false,
    });
    expect(tile("p95 latency")).toEqual({
      value: formatDurationMs(null),
      note: null,
      sublabel: "selected range",
      hasMeter: false,
    });
    expect(chartText("Requests")).toContain(NO_DATA);
    expect(chartText("Requests")).not.toContain(CLOUD_APP_NO_TRACES_NOTE);
  });

  test("the apps could not be counted: nothing is said in place of the zeros", async () => {
    mockReads.appsWithTraces = "fail";

    await renderOverview();

    for (const title of TRACE_TILES) {
      expect({ title, note: tile(title).note }).toEqual({ title, note: null });
    }
    expect(tile("Requests").value).toBe(formatCompact(0));
    expect(chartText("Requests")).not.toContain(CLOUD_APP_NO_TRACES_NOTE);
  });

  test("requests in the range: their numbers, and the error rate's meter, whatever the apps sent before", async () => {
    mockReads.span = {
      total: 600,
      errors: 6,
      errorRatePercent: 1,
      p95DurationMs: 250,
    };

    await renderOverview();

    expect(tile("Requests")).toEqual({
      value: formatCompact(600),
      note: null,
      sublabel: "selected range",
      hasMeter: false,
    });
    expect(tile("Error rate")).toEqual({
      value: formatPercent(1),
      note: null,
      sublabel: `${formatCompact(6)} errored`,
      hasMeter: true,
    });
    expect(tile("p95 latency")).toEqual({
      value: formatDurationMs(250),
      note: null,
      sublabel: "selected range",
      hasMeter: false,
    });
  });

  test("a span read that failed is unknown: could not load on the tiles and a failure in the chart, never No traces received", async () => {
    mockReads.span = {
      total: 0,
      errors: 0,
      errorRatePercent: null,
      p95DurationMs: null,
      failed: true,
    };

    await renderOverview();

    for (const title of TRACE_TILES) {
      expect({ title, tile: tile(title) }).toEqual({
        title,
        tile: {
          value: "—",
          note: null,
          sublabel: CLOUD_APP_LOAD_FAILED_SUBLABEL,
          hasMeter: false,
        },
      });
    }

    expect(chartText("Requests")).toContain(CLOUD_APP_CHART_LOAD_FAILED);
    expect(chartText("Requests")).not.toContain(CLOUD_APP_NO_TRACES_NOTE);
  });
});
