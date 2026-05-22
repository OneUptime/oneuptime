import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export interface ComponentProps {
  facetPanel: ReactElement;
  children: ReactNode;
}

const ResourceFiltersLayout: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-72">{props.facetPanel}</aside>
      <div className="min-w-0 flex-1">{props.children}</div>
    </div>
  );
};

export default ResourceFiltersLayout;
