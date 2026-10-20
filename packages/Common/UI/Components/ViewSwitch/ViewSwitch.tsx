import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { ReactElement } from "react";

/*
 * Two or more ways to see the same records, side by side: List | Calendar on
 * the scheduled maintenance events, and Month | Week | Day in a calendar's
 * toolbar (Calendar/CalendarToolbar). The control the status timelines'
 * Timeline | Table switch draws (StatusTimelineView), for any set of views: a
 * grey track, the chosen view raised in white with its icon, when it has
 * one, in the accent colour, the others plain until hovered.
 *
 * Each option is a button with aria-pressed, in a group a screen reader
 * names; pressing the chosen one does nothing. Labels and the group's name
 * are English the switch translates (Translator).
 */
export interface ViewSwitchOption<T extends string> {
  value: T;
  label: string;
  // A picture of the view; a word alone is enough for Month | Week | Day.
  icon?: IconProp | undefined;
}

export interface ComponentProps<T extends string> {
  options: ReadonlyArray<ViewSwitchOption<T>>;
  /*
   * The view on screen, or null while none of them is: the role picker's
   * Whole project | One area while its search lists roles from both. Every
   * option is then plain, and pressing one shows it.
   */
  value: T | null;
  onChange: (value: T) => void;
  // What the group is, for a screen reader: "Show the events as".
  ariaLabel: string;
  // The group's test id; each option's is `<dataTestId>-<value>`.
  dataTestId: string;
  /*
   * On a phone, the switch fills its row and its options share it equally,
   * as a phone's own segmented controls do; from sm up it is as wide as its
   * options. For a switch that heads a form's content (the role picker's
   * Whole project | One area), not one squeezed into a toolbar.
   */
  fillWidthOnPhone?: boolean | undefined;
}

export const VIEW_SWITCH_CLASS_NAME: string =
  "inline-flex shrink-0 items-center rounded-lg bg-gray-100 p-0.5";

export const VIEW_SWITCH_OPTION_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export const VIEW_SWITCH_ACTIVE_CLASS_NAME: string =
  "bg-white text-gray-900 shadow-sm";

export const VIEW_SWITCH_IDLE_CLASS_NAME: string =
  "text-gray-600 hover:text-gray-900";

// fillWidthOnPhone: the track fills the row, then hugs its options from sm up.
export const VIEW_SWITCH_FILL_CLASS_NAME: string =
  "flex w-full items-center rounded-lg bg-gray-100 p-0.5 sm:inline-flex sm:w-auto";

// fillWidthOnPhone: each option an equal share of the row, then its own width.
export const VIEW_SWITCH_FILL_OPTION_CLASS_NAME: string =
  "flex-1 justify-center sm:flex-none";

function ViewSwitch<T extends string>(props: ComponentProps<T>): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <div
      role="group"
      aria-label={translator.translateText(props.ariaLabel)}
      className={
        props.fillWidthOnPhone
          ? VIEW_SWITCH_FILL_CLASS_NAME
          : VIEW_SWITCH_CLASS_NAME
      }
      data-testid={props.dataTestId}
    >
      {props.options.map((option: ViewSwitchOption<T>): ReactElement => {
        const isActive: boolean = option.value === props.value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            data-testid={`${props.dataTestId}-${option.value}`}
            className={`${VIEW_SWITCH_OPTION_CLASS_NAME} ${
              props.fillWidthOnPhone ? VIEW_SWITCH_FILL_OPTION_CLASS_NAME : ""
            } ${
              isActive
                ? VIEW_SWITCH_ACTIVE_CLASS_NAME
                : VIEW_SWITCH_IDLE_CLASS_NAME
            }`}
            onClick={() => {
              if (!isActive) {
                props.onChange(option.value);
              }
            }}
          >
            {option.icon ? (
              <Icon
                icon={option.icon}
                className={`h-4 w-4 ${isActive ? "text-indigo-600" : ""}`}
              />
            ) : (
              <></>
            )}
            {translator.translateText(option.label)}
          </button>
        );
      })}
    </div>
  );
}

export default ViewSwitch;
