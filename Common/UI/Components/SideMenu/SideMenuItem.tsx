import Navigation from "../../Utils/Navigation";
import useTranslateValue from "../../Utils/Translation";
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

/*
 * One navigation row.
 *
 * The icon is drawn bare rather than inside a filled chip. A chip per row
 * turns a fifteen-entry menu into a column of grey squares that all read the
 * same, and it costs ~28px of the 208px the menu had — which is why titles
 * like "Scheduled Maintenance" and "Recommendations" were being truncated to
 * "Scheduled Mainte..." next to a badge. The icon still carries the active and
 * hover colour; it just does it without a box around it.
 */
const SideMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { translateString } = useTranslateValue();
  const isActive: boolean = Navigation.isOnThisPage(props.link.to);
  const isSubItemActive: boolean = props.subItemLink
    ? Navigation.isOnThisPage(props.subItemLink.to)
    : false;
  const translatedTitle: string =
    translateString(props.link.title) || props.link.title;
  const translatedSubItemTitle: string | undefined = props.subItemLink
    ? translateString(props.subItemLink.title) || props.subItemLink.title
    : undefined;

  return (
    <>
      {/* Main Menu Item */}
      <UILink
        className={`
          ${props.className || ""}
          group relative flex items-center justify-between
          pl-3 pr-2 py-1.5 rounded-md
          text-sm
          transition-colors duration-150 ease-out
          ${
            isActive
              ? "bg-indigo-50 text-indigo-700 font-semibold"
              : "font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          }
        `}
        to={props.link.to}
        onClick={() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        {/*
         * The active rail. It sits inside the row's left padding rather than
         * outside it, so the row's background and the rail share one edge —
         * an accent bar floating in the gutter reads as a rendering artefact
         * once the row behind it is tinted.
         */}
        <div
          className={`
            absolute left-1 top-1/2 -translate-y-1/2
            w-0.5 rounded-full
            transition-all duration-150 ease-out
            ${isActive ? "h-4 bg-indigo-600" : "h-0 bg-transparent"}
          `}
        />

        {/* Content Container */}
        <div className="flex items-center min-w-0 gap-2.5">
          {props.icon && (
            <Icon
              icon={props.icon}
              className={`
                h-4 w-4 flex-shrink-0
                transition-colors duration-150
                ${
                  isActive
                    ? "text-indigo-600"
                    : "text-gray-400 group-hover:text-gray-600"
                }
              `}
            />
          )}

          {/*
           * `truncate` is load-bearing beyond the ellipsis: the side-menu test
           * harness reads a row's title from `span.truncate`, and without it
           * falls back to the anchor's full textContent — which would fold the
           * badge digits into every title it reads.
           */}
          <span className="truncate transition-colors duration-150">
            {translatedTitle}
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
              <Icon icon={IconProp.Error} className="text-red-500 h-4 w-4" />
            )}
            {props.showWarning && (
              <Icon icon={IconProp.Alert} className="text-amber-500 h-4 w-4" />
            )}
          </div>
        )}
      </UILink>

      {/* Sub Item */}
      {props.subItemLink && (
        <div className="ml-5 border-l border-gray-200 pl-2">
          <UILink
            className={`
              ${props.className || ""}
              group relative flex items-center justify-between
              px-2 py-1.5 rounded-md
              text-sm font-medium
              transition-colors duration-150 ease-out
              ${
                isSubItemActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              }
            `}
            to={props.subItemLink.to}
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <div className="flex items-center min-w-0 gap-2.5">
              <Icon
                icon={props.subItemIcon || IconProp.MinusSmall}
                className={`
                  h-4 w-4 flex-shrink-0 transition-colors duration-150
                  ${
                    isSubItemActive
                      ? "text-indigo-600"
                      : "text-gray-400 group-hover:text-gray-600"
                  }
                `}
              />
              <span className="truncate">{translatedSubItemTitle}</span>
            </div>
          </UILink>
        </div>
      )}
    </>
  );
};

export default SideMenuItem;
