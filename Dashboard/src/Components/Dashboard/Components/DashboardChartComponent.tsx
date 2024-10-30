import React, { FunctionComponent, ReactElement } from "react";
import DashboardChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import { DashboardCommonComponentProps } from "./DashboardBaseComponent";

export interface ComponentProps extends DashboardCommonComponentProps {
  component: DashboardChartComponent;
}

const DashboardChartComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <div>Chart Component {props.component.componentId.toString()}</div>;
};

export default DashboardChartComponentElement;
