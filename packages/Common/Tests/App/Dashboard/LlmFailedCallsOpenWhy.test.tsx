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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * LLM USAGE'S ERROR RATE OPENS THE AI CALLS THAT FAILED (#9750).
 *
 * The Usage tab's "AI calls" tile said "1.5% error rate" and nothing opened
 * the calls that failed. Now, while any did, the rate is a link to Calls -
 * every AI call, as the tile counts them - with its Status filter on Error
 * and its Seen At on the tab's range, in the list's own address; and Calls
 * says under a failed call's status why it failed, in the provider's own
 * words.
 */

type CapturedFilter = {
  field: Record<string, boolean>;
  title: string;
  type: unknown;
  filterDropdownOptions?: Array<{ label: string; value: unknown }>;
};

type CapturedColumn = {
  field: Record<string, boolean>;
  title: string;
  getElement?: ((item: Span) => React.ReactElement) | undefined;
};

type CapturedTableProps = {
  columns?: Array<CapturedColumn>;
  filters?: Array<CapturedFilter>;
  selectMoreFields?: Record<string, boolean>;
  userPreferencesKey?: string;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const fetchUsageMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmObservabilityReads",
  () => {
    return {
      __esModule: true,
      fetchLlmUsage: (...args: Array<unknown>) => {
        return fetchUsageMock(...args);
      },
    };
  },
);

import LlmCallsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmCallsTable";
import {
  getFailedLlmCallsRoute,
  getLlmCallsFilterData,
  LLM_CALLS_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmCallsRoute";
import LlmUsageTotalsTiles, {
  SHOW_FAILED_AI_CALLS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageTotals";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import {
  LlmUsageFigures,
  LlmUsageSource,
  emptyLlmUsageFigures,
  emptyLlmUsageResponse,
} from "../../../Types/Telemetry/LlmUsageApi";
import buildQueryFromFilterData, {
  sanitizeFilterData,
} from "../../../UI/Components/ModelTable/FilterDataToQuery";
import Filter from "../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../UI/Components/Types/FieldType";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const RANGE: InBetween<Date> = new InBetween<Date>(
  new Date("2026-10-03T00:00:00.000Z"),
  new Date("2026-10-10T00:00:00.000Z"),
);

const CALLS_ROUTE: Route = new Route(
  `/dashboard/${PROJECT_ID.toString()}/llm/calls`,
);

// The filter state a link carries, read back as the table reads its URL.
function filterStateOf(link: string): JSONObject {
  const url: URL = new URL(link, "https://oneuptime.example");
  const raw: string | null = url.searchParams.get(
    TableFilterUrlState.getParamName(LLM_CALLS_TABLE_ID, "filter"),
  );

  expect(raw).not.toBeNull();

  return JSONFunctions.deserialize(
    JSONFunctions.parseJSONObject(raw as string),
  ) as JSONObject;
}

function serve(totals: Partial<LlmUsageFigures> | Error): void {
  fetchUsageMock.mockImplementation(() => {
    if (totals instanceof Error) {
      return Promise.reject(totals);
    }

    return Promise.resolve({
      ...emptyLlmUsageResponse(),
      totals: { ...emptyLlmUsageFigures(), ...totals },
    });
  });
}

async function renderCallsTable(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <LlmCallsTable />
      </MemoryRouter>,
    );
  });

  expect(capturedTableProps).not.toBeNull();
}

function callsFilters(): Array<Filter<Span>> {
  return (capturedTableProps?.filters || []) as unknown as Array<Filter<Span>>;
}

function failedSpan(message: string | undefined, status: SpanStatus): Span {
  const span: Span = new Span();
  span.traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  span.spanId = "00f067aa0ba902b7";
  span.statusCode = status;
  span.statusMessage = message;
  return span;
}

beforeEach(() => {
  capturedTableProps = null;
  getCurrentProjectIdMock.mockReset();
  fetchUsageMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
});

describe("the link to the AI calls that failed", () => {
  test("lands on Calls with its Status filter on Error and its Seen At on the range", () => {
    const route: Route = getFailedLlmCallsRoute({
      callsRoute: CALLS_ROUTE,
      range: RANGE,
    });

    expect(route.toString().startsWith(CALLS_ROUTE.toString())).toBe(true);

    const state: JSONObject = filterStateOf(route.toString());

    expect(state["statusCode"]).toEqual([SpanStatus.Error]);
    expect(state["startTime"]).toBeInstanceOf(InBetween);
    // A URL holds a moment as its text, which the table reads back as one.
    expect(
      new Date(
        (state["startTime"] as unknown as InBetween<Date>).startValue,
      ).toISOString(),
    ).toBe(RANGE.startValue.toISOString());
    expect(
      new Date(
        (state["startTime"] as unknown as InBetween<Date>).endValue,
      ).toISOString(),
    ).toBe(RANGE.endValue.toISOString());
  });

  test("never changes the range it was handed", () => {
    const range: InBetween<Date> = new InBetween<Date>(
      new Date(RANGE.startValue),
      new Date(RANGE.endValue),
    );

    getFailedLlmCallsRoute({ callsRoute: CALLS_ROUTE, range: range });

    expect(range.startValue).toEqual(RANGE.startValue);
    expect(range.endValue).toEqual(RANGE.endValue);
  });

  test("every call of the range, when a count opens all of them", () => {
    expect(
      getLlmCallsFilterData({ range: RANGE, isFailedOnly: false })[
        "statusCode"
      ],
    ).toBeUndefined();
  });

  test("Calls filters by exactly what the link sets: the failed calls of the range", async () => {
    await renderCallsTable();

    const state: JSONObject = filterStateOf(
      getFailedLlmCallsRoute({
        callsRoute: CALLS_ROUTE,
        range: RANGE,
      }).toString(),
    );

    // The table keeps only what it offers a filter for: both survive.
    const sanitized: JSONObject = sanitizeFilterData<Span>({
      filterData: state as never,
      filters: callsFilters(),
    }) as unknown as JSONObject;

    expect(Object.keys(sanitized).sort()).toEqual(["startTime", "statusCode"]);

    const query: Query<Span> = buildQueryFromFilterData<Span>({
      filterData: sanitized as never,
      filters: callsFilters(),
    });

    expect((query as JSONObject)["statusCode"]).toBeInstanceOf(Includes);
    expect(
      ((query as JSONObject)["statusCode"] as unknown as Includes).values,
    ).toEqual([SpanStatus.Error]);

    const window: InBetween<Date> = (query as JSONObject)[
      "startTime"
    ] as unknown as InBetween<Date>;

    expect(window).toBeInstanceOf(InBetween);
    // The minutes the range covers, whole.
    expect(new Date(window.startValue).getTime()).toBeLessThanOrEqual(
      RANGE.startValue.getTime(),
    );
    expect(new Date(window.endValue).getTime()).toBeGreaterThanOrEqual(
      RANGE.endValue.getTime(),
    );
  });
});

describe("Calls", () => {
  test("keeps its filters in the namespace the link writes", async () => {
    await renderCallsTable();

    expect(capturedTableProps?.userPreferencesKey).toBe(LLM_CALLS_TABLE_ID);
  });

  test("offers a Status filter, Error among its options", async () => {
    await renderCallsTable();

    const status: CapturedFilter | undefined =
      capturedTableProps?.filters?.find((filter: CapturedFilter): boolean => {
        return filter.title === "Status";
      });

    expect(status?.field).toEqual({ statusCode: true });
    expect(status?.type).toBe(FieldType.MultiSelectDropdown);
    expect(
      (status?.filterDropdownOptions || []).map(
        (option: { label: string; value: unknown }): unknown => {
          return option.value;
        },
      ),
    ).toContain(SpanStatus.Error);
  });

  test("reads each call's error with it", async () => {
    await renderCallsTable();

    expect(capturedTableProps?.selectMoreFields?.["statusMessage"]).toBe(true);
  });

  test("a failed call says why under its status, in the provider's words", async () => {
    await renderCallsTable();

    const status: CapturedColumn | undefined =
      capturedTableProps?.columns?.find((column: CapturedColumn): boolean => {
        return column.title === "Status";
      });

    render(
      <MemoryRouter>
        {status!.getElement!(
          failedSpan(
            "429 Too Many Requests: rate limit exceeded for gpt-x",
            SpanStatus.Error,
          ),
        )}
      </MemoryRouter>,
    );

    const error: HTMLElement = screen.getByTestId("llm-call-error");

    expect(error).toHaveTextContent(
      "429 Too Many Requests: rate limit exceeded for gpt-x",
    );
    // Two lines at most; the whole of it on hover.
    expect(error).toHaveAttribute(
      "title",
      "429 Too Many Requests: rate limit exceeded for gpt-x",
    );
  });

  test("a call that did not fail, or failed with no message, says nothing more", async () => {
    await renderCallsTable();

    const status: CapturedColumn | undefined =
      capturedTableProps?.columns?.find((column: CapturedColumn): boolean => {
        return column.title === "Status";
      });

    for (const span of [
      failedSpan("stale message", SpanStatus.Ok),
      failedSpan(undefined, SpanStatus.Error),
      failedSpan("   ", SpanStatus.Error),
    ]) {
      render(<MemoryRouter>{status!.getElement!(span)}</MemoryRouter>);
      expect(screen.queryByTestId("llm-call-error")).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe("LLM Usage's AI calls tile", () => {
  async function renderTiles(): Promise<void> {
    await act(async () => {
      render(<LlmUsageTotalsTiles range={RANGE} />);
    });
  }

  test("its error rate opens the AI calls of the range that failed", async () => {
    serve({
      calls: 200,
      erroredCalls: 3,
      tokenSource: LlmUsageSource.Calls,
      costSource: LlmUsageSource.Calls,
    });

    await renderTiles();

    const hint: HTMLElement = screen.getByTestId("llm-usage-totals-calls-hint");

    expect(hint.tagName).toBe("A");
    expect(hint).toHaveTextContent("1.5% error rate");
    expect(hint).toHaveAttribute("title", SHOW_FAILED_AI_CALLS);

    const href: string = hint.getAttribute("href") || "";

    expect(href.startsWith(CALLS_ROUTE.toString())).toBe(true);

    const state: JSONObject = filterStateOf(href);

    expect(state["statusCode"]).toEqual([SpanStatus.Error]);
    expect(
      new Date(
        (state["startTime"] as unknown as InBetween<Date>).startValue,
      ).toISOString(),
    ).toBe(RANGE.startValue.toISOString());
  });

  test("with no call that failed, the rate opens nothing", async () => {
    serve({ calls: 40, erroredCalls: 0 });

    await renderTiles();

    const hint: HTMLElement = screen.getByTestId("llm-usage-totals-calls-hint");

    expect(hint.tagName).not.toBe("A");
    expect(hint).toHaveTextContent("0% error rate");
  });

  test("a read that failed opens nothing", async () => {
    serve(new Error("Error connecting to server."));

    await renderTiles();

    const hint: HTMLElement = screen.getByTestId("llm-usage-totals-calls-hint");

    expect(hint.tagName).not.toBe("A");
    expect(hint).toHaveTextContent("Could not be loaded");
  });

  test("the tile itself stays no control, so the link is never inside another", async () => {
    serve({ calls: 200, erroredCalls: 3 });

    await renderTiles();

    const tile: HTMLElement = screen.getByTestId("llm-usage-totals-calls");

    expect(tile.tagName).toBe("DIV");
    expect(tile.querySelectorAll("a, button")).toHaveLength(1);
  });
});
