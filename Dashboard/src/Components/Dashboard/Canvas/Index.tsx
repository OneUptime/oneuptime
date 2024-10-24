import React, { FunctionComponent, ReactElement } from "react";
import BlankCanvasElement from "./BlankCanvas";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onDashboardViewConfigChange: (newConfig: DashboardViewConfig) => void;
}

const DashboardCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.dashboardViewConfig) {
    return <BlankCanvasElement onDrop={() => {}} dashboardViewConfig={props.dashboardViewConfig} />;
  }

  return <BlankCanvasElement onDrop={() => {}} dashboardViewConfig={props.dashboardViewConfig} />;
};

export default DashboardCanvas;
