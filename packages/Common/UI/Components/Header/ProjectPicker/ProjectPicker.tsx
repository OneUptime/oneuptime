import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import Icon from "../../Icon/Icon";
import CreateNewProjectButton from "./CreateNewProjectButton";
import ProjectPickerMenu from "./ProjectPickerMenu";
import ProjectPickerMenuItem from "./ProjectPickerMenuItem";
import {
  getProjectPickerMenuPlacement,
  ProjectPickerMenuPlacement,
} from "./ProjectPickerMenuPlacement";
import IconProp from "../../../../Types/Icon/IconProp";
import Project from "../../../../Models/DatabaseModels/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
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

/*
 * The picker on a phone (#7236). It is the header's one entry that gives
 * way when the header is tight (Common's Header puts min-w-0 on the left
 * side, and the logo, the bell and the profile button keep their size), so
 * below sm it spends nothing on decoration: no folder icon in front of the
 * name, and only the room its up-and-down arrows need after it. With them, a
 * 390px phone showed the first letter of the project's name and an ellipsis
 * ("A."), and someone with several projects could not tell which one they
 * were in. The name, the one thing the picker is there to say, takes the
 * room; from sm (640px) the picker is as it was.
 */
export const PROJECT_PICKER_WIDTH_CLASS_NAME: string = "w-64 min-w-0";

export const PROJECT_PICKER_BUTTON_CLASS_NAME: string =
  "relative w-full cursor-pointer rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-3 pr-8 text-left hover:bg-gray-100 hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all duration-150 sm:pr-10 sm:text-sm";

/*
 * `max-sm:hidden`, never `hidden sm:block`: a foreign `.hidden` rule
 * (a browser extension, a user stylesheet) would take the icon off every
 * screen (ForeignHiddenRuleGuard).
 */
export const PROJECT_PICKER_ICON_CLASS_NAME: string =
  "h-5 w-5 flex-shrink-0 text-gray-500 max-sm:hidden";

export const PROJECT_PICKER_NAME_CLASS_NAME: string =
  "block min-w-0 font-medium text-gray-700 sm:ml-2.5";

const ProjectPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

  const [filterValue, setFilterValue] = useState<string>("");

  useEffect(() => {
    setDropdownVisible(isComponentVisible);
    setFilterValue("");
  }, [isComponentVisible]);

  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  const [menuPlacement, setMenuPlacement] =
    useState<ProjectPickerMenuPlacement | null>(null);

  /*
   * Where the list opens, read from the picker as it opens (before it is
   * drawn) and again whenever the window is resized while it is open: 20rem
   * wide when the picker is narrower (on a phone, a tablet, a header with
   * every button), inside the window (#7236).
   */
  useLayoutEffect(() => {
    if (!isComponentVisible) {
      return;
    }

    const place: () => void = (): void => {
      const button: HTMLButtonElement | null = buttonRef.current;

      if (!button) {
        return;
      }

      const box: DOMRect = button.getBoundingClientRect();

      setMenuPlacement(
        getProjectPickerMenuPlacement({
          buttonLeft: box.left,
          buttonRight: box.right,
          windowWidth: window.innerWidth,
          isRightToLeft: window.getComputedStyle(button).direction === "rtl",
        }),
      );
    };

    place();
    window.addEventListener("resize", place);

    return () => {
      window.removeEventListener("resize", place);
    };
  }, [isComponentVisible]);

  return (
    /*
     * min-w-0 so the picker is what truncates when the header is tight — its
     * label is already `truncate`, and the alternative is the whole row
     * overflowing the viewport. 16rem at most at every width: it was 12rem
     * below sm, which cut the name short on a large phone with room to
     * spare beside it (#7236); a small one shrinks it all the same.
     */
    <div className={PROJECT_PICKER_WIDTH_CLASS_NAME}>
      <div className="relative w-full">
        <button
          ref={buttonRef}
          onClick={() => {
            setIsComponentVisible(!isDropdownVisible);
          }}
          type="button"
          className={PROJECT_PICKER_BUTTON_CLASS_NAME}
          aria-haspopup="listbox"
          /*
           * Whether the project list is open: it was written as "true", so
           * a screen reader heard the closed picker as open.
           */
          aria-expanded={isComponentVisible}
          aria-labelledby="listbox-label"
        >
          <span className="flex items-center">
            <Icon
              icon={props.selectedProjectIcon}
              className={PROJECT_PICKER_ICON_CLASS_NAME}
            />

            {/*
             * A project's name reads its own way (dir="auto"): cut short on
             * a Persian page, an English name keeps its start in view. The
             * space before it stays on the page's side, outside the name.
             */}
            <span className={PROJECT_PICKER_NAME_CLASS_NAME}>
              <span className="block truncate" dir="auto">
                {props.selectedProjectName}
              </span>
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
              placement={menuPlacement}
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
