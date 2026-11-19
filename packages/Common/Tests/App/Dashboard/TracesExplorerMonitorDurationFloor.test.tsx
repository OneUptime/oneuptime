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
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * #9714: opening the spans behind a Traces monitor's alert or incident in
 * the traces explorer applies the monitor's "Takes at least (ms)" floor.
 *
 * The mobile Slow Cold Start recommendation counts the AppStart spans of a
 * cold start that took 5 s or more. Its stored query carries the floor as
 * `durationUnixNano >= 5,000,000,000`, which the explorer used to keep on
 * the list only: the chart and the facet counts above it counted every cold
 * start, fast ones included, and a line said the span duration filter was
 * not carried over. The real TracesViewer runs here, its TelemetryViewer
 * captured and its data layer mocked, so what each transport sends is
 * read as sent.
 */

let viewerProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProps = props;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
      count: (...args: Array<any>) => {
        return analyticsCountMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import Span from "../../../Models/AnalyticsModels/Span";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import Query from "../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import { MonitorStepTraceMonitorUtil } from "../../../Types/Monitor/MonitorStepTraceMonitor";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const APP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FLOOR_NANOS: number = 5000 * 1_000_000;

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
}

/*
 * The Slow Cold Start recommendation's step, its query as the worker stores
 * it on the alert, and as the alert's page restores it.
 */
function slowColdStartQuery(): Query<Span> {
  const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery(
    {
      ...MonitorStepTraceMonitorUtil.getDefault(),
      telemetryServiceIds: [new ObjectID(APP_ID)],
      attributes: { "start.type": "cold" },
      spanName: "AppStart",
      minimumDurationInMs: 5000,
      lastXSecondsOfSpans: 900,
    },
    NOW,
  );

  return JSONFunctions.deserialize(
    JSONFunctions.anyObjectToJSONObject(query as unknown as JSONObject),
  ) as unknown as Query<Span>;
}

function lastSpanListQuery(): Record<string, unknown> {
  const reads: Array<ListArgs> = analyticsGetListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === Span;
    });

  expect(reads.length).toBeGreaterThan(0);

  return reads[reads.length - 1]!.query;
}

function lastBodyPostedTo(path: string): JSONObject {
  const bodies: Array<JSONObject> = postMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return String((call[0] as { url: unknown }).url).endsWith(path);
    })
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    });

  expect(bodies.length).toBeGreaterThan(0);

  return bodies[bodies.length - 1]!;
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 8; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function mount(element: React.ReactElement): Promise<RenderResult> {
  let result: RenderResult | null = null;
  await act(async () => {
    result = render(element);
  });
  await settle();
  return result!;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  viewerProps = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0, hasMore: false };
  });
  analyticsCountMock.mockImplementation(async () => {
    return 0;
  });
  postMock.mockImplementation(async () => {
    return { data: { buckets: [], facets: {}, attributes: [] } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("the spans behind a Slow Cold Start alert (#9714)", () => {
  test("the list keeps the monitor's floor as the inclusive comparison it counted with", async () => {
    await mount(<TracesViewer spanQuery={slowColdStartQuery()} limit={10} />);

    const durationFilter: unknown = lastSpanListQuery()["durationUnixNano"];

    expect(durationFilter).toBeInstanceOf(GreaterThanOrEqual);
    expect((durationFilter as GreaterThanOrEqual<number>).value).toBe(
      FLOOR_NANOS,
    );
  });

  test("the chart and the facet counts apply the same floor", async () => {
    await mount(<TracesViewer spanQuery={slowColdStartQuery()} limit={10} />);

    for (const path of [
      "/telemetry/traces/histogram",
      "/telemetry/traces/facets",
    ]) {
      const body: JSONObject = lastBodyPostedTo(path);

      expect(body["atLeastDurationNano"]).toBe(FLOOR_NANOS);
      // Inclusive, as the monitor counted: never the strict bound.
      expect(body["minDurationNano"]).toBeUndefined();
    }
  });

  test("the floor is a Duration chip, and no line says it was not carried over", async () => {
    const view: RenderResult = await mount(
      <TracesViewer spanQuery={slowColdStartQuery()} limit={10} />,
    );

    const chips: Array<{
      facetKey: string;
      displayKey: string;
      displayValue: string;
      readOnly?: boolean;
      lockedDetail?: { searchToken?: string };
    }> = viewerProps.activeFilters;

    const durationChip: (typeof chips)[number] | undefined = chips.find(
      (chip: (typeof chips)[number]): boolean => {
        return chip.facetKey === "durationUnixNano";
      },
    );

    expect(durationChip).toBeDefined();
    expect(durationChip!.readOnly).toBe(true);
    expect(durationChip!.displayKey).toBe("Duration");
    expect(durationChip!.displayValue).toMatch(/^≥\u00A05/);
    expect(durationChip!.displayValue).not.toContain("5000");
    expect(durationChip!.lockedDetail?.searchToken).toBe("duration:>=5000");

    expect(view.container.textContent || "").not.toContain(
      "are not narrowed by",
    );
  });

  test("a typed duration filter replaces the floor in both transports, as on every column", async () => {
    await mount(<TracesViewer spanQuery={slowColdStartQuery()} limit={10} />);

    // Typed into the search bar, then Enter.
    await act(async () => {
      viewerProps.onSearchChange("duration:<10000");
    });
    await settle();
    await act(async () => {
      viewerProps.onSearchSubmit();
    });
    await settle();

    const durationFilter: unknown = lastSpanListQuery()["durationUnixNano"];

    expect(durationFilter).toBeInstanceOf(LessThan);

    const body: JSONObject = lastBodyPostedTo("/telemetry/traces/histogram");

    expect(body["maxDurationNano"]).toBe(10000 * 1_000_000);
    expect(body["atLeastDurationNano"]).toBeUndefined();

    // Its chip comes off, as a filtered column's does: it no longer applies.
    expect(
      (viewerProps.activeFilters as Array<{ facetKey: string }>).some(
        (chip: { facetKey: string }): boolean => {
          return chip.facetKey === "durationUnixNano";
        },
      ),
    ).toBe(false);
  });

  test("REGRESSION: a typed duration:>=N applies an inclusive floor, where it applied nothing", async () => {
    await mount(<TracesViewer limit={10} disableUrlSync={true} />);

    await act(async () => {
      viewerProps.onSearchChange("duration:>=2500");
    });
    await settle();
    await act(async () => {
      viewerProps.onSearchSubmit();
    });
    await settle();

    const durationFilter: unknown = lastSpanListQuery()["durationUnixNano"];

    expect(durationFilter).toBeInstanceOf(GreaterThanOrEqual);
    expect((durationFilter as GreaterThanOrEqual<number>).value).toBe(
      2500 * 1_000_000,
    );
    expect(
      lastBodyPostedTo("/telemetry/traces/histogram")["atLeastDurationNano"],
    ).toBe(2500 * 1_000_000);
  });
});
