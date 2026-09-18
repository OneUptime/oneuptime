import "@testing-library/jest-dom";
import { render, RenderResult } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react, so a component imported from there
 * would otherwise call hooks on a DIFFERENT React instance than the one
 * react-dom renders with. Common's jest moduleNameMapper pins react and
 * react-dom to this project's single copy for every importer, which is what
 * makes importing Dashboard source from here work (same arrangement as
 * Common/Tests/UI/Rum/ReplayStage.test.tsx).
 */
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import TelemetrySnapshotWindowAlert from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotWindowAlert";

/*
 * The badge that tells someone reading an incident WHICH slice of time the
 * telemetry cards below are showing. Its absence on the log card is a large
 * part of why the rolling-window bug went unnoticed for so long: with nothing
 * on screen claiming a window, an hour of unrelated logs read as the
 * incident's own logs.
 *
 * Two behaviours matter and neither is reachable from a pure test: that it
 * renders the stored window, and that it renders NOTHING when there is no
 * window — the backwards-compatible path for incidents created before monitors
 * stamped one, where a badge would be worse than no badge.
 */
describe("TelemetrySnapshotWindowAlert", () => {
  const START_DATE: Date = new Date("2026-08-04T10:00:00.000Z");
  const END_DATE: Date = new Date("2026-08-04T10:01:00.000Z");

  it("renders the snapshot window", () => {
    const result: RenderResult = render(
      <TelemetrySnapshotWindowAlert
        window={new InBetween<Date>(START_DATE, END_DATE)}
      />,
    );

    /*
     * Assert against the app's own formatter rather than a hard-coded string:
     * the output is timezone- and 12/24h-preference dependent, and pinning a
     * literal here would make this test a clock/locale trap rather than a
     * check that the window reaches the screen.
     */
    const expected: string = OneUptimeDate.getInBetweenDatesAsFormattedString(
      new InBetween<Date>(START_DATE, END_DATE),
    );

    expect(result.container.textContent).toContain(expected);

    // Both edges are named, not just the start.
    expect(expected).toContain(" - ");
  });

  it("renders nothing when the incident stored no window", () => {
    for (const value of [null, undefined]) {
      const result: RenderResult = render(
        <TelemetrySnapshotWindowAlert window={value} />,
      );

      expect(result.container.textContent).toBe("");
      result.unmount();
    }
  });

  it("renders a window restored from storage, whose bounds are ISO strings", () => {
    /*
     * The shape the incident page actually holds if hydration were ever
     * skipped. The formatter normalizes strings, so the badge must still show
     * real dates rather than "Invalid Date".
     */
    const result: RenderResult = render(
      <TelemetrySnapshotWindowAlert
        window={
          new InBetween<Date>(
            START_DATE.toISOString() as unknown as Date,
            END_DATE.toISOString() as unknown as Date,
          )
        }
      />,
    );

    expect(result.container.textContent).not.toContain("Invalid Date");
    expect(result.container.textContent).toContain(
      OneUptimeDate.getInBetweenDatesAsFormattedString(
        new InBetween<Date>(START_DATE, END_DATE),
      ),
    );
  });
});
