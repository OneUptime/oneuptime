// Tailwind
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClick: () => void;
}

const Logo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    /*
     * The wordmark is a 5:1 letterbox, so at h-8 it is 160px wide — nearly
     * half a phone header, and the profile and bell buttons beside it have
     * nowhere to go. Shrink the mark and its gutter below sm.
     *
     * The installation's own logo when it has one (ProductBranding), held to
     * the same height and to a width that leaves the header its buttons; its
     * name, as tall as the logo, when it goes by a name of its own and has no
     * logo.
     */
    <div className="relative z-10 flex items-center border-r border-gray-200 pr-2 mr-2 -ml-2 sm:pr-4 sm:mr-4 sm:-ml-5">
      <div className="flex flex-shrink-0 items-center">
        <ProductLogo
          className="oneuptime-dashboard-logo block h-6 w-auto max-w-[8rem] object-contain cursor-pointer hover:opacity-80 transition-opacity sm:h-8 sm:max-w-[12rem]"
          nameClassName="block max-w-[8rem] truncate text-base font-semibold leading-6 tracking-tight text-gray-900 cursor-pointer hover:opacity-80 transition-opacity sm:max-w-[12rem] sm:text-lg sm:leading-8"
          onClick={() => {
            if (props.onClick) {
              props.onClick();
            }
          }}
        />
      </div>
    </div>
  );
};

export default Logo;
