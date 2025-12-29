import Navigation from "../../Utils/Navigation";
import Badge, { BadgeType } from "../Badge/Badge";
import Icon from "../Icon/Icon";
import UILink from "../Link/Link";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import React, { FunctionComponent } from "react";

export interface ComponentProps {
  link: Link;
  showAlert?: undefined | boolean;
  showWarning?: undefined | boolean;
  badge?: undefined | number;
  badgeType?: BadgeType | undefined;
  icon?: undefined | IconProp;
  className?: undefined | string;
  subItemLink?: undefined | Link;
  subItemIcon?: undefined | IconProp;
}

const SideMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const isActive: boolean = Navigation.isOnThisPage(props.link.to);
  const isSubItemActive: boolean = props.subItemLink
    ? Navigation.isOnThisPage(props.subItemLink.to)
    : false;

  return (
    <>
      {/* Main Menu Item */}
      <UILink
        className={`
          ${props.className || ""}
          group relative flex items-center justify-between
          px-2 py-1.5 rounded-lg
          text-sm font-medium
          transition-all duration-200 ease-out
          ${
            isActive
              ? "bg-gradient-to-r from-indigo-50 to-indigo-50/50 text-indigo-700 shadow-sm"
              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          }
        `}
        to={props.link.to}
        onClick={() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        {/* Active Indicator Bar */}
        <div
          className={`
            absolute left-0 top-1/2 -translate-y-1/2
            w-0.5 rounded-full
            transition-all duration-200 ease-out
            ${isActive ? "h-5 bg-indigo-600" : "h-0 bg-transparent"}
          `}
        />

        {/* Content Container */}
        <div className="flex items-center min-w-0 gap-2">
          {/* Icon with background on active */}
          {props.icon && (
            <div
              className={`
                flex items-center justify-center
                w-6 h-6 rounded-md
                transition-all duration-200
                ${
                  isActive
                    ? "bg-indigo-100 text-indigo-600"
                    : "bg-gray-100 text-gray-500 group-hover:bg-gray-200 group-hover:text-gray-700"
                }
              `}
            >
              <Icon icon={props.icon} className="h-3.5 w-3.5" />
            </div>
          )}

          {/* Title */}
          <span
            className={`
              truncate transition-colors duration-200
              ${isActive ? "font-semibold" : ""}
            `}
          >
            {props.link.title}
          </span>
        </div>

        {/* Badge / Alert / Warning Container */}
        {(props.badge !== undefined ||
          props.showAlert ||
          props.showWarning) && (
          <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
            {props.badge !== undefined && (
              <Badge badgeCount={props.badge} badgeType={props.badgeType} />
            )}
            {props.showAlert && (
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br from-red-50 to-red-100 ring-1 ring-inset ring-red-200/60 shadow-sm">
                <Icon icon={IconProp.Error} className="text-red-600 h-3 w-3" />
              </div>
            )}
            {props.showWarning && (
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br from-amber-50 to-amber-100 ring-1 ring-inset ring-amber-200/60 shadow-sm">
                <Icon
                  icon={IconProp.Alert}
                  className="text-amber-600 h-3 w-3"
                />
              </div>
            )}
          </div>
        )}

        {/* Hover indicator */}
        <div
          className={`
            absolute inset-0 rounded-lg
            border-2 border-transparent
            transition-all duration-200
            ${!isActive ? "group-hover:border-gray-200" : ""}
            pointer-events-none
          `}
        />
      </UILink>

      {/* Sub Item */}
      {props.subItemLink && (
        <UILink
          className={`
            ${props.className || ""}
            group relative flex items-center justify-between
            ml-8 px-2 py-1.5 rounded-lg
            text-sm font-medium
            transition-all duration-200 ease-out
            ${
              isSubItemActive
                ? "bg-indigo-50/70 text-indigo-700"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            }
          `}
          to={props.subItemLink.to}
          onClick={() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          {/* Connector Line */}
          <div className="absolute -left-3 top-1/2 w-2 h-px bg-gray-200" />

          {/* Sub Item Icon */}
          <div className="flex items-center min-w-0 gap-2">
            <Icon
              icon={props.subItemIcon || IconProp.MinusSmall}
              className={`
                h-4 w-4 transition-colors duration-200
                ${
                  isSubItemActive
                    ? "text-indigo-500"
                    : "text-gray-400 group-hover:text-gray-600"
                }
              `}
            />
            <span className="truncate">{props.subItemLink.title}</span>
          </div>
        </UILink>
      )}
    </>
  );
};

export default SideMenuItem;
