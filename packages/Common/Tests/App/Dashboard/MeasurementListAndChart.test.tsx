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
import userEvent from "@testing-library/user-event";
import React from "react";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The list of measurements and where it leads: each row reads
 * "Declared → Acknowledged" instead of "Starts At: Timeline Start, Ends At:
 * State Role Entered" (which did not even say which state), and View Chart
 * opens the measurement's chart. Plus the ready-made measurements' cards,
 * in the reader's language.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const navigateMock: MockFunction = getJestMockFunction();

// A pretend language: every string the page looks up comes back marked.
const mockTranslate: (value: string | undefined) => string | undefined = (
  value: string | undefined,
): string | undefined => {
  return value === undefined ? undefined : `«${value}»`;
};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: mockTranslate,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? mockTranslate(value) : value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>): unknown => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

import MeasurementSummaryElement from "../../../../App/FeatureSet/Dashboard/src/Components/Measurement/MeasurementSummaryElement";
import MeasurementPresetPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Measurement/MeasurementPresetPicker";
import {
  getMeasurementChartActionButton,
  getMeasurementChartRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Measurement/MeasurementFormFields";
import {
  ALERT_MEASUREMENT_FORM,
  INCIDENT_MEASUREMENT_FORM,
  SCHEDULED_MAINTENANCE_MEASUREMENT_FORM,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementSetup";
import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import IconProp from "../../../Types/Icon/IconProp";
import { MeasurementDomain } from "../../../Utils/Measurement/MeasurementMoments";
import { MetricExplorerUrlParam } from "../../../Utils/Metrics/MetricExplorerUrl";

beforeEach(() => {
  navigateMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("MeasurementSummaryElement", () => {
  test("reads a measurement as its two moments, in the reader's language", () => {
    render(
      <MeasurementSummaryElement
        form={INCIDENT_MEASUREMENT_FORM}
        measurement={{
          startAnchorType: "Declared At",
          endAnchorType: "State Role Entered",
          endIncidentStateRole: "Acknowledged",
        }}
      />,
    );

    expect(screen.getByTestId("measurement-summary")).toHaveTextContent(
      "«Declared»→«Acknowledged»",
    );
  });

  test("names a picked state as the project named it, never translated", () => {
    render(
      <MeasurementSummaryElement
        form={ALERT_MEASUREMENT_FORM}
        measurement={{
          startAnchorType: "Created At",
          endAnchorType: "State Entered",
          endAlertState: { name: "Investigating" },
        }}
      />,
    );

    expect(screen.getByTestId("measurement-summary")).toHaveTextContent(
      "«Created»→Investigating",
    );
  });

  test("says when the last time a state is reached counts, one sentence a language can reorder", () => {
    render(
      <MeasurementSummaryElement
        form={SCHEDULED_MAINTENANCE_MEASUREMENT_FORM}
        measurement={{
          startAnchorType: "State Role Entered",
          startScheduledMaintenanceStateRole: "Ongoing",
          endAnchorType: "State Role Entered",
          endScheduledMaintenanceStateRole: "Ended",
          endStateOccurrence: "Last",
        }}
      />,
    );

    // The template is looked up whole, then filled in.
    expect(screen.getByTestId("measurement-summary")).toHaveTextContent(
      "«Started»→««Ended» (last time)»",
    );
  });

  test("says an end it cannot name is not set, and a deleted state is deleted", () => {
    render(
      <MeasurementSummaryElement
        form={INCIDENT_MEASUREMENT_FORM}
        measurement={{
          startAnchorType: "Scheduled Starts At",
          endAnchorType: "State Entered",
          endIncidentState: null,
        }}
      />,
    );

    expect(screen.getByTestId("measurement-summary")).toHaveTextContent(
      "«Not set»→«Deleted state»",
    );
  });
});

describe("View Chart", () => {
  const action: ActionButtonSchema<IncidentMeasurement> =
    getMeasurementChartActionButton<IncidentMeasurement>();

  function measurement(values: Record<string, unknown>): IncidentMeasurement {
    return Object.assign(new IncidentMeasurement(), values);
  }

  test("is a row action with a chart icon, on every measurement that has a metric", () => {
    expect(action.title).toBe("View Chart");
    expect(action.icon).toBe(IconProp.ChartBar);
    expect(
      action.isVisible!(
        measurement({
          metricName: "oneuptime.incident.measurement.time-to-acknowledge",
        }),
      ),
    ).toBe(true);
    expect(action.isVisible!(measurement({}))).toBe(false);
  });

  test("opens the metric explorer on the measurement's chart", () => {
    const onComplete: MockFunction = getJestMockFunction();
    const onError: MockFunction = getJestMockFunction();

    action.onClick(
      measurement({
        name: "Time to acknowledge",
        metricName: "oneuptime.incident.measurement.time-to-acknowledge",
        aggregationType: "P90",
      }),
      onComplete as unknown as () => void,
      onError as unknown as (error: Error) => void,
    );

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    const route: string = (navigateMock.mock.calls[0]![0] as Route).toString();

    expect(route).toContain(
      `/dashboard/${PROJECT_ID.toString()}/metrics/view?`,
    );

    const query: URLSearchParams = new URLSearchParams(route.split("?")[1]);
    const queries: Array<Record<string, unknown>> = JSON.parse(
      query.get(MetricExplorerUrlParam.MetricQueries)!,
    );

    expect(queries).toEqual([
      expect.objectContaining({
        metricName: "oneuptime.incident.measurement.time-to-acknowledge",
        aggregationType: "P90",
        alias: { title: "Time to acknowledge" },
      }),
    ]);
    expect(query.get(MetricExplorerUrlParam.Range)).toBe("Past 1 Month");
  });

  test("builds the same route on its own", () => {
    expect(
      getMeasurementChartRoute({
        metricName: "oneuptime.alert.measurement.ttr",
      }).toString(),
    ).toContain("metricQueries=");
  });

  test("hands a failure to the table instead of throwing", () => {
    navigateMock.mockImplementation(() => {
      throw new Error("blocked");
    });

    const onComplete: MockFunction = getJestMockFunction();
    const onError: MockFunction = getJestMockFunction();

    action.onClick(
      measurement({ metricName: "oneuptime.incident.measurement.x" }),
      onComplete as unknown as () => void,
      onError as unknown as (error: Error) => void,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("MeasurementPresetPicker", () => {
  test("draws the ready-made measurements as cards in the reader's language, two to a row", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <MeasurementPresetPicker
        domain={MeasurementDomain.Incident}
        value="time-to-resolve"
        onChange={onChange as unknown as (presetId: string) => void}
      />,
    );

    const picker: HTMLElement = screen.getByTestId("measurement-preset-picker");
    const cards: Array<HTMLElement> = screen.getAllByRole("radio");

    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent("«Time to acknowledge»");
    expect(cards[0]).toHaveTextContent(
      "«From when an incident is declared until someone acknowledges it.»",
    );
    expect(cards[1]).toHaveAttribute("aria-checked", "true");
    expect(cards[3]).toHaveTextContent("«Something else»");

    // Two wide columns, not three narrow ones.
    expect(picker.querySelector(".sm\\:grid-cols-2")).not.toBeNull();
    expect(picker.querySelector(".lg\\:grid-cols-3")).toBeNull();

    await userEvent.setup({ delay: null }).click(cards[2]!);

    expect(onChange).toHaveBeenCalledWith("time-to-postmortem");
  });
});
