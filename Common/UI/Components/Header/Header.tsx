import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  leftComponents?: undefined | Array<ReactElement> | ReactElement;
  rightComponents?: undefined | Array<ReactElement> | ReactElement;
  centerComponents?: undefined | Array<ReactElement> | ReactElement;
  className?: string | undefined;
}

const Header: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // State for managing mobile menu visibility (optional, for hamburger menu)
  // Optional: State for managing mobile menu visibility if a hamburger menu is implemented by the consumer
  // const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  return (
    <React.Fragment>
      <div
        className={
          props.className ||
          "relative flex flex-col lg:flex-row lg:h-16 items-center justify-between bg-white p-4 lg:px-6" // Adjusted padding
        }
      >
        {/* Left Components Area */}
        {/* On mobile, this area takes full width and space-between can be used if a hamburger is passed as a leftComponent */}
        {/* On desktop, it takes auto width */}
        <div className="relative z-20 flex w-full items-center justify-between lg:w-auto lg:justify-start">
          {props.leftComponents}
          {/* Example of where a consumer might place a hamburger button toggle:
          <div className="lg:hidden">
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>Menu</button>
          </div>
          */}
        </div>

        {/* Center Components Area */}
        {/* On mobile, this stacks below left, takes full width, and centers its content */}
        {/* On desktop, it's absolutely positioned to truly center in the header */}
        {props.centerComponents && (
          <div
            className={`relative z-0 flex flex-1 items-center justify-center w-full mt-4 lg:mt-0 lg:absolute lg:inset-x-0`}
          >
            {props.centerComponents}
          </div>
        )}

        {/* Right Components Area */}
        {/* On mobile, this stacks below center, takes full width, and centers its content */}
        {/* On desktop, it's on the right, with a left margin */}
        {/* The visibility of these components on mobile (e.g. inside a collapsed menu) would be handled by the consumer
            by conditionally rendering `rightComponents` or by classes passed via `props.className` if a hamburger menu is implemented.
            For now, they will be visible and stacked on mobile.
        */}
        <div
          className={`relative z-10 flex flex-col items-center lg:flex-row lg:items-center w-full lg:w-auto lg:ml-4 mt-4 lg:mt-0`}
        >
          {props.rightComponents}
        </div>
      </div>
    </React.Fragment>
  );
};

export default Header;
