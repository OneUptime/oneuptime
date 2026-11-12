import ProjectPickerFilterBox from "./ProjectPickerFilterBox";
import { ProjectPickerMenuPlacement } from "./ProjectPickerMenuPlacement";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  onFilter: (value: string) => void;
  /*
   * 20rem wide when the picker is narrower, and kept inside the window
   * (getProjectPickerMenuPlacement); as wide as the picker without it.
   */
  placement?: ProjectPickerMenuPlacement | null | undefined;
}

const ProjectPickerMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const placementStyle: CSSProperties | undefined = props.placement
    ? {
        width: `${props.placement.widthInPx}px`,
        [props.placement.side]: `${props.placement.offsetInPx}px`,
      }
    : undefined;

  return (
    <ul
      className="absolute z-10 mt-2 max-h-72 w-full overflow-auto rounded-xl bg-white py-2 text-base shadow-lg ring-1 ring-gray-200 focus:outline-none sm:text-sm"
      style={placementStyle}
      data-testid="project-picker-menu"
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
