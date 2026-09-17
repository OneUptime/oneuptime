import "@testing-library/jest-dom";
import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { CSSProperties, ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import renderer, {
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer";
import getJestMockFunction, { MockFunction } from "../../MockType";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  CorrelateGraphLegend,
  CorrelateGraphLegendProps,
  CorrelateResultStats,
  CorrelateResultStatsProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateResultSummary";
import { getSeverityColor } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventSeverityPill";
import {
  CorrelationGraphData,
  CorrelationGraphNode,
  CorrelationGraphSummary,
  getCorrelationGraphSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/CorrelationGraph";

/*
 * The strip of numbers above the correlation graph and the key below it.
 * Pinned here:
 *
 *  - each tile's value and hint, in its normal and warning state;
 *  - the worst-class shortcut selects exactly that class (and not while
 *    the numbers are stale);
 *  - the strip never repeats the result sentence or the cap notice, which
 *    the page promises to render exactly once;
 *  - the legend's dots use the same severity colours as the graph;
 *  - the dropped-observables note only appears when something was dropped;
 *  - every colour class is one the dark theme remaps, and every inline
 *    colour is a theme token or a deliberate accent.
 *
 * jsdom's CSS parser silently drops var() values, so assertions about theme
 * tokens read the raw style props through react-test-renderer instead.
 */

const english: i18n = createInstance();
const german: i18n = createInstance();

// The legend's one sentence, looked up as a single key.
const ZOOM_SENTENCE: string =
  "Numbers are event counts; thicker lines mean more shared events. Hold Ctrl and scroll, or pinch, to zoom.";

const GERMAN_ZOOM_SENTENCE: string =
  "Zahlen sind Ereignisanzahlen; dickere Linien bedeuten mehr gemeinsame Ereignisse. Zum Zoomen Strg gedrückt halten und scrollen oder zusammenziehen.";

beforeAll(async () => {
  await english.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });

  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: {
          Events: "Ereignisse",
          "Search limit reached": "Suchlimit erreicht",
          "critical or high": "kritisch oder hoch",
          "less frequent not shown": "seltenere nicht angezeigt",
          "Found in": "Gefunden in",
          "Graph key": "Legende",
          "Your filter": "Ihr Filter",
          "No severity": "Kein Schweregrad",
          High: "Hoch",
          Informational: "Informativ",
          "less frequent observables not drawn":
            "seltenere Observables nicht gezeichnet",
          [ZOOM_SENTENCE]: GERMAN_ZOOM_SENTENCE,
        },
      },
    },
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
});

type WrapperFunction = (props: { children?: ReactNode }) => ReactElement;

const EnglishWrapper: WrapperFunction = ({
  children,
}: {
  children?: ReactNode;
}): ReactElement => {
  return <I18nextProvider i18n={english}>{children}</I18nextProvider>;
};

const GermanWrapper: WrapperFunction = ({
  children,
}: {
  children?: ReactNode;
}): ReactElement => {
  return <I18nextProvider i18n={german}>{children}</I18nextProvider>;
};

const AUTH_CLASS: CorrelationGraphNode = {
  id: "class:Authentication",
  label: "Authentication",
  kind: "class",
  count: 7,
  worstSeverity: OcsfSeverity.Critical,
};

function makeSummary(
  overrides: Partial<CorrelationGraphSummary> = {},
): CorrelationGraphSummary {
  return {
    classCount: 3,
    highRiskClassCount: 2,
    observableCount: 12,
    droppedObservableCount: 0,
    worstClass: AUTH_CLASS,
    ...overrides,
  };
}

interface RenderedStats {
  result: RenderResult;
  onSelectNode: MockFunction;
}

function renderStats(
  overrides: Partial<CorrelateResultStatsProps> = {},
  wrapper: WrapperFunction = EnglishWrapper,
): RenderedStats {
  const onSelectNode: MockFunction = getJestMockFunction();
  const props: CorrelateResultStatsProps = {
    eventCount: 42,
    isTruncated: false,
    summary: makeSummary(),
    isStale: false,
    onSelectNode: onSelectNode,
    ...overrides,
  };

  const result: RenderResult = render(<CorrelateResultStats {...props} />, {
    wrapper: wrapper,
  });

  return { result, onSelectNode };
}

function renderLegend(
  props: CorrelateGraphLegendProps = { droppedObservableCount: 0 },
  wrapper: WrapperFunction = EnglishWrapper,
): RenderResult {
  return render(<CorrelateGraphLegend {...props} />, {
    wrapper: wrapper,
  });
}

function statsElement(
  overrides: Partial<CorrelateResultStatsProps> = {},
): ReactElement {
  return (
    <CorrelateResultStats
      eventCount={42}
      isTruncated={false}
      summary={makeSummary()}
      isStale={false}
      onSelectNode={getJestMockFunction()}
      {...overrides}
    />
  );
}

function legendElement(
  props: CorrelateGraphLegendProps = { droppedObservableCount: 0 },
): ReactElement {
  return <CorrelateGraphLegend {...props} />;
}

function hasAncestorWithTestId(
  node: ReactTestInstance,
  testId: string,
): boolean {
  let current: ReactTestInstance | null = node;

  while (current) {
    if (current.props["data-testid"] === testId) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

/*
 * The raw style prop of every host element in the tree (or only those
 * inside the element with `withinTestId`), as React was asked to render it.
 */
function collectRawStyles(
  element: ReactElement,
  options: { withinTestId?: string; skipTestId?: string } = {},
): Array<CSSProperties> {
  const testRenderer: ReactTestRenderer = renderer.create(
    <I18nextProvider i18n={english}>{element}</I18nextProvider>,
  );
  const styles: Array<CSSProperties> = testRenderer.root
    .findAll((node: ReactTestInstance): boolean => {
      return typeof node.type === "string" && Boolean(node.props["style"]);
    })
    .filter((node: ReactTestInstance): boolean => {
      if (
        options.withinTestId &&
        !hasAncestorWithTestId(node, options.withinTestId)
      ) {
        return false;
      }
      if (
        options.skipTestId &&
        hasAncestorWithTestId(node, options.skipTestId)
      ) {
        return false;
      }
      return true;
    })
    .map((node: ReactTestInstance): CSSProperties => {
      return { ...(node.props["style"] as CSSProperties) };
    });

  testRenderer.unmount();

  return styles;
}

interface TileParts {
  tile: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
  hint: HTMLElement;
}

function getTile(testId: string): TileParts {
  const tile: HTMLElement = screen.getByTestId(testId);
  const label: HTMLElement = tile.querySelector("dt") as HTMLElement;
  const definitions: Array<HTMLElement> = Array.from(
    tile.querySelectorAll("dd"),
  );

  expect(label).not.toBeNull();
  expect(definitions).toHaveLength(2);

  return {
    tile: tile,
    label: label,
    value: definitions[0] as HTMLElement,
    hint: definitions[1] as HTMLElement,
  };
}

// How the browser reports a colour once it has been applied as a style.
function normalizeColor(value: string): string {
  const probe: HTMLSpanElement = document.createElement("span");
  probe.style.backgroundColor = value;
  return probe.style.backgroundColor;
}

function getSwatch(item: HTMLElement): HTMLElement {
  const swatch: HTMLElement | null = item.querySelector(
    ':scope > span[aria-hidden="true"]',
  );
  expect(swatch).not.toBeNull();
  return swatch as HTMLElement;
}

const TILE_IDS: Array<string> = [
  "correlate-stat-events",
  "correlate-stat-classes",
  "correlate-stat-observables",
  "correlate-stat-severity",
];

const WARN_SURFACE: Array<string> = ["border-amber-200", "bg-amber-50"];
const NEUTRAL_SURFACE: Array<string> = ["border-gray-200", "bg-gray-50"];

describe("CorrelateResultStats", () => {
  describe("layout", () => {
    test("is a description list of four tiles in reading order", () => {
      renderStats();

      const strip: HTMLElement = screen.getByTestId("correlate-stats");

      expect(strip.tagName).toBe("DL");
      expect(strip).toHaveClass(
        "grid",
        "grid-cols-2",
        "xl:grid-cols-4",
        "border-b",
        "border-gray-200",
      );
      expect(
        Array.from(strip.children).map((child: Element): string | null => {
          return child.getAttribute("data-testid");
        }),
      ).toEqual(TILE_IDS);
    });

    test("labels each tile with a term", () => {
      renderStats();

      expect(
        TILE_IDS.map((testId: string): string => {
          return getTile(testId).label.textContent || "";
        }),
      ).toEqual([
        "Events",
        "Event classes",
        "Co-occurring observables",
        "Highest severity",
      ]);
    });

    test("gives every tile its own decorative icon", () => {
      renderStats();

      const markups: Array<string> = TILE_IDS.map((testId: string): string => {
        const label: HTMLElement = getTile(testId).label;
        const svg: SVGElement | null = label.querySelector("svg");

        expect(svg).not.toBeNull();
        expect(svg).toHaveClass("h-4", "w-4", "text-indigo-500");
        /*
         * The term already names the tile. Icon hides its own svg, so look
         * above Icon's wrapper for the tile's own aria-hidden.
         */
        expect(
          svg!.parentElement!.parentElement!.closest('[aria-hidden="true"]'),
        ).not.toBeNull();
        expect(within(label).queryByRole("img")).toBeNull();

        return svg!.innerHTML;
      });

      expect(new Set(markups).size).toBe(TILE_IDS.length);
    });

    test("sets values large and hints small", () => {
      renderStats();

      for (const testId of TILE_IDS) {
        const parts: TileParts = getTile(testId);

        expect(parts.value).toHaveClass(
          "text-2xl",
          "font-semibold",
          "tabular-nums",
          "text-gray-900",
        );
        expect(parts.hint).toHaveClass("text-xs", "min-w-0");
      }
    });

    /*
     * Only at xl do the four tiles share one row. Between md and xl the
     * page is narrow enough (the selection panel stacks under the canvas
     * there) that four columns would squeeze every hint onto many lines.
     */
    test("keeps two columns until xl, not lg", () => {
      renderStats();

      const strip: HTMLElement = screen.getByTestId("correlate-stats");

      expect(strip).toHaveClass("grid-cols-2", "xl:grid-cols-4");
      expect(strip).not.toHaveClass("lg:grid-cols-4");
      expect(strip).not.toHaveClass("md:grid-cols-4");
      expect(strip).not.toHaveClass("grid-cols-4");
    });

    /*
     * A number and the severity pill have different heights; a fixed
     * minimum row, centred, keeps the four values on one baseline so the
     * hints below them line up across the strip.
     */
    test("gives every value row the same centred minimum height", () => {
      const cases: Array<Partial<CorrelateResultStatsProps>> = [
        {},
        { summary: makeSummary({ worstClass: undefined }) },
        { isTruncated: true, eventCount: 200 },
      ];

      for (const overrides of cases) {
        renderStats(overrides);

        for (const testId of TILE_IDS) {
          expect(getTile(testId).value).toHaveClass(
            "flex",
            "min-h-[2rem]",
            "items-center",
          );
        }

        cleanup();
      }
    });

    test("centres the severity pill and the dash in the value row", () => {
      renderStats();

      const pillValue: HTMLElement = getTile("correlate-stat-severity").value;

      expect(pillValue).toHaveClass("flex", "items-center", "min-h-[2rem]");
      expect(within(pillValue).getByTestId("pill")).toBeInTheDocument();

      cleanup();
      renderStats({ summary: makeSummary({ worstClass: undefined }) });

      const dashValue: HTMLElement = getTile("correlate-stat-severity").value;

      expect(dashValue).toHaveClass("flex", "items-center", "min-h-[2rem]");
      expect(within(dashValue).getByText("—")).toHaveClass("text-base");
    });

    test("lets a long tile label wrap beside its icon", () => {
      renderStats();

      for (const testId of TILE_IDS) {
        const label: HTMLElement = getTile(testId).label;
        const text: HTMLElement = label.firstElementChild as HTMLElement;

        expect(label).toHaveClass("flex", "items-start", "justify-between");
        expect(text.tagName).toBe("SPAN");
        expect(text).toHaveClass("min-w-0", "break-words");
        expect(text).not.toHaveClass("truncate");
        expect(label.lastElementChild).toHaveClass("shrink-0");
      }
    });
  });

  /*
   * Hints wrap instead of clipping: a translated hint ("Suchlimit erreicht",
   * "3 seltenere nicht angezeigt") must stay readable in a half-width tile.
   * Only the worst-class button truncates, and it keeps the full name as
   * its title.
   */
  describe("hint wrapping", () => {
    const HINT_CASES: Array<{
      name: string;
      testId: string;
      props: Partial<CorrelateResultStatsProps>;
      text: string;
    }> = [
      {
        name: "the window hint",
        testId: "correlate-stat-events",
        props: {},
        text: "In the selected window",
      },
      {
        name: "the search limit warning",
        testId: "correlate-stat-events",
        props: { isTruncated: true, eventCount: 200 },
        text: "Search limit reached",
      },
      {
        name: "the risk count",
        testId: "correlate-stat-classes",
        props: {},
        text: "2 critical or high",
      },
      {
        name: "the all-shown note",
        testId: "correlate-stat-observables",
        props: {},
        text: "All shown",
      },
      {
        name: "the dropped-observables warning",
        testId: "correlate-stat-observables",
        props: { summary: makeSummary({ droppedObservableCount: 6 }) },
        text: "6 less frequent not shown",
      },
      {
        name: "the no-severity note",
        testId: "correlate-stat-severity",
        props: { summary: makeSummary({ worstClass: undefined }) },
        text: "No severity recorded",
      },
    ];

    test.each(HINT_CASES)(
      "wraps $name rather than truncating it",
      ({
        testId,
        props,
        text,
      }: {
        testId: string;
        props: Partial<CorrelateResultStatsProps>;
        text: string;
      }) => {
        renderStats(props);

        const hint: HTMLElement = getTile(testId).hint;
        const span: HTMLElement = hint.firstElementChild as HTMLElement;

        expect(hint.children).toHaveLength(1);
        expect(span.tagName).toBe("SPAN");
        expect(span).toHaveTextContent(new RegExp(`^${text}$`));
        expect(span).toHaveClass("min-w-0", "break-words");
        expect(span).not.toHaveClass("truncate");
        expect(hint).toHaveClass("flex", "min-w-0");
        expect(hint).not.toHaveClass("truncate");
      },
    );

    test("no tile element truncates except the worst-class button", () => {
      const cases: Array<{
        props: Partial<CorrelateResultStatsProps>;
        truncated: Array<string>;
      }> = [
        { props: {}, truncated: ["correlate-stat-worst-class"] },
        {
          props: {
            isTruncated: true,
            eventCount: 200,
            summary: makeSummary({ droppedObservableCount: 3 }),
          },
          truncated: ["correlate-stat-worst-class"],
        },
        {
          props: { summary: makeSummary({ worstClass: undefined }) },
          truncated: [],
        },
      ];

      for (const testCase of cases) {
        renderStats(testCase.props);

        const truncated: Array<Element> = Array.from(
          screen.getByTestId("correlate-stats").querySelectorAll(".truncate"),
        );

        expect(
          truncated.map((element: Element): string | null => {
            return element.getAttribute("data-testid");
          }),
        ).toEqual(testCase.truncated);

        cleanup();
      }
    });

    test("keeps a long worst-class name whole in its title", () => {
      const longName: string =
        "Authentication With A Very Long Vendor Specific Class Name";

      renderStats({
        summary: makeSummary({
          worstClass: { ...AUTH_CLASS, label: longName },
        }),
      });

      const button: HTMLElement = screen.getByTestId(
        "correlate-stat-worst-class",
      );

      expect(button).toHaveClass("min-w-0", "truncate");
      expect(button).toHaveAttribute("title", longName);
      expect(button.textContent).toBe(longName);
    });
  });

  describe("Events tile", () => {
    test("shows the event count and the window hint", () => {
      renderStats({ eventCount: 42, isTruncated: false });

      const parts: TileParts = getTile("correlate-stat-events");

      expect(parts.value).toHaveTextContent(/^42$/);
      expect(parts.hint).toHaveTextContent(/^In the selected window$/);
      expect(parts.tile).toHaveClass(...NEUTRAL_SURFACE);
      expect(parts.tile).not.toHaveClass(...WARN_SURFACE);
      expect(parts.hint).toHaveClass("text-gray-500");
      expect(parts.hint).not.toHaveClass("text-amber-700");
    });

    test("shows zero rather than an empty value", () => {
      renderStats({ eventCount: 0 });

      expect(getTile("correlate-stat-events").value).toHaveTextContent(/^0$/);
    });

    test("marks a capped count and warns that the search limit was hit", () => {
      renderStats({ eventCount: 200, isTruncated: true });

      const parts: TileParts = getTile("correlate-stat-events");

      expect(parts.value).toHaveTextContent(/^200\+$/);
      expect(parts.hint).toHaveTextContent(/^Search limit reached$/);
      expect(parts.tile).toHaveClass(...WARN_SURFACE);
      expect(parts.tile).not.toHaveClass("bg-gray-50");
      expect(parts.hint).toHaveClass("text-amber-700");
      expect(screen.queryByText("In the selected window")).toBeNull();
    });

    test("keeps the value a single text node so '200+' reads as one", () => {
      renderStats({ eventCount: 200, isTruncated: true });

      const value: HTMLElement = getTile("correlate-stat-events").value;

      expect(value.childNodes).toHaveLength(1);
      expect(value.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    });
  });

  describe("Event classes tile", () => {
    test("shows the class count and how many are critical or high", () => {
      renderStats({
        summary: makeSummary({ classCount: 5, highRiskClassCount: 2 }),
      });

      const parts: TileParts = getTile("correlate-stat-classes");

      expect(parts.value).toHaveTextContent(/^5$/);
      expect(parts.hint).toHaveTextContent(/^2 critical or high$/);
      expect(parts.tile).toHaveClass(...NEUTRAL_SURFACE);
    });

    test("says zero rather than hiding the risk hint", () => {
      renderStats({
        summary: makeSummary({ classCount: 1, highRiskClassCount: 0 }),
      });

      expect(getTile("correlate-stat-classes").hint).toHaveTextContent(
        /^0 critical or high$/,
      );
    });

    test("never turns into a warning, even when every class is high risk", () => {
      renderStats({
        summary: makeSummary({ classCount: 4, highRiskClassCount: 4 }),
      });

      const parts: TileParts = getTile("correlate-stat-classes");

      expect(parts.tile).not.toHaveClass(...WARN_SURFACE);
      expect(parts.hint).toHaveClass("text-gray-500");
    });
  });

  describe("Co-occurring observables tile", () => {
    test("says all are shown when nothing was dropped", () => {
      renderStats({
        summary: makeSummary({
          observableCount: 12,
          droppedObservableCount: 0,
        }),
      });

      const parts: TileParts = getTile("correlate-stat-observables");

      expect(parts.value).toHaveTextContent(/^12$/);
      expect(parts.hint).toHaveTextContent(/^All shown$/);
      expect(parts.tile).toHaveClass(...NEUTRAL_SURFACE);
      expect(parts.hint).not.toHaveClass("text-amber-700");
    });

    test("warns how many less frequent observables were left out", () => {
      renderStats({
        summary: makeSummary({
          observableCount: 30,
          droppedObservableCount: 4,
        }),
      });

      const parts: TileParts = getTile("correlate-stat-observables");

      expect(parts.value).toHaveTextContent(/^30$/);
      expect(parts.hint).toHaveTextContent(/^4 less frequent not shown$/);
      expect(parts.tile).toHaveClass(...WARN_SURFACE);
      expect(parts.hint).toHaveClass("text-amber-700");
      expect(screen.queryByText("All shown")).toBeNull();
    });

    test("warns independently of the events tile", () => {
      renderStats({
        isTruncated: false,
        summary: makeSummary({ droppedObservableCount: 1 }),
      });

      expect(getTile("correlate-stat-events").tile).not.toHaveClass(
        ...WARN_SURFACE,
      );
      expect(getTile("correlate-stat-observables").tile).toHaveClass(
        ...WARN_SURFACE,
      );
    });
  });

  describe("Highest severity tile", () => {
    test("shows the worst class's severity as a pill in its colour", () => {
      renderStats();

      const value: HTMLElement = getTile("correlate-stat-severity").value;
      const pill: HTMLElement = within(value).getByTestId("pill");

      expect(pill).toHaveTextContent(/^Critical$/);
      expect(window.getComputedStyle(pill).backgroundColor).toBe(
        normalizeColor(getSeverityColor(OcsfSeverity.Critical).toString()),
      );
    });

    test("names the worst class as a button that selects it", () => {
      const { onSelectNode } = renderStats();

      const hint: HTMLElement = getTile("correlate-stat-severity").hint;
      const button: HTMLElement = within(hint).getByTestId(
        "correlate-stat-worst-class",
      );

      // A real space, so the read-out doesn't run the words together.
      expect(hint.textContent).toBe("Found in Authentication");
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveTextContent(/^Authentication$/);
      expect(button).toHaveAttribute("title", "Authentication");
      expect(button).toBeEnabled();
      expect(within(hint).getByRole("button", { name: "Authentication" })).toBe(
        button,
      );

      fireEvent.click(button);

      expect(onSelectNode).toHaveBeenCalledTimes(1);
      expect(onSelectNode).toHaveBeenCalledWith("class:Authentication");
    });

    test("selects whichever class the summary picked", () => {
      const worstClass: CorrelationGraphNode = {
        id: "class:Network Activity",
        label: "Network Activity",
        kind: "class",
        count: 2,
        worstSeverity: OcsfSeverity.Medium,
      };
      const { onSelectNode } = renderStats({
        summary: makeSummary({ worstClass: worstClass }),
      });

      const value: HTMLElement = getTile("correlate-stat-severity").value;

      expect(within(value).getByTestId("pill")).toHaveTextContent(/^Medium$/);
      expect(
        window.getComputedStyle(within(value).getByTestId("pill"))
          .backgroundColor,
      ).toBe(normalizeColor(getSeverityColor(OcsfSeverity.Medium).toString()));

      fireEvent.click(screen.getByTestId("correlate-stat-worst-class"));

      expect(onSelectNode).toHaveBeenCalledWith("class:Network Activity");
    });

    test("lets a long class name truncate without losing its focus ring", () => {
      renderStats();

      const hint: HTMLElement = getTile("correlate-stat-severity").hint;
      const button: HTMLElement = screen.getByTestId(
        "correlate-stat-worst-class",
      );

      expect(hint).toHaveClass("flex");
      expect(hint).not.toHaveClass("truncate");
      expect(button).toHaveClass("min-w-0", "truncate", "focus-visible:ring-2");
      expect(within(hint).getByText("Found in")).toHaveClass("shrink-0");
    });

    test("shows a dash and says no severity was recorded without a worst class", () => {
      const { onSelectNode } = renderStats({
        summary: makeSummary({ worstClass: undefined }),
      });

      const parts: TileParts = getTile("correlate-stat-severity");

      expect(parts.value).toHaveTextContent(/^—$/);
      expect(within(parts.value).queryByTestId("pill")).toBeNull();
      expect(parts.hint).toHaveTextContent(/^No severity recorded$/);
      expect(screen.queryByTestId("correlate-stat-worst-class")).toBeNull();
      expect(screen.queryByText("Found in")).toBeNull();
      expect(within(parts.tile).queryByRole("button")).toBeNull();
      expect(onSelectNode).not.toHaveBeenCalled();
    });

    test("never turns into a warning", () => {
      renderStats();

      expect(getTile("correlate-stat-severity").tile).toHaveClass(
        ...NEUTRAL_SURFACE,
      );
    });
  });

  describe("stale results", () => {
    test("dims the whole strip while results are refreshing", () => {
      renderStats({ isStale: true });

      expect(screen.getByTestId("correlate-stats")).toHaveClass("opacity-60");
    });

    test("is not dimmed for current results", () => {
      renderStats({ isStale: false });

      expect(screen.getByTestId("correlate-stats")).not.toHaveClass(
        "opacity-60",
      );
    });

    test("does not select a class from numbers that are about to change", () => {
      const { onSelectNode } = renderStats({ isStale: true });

      const button: HTMLElement = screen.getByTestId(
        "correlate-stat-worst-class",
      );

      expect(button).toBeDisabled();

      fireEvent.click(button);

      expect(onSelectNode).not.toHaveBeenCalled();
    });

    test("keeps the numbers readable while dimmed", () => {
      renderStats({ isStale: true, eventCount: 9 });

      expect(getTile("correlate-stat-events").value).toHaveTextContent(/^9$/);
    });
  });

  describe("text the page renders only once", () => {
    const CASES: Array<{
      name: string;
      props: Partial<CorrelateResultStatsProps>;
    }> = [
      { name: "a plain result", props: {} },
      { name: "a single event", props: { eventCount: 1 } },
      {
        name: "a capped result",
        props: { eventCount: 200, isTruncated: true },
      },
      {
        name: "dropped observables",
        props: { summary: makeSummary({ droppedObservableCount: 7 }) },
      },
      {
        name: "no severity",
        props: { summary: makeSummary({ worstClass: undefined }) },
      },
      {
        name: "stale, capped and dropped",
        props: {
          isStale: true,
          isTruncated: true,
          eventCount: 200,
          summary: makeSummary({ droppedObservableCount: 2 }),
        },
      },
    ];

    test.each(CASES)(
      "never says 'matching event' or 'lower bounds' for $name",
      ({ props }: { props: Partial<CorrelateResultStatsProps> }) => {
        renderStats(props);

        const text: string =
          screen.getByTestId("correlate-stats").textContent || "";

        expect(text).not.toMatch(/matching event/i);
        expect(text).not.toMatch(/lower bounds?/i);
      },
    );
  });

  test("renders the numbers the summary helper computes from a graph", () => {
    const data: CorrelationGraphData = {
      nodes: [
        { id: "center", label: "alice", kind: "center" },
        {
          id: "class:Authentication",
          label: "Authentication",
          kind: "class",
          count: 4,
          worstSeverity: OcsfSeverity.High,
        },
        {
          id: "class:File Activity",
          label: "File Activity",
          kind: "class",
          count: 9,
          worstSeverity: OcsfSeverity.Fatal,
        },
        {
          id: "class:Unclassified",
          label: "Unclassified",
          kind: "class",
          count: 1,
        },
        {
          id: "observable:10.0.0.1",
          label: "10.0.0.1",
          kind: "observable",
          count: 3,
        },
        {
          id: "observable:web-01",
          label: "web-01",
          kind: "observable",
          count: 2,
        },
      ],
      edges: [],
      droppedCoObservableCount: 5,
    };

    const { onSelectNode } = renderStats({
      eventCount: 14,
      summary: getCorrelationGraphSummary(data),
    });

    expect(getTile("correlate-stat-classes").value).toHaveTextContent(/^3$/);
    expect(getTile("correlate-stat-classes").hint).toHaveTextContent(
      /^2 critical or high$/,
    );
    expect(getTile("correlate-stat-observables").value).toHaveTextContent(
      /^2$/,
    );
    expect(getTile("correlate-stat-observables").hint).toHaveTextContent(
      /^5 less frequent not shown$/,
    );
    expect(
      within(getTile("correlate-stat-severity").value).getByTestId("pill"),
    ).toHaveTextContent(/^Fatal$/);

    fireEvent.click(screen.getByTestId("correlate-stat-worst-class"));

    expect(onSelectNode).toHaveBeenCalledWith("class:File Activity");
  });

  test("translates its labels and hints", () => {
    renderStats(
      {
        eventCount: 200,
        isTruncated: true,
        summary: makeSummary({
          highRiskClassCount: 1,
          droppedObservableCount: 3,
        }),
      },
      GermanWrapper,
    );

    expect(getTile("correlate-stat-events").label).toHaveTextContent(
      /^Ereignisse$/,
    );
    expect(getTile("correlate-stat-events").hint).toHaveTextContent(
      /^Suchlimit erreicht$/,
    );
    expect(getTile("correlate-stat-classes").hint).toHaveTextContent(
      /^1 kritisch oder hoch$/,
    );
    expect(getTile("correlate-stat-observables").hint).toHaveTextContent(
      /^3 seltenere nicht angezeigt$/,
    );
    expect(getTile("correlate-stat-severity").hint).toHaveTextContent(
      /^Gefunden in Authentication$/,
    );
    // Untranslated strings fall back to the English source.
    expect(getTile("correlate-stat-classes").label).toHaveTextContent(
      /^Event classes$/,
    );
  });
});

const LEGEND_SEVERITIES: Array<{ testId: string; severity: OcsfSeverity }> = [
  {
    testId: "correlate-legend-severity-critical",
    severity: OcsfSeverity.Critical,
  },
  { testId: "correlate-legend-severity-high", severity: OcsfSeverity.High },
  { testId: "correlate-legend-severity-medium", severity: OcsfSeverity.Medium },
  { testId: "correlate-legend-severity-low", severity: OcsfSeverity.Low },
  {
    testId: "correlate-legend-severity-informational",
    severity: OcsfSeverity.Informational,
  },
];

describe("CorrelateGraphLegend", () => {
  test("sits under the graph as a bordered footer", () => {
    renderLegend();

    const legend: HTMLElement = screen.getByTestId("correlate-legend");

    expect(legend).toHaveClass("border-t", "border-gray-200", "text-xs");
  });

  test("lists the key as a labelled list", () => {
    renderLegend();

    const list: HTMLElement = screen.getByRole("list", { name: "Graph key" });

    expect(list.tagName).toBe("UL");
    // Explicit, because Safari drops list semantics from unstyled lists.
    expect(list).toHaveAttribute("role", "list");
    expect(list).toHaveAttribute("aria-label", "Graph key");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string | null => {
          return item.getAttribute("data-testid");
        }),
    ).toEqual([
      "correlate-legend-filter",
      "correlate-legend-class",
      "correlate-legend-observable",
      "correlate-legend-severity",
    ]);
  });

  test("names each kind of node beside a decorative swatch", () => {
    renderLegend();

    const expectations: Array<[string, string]> = [
      ["correlate-legend-filter", "Your filter"],
      ["correlate-legend-class", "Event class"],
      ["correlate-legend-observable", "Co-occurring observable"],
    ];

    for (const [testId, label] of expectations) {
      const item: HTMLElement = screen.getByTestId(testId);

      expect(item).toHaveTextContent(new RegExp(`^${label}$`));
      expect(getSwatch(item)).toHaveClass("h-3", "w-5", "shrink-0");
    }
  });

  test("draws the filter swatch in the centre card's indigo", () => {
    renderLegend();

    const swatch: HTMLElement = getSwatch(
      screen.getByTestId("correlate-legend-filter"),
    );

    expect(window.getComputedStyle(swatch).backgroundColor).toBe(
      normalizeColor("#4f46e5"),
    );
  });

  test("draws the class swatch as a card with a neutral accent bar", () => {
    renderLegend();

    const swatch: HTMLElement = getSwatch(
      screen.getByTestId("correlate-legend-class"),
    );
    const bar: HTMLElement = swatch.firstElementChild as HTMLElement;

    expect(swatch).toHaveClass(
      "rounded-sm",
      "border",
      "border-gray-300",
      "bg-white",
      "overflow-hidden",
    );
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("3px");
    expect(
      collectRawStyles(legendElement(), {
        withinTestId: "correlate-legend-class",
      }),
    ).toEqual([
      { width: 3, backgroundColor: "var(--ou-chart-series-neutral, #64748b)" },
    ]);
  });

  test("draws the observable swatch as a pill", () => {
    renderLegend();

    expect(
      getSwatch(screen.getByTestId("correlate-legend-observable")),
    ).toHaveClass("rounded-full", "border", "border-gray-300", "bg-white");
  });

  test("introduces the severity dots", () => {
    renderLegend();

    const group: HTMLElement = screen.getByTestId("correlate-legend-severity");
    const intro: HTMLElement = within(group).getByText("Worst severity:");

    expect(intro).toHaveClass("text-gray-500");
    expect(group.firstElementChild).toBe(intro);
  });

  test("lists the severities worst first, then 'No severity'", () => {
    renderLegend();

    const group: HTMLElement = screen.getByTestId("correlate-legend-severity");

    expect(
      Array.from(
        group.querySelectorAll('[data-testid^="correlate-legend-severity-"]'),
      ).map((element: Element): string => {
        return element.textContent || "";
      }),
    ).toEqual([
      "Critical",
      "High",
      "Medium",
      "Low",
      "Informational",
      "No severity",
    ]);
  });

  test("keeps the dots in the legend's own order with 'No severity' last", () => {
    renderLegend();

    const group: HTMLElement = screen.getByTestId("correlate-legend-severity");

    expect(
      Array.from(group.children)
        .slice(1)
        .map((element: Element): string | null => {
          return element.getAttribute("data-testid");
        }),
    ).toEqual([
      ...LEGEND_SEVERITIES.map(({ testId }: { testId: string }): string => {
        return testId;
      }),
      "correlate-legend-severity-none",
    ]);
  });

  /*
   * Fatal is drawn in Critical's colour, and Unknown/Other in the same grey
   * as Informational, so none of them gets a dot of its own.
   */
  test("draws no dot for the severities that share another's colour", () => {
    renderLegend();

    for (const severity of [
      OcsfSeverity.Fatal,
      OcsfSeverity.Unknown,
      OcsfSeverity.Other,
    ]) {
      expect(
        screen.queryByTestId(
          `correlate-legend-severity-${severity.toLowerCase()}`,
        ),
      ).toBeNull();
      expect(
        within(screen.getByTestId("correlate-legend-severity")).queryByText(
          severity,
        ),
      ).toBeNull();
    }

    expect(getSeverityColor(OcsfSeverity.Fatal).toString()).toBe(
      getSeverityColor(OcsfSeverity.Critical).toString(),
    );
    expect(getSeverityColor(OcsfSeverity.Unknown).toString()).toBe(
      getSeverityColor(OcsfSeverity.Informational).toString(),
    );
  });

  test("draws the Informational dot in the severity grey the pills use", () => {
    renderLegend();

    const item: HTMLElement = screen.getByTestId(
      "correlate-legend-severity-informational",
    );
    const dot: HTMLElement = getSwatch(item);

    expect(item).toHaveTextContent(/^Informational$/);
    expect(item).toHaveClass("inline-flex", "items-center");
    expect(dot).toHaveClass("h-2", "w-2", "shrink-0", "rounded-full");
    expect(window.getComputedStyle(dot).backgroundColor).toBe(
      normalizeColor(getSeverityColor(OcsfSeverity.Informational).toString()),
    );
    // The raw style is the literal severity colour, not a theme token.
    expect(
      collectRawStyles(legendElement(), {
        withinTestId: "correlate-legend-severity-informational",
      }),
    ).toEqual([
      {
        backgroundColor: getSeverityColor(
          OcsfSeverity.Informational,
        ).toString(),
      },
    ]);
  });

  /*
   * In the light theme the two greys are close, but the unrated dot follows
   * the neutral chart token (which the dark theme changes) while
   * Informational keeps the pill's grey — so they are separate entries.
   */
  test("keeps Informational apart from the unrated 'No severity' dot", () => {
    const informational: Array<CSSProperties> = collectRawStyles(
      legendElement(),
      { withinTestId: "correlate-legend-severity-informational" },
    );
    const none: Array<CSSProperties> = collectRawStyles(legendElement(), {
      withinTestId: "correlate-legend-severity-none",
    });

    expect(informational).toHaveLength(1);
    expect(none).toHaveLength(1);
    expect(informational[0]!.backgroundColor).not.toBe(
      none[0]!.backgroundColor,
    );
    expect(String(none[0]!.backgroundColor)).toMatch(/^var\(--ou-/);
    expect(String(informational[0]!.backgroundColor)).not.toMatch(/^var\(/);
  });

  test.each(LEGEND_SEVERITIES)(
    "colours the $severity dot like the graph does",
    ({ testId, severity }: { testId: string; severity: OcsfSeverity }) => {
      renderLegend();

      const item: HTMLElement = screen.getByTestId(testId);
      const dot: HTMLElement = getSwatch(item);

      expect(item).toHaveTextContent(new RegExp(`^${severity}$`));
      expect(dot).toHaveClass("h-2", "w-2", "rounded-full");
      expect(window.getComputedStyle(dot).backgroundColor).toBe(
        normalizeColor(getSeverityColor(severity).toString()),
      );
    },
  );

  test("gives each severity a distinguishable colour", () => {
    renderLegend();

    const colours: Array<string> = LEGEND_SEVERITIES.map(
      ({ testId }: { testId: string }): string => {
        return window.getComputedStyle(getSwatch(screen.getByTestId(testId)))
          .backgroundColor;
      },
    );

    expect(new Set(colours).size).toBe(LEGEND_SEVERITIES.length);
  });

  test("colours the 'No severity' dot like an unrated class card", () => {
    renderLegend();

    const item: HTMLElement = screen.getByTestId(
      "correlate-legend-severity-none",
    );
    const dot: HTMLElement = getSwatch(item);

    expect(item).toHaveTextContent(/^No severity$/);
    expect(dot).toHaveClass("h-2", "w-2", "rounded-full");
    expect(
      collectRawStyles(legendElement(), {
        withinTestId: "correlate-legend-severity-none",
      }),
    ).toEqual([{ backgroundColor: "var(--ou-chart-series-neutral, #64748b)" }]);
  });

  test("explains what the numbers and lines mean and how to zoom", () => {
    renderLegend();

    const sentence: HTMLElement = screen.getByText(ZOOM_SENTENCE);

    expect(sentence.tagName).toBe("P");
    expect(sentence).toHaveClass("text-gray-500");
    expect(sentence.textContent).toBe(ZOOM_SENTENCE);
    expect(screen.getByRole("list", { name: "Graph key" }).parentElement).toBe(
      sentence.parentElement,
    );
  });

  /*
   * React Flow zooms on Ctrl + wheel and on a pinch; there is no ⌘ + wheel
   * gesture, so the key must not promise one.
   */
  test("no longer mentions the ⌘ key or the old zoom wording", () => {
    renderLegend();

    const legend: HTMLElement = screen.getByTestId("correlate-legend");

    expect(legend.textContent).not.toContain("⌘");
    expect(legend.textContent).not.toContain("Hold Ctrl or");
    expect(legend.textContent).toContain(
      "Hold Ctrl and scroll, or pinch, to zoom.",
    );
    expect(screen.getAllByText(ZOOM_SENTENCE)).toHaveLength(1);
  });

  test("translates the zoom sentence as one key", () => {
    renderLegend({ droppedObservableCount: 0 }, GermanWrapper);

    const sentence: HTMLElement = screen.getByText(GERMAN_ZOOM_SENTENCE);

    expect(sentence.tagName).toBe("P");
    expect(sentence.textContent).toBe(GERMAN_ZOOM_SENTENCE);
    expect(screen.queryByText(ZOOM_SENTENCE)).toBeNull();
  });

  test("shows no dropped note when every observable is drawn", () => {
    renderLegend({ droppedObservableCount: 0 });

    expect(screen.queryByTestId("correlate-dropped-observables")).toBeNull();
    expect(
      within(screen.getByTestId("correlate-legend")).queryByRole("status"),
    ).toBeNull();
    expect(screen.queryByText(/less frequent/)).toBeNull();
  });

  test("announces how many observables were left off the graph", () => {
    renderLegend({ droppedObservableCount: 3 });

    const note: HTMLElement = screen.getByTestId(
      "correlate-dropped-observables",
    );

    expect(note.tagName).toBe("P");
    expect(note).toHaveAttribute("role", "status");
    expect(
      within(screen.getByTestId("correlate-legend")).getByRole("status"),
    ).toBe(note);
    expect(note).toHaveTextContent(/^3 less frequent observables not drawn$/);
    expect(note).toHaveClass("text-amber-700");
  });

  test("puts the dropped note after the key", () => {
    renderLegend({ droppedObservableCount: 1 });

    const legend: HTMLElement = screen.getByTestId("correlate-legend");

    expect(legend.lastElementChild).toBe(
      screen.getByTestId("correlate-dropped-observables"),
    );
  });

  test("translates its words but leaves the OCSF severity names alone", () => {
    renderLegend({ droppedObservableCount: 2 }, GermanWrapper);

    expect(screen.getByRole("list", { name: "Legende" })).toBeInTheDocument();
    expect(screen.getByTestId("correlate-legend-filter")).toHaveTextContent(
      /^Ihr Filter$/,
    );
    expect(
      screen.getByTestId("correlate-legend-severity-none"),
    ).toHaveTextContent(/^Kein Schweregrad$/);
    // The pills on the graph say "High" in every language; so does the key.
    expect(
      screen.getByTestId("correlate-legend-severity-high"),
    ).toHaveTextContent(/^High$/);
    expect(
      screen.getByTestId("correlate-legend-severity-informational"),
    ).toHaveTextContent(/^Informational$/);
    expect(screen.queryByText("Informativ")).toBeNull();
    expect(
      screen.getByTestId("correlate-dropped-observables"),
    ).toHaveTextContent(/^2 seltenere Observables nicht gezeichnet$/);
  });
});

/*
 * The dashboard's dark theme is a list of specific classes remapped under
 * html.dark in Theme.css. A colour class outside that list keeps its light
 * value on a dark page, and a literal inline colour does the same — so
 * inline colours must be theme tokens, or one of the deliberate accents
 * (the severity colours and the filter's indigo) that read on both.
 */
describe("dark theme", () => {
  const RENDER_CASES: Array<ReactElement> = [
    statsElement(),
    statsElement({
      isStale: true,
      isTruncated: true,
      eventCount: 200,
      summary: makeSummary({ droppedObservableCount: 3 }),
    }),
    statsElement({ summary: makeSummary({ worstClass: undefined }) }),
    legendElement({ droppedObservableCount: 0 }),
    legendElement({ droppedObservableCount: 5 }),
  ];

  test("uses only colour classes the dark theme remaps", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    const colourClass: RegExp = /^(bg|border|text)-(white|[a-z]+-\d{2,3})$/;
    const stateColourClass: RegExp =
      /^(hover|focus|focus-visible):(bg|border|text|ring)-([a-z]+)-\d{2,3}$/;
    const used: Set<string> = new Set<string>();
    const usedStates: Set<string> = new Set<string>();

    for (const element of RENDER_CASES) {
      const { container } = render(element, { wrapper: EnglishWrapper });

      for (const node of Array.from(container.querySelectorAll("*"))) {
        const className: string = node.getAttribute("class") || "";

        for (const token of className.split(/\s+/)) {
          if (colourClass.test(token)) {
            used.add(token);
          }
          if (stateColourClass.test(token)) {
            usedStates.add(token);
          }
        }
      }

      cleanup();
    }

    /*
     * State variants are remapped either by their exact token or by a rule
     * covering every shade of the hue for that state.
     */
    expect(Array.from(usedStates)).toEqual(
      expect.arrayContaining([
        "hover:text-indigo-800",
        "focus-visible:ring-indigo-500",
      ]),
    );

    for (const token of Array.from(usedStates)) {
      const parts: RegExpExecArray = stateColourClass.exec(
        token,
      ) as RegExpExecArray;
      const exactRule: string = `[class~="${token}"]`;
      const hueRule: string = `[class*="${parts[1]}:${parts[2]}-${parts[3]}-"]`;

      expect({
        token: token,
        remapped: themeCss.includes(exactRule) || themeCss.includes(hueRule),
      }).toEqual({ token: token, remapped: true });
    }

    // Both surfaces, the warning variant and the link colour were all seen.
    expect(Array.from(used)).toEqual(
      expect.arrayContaining([
        "bg-gray-50",
        "bg-amber-50",
        "text-amber-700",
        "text-indigo-600",
        "text-indigo-500",
        "bg-white",
      ]),
    );

    for (const token of Array.from(used)) {
      expect({
        token: token,
        remapped: new RegExp(`\\.${token}(?![\\w-])`).test(themeCss),
      }).toEqual({ token: token, remapped: true });
    }
  });

  test("uses only theme tokens or deliberate accents for inline colours", () => {
    const accents: Set<string> = new Set<string>([
      "#4f46e5",
      ...LEGEND_SEVERITIES.map(
        ({ severity }: { severity: OcsfSeverity }): string => {
          return getSeverityColor(severity).toString().toLowerCase();
        },
      ),
    ]);
    const checked: Array<string> = [];

    for (const element of RENDER_CASES) {
      // The shared Pill picks its own contrasting text colour.
      for (const style of collectRawStyles(element, { skipTestId: "pill" })) {
        for (const property of [
          "color",
          "background",
          "backgroundColor",
          "borderColor",
        ] as const) {
          const value: unknown = style[property];

          if (value === undefined) {
            continue;
          }

          const text: string = String(value).toLowerCase();
          checked.push(text);

          expect({
            property: property,
            value: text,
            allowed: text.startsWith("var(--ou-") || accents.has(text),
          }).toEqual({ property: property, value: text, allowed: true });
        }
      }
    }

    // The theme token and every accent were actually exercised.
    expect(checked).toEqual(
      expect.arrayContaining([
        "var(--ou-chart-series-neutral, #64748b)",
        ...Array.from(accents),
      ]),
    );
  });
});
