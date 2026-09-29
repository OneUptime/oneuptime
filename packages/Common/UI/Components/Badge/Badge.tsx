import React, { FunctionComponent, ReactElement } from "react";

export enum BadgeType {
  DANGER,
  SUCCESS,
  WARNING,
}

export interface ComponentProps {
  badgeCount: number;
  badgeType?: undefined | BadgeType;
  id?: string | undefined;
}

const Badge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Base styling for all badges
  let className: string =
    "bg-gradient-to-r from-gray-50 to-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200 shadow-sm";

  if (props.badgeType === BadgeType.DANGER) {
    className =
      "bg-gradient-to-r from-red-50 to-red-100 text-red-700 ring-1 ring-inset ring-red-200/80 shadow-sm shadow-red-100";
  }

  if (props.badgeType === BadgeType.WARNING) {
    className =
      "bg-gradient-to-r from-amber-50 to-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200/80 shadow-sm shadow-amber-100";
  }

  if (props.badgeType === BadgeType.SUCCESS) {
    className =
      "bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200/80 shadow-sm shadow-emerald-100";
  }

  if (props.badgeCount) {
    return (
      <span
        id={props.id}
        data-testid={props.id}
        className={`${className} ml-auto min-w-[1.75rem] whitespace-nowrap rounded-full px-2 py-0.5 text-center text-xs font-semibold leading-4 tabular-nums transition-all duration-200`}
        aria-hidden="true"
      >
        {props.badgeCount}
      </span>
    );
  }
  return <></>;
};

export default Badge;
