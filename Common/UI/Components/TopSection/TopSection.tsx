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
    <header className={props.className || "bg-white shadow"}>
      <div className="w-full px-2 sm:px-4 lg:divide-y lg:divide-gray-200 lg:px-8">
        {!props.hideHeader && (
          <div className="flex items-center justify-between">
            {props.header}
          </div>
        )}
        <div className="w-full">
          {props.navbar}
        </div>
      </div>
    </header>
  );
};

export default TopSection;
