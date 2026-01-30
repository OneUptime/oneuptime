import React, { ReactElement, ReactNode } from "react";
import { HeaderAlertType } from "../HeaderAlert";

export interface ComponentProps {
  title: string;
  alertType: HeaderAlertType;
  children: ReactNode;
}

const NotificationBellSection: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  let textColor: string = "text-indigo-600";

  switch (props.alertType) {
    case HeaderAlertType.SUCCESS:
      textColor = "text-emerald-600";
      break;
    case HeaderAlertType.ERROR:
      textColor = "text-red-600";
      break;
    case HeaderAlertType.WARNING:
      textColor = "text-amber-600";
      break;
    case HeaderAlertType.INFO:
      textColor = "text-indigo-600";
      break;
  }

  return (
    <div className="py-2">
      <div className={`px-3 py-1 text-xs font-semibold uppercase ${textColor}`}>
        {props.title}
      </div>
      <div className="space-y-2 px-3 py-1">{props.children}</div>
    </div>
  );
};

export default NotificationBellSection;
