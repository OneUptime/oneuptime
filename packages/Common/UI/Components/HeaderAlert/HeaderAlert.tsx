import Icon, { ThickProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement } from "react";
import Tooltip from "../Tooltip/Tooltip";
import { GetReactElementFunction } from "../../Types/FunctionTypes";
import ColorSwatch from "../../../Types/ColorSwatch";

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
  colorSwatch?: ColorSwatch | undefined;
  suffix?: string | undefined;
}

const HeaderAlert: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  let textColor: string = "text-indigo-600";
  let bgColor: string = "bg-indigo-50";
  let hoverBgColor: string = "hover:bg-indigo-100";
  let borderColor: string = "border-indigo-200";

  switch (props.alertType) {
    case HeaderAlertType.SUCCESS:
      textColor = "text-emerald-600";
      bgColor = "bg-emerald-50";
      hoverBgColor = "hover:bg-emerald-100";
      borderColor = "border-emerald-200";
      break;
    case HeaderAlertType.ERROR:
      textColor = "text-red-600";
      bgColor = "bg-red-50";
      hoverBgColor = "hover:bg-red-100";
      borderColor = "border-red-200";
      break;
    case HeaderAlertType.WARNING:
      textColor = "text-amber-600";
      bgColor = "bg-amber-50";
      hoverBgColor = "hover:bg-amber-100";
      borderColor = "border-amber-200";
      break;
    case HeaderAlertType.INFO:
      textColor = "text-indigo-600";
      bgColor = "bg-indigo-50";
      hoverBgColor = "hover:bg-indigo-100";
      borderColor = "border-indigo-200";
      break;
  }

  // color swatch overrides the color.
  if (props.colorSwatch) {
    textColor = `text-${props.colorSwatch}-600`;
    bgColor = `bg-${props.colorSwatch}-50`;
    hoverBgColor = `hover:bg-${props.colorSwatch}-100`;
    borderColor = `border-${props.colorSwatch}-200`;
  }

  const getElement: GetReactElementFunction = (): ReactElement => {
    return (
      <div
        className={`cursor-pointer ${bgColor} ${hoverBgColor} border ${borderColor} mx-1 py-1.5 px-3 rounded-lg transition-all duration-150 ${props.className}`}
        onClick={() => {
          props.onClick?.();
        }}
      >
        <div className="flex items-center gap-1.5">
          <div className={`flex-shrink-0 ${textColor}`}>
            <Icon
              icon={props.icon}
              thick={ThickProp.Thick}
              className={`h-4 w-4 stroke-[2.5px] ${textColor}`}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className={`text-sm font-semibold ${textColor}`}>
              {props.title}
            </span>
            {props.suffix && (
              <span
                className={`${textColor} text-sm font-medium opacity-80 hidden md:block`}
              >
                {props.suffix}
              </span>
            )}
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
