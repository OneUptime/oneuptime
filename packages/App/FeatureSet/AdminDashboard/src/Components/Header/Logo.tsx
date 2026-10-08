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
    <div className="relative z-10 flex px-2 lg:px-0">
      <div className="flex flex-shrink-0 items-center">
        {/*
         * The installation's own logo when it has one (ProductBranding), held
         * to the same height as OneUptime's wordmark.
         */}
        <Image
          className="block h-8 w-auto max-w-[12rem] object-contain"
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
