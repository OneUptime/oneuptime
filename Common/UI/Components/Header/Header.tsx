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
          props.className || "relative flex h-16 justify-between items-center bg-white px-4 sm:px-6 lg:px-8"
        }
      >
        <div className="flex items-center">
          {props.leftComponents}
        </div>

        {props.centerComponents && (
          <div className="hidden sm:flex flex-1 items-center justify-center px-2">
            {props.centerComponents}
          </div>
        )}

        <div className="flex items-center space-x-4">
          {props.rightComponents}
        </div>
      </div>
    </React.Fragment>
  );
};

export default Header;
