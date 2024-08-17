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
  strongTitle?: undefined | string;
  title?: undefined | string;
  onClose?: undefined | (() => void);
  type?: undefined | AlertType;
  onClick?: (() => void) | undefined;
  doNotShowIcon?: boolean | undefined;
  dataTestId?: string;
  textClassName?: string | undefined;
  className?: string | undefined;
  color?: Color | undefined;
  id?: string | undefined;
  textOnRight?: string | undefined;
}

const Alert: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let type: AlertType = AlertType.INFO;

  if (props.type) {
    type = props.type;
  }

  let className: string = "text-gray";
  let bgClassName: string = "bg-gray";

  if (AlertType.DANGER === type) {
    className = "text-red";
    bgClassName = "bg-red";
  } else if (AlertType.INFO === type) {
    className = "text-gray";
    bgClassName = "bg-gray";
  } else if (AlertType.WARNING === type) {
    className = "text-yellow";
    bgClassName = "bg-gray";
  } else if (AlertType.SUCCESS === type) {
    className = "text-green";
    bgClassName = "bg-gray";
  }

  return (
    <div
      id={props.id}
      className={`rounded-md ${bgClassName}-700 p-4`}
      data-testid={props.dataTestId}
      onClick={() => {
        props.onClick && props.onClick();
      }}
      role="alert"
      style={
        props.color
          ? {
              backgroundColor: props.color?.toString(),
            }
          : {}
      }
    >
      <div className="flex ">
        {!props.doNotShowIcon && (
          <div className="flex-shrink-0">
            {AlertType.DANGER === type && (
              <Icon icon={IconProp.Alert} className="h-5 w-5 text-red-200" />
            )}
            {AlertType.WARNING === type && (
              <Icon icon={IconProp.Alert} className="h-5 w-5 text-yellow-200" />
            )}
            {AlertType.SUCCESS === type && (
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-400"
              />
            )}
            {AlertType.INFO === type && (
              <Icon icon={IconProp.Info} className="h-5 w-5 text-gray-200" />
            )}
          </div>
        )}
        <div
          className={`ml-3 mr-3 flex-1 md:flex md:justify-between ${props.className}`}
        >
          <div
            className={
              props.textClassName ||
              `text-sm flex justify-between ${className}-200`
            }
          >
            <div>
              <span className="font-medium">
                {props.strongTitle}{" "}
                {props.title && props.strongTitle ? "-" : ""}{" "}
              </span>
              {props.title}
            </div>
            {props.textOnRight && <div>{props.textOnRight}</div>}
          </div>

          {props.onClose && (
            <p className="mt-3 text-sm md:mt-0 md:ml-6">
              <button
                onClick={() => {
                  props.onClose && props.onClose();
                }}
                role={"alert-close-button"}
                className={`whitespace-nowrap font-medium ${className}-200 hover:${className}-50`}
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
