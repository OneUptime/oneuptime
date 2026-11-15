// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * #8048: what the chart title row's classes become in the browser.
 *
 * jsdom has no stylesheet, and Tailwind silently ignores a variant it does
 * not know, so the class names alone prove nothing: `[@media(hover:none)]`
 * misspelt would leave the hint on every phone. Every frontend styles
 * itself at runtime with the vendored Play CDN (tailwind-3.4.5.js), so this
 * renders a real ChartGroup card on a zoomable page, runs the CDN over it
 * the way a page does, and reads the CSS it writes for the row's classes:
 * the hint is display:none below 640px and on a screen with no hover, and
 * the row wraps, so the hint can go under the title.
 */

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

import ChartGroup, {
  Chart,
  CHART_TITLE_ROW_TEST_ID,
  ChartType,
} from "../../../../UI/Components/Charts/ChartGroup/ChartGroup";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { TimeRangeZoomProvider } from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import { XAxisAggregateType } from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import { YAxisPrecision } from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import TimeRange from "../../../../Types/Time/TimeRange";

const PLAY_CDN_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Static",
  "Vendor",
  "tailwind",
  "tailwind-3.4.5.js",
);

// Carried by the fixture card only, so its rule marks the fixture's build.
const FIXTURE_SENTINEL_CLASS: string = "isolate";

interface PlayCdnGlobal {
  config: Record<string, unknown>;
}

interface EmittedRule {
  media: string;
  selector: string;
  style: CSSStyleDeclaration;
}

function playCdn(): PlayCdnGlobal | undefined {
  return (window as unknown as { tailwind?: PlayCdnGlobal }).tailwind;
}

function playCdnStyle(): HTMLStyleElement | undefined {
  return Array.from(document.head.querySelectorAll("style")).find(
    (element: HTMLStyleElement) => {
      return (element.textContent || "").includes("tailwindcss v");
    },
  );
}

// Every style rule the CDN wrote, those inside a media rule with its query.
function readEmittedRules(): Array<EmittedRule> {
  const sheet: CSSStyleSheet | null | undefined = playCdnStyle()?.sheet;
  const rules: Array<EmittedRule> = [];

  const walk: (list: CSSRuleList, media: string) => void = (
    list: CSSRuleList,
    media: string,
  ): void => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSMediaRule) {
        walk(rule.cssRules, rule.media.mediaText);
      } else if (rule instanceof CSSStyleRule) {
        rules.push({ media, selector: rule.selectorText, style: rule.style });
      }
    }
  };

  if (sheet) {
    walk(sheet.cssRules, "");
  }

  return rules;
}

function classSelector(className: string): string {
  return `.${className.replace(/[^\w-]/g, (character: string): string => {
    return `\\${character}`;
  })}`;
}

const OriginalMutationObserver: typeof MutationObserver =
  window.MutationObserver;
const playCdnObservers: Array<MutationObserver> = [];

class RecordingMutationObserver extends OriginalMutationObserver {
  public constructor(callback: MutationCallback) {
    super(callback);
    playCdnObservers.push(this);
  }
}

let emittedRules: Array<EmittedRule> = [];
/*
 * The CSS as the CDN wrote it. It writes an arbitrary media variant as
 * `@media(hover:none){...}`, with no space after `@media`: a browser reads
 * that, jsdom's CSSOM drops it, so that rule is read from the text.
 */
let emittedCss: string = "";
let hintClasses: Array<string> = [];
let rowClasses: Array<string> = [];

function rulesFor(className: string): Array<EmittedRule> {
  return emittedRules.filter((rule: EmittedRule): boolean => {
    return rule.selector === classSelector(className);
  });
}

const CHART: Chart = {
  id: "db-size",
  title: "Размер базы данных",
  type: ChartType.LINE,
  props: {
    data: [
      {
        seriesName: "Size",
        data: [{ x: new Date("2026-11-15T10:01:00.000Z"), y: 3 }],
      },
    ],
    xAxis: {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        min: new Date("2026-11-15T10:00:00.000Z"),
        max: new Date("2026-11-15T10:30:00.000Z"),
        aggregateType: XAxisAggregateType.Average,
      },
    },
    yAxis: {
      legend: "",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: "auto",
        precision: YAxisPrecision.NoDecimals,
        formatter: (value: number): string => {
          return String(value);
        },
      },
    },
    sync: false,
    curve: ChartCurve.MONOTONE,
  } as unknown as Chart["props"],
};

beforeAll(async () => {
  window.MutationObserver = RecordingMutationObserver;

  const warn: ReturnType<typeof jest.spyOn> = jest
    .spyOn(console, "warn")
    .mockImplementation(() => {});

  const script: HTMLScriptElement = document.createElement("script");
  script.textContent = fs.readFileSync(PLAY_CDN_PATH, "utf-8");
  document.head.appendChild(script);

  warn.mockRestore();

  const cdn: PlayCdnGlobal | undefined = playCdn();

  if (!cdn) {
    throw new Error(
      "the vendored Play CDN did not run: jest-environment-jsdom must execute <script> elements",
    );
  }

  cdn.config = { darkMode: "class" };

  await waitFor(
    () => {
      expect(playCdnStyle()).toBeDefined();
    },
    { timeout: 30000 },
  );

  render(
    <TimeRangeZoomProvider
      zoom={{
        isZoomed: false,
        rangeBeforeZoom: null,
        timeRange: { range: TimeRange.PAST_ONE_HOUR },
        zoomToTimeRange: (): void => {},
        resetZoom: (): void => {},
      }}
    >
      <div className={FIXTURE_SENTINEL_CLASS}>
        <ChartGroup charts={[CHART]} />
      </div>
    </TimeRangeZoomProvider>,
  );

  hintClasses = screen
    .getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)
    .className.split(/\s+/)
    .filter(Boolean);
  rowClasses = screen
    .getByTestId(CHART_TITLE_ROW_TEST_ID)
    .className.split(/\s+/)
    .filter(Boolean);

  await waitFor(
    () => {
      expect(
        readEmittedRules().some((rule: EmittedRule): boolean => {
          return rule.selector === classSelector(FIXTURE_SENTINEL_CLASS);
        }),
      ).toBe(true);
    },
    { timeout: 30000 },
  );

  emittedRules = readEmittedRules();
  emittedCss = playCdnStyle()?.textContent || "";
}, 60000);

afterAll(() => {
  for (const observer of playCdnObservers) {
    observer.disconnect();
  }

  window.MutationObserver = OriginalMutationObserver;
});

describe("the chart title row, as the Play CDN styles it", () => {
  test("below 640px the hint is not drawn", () => {
    expect(hintClasses).toContain("max-sm:hidden");

    const rules: Array<EmittedRule> = rulesFor("max-sm:hidden");
    expect(rules).toHaveLength(1);
    expect(rules[0]!.media).toMatch(/not all and \(min-width: 640px\)/);
    expect(rules[0]!.style.getPropertyValue("display")).toBe("none");
  });

  test("on a screen nothing can hover (a phone, a tablet) the hint is not drawn", () => {
    expect(hintClasses).toContain("[@media(hover:none)]:hidden");

    const rule: string = `@media(hover:none){${classSelector(
      "[@media(hover:none)]:hidden",
    )}{display:none}}`;
    expect(emittedCss.replace(/\s+/g, "")).toContain(rule);
  });

  test("negative control: a misspelt variant writes no rule at all", () => {
    // What a typo in the class would leave on every phone.
    expect(emittedCss).not.toContain("hover:nothing");
    expect(rulesFor("[@media(hover:nothing)]:hidden")).toHaveLength(0);
  });

  test("anywhere else it is drawn: every rule that hides it is behind a media query", () => {
    const hiding: Array<EmittedRule> = emittedRules.filter(
      (rule: EmittedRule): boolean => {
        return (
          hintClasses.some((className: string): boolean => {
            return rule.selector === classSelector(className);
          }) && rule.style.getPropertyValue("display") === "none"
        );
      },
    );

    expect(hiding.length).toBeGreaterThan(0);
    for (const rule of hiding) {
      expect(rule.media).not.toBe("");
    }
    // And no bare `hidden` on it, which a foreign `.hidden` rule could pin.
    expect(hintClasses).not.toContain("hidden");
  });

  test("the row wraps, so a hint too wide to sit beside the title goes under it", () => {
    expect(rowClasses).toContain("flex-wrap");
    expect(rulesFor("flex-wrap")[0]!.style.getPropertyValue("flex-wrap")).toBe(
      "wrap",
    );
  });

  test("on its own line the hint keeps to the row's end and is cut there, never past it", () => {
    expect(rulesFor("ml-auto")[0]!.style.getPropertyValue("margin-left")).toBe(
      "auto",
    );
    expect(rulesFor("max-w-full")[0]!.style.getPropertyValue("max-width")).toBe(
      "100%",
    );
    expect(
      rulesFor("truncate")[0]!.style.getPropertyValue("text-overflow"),
    ).toBe("ellipsis");
  });
});
