import React, { FunctionComponent, ReactElement, useState } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
}

const SideMenu: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  let children: Array<ReactElement> = [];
  if (!Array.isArray(props.children)) {
    children = [props.children];
  } else {
    children = props.children;
  }

  return (
    <>
      <button
        type="button"
        className="md:hidden fixed top-4 left-4 z-50 bg-gray-200 p-2 rounded-md text-gray-700 hover:text-gray-900"
        onClick={toggleMobileMenu}
        aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
      >
        <Icon
          icon={isMobileMenuOpen ? IconProp.Close : IconProp.List}
          className="h-6 w-6"
        />
      </button>
      <aside
        className={`fixed top-0 left-0 h-screen w-3/4 bg-white z-40 transition-transform duration-300 ease-in-out py-6 px-2 sm:px-6 mb-0
                  ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
                  md:relative md:block md:translate-x-0 md:h-auto md:w-auto md:z-auto md:col-span-3 md:py-0 md:px-0 md:mb-10
                  lg:col-span-2`}
      >
        <nav className="space-y-3 h-full overflow-y-auto md:h-auto">
          {children.map((child: ReactElement) => {
            return child;
          })}
        </nav>
      </aside>
    </>
  );
};

export default SideMenu;
