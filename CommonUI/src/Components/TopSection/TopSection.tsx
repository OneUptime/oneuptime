import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
  header: ReactElement | undefined;
  navbar: ReactElement |undefined;
  isRenderedOnMobile: boolean;
}

const TopSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps
): ReactElement => {
  return (<header className="bg-white shadow">
    <div className="mx-auto max-w-7xl px-2 sm:px-4 lg:divide-y lg:divide-gray-200 lg:px-8">
      {props.header}
      {props.navbar}
    </div>
  </header>)
}


export default TopSection;