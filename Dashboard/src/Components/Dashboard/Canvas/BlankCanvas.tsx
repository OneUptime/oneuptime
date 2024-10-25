import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import BlankRowElement from "./BlankRow";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onDrop: (top: number, left: number) => void;
  isEditMode: boolean;
}

const BlankCanvasElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const height: number =
    props.dashboardViewConfig.heightInDashboardUnits ||
    DefaultDashboardSize.heightInDashboardUnits;

  const width: number = DefaultDashboardSize.widthInDashboardUnits;

  if(!props.isEditMode && props.dashboardViewConfig.components.length === 0) {
    return <div className="rounded p-10 border-2 border-gray-100 text-sm text-gray-400 text-center">
      No components added to this dashboard. Please add one to get started.
      </div>;
  }

  // have a grid with width cols and height rows
  return (
    <div className={`grid grid-cols-${width}`}>
      {Array.from(Array(height).keys()).map((_: number, index: number) => {
        return (
          <BlankRowElement
            key={index}
            isEditMode={props.isEditMode}
            rowNumber={index}
            onDrop={(top: number, left: number) => {
              props.onDrop(top, left);
            }}
          />
        );
      })}
    </div>
  );
};

export default BlankCanvasElement;
