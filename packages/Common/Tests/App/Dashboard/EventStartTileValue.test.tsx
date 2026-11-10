import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import EventStartTileValue from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStartTileValue";
import OneUptimeDate from "../../../Types/Date";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import Timezone from "../../../Types/Timezone";

/*
 * The value of the tile that opens an overview's stat bar - when the record
 * was declared or created: the date and the time, each held together, then
 * the time zone, smaller and quieter, after a plain space a narrow tile may
 * break at. At 640px, three tiles to a row, "06:01 PM GMT" in the value's
 * size did not fit, and the zone broke in the middle ("GM" over "T").
 */

const NBSP: string = String.fromCharCode(0xa0);

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage("en");
  jest.restoreAllMocks();
});

describe("EventStartTileValue", () => {
  test("draws the date and the time, then the zone, smaller and quieter", () => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-09-14T18:20:00.000Z"));

    render(
      <EventStartTileValue startedAt={new Date("2026-09-14T18:01:00.000Z")} />,
    );

    expect(screen.getByTestId("event-start-tile-value").textContent).toBe(
      `Sep${NBSP}14, 06:01${NBSP}PM UTC`,
    );

    const zone: HTMLElement = screen.getByTestId("event-start-tile-zone");

    expect(zone).toHaveTextContent("UTC");
    // Smaller and quieter than the value it follows.
    expect(zone.className).toContain("text-sm");
    expect(zone.className).toContain("text-gray-500");
  });

  test("balances its lines, so a tile too narrow for one breaks after the date, not before the zone", () => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-09-14T18:20:00.000Z"));

    render(
      <EventStartTileValue startedAt={new Date("2026-09-14T18:01:00.000Z")} />,
    );

    /*
     * "Sep 14," over "06:01 PM UTC" rather than "Sep 14, 06:01 PM" over a
     * lone "UTC" (an episode's four tiles at 1280px): text-wrap: balance
     * applies to a block, so the value is one.
     */
    expect(screen.getByTestId("event-start-tile-value")).toHaveClass(
      "block",
      "text-balance",
    );
  });

  test("a time with no zone to name draws the date and the time alone", () => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-09-14T18:20:00.000Z"));
    jest.spyOn(OneUptimeDate, "getZoneAbbrByTimezone").mockReturnValue("");

    render(
      <EventStartTileValue startedAt={new Date("2026-09-14T18:01:00.000Z")} />,
    );

    expect(screen.getByTestId("event-start-tile-value").textContent).toBe(
      `Sep${NBSP}14, 18:01`,
    );
    expect(screen.queryByTestId("event-start-tile-zone")).toBeNull();
  });
});

/*
 * The date and the time are joined by the comma of the script the date is
 * written in. Joined with English's, an Arabic tile read "14 سبتمبر, 06:01
 * م" - a Latin comma in an Arabic line - and a Persian one the same. Every
 * other language keeps the comma and space it had.
 */
describe("EventStartTileValue in another language", () => {
  type ValueInFunction = (language: string) => string;

  const valueIn: ValueInFunction = (language: string): string => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    setDateDisplayLanguage(language);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-09-14T18:20:00.000Z"));

    render(
      <EventStartTileValue startedAt={new Date("2026-09-14T18:01:00.000Z")} />,
    );

    return screen.getByTestId("event-start-tile-value").textContent || "";
  };

  test("Arabic joins the date and the time with its own comma", () => {
    const value: string = valueIn("ar");

    expect(value).toBe(`14${NBSP}سبتمبر، 06:01${NBSP}م UTC`);
    expect(value).not.toContain(",");
    // Still a line that breaks after the date's comma, then before the zone.
    expect(value.split(" ")).toEqual([
      `14${NBSP}سبتمبر،`,
      `06:01${NBSP}م`,
      "UTC",
    ]);
  });

  test("Persian joins them with the same turned comma", () => {
    const value: string = valueIn("fa");

    expect(value).toContain("، ");
    expect(value).not.toContain(",");
    expect(value.split(" ")[0]!.endsWith("،")).toBe(true);
  });

  test("a language written in Latin letters keeps its comma", () => {
    const value: string = valueIn("de");

    expect(value).toContain(", ");
    expect(value).not.toContain("،");
  });
});
