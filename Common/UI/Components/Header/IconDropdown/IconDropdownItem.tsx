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
}

const IconDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Link
      className="flex items-center gap-3 py-2.5 px-4 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors duration-150 mx-2 rounded-lg"
      to={props.url}
      openInNewTab={props.openInNewTab}
      onClick={props.onClick}
    >
      <div className="flex-shrink-0 h-5 w-5 text-gray-400">
        {props.icon ? <Icon icon={props.icon} /> : <></>}
      </div>
      <span className="font-medium">{props.title}</span>
    </Link>
  );
};

export default IconDropdown;
