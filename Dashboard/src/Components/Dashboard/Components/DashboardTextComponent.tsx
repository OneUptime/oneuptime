import React, { FunctionComponent, ReactElement } from "react";
import DashboardTextComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTextComponent;
}

const DashboardTextComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const textClassName: string = `truncate ${props.component.arguments.isBold ? "font-medium" : ""} ${props.component.arguments.isItalic ? "italic" : ""} ${props.component.arguments.isUnderline ? "underline" : ""}`;
  const textHeightInxPx: number =props.dashboardComponentHeightInPx - 20;

  return (
    <div>
      <div className={textClassName} style={{
        height: textHeightInxPx > 0 ? `${textHeightInxPx}px` : "auto",
      }}>{props.component.arguments.text}</div>
    </div>
  );
};

export default DashboardTextComponentElement;
