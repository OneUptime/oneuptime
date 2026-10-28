import { describe, expect, test } from "@jest/globals";
import {
  TELEMETRY_FIX_DIFF_LIMITS,
  TELEMETRY_FIX_THRESHOLDS,
  TelemetryArrival,
  TelemetryArrivalKind,
  TelemetrySignalCounts,
  decideTelemetryBaseline,
  decideTelemetryVerdict,
  describeArrivals,
  readAddedQuotedText,
} from "../../../../../Server/Utils/AI/CodeFix/TelemetryFixVerdict";
import { FixProductionVerdict } from "../../../../../Server/Utils/AI/CodeFix/FixProductionVerdict";
import { TelemetryFixSignal } from "../../../../../Types/AI/FixProductionBaseline";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import { generatedTexts } from "../../../../Helpers/GeneratedTexts";
import { seededRandom, SeededRandom } from "../../../../Helpers/SeededRandom";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * A telemetry improvement is merged, not sending anything. These pin what
 * counts as what a fix adds (text quoted on the lines its diff adds), when
 * it counts as arriving (after a whole day, without stopping the rest of
 * the service's telemetry), as breaking the telemetry (a service that sent
 * steadily sends nothing at all), and as impossible to tell.
 */

const HOUR: number = 60 * 60 * 1000;
const DEPLOYED_AT: Date = new Date("2026-10-20T10:00:00.000Z");
const GRACE: number = TELEMETRY_FIX_THRESHOLDS.rolloutGraceMinutes * 60 * 1000;

// `hours` of watched time after the rollout grace.
function watched(hours: number): Date {
  return new Date(DEPLOYED_AT.getTime() + GRACE + hours * HOUR);
}

function decide(data: {
  now: Date;
  signals?: Array<TelemetryFixSignal>;
  candidateCount?: number;
  arrivals?: Array<TelemetryArrival>;
  baselineCounts?: TelemetrySignalCounts | null;
  sinceCounts?: TelemetrySignalCounts | null;
}): FixProductionVerdict {
  return decideTelemetryVerdict({
    deployedAt: DEPLOYED_AT,
    now: data.now,
    signals: data.signals || [TelemetryFixSignal.Spans],
    candidateCount: data.candidateCount ?? 4,
    arrivals: data.arrivals || [],
    baselineCounts:
      data.baselineCounts === undefined
        ? { spans: 52000, logs: 0 }
        : data.baselineCounts,
    sinceCounts:
      data.sinceCounts === undefined
        ? { spans: 9000, logs: 0 }
        : data.sinceCounts,
    deployLabel: "version 2.3.2",
  });
}

const SPAN: TelemetryArrival = {
  text: "checkout.pay",
  kind: TelemetryArrivalKind.SpanName,
};

describe("thresholds", () => {
  test("are pinned", () => {
    expect(TELEMETRY_FIX_THRESHOLDS).toEqual({
      rolloutGraceMinutes: 10,
      minWatchHours: 24,
      maxWatchDays: 7,
      baselineDays: 7,
      minExpectedSignal: 100,
    });
    expect(TELEMETRY_FIX_DIFF_LIMITS).toEqual({
      maxTexts: 200,
      minTextLength: 3,
      maxTextLength: 200,
      maxLineLength: 2000,
      maxDiffCharacters: 2000000,
    });
  });
});

describe("what a fix adds: the text quoted on the lines its diff adds", () => {
  const PATCH: string = [
    "@@ -10,6 +10,12 @@ export async function pay(order) {",
    "   const total = sum(order);",
    "-  logger.info(`Paid ${order.id}`);",
    '+  return tracer.startActiveSpan("checkout.pay", async (span) => {',
    '+    span.setAttribute("order.id", order.id);',
    "+    logger.info('Payment captured', { orderId: order.id });",
    '+    span.setAttribute("order.id", order.id);',
    "+    // don't record the card number",
    "+    logger.info(`Paid ${order.id}`);",
    '+    const empty = "";',
    '+    const status = "200";',
    '+    log.debug("escaped \\"quote\\" inside");',
    "+++ b/not-a-line-of-code.ts",
    '     const unchanged = "context line";',
  ].join("\n");

  test("span names, attribute keys and log messages, in order, each once", () => {
    expect(readAddedQuotedText([PATCH])).toEqual({
      texts: ["checkout.pay", "order.id", "Payment captured"],
      isTruncated: false,
    });
  });

  test("context and removed lines are not what the fix adds", () => {
    expect(
      readAddedQuotedText(['-  log("removed text")', ' log("context text")'])
        .texts,
    ).toEqual([]);
  });

  test("an interpolation, an escape, no letter, or too short a text is left out", () => {
    expect(
      readAddedQuotedText([
        '+ a("${x} paid") b("\\tTab name") c("404") d("ok") e("--->")',
      ]).texts,
    ).toEqual([]);
  });

  test("text in any script counts, and a quote unclosed on its line ends the line", () => {
    expect(
      readAddedQuotedText([
        '+ log.info("注文を受け付けました") // it\'s "kept"',
      ]).texts,
    ).toEqual(["注文を受け付けました"]);
  });

  test("files are read in order; a file without a diff adds nothing", () => {
    expect(
      readAddedQuotedText(['+ span("first.span")', "", '+ span("second.span")'])
        .texts,
    ).toEqual(["first.span", "second.span"]);
  });

  test("at most 200 texts are kept, and the read says it stopped", () => {
    const patch: string = Array.from(
      { length: 250 },
      (_: unknown, i: number) => {
        return `+ span("span.number.${i}")`;
      },
    ).join("\n");
    const read: { texts: Array<string>; isTruncated: boolean } =
      readAddedQuotedText([patch]);

    expect(read.texts).toHaveLength(200);
    expect(read.texts[199]).toBe("span.number.199");
    expect(read.isTruncated).toBe(true);
  });

  test("a minified line is read only as far as 2,000 characters", () => {
    const line: string = `+${" ".repeat(2100)}span("too.far.in")`;

    expect(readAddedQuotedText([line]).texts).toEqual([]);
  });

  test("a text over 200 characters is not a name", () => {
    expect(readAddedQuotedText([`+ log("${"a".repeat(201)}")`]).texts).toEqual(
      [],
    );
  });

  test("megabytes of diff are read in one pass, and stop at 2,000,000 characters", () => {
    // Every line ends in a quote that never closes.
    const line: string =
      '+ span("a.b") log("text with \'quotes\' in it") x("\n';
    const patch: string = line.repeat(60000);
    const timed: FastestRun<{ texts: Array<string>; isTruncated: boolean }> =
      fastestRun({
        run: (): { texts: Array<string>; isTruncated: boolean } => {
          const read: { texts: Array<string>; isTruncated: boolean } =
            readAddedQuotedText([patch, patch]);

          expect(patch.length).toBeGreaterThan(2000000);
          return read;
        },
        limitInMs: 2000,
      });
    const read: { texts: Array<string>; isTruncated: boolean } = timed.result;
    expect(timed.inMs).toBeLessThan(2000);
    expect(read).toEqual({
      texts: ["a.b", "text with 'quotes' in it"],
      isTruncated: true,
    });
  });

  test("one line of megabytes is read only as far as its first 2,000 characters", () => {
    const timed: FastestRun<{ texts: Array<string>; isTruncated: boolean }> =
      fastestRun({
        run: (): { texts: Array<string>; isTruncated: boolean } => {
          return readAddedQuotedText([
            `+ span("first.one") ${'x("'.repeat(1500000)}`,
          ]);
        },
        limitInMs: 2000,
      });
    const read: { texts: Array<string>; isTruncated: boolean } = timed.result;

    expect(timed.inMs).toBeLessThan(2000);
    expect(read.texts).toEqual(["first.one"]);
  });

  test("whatever the diff, every text kept is quoted on an added line, once, within the limits", () => {
    const alphabet: Array<string> = [
      "+",
      "-",
      " ",
      "\n",
      '"',
      "'",
      "`",
      "\\",
      "${x}",
      "span",
      ".id",
      "Order",
      "日本",
      "42",
      "@@ -1 +1 @@",
    ];
    const random: SeededRandom = seededRandom(5096);

    for (const text of generatedTexts(3000, 5096, alphabet, 40)) {
      const patches: Array<string> = random(3) === 0 ? [text, text] : [text];
      const read: { texts: Array<string>; isTruncated: boolean } =
        readAddedQuotedText(patches);

      expect(new Set(read.texts).size).toBe(read.texts.length);

      for (const found of read.texts) {
        expect(found.length).toBeGreaterThanOrEqual(3);
        expect(found.length).toBeLessThanOrEqual(200);
        expect(found).not.toContain("${");
        expect(found).not.toContain("\n");
        expect(found).not.toContain("\\");
        expect(
          text.split("\n").some((line: string): boolean => {
            return line.startsWith("+") && line.includes(found);
          }),
        ).toBe(true);
      }
    }
  });
});

describe("what arrived, in words", () => {
  test("names what arrived as what it is, the rest counted", () => {
    expect(describeArrivals([SPAN])).toBe('span "checkout.pay"');
    expect(
      describeArrivals([
        SPAN,
        { text: "order.id", kind: TelemetryArrivalKind.SpanAttribute },
      ]),
    ).toBe('span "checkout.pay" and span attribute "order.id"');
    expect(
      describeArrivals([
        SPAN,
        { text: "orderId", kind: TelemetryArrivalKind.LogAttribute },
        { text: "Payment captured", kind: TelemetryArrivalKind.LogBody },
        { text: "a.b", kind: TelemetryArrivalKind.SpanName },
        { text: "c.d", kind: TelemetryArrivalKind.SpanName },
      ]),
    ).toBe(
      'span "checkout.pay", log attribute "orderId", log "Payment captured" and 2 more',
    );
  });
});

describe("a fix with nothing to look for", () => {
  test("quotes nothing new and names no service: Unverifiable at once", () => {
    expect(
      decideTelemetryBaseline({ candidateCount: 0, isServiceScoped: false }),
    ).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        "The fix's changes quote no span name, attribute key or log text that was not sent already, and it names no service whose telemetry to follow, so there is nothing to look for in production.",
    });
  });

  test("a service to follow, or a text to look for, is watched", () => {
    expect(
      decideTelemetryBaseline({ candidateCount: 0, isServiceScoped: true }),
    ).toBeNull();
    expect(
      decideTelemetryBaseline({ candidateCount: 2, isServiceScoped: false }),
    ).toBeNull();
  });
});

describe("a deployed telemetry improvement", () => {
  test("what it adds arriving is only Verified after a whole day", () => {
    expect(decide({ now: watched(2), arrivals: [SPAN] })).toEqual({
      status: FixProductionStatus.Watching,
      summary:
        'Version 2.3.2 sends what the fix adds: span "checkout.pay". It counts once the fix has run for a day without stopping the rest of the service\'s telemetry.',
    });
    expect(decide({ now: watched(24), arrivals: [SPAN] })).toEqual({
      status: FixProductionStatus.Verified,
      summary: 'Version 2.3.2 sends what the fix adds: span "checkout.pay".',
    });
  });

  test("a service that starts sending spans is Verified after a day", () => {
    expect(
      decide({
        now: watched(30),
        candidateCount: 0,
        baselineCounts: { spans: 0, logs: 900 },
        sinceCounts: { spans: 400, logs: 120 },
      }),
    ).toEqual({
      status: FixProductionStatus.Verified,
      summary:
        "The service sent no spans in the 7 days before the fix merged, and sends them since version 2.3.2 shipped it.",
    });
  });

  test("a service that sent steadily and sends nothing after a day is Regressed", () => {
    expect(
      decide({
        now: watched(26),
        arrivals: [SPAN],
        sinceCounts: { spans: 0, logs: 0 },
      }),
    ).toEqual({
      status: FixProductionStatus.Regressed,
      summary:
        "The service sent 52,000 spans in the 7 days before the fix merged, and none in the 26 hours since version 2.3.2 shipped it, so the fix stopped them.",
    });
  });

  test("silence is not Regressed within the first day, nor when little was expected", () => {
    expect(
      decide({ now: watched(23), sinceCounts: { spans: 0, logs: 0 } }).status,
    ).toBe(FixProductionStatus.Watching);
    // 600 spans a week is 3.6 an hour: 100 are expected only after 28 hours.
    expect(
      decide({
        now: watched(27),
        baselineCounts: { spans: 600, logs: 0 },
        sinceCounts: { spans: 0, logs: 0 },
      }).status,
    ).toBe(FixProductionStatus.Watching);
    expect(
      decide({
        now: watched(28),
        baselineCounts: { spans: 600, logs: 0 },
        sinceCounts: { spans: 0, logs: 0 },
      }).status,
    ).toBe(FixProductionStatus.Regressed);
  });

  test("only the signals the fix improves are followed", () => {
    expect(
      decide({
        now: watched(30),
        signals: [TelemetryFixSignal.Logs],
        baselineCounts: { spans: 52000, logs: 0 },
        sinceCounts: { spans: 0, logs: 0 },
      }).status,
    ).toBe(FixProductionStatus.Watching);
  });

  test("nothing arriving in a week is Unverifiable", () => {
    expect(decide({ now: watched(7 * 24) })).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        "None of the 4 names it adds arrived in the 7 days since version 2.3.2 shipped the fix: the code that sends them may not have run.",
    });
    expect(decide({ now: watched(7 * 24), candidateCount: 0 }).summary).toBe(
      "The fix's changes quote nothing new to look for, and the service's telemetry kept arriving in the 7 days since version 2.3.2 shipped the fix.",
    );
  });

  test("a project-wide fix is decided by what arrives alone", () => {
    expect(
      decide({
        now: watched(30),
        baselineCounts: null,
        sinceCounts: null,
        arrivals: [SPAN],
      }).status,
    ).toBe(FixProductionStatus.Verified);
    expect(
      decide({ now: watched(30), baselineCounts: null, sinceCounts: null })
        .status,
    ).toBe(FixProductionStatus.Watching);
  });

  test("the watch's words do not change from one check to the next", () => {
    expect(decide({ now: watched(1) })).toEqual(decide({ now: watched(100) }));
    expect(decide({ now: watched(1) }).summary).toBe(
      "Version 2.3.2 shipped the fix; none of the 4 names it adds has arrived yet.",
    );
    expect(decide({ now: watched(1), candidateCount: 1 }).summary).toBe(
      "Version 2.3.2 shipped the fix; none of the 1 name it adds has arrived yet.",
    );
  });

  test("Verified always means something arrived or started, after a day, with no signal stopped", () => {
    const random: SeededRandom = seededRandom(5097);

    for (let draw: number = 0; draw < 2000; draw++) {
      const hours: number = random(8 * 24);
      const baselineCounts: TelemetrySignalCounts = {
        spans: random(3) === 0 ? 0 : random(100000),
        logs: random(3) === 0 ? 0 : random(100000),
      };
      const sinceCounts: TelemetrySignalCounts = {
        spans: random(2) === 0 ? 0 : random(5000),
        logs: random(2) === 0 ? 0 : random(5000),
      };
      const arrivals: Array<TelemetryArrival> = random(2) === 0 ? [] : [SPAN];
      const signals: Array<TelemetryFixSignal> = [
        [TelemetryFixSignal.Spans],
        [TelemetryFixSignal.Logs],
        [TelemetryFixSignal.Spans, TelemetryFixSignal.Logs],
      ][random(3)]!;
      const verdict: FixProductionVerdict = decide({
        now: watched(hours),
        signals,
        arrivals,
        baselineCounts,
        sinceCounts,
      });

      if (verdict.status === FixProductionStatus.Verified) {
        expect(hours).toBeGreaterThanOrEqual(24);
        expect(
          arrivals.length > 0 ||
            signals.some((signal: TelemetryFixSignal): boolean => {
              const key: "spans" | "logs" =
                signal === TelemetryFixSignal.Spans ? "spans" : "logs";

              return baselineCounts[key] === 0 && sinceCounts[key] > 0;
            }),
        ).toBe(true);
      }

      if (verdict.status === FixProductionStatus.Regressed) {
        expect(hours).toBeGreaterThanOrEqual(24);
        expect(
          signals.some((signal: TelemetryFixSignal): boolean => {
            const key: "spans" | "logs" =
              signal === TelemetryFixSignal.Spans ? "spans" : "logs";

            return baselineCounts[key] > 0 && sinceCounts[key] === 0;
          }),
        ).toBe(true);
      }

      if (hours >= 7 * 24) {
        expect(verdict.status).not.toBe(FixProductionStatus.Watching);
      }
    }
  });
});
