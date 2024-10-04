import Icon from "../Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import React, { ReactElement } from "react";

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
}

const HeaderAlert: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {

  let bgColor: string = "bg-indigo-500" // default color info. 

  switch (props.alertType) {
    case HeaderAlertType.SUCCESS:
      bgColor = "bg-green-500 hover:bg-green-600";
      break;
    case HeaderAlertType.ERROR:
      bgColor = "bg-red-500 hover:bg-red-600";
      break;
    case HeaderAlertType.WARNING:
      bgColor = "bg-yellow-500 hover:bg-yellow-600";
      break;
    case HeaderAlertType.INFO:
      bgColor = "bg-indigo-500 hover:bg-indigo-600";
      break;
  }


  return (
    <div
      className={`rounded-md m-3 p-3 ${bgColor} ${props.className} cursor-pointer ml-0 p-3 pr-4`}
      onClick={() => {
        props.onClick && props.onClick();
      }}
    >
      <div className="flex ">
        <div className="flex-shrink-0">
          <Icon icon={props.icon} className="h-5 w-5 text-white" />
        </div>
        <div className="ml-1 flex-1 md:flex md:justify-between">
          <p className={`text-sm text-white`}>{props.title}</p>
        </div>
      </div>
    </div>
  );
};

export default HeaderAlert;
