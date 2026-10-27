import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  MergedPodLogReads,
  POD_LOG_MAX_PADDING_MS,
  POD_LOG_MIN_PADDING_MS,
  PodEntityKeySet,
  PodLogLineGroup,
  PodLogLineTiming,
  PodLogWindow,
  SPAN_POD_EXCEPTIONS_TITLE,
  SPAN_POD_EXCEPTION_LIMIT,
  SPAN_POD_LOGS_TITLE,
  SPAN_POD_LOG_BEFORE_LIMIT,
  SPAN_POD_LOG_LIMIT,
  SpanPodLogReads,
  TRACE_POD_LIMIT,
  buildSpanPodExceptionQuery,
  buildSpanPodLogReads,
  buildTracePodEntityKeyDisplays,
  buildTracePodLogQuery,
  collectPodEntityKeys,
  describePodExceptionCut,
  describePodLogCut,
  describeSpanPodExceptionWindow,
  describeSpanPodLogWindow,
  describeTracePodLogScope,
  formatPodLogPadding,
  getDefaultTraceLogScope,
  getLogTimeUnixNano,
  getPodLogGroupTitle,
  getPodLogLineTiming,
  getPodLogPaddingChoices,
  getPodLogPaddingMs,
  getPodLogWindow,
  getPodNameFromSpanAttributes,
  getTracePodLogScopeLabel,
  groupPodLogLines,
  mergePodLogReads,
  selectPodRecordsInWindow,
} from "../../FeatureSet/Dashboard/src/Utils/TracePodLogs";
import { LockedEntityKeyDisplayMap } from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";

/*
 * Logs from a span's pod, read by pod and time: what the trace page shows
 * for an eBPF span, whose logs carry no trace ID. The numbers below are an
 * oneuptime-app server span measured on the test cluster: 3.46 ms, with the
 * pod's three lines for it at +1.27, +1.28 and +3.24 ms and its neighbours'
 * lines about a quarter of a second either side.
 */

const MS: number = 1_000_000;
const SPAN_START_MS: number = Date.UTC(2026, 9, 27, 8, 2, 9, 232);
const SPAN_START: number = SPAN_START_MS * MS + 13_800;
const SPAN_END: number = SPAN_START + 3_462_700;
const POD: string = "7a2872b83f046399";
const OTHER_POD: string = "05d5e10a274a1d03";

const english: Translator = createTranslator(undefined);

interface TestLine {
  _id?: string;
  time?: Date | string;
  timeUnixNano?: number | string;
  body?: string;
}

function lineAt(offsetMs: number, body: string, id?: string): TestLine {
  const nanos: number = SPAN_START + offsetMs * MS;

  return {
    ...(id ? { _id: id } : {}),
    time: new Date(Math.floor(nanos / MS)),
    timeUnixNano: nanos,
    body,
  };
}

describe("the padding either side of a span", () => {
  test("a short span gets the 100 ms floor", () => {
    expect(getPodLogPaddingMs(SPAN_END - SPAN_START)).toBe(100);
    expect(POD_LOG_MIN_PADDING_MS).toBe(100);
  });

  test("a longer span gets a tenth of its length", () => {
    expect(getPodLogPaddingMs(2000 * MS)).toBe(200);
    expect(getPodLogPaddingMs(4200 * MS)).toBe(420);
  });

  test("never more than a second, however long the span", () => {
    expect(getPodLogPaddingMs(30_000 * MS)).toBe(1000);
    expect(getPodLogPaddingMs(3_600_000 * MS)).toBe(POD_LOG_MAX_PADDING_MS);
  });

  test("a span with no usable length gets the floor", () => {
    expect(getPodLogPaddingMs(0)).toBe(100);
    expect(getPodLogPaddingMs(-5 * MS)).toBe(100);
    expect(getPodLogPaddingMs(Number.NaN)).toBe(100);
  });

  test("a length the API sends as a string is read as a number", () => {
    expect(getPodLogPaddingMs("2000000000" as unknown as number)).toBe(200);
  });
});

describe("the window a span's pod logs are read over", () => {
  test("the span's own edges round outwards to the millisecond, then the padding goes either side", () => {
    const window: PodLogWindow | null = getPodLogWindow({
      startTimeUnixNano: SPAN_START,
      endTimeUnixNano: SPAN_END,
    });

    // 09.232013800 floors to .232, 09.235476500 ceils to .236.
    expect(window).toEqual({
      startTime: new Date(SPAN_START_MS - 100),
      endTime: new Date(SPAN_START_MS + 4 + 100),
      paddingMs: 100,
    });
  });

  test("a chosen padding replaces the default", () => {
    const window: PodLogWindow | null = getPodLogWindow({
      startTimeUnixNano: SPAN_START,
      endTimeUnixNano: SPAN_END,
      paddingMs: 10_000,
    });

    expect(window!.startTime).toEqual(new Date(SPAN_START_MS - 10_000));
    expect(window!.endTime).toEqual(new Date(SPAN_START_MS + 4 + 10_000));
    expect(window!.paddingMs).toBe(10_000);
  });

  test("a chosen padding that is not a padding falls back to the default", () => {
    for (const paddingMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        getPodLogWindow({
          startTimeUnixNano: SPAN_START,
          endTimeUnixNano: SPAN_END,
          paddingMs,
        })!.paddingMs,
      ).toBe(100);
    }
  });

  test("an end that is missing or before the start reads the start's moment", () => {
    for (const endTimeUnixNano of [0, SPAN_START - 5 * MS, Number.NaN]) {
      const window: PodLogWindow | null = getPodLogWindow({
        startTimeUnixNano: SPAN_START,
        endTimeUnixNano,
      });

      expect(window!.startTime).toEqual(new Date(SPAN_START_MS - 100));
      expect(window!.endTime).toEqual(new Date(SPAN_START_MS + 1 + 100));
    }
  });

  test("times the API sends as strings are read", () => {
    const window: PodLogWindow | null = getPodLogWindow({
      startTimeUnixNano: "1793088129232013800" as unknown as number,
      endTimeUnixNano: "1793088129235476500" as unknown as number,
    });

    expect(window!.startTime.toISOString()).toBe("2026-10-27T08:02:09.132Z");
    expect(window!.endTime.toISOString()).toBe("2026-10-27T08:02:09.336Z");
  });

  test("a span with no usable start has no window", () => {
    for (const startTimeUnixNano of [0, -1, Number.NaN]) {
      expect(
        getPodLogWindow({ startTimeUnixNano, endTimeUnixNano: SPAN_END }),
      ).toBeNull();
    }
  });
});

describe("the paddings Advanced offers", () => {
  test("the span's own default first, then each wider look once", () => {
    expect(getPodLogPaddingChoices(100)).toEqual([100, 1000, 10_000, 60_000]);
    expect(getPodLogPaddingChoices(420)).toEqual([420, 1000, 10_000, 60_000]);
    expect(getPodLogPaddingChoices(1000)).toEqual([1000, 10_000, 60_000]);
  });

  test("a padding reads as a duration", () => {
    expect(formatPodLogPadding(100)).toBe("100 ms");
    expect(formatPodLogPadding(420)).toBe("420 ms");
    expect(formatPodLogPadding(1000)).toBe("1 s");
    expect(formatPodLogPadding(10_000)).toBe("10 s");
    expect(formatPodLogPadding(60_000)).toBe("1m");
  });
});

describe("the pods a trace ran in", () => {
  test("each pod once, in the order the spans name them, without blanks", () => {
    const pods: PodEntityKeySet = collectPodEntityKeys([
      POD,
      "",
      undefined,
      ` ${POD} `,
      null,
      OTHER_POD,
      POD,
    ]);

    expect(pods).toEqual({ keys: [POD, OTHER_POD], totalCount: 2 });
  });

  test("a trace across more pods than the limit reads the first ones and says how many there were", () => {
    const keys: Array<string> = [];
    for (let index: number = 0; index < TRACE_POD_LIMIT + 5; index++) {
      keys.push(`pod${index.toString().padStart(13, "0")}`);
    }

    const pods: PodEntityKeySet = collectPodEntityKeys(keys);

    expect(pods.keys).toEqual(keys.slice(0, TRACE_POD_LIMIT));
    expect(pods.totalCount).toBe(TRACE_POD_LIMIT + 5);
  });

  test("a trace outside Kubernetes has no pods", () => {
    expect(collectPodEntityKeys(["", "", undefined])).toEqual({
      keys: [],
      totalCount: 0,
    });
  });
});

describe("the span panel's two reads", () => {
  const window: PodLogWindow = getPodLogWindow({
    startTimeUnixNano: SPAN_START,
    endTimeUnixNano: SPAN_END,
  })!;

  test("both read the pod's own key column and meet at the millisecond the span starts in", () => {
    const reads: SpanPodLogReads | null = buildSpanPodLogReads({
      podEntityKey: POD,
      startTimeUnixNano: SPAN_START,
      window,
    });

    expect(reads).toEqual({
      before: {
        k8sPodEntityKey: POD,
        time: new InBetween<Date>(
          new Date(SPAN_START_MS - 100),
          new Date(SPAN_START_MS),
        ),
      },
      fromStart: {
        k8sPodEntityKey: POD,
        time: new InBetween<Date>(
          new Date(SPAN_START_MS),
          new Date(SPAN_START_MS + 104),
        ),
      },
    });
  });

  test("the pod's key is trimmed", () => {
    const reads: SpanPodLogReads | null = buildSpanPodLogReads({
      podEntityKey: `  ${POD} `,
      startTimeUnixNano: SPAN_START,
      window,
    });

    expect((reads!.before as Record<string, unknown>)["k8sPodEntityKey"]).toBe(
      POD,
    );
  });

  test("no pod or no start, no reads", () => {
    for (const podEntityKey of ["", "   ", null, undefined]) {
      expect(
        buildSpanPodLogReads({
          podEntityKey,
          startTimeUnixNano: SPAN_START,
          window,
        }),
      ).toBeNull();
    }
    expect(
      buildSpanPodLogReads({ podEntityKey: POD, startTimeUnixNano: 0, window }),
    ).toBeNull();
  });
});

describe("the two reads as one list", () => {
  test("the before read, newest first, is turned round ahead of the lines from the start", () => {
    const merged: MergedPodLogReads<TestLine> = mergePodLogReads<TestLine>({
      before: [lineAt(-50, "b2", "2"), lineAt(-90, "b1", "1")],
      fromStart: [lineAt(1, "d1", "3"), lineAt(150, "a1", "4")],
    });

    expect(
      merged.logs.map((line: TestLine) => {
        return line.body;
      }),
    ).toEqual(["b1", "b2", "d1", "a1"]);
    expect(merged.isBeforeCut).toBe(false);
    expect(merged.isAfterCut).toBe(false);
  });

  test("a line logged at the very millisecond the reads meet is kept once", () => {
    const atStart: TestLine = lineAt(-0.0138, "at the start", "same");
    const merged: MergedPodLogReads<TestLine> = mergePodLogReads<TestLine>({
      before: [atStart],
      fromStart: [{ ...atStart }, lineAt(2, "later", "next")],
    });

    expect(
      merged.logs.map((line: TestLine) => {
        return line.body;
      }),
    ).toEqual(["at the start", "later"]);
  });

  test("rows without an id are told apart by their time and words", () => {
    const merged: MergedPodLogReads<TestLine> = mergePodLogReads<TestLine>({
      before: [lineAt(0, "same moment")],
      fromStart: [lineAt(0, "same moment"), lineAt(0, "another line")],
    });

    expect(merged.logs).toHaveLength(2);
  });

  test("a read that came back full says its part is cut short", () => {
    const before: Array<TestLine> = [];
    for (let index: number = 0; index < SPAN_POD_LOG_BEFORE_LIMIT; index++) {
      before.push(lineAt(-1 - index, `b${index}`, `b${index}`));
    }
    const fromStart: Array<TestLine> = [];
    for (let index: number = 0; index < SPAN_POD_LOG_LIMIT; index++) {
      fromStart.push(lineAt(index, `f${index}`, `f${index}`));
    }

    const merged: MergedPodLogReads<TestLine> = mergePodLogReads<TestLine>({
      before,
      fromStart,
    });

    expect(merged.isBeforeCut).toBe(true);
    expect(merged.isAfterCut).toBe(true);
    expect(merged.logs).toHaveLength(
      SPAN_POD_LOG_BEFORE_LIMIT + SPAN_POD_LOG_LIMIT,
    );
  });
});

describe("where a line falls against the span", () => {
  function timing(offsetMs: number): PodLogLineTiming | null {
    return getPodLogLineTiming({
      logTimeUnixNano: SPAN_START + offsetMs * MS,
      startTimeUnixNano: SPAN_START,
      endTimeUnixNano: SPAN_END,
    });
  }

  test("the span's own lines are during it, offset from its start", () => {
    expect(timing(1.27)).toEqual({
      position: "during",
      offsetLabel: "+1.27 ms",
    });
    expect(timing(3.24)).toEqual({
      position: "during",
      offsetLabel: "+3.24 ms",
    });
  });

  test("its neighbours' lines are before or after it", () => {
    expect(timing(-232.59)).toEqual({
      position: "before",
      offsetLabel: "-233 ms",
    });
    expect(timing(221.49)).toEqual({
      position: "after",
      offsetLabel: "+221 ms",
    });
  });

  test("its first and last instants are during it", () => {
    expect(timing(0)!.position).toBe("during");
    expect(
      getPodLogLineTiming({
        logTimeUnixNano: SPAN_END,
        startTimeUnixNano: SPAN_START,
        endTimeUnixNano: SPAN_END,
      })!.position,
    ).toBe("during");
  });

  test("a span with no length holds only its own instant", () => {
    expect(
      getPodLogLineTiming({
        logTimeUnixNano: SPAN_START,
        startTimeUnixNano: SPAN_START,
        endTimeUnixNano: 0,
      })!.position,
    ).toBe("during");
    expect(
      getPodLogLineTiming({
        logTimeUnixNano: SPAN_START + MS,
        startTimeUnixNano: SPAN_START,
        endTimeUnixNano: 0,
      })!.position,
    ).toBe("after");
  });

  test("a line with no usable time cannot be placed", () => {
    expect(
      getPodLogLineTiming({
        logTimeUnixNano: Number.NaN,
        startTimeUnixNano: SPAN_START,
        endTimeUnixNano: SPAN_END,
      }),
    ).toBeNull();
  });

  test("a line's time is its own nanoseconds, else its time", () => {
    expect(getLogTimeUnixNano({ timeUnixNano: "1793088129233283800" })).toBe(
      1793088129233283800,
    );
    expect(getLogTimeUnixNano({ time: new Date(SPAN_START_MS) })).toBe(
      SPAN_START_MS * MS,
    );
    expect(
      getLogTimeUnixNano({ timeUnixNano: 0, time: "2026-10-27T08:02:09.232Z" }),
    ).toBe(SPAN_START_MS * MS);
    expect(getLogTimeUnixNano({})).toBeNaN();
    expect(getLogTimeUnixNano({ time: "not a time" })).toBeNaN();
  });
});

describe("the lines in their groups", () => {
  test("before, during and after the span, each oldest first, empty ones left out", () => {
    const groups: Array<PodLogLineGroup<TestLine>> = groupPodLogLines({
      logs: [
        lineAt(-232.59, "Product Type: Traces"),
        lineAt(1.27, "Product Type: Traces"),
        lineAt(1.28, "Is Protobuf: true"),
        lineAt(3.24, "Added traces ingestion job"),
        lineAt(221.49, "Product Type: Logs"),
      ],
      startTimeUnixNano: SPAN_START,
      endTimeUnixNano: SPAN_END,
    });

    expect(
      groups.map((group: PodLogLineGroup<TestLine>) => {
        return [
          group.position,
          group.lines.map((line: { log: TestLine; offsetLabel: string }) => {
            return `${line.offsetLabel} ${line.log.body}`;
          }),
        ];
      }),
    ).toEqual([
      ["before", ["-233 ms Product Type: Traces"]],
      [
        "during",
        [
          "+1.27 ms Product Type: Traces",
          "+1.28 ms Is Protobuf: true",
          "+3.24 ms Added traces ingestion job",
        ],
      ],
      ["after", ["+221 ms Product Type: Logs"]],
    ]);
  });

  test("a window with nothing during the span has no during group", () => {
    const groups: Array<PodLogLineGroup<TestLine>> = groupPodLogLines({
      logs: [lineAt(-20, "before"), lineAt(40, "after")],
      startTimeUnixNano: SPAN_START,
      endTimeUnixNano: SPAN_END,
    });

    expect(
      groups.map((group: PodLogLineGroup<TestLine>) => {
        return group.position;
      }),
    ).toEqual(["before", "after"]);
  });

  test("a line with no usable time is left out rather than misplaced", () => {
    const groups: Array<PodLogLineGroup<TestLine>> = groupPodLogLines({
      logs: [{ body: "no time" }, lineAt(1, "placed")],
      startTimeUnixNano: SPAN_START,
      endTimeUnixNano: SPAN_END,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.lines).toHaveLength(1);
    expect(groups[0]!.lines[0]!.log.body).toBe("placed");
  });

  test("nothing read, no groups", () => {
    expect(
      groupPodLogLines({
        logs: [],
        startTimeUnixNano: SPAN_START,
        endTimeUnixNano: SPAN_END,
      }),
    ).toEqual([]);
  });
});

describe("which view the trace's Logs tab opens on", () => {
  test("a trace outside Kubernetes keeps the logs linked by its ID", () => {
    expect(getDefaultTraceLogScope({ podCount: 0, linkedLogCount: 0 })).toBe(
      "trace",
    );
    expect(getDefaultTraceLogScope({ podCount: 0, linkedLogCount: null })).toBe(
      "trace",
    );
  });

  test("an eBPF trace, which no log carries, opens on its pods", () => {
    expect(getDefaultTraceLogScope({ podCount: 1, linkedLogCount: 0 })).toBe(
      "pods",
    );
  });

  test("a trace its logs carry opens on them", () => {
    expect(getDefaultTraceLogScope({ podCount: 2, linkedLogCount: 14 })).toBe(
      "trace",
    );
  });

  test("undecided while counting; a failed count keeps the linked view", () => {
    expect(
      getDefaultTraceLogScope({ podCount: 1, linkedLogCount: null }),
    ).toBeNull();
    expect(
      getDefaultTraceLogScope({ podCount: 1, linkedLogCount: undefined }),
    ).toBe("trace");
  });
});

describe("the trace Logs tab's pod scope", () => {
  const window: PodLogWindow = getPodLogWindow({
    startTimeUnixNano: SPAN_START,
    endTimeUnixNano: SPAN_START + 2000 * MS,
  })!;

  test("the pods by entity key - what the viewer's chart and facets read - over the trace's window", () => {
    expect(
      buildTracePodLogQuery({
        podEntityKeys: [POD, OTHER_POD, POD],
        window,
      }),
    ).toEqual({
      entityKeys: new Includes([POD, OTHER_POD]),
      time: new InBetween<Date>(
        new Date(SPAN_START_MS - 200),
        new Date(SPAN_START_MS + 2001 + 200),
      ),
    });
  });

  test("no pods, no scope", () => {
    expect(buildTracePodLogQuery({ podEntityKeys: [], window })).toBeNull();
    expect(
      buildTracePodLogQuery({ podEntityKeys: ["", " "], window }),
    ).toBeNull();
  });
});

describe("the words", () => {
  test("the span panel's heading says the lines are not linked by trace ID", () => {
    expect(SPAN_POD_LOGS_TITLE).toBe(
      "Logs from this pod during this span (not linked by trace ID)",
    );
  });

  test("the span panel names the pod and the window when it can", () => {
    expect(
      describeSpanPodLogWindow({
        translator: english,
        podName: "oneuptime-app-5b9df8b796-88bzt",
        paddingMs: 100,
      }),
    ).toBe(
      "What oneuptime-app-5b9df8b796-88bzt wrote from 100 ms before this span to 100 ms after it.",
    );
    expect(
      describeSpanPodLogWindow({
        translator: english,
        podName: "  ",
        paddingMs: 1000,
      }),
    ).toBe("What the pod wrote from 1 s before this span to 1 s after it.");
  });

  test("the trace's pod scope counts its pods, and says when it reads only some", () => {
    expect(
      describeTracePodLogScope({
        translator: english,
        podCount: 1,
        shownPodCount: 1,
        paddingMs: 100,
      }),
    ).toBe(
      "What this trace's pod wrote from 100 ms before the trace to 100 ms after it, not linked by trace ID.",
    );
    expect(
      describeTracePodLogScope({
        translator: english,
        podCount: 3,
        shownPodCount: 3,
        paddingMs: 250,
      }),
    ).toBe(
      "What this trace's 3 pods wrote from 250 ms before the trace to 250 ms after it, not linked by trace ID.",
    );
    expect(
      describeTracePodLogScope({
        translator: english,
        podCount: 1234,
        shownPodCount: TRACE_POD_LIMIT,
        paddingMs: 1000,
      }),
    ).toBe(
      "What the first 20 of this trace's 1,234 pods wrote from 1 s before the trace to 1 s after it, not linked by trace ID.",
    );
  });

  test("the scope's label follows the number of pods", () => {
    expect(getTracePodLogScopeLabel(1)).toBe("Same pod, same time");
    expect(getTracePodLogScopeLabel(2)).toBe("Same pods, same time");
  });

  test("each group of lines has its heading", () => {
    expect(getPodLogGroupTitle(english, "before")).toBe("Before the span");
    expect(getPodLogGroupTitle(english, "during")).toBe("During the span");
    expect(getPodLogGroupTitle(english, "after")).toBe("After the span");
  });

  test("a part cut short says which lines it kept", () => {
    expect(describePodLogCut({ translator: english, part: "before" })).toBe(
      `Only the ${SPAN_POD_LOG_BEFORE_LIMIT} lines nearest the span are shown.`,
    );
    expect(describePodLogCut({ translator: english, part: "fromStart" })).toBe(
      `Only the first ${SPAN_POD_LOG_LIMIT} lines from the span's start are shown.`,
    );
  });

  test("each sentence is looked up whole, in the reader's language", () => {
    const german: Translator = createTranslator((text: string) => {
      return (
        {
          "What {{pod}} wrote from {{padding}} before this span to {{padding}} after it.":
            "Was {{pod}} von {{padding}} vor diesem Span bis {{padding}} danach schrieb.",
          "What this trace's {{count}} pods wrote from {{padding}} before the trace to {{padding}} after it, not linked by trace ID.":
            "Was die {{count}} Pods dieses Traces von {{padding}} davor bis {{padding}} danach schrieben, nicht über die Trace-ID verknüpft.",
          "Before the span": "Vor dem Span",
        } as Record<string, string>
      )[text];
    }, "de");

    expect(
      describeSpanPodLogWindow({
        translator: german,
        podName: "checkout-7d9f",
        paddingMs: 100,
      }),
    ).toBe(
      "Was checkout-7d9f von 100 ms vor diesem Span bis 100 ms danach schrieb.",
    );
    expect(
      describeTracePodLogScope({
        translator: german,
        podCount: 2,
        shownPodCount: 2,
        paddingMs: 100,
      }),
    ).toBe(
      "Was die 2 Pods dieses Traces von 100 ms davor bis 100 ms danach schrieben, nicht über die Trace-ID verknüpft.",
    );
    expect(getPodLogGroupTitle(german, "before")).toBe("Vor dem Span");
    // A sentence the locale has not worded yet stays wholly English.
    expect(
      describeSpanPodLogWindow({
        translator: german,
        podName: "",
        paddingMs: 100,
      }),
    ).toBe(
      "What the pod wrote from 100 ms before this span to 100 ms after it.",
    );
  });
});

describe("the pods' names", () => {
  test("a span's resource names its pod", () => {
    expect(
      getPodNameFromSpanAttributes({
        "resource.k8s.pod.name": " oneuptime-app-5b9df8b796-88bzt ",
      }),
    ).toBe("oneuptime-app-5b9df8b796-88bzt");
    expect(
      getPodNameFromSpanAttributes({ "k8s.pod.name": "checkout-7d9f" }),
    ).toBe("checkout-7d9f");
  });

  test("a span that does not name one gives no name", () => {
    expect(getPodNameFromSpanAttributes(undefined)).toBe("");
    expect(getPodNameFromSpanAttributes({})).toBe("");
    expect(getPodNameFromSpanAttributes({ "resource.k8s.pod.name": 42 })).toBe(
      "",
    );
  });

  test("the chips name each pod by its Inventory item, else as a pod by its key", () => {
    const displays: LockedEntityKeyDisplayMap = buildTracePodEntityKeyDisplays({
      podEntityKeys: [POD, OTHER_POD],
      items: [
        {
          entityKey: POD,
          entityType: "k8s.pod",
          displayName: "oneuptime-app-5b9df8b796-88bzt",
          identifyingAttributes: {
            "k8s.pod.name": "oneuptime-app-5b9df8b796-88bzt",
            "k8s.cluster.name": "oneuptime-test",
            "k8s.namespace.name": "default",
          },
        },
        // An item for a pod this trace did not run in is not shown.
        {
          entityKey: "fab4c6129c90a460",
          entityType: "k8s.pod",
          displayName: "oneuptime-worker-6ddc87b94c-tzzxr",
        },
      ],
    });

    expect(Object.keys(displays).sort()).toEqual([OTHER_POD, POD].sort());
    expect(displays[POD]!.displayKey).toBe("Kubernetes Pod");
    expect(displays[POD]!.displayValue).toBe("oneuptime-app-5b9df8b796-88bzt");
    expect(displays[POD]!.searchAttributes).toBeDefined();
    expect(displays[OTHER_POD]).toEqual({
      displayKey: "Kubernetes Pod",
      displayValue: OTHER_POD,
    });
  });
});

/*
 * The span's Exceptions tab reads what the pod raised by the same rule: the
 * exceptions ingest extracts from an eBPF span's pod's log lines carry the
 * pod and no trace ID. Such an exception keeps its exact instant in
 * timeUnixNano but its `time` only to the second - as on the test cluster,
 * where oneuptime-app's pod logged "Job ... could not be removed" at
 * 05:13:08.654 and the exception's time reads 05:13:08.000.
 */
describe("the pod's exceptions during a span", () => {
  const window: PodLogWindow = getPodLogWindow({
    startTimeUnixNano: SPAN_START,
    endTimeUnixNano: SPAN_END,
  })!;

  interface TestException {
    time?: Date;
    timeUnixNano?: number;
    message: string;
  }

  // As ingest writes a log-derived exception: time floored to the second.
  function exceptionAt(offsetMs: number, message: string): TestException {
    const nanos: number = SPAN_START + offsetMs * MS;
    return {
      time: new Date(Math.floor(nanos / MS / 1000) * 1000),
      timeUnixNano: nanos,
      message,
    };
  }

  test("the read widens the window to whole seconds, which a log-derived exception's time is kept to", () => {
    expect(
      buildSpanPodExceptionQuery({ podEntityKey: ` ${POD} `, window }),
    ).toEqual({
      k8sPodEntityKey: POD,
      time: new InBetween<Date>(
        new Date(Math.floor((SPAN_START_MS - 100) / 1000) * 1000),
        new Date(Math.ceil((SPAN_START_MS + 104) / 1000) * 1000),
      ),
    });
  });

  test("no pod, no read", () => {
    for (const podEntityKey of ["", "  ", null, undefined]) {
      expect(buildSpanPodExceptionQuery({ podEntityKey, window })).toBeNull();
    }
  });

  test("what came back is trimmed to the window by its exact instant, oldest first", () => {
    const inWindow: Array<TestException> = selectPodRecordsInWindow({
      records: [
        exceptionAt(60, "after the span"),
        // 09.032: in the second the read widens to, before the window.
        exceptionAt(-200, "same second, outside the window"),
        exceptionAt(2.1, "during the span"),
        exceptionAt(-50, "before the span"),
        { message: "no time at all" },
      ],
      window,
    });

    expect(
      inWindow.map((exception: TestException) => {
        return exception.message;
      }),
    ).toEqual(["before the span", "during the span", "after the span"]);
  });

  test("its heading and lines say the exceptions are not linked by trace ID", () => {
    expect(SPAN_POD_EXCEPTIONS_TITLE).toBe(
      "Exceptions from this pod during this span (not linked by trace ID)",
    );
    expect(
      describeSpanPodExceptionWindow({
        translator: english,
        podName: "oneuptime-app-5b9df8b796-6m5pk",
        paddingMs: 100,
      }),
    ).toBe(
      "Exceptions oneuptime-app-5b9df8b796-6m5pk recorded from 100 ms before this span to 100 ms after it.",
    );
    expect(
      describeSpanPodExceptionWindow({
        translator: english,
        podName: "",
        paddingMs: 1000,
      }),
    ).toBe(
      "Exceptions the pod recorded from 1 s before this span to 1 s after it.",
    );
    expect(describePodExceptionCut(english)).toBe(
      `Only the first ${SPAN_POD_EXCEPTION_LIMIT} exceptions of this window are shown.`,
    );
  });
});
