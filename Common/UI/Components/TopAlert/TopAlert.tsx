import React, { FunctionComponent, ReactElement } from "react";

export enum TopAlertType {
  INFO = "bg-indigo-700",
  WARNING = "bg-yellow-700",
  DANGER = "bg-red-700",
  SUCCESS = "bg-green-700",
}

export interface ComponentProps {
  title: string;
  description: ReactElement | string;
  alertType?: TopAlertType | undefined;
}

const TopAlert: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const alertType: TopAlertType = props.alertType || TopAlertType.INFO;

  return (
    <div
      className={`flex items-center text-center gap-x-6 ${alertType.toString()} px-6 py-2.5 sm:px-3.5`}
      role="alert"
      aria-live="polite"
    >
      <div className="text-sm leading-6 text-white w-full">
        <div className="w-full">
          <strong className="font-semibold">{props.title}</strong>
          &nbsp;-&nbsp;
          {props.description} &nbsp;&nbsp;
          {/** Uncomment the follwing line if you need a button on top alert */}
          {/* <a
                        href="#"
                        className="flex-none rounded-full bg-gray-200 px-3.5 py-1 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
                    >
                        Go to User Dashboard <span aria-hidden="true">&rarr;</span>
                    </a> */}
        </div>
      </div>
    </div>
  );
};

export default TopAlert;
