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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Traces > Analytics keeps the explorer's Span Type in a select of its own,
 * since the sidebar that holds it is hidden there. What each choice is used
 * to be that select's title attribute: one English paragraph, shown only to
 * a mouse that waited on the select. It is the sidebar's (i) now, beside the
 * select's caption: the same names and sentences, on hover, keyboard focus
 * or a tap, and to a screen reader as the (i)'s description - opening below
 * the control, so it never covers the choices it explains.
 *
 * The real TracesAnalyticsView is mounted against a mocked analytics
 * endpoint, recharts replaced by an empty chart (as in
 * TracesAnalyticsStatusSplit.test.tsx).
 */

const apiPostMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("recharts", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;

  const chart: (props: any) => React.ReactElement = (
    props: any,
  ): React.ReactElement => {
    return ReactInFactory.createElement(
      "div",
      { "data-testid": "chart" },
      props.children,
    );
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: chart,
    BarChart: chart,
    LineChart: chart,
    AreaChart: chart,
    Bar: nothing,
    Line: nothing,
    Area: nothing,
    CartesianGrid: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import TracesAnalyticsView from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView";
import ObjectID from "../../../Types/ObjectID";
import {
  TRACE_SPAN_TYPE_OPTIONS,
  TraceSpanType,
  TraceSpanTypeOption,
} from "../../../Types/Telemetry/TraceSpanType";

jest.setTimeout(30000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

// The paragraph the select's title attribute used to hold.
const OLD_HELP: string =
  "Entry spans: where a request or message enters a service. Root spans: where a trace starts. All spans: every operation, including database calls and internal steps.";

const renderView: (options?: {
  spanType?: TraceSpanType;
  onSpanTypeChange?: MockFunction;
}) => void = (options?: {
  spanType?: TraceSpanType;
  onSpanTypeChange?: MockFunction;
}): void => {
  render(
    <TracesAnalyticsView
      baseFilters={{}}
      attributeKeys={[]}
      serviceNameMap={{}}
      spanType={options?.spanType}
      onSpanTypeChange={options?.onSpanTypeChange as any}
    />,
  );
};

const spanTypeSelect: () => HTMLSelectElement = (): HTMLSelectElement => {
  return screen.getByRole("combobox", {
    name: "Span Type",
  }) as HTMLSelectElement;
};

const helpButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: "About Span Type" });
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 250);
    });
  });
};

beforeEach(() => {
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  apiPostMock.mockImplementation(async () => {
    return { data: { data: [] } };
  });
});

afterEach(() => {
  cleanup();
  apiPostMock.mockReset();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
});

describe("the analytics view's Span Type", () => {
  test("REGRESSION: its select carries no English paragraph as a title", async () => {
    renderView({
      spanType: TraceSpanType.Entry,
      onSpanTypeChange: getJestMockFunction(),
    });
    await settle();

    expect(spanTypeSelect()).not.toHaveAttribute("title");
    expect(screen.queryByTitle(OLD_HELP)).toBeNull();
    expect(
      Array.from(spanTypeSelect().options).map(
        (option: HTMLOptionElement): string => {
          return option.textContent || "";
        },
      ),
    ).toEqual(["Entry spans", "Root spans", "All spans"]);
  });

  test("has the sidebar's (i) between its caption and its select, described by each choice", async () => {
    renderView({
      spanType: TraceSpanType.Entry,
      onSpanTypeChange: getJestMockFunction(),
    });
    await settle();

    const button: HTMLElement = helpButton();
    const caption: HTMLElement = screen.getByText("Span Type");

    expect(
      caption.compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      button.compareDocumentPosition(spanTypeSelect()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(button).toHaveAccessibleDescription(
      TRACE_SPAN_TYPE_OPTIONS.map((option: TraceSpanTypeOption): string => {
        return `${option.label}: ${option.description}`;
      }).join(" "),
    );
  });

  test("hovering the (i) lists each choice with what it is", async () => {
    renderView({
      spanType: TraceSpanType.Root,
      onSpanTypeChange: getJestMockFunction(),
    });
    await settle();

    fireEvent.mouseEnter(helpButton());
    await settle();

    const tooltip: HTMLElement = screen.getByRole("tooltip");
    expect(
      Array.from(tooltip.querySelectorAll("dt")).map(
        (term: Element): [string, string] => {
          return [
            term.textContent || "",
            term.nextElementSibling?.textContent || "",
          ];
        },
      ),
    ).toEqual(
      TRACE_SPAN_TYPE_OPTIONS.map(
        (option: TraceSpanTypeOption): [string, string] => {
          return [option.label, option.description];
        },
      ),
    );
    expect(within(tooltip).queryByText(OLD_HELP)).toBeNull();

    fireEvent.mouseLeave(helpButton());
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toEqual([]);
    });
  });

  test("a press on the (i) changes nothing; the select still chooses", async () => {
    const onSpanTypeChange: MockFunction = getJestMockFunction();
    renderView({
      spanType: TraceSpanType.Entry,
      onSpanTypeChange: onSpanTypeChange,
    });
    await settle();

    fireEvent.click(helpButton());
    expect(onSpanTypeChange).not.toHaveBeenCalled();

    fireEvent.change(spanTypeSelect(), { target: { value: "all" } });
    expect(onSpanTypeChange.mock.calls).toEqual([[TraceSpanType.All]]);
  });

  test("a view without the explorer's Span Type has neither the select nor the (i)", async () => {
    renderView();
    await settle();

    expect(screen.queryByRole("combobox", { name: "Span Type" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "About Span Type" }),
    ).toBeNull();
    // The other controls keep their caption right before their select.
    expect(screen.getByRole("combobox", { name: "Chart" })).toBe(
      screen.getByText("Chart").nextElementSibling,
    );
  });
});
