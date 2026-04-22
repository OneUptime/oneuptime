import React, { ReactElement } from "react";

export interface ComponentProps {
  text: string | ReactElement;
}

type FilterViewerItemComponentFunction = (
  props: ComponentProps,
) => ReactElement;

const FilterViewerItem: FilterViewerItemComponentFunction = (
  props: ComponentProps,
): ReactElement => {
  return <span className="text-gray-800 leading-5">{props.text}</span>;
};

export default FilterViewerItem;
