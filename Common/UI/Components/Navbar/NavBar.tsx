import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  className?: string | undefined;
  rightElement?: ReactElement | undefined;
}

const Navbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Helper to flatten children array
  const getChildrenArray = () => {
    if (Array.isArray(props.children)) return props.children;
    if (props.children) return [props.children];
    return [];
  };

  // Find the active child (NavBarItem)
  const activeChild = getChildrenArray().find((child: any) => {
    // Try to detect active by prop or className
    return (
      child?.props?.className?.includes("bg-gray-100") ||
      child?.props?.isActive // if NavBarItem exposes isActive
    );
  }) || getChildrenArray()[0]; // fallback to first

  return (
    <nav className={props.rightElement ? `flex justify-between` : ""}>
      {/* Desktop Navbar */}
      <div
        data-testid="nav-children"
        className={
          props.className ||
          "hidden lg:flex text-center lg:space-x-8 lg:py-2 bg-white w-full"
        }
      >
        {props.children}
        {props.rightElement && (
          <div className="flex-1 flex justify-end">{props.rightElement}</div>
        )}
      </div>

      {/* Mobile Navbar */}
      <div className="flex flex-col w-full lg:hidden bg-white">
        <div className="flex items-center justify-between p-2 border-b">
          <div className="flex-1">{activeChild}</div>
          <button
            className="p-2 focus:outline-none"
            aria-label="Open menu"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {/* Hamburger icon */}
            <svg
              className="h-6 w-6 text-gray-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
        {mobileMenuOpen && (
          <div className="flex flex-col border-b bg-white z-50 shadow-md animate-fade-in">
            {getChildrenArray().map((child, idx) => (
              <div
                key={idx}
                className="border-t last:border-b"
                onClick={() => setMobileMenuOpen(false)}
              >
                {/* Clone child to add mobile prop if needed */}
                {React.cloneElement(child, { isRenderedOnMobile: true })}
              </div>
            ))}
            {props.rightElement && (
              <div className="border-t p-2">{props.rightElement}</div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
