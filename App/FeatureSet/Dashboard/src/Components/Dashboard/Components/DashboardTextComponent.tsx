import React, { FunctionComponent, ReactElement } from "react";
import DashboardTextComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTextComponent;
}

const DashboardTextComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.component.arguments.isMarkdown) {
    return (
      <div className="h-full overflow-auto p-2">
        <LazyMarkdownViewer text={props.component.arguments.text || ""} />
      </div>
    );
  }

  const textClassName: string = `flex items-center justify-center h-full text-gray-800 leading-snug ${props.component.arguments.isBold ? "font-semibold" : "font-normal"} ${props.component.arguments.isItalic ? "italic" : ""} ${props.component.arguments.isUnderline ? "underline decoration-gray-300 underline-offset-4" : ""}`;
  const textHeightInxPx: number = Math.min(
    props.dashboardComponentHeightInPx * 0.35,
    64,
  );

  return (
    <div className="h-full px-2">
      <div
        className={textClassName}
        style={{
          fontSize: textHeightInxPx > 0 ? `${textHeightInxPx}px` : "",
        }}
      >
        {props.component.arguments.text || (
          <span className="text-gray-300 text-sm">No text configured</span>
        )}
      </div>
    </div>
  );
};

export default DashboardTextComponentElement;
