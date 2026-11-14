import Input from "../../Input/Input";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onChange: (search: string) => void;
  // The box's own id, which its label names (htmlFor).
  inputId: string;
  // The list of projects the box filters, and the row the arrow keys are on.
  listboxId: string;
  activeOptionId?: string | undefined;
  onKeyDown?:
    | ((event: React.KeyboardEvent<HTMLInputElement>) => void)
    | undefined;
  // The list was opened from the keyboard: typing starts here.
  autoFocus?: boolean | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
}

/*
 * The project list's search box (#7487). It is the list's combobox: focus
 * stays in it while the arrow keys move through the projects below
 * (aria-activedescendant names the row they are on) and Enter opens that
 * row. Its label is tied to it (htmlFor), so a screen reader names the box
 * "Search Projects" in the reader's language, not by its placeholder.
 */
const ProjectPickerFilterBox: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="px-2 pb-2 mb-1 border-b border-gray-100">
      <label className="sr-only" htmlFor={props.inputId}>
        {translator.translateText("Search Projects")}
      </label>
      <div className="relative">
        <Input
          id={props.inputId}
          role="combobox"
          ariaExpanded={true}
          ariaControls={props.listboxId}
          ariaAutoComplete="list"
          ariaActiveDescendant={props.activeOptionId}
          autoFocus={props.autoFocus}
          autoComplete="off"
          isSearchOrFilter={true}
          onChange={(value: string) => {
            props.onChange(value);
          }}
          onKeyDown={props.onKeyDown}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          className="block w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-4 pr-3 text-sm placeholder-gray-400 focus:border-indigo-500 focus:bg-white focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all duration-150 sm:text-sm"
          placeholder="Search projects..."
        />
      </div>
    </div>
  );
};

export default ProjectPickerFilterBox;
