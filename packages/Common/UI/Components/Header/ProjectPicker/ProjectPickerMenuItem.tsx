import Navigation from "../../../Utils/Navigation";
import Icon from "../../Icon/Icon";
import Route from "../../../../Types/API/Route";
import IconProp from "../../../../Types/Icon/IconProp";
import Project from "../../../../Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  icon: IconProp;
  onProjectSelected: (project: Project) => void;
  project: Project;
}

const ProjectPickerMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const title: string = props.project.name!;
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
