import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to one copy for every importer (see the note at
 * the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import { afterEach, describe, expect, it } from "@jest/globals";
import ReplayRailRow, {
  ReplayRailRowProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailRow";
import {
  getRailStatusWords,
  glyphForSignal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailTabs";
import { fromTimelineEvent } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignals";
import {
  ReplaySignal,
  ReplaySignalKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import { ReplayTimelineEvent } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineTypes";

/*
 * A rail row's glyph and what a screen reader hears for it.
 *
 *   - The performance glyph was a circled c (ⓒ), which every font draws as
 *     the copyright sign. It is an hourglass now: what a performance row
 *     measures is time, and no other kind's glyph looks like it.
 *   - A row's label read the raw severity: "performance, success at 0:03.1:
 *     FCP 68 ms good", "request, info at 1:02.3: GET 200 /items". It now says
 *     in words only what the row's colour adds - "request failed", "console
 *     warning", "performance over budget" - and nothing for a plain row or
 *     where the title already says it (a web vital ends with its rating).
 *
 * The signals are built the way the player builds them, from the recorder's
 * timeline events (fromTimelineEvent), so the words follow the real
 * severities.
 */

const START_UNIX_MS: number = 1_725_000_000_000;

let ordinal: number = 0;

function signalFrom(event: Partial<ReplayTimelineEvent>): ReplaySignal {
  ordinal++;

  const signal: ReplaySignal | null = fromTimelineEvent(
    {
      id: `rec:0:${ordinal}`,
      chunkIndex: 0,
      offsetMs: 3100,
      ...event,
    } as ReplayTimelineEvent,
    { startTimeUnixMs: START_UNIX_MS },
  );

  if (!signal) {
    throw new Error(`No signal for ${JSON.stringify(event)}`);
  }

  return signal;
}

function vital(rating: "good" | "needs-improvement" | "poor"): ReplaySignal {
  return signalFrom({
    kind: "performance",
    performanceKind: "web-vital",
    metric: "FCP",
    value: rating === "good" ? 68 : rating === "poor" ? 3400 : 2100,
    rating: rating,
  });
}

function longTask(durationMs: number, budgetMs: number): ReplaySignal {
  return signalFrom({
    kind: "performance",
    performanceKind: "long-task",
    durationMs: durationMs,
    budgetMs: budgetMs,
  });
}

function request(status: number): ReplaySignal {
  return signalFrom({
    kind: "network",
    method: "GET",
    url: "https://api.example.com/items/1",
    status: status,
    durationMs: 120,
  });
}

function consoleLine(level: "log" | "warn" | "error"): ReplaySignal {
  return signalFrom({ kind: "console", level: level, message: "hello" });
}

function rowProps(signal: ReplaySignal): ReplayRailRowProps {
  return {
    row: { signal: signal, repeatCount: 1 } as ReplayRailRowProps["row"],
    domId: `rail-row-${signal.id}`,
    isActive: false,
    isSelected: false,
    isFuture: false,
    isFocusStop: true,
    onActivate: (): void => {},
    onSeek: (): void => {},
    onHover: (): void => {},
  };
}

function labelOf(signal: ReplaySignal): string {
  render(<ReplayRailRow {...rowProps(signal)} />);

  const label: string | null = screen
    .getByTestId("rail-row")
    .querySelector("[data-rail-row-body='true']")!
    .getAttribute("aria-label");

  cleanup();

  return label || "";
}

afterEach(() => {
  cleanup();
});

describe("the performance glyph", () => {
  it("is an hourglass, never the copyright-looking circled c", () => {
    for (const signal of [vital("good"), vital("poor"), longTask(450, 200)]) {
      expect(signal.kind).toBe("performance");
      expect(glyphForSignal(signal).label).toBe("⧗");
      expect(glyphForSignal(signal).label).not.toBe("ⓒ");
    }
  });

  it("is told apart from every other kind's glyph", () => {
    const others: Array<ReplaySignal> = [
      consoleLine("log"),
      request(200),
      signalFrom({ kind: "click", x: 10, y: 10 }),
      signalFrom({ kind: "error", message: "TypeError", errorKind: "error" }),
    ];

    for (const other of others) {
      expect(glyphForSignal(other).label).not.toBe(
        glyphForSignal(vital("good")).label,
      );
    }
  });

  it("is drawn in the row, hidden from screen readers like every glyph", () => {
    render(<ReplayRailRow {...rowProps(vital("good"))} />);

    const glyph: HTMLElement = screen.getByText("⧗");

    expect(glyph).toHaveAttribute("aria-hidden", "true");
  });
});

describe("what a screen reader hears for a row", () => {
  it("a good web vital: the kind, then the title that ends with its rating", () => {
    const signal: ReplaySignal = vital("good");

    expect(signal.severity).toBe("success");
    expect(getRailStatusWords(signal)).toBeNull();
    expect(glyphForSignal(signal).description).toBe("performance");
    expect(labelOf(signal)).toBe(`performance at 0:03.1: ${signal.title}`);
    expect(labelOf(signal)).not.toContain("success");
  });

  it("a web vital that needs improvement or is poor says so once, in its title", () => {
    for (const rating of ["needs-improvement", "poor"] as const) {
      const signal: ReplaySignal = vital(rating);

      expect(getRailStatusWords(signal)).toBeNull();
      expect(labelOf(signal)).toBe(`performance at 0:03.1: ${signal.title}`);
      expect(labelOf(signal)).not.toMatch(/\b(warn|error)\b/);
    }
  });

  it("a budget row over its budget is 'over budget'; one within it says nothing more", () => {
    const over: ReplaySignal = longTask(450, 200);
    const within: ReplaySignal = longTask(150, 200);

    expect(glyphForSignal(over).description).toBe("performance over budget");
    expect(labelOf(over)).toBe(
      `performance over budget at 0:03.1: ${over.title}`,
    );
    expect(glyphForSignal(within).description).toBe("performance");
  });

  it("a request that failed 'failed'; a 4xx is a warning; a 200 is a plain request", () => {
    expect(glyphForSignal(request(500)).description).toBe("request failed");
    expect(glyphForSignal(request(0)).description).toBe("request failed");
    expect(glyphForSignal(request(404)).description).toBe("request warning");
    expect(glyphForSignal(request(200)).description).toBe("request");
    expect(labelOf(request(200))).not.toContain("info");
  });

  it("console lines name their level only when it is a warning or an error", () => {
    expect(glyphForSignal(consoleLine("log")).description).toBe("console");
    expect(glyphForSignal(consoleLine("warn")).description).toBe(
      "console warning",
    );
    expect(glyphForSignal(consoleLine("error")).description).toBe(
      "console error",
    );
  });

  it("an error row is named an error by its kind, never 'error, error'", () => {
    const signal: ReplaySignal = signalFrom({
      kind: "error",
      message: "TypeError: boom",
      errorKind: "error",
    });
    const kind: ReplaySignalKind = signal.kind;

    expect(kind).toBe("client-error");
    expect(signal.severity).toBe("error");
    expect(glyphForSignal(signal).description).toBe("client error");
    expect(labelOf(signal).startsWith("client error at 0:03.1: ")).toBe(true);
    expect(labelOf(signal)).not.toContain("error, error");
  });

  it("no row's label carries a bare severity word after a comma", () => {
    const signals: Array<ReplaySignal> = [
      vital("good"),
      vital("poor"),
      longTask(450, 200),
      request(200),
      request(500),
      consoleLine("log"),
      consoleLine("error"),
      signalFrom({ kind: "click", x: 10, y: 10 }),
    ];

    for (const signal of signals) {
      expect(labelOf(signal)).not.toMatch(
        /^[a-z ]+, (info|success|warn|error) at /,
      );
    }
  });
});
