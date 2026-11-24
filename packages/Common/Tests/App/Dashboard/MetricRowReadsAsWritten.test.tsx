import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import MetricRow from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow";
import { SparklinePoint } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricSparkline";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import { getMetricRowCaption } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import { formatMinutesAgo } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryLiveness";
import {
  CLOUD_RESOURCE_HOURLY_ROW_CAPTION,
  CLOUD_RESOURCE_SIX_HOURLY_ROW_CAPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * #6410's UI review: on a Persian page a Service Bus namespace's Metrics
 * tab read "Count 65" beside "4.95K Count" - a number, a space and a Latin
 * unit in a right-to-left line put the unit first - and each provider's
 * English description put its full stop at its start (".Count of active
 * messages in a Queue/Topic"). A row's value reads left to right on every
 * page now, and its description the way most of its letters do. jsdom lays
 * out no text, so this holds the row to the marks a browser orders them by.
 */

const POINTS: Array<SparklinePoint> = [
  { time: "2026-11-09T11:00:00.000Z", value: 60 },
  { time: "2026-11-09T11:15:00.000Z", value: 65 },
];

const ACTIVE_MESSAGES: MetricType = {
  name: "azure_activemessages_average",
  unit: "Count",
  description: "Count of active messages in a Queue/Topic.",
} as MetricType;

afterEach(() => {
  cleanup();
});

describe("a metric row on any page", () => {
  test("its value and unit read left to right, in an isolate of their own", () => {
    render(
      <MetricRow
        metric={ACTIVE_MESSAGES}
        sparklinePoints={POINTS}
        lastValue={65}
        valueCaption="total of series"
      />,
    );

    const value: HTMLElement = screen.getByTestId("metric-row-value-number");
    expect(value.tagName).toBe("BDI");
    expect(value).toHaveAttribute("dir", "ltr");
    expect(value).toHaveTextContent("65");
    expect(value).toHaveTextContent("Count");
    /*
     * Its own font-mono: every page's `* { font-family: Inter }` (index.ejs)
     * outranks the one it would inherit, and the isolate was drawn in Inter.
     */
    expect(value).toHaveClass("font-mono");
    // The caption under it is the page's words, read the page's way.
    expect(
      screen.getByTestId("metric-row-value-caption").closest("bdi"),
    ).toBeNull();
  });

  test("a value with a suffix keeps it in the same isolate", () => {
    render(
      <MetricRow
        metric={{ name: "http.server.requests", unit: "" } as MetricType}
        sparklinePoints={POINTS}
        lastValue={12}
        valueSuffix="/s"
      />,
    );

    const value: HTMLElement = screen.getByTestId("metric-row-value-number");
    expect(value).toHaveAttribute("dir", "ltr");
    expect(value.textContent?.endsWith("/s")).toBe(true);
  });

  test.each([
    ["an English description", ACTIVE_MESSAGES.description!, "ltr"],
    ["a Persian description", "تعداد پیام‌های فعال در صف.", "rtl"],
  ])(
    "%s reads the way it is written",
    (_kind: string, description: string, direction: string) => {
      render(
        <MetricRow
          metric={{ ...ACTIVE_MESSAGES, description } as MetricType}
          sparklinePoints={POINTS}
          lastValue={65}
        />,
      );

      const text: HTMLElement = screen.getByText(description);
      expect(text.tagName).toBe("BDI");
      expect(text).toHaveAttribute("dir", direction);
      expect(text.closest("p")).not.toBeNull();
    },
  );
});

/*
 * #10026: a key metric that comes once an hour or every six hours says so
 * under its value, with how long ago its newest reading is: "every hour ·
 * 2h ago". A row with no time for it says its caption alone.
 */
describe("a row of a metric that comes seldom", () => {
  const NOW: Date = new Date("2026-11-09T12:00:00.000Z");
  const ENGLISH: Translator = createTranslator(undefined, "en");

  test("its caption, then how long ago its newest reading is", () => {
    expect(
      getMetricRowCaption({
        caption: CLOUD_RESOURCE_HOURLY_ROW_CAPTION,
        captionSince: "2026-11-09T09:40:00.000Z",
        translator: ENGLISH,
        now: NOW,
      }),
    ).toBe(
      `${CLOUD_RESOURCE_HOURLY_ROW_CAPTION} · ${formatMinutesAgo(140, ENGLISH)}`,
    );
    expect(
      getMetricRowCaption({
        caption: CLOUD_RESOURCE_SIX_HOURLY_ROW_CAPTION,
        captionSince: "2026-11-08T20:00:00.000Z",
        translator: ENGLISH,
        now: NOW,
      }),
    ).toContain(formatMinutesAgo(16 * 60, ENGLISH));
  });

  test("no time, or none that reads as one: the caption alone; no caption, nothing", () => {
    for (const captionSince of [undefined, "", "yesterday"]) {
      expect(
        getMetricRowCaption({
          caption: CLOUD_RESOURCE_HOURLY_ROW_CAPTION,
          captionSince,
          translator: ENGLISH,
          now: NOW,
        }),
      ).toBe(CLOUD_RESOURCE_HOURLY_ROW_CAPTION);
    }

    expect(
      getMetricRowCaption({
        caption: undefined,
        captionSince: "2026-11-09T09:40:00.000Z",
        translator: ENGLISH,
        now: NOW,
      }),
    ).toBeUndefined();
  });

  test("a reading stamped ahead of the clock is just now, never in the future", () => {
    expect(
      getMetricRowCaption({
        caption: CLOUD_RESOURCE_HOURLY_ROW_CAPTION,
        captionSince: "2026-11-09T12:03:00.000Z",
        translator: ENGLISH,
        now: NOW,
      }),
    ).toBe(
      `${CLOUD_RESOURCE_HOURLY_ROW_CAPTION} · ${formatMinutesAgo(0, ENGLISH)}`,
    );
  });

  test("the row draws it under its value, as the page's words", () => {
    render(
      <MetricRow
        metric={
          {
            name: "azure_filesystemusage_average",
            unit: "Bytes",
          } as MetricType
        }
        sparklinePoints={POINTS}
        lastValue={65}
        valueCaption={CLOUD_RESOURCE_SIX_HOURLY_ROW_CAPTION}
        valueCaptionSince={new Date(
          Date.now() - 3 * 60 * 60 * 1000,
        ).toISOString()}
      />,
    );

    const caption: HTMLElement = screen.getByTestId("metric-row-value-caption");

    expect(caption).toHaveTextContent(
      `${CLOUD_RESOURCE_SIX_HOURLY_ROW_CAPTION} · ${formatMinutesAgo(180)}`,
    );
    expect(caption.closest("bdi")).toBeNull();
  });
});
