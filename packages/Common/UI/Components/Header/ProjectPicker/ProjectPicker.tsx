import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import Icon from "../../Icon/Icon";
import CreateNewProjectButton from "./CreateNewProjectButton";
import ProjectPickerMenu from "./ProjectPickerMenu";
import ProjectPickerMenuItem, {
  openProjectFromPicker,
} from "./ProjectPickerMenuItem";
import {
  getProjectPickerMenuPlacement,
  ProjectPickerMenuPlacement,
} from "./ProjectPickerMenuPlacement";
import { createProjectSearch, ProjectSearch } from "./ProjectSearch";
import IconProp from "../../../../Types/Icon/IconProp";
import ObjectID from "../../../../Types/ObjectID";
import Project from "../../../../Models/DatabaseModels/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  projects: Array<Project>;
  selectedProjectIcon: IconProp;
  selectedProjectName: string;
  /*
   * The open project, by its id (#8050): its row is marked, and the list
   * opened from the keyboard starts on it. By id, never by name: two
   * projects may share one.
   */
  selectedProjectId?: ObjectID | string | null | undefined;
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

/*
 * The ids of the list's parts, unique on the page (#7487): React's useId
 * for this picker (without its colons), and a project's own id for its row
 * - never one shared id, which every row had (listbox-option-0).
 */
export interface ProjectPickerIds {
  listbox: string;
  search: string;
  createRow: string;
  projectRow: (project: Project, index: number) => string;
}

export const getProjectPickerIds: (reactId: string) => ProjectPickerIds = (
  reactId: string,
): ProjectPickerIds => {
  const base: string = `project-picker-${reactId.split(":").join("")}`;

  return {
    listbox: `${base}-list`,
    search: `${base}-search`,
    createRow: `${base}-create`,
    projectRow: (project: Project, index: number): string => {
      return `${base}-project-${project.id?.toString() || `row-${index}`}`;
    },
  };
};

// One row of the list, as the keyboard moves through it.
interface PickerRow {
  id: string;
  open: () => void;
}

/*
 * Whether a project is the open one: by its id, so the second of two
 * projects called "Test Project" is never marked for the first. A picker
 * told no open project marks none.
 */
export const isOpenProject: (
  project: Project,
  openProjectId: string,
) => boolean = (project: Project, openProjectId: string): boolean => {
  return Boolean(openProjectId) && project.id?.toString() === openProjectId;
};

const ProjectPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

  // What is typed in the list's search box, as typed.
  const [searchText, setSearchText] = useState<string>("");

  const ids: ProjectPickerIds = getProjectPickerIds(useId());

  /*
   * The row the arrow keys are on (aria-activedescendant on the search
   * box), once a key or the pointer has moved it. Until then the list
   * starts on the open project, and a search on its best match: its first
   * row (startRowId, below).
   */
  const [activeRowId, setActiveRowId] = useState<string | undefined>(undefined);

  // The open project's id, read once per draw: each row compares its own.
  const openProjectId: string = props.selectedProjectId?.toString() || "";

  // The list was opened from the keyboard: the search box takes the focus.
  const [openedFromKeyboard, setOpenedFromKeyboard] = useState<boolean>(false);

  /*
   * The keyboard's row is drawn only while the search box has the focus:
   * a list opened with the pointer shows no row picked out before the
   * pointer is on it.
   */
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  useEffect(() => {
    setDropdownVisible(isComponentVisible);
    setSearchText("");
    // Each opening starts on the open project again (startRowId).
    setActiveRowId(undefined);

    if (!isComponentVisible) {
      setOpenedFromKeyboard(false);
      setIsSearchFocused(false);
    }
  }, [isComponentVisible]);

  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  /*
   * The projects the search finds, best match first, matched as Search
   * (Cmd/Ctrl+K) matches a page's name (ProjectSearch). Each name is read
   * once per list, and the search runs again only when what is typed
   * changes, not on every key that moves through the rows.
   */
  const projectSearch: ProjectSearch = useMemo((): ProjectSearch => {
    return createProjectSearch(props.projects || []);
  }, [props.projects]);

  const listedProjects: Array<Project> = useMemo((): Array<Project> => {
    return projectSearch(searchText);
  }, [projectSearch, searchText]);

  /*
   * A search that finds no project says so and offers no Create New Project
   * (Docs/ux/README.md#empty-states-and-suggestions). With that row the only
   * one left, a search for a project spelled another way read as a project
   * that was gone, with a new one as the way out.
   */
  const foundNothing: boolean =
    searchText.trim().length > 0 && listedProjects.length === 0;

  const showsCreateRow: boolean =
    !props.hideCreateProjectButton && !foundNothing;

  const closeList: () => void = (): void => {
    setIsComponentVisible(false);
  };

  const rows: Array<PickerRow> = [
    ...listedProjects.map((project: Project, index: number): PickerRow => {
      return {
        id: ids.projectRow(project, index),
        open: () => {
          openProjectFromPicker(project, (picked: Project) => {
            closeList();
            props.onProjectSelected(picked);
          });
        },
      };
    }),
    ...(showsCreateRow
      ? [
          {
            id: ids.createRow,
            open: () => {
              closeList();
              props.onCreateProjectButtonClicked();
            },
          },
        ]
      : []),
  ];

  /*
   * The open project's row, while it is listed (#8050). With 14 projects,
   * nothing said which one was open, and the keyboard started on the first
   * row wherever the person was.
   */
  const openProjectIndex: number = openProjectId
    ? listedProjects.findIndex((project: Project): boolean => {
        return isOpenProject(project, openProjectId);
      })
    : -1;
  const openProjectRowId: string | undefined =
    openProjectIndex >= 0
      ? ids.projectRow(listedProjects[openProjectIndex]!, openProjectIndex)
      : undefined;

  /*
   * Where the keyboard starts: on the open project while nothing is typed,
   * and on a search's best match, its first row, once something is.
   */
  const startRowId: string | undefined = searchText.trim()
    ? undefined
    : openProjectRowId;

  const activeIndex: number = Math.max(
    0,
    rows.findIndex((row: PickerRow): boolean => {
      return row.id === (activeRowId ?? startRowId);
    }),
  );
  const activeRow: PickerRow | undefined = rows[activeIndex];

  /*
   * The open project in view as the list opens, however it was opened: the
   * list shows six and a half rows, and someone in many projects opened it
   * to find where they are. Once per opening, so the list never jumps back
   * while the person scrolls it.
   */
  useEffect(() => {
    if (!isComponentVisible || !openProjectRowId) {
      return;
    }

    const element: HTMLElement | null =
      document.getElementById(openProjectRowId);

    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [isComponentVisible]);

  // Keep the keyboard's row in view as it moves through a long list.
  useEffect(() => {
    if (!activeRow || !isSearchFocused) {
      return;
    }

    const element: HTMLElement | null = document.getElementById(activeRow.id);

    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeRow?.id, isSearchFocused]);

  /*
   * The keys of the list, read in its search box (a combobox: focus stays
   * there): Down and Up move through the rows, stopping at either end,
   * Home and End are left to the text, Enter opens the row, Escape puts
   * the list away and gives the focus back to the picker, and Tab (or
   * Shift+Tab) moves the focus on as anywhere and puts the list away behind
   * it - a list left open would cover the page the focus went on to.
   */
  const onSearchKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeList();
      buttonRef.current?.focus();
      return;
    }

    if (event.key === "Tab") {
      /*
       * Once the browser has moved the focus: the box taken away before
       * that would leave the focus nowhere.
       */
      window.setTimeout(closeList, 0);
      return;
    }

    if (rows.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveRowId(rows[Math.min(activeIndex + 1, rows.length - 1)]?.id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveRowId(rows[Math.max(activeIndex - 1, 0)]?.id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activeRow?.open();
    }
  };

  // Opens the list from the keyboard, with the focus in its search box.
  const openFromKeyboard: () => void = (): void => {
    setOpenedFromKeyboard(true);
    setIsComponentVisible(true);
  };

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
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
            /*
             * Enter or Space on the picker clicks it with no pointer
             * (detail 0): the list then opens with the focus in its search
             * box, so the arrow keys and typing work at once. A click or a
             * tap leaves the focus where it was - on a phone, a focused box
             * would put the keyboard over the list.
             */
            if (!isDropdownVisible && event.detail === 0) {
              openFromKeyboard();
              return;
            }

            setIsComponentVisible(!isDropdownVisible);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
            // Down or Up on the closed picker opens it, as a list button does.
            if (
              !isDropdownVisible &&
              (event.key === "ArrowDown" || event.key === "ArrowUp")
            ) {
              event.preventDefault();
              openFromKeyboard();
            }
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
              searchInputId={ids.search}
              listboxId={ids.listbox}
              activeOptionId={activeRow?.id}
              onSearchKeyDown={onSearchKeyDown}
              focusSearch={openedFromKeyboard}
              onSearchFocusChange={setIsSearchFocused}
              searchText={searchText}
              listedProjectCount={listedProjects.length}
              onFilter={(value: string) => {
                setSearchText(value);
                /*
                 * A new search starts on its first row, its best match;
                 * a search cleared, on the open project again.
                 */
                setActiveRowId(undefined);
              }}
            >
              <>
                {listedProjects.map((project: Project, i: number) => {
                  const rowId: string = ids.projectRow(project, i);

                  return (
                    <ProjectPickerMenuItem
                      key={rowId}
                      id={rowId}
                      isActive={rowId === activeRow?.id}
                      isOpenProject={isOpenProject(project, openProjectId)}
                      showsActive={isSearchFocused}
                      onPointerOver={() => {
                        setActiveRowId(rowId);
                      }}
                      project={project}
                      searchText={searchText}
                      onProjectSelected={(project: Project) => {
                        closeList();
                        props.onProjectSelected(project);
                      }}
                      icon={IconProp.Folder}
                    />
                  );
                })}
              </>
              {showsCreateRow ? (
                <CreateNewProjectButton
                  id={ids.createRow}
                  isActive={ids.createRow === activeRow?.id}
                  showsActive={isSearchFocused}
                  onPointerOver={() => {
                    setActiveRowId(ids.createRow);
                  }}
                  onCreateButtonClicked={() => {
                    closeList();
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
