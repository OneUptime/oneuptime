import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import EventStartTileValue from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStartTileValue";
import OneUptimeDate from "../../../Types/Date";
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
