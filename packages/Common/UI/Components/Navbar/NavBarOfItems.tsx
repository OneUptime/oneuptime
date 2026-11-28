/*
 * Type-only on purpose: NavBar imports this bar, and a page that draws this
 * bar alone must not load NavBar with it.
 */
import type { NavItem } from "./NavBar";
import NavBarItem from "./NavBarItem";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  rightElement?: NavItem | undefined;
  className?: string | undefined;
  children: ReactElement | Array<ReactElement>;
}

/*
 * A navigation bar of the items it is handed, and nothing more: the bar a
 * status page draws its pages in. NavBar draws this bar when it is handed
 * children, and its own items, the products menu, the phone's menu and
 * Cmd/Ctrl+K otherwise. A page whose bar is only its own items imports this
 * one, without the products menu's code it never opens - a status page did,
 * some 10 KiB gzipped of its first load
 * (packages/Common/Scripts/first-load-budgets.js).
 */
const NavBarOfItems: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  // The bar's landmark name, as NavBar names its own (#7963).
  const mainMenuName: string = translateString("Main menu") || "Main menu";
  const className: string =
    props.className || "flex text-center lg:space-x-8 lg:py-2 bg-white ";

  return (
    <nav
      className={props.rightElement ? `flex justify-between` : ""}
      aria-label={mainMenuName}
    >
      <div data-testid="nav-children" className={className}>
        {props.children}
      </div>
      {props.rightElement && (
        <div className={className}>
          <NavBarItem
            title={props.rightElement.title}
            isTitleTranslated={props.rightElement.isTitleTranslated}
            icon={props.rightElement.icon}
            route={props.rightElement.route}
            activeRoute={props.rightElement.activeRoute}
            exact={props.rightElement.exact ?? false}
          />
        </div>
      )}
    </nav>
  );
};

export default NavBarOfItems;
