import { describe, expect, it } from "@jest/globals";
import {
  REPLAY_RAIL_TAB_IDS,
  REPLAY_RAIL_TAB_KINDS,
  ReplayRailTabId,
  ReplaySignal,
  ReplaySignalKind,
  makeExceptionSignalId,
  makeIdleBackendSignalsSlot,
  makeLogSignalId,
  makeRecordingSignalId,
  makeSpanSignalId,
  parseReplaySignalId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";

/*
 * Signal ids are what ?signal= addresses, so they must round-trip through
 * a URL and reject anything a URL can carry. The tab->kind table is the
 * rail's whole routing, so every kind must land in exactly the tabs the
 * design names and nothing else.
 */

describe("signal ids", () => {
  it("recording ids are rec:<chunk>:<ordinal> and round-trip", () => {
    const id: string = makeRecordingSignalId(7, 42);

    expect(id).toBe("rec:7:42");
    expect(parseReplaySignalId(id)).toEqual({
      source: "rec",
      chunkIndex: 7,
      ordinal: 42,
    });
  });

  it("telemetry ids carry the row id whole, colons included", () => {
    expect(parseReplaySignalId(makeLogSignalId("abc"))).toEqual({
      source: "log",
      id: "abc",
    });
    expect(parseReplaySignalId(makeSpanSignalId("0af7:beef"))).toEqual({
      source: "span",
      id: "0af7:beef",
    });
    expect(parseReplaySignalId(makeExceptionSignalId("inst-1"))).toEqual({
      source: "exc",
      id: "inst-1",
    });
  });

  it("rejects malformed ids without throwing", () => {
    for (const bad of [
      "",
      "rec",
      "rec:",
      "rec:1",
      "rec:1:2:3",
      "rec:a:2",
      "rec:1:b",
      "rec:-1:2",
      "rec:1.5:2",
      "rec::2",
      "rec:1:",
      "log:",
      "span",
      "nope:1",
      ":rec:1:2",
    ]) {
      expect(parseReplaySignalId(bad)).toBeNull();
    }

    expect(parseReplaySignalId(undefined as unknown as string)).toBeNull();
  });

  it("accepts ordinal 0 and chunk 0", () => {
    expect(parseReplaySignalId("rec:0:0")).toEqual({
      source: "rec",
      chunkIndex: 0,
      ordinal: 0,
    });
  });
});

describe("rail tabs", () => {
  const ALL_KINDS: Array<ReplaySignalKind> = [
    "console",
    "network",
    "navigation",
    "interaction",
    "frustration",
    "performance",
    "client-error",
    "server-error",
    "log",
    "span",
    "custom",
    "marker",
  ];

  it("lists the nine tabs in display order", () => {
    expect([...REPLAY_RAIL_TAB_IDS]).toEqual([
      "all",
      "console",
      "network",
      "navigation",
      "interactions",
      "performance",
      "errors",
      "logs",
      "traces",
    ]);
  });

  it("'all' shows every kind", () => {
    expect([...REPLAY_RAIL_TAB_KINDS.all].sort()).toEqual(
      [...ALL_KINDS].sort(),
    );
  });

  it("every kind appears in exactly one tab besides 'all'", () => {
    for (const kind of ALL_KINDS) {
      const tabs: Array<ReplayRailTabId> = REPLAY_RAIL_TAB_IDS.filter(
        (tabId: ReplayRailTabId): boolean => {
          return tabId !== "all" && REPLAY_RAIL_TAB_KINDS[tabId].includes(kind);
        },
      );

      expect({ kind: kind, tabs: tabs }).toEqual({
        kind: kind,
        tabs: [tabs[0]],
      });
    }
  });

  it("errors merges client and server; interactions merges clicks, frustration and custom", () => {
    expect([...REPLAY_RAIL_TAB_KINDS.errors].sort()).toEqual([
      "client-error",
      "server-error",
    ]);
    expect([...REPLAY_RAIL_TAB_KINDS.interactions].sort()).toEqual([
      "custom",
      "frustration",
      "interaction",
    ]);
  });
});

describe("backend signal slots", () => {
  it("start idle with a null row count, never a claimed 0", () => {
    expect(makeIdleBackendSignalsSlot()).toEqual({
      status: "idle",
      rowCount: null,
      isTruncated: false,
      fetchedAtUnixMs: null,
    });
  });
});

describe("ReplaySignal shape", () => {
  it("a minimal recording signal and a minimal telemetry signal both satisfy the interface", () => {
    const recording: ReplaySignal = {
      id: makeRecordingSignalId(0, 1),
      kind: "network",
      source: "recording",
      offsetMs: 1200,
      severity: "error",
      title: "POST 500 /api/orders",
      chunkIndex: 0,
      links: { traceId: "abc" },
      detail: {},
      alignment: "exact",
    };

    const telemetry: ReplaySignal = {
      id: makeSpanSignalId("s1"),
      kind: "span",
      source: "telemetry",
      offsetMs: 1300,
      endOffsetMs: 1520,
      severity: "info",
      title: "POST /orders",
      subtitle: "payment-svc",
      links: { traceId: "abc", spanId: "s1" },
      detail: { spanCount: 4 },
      alignment: "anchored",
    };

    expect(recording.links.traceId).toBe(telemetry.links.traceId);
  });
});
