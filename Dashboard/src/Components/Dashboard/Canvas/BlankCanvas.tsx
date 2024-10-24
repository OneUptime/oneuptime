import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import BlankRowElement from "./BlankRow";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onDrop: (top: number, left: number) => void;
}

const BlankCanvasElement: FunctionComponent<ComponentProps> = (
  porps: ComponentProps,
): ReactElement => {
  const height: number =
    porps.dashboardViewConfig.heightInDashboardUnits ||
    DefaultDashboardSize.heightInDashboardUnits;

  return (
    <div className="">
      {Array.from(Array(height).keys()).map((_: number, index: number) => {
        return (
          <BlankRowElement
            dashboardViewConfig={porps.dashboardViewConfig}
            key={index}
            rowNumber={index}
            onDrop={(top: number, left: number) => {
              porps.onDrop(top, left);
            }}
          />
        );
      })}
    </div>
  );
};

export default BlankCanvasElement;
