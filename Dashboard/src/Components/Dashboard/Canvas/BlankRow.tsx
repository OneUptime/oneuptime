import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import DashboardUnitElement from "./DashboardUnit";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";

export interface ComponentProps {
  rowNumber: number;
  onDrop: (top: number, left: number) => void;
  dashboardViewConfig: DashboardViewConfig;
}

const BlankRowElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const defaultRowLength: number =
    props.dashboardViewConfig.widthInDashboardUnits ||
    DefaultDashboardSize.widthInDashboardUnits;

  return (
    <div className="flex">
      {Array.from(Array(defaultRowLength).keys()).map(
        (_: number, index: number) => {
          return (
            <DashboardUnitElement
              key={index}
              onDrop={() => {
                props.onDrop(props.rowNumber, index);
              }}
            />
          );
        },
      )}
    </div>
  );
};

export default BlankRowElement;
