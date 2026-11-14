import ProjectPickerFilterBox from "./ProjectPickerFilterBox";
import { ProjectPickerMenuPlacement } from "./ProjectPickerMenuPlacement";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";

/*
 * The list under the search box scrolls past six and a half rows (16rem of
 * 40px rows): the half row at its foot says there are more, where a list
 * cut on a row's edge reads as the whole list.
 */
export const PROJECT_PICKER_LIST_CLASS_NAME: string =
  "max-h-64 overflow-auto pb-2";

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
    </div>
  );
};

export default ProjectPickerMenu;
