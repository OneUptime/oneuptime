import React, { FunctionComponent, ReactElement, useState } from "react";
import DashboardToolbar from "./Toolbar/DashboardToolbar";
import DashboardCanvas from "./Canvas/Index";
import DashboardMode from "Common/Types/Dashboard/DashboardMode";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";

export interface ComponentProps {}

const DashboardViewer: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(
    DashboardMode.View,
  );

  return (
    <div>
      <DashboardToolbar
        dashboardMode={dashboardMode}
        onSaveClick={() => {
          setDashboardMode(DashboardMode.View);
        }}
        onCancelEditClick={() => {
          setDashboardMode(DashboardMode.View);
        }}
        onEditClick={() => {
          setDashboardMode(DashboardMode.Edit);
        }}
        onAddComponentClick={(componentType: DashboardComponentType) => {

        }}
      />
      <DashboardCanvas />
    </div>
  );
};

export default DashboardViewer;
