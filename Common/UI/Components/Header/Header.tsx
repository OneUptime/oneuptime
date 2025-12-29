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
  return (
    <React.Fragment>
      <div
        className={
          props.className ||
          "relative flex h-16 justify-between bg-white border-b border-gray-200 shadow-sm px-4"
        }
      >
        <div className="relative z-20 flex items-center">
          {props.leftComponents}
        </div>

        {props.centerComponents && (
          <div className="relative z-0 flex flex-1 items-center justify-center px-2 sm:absolute sm:inset-0">
            {props.centerComponents}
          </div>
        )}

        <div className="hidden lg:relative lg:z-10 lg:ml-4 lg:flex lg:items-center lg:gap-2">
          {props.rightComponents}
        </div>
      </div>
    </React.Fragment>
  );
};

export default Header;
