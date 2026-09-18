import ProjectPickerFilterBox from "./ProjectPickerFilterBox";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  onFilter: (value: string) => void;
}

const ProjectPickerMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ul
      className="absolute z-10 mt-2 max-h-72 w-full overflow-auto rounded-xl bg-white py-2 text-base shadow-lg ring-1 ring-gray-200 focus:outline-none sm:text-sm"
      role="listbox"
      aria-labelledby="listbox-label"
      aria-activedescendant="listbox-option-3"
    >
      <ProjectPickerFilterBox
        key={2}
        onChange={(value: string) => {
          props.onFilter(value);
        }}
      />
      {props.children}
    </ul>
  );
};

export default ProjectPickerMenu;
