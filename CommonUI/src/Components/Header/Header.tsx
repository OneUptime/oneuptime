import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
  leftComponents?: undefined | Array<ReactElement> | ReactElement;
  rightComponents?: undefined | Array<ReactElement> | ReactElement;
  centerComponents?: undefined | Array<ReactElement> | ReactElement;
  isRenderedOnMobile?: boolean;
}

const Header: FunctionComponent<ComponentProps> = (
  props: ComponentProps
): ReactElement => {
  return (
    <React.Fragment>
      <div className="relative flex h-16 justify-between">
        <div className="relative z-10 flex px-2 lg:px-0">
          {props.leftComponents}
        </div>

        <div className="relative z-0 flex flex-1 items-center justify-center px-2 sm:absolute sm:inset-0">
          {props.centerComponents}
        </div>


        <div className="hidden lg:relative lg:z-10 lg:ml-4 lg:flex lg:items-center">
          {props.rightComponents}
        </div>
      </div>
    </React.Fragment>
  );
};

export default Header;


