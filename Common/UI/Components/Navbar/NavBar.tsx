import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  className?: string | undefined;
  rightElement?: ReactElement | undefined;
}

const Navbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  
  const className: string =
    props.className || "flex text-center lg:space-x-8 lg:py-2 bg-white ";

  return (
    <nav className={props.rightElement ? `flex justify-between` : ""}>
      {/* Mobile menu button */}
      <div className="lg:hidden">
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
          aria-expanded="false"
        >
          <span className="sr-only">Open main menu</span>
          {!isMobileMenuOpen ? (
            <svg
              className="block h-6 w-6"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          ) : (
            <svg
              className="block h-6 w-6"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Desktop menu */}
      <div className="hidden lg:flex lg:items-center lg:space-x-8">
        <div data-testid="nav-children" className={className}>
          {props.children}
        </div>
        {props.rightElement && (
          <div className={className}>{props.rightElement}</div>
        )}
      </div>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white border-t border-gray-200">
            <div className="flex flex-col space-y-1">
              {React.Children.map(props.children, (child, index) => {
                if (React.isValidElement(child)) {
                  return React.cloneElement(child, {
                    key: index,
                    isRenderedOnMobile: true,
                    onClick: () => setIsMobileMenuOpen(false),
                  } as any);
                }
                return child;
              })}
            </div>
            {props.rightElement && (
              <div className="pt-3 border-t border-gray-200">
                {React.isValidElement(props.rightElement) ? 
                  React.cloneElement(props.rightElement, {
                    isRenderedOnMobile: true,
                    onClick: () => setIsMobileMenuOpen(false),
                  } as any) : 
                  props.rightElement
                }
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
