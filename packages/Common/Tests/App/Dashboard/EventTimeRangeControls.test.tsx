/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import EventTimeRangeControls, {
  EVENT_TIME_RANGE_RESET_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventTimeRangeControls";
import useInvestigationTimeRange, {
  InvestigationTimeRangeState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/UseInvestigationTimeRange";
import { MetricInvestigationTimePreset } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationTime";
import {
  EVENT_EVALUATED_SELECTION,
  EVENT_RELATIVE_TIME_RANGES,
  getEventTimePresets,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventTimePresets";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The time range on the header of every tab of an incident's logs, traces
 * or exceptions card (issue #6251). It took over from the snapshot badge
 * (TelemetrySnapshotWindowAlert, TelemetrySnapshotBadge), whose promises
 * are held here where they now live:
 *
 * - the card says which moment it shows: untouched, "What the monitor
 *   saw", with the window itself as the button's tooltip and beside the
 *   range in the list, so a card of last Tuesday's logs never reads as a
 *   live tail;
 * - the way back from a zoom sits beside it, on every tab's card, the
 *   companion tabs included, where every other zoom is withdrawn;
 *
 * and what it adds: the ranges around the incident, Copy link and Reset
 * once the reader moved off what the monitor saw.
 */

const STARTED_AT: Date = new Date("2026-09-14T18:00:00.000Z");
const EVALUATED: InBetween<Date> = new InBetween<Date>(
  new Date("2026-09-14T17:45:00.000Z"),
  new Date("2026-09-14T18:00:00.000Z"),
);
const NOW: Date = new Date("2026-09-14T19:00:00.000Z");
const PAGE: string = "/dashboard/project-1/incidents/incident-1";

let mockTime: InvestigationTimeRangeState | null = null;

function presets(now: Date): Array<MetricInvestigationTimePreset> {
  return getEventTimePresets(
    { startedAt: STARTED_AT, evaluationWindow: EVALUATED },
    now,
  );
}

interface HarnessProps {
  // The controls as a companion tab draws them: every other zoom withdrawn.
  insideACompanion?: boolean | undefined;
}

const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const time: InvestigationTimeRangeState = useInvestigationTimeRange({
    getPresets: presets,
    defaultSelection: EVENT_EVALUATED_SELECTION,
    urlParamPrefix: "telemetry",
  });
  mockTime = time;

  const controls: React.ReactElement = (
    <EventTimeRangeControls
      time={time}
      presetsHeading="Around this incident"
      relativeRanges={EVENT_RELATIVE_TIME_RANGES}
    />
  );

  return (
    <div data-testid="card-header">
      {props.insideACompanion ? (
        <TimeRangeZoomProvider zoom={null}>{controls}</TimeRangeZoomProvider>
      ) : (
        controls
      )}
    </div>
  );
};

function time(): InvestigationTimeRangeState {
  if (!mockTime) {
    throw new Error("The controls have not rendered");
  }
  return mockTime;
}

function pickerButton(): HTMLElement {
  return screen.getByTestId("metric-investigation-time-button");
}

function windowLabel(start: Date, end: Date): string {
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  });
}

function zoomTo(start: string, end: string): void {
  act(() => {
    time().zoom.zoomToTimeRange(new Date(start), new Date(end));
  });
}

function pick(label: string): void {
  fireEvent.click(pickerButton());
  fireEvent.click(
    within(screen.getByTestId("metric-investigation-time-dropdown")).getByText(
      label,
    ),
  );
}

function resetButton(): HTMLElement | null {
  return screen.queryByTestId(EVENT_TIME_RANGE_RESET_TEST_ID);
}

function resetZoomButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", PAGE);
  mockTime = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("untouched: which moment the card shows", () => {
  test("names what the monitor saw, with its window as the tooltip, and nothing to reset or share", () => {
    render(<Harness />);

    expect(pickerButton()).toHaveTextContent("What the monitor saw");
    // Both edges of the window, as a custom range is written.
    expect(pickerButton()).toHaveAttribute(
      "title",
      windowLabel(EVALUATED.startValue, EVALUATED.endValue),
    );
    expect(pickerButton().getAttribute("title")).toContain(" – ");
    expect(resetZoomButtons()).toHaveLength(0);
    expect(resetButton()).toBeNull();
    expect(screen.queryByText("Copy link")).toBeNull();
  });

  test("lists the ranges around the incident, each with the window it covers, then the ranges relative to now", () => {
    render(<Harness />);

    fireEvent.click(pickerButton());
    const dropdown: HTMLElement = screen.getByTestId(
      "metric-investigation-time-dropdown",
    );

    expect(within(dropdown).getByText("Around this incident")).toBeVisible();
    expect(within(dropdown).getByText("Relative to now")).toBeVisible();

    for (const label of [
      "Around the start",
      "The hour before it started",
      "The day before it started",
      "Start to now",
      "What the monitor saw",
    ]) {
      expect(within(dropdown).getByText(label)).toBeVisible();
    }

    // What the monitor saw is listed with its window, and is the one on.
    const evaluated: HTMLElement = screen.getByTestId(
      "metric-investigation-time-moment-evaluated",
    );
    expect(evaluated).toHaveTextContent(
      windowLabel(EVALUATED.startValue, EVALUATED.endValue),
    );
    expect(evaluated).toHaveClass("text-indigo-700");

    for (const label of [
      "Past 15 Minutes",
      "Past 1 Hour",
      "Past 3 Hours",
      "Past 1 Day",
      "Past 1 Week",
      "Custom Range...",
    ]) {
      expect(within(dropdown).getByText(label)).toBeVisible();
    }
    expect(within(dropdown).queryByText("Past 3 Months")).toBeNull();
  });
});

describe("a range the reader picked", () => {
  test("is named on the button, with Copy link and Reset beside it", () => {
    render(<Harness />);

    pick("The hour before it started");

    expect(pickerButton()).toHaveTextContent("The hour before it started");
    expect(screen.getByText("Copy link")).toBeVisible();
    expect(resetButton()).toBeVisible();
    expect(resetButton()).toHaveTextContent("Reset");
    expect(resetZoomButtons()).toHaveLength(0);
    expect(
      new URLSearchParams(window.location.search).get("telemetryTime"),
    ).toBe("hour-before");
  });

  test("Copy link copies the page's address with the range in it", async () => {
    const writeText: jest.Mock<(text: string) => Promise<void>> = jest.fn(
      (_text: string): Promise<void> => {
        return Promise.resolve();
      },
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeText },
      configurable: true,
    });

    render(<Harness />);
    pick("The day before it started");

    const copy: HTMLElement = screen.getByRole("button", {
      name: "Copy a link to this time range",
    });
    await act(async () => {
      fireEvent.click(copy);
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const copied: URL = new URL(writeText.mock.calls[0]![0]);
    expect(copied.pathname).toBe(PAGE);
    expect(copied.searchParams.get("telemetryTime")).toBe("day-before");
  });

  test("Reset goes back to what the monitor saw, and Copy link and Reset go away", () => {
    render(<Harness />);
    pick("Start to now");

    fireEvent.click(resetButton()!);

    expect(pickerButton()).toHaveTextContent("What the monitor saw");
    expect(resetButton()).toBeNull();
    expect(screen.queryByText("Copy link")).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("Reset says where it goes back to", async () => {
    render(<Harness />);
    pick("Past 1 Day");

    fireEvent.mouseEnter(resetButton()!);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(
      screen.queryAllByRole("tooltip").map((tooltip: HTMLElement) => {
        return tooltip.textContent;
      }),
    ).toEqual(["Go back to what the monitor saw"]);
  });
});

describe("a drag on the explorer's chart", () => {
  test("from what the monitor saw: Reset zoom beside the picker is the one way back, and Copy link shares the slice", () => {
    render(<Harness />);

    zoomTo("2026-09-14T17:50:00.000Z", "2026-09-14T17:55:00.000Z");

    expect(pickerButton()).toHaveTextContent(
      windowLabel(
        new Date("2026-09-14T17:50:00.000Z"),
        new Date("2026-09-14T17:55:00.000Z"),
      ),
    );
    expect(resetZoomButtons()).toHaveLength(1);
    // Reset would do what Reset zoom does: it is left out.
    expect(resetButton()).toBeNull();
    expect(screen.getByText("Copy link")).toBeVisible();

    fireEvent.click(resetZoomButtons()[0]!);

    expect(pickerButton()).toHaveTextContent("What the monitor saw");
    expect(resetZoomButtons()).toHaveLength(0);
    expect(screen.queryByText("Copy link")).toBeNull();
  });

  test("from a range the reader picked: Reset zoom goes back to that range, and Reset to what the monitor saw", () => {
    render(<Harness />);
    pick("The hour before it started");

    zoomTo("2026-09-14T17:10:00.000Z", "2026-09-14T17:20:00.000Z");

    expect(resetZoomButtons()).toHaveLength(1);
    expect(resetButton()).toBeVisible();

    fireEvent.click(resetZoomButtons()[0]!);
    expect(pickerButton()).toHaveTextContent("The hour before it started");
    expect(resetZoomButtons()).toHaveLength(0);

    zoomTo("2026-09-14T17:10:00.000Z", "2026-09-14T17:20:00.000Z");
    fireEvent.click(resetButton()!);
    expect(pickerButton()).toHaveTextContent("What the monitor saw");
    expect(resetZoomButtons()).toHaveLength(0);
    expect(resetButton()).toBeNull();
  });

  test("on a companion tab's card, where every other zoom is withdrawn, the card's way back is still there", () => {
    render(<Harness insideACompanion={true} />);

    zoomTo("2026-09-14T17:50:00.000Z", "2026-09-14T17:55:00.000Z");

    const header: HTMLElement = screen.getByTestId("card-header");
    const buttons: Array<HTMLElement> = within(header).queryAllByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]!);

    expect(pickerButton()).toHaveTextContent("What the monitor saw");
    expect(resetZoomButtons()).toHaveLength(0);
  });
});
