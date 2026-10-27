/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MaintenanceWindow from "../../../../UI/Components/Graphs/MaintenanceWindow";
import OneUptimeDate from "../../../../Types/Date";
import { setDateDisplayLanguage } from "../../../../Types/DateLanguage";
import Timezone from "../../../../Types/Timezone";

/*
 * A maintenance event's window as the uptime history draws it (#5236): on
 * the reader's clock, each end isolated for the bidi algorithm, so a
 * right-to-left language never runs the end's digits into the start's and
 * reads the window backwards.
 */

beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
  OneUptimeDate.setUserTimezone("Europe/Paris" as Timezone);
});

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(null);
  jest.restoreAllMocks();
});

describe("MaintenanceWindow", () => {
  test("reads as the window, start to end, with the reader's zone", () => {
    render(
      <MaintenanceWindow
        dataTestId="window"
        startsAt={new Date("2026-10-21T16:00:00.000Z")}
        endsAt={new Date("2026-10-21T18:00:00.000Z")}
      />,
    );

    expect(screen.getByTestId("window")).toHaveTextContent(
      "Oct 21, 18:00 – 20:00 CEST",
    );
  });

  test("isolates each end in a bdi of its own, with the separator between them", () => {
    render(
      <MaintenanceWindow
        dataTestId="window"
        startsAt={new Date("2026-10-21T16:00:00.000Z")}
        endsAt={new Date("2026-10-22T00:00:00.000Z")}
      />,
    );

    const window: HTMLElement = screen.getByTestId("window");
    const ends: Array<HTMLElement> = Array.from(window.querySelectorAll("bdi"));

    expect(ends).toHaveLength(2);
    expect(ends[0]).toHaveTextContent("Oct 21, 18:00");
    expect(ends[1]).toHaveTextContent("Oct 22, 02:00 CEST");
    // Neither end holds the separator: it stays outside both isolates.
    expect(ends[0]!.textContent).not.toContain("–");
    expect(ends[1]!.textContent).not.toContain("–");
  });

  test("keeps a Persian month name and its digits in the start's isolate", () => {
    setDateDisplayLanguage("fa");

    render(
      <MaintenanceWindow
        dataTestId="window"
        startsAt={new Date("2026-10-25T01:00:00.000Z")}
        endsAt={new Date("2026-10-25T03:00:00.000Z")}
      />,
    );

    const ends: Array<HTMLElement> = Array.from(
      screen.getByTestId("window").querySelectorAll("bdi"),
    );

    expect(ends).toHaveLength(2);
    // The start: the date in Persian with its time; the end: its time.
    expect(ends[0]!.textContent).toContain("02:00");
    expect(ends[0]!.textContent).not.toContain("04:00");
    expect(ends[1]!.textContent).toContain("04:00");
    expect(ends[1]!.textContent!.endsWith("CET")).toBe(true);
  });

  test("passes its style through", () => {
    render(
      <MaintenanceWindow
        dataTestId="window"
        startsAt={new Date("2026-10-21T16:00:00.000Z")}
        endsAt={new Date("2026-10-21T18:00:00.000Z")}
        style={{ fontSize: "10px" }}
      />,
    );

    expect(screen.getByTestId("window").style.fontSize).toBe("10px");
  });

  test("draws nothing for a window with no start", () => {
    const { container } = render(
      <MaintenanceWindow
        dataTestId="window"
        startsAt={new Date("not a date")}
        endsAt={new Date("2026-10-21T18:00:00.000Z")}
      />,
    );

    expect(screen.queryByTestId("window")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
