import React, { FunctionComponent, ReactElement, useState } from "react";
import Icon from "../Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  className?: string | undefined;
  rightElement?: ReactElement | undefined;
}

const Navbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  const defaultClassName: string =
    "text-center lg:space-x-8 lg:py-2 bg-white";
  const navChildrenClassName: string = props.className || defaultClassName;

  // Clone children to pass isRenderedOnMobile prop
  const childrenWithMobileProp = (isMobile: boolean): ReactElement[] => {
    return React.Children.map(props.children, (child) => {
      if (React.isValidElement(child)) {
        return React.cloneElement(child as ReactElement<any>, {
          isRenderedOnMobile: isMobile,
        });
      }
      return child;
    });
  };
  
  const rightElementWithMobileProp = (isMobile: boolean): ReactElement | undefined => {
    if (props.rightElement && React.isValidElement(props.rightElement)) {
      return React.cloneElement(props.rightElement as ReactElement<any>, { isRenderedOnMobile: isMobile });
    }
    return props.rightElement;
  }

  return (
    <nav className={`bg-white ${props.rightElement ? "lg:flex lg:justify-between" : ""}`}>
      {/* Hamburger Menu Button */}
      <div className="flex items-center justify-between px-4 py-3 lg:hidden">
        {/* Placeholder for left-aligned items on mobile if any, e.g. a logo if props.children is empty or also hidden */}
        <div>
          {/* If there's a logo in props.children that should be visible on mobile, it needs specific handling.
              Assuming for now that props.children are primarily nav items.
              A common pattern is to have a dedicated logo prop or first child treatment.
          */}
        </div>
        <button
          onClick={() => {
            setIsMobileMenuOpen(!isMobileMenuOpen);
          }}
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
          aria-expanded="false"
        >
          <span className="sr-only">Open main menu</span>
          {isMobileMenuOpen ? (
            <Icon icon={IconProp.Close} className="block h-6 w-6" />
          ) : (
            <Icon icon={IconProp.HamburgerMenu} className="block h-6 w-6" />
          )}
        </button>
      </div>

      {/* Desktop Menu */}
      <div className={`hidden lg:flex ${props.rightElement ? "w-auto" : "w-full"}`}>
        <div
          data-testid="nav-children-desktop"
          className={`${navChildrenClassName} hidden lg:flex ${props.rightElement ? "" : "w-full justify-center"}`}
        >
          {childrenWithMobileProp(false)}
        </div>
        {props.rightElement && (
          <div className={`${navChildrenClassName} hidden lg:flex`}>
            {rightElementWithMobileProp(false)}
          </div>
        )}
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden" id="mobile-menu">
          <div className="space-y-1 px-2 pt-2 pb-3 sm:px-3">
            {childrenWithMobileProp(true)}
          </div>
          {props.rightElement && (
            <div className="border-t border-gray-200 pt-4 pb-3">
              <div className="space-y-1 px-2">
                {rightElementWithMobileProp(true)}
              </div>
            </div>
          )}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
