/** @timezone Asia/Tokyo */
// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN ASK AI CHART DRAWS EACH DAY WHERE IT COUNTED, AND SAYS WHOSE DAYS THEY
 * ARE WHEN THEY ARE NOT THE READER'S (issue #8206).
 *
 * A chat chart is a snapshot of what a tool read, stored with the answer
 * and drawn later for whoever opens it: every responder of an incident's
 * shared investigation thread, wherever they are, and everyone who reads
 * an autonomous investigation's evidence. Its day buckets were cut in the
 * asker's zone, or in UTC for a run with no reader. Drawn at its instants
 * on the reader's calendar, a New York day - from 05:00 UTC - sat under the
 * day before in Los Angeles, and each UTC day of an investigation's chart
 * under the day before in New York.
 *
 * ChartWidget draws each bucket at the start of the same date on the
 * reader's calendar (AIChatChartCalendar), from the zone the widget kept
 * (AIChatWidgetData.bucketTimezone), and above the chart says "Days are in
 * America/New_York." when that is not the reader's zone. The chart
 * wrappers are stood in for by components that hand back what they were
 * given. The browser runs in Tokyo (the docblock), which is none of the
 * zones the readers picked, so nothing here can come from it.
 */

const lineChartRenderMock: MockFunction = getJestMockFunction();
const barChartRenderMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (props: unknown): React.ReactElement => {
      lineChartRenderMock(props);
      return react.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

jest.mock("../../../UI/Components/Charts/Bar/BarChart", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (props: unknown): React.ReactElement => {
      barChartRenderMock(props);
      return react.createElement("div", { "data-testid": "bar-chart" });
    },
  };
});

import ChartWidget from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/ChartWidget";
import { AIChatWidget, AIChatWidgetType } from "../../../Types/AI/AIChatTypes";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import DataPoint from "../../../UI/Components/Charts/Types/DataPoint";

const CAPTION_TEST_ID: string = "ai-chart-bucket-timezone";
const CAPTION_KEY: string = "Days are in {{timezone}}.";

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

interface WallClock {
  date: string;
  time: string;
}

// The date and time of day `date` reads in `timezone`, on the platform's clock.
function wallClock(date: Date, timezone: string): WallClock {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    },
  ).formatToParts(date);
  const part: (type: string) => string = (type: string): string => {
    return parts.find((item: Intl.DateTimeFormatPart): boolean => {
      return item.type === type;
    })!.value;
  };

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

// The start of each of `count` days in `timezone` from `from`: the server's day buckets there.
function dayStarts(from: string, count: number, timezone: string): Array<Date> {
  const starts: Array<Date> = [];
  let ms: number = Date.parse(`${from}T12:00:00.000Z`);

  for (let index: number = 0; index < count; index++) {
    const day: string = wallClock(new Date(ms), timezone).date;
    let start: number = Math.floor(ms / MINUTE) * MINUTE;

    while (wallClock(new Date(start - MINUTE), timezone).date === day) {
      start -= MINUTE;
    }

    starts.push(new Date(start));
    ms += DAY;
  }

  return starts;
}

/*
 * A month of days cut in `timezone` - over New York's 1 November change -
 * as query_metrics charts them, its value the day's date of the month.
 */
function dayChart(data: {
  timezone: string;
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
          name: "Sum(checkout.orders)",
          points: dayStarts("2026-10-16", 30, data.timezone).map(
            (start: Date) => {
              return {
                x: start.toISOString(),
                y: Number(wallClock(start, data.timezone).date.slice(8, 10)),
              };
            },
          ),
        },
      ],
      xIsTime: data.xIsTime ?? true,
      ...(data.bucketTimezone ? { bucketTimezone: data.bucketTimezone } : {}),
    },
  };
}

function drawn(mock: MockFunction = lineChartRenderMock): Array<DataPoint> {
  const props: { data: Array<SeriesPoint> } = mock.mock.calls[
    mock.mock.calls.length - 1
  ]![0] as { data: Array<SeriesPoint> };

  return props.data.flatMap((series: SeriesPoint): Array<DataPoint> => {
    return series.data;
  });
}

function caption(): HTMLElement | null {
  return screen.queryByTestId(CAPTION_TEST_ID);
}

beforeEach(() => {
  lineChartRenderMock.mockClear();
  barChartRenderMock.mockClear();
});

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(null);
});

describe("a chart of days cut in another reader's zone", () => {
  test("asked in New York, read in Los Angeles: each day under the date it counted, at Los Angeles' midnight", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaLos_Angeles);
    const widget: AIChatWidget = dayChart({
      timezone: Timezone.AmericaNew_York,
      bucketTimezone: Timezone.AmericaNew_York,
    });

    render(<ChartWidget widget={widget} />);

    const points: Array<DataPoint> = drawn();
    expect(points).toHaveLength(30);

    for (const point of points) {
      const clock: WallClock = wallClock(point.x, Timezone.AmericaLos_Angeles);

      expect(clock.time).toBe("00:00");
      // The point's value is the New York date it counted.
      expect(Number(clock.date.slice(8, 10))).toBe(point.y);
    }

    expect(caption()).toHaveTextContent("Days are in America/New_York.");
  });

  test("drawn at its instants, as before, each of those days sat under the day before", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaLos_Angeles);

    const before: Array<Date> = dayStarts(
      "2026-10-16",
      30,
      Timezone.AmericaNew_York,
    );

    for (const start of before) {
      const newYork: number = Number(
        wallClock(start, Timezone.AmericaNew_York).date.slice(8, 10),
      );
      const losAngeles: number = Number(
        wallClock(start, Timezone.AmericaLos_Angeles).date.slice(8, 10),
      );

      expect(losAngeles).not.toBe(newYork);
    }
  });

  test("read in New York itself, nothing moves and nothing is said", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
    const widget: AIChatWidget = dayChart({
      timezone: Timezone.AmericaNew_York,
      bucketTimezone: Timezone.AmericaNew_York,
    });

    render(<ChartWidget widget={widget} />);

    expect(
      drawn().map((point: DataPoint): string => {
        return point.x.toISOString();
      }),
    ).toEqual(
      widget.data.series![0]!.points.map((point: { x: string }): string => {
        return point.x;
      }),
    );
    expect(caption()).toBeNull();
  });

  test("an autonomous investigation's UTC days read in New York: each under its own date, and said to be UTC's", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    render(
      <ChartWidget
        widget={dayChart({
          timezone: Timezone.UTC,
          bucketTimezone: Timezone.UTC,
        })}
      />,
    );

    for (const point of drawn()) {
      const clock: WallClock = wallClock(point.x, Timezone.AmericaNew_York);

      expect(clock.time).toBe("00:00");
      expect(Number(clock.date.slice(8, 10))).toBe(point.y);
    }

    expect(caption()).toHaveTextContent("Days are in UTC.");
  });

  test("UTC's days read in Kathmandu, 45 minutes off the hour: at its midnight, 18:15 UTC the day before", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKathmandu);

    render(
      <ChartWidget
        widget={dayChart({
          timezone: Timezone.UTC,
          bucketTimezone: Timezone.UTC,
        })}
      />,
    );

    for (const point of drawn()) {
      expect(point.x.toISOString().slice(11)).toBe("18:15:00.000Z");
      expect(
        Number(wallClock(point.x, Timezone.AsiaKathmandu).date.slice(8, 10)),
      ).toBe(point.y);
    }

    expect(caption()).toHaveTextContent("Days are in UTC.");
  });

  test("UTC's days read in London in winter are London's: nothing is said", () => {
    OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
    const widget: AIChatWidget = {
      ...dayChart({ timezone: Timezone.UTC, bucketTimezone: Timezone.UTC }),
    };
    widget.data.series![0]!.points = dayStarts(
      "2026-12-01",
      10,
      Timezone.UTC,
    ).map((start: Date) => {
      return { x: start.toISOString(), y: 1 };
    });

    render(<ChartWidget widget={widget} />);

    expect(caption()).toBeNull();
  });

  test("a bar chart of days moves its bars the same way", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaLos_Angeles);

    render(
      <ChartWidget
        widget={dayChart({
          timezone: Timezone.AmericaNew_York,
          bucketTimezone: Timezone.AmericaNew_York,
          type: AIChatWidgetType.BarChart,
        })}
      />,
    );

    for (const point of drawn(barChartRenderMock)) {
      expect(wallClock(point.x, Timezone.AmericaLos_Angeles).time).toBe(
        "00:00",
      );
    }
    expect(caption()).toHaveTextContent("Days are in America/New_York.");
  });
});

describe("a chart that kept no zone is drawn as it was", () => {
  test.each<[string, string | undefined]>([
    ["one saved before the zone was kept", undefined],
    ["one whose zone is no listed zone", "Mars/Olympus_Mons"],
  ])("%s", (_name: string, bucketTimezone: string | undefined) => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaLos_Angeles);
    const widget: AIChatWidget = dayChart({
      timezone: Timezone.AmericaNew_York,
      bucketTimezone,
    });

    render(<ChartWidget widget={widget} />);

    expect(
      drawn().map((point: DataPoint): string => {
        return point.x.toISOString();
      }),
    ).toEqual(
      widget.data.series![0]!.points.map((point: { x: string }): string => {
        return point.x;
      }),
    );
    expect(caption()).toBeNull();
  });

  test("a chart of categories ignores a zone, and has no time row to say it in", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaLos_Angeles);

    render(
      <ChartWidget
        widget={dayChart({
          timezone: Timezone.AmericaNew_York,
          bucketTimezone: Timezone.AmericaNew_York,
          type: AIChatWidgetType.BarChart,
          xIsTime: false,
        })}
      />,
    );

    expect(caption()).toBeNull();
  });
});

describe("the caption, in every language", () => {
  const LOCALES: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  test("every Dashboard language words it, and keeps the zone's place", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files.length).toBeGreaterThanOrEqual(18);

    for (const file of files) {
      const words: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES, file), "utf8"),
      ) as Record<string, unknown>;
      const text: unknown = words[CAPTION_KEY];

      expect({ file, text: typeof text }).toEqual({ file, text: "string" });
      expect((text as string).match(/\{\{timezone\}\}/g)).toHaveLength(1);

      if (file !== "en.json") {
        expect({ file, text }).not.toEqual({ file, text: CAPTION_KEY });
      }
    }
  });
});
