/** @timezone UTC */

import "@testing-library/jest-dom";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import React from "react";
import LayerDateTimeFieldElement from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerDateTimeFieldElement";

/*
 * The rotation-start and hand-off fields name the zone their times are in.
 * A schedule stored under a legacy tz name ("US/Pacific") is shown under its
 * current name everywhere else on the page — the timezone bubble, the "View
 * as" note — so this hint has to use the same name, or the page describes
 * one zone two ways.
 */

describe("LayerDateTimeFieldElement timezone hint", () => {
  afterEach(() => {
    cleanup();
  });

  test.each([
    ["US/Pacific", "America/Los_Angeles"],
    ["Asia/Calcutta", "Asia/Kolkata"],
    ["Singapore", "Asia/Singapore"],
    ["Etc/UTC", "UTC"],
  ])(
    "names a schedule stored as %s by its current name, %s",
    (stored: string, current: string) => {
      const result: RenderResult = render(
        <LayerDateTimeFieldElement timezone={stored} />,
      );

      expect(
        result.getByText(
          `This time is in the schedule's timezone: ${current}.`,
        ),
      ).toBeInTheDocument();
      expect(
        result.queryByText(
          `This time is in the schedule's timezone: ${stored}.`,
        ),
      ).toBeNull();
    },
  );

  test("names a current zone as it is", () => {
    const result: RenderResult = render(
      <LayerDateTimeFieldElement timezone="Europe/Berlin" />,
    );

    expect(
      result.getByText(
        "This time is in the schedule's timezone: Europe/Berlin.",
      ),
    ).toBeInTheDocument();
  });

  test("still falls back to the viewer's zone when the schedule has none", () => {
    const result: RenderResult = render(<LayerDateTimeFieldElement />);

    expect(
      result.getByText(/^This time is in your local timezone: /),
    ).toBeInTheDocument();
  });
});
