import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
}

const Section: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="section-label mt-2 flex font-medium text-gray-500">
      <div className="section-title text-sm sm:text-base">{props.title}</div>
      <div className="section-border flex-grow border-t border-gray-300 ml-2 sm:ml-3 mt-2 sm:mt-3"></div>
    </div>
  );
};

export default Section;
