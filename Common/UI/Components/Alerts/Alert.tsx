import Icon from "../Icon/Icon";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export enum AlertType {
  INFO,
  SUCCESS,
  DANGER,
  WARNING,
}

export enum AlertSize {
  Normal,
  Large,
}

export interface ComponentProps {
  strongTitle?: string;
  title?: string;
  onClose?: () => void;
  type?: AlertType;
  onClick?: () => void;
  doNotShowIcon?: boolean | undefined;
  dataTestId?: string | undefined;
  textClassName?: string | undefined;
  className?: string | undefined;
  color?: Color | undefined;
  id?: string | undefined;
  textOnRight?: string | undefined;
}

const Alert: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const type: AlertType = props.type || AlertType.INFO;

  const typeClassNames: {
    [key in AlertType]: {
      text: string;
      bg: string;
      hover: string;
    };
  } = {
    [AlertType.DANGER]: {
      text: "text-red-200",
      bg: "bg-red-700",
      hover: "hover:bg-red-600",
    },
    [AlertType.INFO]: {
      text: "text-gray-200",
      bg: "bg-gray-700",
      hover: "hover:bg-gray-600",
    },
    [AlertType.WARNING]: {
      text: "text-yellow-200",
      bg: "bg-gray-700",
      hover: "hover:bg-yellow-600",
    },
    [AlertType.SUCCESS]: {
      text: "text-green-200",
      bg: "bg-gray-700",
      hover: "hover:bg-green-600",
    },
  };

  const {
    text: textClassName,
    bg: bgClassName,
    hover: hoverClassName,
  } = typeClassNames[type];

  return (
    <div
      id={props.id}
      className={`alert rounded-md ${bgClassName} p-4 ${props.className}`}
      data-testid={props.dataTestId}
      onClick={props.onClick}
      role="alert"
      style={props.color ? { backgroundColor: props.color.toString() } : {}}
    >
      <div className="alert-content flex">
        {!props.doNotShowIcon && (
          <div className="alert-icon flex-shrink-0">
            {type === AlertType.DANGER && (
              <Icon
                icon={IconProp.Alert}
                className={`h-5 w-5 ${textClassName}`}
              />
            )}
            {type === AlertType.WARNING && (
              <Icon
                icon={IconProp.Alert}
                className={`h-5 w-5 ${textClassName}`}
              />
            )}
            {type === AlertType.SUCCESS && (
              <Icon
                icon={IconProp.CheckCircle}
                className={`h-5 w-5 ${textClassName}`}
              />
            )}
            {type === AlertType.INFO && (
              <Icon
                icon={IconProp.Info}
                className={`h-5 w-5 ${textClassName}`}
              />
            )}
          </div>
        )}
        <div
          className={`alert-text ml-3 mr-3 flex-1 md:flex md:justify-between ${props.textClassName}`}
        >
          <div
            className={`alert-message text-sm flex justify-between ${textClassName}`}
          >
            <div>
              <span className="font-medium">
                {props.strongTitle}{" "}
                {props.title && props.strongTitle ? "- " : ""}
              </span>
              {props.title}
            </div>
            {props.textOnRight && <div>{props.textOnRight}</div>}
          </div>
          {props.onClose && (
            <p className="alert-close mt-3 text-sm md:mt-0 md:ml-6">
              <button
                onClick={props.onClose}
                role="alert-close-button"
                className={`whitespace-nowrap font-medium ${textClassName} hover:${hoverClassName}`}
              >
                Close
                <span aria-hidden="true"> &rarr;</span>
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Alert;
