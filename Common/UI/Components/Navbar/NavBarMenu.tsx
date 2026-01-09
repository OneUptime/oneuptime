import Link from "../Link/Link";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import URL from "../../../Types/API/URL";
import React, { FunctionComponent, ReactElement } from "react";

export interface MenuSection {
  title: string;
  items: Array<ReactElement>;
}

export interface ComponentProps {
  children?: ReactElement | Array<ReactElement>;
  sections?: MenuSection[];
  footer?: {
    title: string;
    description: string;
    link: URL;
  };
}

const NavBarMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // If sections are provided, render categorized menu
  if (props.sections && props.sections.length > 0) {
    return (
      <div className="absolute left-1/2 z-10 mt-8 w-screen max-w-4xl -translate-x-1/2 transform px-2 sm:px-0">
        <div className="overflow-hidden rounded-2xl shadow-xl ring-1 ring-black ring-opacity-5 bg-white">
          {/* Sections */}
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {props.sections.map((section: MenuSection, index: number) => {
                return (
                  <div key={index} className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 px-2.5">
                      {section.title}
                    </h3>
                    <div className="space-y-1">{section.items}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          {props.footer && (
            <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
              <Link
                to={props.footer.link}
                openInNewTab={true}
                className="group flex items-center gap-3 rounded-lg p-2.5 -m-2 transition-colors hover:bg-gray-100"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 ring-1 ring-gray-200 group-hover:bg-gray-200 group-hover:ring-gray-300 transition-all">
                  <Icon
                    icon={IconProp.GitHub}
                    className="h-5 w-5 text-gray-700"
                  />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-gray-900">
                    {props.footer.title}
                  </p>
                  <p className="text-xs text-gray-500">
                    {props.footer.description}
                  </p>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Legacy: render children directly
  let children: Array<ReactElement> = [];
  if (props.children) {
    if (!Array.isArray(props.children)) {
      children = [props.children];
    } else {
      children = props.children;
    }
  }

  // Calculate number of columns based on items count
  const itemCount: number = children.length;
  const columnClass: string =
    itemCount <= 4
      ? "lg:grid-cols-2"
      : itemCount <= 6
        ? "lg:grid-cols-3"
        : "lg:grid-cols-3";
  const maxWidthClass: string =
    itemCount <= 4
      ? "lg:max-w-xl"
      : itemCount <= 6
        ? "lg:max-w-2xl"
        : "lg:max-w-3xl";

  return (
    <div
      className={`absolute left-1/2 z-10 mt-8 w-screen max-w-md -translate-x-1/2 transform px-2 sm:px-0 ${maxWidthClass}`}
    >
      <div className="overflow-hidden rounded-2xl shadow-xl ring-1 ring-black ring-opacity-5 bg-white">
        {/* Menu Items */}
        <div className={`relative grid gap-1 p-4 ${columnClass}`}>
          {children}
        </div>

        {/* Footer */}
        {props.footer && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
            <Link
              to={props.footer.link}
              openInNewTab={true}
              className="group flex items-center gap-3 rounded-lg p-2.5 -m-2 transition-colors hover:bg-gray-100"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 ring-1 ring-gray-200 group-hover:bg-gray-200 group-hover:ring-gray-300 transition-all">
                <Icon
                  icon={IconProp.GitHub}
                  className="h-5 w-5 text-gray-700"
                />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-gray-900">
                  {props.footer.title}
                </p>
                <p className="text-xs text-gray-500">
                  {props.footer.description}
                </p>
              </div>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default NavBarMenu;
