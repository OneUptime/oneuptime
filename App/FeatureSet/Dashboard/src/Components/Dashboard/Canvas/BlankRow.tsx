import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import BlankDashboardUnitElement from "./BlankDashboardUnit";

export interface ComponentProps {
  rowNumber: number;
  onClick: (top: number, left: number) => void;
  isEditMode: boolean;
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
              key={props.rowNumber + "-" + index}
              isEditMode={props.isEditMode}
              onClick={() => {
                props.onClick(props.rowNumber, index);
              }}
              id={`blank-unit-${props.rowNumber}-${index}`}
            />
          );
        },
      )}
    </>
  );
};

export default BlankRowElement;
