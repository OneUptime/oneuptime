import ProjectPickerFilterBox from "./ProjectPickerFilterBox";
import { ProjectPickerMenuPlacement } from "./ProjectPickerMenuPlacement";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";

/*
 * The list under the search box scrolls past six and a half rows (16rem of
 * 40px rows): the half row at its foot says there are more, where a list
 * cut on a row's edge reads as the whole list.
 */
export const PROJECT_PICKER_LIST_CLASS_NAME: string =
  "max-h-64 overflow-auto pb-2";

/*
 * A search that found no project, said in the rows' place: lined up with
 * the rows' own start (their mx-2 and px-3), in a gray that reads on white
 * (gray-500, 4.8:1) and that the dark theme remaps (Theme.css), and a long
 * search wraps rather than running out of the list.
 */
export const PROJECT_PICKER_NO_MATCHES_CLASS_NAME: string =
  "px-5 pb-4 pt-1 text-sm text-gray-500 break-words";

// What the list says its search found: nothing, or how many projects.
export const PROJECT_PICKER_NO_MATCHES_TEMPLATE: string = translationKey(
  "No matches for “{{search}}”",
);

export const PROJECT_PICKER_FOUND_COUNT: PluralTemplate = {
  one: "{{count}} project",
  other: "{{count}} projects",
};

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  onFilter: (value: string) => void;
  /*
   * 20rem wide when the picker is narrower, and kept inside the window
   * (getProjectPickerMenuPlacement); as wide as the picker without it.
   */
  placement?: ProjectPickerMenuPlacement | null | undefined;
  // The ids that tie the search box, its label and the list together.
  searchInputId: string;
  listboxId: string;
  // The row the arrow keys are on (aria-activedescendant).
  activeOptionId?: string | undefined;
  onSearchKeyDown?:
    | ((event: React.KeyboardEvent<HTMLInputElement>) => void)
    | undefined;
  // The list was opened from the keyboard: the search box takes the focus.
  focusSearch?: boolean | undefined;
  onSearchFocusChange?: ((isFocused: boolean) => void) | undefined;
  /*
   * What is typed in the search box, and how many projects it lists: a
   * search that lists none says so where the rows were, and a screen reader
   * hears what each search found as it changes.
   */
  searchText?: string | undefined;
  listedProjectCount?: number | undefined;
}

/*
 * The project picker's list (#7487): a search box, then the list of
 * projects and Create New Project. The list is a listbox of those rows and
 * nothing else, named "Projects" in the reader's language; the search box
 * sits above it, outside it, as the list's combobox. Until #7487 the box was
 * drawn inside the listbox, the listbox was named by an id no element had
 * (listbox-label), it named a fixed listbox-option-3 as the active row, and
 * every row shared the one id listbox-option-0.
 *
 * The box stays put while a long list scrolls under it.
 */
const ProjectPickerMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const placementStyle: CSSProperties | undefined = props.placement
    ? {
        width: `${props.placement.widthInPx}px`,
        [props.placement.side]: `${props.placement.offsetInPx}px`,
      }
    : undefined;

  const search: string = (props.searchText || "").trim();
  const listedProjectCount: number = props.listedProjectCount || 0;
  const foundNothing: boolean = search.length > 0 && listedProjectCount === 0;

  const noMatches: string = translator.translateTemplate(
    PROJECT_PICKER_NO_MATCHES_TEMPLATE,
    { search: search },
  );

  /*
   * What a screen reader hears as a search changes the list: how many
   * projects it found, or that it found none. Nothing while the box is
   * empty: the whole list is what was opened.
   */
  let searchStatus: string = "";

  if (foundNothing) {
    searchStatus = noMatches;
  } else if (search) {
    searchStatus = translator.translatePlural(
      PROJECT_PICKER_FOUND_COUNT,
      listedProjectCount,
    );
  }

  return (
    <div
      className="absolute z-10 mt-2 w-full rounded-xl bg-white pt-2 text-base shadow-lg ring-1 ring-gray-200 focus:outline-none sm:text-sm"
      style={placementStyle}
      data-testid="project-picker-menu"
    >
      <ProjectPickerFilterBox
        inputId={props.searchInputId}
        listboxId={props.listboxId}
        activeOptionId={props.activeOptionId}
        onKeyDown={props.onSearchKeyDown}
        autoFocus={props.focusSearch}
        onFocus={() => {
          props.onSearchFocusChange?.(true);
        }}
        onBlur={() => {
          props.onSearchFocusChange?.(false);
        }}
        onChange={(value: string) => {
          props.onFilter(value);
        }}
      />
      <ul
        id={props.listboxId}
        role="listbox"
        aria-label={translator.translateText("Projects")}
        className={PROJECT_PICKER_LIST_CLASS_NAME}
        data-testid="project-picker-list"
      >
        {props.children}
      </ul>
      {/*
       * Outside the listbox, which holds rows and nothing else; the empty
       * listbox stays, as the search box's aria-controls names it.
       */}
      {foundNothing && (
        <p
          className={PROJECT_PICKER_NO_MATCHES_CLASS_NAME}
          data-testid="project-picker-no-matches"
        >
          {noMatches}
        </p>
      )}
      <p
        className="sr-only"
        aria-live="polite"
        data-testid="project-picker-search-status"
      >
        {searchStatus}
      </p>
    </div>
  );
};

export default ProjectPickerMenu;
