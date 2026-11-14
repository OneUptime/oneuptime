import LeaveGuard from "../../../Utils/LeaveGuard";
import Navigation from "../../../Utils/Navigation";
import Icon from "../../Icon/Icon";
import Route from "../../../../Types/API/Route";
import IconProp from "../../../../Types/Icon/IconProp";
import Project from "../../../../Models/DatabaseModels/Project";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The row the arrow keys are on, while the search box has the focus: the
 * ground Search's (Ctrl K) row takes under its cursor, so a keyboard user
 * sees it at a glance. A hover's light gray (bg-gray-50) is all but white
 * on white, and a row the keyboard is on must stand out from one the
 * pointer only passes over.
 */
export const PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME: string = "bg-indigo-50";

export interface ComponentProps {
  icon: IconProp;
  onProjectSelected: (project: Project) => void;
  project: Project;
  // The row's own id, unique on the page (aria-activedescendant names it).
  id: string;
  // The arrow keys (or the pointer) are on this row.
  isActive?: boolean | undefined;
  // The row is drawn as the one the keyboard is on.
  showsActive?: boolean | undefined;
  onPointerOver?: (() => void) | undefined;
}

/*
 * Opening a project from the list, by a click or by Enter in the list's
 * search box: another project is another page, and the switch reloads the
 * app in it, so a page holding unsaved work asks first, before anything
 * switches (LeaveGuard). Keep Editing leaves the open project as it was - a
 * project switched with its page kept would save into the wrong one.
 */
export const openProjectFromPicker: (
  project: Project,
  onProjectSelected: (project: Project) => void,
) => void = (
  project: Project,
  onProjectSelected: (project: Project) => void,
): void => {
  const route: Route = new Route("/dashboard/" + project.id?.toString());

  LeaveGuard.whenLeaving(route.toString(), () => {
    onProjectSelected(project);
    Navigation.navigate(route);
  });
};

const ProjectPickerMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const title: string = props.project.name!;

  return (
    <li
      className={`text-gray-700 relative select-none py-2.5 px-3 mx-2 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors duration-150 ${
        props.isActive && props.showsActive
          ? PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME
          : ""
      }`}
      id={props.id}
      role="option"
      aria-selected={Boolean(props.isActive)}
      onMouseMove={() => {
        props.onPointerOver?.();
      }}
      onClick={() => {
        openProjectFromPicker(props.project, props.onProjectSelected);
      }}
    >
      <div className="flex items-center gap-3">
        <Icon
          icon={props.icon}
          className="h-5 w-5 flex-shrink-0 text-gray-400"
        />
        <span className="text-sm font-medium text-gray-700 truncate" dir="auto">
          {title}
        </span>
        {/*
         * A master admin blocked it: still listed, so it is not a project
         * that vanished, and opening it says why it cannot be used.
         */}
        {props.project.isBlocked && (
          <span
            className="ml-auto flex-shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
            data-testid="project-picker-blocked"
          >
            {translator.translateText("Blocked")}
          </span>
        )}
      </div>
    </li>
  );
};

export default ProjectPickerMenuItem;
