import Link from "../Link/Link";
import URL from "Common/Types/API/URL";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  footer?: {
    title: string;
    description: string;
    link: URL;
  };
  isMobileView?: boolean; // Added to control styling, passed from NavBarItem
}

const NavBarMenu: FunctionComponent<ComponentProps> = ( // Renamed component
  props: ComponentProps,
): ReactElement => {
  let childrenElements: Array<ReactElement>;
  if (!Array.isArray(props.children) && props.children) {
    childrenElements = [props.children];
  } else {
    childrenElements = props.children as Array<ReactElement>;
  }

  // Base classes
  let mainContainerClasses: string = "";
  let childrenOuterContainerClasses: string = "overflow-hidden rounded-lg";
  let childrenInnerContainerClasses: string = "relative grid bg-white";
  let footerContainerClasses: string = "bg-gray-50";
  let footerLinkClasses: string = "-m-3 flow-root rounded-md p-3 transition duration-150 ease-in-out hover:bg-gray-100";
  let footerTitleClasses: string = "text-base font-medium text-gray-900";
  let footerDescriptionClasses: string = "mt-1 block text-sm text-gray-500 text-left";


  if (props.isMobileView) {
    // Mobile specific classes: Displayed inline, full width, simplified padding
    mainContainerClasses = "w-full mt-1"; // No absolute positioning, simpler margin for nesting
    childrenOuterContainerClasses = "rounded-md border border-gray-200"; // Simple border for mobile
    childrenInnerContainerClasses += " gap-3 p-4 grid-cols-1"; // Simplified padding, single column
    footerContainerClasses += " p-4 border-t border-gray-200"; // Simplified padding
    footerLinkClasses = "block p-2 hover:bg-gray-100 rounded-md"; // Simpler link styling for mobile
    footerTitleClasses = "text-sm font-medium text-gray-800";
    footerDescriptionClasses = "mt-1 block text-xs text-gray-500";

  } else {
    // Desktop specific classes: Dropdown menu
    mainContainerClasses = "absolute left-1/3 z-10 mt-10 w-screen max-w-md -translate-x-1/2 transform px-2 sm:px-0 lg:max-w-3xl";
    childrenOuterContainerClasses += " shadow-lg ring-1 ring-black ring-opacity-5"; // Desktop shadow
    childrenInnerContainerClasses += " gap-6 px-5 py-6 sm:gap-8 sm:p-8 lg:grid-cols-2";
    footerContainerClasses += " p-5 sm:p-8";
    // footerLinkClasses, footerTitleClasses, footerDescriptionClasses retain their defaults for desktop
  }

  return (
    <div className={mainContainerClasses}>
      <div className={childrenOuterContainerClasses}>
        <div className={childrenInnerContainerClasses}>
          {childrenElements}
        </div>
        {props.footer && (
          <div className={footerContainerClasses}>
            <Link
              to={props.footer.link}
              openInNewTab={true}
              className={footerLinkClasses}
            >
              <span className="flex items-center">
                <span className={footerTitleClasses}>
                  {props.footer.title}
                </span>
              </span>
              <span className={footerDescriptionClasses}>
                {props.footer.description}
              </span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default NavBarMenu; // Renamed export
