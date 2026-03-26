import {
  GetDashboardUnitHeightInPx,
  MarginForEachUnitInPx,
} from "Common/Types/Dashboard/DashboardSize";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isEditMode: boolean;
  onClick: () => void;
  currentTotalDashboardWidthInPx: number;
  id: string;
}

const BlankDashboardUnitElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const heightOfUnitInPx: number = GetDashboardUnitHeightInPx(
    props.currentTotalDashboardWidthInPx,
  );

  const widthOfUnitInPx: number = heightOfUnitInPx; // its a square

  let className: string = "transition-all duration-150";

  if (props.isEditMode) {
    className +=
      " border border-dashed border-gray-200 rounded-md hover:border-gray-300 hover:bg-blue-50/30 cursor-pointer";
  }

  return (
    <div
      id={props.id}
      className={className}
      onClick={() => {
        props.onClick();
      }}
      style={{
        width: widthOfUnitInPx + "px",
        height: heightOfUnitInPx + "px",
        margin: MarginForEachUnitInPx + "px",
      }}
    ></div>
  );
};

export default BlankDashboardUnitElement;
