// Tailwind
import Route from "Common/Types/API/Route";
import Image from "Common/UI/Components/Image/Image";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClick: () => void;
}

const Logo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="relative z-10 flex items-center pr-4 mr-4 border-r border-gray-200">
      <div className="flex flex-shrink-0 items-center">
        <Image
          className="block h-8 w-auto cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => {
            if (props.onClick) {
              props.onClick();
            }
          }}
          imageUrl={Route.fromString(`${OneUptimeLogo}`)}
          alt={"OneUptime"}
        />
      </div>
    </div>
  );
};

export default Logo;
