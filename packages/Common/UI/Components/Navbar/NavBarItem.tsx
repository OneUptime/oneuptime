// Tailwind
import Navigation from "../../Utils/Navigation";
import useTranslateValue from "../../Utils/Translation";
import { withProductText } from "../../Utils/ProductText";
import Icon, { ThickProp } from "../Icon/Icon";
import Link from "../Link/Link";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export interface ComponentProps {
  title: string;
  icon?: undefined | IconProp;
  route?: undefined | Route;
  activeRoute?: undefined | Route;
  exact?: boolean;
  children?: undefined | ReactElement | Array<ReactElement>;
  isRenderedOnMobile?: boolean;
  onMouseOver?: (() => void) | undefined;
  onClick?: (() => void) | undefined;
  onMouseLeave?: (() => void) | undefined;
  id?: string | undefined;
  /*
   * Whether it is the page the user is on, when the caller knows better
   * than one route can say: a pinned product lights on every route the
   * products menu lights it on (isMoreMenuItemActive).
   */
  isActive?: boolean | undefined;
  /*
   * Classes for the label: a pinned product's name is read only by a screen
   * reader on a narrow bar (max-xl:sr-only), where its icon alone is drawn.
   */
  labelClassName?: string | undefined;
  // Classes for the icon, in place of the gap it keeps from its label.
  iconClassName?: string | undefined;
  // A hover tip, in the caller's English: the name of an icon-only item.
  tooltip?: string | undefined;
  // Drawn after the label, inside the link: a quiet mark such as "Not set up".
  trailing?: ReactNode | undefined;
  dataTestId?: string | undefined;
}

const NavBarItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string = translateString(props.title) ?? props.title;
  const activeRoute: Route | undefined = props.activeRoute || props.route;
  const isActive: boolean =
    props.isActive !== undefined
      ? props.isActive
      : Boolean(
          activeRoute &&
            (props.exact
              ? Navigation.isOnThisPage(activeRoute)
              : Navigation.isStartWith(activeRoute)),
        );

  let classNames: string =
    "text-gray-500 hover:bg-gray-50 hover:text-gray-900 rounded-md py-2 px-3 inline-flex items-center text-sm font-medium";

  if (isActive) {
    classNames =
      "bg-gray-100 text-gray-900 rounded-md py-2 px-3 inline-flex items-center text-sm font-medium";
  }

  if (props.isRenderedOnMobile) {
    classNames =
      "text-gray-900 hover:bg-gray-50 hover:text-gray-900 inline-flex items-center rounded-md py-2 px-3 text-base font-medium";
    if (isActive) {
      classNames =
        "bg-gray-100 text-gray-900 inline-flex items-center rounded-md py-2 px-3 text-base font-medium";
    }
  }

  return (
    <>
      <Link
        id={props.id}
        className={classNames}
        isCurrentPage={isActive}
        to={props.route ? props.route : null}
        onMouseOver={props.onMouseOver}
        onClick={props.onClick}
        onMouseLeave={props.onMouseLeave}
        title={props.tooltip}
        dataTestId={props.dataTestId}
      >
        {props.icon ? (
          /*
           * 6px from its label, as the product button beside it keeps, at
           * the label's side in either direction (mr- is the end of the
           * line, TailwindReadingDirection.js): letters that fill their
           * box, as Persian ones do, touched a narrower gap.
           */
          <Icon
            icon={props.icon}
            className={props.iconClassName || "mr-1.5 h-4 w-4"}
            thick={ThickProp.Thick}
          />
        ) : (
          <></>
        )}
        <span className={withProductText(props.labelClassName)}>
          {translatedTitle}
        </span>
        {props.trailing}
        {props.children ? <div className="arrow-down"></div> : <></>}
      </Link>
      {props.children}
    </>
  );
};

export default NavBarItem;
