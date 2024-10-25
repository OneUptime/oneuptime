import React, { FunctionComponent, ReactElement } from "react";
import DashboardValueComponent from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardValueComponent;
}

const DashboardValueComponentElement: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return <div>Value Component</div>;
};

export default DashboardValueComponentElement;
