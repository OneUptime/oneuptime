// Tailwind
import Navigation from "../../Utils/Navigation";
import useTranslateValue from "../../Utils/Translation";
import Icon, { ThickProp } from "../Icon/Icon";
import Link from "../Link/Link";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

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
}

const NavBarItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string = translateString(props.title) ?? props.title;
  const activeRoute: Route | undefined = props.activeRoute || props.route;
  const isActive: boolean = Boolean(
    activeRoute &&
      (props.exact
        ? Navigation.isOnThisPage(activeRoute)
        : Navigation.isStartWith(activeRoute)),
  );

  let classNames: string =
    "transition-colors duration-150 text-gray-500 hover:bg-gray-50 hover:text-gray-900 rounded-md py-2 px-3 inline-flex items-center text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1";

  if (isActive) {
    classNames =
      "transition-colors duration-150 bg-gray-100 text-gray-900 rounded-md py-2 px-3 inline-flex items-center text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1";
  }

  if (props.isRenderedOnMobile) {
    classNames =
      "transition-colors duration-150 text-gray-900 hover:bg-gray-50 hover:text-gray-900 inline-flex items-center rounded-md py-2 px-3 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1";
    if (isActive) {
      classNames =
        "transition-colors duration-150 bg-gray-100 text-gray-900 inline-flex items-center rounded-md py-2 px-3 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1";
    }
  }

  return (
    <>
      <Link
        id={props.id}
        className={classNames}
        to={props.route ? props.route : null}
        onMouseOver={props.onMouseOver}
        onClick={props.onClick}
        onMouseLeave={props.onMouseLeave}
      >
        {props.icon ? (
          <Icon
            icon={props.icon}
            className="mr-1 h-4 w-4"
            thick={ThickProp.Thick}
          />
        ) : (
          <></>
        )}
        <span>{translatedTitle}</span>
        {props.children ? (
          <Icon
            icon={IconProp.ChevronDown}
            className="ml-1 h-3 w-3 text-gray-400"
          />
        ) : (
          <></>
        )}
      </Link>
      {props.children}
    </>
  );
};

export default NavBarItem;
