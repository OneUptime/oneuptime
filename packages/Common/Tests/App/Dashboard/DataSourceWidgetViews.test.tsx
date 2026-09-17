import "@testing-library/jest-dom";
import { render, RenderResult, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import ValueWidgetView, {
  ValueWidgetViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import GaugeWidgetView, {
  GaugeWidgetViewProps,
  splitFormattedDisplay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/GaugeWidgetView";

/*
 * ValueWidgetView and GaugeWidgetView are the only two presentational surfaces
 * shared by the OneUptime metric widgets (DashboardValueComponent /
 * DashboardGaugeComponent) and the new external Data Source widgets
 * (DashboardDataSourceValueComponent / DashboardDataSourceGaugeComponent).
 * Four widget types, two renderers — a regression here is a regression on
 * every board at once, and the two families silently drift apart the moment
 * one of them starts rendering a state the other does not.
 *
 * The state machine is the part worth pinning. Both views are handed a
 * `value: number | null`, and null exists precisely so an empty result cannot
 * be drawn as a confident "0": on the RUM template that made an untouched
 * dashboard read as a flawless site ("AVG LCP 0"). A test that only checked
 * "the no-data message appears" would still pass if a 0 were rendered beside
 * it, so the assertions below check for the ABSENCE of the number too.
 *
 * Everything either view needs arrives as a prop — no fetching, no context —
 * so these render straight into jsdom with nothing mocked.
 */

const VALUE_SETUP_TITLE: string = "Value";
const VALUE_SETUP_MESSAGE: string = "Click to configure this widget";
const NO_DATA_MESSAGE: string = "No data for this query";

const baseValueProps: ValueWidgetViewProps = {
  widthInPx: 400,
  heightInPx: 200,
  isEditMode: false,
  isLoading: false,
  hasEverLoaded: true,
  error: null,
  value: 42,
  points: [],
  noDataMessage: NO_DATA_MESSAGE,
  isConfigured: true,
  setupTitle: VALUE_SETUP_TITLE,
  setupMessage: VALUE_SETUP_MESSAGE,
  title: "Requests",
  rawUnit: "",
  metricName: "",
  hideUnit: false,
  warningThreshold: undefined,
  criticalThreshold: undefined,
  trendDirection: undefined,
};

const GAUGE_SETUP_TITLE: string = "Gauge";
const GAUGE_SETUP_MESSAGE: string = "Click to configure this gauge";

const baseGaugeProps: GaugeWidgetViewProps = {
  widthInPx: 400,
  heightInPx: 260,
  componentId: "gauge-a",
  isLoading: false,
  hasEverLoaded: true,
  error: null,
  value: 42,
  noDataMessage: NO_DATA_MESSAGE,
  isConfigured: true,
  setupTitle: GAUGE_SETUP_TITLE,
  setupMessage: GAUGE_SETUP_MESSAGE,
  title: "CPU",
  rawUnit: "",
  metricName: "",
  minValue: 0,
  maxValue: 100,
  warningThreshold: undefined,
  criticalThreshold: undefined,
};

type RenderValueFunction = (
  overrides: Partial<ValueWidgetViewProps>,
) => HTMLElement;

const renderValue: RenderValueFunction = (
  overrides: Partial<ValueWidgetViewProps>,
): HTMLElement => {
  const result: RenderResult = render(
    <ValueWidgetView {...baseValueProps} {...overrides} />,
  );
  return result.container;
};

type RenderGaugeFunction = (
  overrides: Partial<GaugeWidgetViewProps>,
) => HTMLElement;

const renderGauge: RenderGaugeFunction = (
  overrides: Partial<GaugeWidgetViewProps>,
): HTMLElement => {
  const result: RenderResult = render(
    <GaugeWidgetView {...baseGaugeProps} {...overrides} />,
  );
  return result.container;
};

type GetElementFunction = (container: HTMLElement) => HTMLElement | null;

/** The big-number element, or null when the view is in a non-numeric state. */
const getValueNumber: GetElementFunction = (
  container: HTMLElement,
): HTMLElement | null => {
  return container.querySelector<HTMLElement>("div.tabular-nums.truncate");
};

/** The gauge's centre number, or null when the gauge is not drawn. */
const getGaugeNumber: GetElementFunction = (
  container: HTMLElement,
): HTMLElement | null => {
  return container.querySelector<HTMLElement>("div.font-bold.tabular-nums");
};

type IsSkeletonFunction = (container: HTMLElement) => boolean;

const isSkeleton: IsSkeletonFunction = (container: HTMLElement): boolean => {
  return container.querySelector(".animate-pulse") !== null;
};

type GetTickLabelsFunction = (container: HTMLElement) => Array<string>;

/**
 * Labels on the gauge's threshold tick marks. These are SVG <title> children
 * of <line>, which getByTitle does not reach (it only looks at `svg > title`).
 */
const getTickLabels: GetTickLabelsFunction = (
  container: HTMLElement,
): Array<string> => {
  return Array.from(container.querySelectorAll("line > title")).map(
    (node: Element): string => {
      return node.textContent || "";
    },
  );
};

describe("ValueWidgetView", () => {
  describe("state machine precedence", () => {
    test("the first-load skeleton outranks every other state", () => {
      const container: HTMLElement = renderValue({
        isLoading: true,
        hasEverLoaded: false,
        error: "Query failed",
        isConfigured: false,
        value: null,
      });

      expect(isSkeleton(container)).toBe(true);
      expect(screen.queryByText("Query failed")).not.toBeInTheDocument();
      expect(screen.queryByText(VALUE_SETUP_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
    });

    test("a reload over existing data skips the skeleton and dims instead", () => {
      const container: HTMLElement = renderValue({
        isLoading: true,
        hasEverLoaded: true,
        value: 42,
      });

      expect(isSkeleton(container)).toBe(false);
      expect(getValueNumber(container)).toHaveTextContent("42");
      expect(container.firstElementChild).toHaveStyle({ opacity: "0.5" });
    });

    /*
     * The setup prompt beats a leftover error, not the other way round.
     * Clearing a widget's query is exactly how a user escapes a failing
     * query, and the fetch that would clear the error is the one the
     * missing query stops from running — so an error-first order would pin
     * the dead message on screen with no way back short of a page reload.
     */
    test("the setup prompt outranks a stale error and the no-data state", () => {
      const container: HTMLElement = renderValue({
        isLoading: true,
        hasEverLoaded: true,
        error: "Query failed",
        isConfigured: false,
        value: null,
      });

      expect(isSkeleton(container)).toBe(false);
      expect(screen.getByText(VALUE_SETUP_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText("Query failed")).not.toBeInTheDocument();
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
    });

    test("a configured widget's error outranks the no-data state", () => {
      renderValue({
        isLoading: true,
        hasEverLoaded: true,
        error: "Query failed",
        isConfigured: true,
        value: null,
      });

      expect(screen.getByText("Query failed")).toBeInTheDocument();
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
    });

    test("the setup prompt outranks the no-data state", () => {
      renderValue({ error: null, isConfigured: false, value: null });

      expect(screen.getByText(VALUE_SETUP_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
    });

    test("a configured widget with a value renders the number", () => {
      const container: HTMLElement = renderValue({ value: 42 });

      expect(getValueNumber(container)).toHaveTextContent("42");
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByText(VALUE_SETUP_MESSAGE)).not.toBeInTheDocument();
    });
  });

  describe("null value", () => {
    test("renders the title and the no-data message, never a substituted 0", () => {
      const container: HTMLElement = renderValue({
        value: null,
        title: "P95 Latency",
      });

      expect(screen.getByText("P95 Latency")).toBeInTheDocument();
      expect(screen.getByText(NO_DATA_MESSAGE)).toBeInTheDocument();
      expect(getValueNumber(container)).toBeNull();
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });

    test("stays on the no-data state through an auto-refresh", () => {
      /*
       * No `!isLoading` term in the null branch: adding one would flash the
       * removed "0" back on screen for the duration of every poll of a query
       * that is still empty.
       */
      const container: HTMLElement = renderValue({
        value: null,
        isLoading: true,
        hasEverLoaded: true,
      });

      expect(screen.getByText(NO_DATA_MESSAGE)).toBeInTheDocument();
      expect(getValueNumber(container)).toBeNull();
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });

    test("a measured zero still renders a zero", () => {
      const container: HTMLElement = renderValue({ value: 0 });

      expect(getValueNumber(container)).toHaveTextContent("0");
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
    });
  });

  describe("setup prompt", () => {
    test("falls back to setupTitle when the widget has no title of its own", () => {
      const missing: HTMLElement = renderValue({
        isConfigured: false,
        title: undefined,
      });
      expect(within(missing).getByText(VALUE_SETUP_TITLE)).toBeInTheDocument();

      const blank: HTMLElement = renderValue({
        isConfigured: false,
        title: "",
      });
      expect(within(blank).getByText(VALUE_SETUP_TITLE)).toBeInTheDocument();
    });

    test("prefers the widget's own title when it has one", () => {
      renderValue({ isConfigured: false, title: "Checkout errors" });

      expect(screen.getByText("Checkout errors")).toBeInTheDocument();
      expect(screen.queryByText(VALUE_SETUP_TITLE)).not.toBeInTheDocument();
    });

    /*
     * A title of spaces is what a user who typed one and deleted it leaves
     * behind. Treated as a real title it renders a blank line where the
     * widget should be naming itself, so the fallback has to survive it.
     */
    test("falls back to setupTitle for a whitespace-only title", () => {
      renderValue({ isConfigured: false, title: "   " });

      expect(screen.getByText(VALUE_SETUP_TITLE)).toBeInTheDocument();
      expect(screen.getByText(VALUE_SETUP_MESSAGE)).toBeInTheDocument();
    });
  });

  describe("thresholds", () => {
    const withThresholds: Partial<ValueWidgetViewProps> = {
      warningThreshold: 50,
      criticalThreshold: 80,
    };

    test("paints the number red at and above the critical threshold", () => {
      expect(
        getValueNumber(renderValue({ ...withThresholds, value: 90 })),
      ).toHaveClass("text-red-600");
      expect(
        getValueNumber(renderValue({ ...withThresholds, value: 80 })),
      ).toHaveClass("text-red-600");
    });

    test("paints the number amber at and above the warning threshold", () => {
      expect(
        getValueNumber(renderValue({ ...withThresholds, value: 60 })),
      ).toHaveClass("text-amber-600");
      expect(
        getValueNumber(renderValue({ ...withThresholds, value: 50 })),
      ).toHaveClass("text-amber-600");
    });

    test("leaves the number neutral below both thresholds", () => {
      expect(
        getValueNumber(renderValue({ ...withThresholds, value: 10 })),
      ).toHaveClass("text-gray-900");
    });

    test("stays neutral at any magnitude when no thresholds are configured", () => {
      const container: HTMLElement = renderValue({
        value: 9999,
        warningThreshold: undefined,
        criticalThreshold: undefined,
      });

      expect(getValueNumber(container)).toHaveClass("text-gray-900");
    });

    test("compares fraction metrics on the percent scale the user authored", () => {
      /*
       * OTel ratio metrics arrive as [0, 1] with unit "1" while thresholds are
       * typed in as 0-100, so 0.9 has to read as 90 — not as a value sitting
       * far below a warning threshold of 50.
       */
      const container: HTMLElement = renderValue({
        value: 0.9,
        rawUnit: "1",
        metricName: "system.cpu.utilization",
        warningThreshold: 50,
        criticalThreshold: 80,
      });

      expect(getValueNumber(container)).toHaveClass("text-red-600");
      expect(getValueNumber(container)).toHaveTextContent("90.00%");
    });
  });

  describe("units", () => {
    test("renders the unit as a suffix beside the number", () => {
      const container: HTMLElement = renderValue({
        value: 23.5,
        rawUnit: "Cel",
      });

      expect(getValueNumber(container)?.textContent).toBe("23.5 °C");
    });

    test("joins a percent unit with no separating space", () => {
      const container: HTMLElement = renderValue({ value: 42, rawUnit: "%" });

      expect(getValueNumber(container)?.textContent).toBe("42.00%");
    });

    test("hideUnit drops the suffix and keeps the number", () => {
      const container: HTMLElement = renderValue({
        value: 23.5,
        rawUnit: "Cel",
        hideUnit: true,
      });

      expect(getValueNumber(container)?.textContent).toBe("23.5");
    });
  });

  describe("extreme values", () => {
    test("abbreviates negative and very large values instead of overflowing", () => {
      expect(getValueNumber(renderValue({ value: -1234.5 }))).toHaveTextContent(
        "-1.23K",
      );
      expect(
        getValueNumber(renderValue({ value: 987654321 })),
      ).toHaveTextContent("987.65M");
    });

    test("survives NaN and Infinity, comparing each against the thresholds", () => {
      const notANumber: HTMLElement = renderValue({
        value: Number.NaN,
        warningThreshold: 50,
        criticalThreshold: 80,
      });
      // Every NaN comparison is false, so it can only fall through to neutral.
      expect(getValueNumber(notANumber)).toHaveClass("text-gray-900");

      const infinite: HTMLElement = renderValue({
        value: Number.POSITIVE_INFINITY,
        warningThreshold: 50,
        criticalThreshold: 80,
      });
      /*
       * Only the threshold classification is asserted: the digits themselves
       * come out of ValueFormatter as "NaN" and "InfinityP" — see SOURCE BUGS
       * FOUND — and pinning those strings here would cement them.
       */
      expect(getValueNumber(infinite)).toHaveClass("text-red-600");
    });

    test("renders a zero-sized tile without throwing", () => {
      const container: HTMLElement = renderValue({
        value: 42,
        widthInPx: 0,
        heightInPx: 0,
      });

      expect(getValueNumber(container)).toHaveTextContent("42");
    });
  });
});

describe("GaugeWidgetView", () => {
  describe("state machine precedence", () => {
    test("the first-load skeleton outranks every other state", () => {
      const container: HTMLElement = renderGauge({
        isLoading: true,
        hasEverLoaded: false,
        error: "Gauge query failed",
        isConfigured: false,
        value: null,
      });

      expect(isSkeleton(container)).toBe(true);
      expect(screen.queryByText("Gauge query failed")).not.toBeInTheDocument();
      expect(screen.queryByText(GAUGE_SETUP_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
    });

    // Same precedence as the Value widget — see the note there.
    test("the setup prompt outranks a stale error and the no-data state", () => {
      renderGauge({
        isLoading: true,
        hasEverLoaded: true,
        error: "Gauge query failed",
        isConfigured: false,
        value: null,
      });

      expect(screen.getByText(GAUGE_SETUP_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText("Gauge query failed")).not.toBeInTheDocument();
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
    });

    test("a configured widget's error outranks the no-data state", () => {
      renderGauge({
        isLoading: false,
        hasEverLoaded: true,
        error: "Gauge query failed",
        isConfigured: true,
        value: null,
      });

      expect(screen.getByText("Gauge query failed")).toBeInTheDocument();
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
    });

    test("the setup prompt outranks no-data and falls back to setupTitle", () => {
      renderGauge({ isConfigured: false, value: null, title: undefined });

      expect(screen.getByText(GAUGE_SETUP_TITLE)).toBeInTheDocument();
      expect(screen.getByText(GAUGE_SETUP_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
    });

    test("a settled null renders the no-data state, never a 0 / Healthy gauge", () => {
      const container: HTMLElement = renderGauge({
        value: null,
        isLoading: false,
      });

      expect(screen.getByText(NO_DATA_MESSAGE)).toBeInTheDocument();
      expect(getGaugeNumber(container)).toBeNull();
      expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    });

    test("a null mid-refresh falls through to a dimmed arc rather than flickering", () => {
      /*
       * Deliberately different from ValueWidgetView: the gauge keeps drawing
       * its arc while a refresh over an empty result is in flight, so an
       * auto-refreshing board does not blink between the arc and a message.
       */
      const container: HTMLElement = renderGauge({
        value: null,
        isLoading: true,
        hasEverLoaded: true,
      });

      expect(screen.queryByText(NO_DATA_MESSAGE)).not.toBeInTheDocument();
      expect(getGaugeNumber(container)).toHaveTextContent("0");
      expect(screen.getByText("Healthy")).toBeInTheDocument();
      expect(container.firstElementChild).toHaveStyle({ opacity: "0.5" });
    });
  });

  describe("status label", () => {
    const withThresholds: Partial<GaugeWidgetViewProps> = {
      warningThreshold: 50,
      criticalThreshold: 80,
    };

    test("reads Healthy below both thresholds and with none configured", () => {
      const below: HTMLElement = renderGauge({ ...withThresholds, value: 10 });
      expect(within(below).getByText("Healthy")).toBeInTheDocument();

      const unbounded: HTMLElement = renderGauge({
        value: 99999,
        warningThreshold: undefined,
        criticalThreshold: undefined,
      });
      expect(within(unbounded).getByText("Healthy")).toBeInTheDocument();
    });

    test("reads Warning at the warning threshold", () => {
      renderGauge({ ...withThresholds, value: 50 });

      expect(screen.getByText("Warning")).toBeInTheDocument();
      expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    });

    test("reads Critical at the critical threshold", () => {
      renderGauge({ ...withThresholds, value: 80 });

      expect(screen.getByText("Critical")).toBeInTheDocument();
      expect(screen.queryByText("Warning")).not.toBeInTheDocument();
    });

    test("scales fraction metrics onto the percent scale thresholds use", () => {
      const container: HTMLElement = renderGauge({
        value: 0.9,
        rawUnit: "1",
        metricName: "system.cpu.utilization",
        warningThreshold: 50,
        criticalThreshold: 80,
      });

      expect(screen.getByText("Critical")).toBeInTheDocument();
      expect(getGaugeNumber(container)).toHaveTextContent("90.00%");
    });
  });

  describe("arc geometry", () => {
    test("draws the value arc and dot only once the value leaves the minimum", () => {
      const atMinimum: HTMLElement = renderGauge({
        value: 0,
        minValue: 0,
        maxValue: 100,
      });
      // Only the background track — no value arc, no indicator dot.
      expect(atMinimum.querySelectorAll("path")).toHaveLength(1);
      expect(atMinimum.querySelectorAll("circle")).toHaveLength(0);

      const halfway: HTMLElement = renderGauge({
        value: 50,
        minValue: 0,
        maxValue: 100,
      });
      expect(halfway.querySelectorAll("path")).toHaveLength(2);
      expect(halfway.querySelectorAll("circle")).toHaveLength(1);
    });

    test("renders a labelled tick per configured threshold", () => {
      const container: HTMLElement = renderGauge({
        value: 30,
        warningThreshold: 50,
        criticalThreshold: 80,
      });

      expect(getTickLabels(container)).toEqual(["50", "80"]);
    });

    test("drops the ticks and the arc when min and max collapse to one point", () => {
      const container: HTMLElement = renderGauge({
        value: 30,
        minValue: 100,
        maxValue: 100,
        warningThreshold: 50,
        criticalThreshold: 80,
      });

      // A zero range has no position to put a tick at, and no arc to sweep.
      expect(getTickLabels(container)).toEqual([]);
      expect(container.querySelectorAll("path")).toHaveLength(1);
    });
  });

  describe("min/max footer", () => {
    test("formats the bounds through ValueFormatter, not as raw numbers", () => {
      renderGauge({
        value: 3600,
        rawUnit: "seconds",
        minValue: 0,
        maxValue: 7200,
      });

      expect(screen.getByText("0 sec")).toBeInTheDocument();
      expect(screen.getByText("2 hours")).toBeInTheDocument();
    });

    test("converts fraction-metric bounds back out of the percent scale", () => {
      renderGauge({
        value: 0.25,
        rawUnit: "1",
        metricName: "system.cpu.utilization",
        minValue: 0,
        maxValue: 100,
      });

      expect(screen.getByText("0.00%")).toBeInTheDocument();
      expect(screen.getByText("100.00%")).toBeInTheDocument();
    });
  });

  describe("gradient namespacing", () => {
    test("two gauges on one board get distinct ids and reference their own", () => {
      const first: HTMLElement = renderGauge({
        componentId: "widget-one",
        value: 50,
      });
      const second: HTMLElement = renderGauge({
        componentId: "widget-two",
        value: 50,
      });

      const firstId: string | null = first
        .querySelector("linearGradient")!
        .getAttribute("id");
      const secondId: string | null = second
        .querySelector("linearGradient")!
        .getAttribute("id");

      expect(firstId).toBe("gauge-gradient-widget-one");
      expect(secondId).toBe("gauge-gradient-widget-two");
      expect(firstId).not.toBe(secondId);

      // The value arc is the second path — the first is the background track.
      expect(first.querySelectorAll("path")[1]!.getAttribute("stroke")).toBe(
        `url(#${firstId})`,
      );
      expect(second.querySelectorAll("path")[1]!.getAttribute("stroke")).toBe(
        `url(#${secondId})`,
      );
    });

    test("falls back to a default id when the component has no id yet", () => {
      const container: HTMLElement = renderGauge({ componentId: "" });

      expect(
        container.querySelector("linearGradient")!.getAttribute("id"),
      ).toBe("gauge-gradient-default");
    });
  });

  describe("title", () => {
    test("renders the title above the gauge and omits the row without one", () => {
      const titled: HTMLElement = renderGauge({ title: "Memory pressure" });
      expect(within(titled).getByText("Memory pressure")).toBeInTheDocument();

      const untitled: HTMLElement = renderGauge({ title: undefined });
      expect(untitled.querySelector(".uppercase.tracking-wider")).toBeNull();
    });
  });
});

describe("splitFormattedDisplay", () => {
  test("peels a trailing percent sign off as the unit", () => {
    expect(splitFormattedDisplay("25.00%")).toEqual({
      value: "25.00",
      unit: "%",
    });
    expect(splitFormattedDisplay("%")).toEqual({ value: "", unit: "%" });
  });

  test("splits a single-space value at its space", () => {
    expect(splitFormattedDisplay("1.5 MB")).toEqual({
      value: "1.5",
      unit: "MB",
    });
    expect(splitFormattedDisplay("6.91 hours")).toEqual({
      value: "6.91",
      unit: "hours",
    });
  });

  test("leaves a bare number with an empty unit", () => {
    expect(splitFormattedDisplay("42")).toEqual({ value: "42", unit: "" });
  });

  test("handles an empty string without throwing", () => {
    expect(splitFormattedDisplay("")).toEqual({ value: "", unit: "" });
  });

  test("splits a multi-word unit at its LAST space, stranding the rest", () => {
    /*
     * The bug ValueWidgetView documents and avoids by asking ValueFormatter
     * for the two parts rather than splitting the joined string; the gauge
     * still splits. Asserted as-is so a fix has to arrive with an intentional
     * test change — see SOURCE BUGS FOUND.
     */
    expect(splitFormattedDisplay("5 requests per Second")).toEqual({
      value: "5 requests per",
      unit: "Second",
    });
  });

  test("does not split on a leading space", () => {
    expect(splitFormattedDisplay(" 42")).toEqual({ value: " 42", unit: "" });
  });
});
