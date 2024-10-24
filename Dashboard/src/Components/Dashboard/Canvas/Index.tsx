import React, { FunctionComponent, ReactElement } from "react";
import BlankCanvasElement from "./BlankCanvas";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onDashboardViewConfigChange: (newConfig: DashboardViewConfig) => void;
  isEditMode: boolean;
}

const DashboardCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.dashboardViewConfig) {
    return <BlankCanvasElement
      isEditMode={props.isEditMode}
      onDrop={() => {}}
      dashboardViewConfig={props.dashboardViewConfig}
    />;
  }

  return <BlankCanvasElement
  isEditMode={props.isEditMode}
  onDrop={() => {}}
  dashboardViewConfig={props.dashboardViewConfig}
/>;
};

export default DashboardCanvas;
