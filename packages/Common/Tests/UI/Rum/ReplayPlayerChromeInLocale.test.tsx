import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to this project's single copy for every
 * importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The player's chrome in the reader's language (#6369): the header, the
 * transport, the timeline, the browser-tab switcher, the person's other
 * sessions, the pin, the stage's name, the shortcuts sheet and the link
 * into a recording. Each drew its words as written, so a German reader saw
 * an English player around a German Dashboard.
 *
 * Every lookup is marked here (⟦...⟧), as a reader's language would come
 * back worded, so a test can tell what was looked up - and looked up whole,
 * its values in place - from what was drawn as written. ReplayToolButton
 * looks up every label it is handed, so a sentence a component has already
 * worded (a count, a value in it) comes out marked twice: in a real
 * language the worded sentence is no key, and passes through unchanged.
 */

jest.mock("Common/UI/Utils/Translation", () => {
  const mark: (value: string) => string = (value: string): string => {
    return `⟦${value}⟧`;
  };

  return {
    __esModule: true,
    default: (): {
      translateString: (value: string | undefined) => string | undefined;
      translateValue: (value: unknown) => unknown;
      language: string;
    } => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value === undefined || value === "" ? value : mark(value);
        },
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" && value !== ""
            ? mark(value)
            : value;
        },
        language: "de",
      };
    },
  };
});

/* The clipboard as the test says it is: writable, or refusing. */
let mockIsClipboardWritable: boolean = true;

jest.mock("Common/UI/Utils/Clipboard", () => {
  return {
    __esModule: true,
    default: {
      copyToClipboard: async (): Promise<boolean> => {
        return mockIsClipboardWritable;
      },
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: async (): Promise<unknown> => {
        return {};
      },
      deleteItem: (...args: Array<unknown>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

import ReplayHeader, {
  ReplayHeaderProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayHeader";
import ReplayControls, {
  ReplayControlsProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayControls";
import ReplayTimeline from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeline";
import ReplayTabSwitcher from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabSwitcher";
import ReplayUserSessionsMenu, {
  ReplayUserSessionsMenuProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessionsMenu";
import ReplayPinControl, {
  PIN_PENDING_COPY,
  PIN_UNPINNED_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPinControl";
import ReplayLink from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayLink";
import ReplayStage, {
  REPLAY_PHASE_WORDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayStage";
import ReplayShortcutsModal, {
  toKeyboardShortcutGroups,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayShortcutsModal";
import { REPLAY_SHORTCUT_GROUPS } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayKeyboardMap";
import { ReplaySignal } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  ReplayTimelineChunkInput,
  buildExactMarkers,
  buildTrackBands,
  describeTrackBandLabel,
  formatReplayDurationInLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineMath";
import { ReplayTabSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabs";
import {
  ReplayUserSessionItem,
  ReplayUserSessionsState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessions";
import {
  ReplayEngine,
  ReplayEngineDiagnostics,
  ReplayEngineSnapshot,
  ReplayPhase,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";

/* The words the components come out with, built the way they build them. */
const MARKED: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const START_UNIX_MS: number = new Date(2026, 8, 4, 10, 12, 41, 200).getTime();
const DURATION_MS: number = 600000;

function noop(): void {
  /* Handlers these assertions do not exercise. */
}

/*
 * Every piece of text a reader sees or hears in `root` - its text and its
 * elements' titles, accessible names and placeholders - that has English
 * words in it and came out of no lookup: neither marked nor one of the
 * values the recording or the test supplied.
 */
const WORDS: RegExp = /[A-Za-z]{2,}/;
const SHOWN_ATTRIBUTES: ReadonlyArray<string> = [
  "title",
  "aria-label",
  "aria-valuetext",
  "placeholder",
];

function textsNotLookedUp(
  root: HTMLElement,
  data: ReadonlyArray<string>,
): Array<string> {
  const texts: Array<string> = [];
  const walker: TreeWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );

  let node: Node | null = walker.nextNode();

  while (node) {
    texts.push(node.textContent || "");
    node = walker.nextNode();
  }

  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of SHOWN_ATTRIBUTES) {
      texts.push(element.getAttribute(attribute) || "");
    }
  }

  return texts
    .map((text: string): string => {
      return text.trim();
    })
    .filter((text: string): boolean => {
      return (
        WORDS.test(text) &&
        !text.includes("⟦") &&
        !text.includes("⟧") &&
        !data.includes(text)
      );
    });
}

afterEach(() => {
  mockIsClipboardWritable = true;
  jest.useRealTimers();
});

/* ---- The header. ---- */

function makeUserSession(
  sessionId: string,
  startTimeUnixMs: number,
): ReplayUserSessionItem {
  return {
    sessionId: sessionId,
    startTimeUnixMs: startTimeUnixMs,
    durationMs: 60000,
    entryUrl: "https://app.acme.com/checkout",
    browserName: "Chrome",
    deviceType: "desktop",
    hasError: false,
    errorCount: 0,
    isFinalized: true,
    identifiedUserKey: "key",
    visitorId: "7f3a2b1c9d8e4f5a",
    identifiedUserLabel: "jane@acme.com",
  };
}

function makeHeaderProps(
  overrides?: Partial<ReplayHeaderProps>,
): ReplayHeaderProps {
  return {
    sessionId: SESSION_ID,
    backHref: "/dashboard/p/rum/a/session-replay",
    onBack: noop,
    identity: { label: "jane@acme.com", traits: { plan: "pro", seat: "2" } },
    facts: [
      { label: "Browser", value: "Chrome 126" },
      { label: "Viewport", value: "1440x900" },
    ],
    startTimeUnixMs: START_UNIX_MS,
    currentTimeMs: 41200,
    durationMs: 252000,
    isLive: true,
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
    ...overrides,
  };
}

describe("ReplayHeader in the reader's language", () => {
  it("looks up every word it draws, and leaves only the recording's own as written", () => {
    render(
      <ReplayHeader
        {...makeHeaderProps({
          userSessions: {
            status: "ready",
            kind: "identified",
            sessions: [
              makeUserSession("newer", START_UNIX_MS + 3600000),
              makeUserSession(SESSION_ID, START_UNIX_MS),
              makeUserSession("older", START_UNIX_MS - 3600000),
            ],
            currentSessionId: SESSION_ID,
            isTruncated: false,
          },
          onOpenUserSession: noop,
        })}
      />,
    );

    const header: HTMLElement = screen.getByTestId("replay-header");

    expect(
      within(header).getByRole("heading", { name: "⟦Session recording⟧" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("replay-back-link")).toHaveTextContent(
      "⟦All recordings⟧",
    );
    expect(screen.getByTestId("replay-back-link")).toHaveAttribute(
      "title",
      "⟦Back to the session list⟧",
    );
    expect(within(header).getByText("⟦User and device⟧")).toBeInTheDocument();
    expect(within(header).getByText("⟦Playback position⟧")).toBeInTheDocument();

    /* A count is one sentence in both its forms. */
    expect(screen.getByTestId("replay-header-traits")).toHaveTextContent(
      "⟦2 traits⟧",
    );
    expect(screen.getByTestId("replay-live-pill")).toHaveTextContent("⟦Live⟧");
    expect(screen.getByTestId("replay-live-pill")).toHaveAttribute(
      "title",
      "⟦Still being recorded; new footage is added as it arrives⟧",
    );
    expect(
      screen.getByRole("group", { name: "⟦Session recording controls⟧" }),
    ).toBeInTheDocument();

    /* A fact's label is the player's word, its value the recording's. */
    expect(screen.getAllByTestId("replay-header-fact")[1]).toHaveAttribute(
      "title",
      "⟦⟦Viewport⟧: 1440x900⟧",
    );

    /*
     * "Recorded {{time}}" and "Session {{id}}" are whole sentences, so a
     * language moves the date and the id where its grammar puts them.
     */
    const startedAt: HTMLElement = screen.getByTestId(
      "replay-header-started-at",
    );

    expect(startedAt.parentElement?.textContent).toBe(
      `⟦Recorded ${startedAt.textContent}⟧`,
    );
    expect(
      screen.getByTestId("replay-copy-session-id").parentElement?.textContent,
    ).toBe("⟦Session a1b2c3d4⟧");
    expect(screen.getByTestId("replay-copy-session-id")).toHaveAttribute(
      "aria-label",
      "⟦Copy the session id⟧",
    );
    expect(screen.getByTestId("replay-header-wall-clock")).toHaveAttribute(
      "title",
      "⟦Wall-clock time at the playhead⟧",
    );

    /* A literal handed to a ReplayToolButton is looked up once, by it. */
    expect(screen.getByTestId("replay-copy-link")).toHaveTextContent(
      /^⟦Copy link⟧$/,
    );
    expect(screen.getByTestId("replay-user-session-older")).toHaveAttribute(
      "aria-label",
      "⟦Older session⟧",
    );

    expect(
      textsNotLookedUp(header, [
        "jane@acme.com",
        "Chrome 126",
        "1440x900",
        "Chrome 126 · 1440x900",
        startedAt.textContent || "",
      ]),
    ).toEqual([]);
  });

  /*
   * With no start time the header says the same sentence, with what is
   * known of the time in the date's place: never a lone "Recorded" key,
   * which every screen's "Recorded" shares (an incident measurement's
   * status among them).
   */
  it("says a recording with no start time as the same whole sentence", () => {
    render(<ReplayHeader {...makeHeaderProps({ startTimeUnixMs: null })} />);

    const startedAt: HTMLElement = screen.getByTestId(
      "replay-header-started-at",
    );

    expect(startedAt).toHaveTextContent("⟦Start time unavailable⟧");
    expect(startedAt.parentElement?.textContent).toBe(
      "⟦Recorded ⟦Start time unavailable⟧⟧",
    );
    // No lone "Recorded" key: the word is drawn inside the sentence's own.
    expect(screen.queryByText("⟦Recorded⟧")).not.toBeInTheDocument();
  });

  it("words the identity it could not show, and an anonymous visitor's short id", () => {
    const { rerender } = render(
      <ReplayHeader {...makeHeaderProps({ identity: { label: null } })} />,
    );

    expect(screen.getByTestId("replay-header-user")).toHaveTextContent(
      "⟦Identity hidden⟧",
    );
    // The grant that shows it, by the roles screen's title, filled in place (#7096).
    expect(screen.getByTestId("replay-header-user")).toHaveAttribute(
      "title",
      '⟦Your role cannot read end-user identity. Ask a project admin for the "Watch Session Replays" permission.⟧',
    );

    rerender(
      <ReplayHeader
        {...makeHeaderProps({
          identity: { label: "", visitorId: "7f3a2b1c9d8e4f5a" },
        })}
      />,
    );

    expect(screen.getByTestId("replay-header-user")).toHaveTextContent(
      "⟦Visitor 7f3a2b⟧",
    );

    rerender(
      <ReplayHeader {...makeHeaderProps({ identity: { label: "" } })} />,
    );

    expect(screen.getByTestId("replay-header-user")).toHaveTextContent(
      "⟦Anonymous⟧",
    );
    expect(screen.getByTestId("replay-header-user")).toHaveAttribute(
      "title",
      "⟦The page did not call OneUptimeReplay.identify().⟧",
    );
  });

  it("words every state of the other-sessions lookup", () => {
    const states: Array<[ReplayUserSessionsState, string, string]> = [
      [
        {
          status: "ready",
          kind: "none",
          sessions: [],
          currentSessionId: SESSION_ID,
          isTruncated: false,
        },
        "replay-user-sessions-unavailable",
        "⟦Not linked to other sessions⟧",
      ],
      [
        {
          status: "loading",
          kind: "identified",
          sessions: [],
          currentSessionId: SESSION_ID,
          isTruncated: false,
        },
        "replay-user-sessions-loading",
        "⟦Finding other sessions…⟧",
      ],
      [
        {
          status: "error",
          kind: "identified",
          sessions: [],
          currentSessionId: SESSION_ID,
          isTruncated: false,
        },
        "replay-user-sessions-error",
        "⟦Couldn't load other sessions⟧",
      ],
      [
        {
          status: "ready",
          kind: "identified",
          sessions: [makeUserSession(SESSION_ID, START_UNIX_MS)],
          currentSessionId: SESSION_ID,
          isTruncated: false,
        },
        "replay-user-sessions-only",
        "⟦Only session in 30 days⟧",
      ],
    ];

    for (const [userSessions, testId, text] of states) {
      const { unmount } = render(
        <ReplayHeader {...makeHeaderProps({ userSessions: userSessions })} />,
      );

      expect(screen.getByTestId(testId)).toHaveTextContent(text);
      unmount();
    }
  });

  it("announces a copy, and offers the value to copy by hand, in the reader's words", async () => {
    render(<ReplayHeader {...makeHeaderProps()} />);

    fireEvent.click(screen.getByTestId("replay-copy-session-id"));

    await waitFor(() => {
      expect(screen.getByTestId("replay-copy-link-status")).toHaveTextContent(
        "⟦Session id copied to the clipboard.⟧",
      );
    });

    mockIsClipboardWritable = false;
    fireEvent.click(screen.getByTestId("replay-copy-link"));

    const fallback: HTMLElement = await screen.findByTestId(
      "replay-copy-link-fallback",
    );

    expect(fallback).toHaveTextContent(
      "⟦The clipboard is not available here; copy the link by hand:⟧",
    );
    expect(
      within(fallback).getByLabelText("⟦Link to this moment⟧"),
    ).toHaveValue("https://dash.example/replay");
    expect(
      within(fallback).getByRole("button", { name: "⟦Close⟧" }),
    ).toBeInTheDocument();
  });
});

/* ---- The transport. ---- */

function makeControlsProps(
  overrides?: Partial<ReplayControlsProps>,
): ReplayControlsProps {
  return {
    phase: "paused",
    currentTimeMs: 12000,
    durationMs: DURATION_MS,
    speed: 1,
    isSkipInactiveEnabled: false,
    hasPrevError: false,
    hasNextError: true,
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
}

describe("ReplayControls in the reader's language", () => {
  it("names the play button, its groups and the switch it draws itself", () => {
    render(<ReplayControls {...makeControlsProps()} />);

    expect(screen.getByTestId("replay-play-pause")).toHaveAttribute(
      "aria-label",
      "⟦Play (Space)⟧",
    );
    expect(
      screen.getByRole("group", { name: "⟦Session playback⟧" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "⟦Playback controls⟧" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("replay-skip-idle")).toHaveTextContent(
      /^⟦Skip idle⟧$/,
    );
    expect(screen.getByTestId("replay-skip-idle")).toHaveAttribute(
      "title",
      "⟦Jump past stretches with no user input. Each skip is announced and the idle stretch is drawn on the track. Stretches where the recording paused are always skipped.⟧",
    );
    expect(screen.getByTestId("replay-seek-back")).toHaveAttribute(
      "aria-label",
      "⟦Back 10 seconds (J)⟧",
    );

    /* The speed is a value of the sentence that names the button. */
    expect(
      screen.getByTestId("replay-speed").getAttribute("aria-label"),
    ).toContain("⟦Playback speed 1x⟧");

    fireEvent.click(screen.getByTestId("replay-speed"));

    expect(screen.getByTestId("replay-speed-menu")).toHaveAttribute(
      "aria-label",
      "⟦Playback speed⟧",
    );

    expect(textsNotLookedUp(screen.getByTestId("replay-controls"), [])).toEqual(
      [],
    );
  });

  it("words the waits: the first footage, a seek to its time, and the long wait", () => {
    jest.useFakeTimers();

    const { rerender } = render(
      <ReplayControls {...makeControlsProps({ phase: "loading" })} />,
    );

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(screen.getByTestId("replay-play-pause")).toHaveAttribute(
      "aria-label",
      "⟦Loading footage⟧",
    );
    expect(screen.getByTestId("replay-buffering-pill")).toHaveTextContent(
      "⟦Loading the first footage⟧",
    );

    rerender(
      <ReplayControls
        {...makeControlsProps({ phase: "seeking", pendingSeekMs: 72000 })}
      />,
    );

    expect(screen.getByTestId("replay-buffering-pill")).toHaveTextContent(
      "⟦Seeking to 1:12⟧",
    );

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(screen.getByTestId("replay-buffering-pill")).toHaveTextContent(
      "⟦Still loading⟧",
    );
  });
});

/* ---- The timeline. ---- */

function chunk(chunkIndex: number, startMs: number): ReplayTimelineChunkInput {
  return {
    chunkIndex: chunkIndex,
    chunkStartOffsetMs: startMs,
    chunkEndOffsetMs: startMs + 15000,
    eventCount: 40,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
  };
}

function networkSignal(index: number): ReplaySignal {
  return {
    id: `rec:0:${index}`,
    kind: "network",
    source: "recording",
    offsetMs: 1000 + index * 500,
    severity: "warn",
    title: `GET 404 /poll/${index}`,
    links: {},
    detail: { status: 404 },
  };
}

describe("ReplayTimeline in the reader's language", () => {
  it("names every band, lane, legend entry and the slider in the reader's words", () => {
    render(
      <ReplayTimeline
        durationMs={DURATION_MS}
        currentTimeMs={65000}
        bands={buildTrackBands({
          chunks: [chunk(0, 0), chunk(8, 120000)],
          gaps: [{ fromIndex: 0, toIndex: 8, missingMs: 18000 }],
          loadedChunkIndexes: [0],
          idleBands: [
            {
              startMs: 200000,
              endMs: 260000,
              kind: "idle",
              fidelity: "coarse",
            },
            {
              startMs: 300000,
              endMs: 360000,
              kind: "paused",
              fidelity: "exact",
            },
            {
              startMs: 400000,
              endMs: 460000,
              kind: "background-tab",
              fidelity: "exact",
            },
          ],
          durationMs: DURATION_MS,
        })}
        activity={[
          {
            chunkIndex: 0,
            startMs: 0,
            endMs: 15000,
            intensity: 1,
            isMeasured: true,
          },
        ]}
        markers={buildExactMarkers(
          Array.from(
            { length: 7 },
            (_unused: unknown, index: number): ReplaySignal => {
              return networkSignal(index);
            },
          ),
          MARKED,
        )}
        onSeek={noop}
      />,
    );

    const minute: string = formatReplayDurationInLanguage(60000, MARKED);
    const gapLabel: string = describeTrackBandLabel("gap", 18000, MARKED);
    const gap: HTMLElement = screen.getByTestId("timeline-gap-band");

    /* The label in the reader's language, inside a name in the same one. */
    expect(gapLabel).toBe(
      `⟦${formatReplayDurationInLanguage(18000, MARKED)} missing⟧`,
    );
    expect(gap).toHaveTextContent(gapLabel);
    expect(gap).toHaveAttribute("aria-label", `⟦Recording gap: ${gapLabel}⟧`);

    const [idle, background] = screen.getAllByTestId("timeline-idle-band");

    expect(idle).toHaveAttribute(
      "aria-label",
      `⟦Idle: ⟦${minute} idle⟧ (estimated until the chunk loads)⟧`,
    );
    expect(background).toHaveAttribute(
      "aria-label",
      `⟦Tab in background: ⟦tab in background ${minute}⟧⟧`,
    );
    expect(screen.getByTestId("timeline-paused-band")).toHaveAttribute(
      "aria-label",
      `⟦Recording paused while the page was idle: ⟦${minute} paused⟧⟧`,
    );

    for (const lane of [
      "⟦Recording⟧",
      "⟦Errors⟧",
      "⟦Network⟧",
      "⟦Nav / clicks⟧",
    ]) {
      expect(screen.getByText(lane)).toBeInTheDocument();
    }

    const legend: HTMLElement = screen.getByTestId("timeline-legend");

    for (const entry of [
      "⟦Loaded⟧",
      "⟦Not yet loaded⟧",
      "⟦Gap⟧",
      "⟦Idle⟧",
      "⟦Tab in background⟧",
      "⟦Recording paused⟧",
      "⟦Approximate⟧",
    ]) {
      expect(legend).toHaveTextContent(entry);
    }

    const track: HTMLElement = screen.getByRole("slider", {
      name: "⟦Replay position⟧",
    });

    expect(track).toHaveAttribute("aria-valuetext", "⟦1:05 of 10:00⟧");
    expect(screen.getByText("⟦Activity⟧")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-activity")).toHaveAttribute(
      "title",
      "⟦Activity: how busy each stretch of the recording is⟧",
    );

    /* A cluster's name is one sentence, its lane named as its gutter is. */
    const pill: HTMLElement = screen.getByTestId("timeline-marker-cluster");

    expect(pill).toHaveAttribute(
      "aria-label",
      "⟦7 ⟦Network⟧ markers from 0:01 to 0:04⟧",
    );
    expect((pill.getAttribute("title") || "").split("\n")[5]).toBe(
      "⟦and 2 more⟧",
    );

    expect(textsNotLookedUp(screen.getByTestId("replay-timeline"), [])).toEqual(
      [],
    );
  });
});

/* ---- The browser-tab switcher. ---- */

function makeTab(
  index: number,
  overrides?: Partial<ReplayTabSummary>,
): ReplayTabSummary {
  return {
    tabId: `tab-${index}`,
    label: `Tab ${index}`,
    ordinal: index,
    durationMs: 30000,
    openedAtMs: (index - 1) * 20000,
    hasFootage: true,
    isActive: false,
    status: "closed",
    closedAtMs: (index - 1) * 20000 + 30000,
    firstUrl: `https://app.acme.com/page-${index}`,
    lastUrl: `https://app.acme.com/page-${index}`,
    pageCount: 1,
    errorCount: 0,
    frustrationCount: 0,
    ...overrides,
  };
}

/* Eight tabs: two still open, the watched one closed, two with counts. */
function makeTabs(): Array<ReplayTabSummary> {
  return [
    makeTab(1, { status: "open" }),
    makeTab(2, { status: "open" }),
    makeTab(3, { isActive: true }),
    makeTab(4, { errorCount: 2, frustrationCount: 3 }),
    makeTab(5),
    makeTab(6),
    makeTab(7),
    makeTab(8, { firstUrl: "", lastUrl: "" }),
  ];
}

describe("ReplayTabSwitcher in the reader's language", () => {
  it("names the tabs, counts them and words the picker whole", () => {
    render(
      <ReplayTabSwitcher
        tabs={makeTabs()}
        onSwitchTab={noop}
        sessionDurationMs={DURATION_MS}
      />,
    );

    expect(screen.getByTestId("replay-tab-summary")).toHaveTextContent(
      "⟦8 tabs⟧ · ⟦2 still open⟧ · ⟦6 closed⟧",
    );
    expect(
      screen.getByRole("tablist", { name: "⟦Browser tabs in this recording⟧" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("replay-tab-strip-divider")).toHaveTextContent(
      "⟦Closed tabs⟧",
    );

    const watched: HTMLElement = screen
      .getAllByTestId("replay-tab-pill")
      .find((pill: HTMLElement): boolean => {
        return pill.getAttribute("data-tab-id") === "tab-3";
      }) as HTMLElement;
    const thirtySeconds: string = formatReplayDurationInLanguage(30000, MARKED);

    expect(watched).toHaveTextContent(`⟦Tab 3⟧ · /page-3 · ${thirtySeconds}`);
    expect(watched).toHaveAttribute(
      "title",
      `⟦⟦⟦Tab 3⟧ (closed)⟧ · /page-3 · ⟦opened 0:40⟧ · ${thirtySeconds} — switch to this tab; the playhead stays where it is⟧`,
    );

    expect(screen.getByTestId("replay-tab-picker-button")).toHaveTextContent(
      "⟦All 8 tabs⟧",
    );

    fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

    const search: HTMLElement = screen.getByTestId("replay-tab-picker-search");

    expect(search).toHaveAttribute("aria-label", "⟦Filter tabs⟧");
    expect(search).toHaveAttribute("placeholder", "⟦Filter by page or tab⟧");
    expect(
      screen.getByRole("listbox", { name: "⟦Browser tabs⟧" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByTestId("replay-tab-group").map((group: HTMLElement) => {
        return group.textContent;
      }),
    ).toEqual(["⟦2 still open⟧", "⟦6 closed⟧"]);

    const options: Array<HTMLElement> =
      screen.getAllByTestId("replay-tab-option");
    const fourth: HTMLElement = options.find((option: HTMLElement): boolean => {
      return option.getAttribute("data-tab-id") === "tab-4";
    }) as HTMLElement;

    expect(fourth).toHaveAttribute(
      "title",
      "⟦Switch to ⟦Tab 4⟧; the playhead stays where it is⟧",
    );
    expect(
      within(fourth).getByTestId("replay-tab-option-errors"),
    ).toHaveAttribute("title", "⟦2 errors in this tab⟧");
    expect(
      within(fourth).getByTestId("replay-tab-option-frustrations"),
    ).toHaveAttribute("title", "⟦3 rage, dead or error clicks in this tab⟧");
    expect(
      within(
        options.find((option: HTMLElement): boolean => {
          return option.getAttribute("data-tab-id") === "tab-3";
        }) as HTMLElement,
      ).getByText("⟦Watching⟧"),
    ).toBeInTheDocument();
    expect(
      options.find((option: HTMLElement): boolean => {
        return option.getAttribute("data-tab-id") === "tab-8";
      }),
    ).toHaveTextContent("⟦Unknown page⟧");

    fireEvent.change(search, { target: { value: "zzz" } });

    expect(screen.getByTestId("replay-tab-picker-empty")).toHaveTextContent(
      "⟦No tab matches “zzz”⟧",
    );
  });

  it("offers to continue in the next tab by its name in the reader's language", () => {
    render(
      <ReplayTabSwitcher
        tabs={[makeTab(1, { isActive: true }), makeTab(2)]}
        onSwitchTab={noop}
        continueInTab={makeTab(2)}
        sessionDurationMs={DURATION_MS}
      />,
    );

    const chip: HTMLElement = screen.getByTestId("replay-continue-in-tab");

    expect(chip).toHaveTextContent(/^⟦Continue in ⟦Tab 2⟧⟧$/);
    expect(chip).toHaveAttribute(
      "title",
      "⟦This tab has played out; the session continues in another tab⟧",
    );
  });
});

/* ---- The person's other sessions. ---- */

const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");

function makeMenuProps(
  overrides?: Partial<ReplayUserSessionsMenuProps>,
): ReplayUserSessionsMenuProps {
  return {
    kind: "visitor",
    sessions: [
      {
        ...makeUserSession("newest", NOW - 5 * 60 * 1000),
        isFinalized: false,
        entryUrl: "",
      },
      makeUserSession(SESSION_ID, NOW - 3 * 3600000),
      {
        ...makeUserSession("ended", NOW - 26 * 3600000),
        isFinalized: false,
        hasRecordingEnded: true,
        errorCount: 2,
        hasError: true,
      },
    ],
    currentSessionId: SESSION_ID,
    onOpenUserSession: noop,
    nowUnixMs: NOW,
    ...overrides,
  };
}

describe("ReplayUserSessionsMenu in the reader's language", () => {
  it("words a visitor's sessions as whole sentences about a visitor", () => {
    render(<ReplayUserSessionsMenu {...makeMenuProps()} />);

    const trigger: HTMLElement = screen.getByTestId(
      "replay-user-sessions-button",
    );

    expect(trigger).toHaveTextContent("⟦3 sessions⟧");
    expect(trigger.getAttribute("aria-label")).toContain(
      "⟦3 sessions by this visitor; open the list⟧",
    );
    /* An English key, which the button looks up once. */
    expect(trigger).toHaveAttribute(
      "title",
      "⟦Every session from this visitor in the past 30 days⟧",
    );

    fireEvent.click(trigger);

    const menu: HTMLElement = screen.getByTestId("replay-user-sessions-menu");

    expect(menu).toHaveTextContent(
      "⟦Sessions from this visitor · past 30 days⟧",
    );
    expect(
      within(menu).getByRole("listbox", {
        name: "⟦Sessions from this visitor⟧",
      }),
    ).toBeInTheDocument();

    const [newest, current, ended] = within(menu).getAllByTestId(
      "replay-user-session-item",
    );

    expect(newest).toHaveTextContent("⟦Unknown page⟧");
    expect(newest).toHaveAttribute("title", "⟦Open session newest⟧");
    expect(
      within(newest as HTMLElement).getByTestId("replay-user-session-live"),
    ).toHaveAttribute("aria-label", "⟦Recording now⟧");
    expect(
      within(newest as HTMLElement).getByTestId("replay-user-session-live"),
    ).toHaveAttribute("title", "⟦Still being recorded⟧");
    expect(current).toHaveAttribute("title", "⟦The session you are watching⟧");
    expect(current).toHaveTextContent("⟦Watching⟧");
    expect(
      within(ended as HTMLElement).getByTestId("replay-user-session-ended"),
    ).toHaveAttribute("aria-label", "⟦Recording ended⟧");
    expect(
      within(ended as HTMLElement).getByTestId("replay-user-session-ended"),
    ).toHaveAttribute("title", "⟦Recording ended; still being finalized⟧");
    expect(
      within(ended as HTMLElement).getByTestId("replay-user-session-errors"),
    ).toHaveAttribute("title", "⟦2 errors in this session⟧");
  });

  it("words a partial list of a user's sessions as only some of them", () => {
    render(
      <ReplayUserSessionsMenu
        {...makeMenuProps({ kind: "identified", isTruncated: true })}
      />,
    );

    const trigger: HTMLElement = screen.getByTestId(
      "replay-user-sessions-button",
    );

    expect(trigger.getAttribute("aria-label")).toContain(
      "⟦3 sessions by this user; open the list⟧",
    );
    expect(trigger).toHaveAttribute(
      "title",
      "⟦More sessions from this user than the switcher can show; open the session list for all of them⟧",
    );

    fireEvent.click(trigger);

    expect(screen.getByTestId("replay-user-sessions-menu")).toHaveTextContent(
      "⟦Some sessions from this user · past 30 days⟧",
    );
  });
});

/* ---- The pin. ---- */

const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");
const PIN_ID: string = "0193c0de-2222-4aaa-8bbb-000000000002";

function pinList(
  rows: Array<{ id: ObjectID; materializedAt?: Date; expiresAt?: Date }>,
): { data: Array<unknown>; count: number } {
  return { data: rows, count: rows.length };
}

describe("ReplayPinControl in the reader's language", () => {
  it("words a failed check with the server's message in place", async () => {
    getListMock.mockReset();
    getListMock.mockRejectedValue(
      new HTTPErrorResponse(500, { message: "Server exploded" }, {}),
    );

    render(
      <ReplayPinControl rumApplicationId={APP_ID} sessionId={SESSION_ID} />,
    );

    const error: HTMLElement = await screen.findByTestId("replay-pin-error");

    expect(error).toHaveTextContent(
      `⟦Could not check whether this recording is pinned: ${error.getAttribute("title")}⟧`,
    );
  });

  it("words a pending pin, a protected one and an unpinned one", async () => {
    getListMock.mockReset();
    getListMock.mockResolvedValueOnce(pinList([{ id: new ObjectID(PIN_ID) }]));

    const { unmount } = render(
      <ReplayPinControl rumApplicationId={APP_ID} sessionId={SESSION_ID} />,
    );

    const pending: HTMLElement = await screen.findByTestId("replay-pin-status");

    expect(pending).toHaveTextContent("⟦Pin pending⟧");
    expect(pending).toHaveTextContent(`⟦${PIN_PENDING_COPY}⟧`);
    expect(pending).toHaveAttribute(
      "title",
      "⟦The pin is queued. Until the recording is finalized and the copy is written, this recording is NOT yet protected from retention.⟧",
    );
    unmount();

    getListMock.mockReset();
    getListMock
      .mockResolvedValueOnce(
        pinList([
          {
            id: new ObjectID(PIN_ID),
            materializedAt: new Date("2026-09-01T10:00:00Z"),
            expiresAt: new Date("2028-09-01T10:00:00Z"),
          },
        ]),
      )
      .mockResolvedValue(pinList([]));
    deleteItemMock.mockReset();
    deleteItemMock.mockResolvedValue({});

    render(
      <ReplayPinControl rumApplicationId={APP_ID} sessionId={SESSION_ID} />,
    );

    const protectedPin: HTMLElement =
      await screen.findByTestId("replay-pin-status");

    expect(protectedPin).toHaveTextContent(/^⟦Pinned⟧$/);
    /* The date is a value of the sentence, so it follows the sentence. */
    expect(protectedPin.getAttribute("title")).toMatch(
      /^⟦A copy of this recording is stored under pinned retention until .+2028.*\.⟧$/,
    );

    fireEvent.click(screen.getByTestId("replay-unpin-button"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("replay-pin-status")).toHaveTextContent(
        "⟦Unpinned⟧",
      );
    });
    expect(screen.getByTestId("replay-pin-status")).toHaveAttribute(
      "title",
      `⟦${PIN_UNPINNED_COPY}⟧`,
    );
  });
});

/* ---- The link into a recording, the stage and the shortcuts sheet. ---- */

describe("ReplayLink in the reader's language", () => {
  it("looks up the caller's label and its own default", () => {
    const { rerender } = render(
      <MemoryRouter>
        <ReplayLink rumApplicationId={APP_ID} sessionId={SESSION_ID} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "⟦Watch session replay⟧" }),
    ).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ReplayLink
          rumApplicationId={APP_ID}
          sessionId={SESSION_ID}
          label="Watch replay"
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "⟦Watch replay⟧" }),
    ).toBeInTheDocument();
  });
});

function makeStageEngine(phase: ReplayPhase): ReplayEngine {
  const host: HTMLElement = document.createElement("div");
  const snapshot: ReplayEngineSnapshot = {
    phase: phase,
    intent: "paused",
    buffer: "ok",
    currentTimeMs: 0,
    durationMs: DURATION_MS,
    speed: 1,
    skipInactive: false,
    fedRange: null,
    loadedChunkIndexes: [],
    activeTabId: "tab-1",
    recordedSize: null,
    bufferingSinceMs: null,
    lastGap: null,
    lastIdleSkip: null,
    error: null,
    pendingSeekMs: null,
    generation: 0,
  };

  return {
    dispatch: noop,
    subscribe: (): (() => void) => {
      return noop;
    },
    getSnapshot: (): ReplayEngineSnapshot => {
      return snapshot;
    },
    attach: (container: HTMLElement): void => {
      container.appendChild(host);
    },
    detach: (): void => {
      host.remove();
    },
    dispose: noop,
    onReplayer: (): (() => void) => {
      return noop;
    },
    getHostElement: (): HTMLElement => {
      return host;
    },
    getDiagnostics: (): ReplayEngineDiagnostics => {
      return {
        watchdogFireCount: 0,
        replayersCreated: 0,
        replayersDestroyed: 0,
        generation: 0,
        anchorChunkIndex: null,
        lastFedChunkIndex: null,
        isHoldingLastFrame: false,
        isAttached: true,
      };
    },
  };
}

describe("ReplayStage in the reader's language", () => {
  it("names the region and announces the phase in the reader's words", () => {
    render(<ReplayStage engine={makeStageEngine("buffering")} />);

    const stage: HTMLElement = screen.getByTestId("replay-stage");

    expect(stage).toHaveAttribute("aria-label", "⟦Session replay⟧");
    /* The phase itself stays data, for the E2E hooks. */
    expect(stage).toHaveAttribute("data-replay-phase", "buffering");
    expect(screen.getByTestId("replay-phase")).toHaveTextContent("⟦buffering⟧");
  });

  it("has a word for every phase, the phase's own English", () => {
    for (const [phase, word] of Object.entries(REPLAY_PHASE_WORDS)) {
      expect(word).toBe(phase);
    }
  });
});

describe("ReplayShortcutsModal in the reader's language", () => {
  it("looks up every group and shortcut it hands the sheet, and the word between two keys", () => {
    render(<ReplayShortcutsModal onClose={noop} />);

    const sheet: HTMLElement = screen.getByTestId("keyboard-shortcuts-modal");

    expect(
      within(sheet).getByTestId("shortcut-group-playback"),
    ).toHaveTextContent("⟦Playback⟧");
    expect(within(sheet).getByTestId("shortcut-play-pause")).toHaveTextContent(
      "⟦Play or pause⟧",
    );
    expect(
      within(sheet).getByTestId("shortcut-seek-percent"),
    ).toHaveTextContent("⟦to⟧");
    expect(screen.getByText("⟦Replay keyboard shortcuts⟧")).toBeInTheDocument();
  });

  it("hands the sheet the English words without a translator", () => {
    expect(toKeyboardShortcutGroups(REPLAY_SHORTCUT_GROUPS)[0]?.title).toBe(
      "Playback",
    );
    expect(
      toKeyboardShortcutGroups(REPLAY_SHORTCUT_GROUPS, MARKED)[0]?.shortcuts[0]
        ?.description,
    ).toBe("⟦Play or pause⟧");
  });
});
