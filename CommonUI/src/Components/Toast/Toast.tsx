import React, { FunctionComponent, ReactElement, useState } from "react";
import Icon from "../Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export enum ToastType {
  DANGER,
  SUCCESS,
  INFO,
  WARNING,
  NORMAL,
}

export interface ComponentProps {
  title: string;
  description: string;
  onClose?: undefined | (() => void);
  type?: undefined | ToastType;
  icon?: IconProp | undefined;
  index?: undefined | number;
}

const Component: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [show, setShow] = useState<boolean>(true);
  let typeCssClass: string = "text-gray-400";
  let iconType: IconProp = IconProp.Info;

  if (props.type === ToastType.NORMAL) {
    typeCssClass = "text-gray-400";
    iconType = IconProp.Info;
  }
  if (props.type === ToastType.DANGER) {
    typeCssClass = "text-red-400";
    iconType = IconProp.Error;
  }
  if (props.type === ToastType.WARNING) {
    typeCssClass = "text-yellow-400";
    iconType = IconProp.Alert;
  }
  if (props.type === ToastType.SUCCESS) {
    typeCssClass = "text-green-400";
    iconType = IconProp.CheckCircle;
  }
  if (props.type === ToastType.INFO) {
    typeCssClass = "text-blue-400";
    iconType = IconProp.Info;
  }

  if (props.icon) {
    iconType = props.icon;
  }

  let top: number = 0;

  if (props.index) {
    top = props.index * 16; // move the second item lower than the first one. 16 is the height of the toast.
  }

  if (show) {
    return (
      <div
        data-testid="toast"
        aria-live="assertive"
        className={`pointer-events-none fixed z-40 top-${top} left-0 right-0  flex items-end px-4 py-6 sm:items-start sm:p-6`}
      >
        <div className="flex w-full flex-col items-center space-y-4 sm:items-end">
          <div className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5">
            <div className="p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <Icon
                    className={`h-6 w-6 ${typeCssClass}`}
                    data-testid="toast-icon"
                    icon={iconType}
                  />
                </div>
                <div className="ml-3 w-0 flex-1 pt-0.5">
                  <p
                    data-testId="title"
                    className="text-sm font-medium text-gray-900"
                  >
                    {props.title}
                  </p>
                  <p
                    data-testId="description"
                    className="mt-1 text-sm text-gray-500"
                  >
                    {props.description}
                  </p>
                  {/* <div className="mt-3 flex space-x-7">
                    <button type="button" className="rounded-md bg-white text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">Undo</button>
                    <button type="button" className="rounded-md bg-white text-sm font-medium text-gray-700 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">Dismiss</button>
                  </div> */}
                </div>
                <div className="ml-4 flex flex-shrink-0">
                  <button
                    onClick={() => {
                      setShow(false);
                      if (props.onClose) {
                        props.onClose();
                      }
                    }}
                    data-testid="close-button"
                    type="button"
                    className="inline-flex rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    <span className="sr-only">Close</span>
                    <Icon className={`h-5 w-5`} icon={IconProp.Close} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return <></>;
};

export default Component;
