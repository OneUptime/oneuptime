import React, { FunctionComponent, ReactElement } from "react";
import DashboardChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardChartComponent;
}

const DashboardChartComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <div>Chart Component {props.component.componentId.toString()}</div>;
};

export default DashboardChartComponentElement;
