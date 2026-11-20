import Icon from "../../Icon/Icon";
import Link from "../../Link/Link";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import IconProp from "../../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  url?: URL | Route;
  icon?: IconProp;
  title: string;
  openInNewTab?: boolean;
  onClick?: (() => void) | undefined;
  /*
   * Optional trailing content, pinned to the right edge of the row. Meant for
   * a keycap hint on an item that also has a keyboard shortcut, so the menu
   * teaches the shortcut instead of only competing with it.
   */
  rightElement?: ReactElement | undefined;
}

/*
 * A row of a header menu: a menu item the menu's arrow keys reach (#7237),
 * a link to a page or an action. Reached with the keys it is lit as under
 * the pointer, with a ring, so where the focus is shows plainly.
 */
export const ICON_DROPDOWN_ITEM_CLASS_NAME: string =
  "flex items-center gap-3 py-2.5 px-4 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors duration-150 mx-2 rounded-lg focus:outline-none focus-visible:bg-gray-50 focus-visible:text-gray-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

const IconDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Link
      className={ICON_DROPDOWN_ITEM_CLASS_NAME}
      to={props.url}
      openInNewTab={props.openInNewTab}
      onClick={props.onClick}
      isMenuItem={true}
    >
      <div className="flex-shrink-0 h-5 w-5 text-gray-400">
        {props.icon ? <Icon icon={props.icon} /> : <></>}
      </div>
      <span className="min-w-0 flex-1 truncate font-medium">{props.title}</span>
      {props.rightElement && (
        <span className="flex shrink-0 items-center">{props.rightElement}</span>
      )}
    </Link>
  );
};

export default IconDropdown;
