// Tailwind
import Image from "Common/UI/Components/Image/Image";
import { getProductLogoSource } from "Common/UI/Components/ProductLogo/ProductLogo";
import { getProductName } from "Common/UI/Utils/ProductBranding";
import { Theme, useTheme } from "Common/UI/Utils/Theme";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClick: () => void;
}

const Logo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const theme: Theme = useTheme();

  return (
    /*
     * The wordmark is a 5:1 letterbox, so at h-8 it is 160px wide — nearly
     * half a phone header, and the profile and bell buttons beside it have
     * nowhere to go. Shrink the mark and its gutter below sm.
     *
     * The installation's own logo when it has one (ProductBranding), held to
     * the same height and to a width that leaves the header its buttons.
     */
    <div className="relative z-10 flex items-center border-r border-gray-200 pr-2 mr-2 -ml-2 sm:pr-4 sm:mr-4 sm:-ml-5">
      <div className="flex flex-shrink-0 items-center">
        <Image
          className="oneuptime-dashboard-logo block h-6 w-auto max-w-[8rem] object-contain cursor-pointer hover:opacity-80 transition-opacity sm:h-8 sm:max-w-[12rem]"
          onClick={() => {
            if (props.onClick) {
              props.onClick();
            }
          }}
          imageUrl={getProductLogoSource(theme)}
          alt={getProductName()}
        />
      </div>
    </div>
  );
};

export default Logo;
