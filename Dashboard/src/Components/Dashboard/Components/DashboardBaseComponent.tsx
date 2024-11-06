import React, { FunctionComponent, ReactElement, useEffect } from "react";
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
import ObjectID from "Common/Types/ObjectID";

export interface DashboardCommonComponentProps
  extends DashboardBaseComponentProps {
  editToolbarComponentElements: (elements: Array<ReactElement>) => ReactElement;
}

export interface DashboardBaseComponentProps {
  componentId: ObjectID;
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
  const component: DashboardBaseComponent =
    props.dashboardViewConfig.components.find(
      (component: DashboardBaseComponent) => {
        return (
          component.componentId.toString() === props.componentId.toString()
        );
      },
    ) as DashboardBaseComponent;

  const widthOfComponent: number = component.widthInDashboardUnits;
  const heightOfComponent: number = component.heightInDashboardUnits;

  const [topInPx, setTopInPx] = React.useState<number>(0);
  const [leftInPx, setLeftInPx] = React.useState<number>(0);

  let className: string = `relative rounded-md col-span-${widthOfComponent} row-span-${heightOfComponent} p-2 bg-white border-2 border-solid border-gray-100`;

  if (props.isEditMode) {
    className += "  cursor-pointer";
  }

  if (props.isSelected && props.isEditMode) {
    className += " border-2 border-blue-300";
  }

  const dashboardComponentRef: React.RefObject<HTMLDivElement> =
    React.useRef<HTMLDivElement>(null);

  const refreshTopAndLeftInPx: () => void = () => {
    if (dashboardComponentRef.current === null) {
      return;
    }

    const topInPx: number =
      dashboardComponentRef.current.getBoundingClientRect().top;
    const leftInPx: number =
      dashboardComponentRef.current.getBoundingClientRect().left;

    setTopInPx(topInPx);
    setLeftInPx(leftInPx);
  };

  useEffect(() => {
    refreshTopAndLeftInPx();
  }, [props.dashboardViewConfig]);

  type MoveComponentFunction = (mouseEvent: MouseEvent) => void;

  const moveComponent: MoveComponentFunction = (
    mouseEvent: MouseEvent,
  ): void => {
    const dashboardComponentOldTopInPx: number = topInPx;
    const dashboardComponentOldLeftInPx: number = leftInPx;

    const newMoveToTop: number = mouseEvent.pageY;
    const newMoveToLeft: number = mouseEvent.pageX;

    const deltaXInPx: number = newMoveToLeft - dashboardComponentOldLeftInPx;
    const deltaYInPx: number = newMoveToTop - dashboardComponentOldTopInPx;

    const eachDashboardUnitInPx: number = GetDashboardUnitWidthInPx(
      props.totalCurrentDashboardWidthInPx,
    );

    const deltaXInDashboardUnits: number = Math.round(
      deltaXInPx / eachDashboardUnitInPx,
    );
    const deltaYInDashboardUnits: number = Math.round(
      deltaYInPx / eachDashboardUnitInPx,
    );

    let newTopInDashboardUnits: number =
      component.topInDashboardUnits + deltaYInDashboardUnits;
    let newLeftInDashboardUnits: number =
      component.leftInDashboardUnits + deltaXInDashboardUnits;

    // now make sure these are within the bounds of the dashboard inch component width and height in dashbosrd units

    const dahsboardTotalWidthInDashboardUnits: number =
      DefaultDashboardSize.widthInDashboardUnits; // width does not change
    const dashboardTotalHeightInDashboardUnits: number =
      props.dashboardViewConfig.heightInDashboardUnits;

    const heightOfTheComponntInDashboardUnits: number =
      component.heightInDashboardUnits;

    const widthOfTheComponentInDashboardUnits: number =
      component.widthInDashboardUnits;

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

    // make sure they are not negative

    if (newTopInDashboardUnits < 0) {
      newTopInDashboardUnits = 0;
    }

    if (newLeftInDashboardUnits < 0) {
      newLeftInDashboardUnits = 0;
    }

    // update the component
    const newComponentProps: DashboardBaseComponent = {
      ...component,
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
      event.pageX -
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
      ...component,
      widthInDashboardUnits: widthInDashboardUnits,
    };

    props.onComponentUpdate(newComponentProps);
  };

  const resizeHeight: (event: MouseEvent) => void = (event: MouseEvent) => {
    if (dashboardComponentRef.current === null) {
      return;
    }

    let newDashboardComponentHeightInPx: number =
      event.pageY -
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
      ...component,
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
        onMouseUp={() => {
          stopResizeAndMove();
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

      {component._type === ObjectType.DashboardTextComponent && (
        <DashboardTextComponent
          {...props}
          isEditMode={props.isEditMode}
          isSelected={props.isSelected}
          component={component as DashboardTextComponentType}
          editToolbarComponentElements={getEditComponentToolbar}
        />
      )}
      {component._type === ObjectType.DashboardChartComponent && (
        <DashboardChartComponent
          {...props}
          isEditMode={props.isEditMode}
          isSelected={props.isSelected}
          component={component as DashboardChartComponentType}
          editToolbarComponentElements={getEditComponentToolbar}
        />
      )}
      {component._type === ObjectType.DashboardValueComponent && (
        <DashboardValueComponent
          {...props}
          isSelected={props.isSelected}
          isEditMode={props.isEditMode}
          component={component as DashboardValueComponentType}
          editToolbarComponentElements={getEditComponentToolbar}
        />
      )}

      {getResizeWidthElement()}
      {getResizeHeightElement()}
    </div>
  );
};

export default DashboardBaseComponentElement;
