import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "@jest/globals";
import ChunkLoader from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ChunkLoader";
import {
  ReplayTimelineEvent,
  ReplayTimelineEventKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineTypes";
import {
  makeRecordingSignalId,
  ReplaySignal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  CUSTOM_SIGNAL_TRIGGER_SUBTITLES,
  fromTimelineEvent,
  ReplayCustomSignalDetail,
  ReplayFrustrationSignalDetail,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignals";
import ReplayRailDetail from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailDetail";
import { SessionReplayChunkManifestEntry } from "../../../Types/Rum/SessionReplay";
import { SessionReplayCustomEventTag } from "../../../Types/Rum/SessionReplayCustomEvents";
import { SessionReplayCustomSignalTrigger } from "../../../Types/Rum/SessionReplayFrustrationSignals";

/*
 * The application's own signals in the player (issue #6443). The recorder
 * writes one as a oneuptime.signal event with the signal's name, what set
 * it off and whether it counted as frustration when it happened; the
 * player shows it with the built-in frustration signals when it did, and
 * as a marker beside the page's own events when it did not - titled by its
 * name either way, with what set it off under it.
 */

const CHUNK_MS: number = 15_000;
const BASE_TS: number = 1_700_000_000_000;

// The manifest row of one chunk, as ChunkLoader.test.ts builds it.
function entry(chunkIndex: number): SessionReplayChunkManifestEntry {
  return {
    chunkIndex: chunkIndex,
    tabId: "tab-1",
    chunkStartOffsetMs: chunkIndex * CHUNK_MS,
    chunkEndOffsetMs: (chunkIndex + 1) * CHUNK_MS,
    eventCount: 10,
    hasFullSnapshot: chunkIndex === 0,
    payloadBytes: 4096,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
  };
}

function signalEvent(
  payload: Record<string, unknown>,
  timestamp: number,
): Record<string, unknown> {
  return {
    type: 5,
    timestamp: timestamp,
    data: { tag: SessionReplayCustomEventTag.CustomSignal, payload: payload },
  };
}

function extract(
  events: Array<Record<string, unknown>>,
): Array<ReplayTimelineEvent> {
  return ChunkLoader.extractTimelineEvents(entry(0), [
    { type: 2, timestamp: BASE_TS, data: {} },
    ...events,
  ] as never);
}

function makeEvent(
  kind: ReplayTimelineEventKind,
  overrides: Partial<ReplayTimelineEvent>,
): ReplayTimelineEvent {
  return {
    id: makeRecordingSignalId(0, 3),
    kind: kind,
    chunkIndex: 0,
    offsetMs: 4_000,
    ...overrides,
  };
}

// The links a rail detail is given: none of them lead anywhere here.
const NO_LINKS: Parameters<typeof ReplayRailDetail>[0]["links"] = {
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
};

function renderDetail(
  signal: ReplaySignal,
  onShowOnStage?: ((x: number, y: number) => void) | undefined,
): void {
  render(
    <MemoryRouter>
      <ReplayRailDetail
        signal={signal}
        signals={[signal]}
        links={NO_LINKS}
        onSeek={(): void => {
          return;
        }}
        onSelectSignal={(): void => {
          return;
        }}
        onClose={(): void => {
          return;
        }}
        onShowOnStage={onShowOnStage}
        startTimeUnixMs={BASE_TS}
      />
    </MemoryRouter>,
  );
}

// What a fact of the open detail says, by its label.
function factOf(label: string): string {
  return screen.getByText(label, { selector: "dt" }).nextSibling!.textContent!;
}

afterEach(() => {
  cleanup();
});

describe("the player reads the application's own signals from the recording", () => {
  it("a signal that counted as frustration is a frustration row, named, with what set it off", () => {
    const rows: Array<ReplayTimelineEvent> = extract([
      signalEvent(
        {
          name: "Pay button clicked again",
          trigger: "click",
          isFrustration: true,
          atUnixMs: BASE_TS + 3_000,
          x: 410,
          y: 220,
        },
        BASE_TS + 3_000,
      ),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "frustration",
      offsetMs: 3_000,
      customSignalName: "Pay button clicked again",
      customSignalTrigger: "click",
      x: 410,
      y: 220,
    });
    // A built-in kind is never claimed for it.
    expect(rows[0]!.frustrationKind).toBeUndefined();
  });

  it("a signal that only marks the moment is a marker row with the page's own events", () => {
    const rows: Array<ReplayTimelineEvent> = extract([
      signalEvent(
        {
          name: "Plan cancelled",
          trigger: "page",
          isFrustration: false,
          atUnixMs: BASE_TS + 6_000,
        },
        BASE_TS + 6_000,
      ),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "custom",
      name: "Plan cancelled",
      customSignalName: "Plan cancelled",
      customSignalTrigger: "page",
    });
    expect(rows[0]!.x).toBeUndefined();
  });

  it("drops a oneuptime.signal event that is not a signal, as it drops an unknown tag", () => {
    const rows: Array<ReplayTimelineEvent> = extract([
      signalEvent({ trigger: "page", isFrustration: true }, BASE_TS + 1_000),
      signalEvent(
        { name: "Bad trigger", trigger: "hover", isFrustration: true },
        BASE_TS + 1_100,
      ),
      signalEvent(
        { name: "No flag", trigger: "event", atUnixMs: BASE_TS + 1_200 },
        BASE_TS + 1_200,
      ),
      {
        type: 5,
        timestamp: BASE_TS + 1_300,
        data: { tag: SessionReplayCustomEventTag.CustomSignal },
      },
    ]);

    expect(rows).toEqual([]);
  });

  it("keeps a click signal's coordinates only when both are numbers", () => {
    const rows: Array<ReplayTimelineEvent> = extract([
      signalEvent(
        {
          name: "Help opened",
          trigger: "click",
          isFrustration: false,
          atUnixMs: BASE_TS + 2_000,
          x: 12,
          y: "40",
        },
        BASE_TS + 2_000,
      ),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.x).toBeUndefined();
    expect(rows[0]!.y).toBeUndefined();
  });
});

describe("the rail names the application's own signals", () => {
  it("titles a frustration signal by its name, with what set it off under it", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("frustration", {
        customSignalName: "Payment failed",
        customSignalTrigger: "page",
      }),
      { startTimeUnixMs: null },
    );

    expect(signal.kind).toBe("frustration");
    expect(signal.severity).toBe("warn");
    expect(signal.title).toBe("Payment failed");
    expect(signal.subtitle).toBe("Your signal: a page");

    const detail: ReplayFrustrationSignalDetail =
      signal.detail as ReplayFrustrationSignalDetail;

    expect(detail.customSignalName).toBe("Payment failed");
    expect(detail.customSignalTrigger).toBe("page");
  });

  it("says what set off each kind of signal", () => {
    const triggers: Array<SessionReplayCustomSignalTrigger> = [
      "click",
      "page",
      "event",
      "error",
    ];

    for (const trigger of triggers) {
      const signal: ReplaySignal = fromTimelineEvent(
        makeEvent("frustration", {
          customSignalName: "Signal",
          customSignalTrigger: trigger,
          x: 10,
          y: 20,
        }),
        { startTimeUnixMs: null },
      );

      // Its own words, not the coordinates a built-in rage click shows.
      expect(signal.subtitle).toBe(CUSTOM_SIGNAL_TRIGGER_SUBTITLES[trigger]);
    }

    expect(Object.values(CUSTOM_SIGNAL_TRIGGER_SUBTITLES)).toEqual([
      "Your signal: a click",
      "Your signal: a page",
      "Your signal: an event",
      "Your signal: an error",
    ]);
  });

  it("titles a marker signal by its name, and says it is a signal, not its properties", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("custom", {
        name: "Support chat opened",
        customSignalName: "Support chat opened",
        customSignalTrigger: "click",
      }),
      { startTimeUnixMs: null },
    );

    expect(signal.kind).toBe("custom");
    expect(signal.title).toBe("Support chat opened");
    expect(signal.subtitle).toBe("Your signal: a click");
    expect(
      (signal.detail as ReplayCustomSignalDetail).customSignalTrigger,
    ).toBe("click");
  });

  it("leaves the built-in signals as they were", () => {
    const rage: ReplaySignal = fromTimelineEvent(
      makeEvent("frustration", {
        frustrationKind: "rage-click",
        clickCount: 4,
        x: 1,
        y: 2,
      }),
      { startTimeUnixMs: null },
    );
    const custom: ReplaySignal = fromTimelineEvent(
      makeEvent("custom", {
        name: "checkout.step",
        properties: { step: "2" },
      }),
      { startTimeUnixMs: null },
    );

    expect(rage.title).toBe("Rage click (4 clicks)");
    expect(rage.subtitle).toBe("at 1, 2");
    expect(
      (rage.detail as ReplayFrustrationSignalDetail).customSignalName,
    ).toBeNull();
    expect(custom.subtitle).toBe("1 property");
    expect(
      (custom.detail as ReplayCustomSignalDetail).customSignalTrigger,
    ).toBeNull();
  });

  it("the detail says which signal it was and what set it off", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("frustration", {
        customSignalName: "Card declined",
        customSignalTrigger: "error",
      }),
      { startTimeUnixMs: null },
    );

    renderDetail(signal);

    expect(factOf("Signal")).toBe("Card declined (your signal: an error)");
    expect(factOf("Counts as")).toBe("frustration");
  });

  /*
   * A marker read as a track() event of the same name: "Event: Support
   * chat opened", "Properties: none" - when a signal never has properties
   * (the recorder sends its name, never what it matched). It says which
   * signal it was, as a frustrating one does, that it did not count as
   * frustration, and where a click signal's click was.
   */
  it("the detail of a marker says which signal it was, that it is not frustration, and where its click was", () => {
    const showOnStage: Array<[number, number]> = [];
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("custom", {
        name: "Support chat opened",
        customSignalName: "Support chat opened",
        customSignalTrigger: "click",
        x: 1080,
        y: 690,
      }),
      { startTimeUnixMs: null },
    );

    expect(signal.detail).toMatchObject({ x: 1080, y: 690 });

    renderDetail(signal, (x: number, y: number): void => {
      showOnStage.push([x, y]);
    });

    expect(factOf("Signal")).toBe("Support chat opened (your signal: a click)");
    expect(factOf("Counts as")).toBe("a marker, not frustration");
    expect(factOf("Position")).toBe("1080, 690");
    expect(screen.queryByText("Event", { selector: "dt" })).toBeNull();
    expect(screen.queryByText("Properties", { selector: "dt" })).toBeNull();

    fireEvent.click(screen.getByTestId("rail-show-on-stage"));
    expect(showOnStage).toEqual([[1080, 690]]);
  });

  it("a marker set off by a page has no position to show", () => {
    renderDetail(
      fromTimelineEvent(
        makeEvent("custom", {
          name: "Plan cancelled",
          customSignalName: "Plan cancelled",
          customSignalTrigger: "page",
        }),
        { startTimeUnixMs: null },
      ),
      (): void => {
        return;
      },
    );

    expect(factOf("Signal")).toBe("Plan cancelled (your signal: a page)");
    expect(screen.queryByText("Position", { selector: "dt" })).toBeNull();
    expect(screen.queryByTestId("rail-show-on-stage")).toBeNull();
  });

  it("a track() event keeps its event name and properties, and no position", () => {
    const signal: ReplaySignal = fromTimelineEvent(
      makeEvent("custom", {
        name: "checkout.step",
        properties: { step: "2" },
        x: 10,
        y: 20,
      }),
      { startTimeUnixMs: null },
    );

    expect(signal.detail).toMatchObject({ x: null, y: null });

    renderDetail(signal);

    expect(factOf("Event")).toBe("checkout.step");
    expect(factOf("step")).toBe("2");
    expect(screen.queryByText("Counts as", { selector: "dt" })).toBeNull();
  });
});
