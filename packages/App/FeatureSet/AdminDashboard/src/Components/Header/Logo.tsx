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
    <div className="relative z-10 flex px-2 lg:px-0">
      <div className="flex flex-shrink-0 items-center">
        {/*
         * The installation's own logo when it has one (ProductBranding), held
         * to the same height as OneUptime's wordmark; its name, as tall, when
         * it goes by a name of its own and has no logo.
         */}
        <ProductLogo
          className="block h-8 w-auto max-w-[12rem] object-contain"
          nameClassName="block max-w-[12rem] truncate text-lg font-semibold leading-8 tracking-tight text-gray-900"
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
