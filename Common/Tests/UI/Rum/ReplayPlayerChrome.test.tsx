import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import ReplayScrubber, {
  ReplayScrubberProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScrubber";
import ReplayHeader, {
  ReplayHeaderProps,
  ReplayHeaderTab,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayHeader";
import ReplayRailRow, {
  ReplayRailRowProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailRow";
import { ReplayRailRowModel } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailTabs";
import { ReplaySignal } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  ReplayEngineSnapshot,
  derivePhase,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";
import { REPLAY_CONTROL_HEIGHT_CLASS } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi";

/*
 * The design decisions of the player redesign, held across components.
 *
 * ReplayUi.test.tsx covers the primitives in isolation. What is pinned
 * HERE is the handful of structural choices that no single component
 * owns and that a well-meaning edit to one file would silently undo:
 * the order the player is stacked in, the fact that the shell (not each
 * part) draws the card, one control height across a whole toolbar, and
 * the typographic hierarchy that stops the header and the rail reading
 * as undifferentiated 11px soup.
 *
 * These are structure, not taste. Nothing here asserts a colour or a
 * padding value; every assertion names a rule that has a reason.
 */

const DURATION_MS: number = 600000;

function makeSnapshot(
  overrides?: Partial<ReplayEngineSnapshot>,
): ReplayEngineSnapshot {
  const buffer: ReplayEngineSnapshot["buffer"] = overrides?.buffer ?? "ok";
  const intent: ReplayEngineSnapshot["intent"] = overrides?.intent ?? "paused";

  return {
    phase: derivePhase(buffer, intent),
    intent: intent,
    buffer: buffer,
    currentTimeMs: 12000,
    durationMs: DURATION_MS,
    speed: 1,
    skipInactive: false,
    fedRange: { fromMs: 0, toMs: 60000 },
    loadedChunkIndexes: [0, 1, 2, 3],
    activeTabId: "tab-1",
    recordedSize: null,
    bufferingSinceMs: null,
    lastGap: null,
    lastIdleSkip: null,
    error: null,
    pendingSeekMs: null,
    generation: 1,
    ...overrides,
  };
}

function noop(): void {
  /* Handlers these assertions do not exercise. */
}

function makeScrubberProps(
  overrides?: Partial<ReplayScrubberProps>,
): ReplayScrubberProps {
  return {
    snapshot: makeSnapshot(),
    bands: [],
    markers: [],
    onSeek: noop,
    onPlayPause: noop,
    onSpeedChange: noop,
    onSkipInactiveChange: noop,
    ...overrides,
  };
}

function makeHeaderProps(
  overrides?: Partial<ReplayHeaderProps>,
): ReplayHeaderProps {
  const tab: ReplayHeaderTab = {
    tabId: "tab-1",
    label: "Tab 1",
    durationMs: 252000,
    openedAtMs: 0,
    hasFootage: true,
    isActive: true,
  };

  return {
    sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    backHref: "/dashboard/p/rum/a/session-replay",
    onBack: jest.fn(),
    identity: { label: "jane@acme.com", traits: { plan: "pro" } },
    facts: [
      { label: "Browser", value: "Chrome 126" },
      { label: "OS", value: "macOS" },
      { label: "Viewport", value: "1440x900" },
    ],
    startTimeUnixMs: new Date(2026, 8, 4, 10, 12, 41, 200).getTime(),
    currentTimeMs: 41200,
    durationMs: 252000,
    isLive: false,
    tabs: [tab],
    onSwitchTab: jest.fn(),
    isWide: false,
    onToggleWide: jest.fn(),
    isTheater: false,
    onToggleTheater: jest.fn(),
    onOpenDetails: jest.fn(),
    buildMomentUrl: (): string => {
      return "https://dash.example/x";
    },
    ...overrides,
  };
}

function makeRailRowProps(
  overrides?: Partial<ReplayRailRowProps>,
): ReplayRailRowProps {
  const signal: ReplaySignal = {
    id: "rec:1:0",
    kind: "network",
    source: "recording",
    offsetMs: 62300,
    severity: "info",
    title: "GET /api/checkout/session returned 500",
    subtitle: "812ms",
    links: {},
    detail: {},
  };

  const row: ReplayRailRowModel = {
    signal: signal,
    repeatCount: 1,
    lastOffsetMs: signal.offsetMs,
    memberIds: [signal.id],
  };

  return {
    row: row,
    domId: "rail-row-1",
    isActive: false,
    isSelected: false,
    isFuture: false,
    isFocusStop: true,
    onActivate: noop,
    onSeek: noop,
    onHover: noop,
    ...overrides,
  };
}

/*
 * Elements are ordered as they appear in the document, so comparing two
 * positions with compareDocumentPosition is how "A comes before B" is
 * asserted without reaching for a snapshot.
 */
function comesBefore(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("player stacking order", () => {
  /*
   * picture -> track -> transport, the order every media player has used
   * since the first one. The old layout put ten buttons BETWEEN the
   * picture and the timeline, so the two things a viewer moves between -
   * the frame, and the position they want it at - were separated by the
   * noisiest strip on the page.
   */
  it("draws the timeline above the transport row", () => {
    render(<ReplayScrubber {...makeScrubberProps()} />);

    const timeline: HTMLElement = screen.getByTestId("replay-timeline");
    const controls: HTMLElement = screen.getByTestId("replay-controls");

    expect(comesBefore(timeline, controls)).toBe(true);
  });

  /*
   * The address bar, the picture and the transport are sections of ONE
   * card that the shell draws; each of them drawing its own border was
   * what made the player read as three unrelated widgets stacked with
   * gaps between them. If the scrubber grows a border again, the shell's
   * card gets a second outline nested inside it.
   */
  it("leaves the card to the shell instead of drawing its own", () => {
    render(<ReplayScrubber {...makeScrubberProps()} />);

    const scrubber: HTMLElement = screen.getByTestId("replay-scrubber");

    expect(scrubber.className).not.toContain("border");
    expect(scrubber.className).not.toContain("shadow");
    expect(scrubber.className).not.toContain("rounded");
  });
});

describe("transport row", () => {
  /*
   * ONE height for every control, and exactly one exception: the play
   * button, which is deliberately larger and round because it is the one
   * control a viewer should find without reading. Four heights in a row
   * is what made the old strip look like a pile of unrelated chips - the
   * worst offender being Common/UI's 24px Toggle with its text-sm label.
   */
  it("gives every button the shared control height, except the play button", () => {
    render(<ReplayScrubber {...makeScrubberProps()} />);

    const controls: HTMLElement = screen.getByTestId("replay-controls");
    const buttons: Array<HTMLElement> = Array.from(
      controls.querySelectorAll("button"),
    );

    expect(buttons.length).toBeGreaterThan(5);

    buttons.forEach((button: HTMLElement): void => {
      if (button.getAttribute("data-testid") === "replay-play-pause") {
        /* The exception, and it is a circle. */
        expect(button.className).toContain("h-9");
        expect(button.className).toContain("rounded-full");
        return;
      }

      expect(button.className).toContain(REPLAY_CONTROL_HEIGHT_CLASS);
    });
  });

  /*
   * Colour means something in this row: rose is "there is an error to
   * jump to", amber is "there is a frustration signal", indigo is the
   * one primary action. Everything else is a ghost. A button that draws
   * its own outline at rest is back to being a chip.
   */
  it("draws no resting outline on any control but the play button", () => {
    render(<ReplayScrubber {...makeScrubberProps()} />);

    const controls: HTMLElement = screen.getByTestId("replay-controls");
    const buttons: Array<HTMLElement> = Array.from(
      controls.querySelectorAll("button"),
    );

    buttons.forEach((button: HTMLElement): void => {
      /* focus-visible rings are keyboard affordances, not chrome. */
      const restingClasses: string = button.className
        .split(" ")
        .filter((token: string): boolean => {
          return !token.startsWith("focus");
        })
        .join(" ");

      expect(restingClasses).not.toContain("ring-gray-300");
      expect(restingClasses).not.toContain("ring-1 ring-inset ring-gray-");
    });
  });

  it("groups the controls that belong together on shared tracks", () => {
    render(<ReplayScrubber {...makeScrubberProps()} />);

    const controls: HTMLElement = screen.getByTestId("replay-controls");

    /* +-10s together, and the three signal-jump buttons together. */
    expect(
      within(controls).getByRole("group", { name: "Seek by ten seconds" }),
    ).toBeInTheDocument();
    expect(
      within(controls).getByRole("group", { name: "Jump between signals" }),
    ).toBeInTheDocument();
  });

  it("separates the clusters with decorative hairlines, not with text", () => {
    render(<ReplayScrubber {...makeScrubberProps()} />);

    const dividers: Array<HTMLElement> = screen.getAllByTestId(
      "replay-toolbar-divider",
    );

    expect(dividers.length).toBeGreaterThan(0);
    dividers.forEach((divider: HTMLElement): void => {
      expect(divider).toHaveAttribute("aria-hidden", "true");
      expect(divider.textContent).toBe("");
    });
  });

  /*
   * The speed menu opens UPWARD. The transport row is the bottom edge of
   * the player card now, so a downward menu would hang off the card into
   * the page - and, on the shortest viewport the player supports, off
   * the screen.
   */
  it("opens the speed menu above its trigger", () => {
    render(<ReplayScrubber {...makeScrubberProps()} />);

    fireEvent.click(screen.getByTestId("replay-speed"));

    expect(screen.getByTestId("replay-speed-menu").className).toContain(
      "bottom-full",
    );
  });
});

describe("header hierarchy", () => {
  /*
   * Everything on the old header ran at text-xs, separated by a literal
   * "|" character, so the one thing a viewer opens the page to check -
   * is this the right session - shouted at exactly the same volume as
   * the viewport size. The identity now leads.
   */
  it("sets the identity a size larger than the device facts", () => {
    render(<ReplayHeader {...makeHeaderProps()} />);

    expect(screen.getByTestId("replay-header-user").className).toContain(
      "text-sm",
    );
    screen
      .getAllByTestId("replay-header-fact")
      .forEach((fact: HTMLElement): void => {
        expect(fact.className).not.toContain("text-sm");
      });
  });

  it("uses no typed-out pipe characters as separators", () => {
    render(<ReplayHeader {...makeHeaderProps()} />);

    expect(screen.getByTestId("replay-header").textContent).not.toContain("|");
  });

  /*
   * Row 2 is a shelf under a hairline. Its actions are the only
   * outlined-looking things on the header, and their accessible names
   * are the words printed on them (WCAG 2.5.3), not their tooltips.
   */
  it("names the action buttons by the word printed on them", () => {
    render(<ReplayHeader {...makeHeaderProps()} />);

    ["Link", "Wide", "Theater", "Details"].forEach((label: string): void => {
      expect(screen.getByRole("button", { name: label })).toHaveTextContent(
        label,
      );
    });
  });

  it("puts the layout toggles on one shared track", () => {
    render(<ReplayHeader {...makeHeaderProps()} />);

    const group: HTMLElement = screen.getByRole("group", {
      name: "Player layout",
    });

    expect(within(group).getByTestId("replay-toggle-wide")).toBeInTheDocument();
    expect(
      within(group).getByTestId("replay-toggle-theater"),
    ).toBeInTheDocument();
  });

  /*
   * The wall clock is the number a viewer lines up against a dashboard,
   * so it leads its block; the offset pair is a reference underneath it.
   */
  it("leads the clock block with the wall-clock time", () => {
    render(<ReplayHeader {...makeHeaderProps()} />);

    const block: HTMLElement = screen.getByTestId("replay-header-clock");
    const wallClock: HTMLElement = screen.getByTestId(
      "replay-header-wall-clock",
    );

    expect(block).toContainElement(wallClock);
    expect(wallClock.className).toContain("font-semibold");
    expect(block).toHaveTextContent("0:41 / 4:12");
  });

  it("keeps the identity honest about the difference between hidden and anonymous", () => {
    const { rerender } = render(
      <ReplayHeader {...makeHeaderProps({ identity: { label: null } })} />,
    );

    expect(screen.getByTestId("replay-header-user")).toHaveTextContent(
      "Identity hidden",
    );

    rerender(
      <ReplayHeader {...makeHeaderProps({ identity: { label: "" } })} />,
    );
    expect(screen.getByTestId("replay-header-user")).toHaveTextContent(
      "Anonymous",
    );
  });
});

describe("rail row typography", () => {
  /*
   * The row used to be font-mono at 11px end to end - glyph, offset,
   * title, subtitle, tags - which made a few hundred rows read as a log
   * dump. Monospace is right for the one column that must align down the
   * list and wrong for the prose beside it.
   */
  it("sets the offset in a monospace column and the title in the UI face", () => {
    render(<ReplayRailRow {...makeRailRowProps()} />);

    const row: HTMLElement = screen.getByTestId("rail-row");

    expect(row.className).not.toContain("font-mono");

    const offset: HTMLElement | null = within(row).getByText("1:02.3");

    expect(offset.className).toContain("font-mono");
    expect(offset.className).toContain("tabular-nums");

    const title: HTMLElement = within(row).getByText(
      "GET /api/checkout/session returned 500",
    );

    expect(title.className).not.toContain("font-mono");
  });

  /*
   * The offset column is fixed width. Without it every title started at
   * a different x depending on whether the row's time had crossed into
   * minutes, which is exactly the ragged left edge that makes a list
   * unscannable.
   */
  it("reserves a fixed width for the offset so titles line up", () => {
    render(<ReplayRailRow {...makeRailRowProps()} />);

    expect(screen.getByText("1:02.3").className).toContain("w-12");
  });

  it("still reads the whole row to assistive tech, glyph and meta included", () => {
    render(
      <ReplayRailRow
        {...makeRailRowProps({ counterpartNote: "also reported server-side" })}
      />,
    );

    const body: HTMLElement = screen.getByRole("button", {
      name: /request, info at 1:02.3/,
    });

    expect(body).toHaveAttribute(
      "aria-label",
      expect.stringContaining("also reported server-side"),
    );
    expect(body).toHaveAttribute(
      "aria-label",
      expect.stringContaining("812ms"),
    );
  });
});

describe("timeline lanes", () => {
  /*
   * The legend is rendered unconditionally with a RESERVED height:
   * showing it only on hover shifted every lane down by a line the
   * moment the pointer entered the track, which moved the marker the
   * viewer was aiming at.
   */
  it("always renders the legend at a fixed height", () => {
    const { rerender } = render(<ReplayScrubber {...makeScrubberProps()} />);

    const legend: HTMLElement = screen.getByTestId("timeline-legend");

    expect(legend.className).toContain("h-4");
    expect(legend).toHaveTextContent("Loaded");
    expect(legend).toHaveTextContent("Gap");

    rerender(
      <ReplayScrubber
        {...makeScrubberProps({
          snapshot: makeSnapshot({ intent: "playing" }),
        })}
      />,
    );

    expect(screen.getByTestId("timeline-legend").className).toContain("h-4");
  });

  it("draws every legend swatch, so no band kind is unexplained", () => {
    render(<ReplayScrubber {...makeScrubberProps()} />);

    const legend: HTMLElement = screen.getByTestId("timeline-legend");

    [
      "Loaded",
      "Not yet loaded",
      "Gap",
      "Idle",
      "Tab in background",
      "Approximate",
    ].forEach((label: string): void => {
      expect(legend).toHaveTextContent(label);
    });
  });

  it("keeps the seekable track a real slider with a readable value", () => {
    render(<ReplayScrubber {...makeScrubberProps()} />);

    const track: HTMLElement = screen.getByTestId("timeline-track");

    expect(track).toHaveAttribute("role", "slider");
    expect(track).toHaveAttribute("aria-valuenow", "12000");
    expect(track).toHaveAttribute("aria-valuetext", "0:12 of 10:00");
  });
});
