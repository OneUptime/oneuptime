import React, { FunctionComponent, ReactElement } from "react";
import DashboardTextComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTextComponent;
}

const DashboardTextComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const textClassName: string = `m-auto truncate flex flex-col justify-center h-full ${props.component.arguments.isBold ? "font-medium" : ""} ${props.component.arguments.isItalic ? "italic" : ""} ${props.component.arguments.isUnderline ? "underline" : ""}`;
  const textHeightInxPx: number = props.dashboardComponentHeightInPx * 0.4;

  return (
    <div className="h-full">
      <div
        className={textClassName}
        style={{
          fontSize: textHeightInxPx > 0 ? `${textHeightInxPx}px` : "",
        }}
      >
        {props.component.arguments.text}
      </div>
    </div>
  );
};

export default DashboardTextComponentElement;
