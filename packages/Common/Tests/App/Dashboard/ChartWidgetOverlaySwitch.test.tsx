import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #9961: A CHART WIDGET'S ADDED QUERIES OFFER "OVERLAY WITH PREVIOUS
 * QUERY".
 *
 * A dashboard's Chart widget takes a query and any number of added ones, and
 * drew every added query as a chart of its own inside the widget: its
 * settings drew each added query with the shared MetricQueryConfig but never
 * passed canOverlayWithPreviousQuery, so the switch that puts a query on the
 * chart before it never showed. Here the real settings form (ArgumentsForm)
 * is drawn with a Chart widget, as the widget's settings dialog draws it:
 *
 *   - Query 1 has no switch: no chart comes before it;
 *   - every added query has one, in its Display Settings;
 *   - flipping it on and off writes the widget's setting, and only that
 *     query's;
 *   - a widget saved with the switch on opens with it on;
 *   - a query whose unit cannot be read on the chart it joins says so under
 *     the switch, in the reader's language;
 *   - Add Query gives a new query a letter no query or formula has.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "11111111-1111-4111-8111-111111111111";
      },
    },
  };
});

import ArgumentsForm, {
  METRIC_QUERY_ROW_HEADER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm";
import {
  METRIC_QUERY_OVERLAY_TOGGLE_TEST_ID,
  METRIC_QUERY_OVERLAY_UNIT_NOTE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import DashboardChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardChartComponent";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

const OVERLAY_SWITCH: string = "Overlay with previous query";

const UNIT_NOTE: string =
  "This query is in {{unit}} and the previous query's chart in {{chartUnit}}, so its values will not read right on that chart's axis.";

function metricType(name: string, unit: string): MetricType {
  const type: MetricType = new MetricType();
  type.name = name;
  type.unit = unit;
  return type;
}

// The metrics the issue was found with, and two in other units.
const METRIC_TYPES: Array<MetricType> = [
  metricType("mem_used", "By"),
  metricType("mem_total", "By"),
  metricType("mem_free", "By"),
  metricType("cpu_usage_percent", "%"),
  metricType("http.server.duration", "ms"),
];

function query(
  variable: string,
  metricName: string,
  extra: Partial<MetricQueryConfigData> = {},
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: metricName,
      description: undefined,
      legend: metricName,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
    ...extra,
  } as MetricQueryConfigData;
}

function formula(
  variable: string,
  expression: string,
): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricFormulaData: { metricFormula: expression },
  };
}

function chartWith(
  primary: MetricQueryConfigData,
  added: Array<MetricQueryConfigData>,
  formulas: Array<MetricFormulaConfigData> = [],
): DashboardChartComponent {
  const chart: DashboardChartComponent =
    DashboardChartComponentUtil.getDefaultComponent();

  chart.arguments = {
    ...chart.arguments,
    metricQueryConfig: primary,
    metricQueryConfigs: added,
    ...(formulas.length > 0 ? { metricFormulaConfigs: formulas } : {}),
  };

  return chart;
}

// The issue's chart: mem_used, then mem_total added.
function memoryChart(
  addedExtra: Partial<MetricQueryConfigData> = {},
): DashboardChartComponent {
  return chartWith(query("a", "mem_used"), [
    query("b", "mem_total", addedExtra),
  ]);
}

let onFormChange: MockFunction;

function drawSettings(component: DashboardChartComponent): RenderResult {
  return render(
    <ArgumentsForm
      component={component as unknown as DashboardBaseComponent}
      metrics={{ metricTypes: METRIC_TYPES, telemetryAttributes: [] }}
      onFormChange={
        onFormChange as unknown as (component: DashboardBaseComponent) => void
      }
    />,
  );
}

// Query 1's box, around its "Query 1" label.
function firstQueryCard(label: string = "Query 1"): HTMLElement {
  const card: HTMLElement | null =
    screen.getByText(label).parentElement?.parentElement || null;

  expect(card).not.toBeNull();
  return card!;
}

// Each added query's box, around its "Query 2", "Query 3" header.
function addedQueryCards(): Array<HTMLElement> {
  return screen
    .getAllByTestId(METRIC_QUERY_ROW_HEADER_TEST_ID)
    .map((header: HTMLElement): HTMLElement => {
      return header.parentElement as HTMLElement;
    });
}

function openDisplaySettings(card: HTMLElement, name: string): void {
  fireEvent.click(within(card).getByRole("button", { name: name }));
}

function overlaySwitchIn(card: HTMLElement): HTMLElement | null {
  return within(card).queryByRole("switch", { name: OVERLAY_SWITCH });
}

// The widget as the settings form last handed it on, to be saved.
function lastCommitted(): DashboardChartComponent {
  const calls: Array<Array<unknown>> = onFormChange.mock.calls;

  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as DashboardChartComponent;
}

function committedAddedQueries(): Array<MetricQueryConfigData> {
  return lastCommitted().arguments.metricQueryConfigs || [];
}

function variablesOf(component: DashboardChartComponent): Array<string> {
  return [
    component.arguments.metricQueryConfig?.metricAliasData?.metricVariable,
    ...(component.arguments.metricQueryConfigs || []).map(
      (queryConfig: MetricQueryConfigData): string | undefined => {
        return queryConfig.metricAliasData?.metricVariable;
      },
    ),
    ...(component.arguments.metricFormulaConfigs || []).map(
      (formulaConfig: MetricFormulaConfigData): string | undefined => {
        return formulaConfig.metricAliasData?.metricVariable;
      },
    ),
  ].filter((variable: string | undefined): variable is string => {
    return Boolean(variable);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      fa: { translation: readDashboardLocale("fa") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await act(async () => {
    await i18next.changeLanguage("en");
  });
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
  onFormChange = getJestMockFunction();
});

afterEach(() => {
  cleanup();
});

describe("the switch is on every added query, never on Query 1", () => {
  test("Query 2 offers Overlay with previous query in its Display Settings; Query 1 does not", () => {
    drawSettings(memoryChart());

    const first: HTMLElement = firstQueryCard();
    const [second] = addedQueryCards();

    openDisplaySettings(first, "Display Settings");
    openDisplaySettings(second!, "Display Settings");

    expect(overlaySwitchIn(first)).toBeNull();
    expect(overlaySwitchIn(second!)).toBeInTheDocument();
    // The rest of Query 1's display settings are there: only the switch is not.
    expect(
      within(first).getByRole("switch", { name: "Convert to per-second rate" }),
    ).toBeInTheDocument();
  });

  test("the switch waits in the folded Display Settings, as the rest of them do", () => {
    drawSettings(memoryChart());

    expect(
      screen.queryByRole("switch", { name: OVERLAY_SWITCH }),
    ).not.toBeInTheDocument();
  });

  test("three added queries: each of them has the switch, starting off", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "mem_total"),
        query("c", "mem_free"),
        query("d", "mem_used"),
      ]),
    );

    const cards: Array<HTMLElement> = addedQueryCards();

    expect(cards).toHaveLength(3);
    for (const card of cards) {
      openDisplaySettings(card, "Display Settings");
      const overlay: HTMLElement | null = overlaySwitchIn(card);

      expect(overlay).toBeInTheDocument();
      expect(overlay).toHaveAttribute("aria-checked", "false");
      expect(overlay).toHaveAttribute(
        "data-testid",
        METRIC_QUERY_OVERLAY_TOGGLE_TEST_ID,
      );
    }
  });

  test("a widget with no added query has no switch anywhere", () => {
    drawSettings(chartWith(query("a", "mem_used"), []));

    openDisplaySettings(firstQueryCard(), "Display Settings");

    expect(
      screen.queryByTestId(METRIC_QUERY_OVERLAY_TOGGLE_TEST_ID),
    ).toBeNull();
  });

  test("the switch says what it does", () => {
    drawSettings(memoryChart());

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(overlaySwitchIn(second!)).toHaveAccessibleDescription(
      "Draw this query on the previous query's chart instead of its own, sharing the same axes.",
    );
  });
});

describe("flipping the switch writes the widget's setting", () => {
  test("on: the added query is saved overlaid; Query 1 is untouched", () => {
    drawSettings(memoryChart());

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");
    fireEvent.click(overlaySwitchIn(second!)!);

    expect(overlaySwitchIn(second!)).toHaveAttribute("aria-checked", "true");
    expect(committedAddedQueries()[0]?.overlayWithPreviousQuery).toBe(true);
    expect(
      lastCommitted().arguments.metricQueryConfig?.overlayWithPreviousQuery,
    ).toBeUndefined();
    // The rest of the query is kept as it was.
    expect(
      committedAddedQueries()[0]?.metricQueryData.filterData.metricName,
    ).toBe("mem_total");
    expect(committedAddedQueries()[0]?.metricAliasData?.metricVariable).toBe(
      "b",
    );
  });

  test("off again: the setting is gone, as a widget saved before it had none", () => {
    drawSettings(memoryChart());

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");
    fireEvent.click(overlaySwitchIn(second!)!);
    fireEvent.click(overlaySwitchIn(second!)!);

    expect(overlaySwitchIn(second!)).toHaveAttribute("aria-checked", "false");
    expect(
      committedAddedQueries()[0]?.overlayWithPreviousQuery,
    ).toBeUndefined();
    // Saved as JSON, the way the dashboard is: no key at all.
    expect(
      Object.keys(
        JSON.parse(JSON.stringify(committedAddedQueries()[0])) as Record<
          string,
          unknown
        >,
      ),
    ).not.toContain("overlayWithPreviousQuery");
  });

  test("with three added queries, only the flipped one changes", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "mem_total"),
        query("c", "mem_free"),
        query("d", "mem_used"),
      ]),
    );

    const cards: Array<HTMLElement> = addedQueryCards();
    openDisplaySettings(cards[1]!, "Display Settings");
    fireEvent.click(overlaySwitchIn(cards[1]!)!);

    expect(
      committedAddedQueries().map(
        (queryConfig: MetricQueryConfigData): boolean | undefined => {
          return queryConfig.overlayWithPreviousQuery;
        },
      ),
    ).toEqual([undefined, true, undefined]);
  });

  test("the folded Display Settings marks that it holds a setting", () => {
    drawSettings(memoryChart({ overlayWithPreviousQuery: true }));

    const [second] = addedQueryCards();
    const fold: HTMLElement = within(second!).getByRole("button", {
      name: "Display Settings",
    });

    expect(
      fold.querySelector("span.rounded-full.bg-indigo-400"),
    ).not.toBeNull();
  });
});

describe("reopening a saved widget", () => {
  test("a widget saved with the switch on opens with it on", () => {
    const saved: DashboardChartComponent = JSON.parse(
      JSON.stringify(memoryChart({ overlayWithPreviousQuery: true })),
    ) as DashboardChartComponent;

    drawSettings(saved);

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(overlaySwitchIn(second!)).toHaveAttribute("aria-checked", "true");
  });

  test("a widget saved before the switch existed opens with it off", () => {
    const saved: DashboardChartComponent = JSON.parse(
      JSON.stringify(memoryChart()),
    ) as DashboardChartComponent;

    expect(JSON.stringify(saved)).not.toContain("overlayWithPreviousQuery");

    drawSettings(saved);

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(overlaySwitchIn(second!)).toHaveAttribute("aria-checked", "false");
    // Opening the settings writes nothing.
    expect(onFormChange).not.toHaveBeenCalled();
  });

  /*
   * The chart overlays a query only when its setting is true
   * (MetricQueryOverlay.isOverlaid), so the switch shows the same: a setting
   * a script wrote as the text "true" draws a chart of its own, and its
   * switch says off.
   */
  test("only true is on, as the chart reads it: a setting a script wrote as text is off", () => {
    drawSettings(
      memoryChart({
        overlayWithPreviousQuery: "true" as unknown as boolean,
      }),
    );

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(overlaySwitchIn(second!)).toHaveAttribute("aria-checked", "false");

    // Turned on, it is saved as the chart reads it.
    fireEvent.click(overlaySwitchIn(second!)!);

    expect(committedAddedQueries()[0]?.overlayWithPreviousQuery).toBe(true);
  });
});

describe("a unit that cannot be read on the chart it joins is said under the switch", () => {
  function noteIn(card: HTMLElement): HTMLElement | null {
    return within(card).queryByTestId(METRIC_QUERY_OVERLAY_UNIT_NOTE_TEST_ID);
  }

  test("percent on a chart in bytes: said, with both units by name", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "cpu_usage_percent", { overlayWithPreviousQuery: true }),
      ]),
    );

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(noteIn(second!)).toHaveTextContent(
      "This query is in Percent and the previous query's chart in Bytes, so its values will not read right on that chart's axis.",
    );
  });

  test("the same unit: nothing to say", () => {
    drawSettings(memoryChart({ overlayWithPreviousQuery: true }));

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(noteIn(second!)).toBeNull();
  });

  test("another unit of the same kind is converted, so nothing to say", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "mem_total", {
          overlayWithPreviousQuery: true,
          metricAliasData: {
            metricVariable: "b",
            title: "mem_total",
            description: undefined,
            legend: "mem_total",
            legendUnit: "GB",
          },
        }),
      ]),
    );

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(noteIn(second!)).toBeNull();
  });

  test("with the switch off there is nothing to say, whatever the units", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [query("b", "http.server.duration")]),
    );

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(noteIn(second!)).toBeNull();

    // Turned on, it is said at once, before anything is saved.
    fireEvent.click(overlaySwitchIn(second!)!);

    expect(noteIn(second!)).toHaveTextContent(
      "This query is in Milliseconds and the previous query's chart in Bytes",
    );
  });

  test("the unit set in Display Settings is the one read, as the chart reads it", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "mem_total", {
          overlayWithPreviousQuery: true,
          metricAliasData: {
            metricVariable: "b",
            title: "mem_total",
            description: undefined,
            legend: "mem_total",
            legendUnit: "%",
          },
        }),
      ]),
    );

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(noteIn(second!)).toHaveTextContent("This query is in Percent");
  });

  test("a third query joins the chart its chain started: Query 1's, not Query 2's", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "cpu_usage_percent", { overlayWithPreviousQuery: true }),
        query("c", "mem_total", { overlayWithPreviousQuery: true }),
      ]),
    );

    const [second, third] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");
    openDisplaySettings(third!, "Display Settings");

    // Query 2 is in percent on Query 1's bytes chart: said.
    expect(noteIn(second!)).toBeInTheDocument();
    // Query 3, in bytes, joins that same chart in bytes: nothing to say.
    expect(noteIn(third!)).toBeNull();
  });

  test("a query after one that does not overlay joins that one's chart", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "cpu_usage_percent"),
        query("c", "mem_total", { overlayWithPreviousQuery: true }),
      ]),
    );

    const [, third] = addedQueryCards();
    openDisplaySettings(third!, "Display Settings");

    expect(noteIn(third!)).toHaveTextContent(
      "This query is in Bytes and the previous query's chart in Percent",
    );
  });

  test("a metric with no unit known says nothing", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "some.custom.metric", { overlayWithPreviousQuery: true }),
      ]),
    );

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(noteIn(second!)).toBeNull();
  });

  test("in German, the sentence and the units are German", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "cpu_usage_percent", { overlayWithPreviousQuery: true }),
      ]),
    );

    const [second] = addedQueryCards();
    openDisplaySettings(
      second!,
      readDashboardLocale("de")["Display Settings"] as string,
    );

    expect(noteIn(second!)).toHaveTextContent(
      "Diese Abfrage ist in Prozent und das Diagramm der vorherigen Abfrage in Bytes, daher lassen sich ihre Werte auf der Achse dieses Diagramms nicht richtig ablesen.",
    );
    expect(
      within(second!).getByRole("switch", {
        name: readDashboardLocale("de")[OVERLAY_SWITCH] as string,
      }),
    ).toBeInTheDocument();
  });

  test("in Persian, the sentence and the units are Persian", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "cpu_usage_percent", { overlayWithPreviousQuery: true }),
      ]),
    );

    const [second] = addedQueryCards();
    openDisplaySettings(
      second!,
      readDashboardLocale("fa")["Display Settings"] as string,
    );

    const note: string = noteIn(second!)?.textContent || "";

    expect(note).toContain("درصد");
    expect(note).toContain("بایت");
    expect(note).not.toMatch(/Percent|Bytes|query/);
  });
});

describe("the sentence under the switch, in every Dashboard language", () => {
  test("is worded in every Dashboard language, with both its units", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      if (!isWordedInDashboardLocale(UNIT_NOTE, language)) {
        unworded.push(language);
        continue;
      }

      const worded: string = readDashboardLocale(language)[UNIT_NOTE] || "";

      expect({ language, unit: worded.includes("{{unit}}") }).toEqual({
        language,
        unit: true,
      });
      expect({ language, chartUnit: worded.includes("{{chartUnit}}") }).toEqual(
        { language, chartUnit: true },
      );
    }

    expect(unworded).toEqual([]);
  });
});

describe("Add Query gives a new query a letter nothing else has", () => {
  test("after a formula took b, the new query is c", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [], [formula("b", "a * 2")]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Query" }));

    expect(variablesOf(lastCommitted())).toEqual(["a", "c", "b"]);
  });

  test("after Query 2 was removed, the new query takes its letter back, not the last one's", () => {
    drawSettings(
      chartWith(query("a", "mem_used"), [
        query("b", "mem_total"),
        query("c", "mem_free"),
      ]),
    );

    const [second] = addedQueryCards();
    fireEvent.click(within(second!).getByRole("button", { name: "Remove" }));
    expect(variablesOf(lastCommitted())).toEqual(["a", "c"]);

    fireEvent.click(screen.getByRole("button", { name: "Add Query" }));

    expect(variablesOf(lastCommitted())).toEqual(["a", "c", "b"]);
  });

  test("a new query starts with its switch off", () => {
    drawSettings(chartWith(query("a", "mem_used"), []));

    fireEvent.click(screen.getByRole("button", { name: "Add Query" }));

    expect(committedAddedQueries()).toHaveLength(1);
    expect(
      committedAddedQueries()[0]?.overlayWithPreviousQuery,
    ).toBeUndefined();

    const [second] = addedQueryCards();
    openDisplaySettings(second!, "Display Settings");

    expect(overlaySwitchIn(second!)).toHaveAttribute("aria-checked", "false");
  });

  test("any run of adds and removes never repeats a letter", () => {
    const random: SeededRandom = seededRandom(9961);

    drawSettings(chartWith(query("a", "mem_used"), []));

    for (let step: number = 0; step < 30; step++) {
      const cards: Array<HTMLElement> = screen.queryAllByTestId(
        METRIC_QUERY_ROW_HEADER_TEST_ID,
      );
      const choice: number = random(4);

      if (choice === 0 && cards.length > 0) {
        const header: HTMLElement = cards[random(cards.length)]!;
        fireEvent.click(within(header).getByRole("button", { name: "Remove" }));
      } else if (choice === 1) {
        fireEvent.click(screen.getByRole("button", { name: "Add Formula" }));
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Add Query" }));
      }

      const variables: Array<string> = variablesOf(lastCommitted());

      expect({ step, variables }).toEqual({
        step,
        variables: Array.from(new Set(variables)),
      });
    }
  });
});
