import Icon, { ThickProp } from "../Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import React, { ReactElement } from "react";
import Tooltip from "../Tooltip/Tooltip";
import { GetReactElementFunction } from "../../Types/FunctionTypes";

export enum HeaderAlertType {
  SUCCESS = "Success",
  ERROR = "Error",
  WARNING = "Warning",
  INFO = "Info",
}

export interface ComponentProps {
  icon: IconProp;
  onClick?: (() => void) | undefined;
  title: string;
  className?: string | undefined;
  alertType: HeaderAlertType;
  tooltip?: string | undefined;
}

const HeaderAlert: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  let textColor: string = "text-indigo-500"; // default color info.

  switch (props.alertType) {
    case HeaderAlertType.SUCCESS:
      textColor = "text-green-500 hover:text-green-600";
      break;
    case HeaderAlertType.ERROR:
      textColor = "text-red-500 hover:text-red-600";
      break;
    case HeaderAlertType.WARNING:
      textColor = "text-yellow-500 hover:text-yellow-600";
      break;
    case HeaderAlertType.INFO:
      textColor = "text-indigo-500 hover:text-indigo-600";
      break;
  }

  const getElement: GetReactElementFunction = (): ReactElement => {
    return (
      <div
        className={`cursor-pointer hover:bg-gray-100 p-1 h-7 pl-2 pr-2 -mt-2 -ml-7 mr-1 rounded-full ${props.className}`}
        onClick={() => {
          props.onClick && props.onClick();
        }}
      >
        <div className="flex ">
          <div className={`flex-shrink-0 mt-0.5 ${textColor}`}>
            <Icon
              icon={props.icon}
              thick={ThickProp.Thick}
              className={`h-4 w-4 stroke-[3px] font-bold ${textColor}`}
            />
          </div>
          <div className="ml-1 flex-1 md:flex md:justify-between">
            <p className={`text-sm font-semibold ${textColor}`}>
              {props.title}
            </p>
          </div>
        </div>
      </div>
    );
  };

  if (props.tooltip) {
    return <Tooltip text={props.tooltip}>{getElement()}</Tooltip>;
  }

  return getElement();
};

export default HeaderAlert;
