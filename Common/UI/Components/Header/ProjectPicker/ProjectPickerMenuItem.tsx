import Navigation from "../../../Utils/Navigation";
import Icon from "../../Icon/Icon";
import Route from "../../../../Types/API/Route";
import IconProp from "../../../../Types/Icon/IconProp";
import Project from "../../../../Models/DatabaseModels/Project";
import ProjectColorUtil from "../../../Utils/ProjectColor";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  icon: IconProp;
  onProjectSelected: (project: Project) => void;
  project: Project;
  /*
   * Set when at least one project in the list has a colour. Every row then
   * reserves the same slot so the names stay aligned, whether or not this
   * particular project has one. When no project has a colour the slot is not
   * rendered at all, so lists that never use the feature look untouched.
   */
  showColorSlot?: boolean | undefined;
}

const ProjectPickerMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const title: string = props.project.name!;
  /*
   * A project without a colour of its own is shown in the instance default,
   * which is exactly what marks the page when that project is selected. Doing
   * otherwise would leave the row blank while the picker button above it was
   * showing a colour.
   */
  const projectColor: string | null =
    ProjectColorUtil.normalize(props.project.color?.toString()) ||
    ProjectColorUtil.getDefaultProjectColor();
  const route: Route = new Route("/dashboard/" + props.project.id?.toString());

  return (
    <li
      className="text-gray-700 relative select-none py-2.5 px-3 mx-2 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors duration-150"
      id="listbox-option-0"
      role="option"
      onClick={() => {
        props.onProjectSelected(props.project);
        Navigation.navigate(route);
      }}
    >
      <div className="flex items-center gap-3">
        {props.showColorSlot ? (
          <span
            className="oneuptime-project-color-dot"
            aria-hidden="true"
            style={projectColor ? { backgroundColor: projectColor } : undefined}
          />
        ) : (
          <></>
        )}
        <Icon
          icon={props.icon}
          className="h-5 w-5 flex-shrink-0 text-gray-400"
        />
        <span className="text-sm font-medium text-gray-700 truncate">
          {title}
        </span>
      </div>
    </li>
  );
};

export default ProjectPickerMenuItem;
