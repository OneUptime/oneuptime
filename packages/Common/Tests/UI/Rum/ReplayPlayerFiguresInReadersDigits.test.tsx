/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { createTranslator, Translator } from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/* The header's pin and other-sessions menu read nothing in these tests. */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      create: async (): Promise<unknown> => {
        return {};
      },
      deleteItem: async (): Promise<unknown> => {
        return {};
      },
    },
  };
});

import ReplayControls, {
  ReplayControlsProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayControls";
import ReplayHeader, {
  ReplayHeaderProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayHeader";
import ReplayTimeline from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeline";
import ReplayStageOverlays, {
  ReplayStageOverlaysProps,
  describeIdleBandChip,
  describeIdleSkip,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayStageOverlays";
import ReplayRail, {
  ReplayRailProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRail";
import ReplayRailDetail, {
  ReplayRailDetailProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailDetail";
import { fromTimelineEvent } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignals";
import { ReplaySignal } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  ReplayTimelineChunkInput,
  ReplayTimelineMarker,
  buildTimelineMarkers,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineMath";
import {
  REPLAY_BUFFERING_GRACE_MS,
  ReplayEngineSnapshot,
  ReplayIdleBand,
  derivePhase,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";

/*
 * THE SESSION REPLAY PLAYER'S FIGURES IN THE READER'S DIGITS (#7318), drawn
 * from the Dashboard's shipped locale files.
 *
 * A Persian page wrote its counts, dates and the tab switcher in Persian
 * digits, and around them the player drew "0:01 / 0:30", "0:00.7", "10s",
 * "1x", "1200x760 -> 43%", "13:47:53", the rail's "0:03.0" and its
 * "اکنون 0:01", and the timeline's hover and marker times in Latin ones.
 * Every figure the player writes is now in the digits the reader's language
 * writes: Persian's own (with Persian's decimal sign, as a point beside
 * Persian's dot-shaped zero reads as one more digit), Latin in every other
 * language - Arabic too, as OneUptime writes Arabic. A clock pair, and the
 * viewport chip's arrow, read left to right on a page read from the right.
 *
 * The fixture's own text (titles, the page's address) has no digits, so a
 * Latin digit in Persian is the player's. What is copied or put in a link
 * keeps ASCII digits and is not looked at here.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;

const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;

const DURATION_MS: number = 600000;

// 13:47:12 UTC, so the wall clock 41.2s in reads 13:47:53.
const START_UNIX_MS: number = Date.UTC(2026, 8, 4, 13, 47, 12, 0);

const TRACK_WIDTH: number = 1000;

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

// A translator over `language`'s shipped words, as the player's own is.
function translatorIn(language: string): Translator {
  const words: Record<string, string> = readDashboardLocale(language);

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await readIn("en");
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function noop(): void {
  /* Handlers these assertions do not exercise. */
}

// What a reader sees or hears of `element`: its text, title and name.
function readingsOf(element: HTMLElement): Array<string> {
  return [
    element.textContent || "",
    element.getAttribute("title") || "",
    element.getAttribute("aria-label") || "",
    element.getAttribute("aria-valuetext") || "",
  ]
    .map(withoutIsolateMarks)
    .filter((text: string): boolean => {
      return text.length > 0;
    });
}

/* ---- The surfaces, each with the figures it draws. ---- */

function renderControls(overrides?: Partial<ReplayControlsProps>): void {
  const props: ReplayControlsProps = {
    phase: "paused",
    currentTimeMs: 700,
    durationMs: 30000,
    speed: 1.5,
    isSkipInactiveEnabled: false,
    hasPrevError: false,
    hasNextError: false,
    hasNextFrustration: false,
    onPlayPause: noop,
    onSeekRelative: noop,
    onSpeedChange: noop,
    onSkipInactiveChange: noop,
    onPrevError: noop,
    onNextError: noop,
    onNextFrustration: noop,
    onShowShortcuts: noop,
    ...overrides,
  };

  render(<ReplayControls {...props} />);
}

// The transport's figures: the clock, the seek buttons, the speed and its menu.
function controlsFigures(): Array<string> {
  fireEvent.click(screen.getByTestId("replay-speed"));

  return [
    screen.getByTestId("replay-time"),
    screen.getByTestId("replay-seek-back"),
    screen.getByTestId("replay-seek-forward"),
    screen.getByTestId("replay-speed"),
    ...within(screen.getByTestId("replay-speed-menu")).getAllByRole("radio"),
  ].flatMap(readingsOf);
}

function makeHeaderProps(): ReplayHeaderProps {
  return {
    sessionId: "abcdefabcdefabcdefabcdefabcdefab",
    backHref: "/dashboard/p/rum/a/session-replay",
    onBack: noop,
    identity: { label: "jane@acme.com", traits: {} },
    facts: [],
    startTimeUnixMs: START_UNIX_MS,
    currentTimeMs: 41200,
    durationMs: 252000,
    isLive: false,
    tabs: [],
    onSwitchTab: noop,
    isWide: false,
    onToggleWide: noop,
    isTheater: false,
    onToggleTheater: noop,
    onOpenDetails: noop,
    buildMomentUrl: (): string => {
      return "https://dash.example/replay";
    },
  } as ReplayHeaderProps;
}

function headerFigures(): Array<string> {
  return [
    screen.getByTestId("replay-header-wall-clock"),
    screen.getByTestId("replay-header-offset"),
  ].flatMap((element: HTMLElement): Array<string> => {
    return [withoutIsolateMarks(element.textContent || "")];
  });
}

function signal(
  overrides: Partial<ReplaySignal> & { id: string },
): ReplaySignal {
  return {
    kind: "network",
    source: "recording",
    offsetMs: 0,
    severity: "warn",
    title: "GET /poll",
    links: {},
    detail: {},
    alignment: "exact",
    ...overrides,
  } as ReplaySignal;
}

// Seven requests close together (a cluster), and one on its own.
function timelineSignals(): Array<ReplaySignal> {
  return [
    ...Array.from({ length: 7 }, (_unused: unknown, index: number) => {
      return signal({ id: `rec:0:${index}`, offsetMs: 1000 + index * 500 });
    }),
    signal({
      id: "rec:0:9",
      kind: "navigation",
      offsetMs: 301000,
      severity: "info",
      title: "/checkout",
      detail: { to: "/checkout" },
    }),
  ];
}

// An undecoded chunk with errors: a coarse marker, "~time count in window".
function unloadedChunk(): ReplayTimelineChunkInput {
  return {
    chunkIndex: 4,
    chunkStartOffsetMs: 60000,
    chunkEndOffsetMs: 75000,
    eventCount: 40,
    errorCount: 2,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
  };
}

function timelineMarkers(language: string): Array<ReplayTimelineMarker> {
  return buildTimelineMarkers(
    {
      signals: timelineSignals(),
      chunks: [unloadedChunk()],
      loadedChunkIndexes: [0],
      notices: [{ id: "seek", offsetMs: 450000, title: "Footage resumes" }],
      durationMs: DURATION_MS,
    },
    translatorIn(language),
  );
}

function renderTimeline(language: string): HTMLElement {
  render(
    <ReplayTimeline
      durationMs={DURATION_MS}
      currentTimeMs={65000}
      bands={[]}
      markers={timelineMarkers(language)}
      signals={timelineSignals()}
      startTimeUnixMs={START_UNIX_MS}
      onSeek={noop}
    />,
  );

  const track: HTMLElement = screen.getByTestId("timeline-track");

  // jsdom gives every element a zero-size rect.
  track.getBoundingClientRect = (): DOMRect => {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: TRACK_WIDTH,
      bottom: 24,
      width: TRACK_WIDTH,
      height: 24,
      toJSON: (): unknown => {
        return {};
      },
    } as DOMRect;
  };

  return track;
}

// Hovers 5:00 in, where the navigation is.
function hover(track: HTMLElement): void {
  fireEvent(
    track,
    new MouseEvent("pointermove", {
      clientX: 500,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function timelineFigures(track: HTMLElement): Array<string> {
  hover(track);

  return [
    track,
    screen.getByTestId("timeline-marker-cluster"),
    screen.getByTestId("timeline-hover-time"),
    ...screen.getAllByTestId("timeline-hover-preview-signal"),
    ...Array.from(
      screen
        .getByTestId("replay-timeline")
        .querySelectorAll<HTMLElement>("[data-testid^='timeline-marker']"),
    ),
  ].flatMap(readingsOf);
}

function makeSnapshot(): ReplayEngineSnapshot {
  return {
    phase: derivePhase("ok", "paused"),
    intent: "paused",
    buffer: "ok",
    currentTimeMs: 41200,
    durationMs: 252000,
    speed: 1,
    skipInactive: false,
    fedRange: { fromMs: 0, toMs: 60000 },
    loadedChunkIndexes: [0, 1, 2, 3],
    activeTabId: "tab-1",
    recordedSize: { width: 1200, height: 760 },
    bufferingSinceMs: null,
    lastGap: null,
    lastIdleSkip: null,
    error: null,
    pendingSeekMs: null,
    generation: 1,
    notice: null,
    idleBands: [],
    feedAheadMs: 30000,
    earliestPlayableMs: 0,
  } as ReplayEngineSnapshot;
}

function renderOverlays(overrides?: Partial<ReplayStageOverlaysProps>): void {
  const props: ReplayStageOverlaysProps = {
    snapshot: makeSnapshot(),
    signals: [],
    chunks: [],
    entryUrl: "https://app.acme.com/checkout",
    recordedSize: { width: 1200, height: 760 },
    scale: 0.43,
    fit: "contain",
    onFitChange: noop,
    canSelectText: true,
    isTextSelectionEnabled: false,
    onTextSelectionChange: noop,
    onPlayPause: noop,
    onWatchAgain: noop,
    onRetry: noop,
    onStillLoadingRetry: noop,
    onSkipIdle: noop,
    getDiagnostic: (): string => {
      return "{}";
    },
    ...overrides,
  } as ReplayStageOverlaysProps;

  render(
    <ReplayStageOverlays {...props}>
      <div data-testid="fake-stage" />
    </ReplayStageOverlays>,
  );
}

// Words with no digit, one per row, so no two rows fold into one.
const ROW_WORDS: ReadonlyArray<string> = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliett",
  "kilo",
  "lima",
];

/*
 * Twelve rows, so the "all" tab counts two figures - or, all worded alike,
 * one row repeated twelve times in a row.
 */
function railSignals(isRepeated: boolean = false): Array<ReplaySignal> {
  return ROW_WORDS.map((word: string, index: number): ReplaySignal => {
    const title: string = isRepeated ? "order saved" : `order saved: ${word}`;

    return {
      id: `rec:0:${index}`,
      kind: "console",
      source: "recording",
      offsetMs: 2000 + index * 1000,
      severity: "info",
      title: title,
      chunkIndex: 0,
      links: {},
      detail: { level: "log", message: title, atUnixMs: null },
      alignment: "exact",
    } as ReplaySignal;
  });
}

function renderRail(overrides?: Partial<ReplayRailProps>): void {
  const props: ReplayRailProps = {
    signals: railSignals(),
    sessionId: "abcdefabcdefabcdefabcdefabcdefab",
    startTimeUnixMs: START_UNIX_MS,
    isFinalized: true,
    isExpiredFootage: false,
    currentTimeMs: 3000,
    isPlaying: false,
    selectedSignalId: null,
    onSeek: noop,
    onSelectSignal: noop,
    onFollowChange: noop,
    onTabChange: noop,
    onQueryChange: noop,
    loadedChunkCount: 1,
    totalChunkCount: 1,
    ...overrides,
  } as ReplayRailProps;

  render(
    <MemoryRouter>
      <ReplayRail {...props} />
    </MemoryRouter>,
  );
}

function railFigures(): Array<string> {
  return [
    ...screen.getAllByTestId("rail-row-time"),
    screen.getByTestId("rail-now-divider"),
    screen.getByTestId("rail-tab-badge-all"),
  ].flatMap(readingsOf);
}

function band(kind: ReplayIdleBand["kind"]): ReplayIdleBand {
  return { startMs: 1000, endMs: 73000, kind: kind, fidelity: "exact" };
}

// Every toast and chip a skipped stretch is named by.
function bandWords(language: string): Array<string> {
  const translator: Translator = translatorIn(language);

  return (["idle", "paused", "background-tab"] as const).flatMap(
    (kind: ReplayIdleBand["kind"]): Array<string> => {
      return [
        describeIdleSkip(band(kind), translator),
        describeIdleBandChip(band(kind), translator),
      ].map(withoutIsolateMarks);
    },
  );
}

/* ---- Every figure, in each language. ---- */

interface Surface {
  name: string;
  figures: (language: string) => Array<string>;
}

const SURFACES: ReadonlyArray<Surface> = [
  {
    name: "the transport: clock, seek buttons, speed and its menu",
    figures: (): Array<string> => {
      renderControls();
      return controlsFigures();
    },
  },
  {
    name: "the header's wall clock and offset",
    figures: (): Array<string> => {
      render(<ReplayHeader {...makeHeaderProps()} />);
      return headerFigures();
    },
  },
  {
    name: "the timeline: slider, cluster, markers, hover time and preview",
    figures: (language: string): Array<string> => {
      return timelineFigures(renderTimeline(language));
    },
  },
  {
    name: "the stage's viewport chip",
    figures: (): Array<string> => {
      renderOverlays();
      return readingsOf(screen.getByTestId("replay-viewport-chip"));
    },
  },
  {
    name: "the rail: each row's offset, the now marker and the tab count",
    figures: (): Array<string> => {
      renderRail();
      return railFigures();
    },
  },
  {
    name: "the skipped stretches' toasts and chips",
    figures: (language: string): Array<string> => {
      return bandWords(language);
    },
  },
];

describe("in Persian, every figure the player draws is in Persian digits", () => {
  test.each(
    SURFACES.map((surface: Surface): [string, Surface] => {
      return [surface.name, surface];
    }),
  )("%s", async (_name: string, surface: Surface) => {
    await readIn("fa");

    const figures: Array<string> = surface.figures("fa");
    const latin: Array<string> = figures.filter((text: string): boolean => {
      return LATIN_DIGIT.test(text);
    });

    expect(figures.length).toBeGreaterThan(0);
    expect(latin).toEqual([]);
    expect(
      figures.some((text: string): boolean => {
        return PERSIAN_DIGIT.test(text);
      }),
    ).toBe(true);
  });

  test("the check would find a Latin digit", () => {
    expect(LATIN_DIGIT.test("اکنون 0:01")).toBe(true);
    expect(LATIN_DIGIT.test("اکنون ۰:۰۱")).toBe(false);
  });
});

describe("every other language keeps Latin digits", () => {
  test.each(
    ["ar", "de", "en"].flatMap((language: string) => {
      return SURFACES.map((surface: Surface) => {
        return [language, surface.name, surface] as [string, string, Surface];
      });
    }),
  )("%s: %s", async (language: string, _name: string, surface: Surface) => {
    await readIn(language);

    const figures: Array<string> = surface.figures(language);

    expect(figures.length).toBeGreaterThan(0);

    for (const text of figures) {
      expect({ text, persian: PERSIAN_DIGIT.test(text) }).toEqual({
        text,
        persian: false,
      });
      expect({ text, arabicIndic: ARABIC_INDIC_DIGIT.test(text) }).toEqual({
        text,
        arabicIndic: false,
      });
    }

    expect(
      figures.some((text: string): boolean => {
        return LATIN_DIGIT.test(text);
      }),
    ).toBe(true);
  });
});

describe("the transport, figure by figure", () => {
  test("Persian: the paused clock with its tenth, Persian's decimal sign, left to right", async () => {
    await readIn("fa");
    renderControls();

    const clock: HTMLElement = screen.getByTestId("replay-time");

    expect(clock).toHaveTextContent("۰:۰۰٫۷ / ۰:۳۰");
    expect(clock).toHaveAttribute("dir", "ltr");
  });

  test("Persian: the playing clock has no tenth", async () => {
    await readIn("fa");
    renderControls({ phase: "playing", currentTimeMs: 1000 });

    expect(screen.getByTestId("replay-time")).toHaveTextContent("۰:۰۱ / ۰:۳۰");
  });

  test("Persian: the seek buttons say how far they jump, in Persian", async () => {
    await readIn("fa");
    renderControls();

    expect(screen.getByTestId("replay-seek-back")).toHaveTextContent(
      "۱۰ ثانیه",
    );
    expect(screen.getByTestId("replay-seek-forward")).toHaveTextContent(
      "۱۰ ثانیه",
    );
    expect(screen.getByTestId("replay-seek-back")).toHaveAttribute(
      "aria-label",
      "۱۰ ثانیه عقب (J)",
    );
  });

  test("Persian: the speed, on the button, in its name and in the menu", async () => {
    await readIn("fa");
    renderControls();

    const speed: HTMLElement = screen.getByTestId("replay-speed");

    expect(speed).toHaveTextContent("۱٫۵x");
    expect(withoutIsolateMarks(speed.getAttribute("aria-label") || "")).toBe(
      "سرعت پخش ۱٫۵x",
    );

    fireEvent.click(speed);

    expect(screen.getByTestId("replay-speed-option-0.25")).toHaveTextContent(
      "۰٫۲۵x",
    );
    expect(screen.getByTestId("replay-speed-option-8")).toHaveTextContent("۸x");
  });

  test("Persian: the seek pill names its target in Persian digits", async () => {
    jest.useFakeTimers();
    await readIn("fa");
    renderControls({ phase: "seeking", pendingSeekMs: 72000 });

    act(() => {
      jest.advanceTimersByTime(REPLAY_BUFFERING_GRACE_MS + 50);
    });

    expect(
      withoutIsolateMarks(
        screen.getByTestId("replay-buffering-pill").textContent || "",
      ),
    ).toContain("در حال رفتن به ۱:۱۲");
  });

  test("German: its own short form of the jump, and its decimal comma", async () => {
    await readIn("de");
    renderControls();

    expect(screen.getByTestId("replay-seek-back")).toHaveTextContent("10 Sek.");
    expect(screen.getByTestId("replay-speed")).toHaveTextContent("1,5x");
    expect(screen.getByTestId("replay-time")).toHaveTextContent(
      "0:00.7 / 0:30",
    );
  });

  test("Arabic: Latin digits and a point, its own short form of the jump", async () => {
    await readIn("ar");
    renderControls();

    expect(screen.getByTestId("replay-seek-back")).toHaveTextContent("10 ث");
    expect(screen.getByTestId("replay-speed")).toHaveTextContent("1.5x");
    expect(screen.getByTestId("replay-time")).toHaveTextContent(
      "0:00.7 / 0:30",
    );
  });

  test("English reads exactly as it did", () => {
    renderControls();

    expect(screen.getByTestId("replay-seek-back")).toHaveTextContent(/^10s$/);
    expect(screen.getByTestId("replay-seek-forward")).toHaveTextContent(
      /^10s$/,
    );
    expect(screen.getByTestId("replay-speed")).toHaveTextContent(/^1\.5x$/);
    expect(screen.getByTestId("replay-time")).toHaveTextContent(
      "0:00.7 / 0:30",
    );
  });
});

describe("the header, the stage and the rail, figure by figure", () => {
  test("Persian: the wall clock and the playhead over the length, left to right", async () => {
    await readIn("fa");
    render(<ReplayHeader {...makeHeaderProps()} />);

    expect(screen.getByTestId("replay-header-wall-clock")).toHaveTextContent(
      "۱۳:۴۷:۵۳",
    );

    const offset: HTMLElement = screen.getByTestId("replay-header-offset");

    expect(offset).toHaveTextContent("۰:۴۱ / ۴:۱۲");
    expect(offset).toHaveAttribute("dir", "ltr");
  });

  test("English: the header reads as it did", () => {
    render(<ReplayHeader {...makeHeaderProps()} />);

    expect(screen.getByTestId("replay-header-wall-clock")).toHaveTextContent(
      "13:47:53",
    );
    expect(screen.getByTestId("replay-header-offset")).toHaveTextContent(
      "0:41 / 4:12",
    );
  });

  test("Persian: the viewport chip, its arrow left to right", async () => {
    await readIn("fa");
    renderOverlays();

    const chip: HTMLElement = screen.getByTestId("replay-viewport-chip");

    expect(chip).toHaveTextContent("۱۲۰۰x۷۶۰-> ۴۳٪");
    expect(chip).toHaveAttribute("dir", "ltr");
  });

  test("German writes its percent as German does; English as it did", async () => {
    renderOverlays();

    expect(screen.getByTestId("replay-viewport-chip")).toHaveTextContent(
      "1200x760-> 43%",
    );

    cleanup();
    await readIn("de");
    renderOverlays();

    expect(screen.getByTestId("replay-viewport-chip")).toHaveTextContent(
      "1200x760-> 43 %",
    );
  });

  test("Persian: each rail row's moment, with its tenth, and the now marker", async () => {
    await readIn("fa");
    renderRail();

    expect(
      screen
        .getAllByTestId("rail-row-time")
        .slice(0, 3)
        .map((element: HTMLElement): string => {
          return element.textContent || "";
        }),
    ).toEqual(["۰:۰۲٫۰", "۰:۰۳٫۰", "۰:۰۴٫۰"]);
    expect(
      withoutIsolateMarks(
        screen.getByTestId("rail-now-divider").textContent || "",
      ),
    ).toBe("اکنون ۰:۰۳٫۰");
    expect(screen.getByTestId("rail-tab-badge-all")).toHaveTextContent("۱۲");
  });

  test("Persian: a row's tooltip says its one second early in Persian too", async () => {
    await readIn("fa");
    renderRail();

    const row: HTMLElement = screen.getAllByTestId(
      "rail-row",
    )[0] as HTMLElement;
    const body: HTMLElement = row.querySelector(
      "[data-rail-row-body='true']",
    ) as HTMLElement;

    expect(withoutIsolateMarks(body.getAttribute("title") || "")).toBe(
      "رفتن به ۰:۰۲٫۰ (۱\u00A0ثانیه زودتر) و باز کردن جزئیات",
    );
  });

  test("Persian: a row repeated twelve times counts its repeats in Persian digits", async () => {
    await readIn("fa");
    renderRail({ signals: railSignals(true) });

    const row: HTMLElement = screen.getAllByTestId(
      "rail-row",
    )[0] as HTMLElement;
    const body: HTMLElement = row.querySelector(
      "[data-rail-row-body='true']",
    ) as HTMLElement;

    expect(row).toHaveTextContent("×۱۲");
    expect(row.textContent).not.toMatch(LATIN_DIGIT);
    // In Persian words too, not "repeated ۱۲ times" (#6516).
    expect(
      withoutIsolateMarks(body.getAttribute("aria-label") || ""),
    ).toContain("۱۲ بار تکرار شد");
    expect(body.getAttribute("aria-label")).not.toContain("repeated");
    expect(body.getAttribute("aria-label")).not.toMatch(LATIN_DIGIT);
  });

  test("English: the repeats as they always read", () => {
    renderRail({ signals: railSignals(true) });

    expect(screen.getAllByTestId("rail-row")[0]).toHaveTextContent("×12");
  });

  test("Persian, playing: the now marker drops its tenth", async () => {
    await readIn("fa");
    renderRail({ isPlaying: true, currentTimeMs: 3400 });

    expect(
      withoutIsolateMarks(
        screen.getByTestId("rail-now-divider").textContent || "",
      ),
    ).toBe("اکنون ۰:۰۳");
  });

  test("English: the rail reads as it did", () => {
    renderRail();

    expect(screen.getAllByTestId("rail-row-time")[0]).toHaveTextContent(
      "0:02.0",
    );
    expect(screen.getByTestId("rail-now-divider")).toHaveTextContent(
      "now 0:03.0",
    );
  });
});

describe("the timeline, figure by figure", () => {
  test("Persian: the hover time, its wall clock, and the nearby row's time", async () => {
    await readIn("fa");
    hover(renderTimeline("fa"));

    expect(screen.getByTestId("timeline-hover-time")).toHaveTextContent(
      "۵:۰۰٫۰۱۳:۵۲:۱۲",
    );
    expect(
      screen.getByTestId("timeline-hover-preview-signal"),
    ).toHaveTextContent("۵:۰۱/checkout");
  });

  test("Persian: the slider's position, the cluster's count and its span", async () => {
    await readIn("fa");
    const track: HTMLElement = renderTimeline("fa");

    expect(
      withoutIsolateMarks(track.getAttribute("aria-valuetext") || ""),
    ).toBe("۱:۰۵ از ۱۰:۰۰");

    const pill: HTMLElement = screen.getByTestId("timeline-marker-cluster");

    expect(pill).toHaveTextContent("۷");
    expect(
      withoutIsolateMarks(pill.getAttribute("aria-label") || ""),
    ).toContain("۰:۰۱");
    expect(
      withoutIsolateMarks(pill.getAttribute("aria-label") || ""),
    ).toContain("۰:۰۴");
  });

  test("Persian: an estimate's marker, worded in Persian, its time and length in Persian digits", () => {
    const coarse: ReplayTimelineMarker | undefined = timelineMarkers("fa").find(
      (marker: ReplayTimelineMarker): boolean => {
        return marker.fidelity === "coarse";
      },
    );

    expect(withoutIsolateMarks(coarse?.title || "")).toBe(
      "~۱:۰۷ ۲ خطا در این قطعه به طول ۱۵\u00A0ثانیه (تقریبی، قطعه هنوز بارگذاری نشده)",
    );
  });

  test("Persian: a notice's time, its own words as given", () => {
    const notice: ReplayTimelineMarker | undefined = timelineMarkers("fa").find(
      (marker: ReplayTimelineMarker): boolean => {
        return marker.kind === "notice";
      },
    );

    expect(notice?.title).toBe("۷:۳۰ Footage resumes");
  });

  test("English: the timeline reads as it did", () => {
    hover(renderTimeline("en"));

    expect(screen.getByTestId("timeline-hover-time")).toHaveTextContent(
      "5:00.013:52:12",
    );
    expect(screen.getByTestId("timeline-track")).toHaveAttribute(
      "aria-valuetext",
      "1:05 of 10:00",
    );
    expect(screen.getByTestId("timeline-marker-cluster")).toHaveTextContent(
      "7",
    );

    const coarse: ReplayTimelineMarker | undefined = timelineMarkers("en").find(
      (marker: ReplayTimelineMarker): boolean => {
        return marker.fidelity === "coarse";
      },
    );

    expect(coarse?.title).toBe(
      "~1:07 2 errors in this 15s chunk (approximate, chunk not loaded yet)",
    );
  });
});

describe("a skipped stretch is named with its length in the sentence's language", () => {
  test("Persian: the idle toast", () => {
    expect(
      withoutIsolateMarks(describeIdleSkip(band("idle"), translatorIn("fa"))),
    ).not.toMatch(LATIN_DIGIT);
  });

  test("German: its own units, not the English short form", () => {
    expect(describeIdleBandChip(band("idle"), translatorIn("de"))).toContain(
      "1\u00A0Min., 12\u00A0Sek.",
    );
  });

  test("English: as it always read", () => {
    expect(describeIdleSkip(band("idle"), translatorIn("en"))).toBe(
      "Skipped 1m 12s idle",
    );
  });
});

/* ---- A rail row's detail: when it happened, and for how long. ---- */

function renderDetail(
  signal: ReplaySignal,
  repeat?: { count: number; lastOffsetMs: number },
): void {
  const props: ReplayRailDetailProps = {
    signal: signal,
    signals: [signal],
    repeat: repeat,
    links: {
      traceView: (): null => {
        return null;
      },
      spanView: (): null => {
        return null;
      },
      exceptionGroup: (): null => {
        return null;
      },
      logsAtMoment: (): null => {
        return null;
      },
    },
    onSeek: noop,
    onSelectSignal: noop,
    onClose: noop,
    startTimeUnixMs: START_UNIX_MS,
  } as ReplayRailDetailProps;

  render(
    <MemoryRouter>
      <ReplayRailDetail {...props} />
    </MemoryRouter>,
  );
}

// Input came back 28:30 in, after a pause of 23 minutes.
function resumedSignal(): ReplaySignal {
  return fromTimelineEvent(
    {
      id: "rec:4:9",
      kind: "idle-pause",
      chunkIndex: 4,
      offsetMs: 1_710_000,
      idlePauseEdge: "resumed",
      pausedAtUnixMs: START_UNIX_MS + 330_000,
      resumedAtUnixMs: START_UNIX_MS + 1_710_000,
      pausedAtOffsetMs: 330_000,
    },
    { startTimeUnixMs: START_UNIX_MS },
  );
}

function detailMoment(): string {
  return withoutIsolateMarks(
    screen.getByTestId("rail-detail-moment").textContent || "",
  );
}

describe("a rail row's detail, in the reader's digits", () => {
  test("Persian: its moment, wall clock and repeats", async () => {
    await readIn("fa");
    renderDetail(railSignals()[0] as ReplaySignal, {
      count: 3,
      lastOffsetMs: 5000,
    });

    const moment: string = detailMoment();

    expect(moment).not.toMatch(LATIN_DIGIT);
    expect(moment).toContain("۰:۰۲٫۰");
    expect(moment).toContain("۱۳:۴۷:۱۴");
    expect(moment).toContain("۰:۰۵");
    expect(moment).toContain("۳");
  });

  test("Persian: how long the recorder was paused", async () => {
    await readIn("fa");
    renderDetail(resumedSignal());

    const detail: string = withoutIsolateMarks(
      screen.getByTestId("rail-detail").textContent || "",
    );

    expect(detail).not.toMatch(LATIN_DIGIT);
    expect(detail).toContain("۲۳");
  });

  test("Arabic and German: Latin digits", async () => {
    for (const language of ["ar", "de"]) {
      await readIn(language);
      renderDetail(railSignals()[0] as ReplaySignal, {
        count: 3,
        lastOffsetMs: 5000,
      });

      const moment: string = detailMoment();

      expect({ language, moment, persian: PERSIAN_DIGIT.test(moment) }).toEqual(
        { language, moment, persian: false },
      );
      expect(moment).toContain("0:02.0");
      expect(moment).toContain("13:47:14");
      cleanup();
    }
  });

  test("English: as it always read", () => {
    renderDetail(railSignals()[0] as ReplaySignal, {
      count: 3,
      lastOffsetMs: 5000,
    });

    expect(detailMoment()).toBe(
      "at 0:02.0 (13:47:14) · repeated 3 times until 0:05",
    );
  });
});
