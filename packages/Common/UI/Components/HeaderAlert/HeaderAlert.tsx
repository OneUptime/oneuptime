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
  // In English, looked up by the tooltip - unless isTooltipTranslated says.
  tooltip?: string | undefined;
  /*
   * The tooltip is in the reader's words already: a front end's own keyed
   * text, a sentence built around a value. Drawn as given, never looked up
   * again (#8423): looked up again, a translation that is itself an English
   * key reads as another word, as the Spanish "Red" (Network) read "Rojo".
   */
  isTooltipTranslated?: boolean | undefined;
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
    const boxClassName: string = `${bgColor} border ${borderColor} mx-1 py-1.5 px-3 rounded-lg transition-all duration-150 ${props.className || ""}`;

    const content: ReactElement = (
      <span className="flex items-center gap-1.5">
        <span className={`flex-shrink-0 ${textColor}`} aria-hidden="true">
          <Icon
            icon={props.icon}
            thick={ThickProp.Thick}
            className={`h-4 w-4 stroke-[2.5px] ${textColor}`}
          />
        </span>
        <span className="flex items-center gap-1">
          <span className={`text-sm font-semibold ${textColor}`}>
            {props.title}
          </span>
          {props.suffix && (
            /*
             * Hidden from a narrow screen's eye only: a screen reader
             * still hears "3 incidents", not a bare "3".
             */
            <span
              className={`${textColor} text-sm font-medium opacity-80 max-md:sr-only md:block`}
            >
              {props.suffix}
            </span>
          )}
        </span>
      </span>
    );

    if (!props.onClick) {
      return <div className={boxClassName}>{content}</div>;
    }

    /*
     * A real button when it does something: it was a div with only a click,
     * which a keyboard could not reach (#9136).
     */
    return (
      <button
        type="button"
        className={`${boxClassName} cursor-pointer ${hoverBgColor} focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1`}
        onClick={() => {
          props.onClick?.();
        }}
      >
        {content}
      </button>
    );
  };

  if (props.tooltip) {
    return (
      <Tooltip
        text={props.tooltip}
        isTextTranslated={props.isTooltipTranslated}
      >
        {getElement()}
      </Tooltip>
    );
  }

  return getElement();
};

export default HeaderAlert;
