import { describe, expect, test } from "@jest/globals";
import {
  describeDropFilterImpact,
  DropFilterImpact,
  DropFilterImpactAction,
  DropFilterImpactHeadline,
  DropFilterRecordCountState,
  getDropFilterHeadlineKind,
  getDropFilterImpactHeadline,
  getDropFilterKeepPercentage,
  getEmptyDropFilterImpact,
  getNeededWhenSampled,
  getSecurityEventsRecordsTaken,
  isDropFilterImpactRead,
  readDropFilterImpact,
} from "../../../Types/Telemetry/DropFilterImpact";
import {
  getEmptyTelemetryFieldReadersByKind,
  SecurityEventsTelemetrySource,
  TelemetryFieldReaderKind,
} from "../../../Types/Telemetry/TelemetryFieldReaders";

/*
 * WHAT A DROP OR SAMPLE FILTER WOULD TAKE, AS AN ANSWER SAYS IT (#10436).
 *
 * The one line the form says first, whether a save asks, the share a
 * sample keeps and what a rule then needs, the answer read defensively,
 * and what an API write is told in English.
 */

const READER_ID: string = "0192f1a0-0000-7000-8000-000000104380";

function impactOf(
  change: (impact: DropFilterImpact) => void = (): void => {},
): DropFilterImpact {
  const impact: DropFilterImpact = getEmptyDropFilterImpact({
    signal: "log",
    action: DropFilterImpactAction.Drop,
    keepPercentage: 0,
    timeLimitInSeconds: 10,
  });

  impact.count = {
    ...impact.count,
    state: DropFilterRecordCountState.Counted,
    total: 1000,
    matched: 120,
    securityEventsRead: null,
  };
  impact.readers = getEmptyTelemetryFieldReadersByKind(true);
  impact.securityEvents.isChecked = true;
  change(impact);

  return impact;
}

describe("the share a filter keeps, and what a rule then needs", () => {
  test("a drop keeps none; a sample its percentage; a sample it cannot honour keeps all", () => {
    expect(getDropFilterKeepPercentage({ action: "drop" })).toBe(0);
    expect(
      getDropFilterKeepPercentage({ action: "sample", samplePercentage: 10 }),
    ).toBe(10);
    expect(
      getDropFilterKeepPercentage({ action: "sample", samplePercentage: 0 }),
    ).toBe(100);
    expect(
      getDropFilterKeepPercentage({ action: "sample", samplePercentage: 100 }),
    ).toBe(100);
    expect(getDropFilterKeepPercentage({ action: "sample" })).toBe(100);
  });

  test("a rule that fires at 10 needs about 100 when a tenth is kept, and rounds up", () => {
    expect(getNeededWhenSampled({ threshold: 10, keepPercentage: 10 })).toBe(
      100,
    );
    expect(getNeededWhenSampled({ threshold: 5, keepPercentage: 30 })).toBe(17);
    expect(getNeededWhenSampled({ threshold: 5, keepPercentage: 0 })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("the one line, the most important effect first", () => {
  test("Security Events reading what it takes comes before every reader", () => {
    const impact: DropFilterImpact = impactOf((value: DropFilterImpact) => {
      value.count.securityEventsRead = 12;
      value.readers[TelemetryFieldReaderKind.Monitor].hiddenCount = 2;
    });

    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.SecurityEvents,
    );
    expect(getSecurityEventsRecordsTaken(impact)).toBe(12);
    expect(isDropFilterImpactRead(impact)).toBe(true);
  });

  test("then the readers, monitors first, then SLOs, dashboards, recording rules and saved views", () => {
    const impact: DropFilterImpact = impactOf((value: DropFilterImpact) => {
      value.readers[TelemetryFieldReaderKind.SavedView].readers = [
        { id: READER_ID, name: "Errors", reads: [] },
      ];
      value.readers[TelemetryFieldReaderKind.Dashboard].hiddenCount = 1;
    });

    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.Readers,
    );
    expect(getDropFilterHeadlineKind(impact)).toBe(
      TelemetryFieldReaderKind.Dashboard,
    );
  });

  test("then how much it matches with nothing reading it, or that it matched nothing", () => {
    expect(getDropFilterImpactHeadline(impactOf())).toBe(
      DropFilterImpactHeadline.Unread,
    );
    expect(
      getDropFilterImpactHeadline(
        impactOf((value: DropFilterImpact) => {
          value.count.matched = 0;
        }),
      ),
    ).toBe(DropFilterImpactHeadline.NoMatch);
    expect(isDropFilterImpactRead(impactOf())).toBe(false);
  });

  test("an unknown count, with nothing found reading it, says the count was not made", () => {
    expect(
      getDropFilterImpactHeadline(
        impactOf((value: DropFilterImpact) => {
          value.count.state = DropFilterRecordCountState.TimedOut;
          value.count.securityEventsRead = 50;
        }),
      ),
    ).toBe(DropFilterImpactHeadline.Uncounted);
  });

  test("an unreadable query takes nothing, whatever else is said", () => {
    const impact: DropFilterImpact = impactOf((value: DropFilterImpact) => {
      value.isQueryReadable = false;
      value.count.securityEventsRead = 5;
    });

    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.Unreadable,
    );
    expect(getSecurityEventsRecordsTaken(impact)).toBe(0);
    expect(isDropFilterImpactRead(impact)).toBe(false);
  });

  test("one of OneUptime's own OpenStack filters takes nothing Security Events reads", () => {
    const impact: DropFilterImpact = impactOf((value: DropFilterImpact) => {
      value.count.securityEventsRead = 5;
      value.securityEvents.keepsWhatSecurityEventsReads = true;
    });

    expect(getSecurityEventsRecordsTaken(impact)).toBe(0);
    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.Unread,
    );
  });
});

describe("the answer, read defensively", () => {
  test("an answer as the server writes it reads back as it was", () => {
    const impact: DropFilterImpact = impactOf((value: DropFilterImpact) => {
      value.action = DropFilterImpactAction.Sample;
      value.keepPercentage = 10;
      value.count.securityEventsRead = 7;
      value.securityEvents.sources = [SecurityEventsTelemetrySource.Logs];
      value.securityEvents.thresholdRules = {
        rules: [
          {
            id: "rule-1",
            name: "Brute force",
            threshold: 10,
            windowInMinutes: 5,
            neededWhenSampled: 100,
            countsDistinct: false,
          },
        ],
        hiddenCount: 1,
        isChecked: true,
      };
      value.readers[TelemetryFieldReaderKind.Monitor].readers = [
        { id: READER_ID, name: "Errors", reads: [] },
      ];
    });

    expect(readDropFilterImpact(JSON.parse(JSON.stringify(impact)))).toEqual(
      impact,
    );
  });

  test("anything else is said to be unknown, never nothing", () => {
    const read: DropFilterImpact = readDropFilterImpact({
      signal: "metric",
      action: "delete",
      keepPercentage: 500,
      count: { state: "huh", matched: -5, total: "many" },
      readers: "none",
      securityEvents: { sources: ["logs", "elsewhere"], thresholdRules: 3 },
    });

    expect(read.signal).toBe("log");
    expect(read.action).toBe(DropFilterImpactAction.Drop);
    expect(read.keepPercentage).toBe(0);
    expect(read.count.state).toBe(DropFilterRecordCountState.Failed);
    expect(read.count.matched).toBe(0);
    expect(read.count.total).toBe(0);
    expect(read.count.securityEventsRead).toBeNull();
    expect(read.securityEvents.isChecked).toBe(false);
    expect(read.securityEvents.sources).toEqual([
      SecurityEventsTelemetrySource.Logs,
    ]);

    for (const kind of Object.values(TelemetryFieldReaderKind)) {
      expect(read.readers[kind].isChecked).toBe(false);
    }

    expect(readDropFilterImpact(undefined).count.state).toBe(
      DropFilterRecordCountState.Failed,
    );
  });
});

describe("what an API write is told, in English", () => {
  test("nothing when nothing reads what it takes", () => {
    expect(describeDropFilterImpact(impactOf())).toBeNull();
  });

  test("Security Events' share of the matched records and every kind of reader, in counts", () => {
    const impact: DropFilterImpact = impactOf((value: DropFilterImpact) => {
      value.count.matched = 45300;
      value.count.securityEventsRead = 1240;
      value.readers[TelemetryFieldReaderKind.Monitor].hiddenCount = 2;
      value.readers[TelemetryFieldReaderKind.ServiceLevelObjective].readers = [
        { id: READER_ID, name: "Checkout success", reads: [] },
      ];
    });

    expect(describeDropFilterImpact(impact)).toBe(
      "Security Events read 1,240 of the 45,300 logs this filter matched in the last day, and 2 monitors and 1 SLO read logs this filter drops. Ask POST /api/telemetry/logs/drop-filter-impact with the filter for which.",
    );
  });

  test("a sample says the share it keeps; a span filter speaks of spans", () => {
    const impact: DropFilterImpact = impactOf((value: DropFilterImpact) => {
      value.signal = "trace";
      value.action = DropFilterImpactAction.Sample;
      value.keepPercentage = 10;
      value.readers[TelemetryFieldReaderKind.Dashboard].hiddenCount = 1;
      value.readers[TelemetryFieldReaderKind.RecordingRule].hiddenCount = 3;
      value.readers[TelemetryFieldReaderKind.SavedView].hiddenCount = 2;
    });

    expect(describeDropFilterImpact(impact)).toBe(
      "1 dashboard, 3 recording rules and 2 saved views read spans this filter keeps only 10% of. Ask POST /api/telemetry/traces/drop-filter-impact with the filter for which.",
    );
  });

  test("it never names a reader: a name is the person's, and a header line is plain text", () => {
    const impact: DropFilterImpact = impactOf((value: DropFilterImpact) => {
      value.readers[TelemetryFieldReaderKind.Monitor].readers = [
        { id: READER_ID, name: "Café checkout ✓", reads: [] },
      ];
    });

    expect(describeDropFilterImpact(impact)).not.toContain("Café");
  });
});
