import React, { FunctionComponent, ReactElement } from "react";
import DashboardTextComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTextComponent;
}

const DashboardTextComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <div>Text Component {props.component.componentId.toString()}</div>;
};

export default DashboardTextComponentElement;
