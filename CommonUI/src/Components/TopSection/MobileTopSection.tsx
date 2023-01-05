import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
  leftComponents?: undefined | Array<ReactElement> | ReactElement;
  rightComponents?: undefined | Array<ReactElement> | ReactElement;
  centerComponents?: undefined | Array<ReactElement> | ReactElement;
}

const TopSection: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return ()
}