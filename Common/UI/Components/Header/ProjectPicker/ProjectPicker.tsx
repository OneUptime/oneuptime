import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import Icon from "../../Icon/Icon";
import CreateNewProjectButton from "./CreateNewProjectButton";
import ProjectPickerMenu from "./ProjectPickerMenu";
import ProjectPickerMenuItem from "./ProjectPickerMenuItem";
import IconProp from "../../../../Types/Icon/IconProp";
import Project from "../../../../Models/DatabaseModels/Project";
import ProjectColorUtil from "../../../Utils/ProjectColor";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  projects: Array<Project>;
  selectedProjectIcon: IconProp;
  selectedProjectName: string;
  onCreateProjectButtonClicked: () => void;
  onProjectSelected: (project: Project) => void;
  hideCreateProjectButton?: boolean | undefined;
}

const ProjectPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

  const [filterValue, setFilterValue] = useState<string>("");

  /*
   * Reserve the colour slot on every row as soon as one project uses it,
   * so the names stay on a single left edge instead of stepping in and out.
   */
  const showColorSlot: boolean =
    Boolean(ProjectColorUtil.getDefaultProjectColor()) ||
    props.projects.some((project: Project) => {
      return Boolean(ProjectColorUtil.normalize(project.color?.toString()));
    });

  useEffect(() => {
    setDropdownVisible(isComponentVisible);
    setFilterValue("");
  }, [isComponentVisible]);

  return (
    <div className="w-64">
      <div className="relative w-full">
        <button
          onClick={() => {
            setIsComponentVisible(!isDropdownVisible);
          }}
          type="button"
          className="relative w-full cursor-pointer rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-3 pr-10 text-left hover:bg-gray-100 hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all duration-150 sm:text-sm"
          aria-haspopup="listbox"
          aria-expanded="true"
          aria-labelledby="listbox-label"
        >
          <span className="flex items-center">
            {/*
             * Carries the resolved project colour when one is configured, and
             * is hidden entirely when none is. Rendered here rather than as a
             * ::before on the button so it sits inside this flex row.
             */}
            <span
              className="oneuptime-project-color-dot oneuptime-project-color-dot--current"
              aria-hidden="true"
            />
            <Icon
              icon={props.selectedProjectIcon}
              className="h-5 w-5 flex-shrink-0 text-gray-500"
            />

            <span className="ml-2.5 block truncate font-medium text-gray-700">
              {props.selectedProjectName}
            </span>
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 ml-3 flex items-center pr-2">
            <Icon
              icon={IconProp.UpDownArrow}
              className="h-4 w-4 text-gray-400"
            />
          </span>
        </button>
        <div ref={ref}>
          {isComponentVisible && (
            <ProjectPickerMenu
              onFilter={(value: string) => {
                setFilterValue(value.toLowerCase().trim());
              }}
            >
              <>
                {props.projects && props.projects.length > 0 ? (
                  props.projects
                    .filter((project: Project) => {
                      if (!filterValue) {
                        return true;
                      }
                      return (
                        project.name &&
                        project.name.toLowerCase().startsWith(filterValue)
                      );
                    })
                    .map((project: Project, i: number) => {
                      return (
                        <ProjectPickerMenuItem
                          key={i}
                          project={project}
                          onProjectSelected={(project: Project) => {
                            setIsComponentVisible(false);
                            props.onProjectSelected(project);
                          }}
                          icon={IconProp.Folder}
                          showColorSlot={showColorSlot}
                        />
                      );
                    })
                ) : (
                  <></>
                )}
              </>
              {!props.hideCreateProjectButton ? (
                <CreateNewProjectButton
                  onCreateButtonClicked={() => {
                    setIsComponentVisible(false);
                    props.onCreateProjectButtonClicked();
                  }}
                />
              ) : (
                <></>
              )}
            </ProjectPickerMenu>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectPicker;
