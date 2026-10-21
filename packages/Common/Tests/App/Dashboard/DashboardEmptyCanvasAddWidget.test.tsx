import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React, { ReactElement } from "react";

/*
 * The real dashboard canvas with no widgets draws the empty board
 * (BlankCanvas), and hands it the board's Add Widget only when the
 * dashboard handed one down - which DashboardView does for someone who may
 * edit the board (DashboardBlankCanvasAddWidget drives that end).
 */

// The canvas module imports every widget; none is drawn on an empty board.
jest.setTimeout(120000);

import DashboardCanvas from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import { ObjectType } from "../../../Types/JSON";
import TimeRange from "../../../Types/Time/TimeRange";

const EMPTY_BOARD: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
};

function emptyCanvas(options: {
  isEditMode: boolean;
  onAddWidgetClick?: (() => void) | undefined;
}): ReactElement {
  return (
    <DashboardCanvas
      dashboardViewConfig={EMPTY_BOARD}
      onDashboardViewConfigChange={() => {}}
      isEditMode={options.isEditMode}
      currentTotalDashboardWidthInPx={1200}
      onComponentSelected={() => {}}
      onComponentUnselected={() => {}}
      selectedComponentId={null}
      metrics={{ metricTypes: [], telemetryAttributes: [] }}
      dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_HOUR }}
      onAddWidgetClick={options.onAddWidgetClick}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("an empty dashboard canvas", () => {
  test("draws the empty board with the Add Widget it was handed", () => {
    const onAddWidgetClick: jest.Mock<any> = jest.fn() as jest.Mock<any>;

    render(emptyCanvas({ isEditMode: false, onAddWidgetClick }));

    expect(screen.getByTestId("dashboard-blank-canvas")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dashboard-blank-canvas-add-widget"));
    expect(onAddWidgetClick).toHaveBeenCalledTimes(1);
  });

  test("draws no Add Widget when it was handed none", () => {
    render(emptyCanvas({ isEditMode: false }));

    expect(screen.getByTestId("dashboard-blank-canvas")).toBeInTheDocument();
    expect(
      screen.queryByTestId("dashboard-blank-canvas-add-widget"),
    ).toBeNull();
  });

  test("draws no Add Widget of its own while the board is edited", () => {
    render(
      emptyCanvas({
        isEditMode: true,
        onAddWidgetClick: () => {
          return undefined;
        },
      }),
    );

    expect(
      screen.queryByTestId("dashboard-blank-canvas-add-widget"),
    ).toBeNull();
  });
});
