/** @timezone Asia/Tokyo */

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import OneUptimeDate from "../../../../Types/Date";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../../Types/DateLanguage";
import Timezone from "../../../../Types/Timezone";
import {
  describeExportBucketTimezone,
  formatExportPointTime,
  getExportChartBucketTimezone,
} from "../../../../UI/Utils/AIChatExport/ChatWidgetData";
import { widgetToMarkdown } from "../../../../UI/Utils/AIChatExport/ChatWidgetMarkdown";
import PdfChart, {
  formatTimeLabel,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfChart";
import PdfDocument from "../../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfDocument";

/*
 * AN EXPORTED ASK AI CHART NAMES ITS DAYS WHERE THEY WERE CUT, AND ITS
 * TIMES IN THE READER'S ZONE (issues #8206, #8231).
 *
 * The Markdown and PDF exports of a chat are files, read anywhere. A chart
 * of days cut in the asker's zone (or UTC's, for a run with no reader)
 * names each day by its date there and says whose days they are, as the
 * chart on screen does. A chart of finer buckets writes each point's moment
 * in the reader's zone, and names the zone: the Markdown wrote the
 * browser's toLocaleString - the browser's zone, unnamed, on the
 * language's clock - and the PDF's axis read the browser's zone whatever
 * the reader had picked. The browser runs in Tokyo here (the docblock):
 * nothing below may come from it.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

// New York's midnights from 30 October, over its 1 November change.
const NEW_YORK_DAYS: Array<string> = [
  "2026-10-30T04:00:00.000Z",
  "2026-10-31T04:00:00.000Z",
  "2026-11-01T04:00:00.000Z",
  "2026-11-02T05:00:00.000Z",
  "2026-11-03T05:00:00.000Z",
];

function chart(data: {
  points: Array<string>;
  bucketTimezone?: string | undefined;
  type?: AIChatWidgetType | undefined;
  xIsTime?: boolean | undefined;
}): AIChatWidget {
  return {
    id: "W1",
    type: data.type || AIChatWidgetType.TimeSeriesChart,
    title: "Sum of checkout.orders",
    data: {
      series: [
        {
          name: "orders",
          points: data.points.map((x: string, index: number) => {
            return { x, y: index + 1 };
          }),
        },
      ],
      xIsTime: data.xIsTime ?? true,
      ...(data.bucketTimezone ? { bucketTimezone: data.bucketTimezone } : {}),
    },
  };
}

// An axis label that names a day: "Oct 30".
const DAY_LABEL: RegExp = /^(Oct|Nov) \d+$/;

// A table's header and the line under it.
const HEADER_OR_DIVIDER: RegExp = /^\| (Time|Category|-+) \|/;

// The first column of a Markdown chart's table rows.
function rowTimes(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("| ") && !HEADER_OR_DIVIDER.test(line);
    })
    .map((line: string): string => {
      return line.split(" | ")[0]!.replace(/^\| /, "");
    });
}

function readAs(zone: Timezone, use12HourClock: boolean = true): void {
  OneUptimeDate.setUserTimezone(zone);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourClock);
}

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
  jest.restoreAllMocks();
});

describe("the Markdown export", () => {
  test("a chart of New York's days, read in Los Angeles: each day by its New York date, and whose days they are", () => {
    readAs(Timezone.AmericaLos_Angeles);

    const markdown: string = widgetToMarkdown(
      chart({
        points: NEW_YORK_DAYS,
        bucketTimezone: Timezone.AmericaNew_York,
      }),
    );

    expect(rowTimes(markdown)).toEqual([
      "Oct 30, 2026",
      "Oct 31, 2026",
      "Nov 1, 2026",
      "Nov 2, 2026",
      "Nov 3, 2026",
    ]);
    expect(markdown).toContain("_Days are in America/New_York._");
  });

  test("an investigation's UTC days, read in New York: each by its UTC date", () => {
    readAs(Timezone.AmericaNew_York);

    const markdown: string = widgetToMarkdown(
      chart({
        points: ["2026-11-04T00:00:00.000Z", "2026-11-05T00:00:00.000Z"],
        bucketTimezone: Timezone.UTC,
      }),
    );

    expect(rowTimes(markdown)).toEqual(["Nov 4, 2026", "Nov 5, 2026"]);
    expect(markdown).toContain("_Days are in UTC._");
  });

  test("a chart of finer buckets: each moment in the reader's zone, named, on their clock", () => {
    readAs(Timezone.AmericaNew_York, true);

    const points: Array<string> = [
      "2026-11-05T05:14:00.000Z",
      "2026-11-05T17:14:00.000Z",
    ];

    expect(rowTimes(widgetToMarkdown(chart({ points })))).toEqual([
      "Nov 5, 2026, 12:14 AM EST",
      "Nov 5, 2026, 12:14 PM EST",
    ]);

    readAs(Timezone.AsiaKathmandu, false);

    expect(rowTimes(widgetToMarkdown(chart({ points })))).toEqual([
      "Nov 5, 2026, 10:59 GMT+0545",
      "Nov 5, 2026, 22:59 GMT+0545",
    ]);
    expect(widgetToMarkdown(chart({ points }))).not.toContain("Days are in");
  });

  test("in the reader's language, as the chat writes its dates", () => {
    readAs(Timezone.AmericaNew_York, false);
    setDateDisplayLanguage("de");

    expect(
      rowTimes(
        widgetToMarkdown(
          chart({
            points: NEW_YORK_DAYS.slice(0, 1),
            bucketTimezone: Timezone.AmericaNew_York,
          }),
        ),
      ),
    ).toEqual(["30. Okt. 2026"]);
  });

  test("a chart of categories is written by its categories, whatever zone it kept", () => {
    readAs(Timezone.AmericaLos_Angeles);

    const markdown: string = widgetToMarkdown(
      chart({
        points: ["checkout", "cart"],
        bucketTimezone: Timezone.AmericaNew_York,
        type: AIChatWidgetType.BarChart,
        xIsTime: false,
      }),
    );

    expect(rowTimes(markdown)).toEqual(["checkout", "cart"]);
    expect(markdown).not.toContain("Days are in");
  });
});

describe("what both exports share (ChatWidgetData)", () => {
  test("the zone a chart's days were cut in: only for a time chart that kept a listed one", () => {
    expect(
      getExportChartBucketTimezone(
        chart({ points: [], bucketTimezone: "Asia/Calcutta" }),
      ),
    ).toBe(Timezone.AsiaKolkata);
    expect(
      getExportChartBucketTimezone(
        chart({ points: [], bucketTimezone: "Mars/Olympus_Mons" }),
      ),
    ).toBeUndefined();
    expect(getExportChartBucketTimezone(chart({ points: [] }))).toBeUndefined();
    expect(
      getExportChartBucketTimezone(
        chart({ points: [], bucketTimezone: Timezone.UTC, xIsTime: false }),
      ),
    ).toBeUndefined();
  });

  test("a point's time: its day where it was cut, or its moment in the reader's zone, named", () => {
    readAs(Timezone.AmericaLos_Angeles, true);
    const newYorkMidnight: Date = new Date("2026-11-05T05:00:00.000Z");

    expect(
      formatExportPointTime(newYorkMidnight, Timezone.AmericaNew_York),
    ).toBe("Nov 5, 2026");
    expect(formatExportPointTime(newYorkMidnight)).toBe(
      "Nov 4, 2026, 9:00 PM PST",
    );
    expect(describeExportBucketTimezone(Timezone.UTC)).toBe("Days are in UTC.");
  });
});

describe("the PDF export's time axis (PdfChart.formatTimeLabel)", () => {
  const NEW_YORK_MIDNIGHT: Date = new Date("2026-11-05T05:00:00.000Z");

  test("a day is named in the zone it is given: New York's 5 November is the 5th there and the 4th in Los Angeles", () => {
    expect(
      formatTimeLabel(NEW_YORK_MIDNIGHT, 30 * DAY, Timezone.AmericaNew_York),
    ).toBe("Nov 5");
    expect(
      formatTimeLabel(NEW_YORK_MIDNIGHT, 30 * DAY, Timezone.AmericaLos_Angeles),
    ).toBe("Nov 4");
  });

  test("with no zone given, the reader's - not the browser's, which is Tokyo's", () => {
    readAs(Timezone.AmericaLos_Angeles);
    expect(formatTimeLabel(NEW_YORK_MIDNIGHT, 30 * DAY)).toBe("Nov 4");

    readAs(Timezone.UTC);
    expect(formatTimeLabel(NEW_YORK_MIDNIGHT, 30 * DAY)).toBe("Nov 5");
    // Tokyo would say 14:00: the hour is UTC's, the reader's.
    expect(formatTimeLabel(NEW_YORK_MIDNIGHT, HOUR).replace(/\s/g, " ")).toBe(
      "5:00 AM",
    );
  });

  test("a zone the browser's Intl does not know falls back to the browser's, rather than failing", () => {
    expect(
      formatTimeLabel(NEW_YORK_MIDNIGHT, 30 * DAY, "Mars/Olympus_Mons"),
    ).toBe("Nov 5");
  });
});

describe("the PDF export draws a chart of days by their own dates, and says whose", () => {
  interface Drawn {
    texts: Array<string>;
    paragraphs: Array<string>;
  }

  // A PdfDocument that records what is written on it.
  function recordingPdf(): { pdf: PdfDocument; drawn: Drawn } {
    const drawn: Drawn = { texts: [], paragraphs: [] };
    const doc: Record<string, unknown> = {
      text: (text: string): void => {
        drawn.texts.push(text);
      },
    };

    for (const method of [
      "line",
      "rect",
      "setDrawColor",
      "setFillColor",
      "setLineCap",
      "setLineDashPattern",
      "setLineJoin",
      "setLineWidth",
    ]) {
      doc[method] = (): void => {};
    }

    const pdf: Record<string, unknown> = {
      doc,
      left: 40,
      right: 560,
      y: 100,
      contentWidth: 520,
      ensureSpace: (): void => {},
      setStyle: (): void => {},
      sanitize: (text: string): string => {
        return text;
      },
      textWidth: (text: string): number => {
        return text.length * 3;
      },
      lineHeight: (): number => {
        return 10;
      },
      circle: (): void => {},
      drawLine: (): void => {},
      hairline: (): void => {},
      moveDown: (): void => {},
      paragraph: (text: string): void => {
        drawn.paragraphs.push(text);
      },
    };

    return { pdf: pdf as unknown as PdfDocument, drawn };
  }

  test.each<[string, AIChatWidgetType]>([
    ["a line chart", AIChatWidgetType.TimeSeriesChart],
    ["a bar chart", AIChatWidgetType.BarChart],
  ])(
    "%s of New York's days, exported in Los Angeles",
    (_name: string, type: AIChatWidgetType) => {
      readAs(Timezone.AmericaLos_Angeles);
      const { pdf, drawn } = recordingPdf();

      new PdfChart(pdf).draw(
        chart({
          points: NEW_YORK_DAYS,
          bucketTimezone: Timezone.AmericaNew_York,
          type,
        }),
      );

      // Only New York's dates: Los Angeles' would start at Oct 29.
      const dayLabels: Array<string> = drawn.texts.filter((text: string) => {
        return DAY_LABEL.test(text);
      });

      expect(dayLabels.length).toBeGreaterThan(0);
      expect(dayLabels).not.toContain("Oct 29");
      expect(dayLabels[0]).toBe("Oct 30");
      expect(drawn.paragraphs).toEqual(["Days are in America/New_York."]);
    },
  );

  test("a chart that kept no zone says nothing, and names its days in the reader's zone", () => {
    readAs(Timezone.AmericaLos_Angeles);
    const { pdf, drawn } = recordingPdf();

    new PdfChart(pdf).draw(
      chart({ points: NEW_YORK_DAYS, type: AIChatWidgetType.BarChart }),
    );

    expect(drawn.texts).toContain("Oct 29");
    expect(drawn.paragraphs).toEqual([]);
  });
});
