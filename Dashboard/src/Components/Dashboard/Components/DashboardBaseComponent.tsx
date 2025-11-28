import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardTextComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import DashboardChartComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardValueComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardLogsComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardLogsComponent";
import DashboardChartComponent from "./DashboardChartComponent";
import DashboardValueComponent from "./DashboardValueComponent";
import DashboardTextComponent from "./DashboardTextComponent";
import DashboardLogsComponent from "./DashboardLogsComponent";
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
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import MetricType from "Common/Models/DatabaseModels/MetricType";

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
  dashboardComponentHeightInPx: number;
  dashboardComponentWidthInPx: number;
  dashboardViewConfig: DashboardViewConfig;
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  metricTypes: Array<MetricType>;
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

    const newMoveToTop: number = mouseEvent.clientY;
    const newMoveToLeft: number = mouseEvent.clientX;

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
    let widthInDashboardUnits: number =
      GetDashboardComponentWidthInDashboardUnits(
        props.totalCurrentDashboardWidthInPx,
        newDashboardComponentwidthInPx,
      );

    // if this width is less than the min width then set it to min width

    if (widthInDashboardUnits < component.minWidthInDashboardUnits) {
      widthInDashboardUnits = component.minWidthInDashboardUnits;
    }

    // if its more than the max width of dashboard.
    if (widthInDashboardUnits > DefaultDashboardSize.widthInDashboardUnits) {
      widthInDashboardUnits = DefaultDashboardSize.widthInDashboardUnits;
    }

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
    let heightInDashboardUnits: number =
      GetDashboardComponentHeightInDashboardUnits(
        props.totalCurrentDashboardWidthInPx,
        newDashboardComponentHeightInPx,
      );

    // if this height is less tan the min height then set it to min height

    if (heightInDashboardUnits < component.minHeightInDashboardUnits) {
      heightInDashboardUnits = component.minHeightInDashboardUnits;
    }

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

    let resizeCursorIcon: string = "cursor-ew-resize";

    // if already at min width then change icon to e-resize

    if (component.widthInDashboardUnits <= component.minWidthInDashboardUnits) {
      resizeCursorIcon = "cursor-e-resize";
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
        className={`resize-width-element ${resizeCursorIcon} absolute right-0 w-2 h-12 bg-blue-300 hover:bg-blue-400 rounded-full cursor-pointer`}
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

    let resizeCursorIcon: string = "cursor-ns-resize";

    // if already at min height then change icon to s-resize

    if (
      component.heightInDashboardUnits <= component.minHeightInDashboardUnits
    ) {
      resizeCursorIcon = "cursor-s-resize";
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
        className={`resize-height-element ${resizeCursorIcon} absolute bottom-0 left-0 w-12 h-2 bg-blue-300 hover:bg-blue-400 rounded-full cursor-pointer`}
      ></div>
    );
  };

  return (
    <div
      className={className}
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
      key={component.componentId?.toString() || Math.random().toString()}
      ref={dashboardComponentRef}
      onClick={props.onClick}
    >
      {getMoveElement()}

      {component.componentType === DashboardComponentType.Text && (
        <DashboardTextComponent
          {...props}
          isEditMode={props.isEditMode}
          isSelected={props.isSelected}
          component={component as DashboardTextComponentType}
        />
      )}
      {component.componentType === DashboardComponentType.Chart && (
        <DashboardChartComponent
          {...props}
          isEditMode={props.isEditMode}
          isSelected={props.isSelected}
          component={component as DashboardChartComponentType}
        />
      )}
      {component.componentType === DashboardComponentType.Value && (
        <DashboardValueComponent
          {...props}
          isSelected={props.isSelected}
          isEditMode={props.isEditMode}
          component={component as DashboardValueComponentType}
        />
      )}
      {component.componentType === DashboardComponentType.Logs && (
        <DashboardLogsComponent
          {...props}
          isSelected={props.isSelected}
          isEditMode={props.isEditMode}
          component={component as DashboardLogsComponentType}
        />
      )}

      {getResizeWidthElement()}
      {getResizeHeightElement()}
    </div>
  );
};

export default DashboardBaseComponentElement;
