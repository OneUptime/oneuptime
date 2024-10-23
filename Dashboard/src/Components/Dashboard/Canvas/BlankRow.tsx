import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import DashboardUnitElement from "./DashboardUnit";

export interface ComponentProps {
  rowNumber: number;
  onDrop: (top: number, left: number) => void;
}

const BlankRowElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const defaultRowLength = DefaultDashboardSize.widthInDashboardUnits;

  return (
    <div className="flex">
      {Array.from(Array(defaultRowLength).keys()).map((_, index) => {
        return (
          <DashboardUnitElement
            key={index}
            onDrop={() => {
              props.onDrop(props.rowNumber, index);
            }}
          />
        );
      })}
    </div>
  );
};

export default BlankRowElement;
