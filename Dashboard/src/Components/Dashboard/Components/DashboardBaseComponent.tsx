import React, { FunctionComponent, ReactElement } from "react";
import DashboardTextComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import DashboardChartComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardValueComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { ObjectType } from "Common/Types/JSON";
import DashboardChartComponent from "./DashboardChartComponent";
import DashboardValueComponent from "./DashboardValueComponent";
import DashboardTextComponent from "./DashboardTextComponent";
import { DashboardRemConversionFactor } from "Common/Types/Dashboard/DashboardSize";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";

export interface DashboardBaseComponentProps {
  component: DashboardBaseComponent;
  isEditMode: boolean;
  isSelected: boolean;
  key: string;
  onComponentUpdate: (component: DashboardBaseComponent) => void;
}

export interface ComponentProps extends DashboardBaseComponentProps {
  onClick: () => void;
}

const DashboardBaseComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const widthOfComponent: number = props.component.widthInDashboardUnits;
  const heightOfComponent: number = props.component.heightInDashboardUnits;

  let className: string = `relative rounded m-2 col-span-${widthOfComponent} row-span-${heightOfComponent} border border-solid border-gray-300 p-2`;

  if (props.isEditMode) {
    className += "  cursor-pointer";
  }

  if (props.isSelected) {
    className += " border-2 border-indigo-300";
  }

  const getMoveElement: GetReactElementFunction = (): ReactElement => {
    // if not selected, then return null

    if (!props.isSelected) {
      return <></>;
    }

    return (
      <div
        style={{
          top: "-9px",
          left: "-9px",
        }}
        className="move-element cursor-move absolute w-4 h-4 bg-indigo-400 rounded-full cursor-pointer"
        onDragStart={(_event: React.DragEvent<HTMLDivElement>) => {


        }}
        onDragEnd={(_event: React.DragEvent<HTMLDivElement>) => {


        }}
      >

      </div>
    );
  };

  const getResizeWidthElement: GetReactElementFunction = (): ReactElement => {
    if (!props.isSelected) {
      return <></>;
    }

    return (
      <div
        style={{
          top: "calc(50% - 20px)",
          right: "-5px",
        }}
        className="resize-width-element cursor-ew-resize absolute right-0 w-2 h-12 bg-indigo-400 rounded-full cursor-pointer"
      ></div>
    );
  };

  const getResizeHeightElement: GetReactElementFunction = (): ReactElement => {
    if (!props.isSelected) {
      return <></>;
    }

    return (
      <div
        style={{
          bottom: "-5px",
          left: "calc(50% - 20px)",
        }}
        className="resize-height-element cursor-ns-resize absolute bottom-0 left-0 w-12 h-2 bg-indigo-400 rounded-full cursor-pointer"
      ></div>
    );
  };

  const height: number = props.component.heightInDashboardUnits;
  const heightInRem: number = height * DashboardRemConversionFactor;

  return (
    <div
      className={className}
      key={props.key}
      onClick={() => {
        props.onClick();
      }}
      style={{
        height: `${heightInRem}rem`,
      }}
      
    >
      {getMoveElement()}

      {props.component._type === ObjectType.DashboardTextComponent && (
        <DashboardTextComponent
          {...props}
          isEditMode={props.isEditMode}
          isSelected={props.isSelected}
          component={props.component as DashboardTextComponentType}
        />
      )}
      {props.component._type === ObjectType.DashboardChartComponent && (
        <DashboardChartComponent
          {...props}
          isEditMode={props.isEditMode}
          isSelected={props.isSelected}
          component={props.component as DashboardChartComponentType}
        />
      )}
      {props.component._type === ObjectType.DashboardValueComponent && (
        <DashboardValueComponent
          {...props}
          isSelected={props.isSelected}
          isEditMode={props.isEditMode}
          component={props.component as DashboardValueComponentType}
        />
      )}

      {getResizeWidthElement()}
      {getResizeHeightElement()}
    </div>
  );
};

export default DashboardBaseComponentElement;
