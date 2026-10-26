import useTranslateValue from "../../Utils/Translation";
import Badge, { BadgeType } from "../Badge/Badge";
import Icon from "../Icon/Icon";
import UILink, { LinkAriaCurrent } from "../Link/Link";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import React, { FunctionComponent } from "react";
import {
  getSideMenuEntryCurrent,
  SIDE_MENU_ITEM_TITLE_TEST_ID,
} from "./SideMenuEntryState";

export interface ComponentProps {
  link: Link;
  activeRoute?: Link["to"] | undefined;
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
 * same, and it costs ~28px of the menu's width, which titles like "Scheduled
 * Maintenance" and "Recommendations" next to a badge need. The icon still
 * carries the active and hover colour; it just does it without a box around
 * it.
 *
 * A title is drawn whole, on as many lines as it takes. It used to be cut
 * to one line with an ellipsis, which in other languages cut the words that
 * say what a page is: French "Règles de taux de consommation" (Burn Rate
 * Rules) read "Règles de taux de con…", and a tablet's 160 pixels cut
 * English "Import from another tool" too. A word longer than the whole line
 * (a German compound) breaks at the edge rather than running out of the
 * menu. The icon, the rail and the badge keep to the first line, so a row
 * of one line is drawn exactly as before.
 *
 * The entry for the page the user is on is lit, and says so to a screen
 * reader too (aria-current): "page" when it links to that very page, "true"
 * when the page sits under it - a role's page under Roles, a run's under
 * its runbook's Executions - and the entry marks it by its activeRoute.
 */
const SideMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { translateString } = useTranslateValue();
  const mainCurrent: LinkAriaCurrent | undefined = getSideMenuEntryCurrent({
    link: props.link,
    activeRoute: props.activeRoute,
  });
  const isActive: boolean = mainCurrent !== undefined;
  const subItemCurrent: LinkAriaCurrent | undefined = props.subItemLink
    ? getSideMenuEntryCurrent({ link: props.subItemLink })
    : undefined;
  const isSubItemActive: boolean = subItemCurrent !== undefined;
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
          group relative flex items-start justify-between
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
        ariaCurrent={mainCurrent}
        onClick={() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        {/*
         * The active rail. It sits inside the row's left padding rather than
         * outside it, so the row's background and the rail share one edge -
         * an accent bar floating in the gutter reads as a rendering artefact
         * once the row behind it is tinted. It runs the height of the title:
         * 16 pixels on a row of one line, as it always was, and down the
         * second line of a title that takes two.
         */}
        <div
          className={`
            absolute left-1
            w-0.5 rounded-full
            transition-all duration-150 ease-out
            ${isActive ? "top-2 bottom-2 bg-indigo-600" : "top-1/2 bottom-1/2 bg-transparent"}
          `}
        />

        {/* Content Container */}
        <div className="flex items-start min-w-0 gap-2.5">
          {props.icon && (
            <Icon
              icon={props.icon}
              className={`
                mt-0.5 h-4 w-4 flex-shrink-0
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
           * The title alone, without the badge's digits, which sit in the
           * same anchor: tests and the side-menu harness read a row's title
           * from this test id.
           */}
          <span
            className="min-w-0 break-words transition-colors duration-150"
            data-testid={SIDE_MENU_ITEM_TITLE_TEST_ID}
          >
            {translatedTitle}
          </span>
        </div>

        {/*
         * Badge / Alert / Warning Container. One line tall, so a badge and
         * the indicators sit level with the title's first line.
         */}
        {(props.badge !== undefined ||
          props.showAlert ||
          props.showWarning) && (
          <div className="flex h-5 items-center gap-1.5 ml-2 flex-shrink-0">
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
              group relative flex items-start justify-between
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
            ariaCurrent={subItemCurrent}
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <div className="flex items-start min-w-0 gap-2.5">
              <Icon
                icon={props.subItemIcon || IconProp.MinusSmall}
                className={`
                  mt-0.5 h-4 w-4 flex-shrink-0 transition-colors duration-150
                  ${
                    isSubItemActive
                      ? "text-indigo-600"
                      : "text-gray-400 group-hover:text-gray-600"
                  }
                `}
              />
              <span
                className="min-w-0 break-words"
                data-testid={SIDE_MENU_ITEM_TITLE_TEST_ID}
              >
                {translatedSubItemTitle}
              </span>
            </div>
          </UILink>
        </div>
      )}
    </>
  );
};

export default SideMenuItem;
