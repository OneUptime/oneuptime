import React, { FunctionComponent, ReactElement } from "react";
import DashboardTextComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import DashboardChartComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardValueComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { ObjectType } from "Common/Types/JSON";
import DashboardChartComponent from "./DashboardChartComponent";
import DashboardValueComponent from "./DashboardValueComponent";
import DashboardTextComponent from "./DashboardTextComponent";
import DefaultDashboardSize, {
  GetDashboardComponentHeightInDashboardUnits,
  GetDashboardComponentWidthInDashboardUnits,
  GetDashboardUnitHeightInPx,
  GetDashboardUnitWidthInPx,
  MarginForEachUnitInPx,
  SpaceBetweenUnitsInPx,
} from "Common/Types/Dashboard/DashboardSize";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";

export interface DashboardCommonComponentProps
  extends DashboardBaseComponentProps {
  editToolbarComponentElements: (elements: Array<ReactElement>) => ReactElement;
}

export interface DashboardBaseComponentProps {
  component: DashboardBaseComponent;
  isEditMode: boolean;
  isSelected: boolean;
  key: string;
  onComponentUpdate: (component: DashboardBaseComponent) => void;
  totalCurrentDashboardWidthInPx: number;
  dashboardCanvasTopInPx: number;
  dashboardCanvasLeftInPx: number;
  dashboardCanvasWidthInPx: number;
  dashboardCanvasHeightInPx: number;
  dashboardViewConfig: DashboardViewConfig;
}

export interface ComponentProps extends DashboardBaseComponentProps {
  onClick: () => void;
}

const DashboardBaseComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const widthOfComponent: number = props.component.widthInDashboardUnits;
  const heightOfComponent: number = props.component.heightInDashboardUnits;

  let className: string = `relative rounded-md col-span-${widthOfComponent} row-span-${heightOfComponent} p-2 bg-white border-2 border-solid border-gray-100`;

  if (props.isEditMode) {
    className += "  cursor-pointer";
  }

  if (props.isSelected && props.isEditMode) {
    className += " border-2 border-blue-300";
  }

  const dashboardComponentRef: React.RefObject<HTMLDivElement> =
    React.useRef<HTMLDivElement>(null);

  type MoveComponentFunction = (mouseEvent: MouseEvent) => void;

  const moveComponent: MoveComponentFunction = (
    mouseEvent: MouseEvent,
  ): void => {
    const dashboardComponentOldTopInPx: number =
      dashboardComponentRef.current?.getBoundingClientRect().top || 0;
    const dashboardComponentOldLeftInPx: number =
      dashboardComponentRef.current?.getBoundingClientRect().left || 0;

    const newMoveToTop: number = mouseEvent.pageY;
    const newMoveToLeft: number = mouseEvent.pageX;

    const oldTopDashboardUnits: number = props.component.topInDashboardUnits + 1;
    const oldLeftDashboardUnits: number = props.component.leftInDashboardUnits + 1;

    // calculare new top and new left.
    let newTopInDashboardUnits: number = Math.floor(
      (newMoveToTop * oldTopDashboardUnits) / dashboardComponentOldTopInPx,
    ) - 1;
    let newLeftInDashboardUnits: number = Math.floor(
      (newMoveToLeft * oldLeftDashboardUnits) / dashboardComponentOldLeftInPx,
    ) - 1;

    // check if the new top and left are within the bounds of the dashboard

    const dahsboardTotalWidthInDashboardUnits: number =
      DefaultDashboardSize.widthInDashboardUnits; // width does not change

    const dashboardTotalHeightInDashboardUnits: number =
      props.dashboardViewConfig.heightInDashboardUnits;

    const heightOfTheComponntInDashboardUnits: number =
      props.component.heightInDashboardUnits;
    const widthOfTheComponentInDashboardUnits: number =
      props.component.widthInDashboardUnits;

    // if it goes outside the bounds then max it out to the bounds

    if (
      newTopInDashboardUnits + heightOfTheComponntInDashboardUnits >
      dashboardTotalHeightInDashboardUnits
    ) {
      newTopInDashboardUnits =
        dashboardTotalHeightInDashboardUnits -
        heightOfTheComponntInDashboardUnits;
    }

    if (
      newLeftInDashboardUnits + widthOfTheComponentInDashboardUnits >
      dahsboardTotalWidthInDashboardUnits
    ) {
      newLeftInDashboardUnits =
        dahsboardTotalWidthInDashboardUnits -
        widthOfTheComponentInDashboardUnits;
    }


    if(newTopInDashboardUnits < 0) {
      newTopInDashboardUnits = 0;
    }

    if(newLeftInDashboardUnits < 0) {
      newLeftInDashboardUnits = 0;
    }

    // update the component
    const newComponentProps: DashboardBaseComponent = {
      ...props.component,
      topInDashboardUnits: newTopInDashboardUnits,
      leftInDashboardUnits: newLeftInDashboardUnits,
    };

    props.onComponentUpdate(newComponentProps);
  };

  const resizeWidth: (event: MouseEvent) => void = (event: MouseEvent) => {
    if (dashboardComponentRef.current === null) {
      return;
    }

    let newDashboardComponentwidthInPx: number =
      event.clientX -
      (window.scrollX +
        dashboardComponentRef.current.getBoundingClientRect().left);
    if (
      GetDashboardUnitWidthInPx(props.totalCurrentDashboardWidthInPx) >
      newDashboardComponentwidthInPx
    ) {
      newDashboardComponentwidthInPx = GetDashboardUnitWidthInPx(
        props.totalCurrentDashboardWidthInPx,
      );
    }

    // get this in dashboard units.,
    const widthInDashboardUnits: number =
      GetDashboardComponentWidthInDashboardUnits(
        props.totalCurrentDashboardWidthInPx,
        newDashboardComponentwidthInPx,
      );

    // update the component
    const newComponentProps: DashboardBaseComponent = {
      ...props.component,
      widthInDashboardUnits: widthInDashboardUnits,
    };

    props.onComponentUpdate(newComponentProps);
  };

  const resizeHeight: (event: MouseEvent) => void = (event: MouseEvent) => {
    if (dashboardComponentRef.current === null) {
      return;
    }

    let newDashboardComponentHeightInPx: number =
      event.clientY -
      (window.scrollY +
        dashboardComponentRef.current.getBoundingClientRect().top);

    if (
      GetDashboardUnitHeightInPx(props.totalCurrentDashboardWidthInPx) >
      newDashboardComponentHeightInPx
    ) {
      newDashboardComponentHeightInPx = GetDashboardUnitHeightInPx(
        props.totalCurrentDashboardWidthInPx,
      );
    }

    // get this in dashboard units
    const heightInDashboardUnits: number =
      GetDashboardComponentHeightInDashboardUnits(
        props.totalCurrentDashboardWidthInPx,
        newDashboardComponentHeightInPx,
      );

    // update the component
    const newComponentProps: DashboardBaseComponent = {
      ...props.component,
      heightInDashboardUnits: heightInDashboardUnits,
    };

    props.onComponentUpdate(newComponentProps);
  };

  const stopResizeAndMove: () => void = () => {
    window.removeEventListener("mousemove", resizeHeight);
    window.removeEventListener("mousemove", resizeWidth);
    window.removeEventListener("mousemove", moveComponent);
    window.removeEventListener("mouseup", stopResizeAndMove);
  };

  const getResizeWidthElement: GetReactElementFunction = (): ReactElement => {
    if (!props.isSelected || !props.isEditMode) {
      return <></>;
    }

    return (
      <div
        style={{
          top: "calc(50% - 20px)",
          right: "-5px",
        }}
        onMouseDown={(event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
          event.preventDefault();
          window.addEventListener("mousemove", resizeWidth);
          window.addEventListener("mouseup", stopResizeAndMove);
        }}
        className="resize-width-element cursor-ew-resize absolute right-0 w-2 h-12 bg-blue-300 hover:bg-blue-400 rounded-full cursor-pointer"
      ></div>
    );
  };

  const getMoveElement: GetReactElementFunction = (): ReactElement => {
    // if not selected, then return null

    if (!props.isSelected || !props.isEditMode) {
      return <></>;
    }

    return (
      <div
        style={{
          top: "-9px",
          left: "-9px",
        }}
        key={props.key}
        onMouseDown={(event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
          event.preventDefault();

          window.addEventListener("mousemove", moveComponent);
          window.addEventListener("mouseup", stopResizeAndMove);
        }}
        className="move-element cursor-move absolute w-4 h-4 bg-blue-300 hover:bg-blue-400 rounded-full cursor-pointer"
        onDragStart={(_event: React.DragEvent<HTMLDivElement>) => {}}
        onDragEnd={(_event: React.DragEvent<HTMLDivElement>) => {}}
      ></div>
    );
  };

  const getResizeHeightElement: GetReactElementFunction = (): ReactElement => {
    if (!props.isSelected || !props.isEditMode) {
      return <></>;
    }

    return (
      <div
        style={{
          bottom: "-5px",
          left: "calc(50% - 20px)",
        }}
        onMouseDown={(event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
          event.preventDefault();
          window.addEventListener("mousemove", resizeHeight);
          window.addEventListener("mouseup", stopResizeAndMove);
        }}
        className="resize-height-element cursor-ns-resize absolute bottom-0 left-0 w-12 h-2 bg-blue-300 hover:bg-blue-400 rounded-full cursor-pointer"
      ></div>
    );
  };

  type GetEditComponentToolbarFunction = (
    editToolbarComponentElements: Array<ReactElement>,
  ) => ReactElement;

  const getEditComponentToolbar: GetEditComponentToolbarFunction = (
    editToolbarComponentElements: Array<ReactElement>,
  ): ReactElement => {
    if (!props.isEditMode || !props.isSelected) {
      return <></>;
    }

    return (
      <div className="absolute -top-5 right-1/2 bg-white shadow-md rounded-md pt-0.5 pr-0.5 pl-0.5 border border-gray-50 -pb-1">
        {editToolbarComponentElements.map(
          (element: ReactElement, index: number) => {
            return (
              <div key={index} className="inline-block">
                {element}
              </div>
            );
          },
        )}
      </div>
    );
  };

  return (
    <div
      className={className}
      key={props.key}
      onClick={() => {
        props.onClick();
      }}
      style={{
        margin: `${MarginForEachUnitInPx}px`,
        height: `${
          GetDashboardUnitHeightInPx(props.totalCurrentDashboardWidthInPx) *
            heightOfComponent +
          SpaceBetweenUnitsInPx * (heightOfComponent - 1)
        }px`,
        width: `${
          GetDashboardUnitWidthInPx(props.totalCurrentDashboardWidthInPx) *
            widthOfComponent +
          (SpaceBetweenUnitsInPx - 2) * (widthOfComponent - 1)
        }px`,
      }}
      ref={dashboardComponentRef}
    >
      {getMoveElement()}

      {props.component._type === ObjectType.DashboardTextComponent && (
        <DashboardTextComponent
          {...props}
          isEditMode={props.isEditMode}
          isSelected={props.isSelected}
          component={props.component as DashboardTextComponentType}
          editToolbarComponentElements={getEditComponentToolbar}
        />
      )}
      {props.component._type === ObjectType.DashboardChartComponent && (
        <DashboardChartComponent
          {...props}
          isEditMode={props.isEditMode}
          isSelected={props.isSelected}
          component={props.component as DashboardChartComponentType}
          editToolbarComponentElements={getEditComponentToolbar}
        />
      )}
      {props.component._type === ObjectType.DashboardValueComponent && (
        <DashboardValueComponent
          {...props}
          isSelected={props.isSelected}
          isEditMode={props.isEditMode}
          component={props.component as DashboardValueComponentType}
          editToolbarComponentElements={getEditComponentToolbar}
        />
      )}

      {getResizeWidthElement()}
      {getResizeHeightElement()}
    </div>
  );
};

export default DashboardBaseComponentElement;
