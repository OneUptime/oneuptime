import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import BlankRowElement from "./BlankRow";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onClick: (top: number, left: number) => void;
  isEditMode: boolean;
  totalCurrentDashboardWidthInPx: number;
}

const BlankCanvasElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const height: number =
    props.dashboardViewConfig.heightInDashboardUnits ||
    DefaultDashboardSize.heightInDashboardUnits;

  const width: number = DefaultDashboardSize.widthInDashboardUnits;

  if (!props.isEditMode && props.dashboardViewConfig.components.length === 0) {
    return (
      <div className="ml-1 mr-1 rounded p-10 border-2 border-gray-100 text-sm text-gray-400 text-center pt-24 pb-24">
        No components added to this dashboard. Please add one to get started.
      </div>
    );
  }

  // have a grid with width cols and height rows
  return (
    <div className={`grid grid-cols-${width}`}>
      {Array.from(Array(height).keys()).map((_: number, index: number) => {
        return (
          <BlankRowElement
            key={index}
            totalCurrentDashboardWidthInPx={
              props.totalCurrentDashboardWidthInPx
            }
            isEditMode={props.isEditMode}
            rowNumber={index}
            onClick={(top: number, left: number) => {
              props.onClick(top, left);
            }}
          />
        );
      })}
    </div>
  );
};

export default BlankCanvasElement;
