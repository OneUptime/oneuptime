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
import React, { act, FunctionComponent, ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The Trace Chart editor's Colors section under a split by span status (#4118)
 * ---------------------------------------------------------------------------
 *
 * Split by statusCode, the Trace Chart widget draws each status in its own
 * color (Unset green, Ok cyan, Error red) and ignores the widget's lead color
 * (resolveTraceSeriesColor in TraceChartData.ts). The editor still offered
 * "Default series color" there, a control that changed nothing, and its pin
 * editor suggested no values: the values endpoint only knows span
 * attributes, and a status is a column.
 *
 * The REAL TraceChartQueryEditor is mounted against a mocked trace
 * attributes endpoint and fed its own edits back, as the dashboard does.
 * Under a status split the lead-color control gives way to a note, the pin
 * editor suggests the stored values 0 / 1 / 2, and a pin is written under the
 * stored value the chart looks it up by. Any other split, no split, and the
 * Trace Table widget (which shares this editor) keep what they had.
 */

const apiPostMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import TraceChartQueryEditor from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/TraceChartQueryEditor";
import {
  SERIES_COLOR_SWATCHES,
  Swatch,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/SeriesColorSelector";
import {
  colorOf,
  getCustomButton,
} from "../../UI/Components/ColorPicker/ColorPickerDriver";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardTraceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

type TraceChartArguments = DashboardTraceChartComponent["arguments"];

type EditorMode = "chart" | "table";

const COMPONENT_ID: string = "11111111-1111-4111-8111-111111111111";

const ATTRIBUTES_ROUTE: string = "/telemetry/traces/get-attributes";
const VALUES_ROUTE: string = "/telemetry/traces/get-attribute-values";

// The span attributes the endpoint lists, and the values it knows for each.
const ATTRIBUTE_KEYS: Array<string> = ["url.host", "http.method"];
const VALUES_BY_ATTRIBUTE: Record<string, Array<string>> = {
  "url.host": ["api.example.com", "web.example.com"],
};

const STATUS_NOTE: string =
  "A split by status keeps each status's own color: Unset green, Ok cyan, Error red. To change one, pin its stored value below: 0 for Unset, 1 for Ok, 2 for Error.";

const DEFAULT_SERIES_COLOR_DESCRIPTION: string =
  "Colors the first unpinned series; the rest use the theme palette.";
const SERIES_COLOR_DESCRIPTION: string =
  "Pick a color for the series, or leave on Auto to use the theme palette.";

// The hover text of a lead-color control's Auto button.
const AUTO_TITLE: string = "Auto — use the theme palette";

/*
 * The pin editor's own entry for a series with no value. It offers it first
 * under an attribute split; a status split never has an empty series, and
 * "(unset)" would read as the Unset status, whose stored value is 0.
 */
const EMPTY_GROUP_VALUE: string = "(unset)";

// The pin editor's help text, and its wording under a status split.
const GROUP_COLORS_DESCRIPTION: string =
  "Pin a color to specific group values. Unpinned groups use the series color or theme palette.";
const STATUS_GROUP_COLORS_DESCRIPTION: string =
  "Pin a color to a status value. Unpinned statuses keep their own color.";

// A new pin starts on the first preset swatch.
const FIRST_PIN_COLOR: string = SERIES_COLOR_SWATCHES[0]!.hex;

type SwatchHexFunction = (name: string) => string;

// A preset swatch's hex, by the name its button carries.
const swatchHex: SwatchHexFunction = (name: string): string => {
  const swatch: Swatch | undefined = SERIES_COLOR_SWATCHES.find(
    (candidate: Swatch): boolean => {
      return candidate.name === name;
    },
  );
  expect(swatch).toBeDefined();
  return swatch!.hex;
};

interface PostRequest {
  url: { toString: () => string };
  data: Record<string, unknown>;
}

interface PostResponse {
  data: Record<string, unknown>;
}

// Everything the editor pushed back out through onChange, newest last.
interface EditorHandle {
  emitted: Array<DashboardBaseComponent>;
}

interface HarnessProps {
  initialComponent: DashboardBaseComponent;
  mode: EditorMode;
  onEmit: (component: DashboardBaseComponent) => void;
}

/*
 * The dashboard feeds each edit straight back down, so a stateful wrapper is
 * the only way a second edit sees the first one.
 */
const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [component, setComponent] = useState<DashboardBaseComponent>(
    props.initialComponent,
  );

  return (
    <TraceChartQueryEditor
      component={component}
      mode={props.mode}
      onChange={(next: DashboardBaseComponent): void => {
        setComponent(next);
        props.onEmit(next);
      }}
    />
  );
};

type RenderEditorFunction = (
  args: TraceChartArguments,
  mode?: EditorMode,
) => Promise<EditorHandle>;

const renderEditor: RenderEditorFunction = async (
  args: TraceChartArguments,
  mode: EditorMode = "chart",
): Promise<EditorHandle> => {
  const handle: EditorHandle = { emitted: [] };
  const component: DashboardBaseComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: new ObjectID(COMPONENT_ID),
    componentType:
      mode === "table"
        ? DashboardComponentType.TraceTable
        : DashboardComponentType.TraceChart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };

  await act(async (): Promise<void> => {
    render(
      <Harness
        initialComponent={component}
        mode={mode}
        onEmit={(next: DashboardBaseComponent): void => {
          handle.emitted.push(next);
        }}
      />,
    );
  });

  return handle;
};

type LastArgumentsFunction = (handle: EditorHandle) => Record<string, unknown>;

// The widget arguments the editor wrote last.
const lastArguments: LastArgumentsFunction = (
  handle: EditorHandle,
): Record<string, unknown> => {
  const last: DashboardBaseComponent | undefined =
    handle.emitted[handle.emitted.length - 1];

  if (!last) {
    throw new Error("The editor did not emit anything.");
  }

  return (last.arguments || {}) as Record<string, unknown>;
};

type ValueRequestsFunction = () => Array<unknown>;

// The keys the editor asked the values endpoint about, in order.
const valueRequests: ValueRequestsFunction = (): Array<unknown> => {
  const calls: Array<Array<any>> = apiPostMock.mock.calls;
  return calls
    .map((call: Array<any>): PostRequest => {
      return call[0] as PostRequest;
    })
    .filter((request: PostRequest): boolean => {
      return request.url.toString().includes(VALUES_ROUTE);
    })
    .map((request: PostRequest): unknown => {
      return request.data["attributeKey"];
    });
};

type OpenColorsFunction = () => void;

// The Colors section starts collapsed; open it the way a reader does.
const openColors: OpenColorsFunction = (): void => {
  const header: HTMLElement = screen.getByRole("button", { name: "Colors" });
  expect(header).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(header);
  expect(header).toHaveAttribute("aria-expanded", "true");
};

type PinInputFunction = () => HTMLInputElement;

// The pin editor's "add a value" box: the one input with suggestions.
const pinInput: PinInputFunction = (): HTMLInputElement => {
  const inputs: Array<HTMLInputElement> = Array.from(
    document.body.querySelectorAll<HTMLInputElement>("input[list]"),
  );
  expect(inputs).toHaveLength(1);
  return inputs[0]!;
};

type PinSuggestionsFunction = () => Array<string>;

// The values the pin box's datalist offers, in order.
const pinSuggestions: PinSuggestionsFunction = (): Array<string> => {
  const listId: string | null = pinInput().getAttribute("list");
  const datalist: HTMLElement | null = listId
    ? document.getElementById(listId)
    : null;
  expect(datalist).not.toBeNull();
  return Array.from(datalist!.querySelectorAll("option")).map(
    (option: HTMLOptionElement): string => {
      return option.value;
    },
  );
};

type AddPinFunction = (value: string) => void;

// Types a value into the pin box and adds it, as a reader does.
const addPin: AddPinFunction = (value: string): void => {
  fireEvent.change(pinInput(), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
};

type ChooseSplitFunction = (optionLabel: string) => Promise<void>;

// Picks an option of the "Split into series by" dropdown.
const chooseSplit: ChooseSplitFunction = async (
  optionLabel: string,
): Promise<void> => {
  const field: HTMLElement = screen.getByText("Split into series by")
    .parentElement as HTMLElement;
  fireEvent.keyDown(within(field).getByRole("combobox"), {
    key: "ArrowDown",
  });
  const option: HTMLElement = await screen.findByRole("option", {
    name: optionLabel,
  });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
};

describe("Trace Chart editor — Colors under a split by span status", () => {
  beforeEach(() => {
    apiPostMock.mockImplementation(
      async (request: PostRequest): Promise<PostResponse> => {
        const url: string = request.url.toString();
        if (url.includes(VALUES_ROUTE)) {
          const key: string = String(request.data["attributeKey"]);
          return { data: { values: VALUES_BY_ATTRIBUTE[key] || [] } };
        }
        if (url.includes(ATTRIBUTES_ROUTE)) {
          return { data: { attributes: ATTRIBUTE_KEYS } };
        }
        return { data: {} };
      },
    );
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("REGRESSION: a split by status says each status keeps its own color, and offers no lead color the chart would ignore", async () => {
    const handle: EditorHandle = await renderEditor({
      metric: "count",
      groupByAttribute: "statusCode",
    });

    openColors();

    expect(
      screen.getByTestId("trace-chart-status-split-colors").textContent,
    ).toBe(STATUS_NOTE);

    // The note stands where the lead-color control was.
    expect(screen.queryByText("Default series color")).not.toBeInTheDocument();
    expect(screen.queryByText("Series color")).not.toBeInTheDocument();
    expect(
      screen.queryByText(DEFAULT_SERIES_COLOR_DESCRIPTION),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle(AUTO_TITLE)).not.toBeInTheDocument();
    // No swatches at all until a status is pinned.
    expect(
      screen.queryByRole("radio", { name: SERIES_COLOR_SWATCHES[0]!.name }),
    ).not.toBeInTheDocument();

    // A pin still wins over a status's own color, so the pin editor stays.
    expect(screen.getByText("Group colors")).toBeInTheDocument();
    expect(screen.getByText("No pinned values yet.")).toBeInTheDocument();

    // Showing the note wrote nothing to the widget.
    expect(handle.emitted).toEqual([]);
  });

  test("REGRESSION: the pin editor suggests the stored status values 0 / 1 / 2, which the values endpoint cannot list", async () => {
    await renderEditor({ metric: "count", groupByAttribute: "statusCode" });

    openColors();

    /*
     * The chart looks a status pin up by the stored value ("statusCode=2"),
     * which is what the note tells a reader to type. No "(unset)": next to a
     * legend reading "Unset (no error)" it would pass for the Unset status,
     * yet a "statusCode=(unset)" pin matches no series.
     */
    expect(pinSuggestions()).toEqual(["0", "1", "2"]);
    expect(pinInput()).toHaveAttribute("placeholder", "Pick or type a value…");
    // The endpoint only knows span attributes, so it is not asked.
    expect(valueRequests()).toEqual([]);
    // The help text agrees with the note instead of promising a palette.
    expect(
      screen.getByText(STATUS_GROUP_COLORS_DESCRIPTION),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(GROUP_COLORS_DESCRIPTION),
    ).not.toBeInTheDocument();
  });

  test("pinning Error by its stored value still writes colorsByGroup under statusCode=2", async () => {
    const handle: EditorHandle = await renderEditor({
      metric: "count",
      groupByAttribute: "statusCode",
    });

    openColors();
    addPin("2");

    // Keyed the way the chart looks it up; no lead color is written.
    expect(lastArguments(handle)).toEqual({
      metric: "count",
      groupByAttribute: "statusCode",
      colorsByGroup: { "statusCode=2": FIRST_PIN_COLOR },
    });
    expect(
      screen.getByRole("button", { name: "Remove 2" }),
    ).toBeInTheDocument();
    // A pinned value is no longer suggested.
    expect(pinSuggestions()).toEqual(["0", "1"]);

    // The pin's own swatches are the only ones under this split.
    fireEvent.click(screen.getByRole("radio", { name: "Rose" }));

    expect(lastArguments(handle)).toEqual({
      metric: "count",
      groupByAttribute: "statusCode",
      colorsByGroup: { "statusCode=2": swatchHex("Rose") },
    });

    // Removing the last pin drops colorsByGroup from the widget.
    fireEvent.click(screen.getByRole("button", { name: "Remove 2" }));

    expect(lastArguments(handle)).toEqual({
      metric: "count",
      groupByAttribute: "statusCode",
    });
    expect(screen.getByText("No pinned values yet.")).toBeInTheDocument();
  });

  test("a split by a span attribute keeps the Default series color control, with its description, and shows no status note", async () => {
    const handle: EditorHandle = await renderEditor({
      metric: "count",
      groupByAttribute: "url.host",
    });

    openColors();

    const label: HTMLElement = screen.getByText("Default series color");
    expect(label.nextElementSibling?.textContent).toBe(
      DEFAULT_SERIES_COLOR_DESCRIPTION,
    );
    // On Auto, since the widget has no lead color yet.
    expect(screen.getByTitle(AUTO_TITLE)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.queryByTestId("trace-chart-status-split-colors"),
    ).not.toBeInTheDocument();

    // Its pins are suggested from the attribute's own values, as before.
    await waitFor(() => {
      expect(pinSuggestions()).toEqual([
        EMPTY_GROUP_VALUE,
        "api.example.com",
        "web.example.com",
      ]);
    });
    expect(valueRequests()).toEqual(["url.host"]);
    expect(screen.getByText(GROUP_COLORS_DESCRIPTION)).toBeInTheDocument();

    // And the control still writes the lead color.
    fireEvent.click(screen.getByRole("radio", { name: "Rose" }));

    expect(lastArguments(handle)).toEqual({
      metric: "count",
      groupByAttribute: "url.host",
      color: swatchHex("Rose"),
    });
  });

  test("with no split, the one series gets a Series color control and no pins", async () => {
    await renderEditor({ metric: "count" });

    openColors();

    const label: HTMLElement = screen.getByText("Series color");
    expect(label.nextElementSibling?.textContent).toBe(
      SERIES_COLOR_DESCRIPTION,
    );
    expect(screen.queryByText("Default series color")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("trace-chart-status-split-colors"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Group colors")).not.toBeInTheDocument();
  });

  test("REGRESSION: switching the split to Status Code swaps the lead color for the note, and switching back finds the saved color", async () => {
    const handle: EditorHandle = await renderEditor({
      metric: "count",
      groupByAttribute: "url.host",
      color: "#0ea5e9",
    });

    openColors();
    expect(screen.getByText("Default series color")).toBeInTheDocument();

    await chooseSplit("Status Code");

    expect(lastArguments(handle)["groupByAttribute"]).toBe("statusCode");
    expect(
      screen.getByTestId("trace-chart-status-split-colors"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Default series color")).not.toBeInTheDocument();
    expect(pinSuggestions()).toEqual(["0", "1", "2"]);
    /*
     * The saved lead color stays in the widget: the chart ignores it under
     * this split, and it is there again for any other.
     */
    expect(lastArguments(handle)["color"]).toBe("#0ea5e9");

    await chooseSplit("url.host");

    expect(lastArguments(handle)["groupByAttribute"]).toBe("url.host");
    expect(
      screen.queryByTestId("trace-chart-status-split-colors"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Default series color")).toBeInTheDocument();
    /*
     * The lead color's picker holds the saved color: not one of the chart's
     * swatches, so it is the custom one.
     */
    const leadColor: HTMLElement = screen.getByTestId("series-color-picker");

    expect(colorOf(leadColor)).toBe("#0ea5e9");
    expect(getCustomButton(leadColor)).toHaveAttribute("data-picked", "true");
    // The attribute split offers the empty-group pin again.
    await waitFor(() => {
      expect(pinSuggestions()[0]).toBe(EMPTY_GROUP_VALUE);
    });
    expect(screen.getByText(GROUP_COLORS_DESCRIPTION)).toBeInTheDocument();
  });

  test("the Trace Table editor, which shares this one, has no Colors section to explain", async () => {
    await renderEditor({ groupByAttribute: "statusCode" }, "table");

    expect(screen.getByText("Group rows by")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Colors" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("trace-chart-status-split-colors"),
    ).not.toBeInTheDocument();
  });
});
