import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import BlankDashboardUnitElement from "./DashboardUnit";

export interface ComponentProps {
  rowNumber: number;
  onClick: (top: number, left: number) => void;
  isEditMode: boolean;
  totalCurrentDashboardWidthInPx: number;
}

const BlankRowElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const defaultRowLength: number = DefaultDashboardSize.widthInDashboardUnits;

  return (
    <>
      {Array.from(Array(defaultRowLength).keys()).map(
        (_: number, index: number) => {
          return (
            <BlankDashboardUnitElement
              currentTotalDashboardWidthInPx={
                props.totalCurrentDashboardWidthInPx
              }
              key={index}
              isEditMode={props.isEditMode}
              onClick={() => {
                props.onClick(props.rowNumber, index);
              }}
            />
          );
        },
      )}
    </>
  );
};

export default BlankRowElement;
