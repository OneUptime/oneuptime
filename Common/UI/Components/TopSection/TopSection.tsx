import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  header: ReactElement | undefined;
  navbar: ReactElement | undefined;
  className?: string | undefined;
  hideHeader?: boolean | undefined;
}

const TopSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <header
      /*
       * The hook class is unconditional: the dashboard accent tints this
       * element, and consumers that pass their own className must not opt
       * themselves out of it by accident.
       */
      className={`oneuptime-top-section ${props.className || "bg-white shadow"}`}
    >
      <div className="w-full px-2 sm:px-4 lg:divide-y lg:divide-gray-200 lg:px-8">
        {!props.hideHeader && props.header}
        {props.navbar}
      </div>
    </header>
  );
};

export default TopSection;
