import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { ReactElement } from "react";

/*
 * Two or three ways to see the same records, side by side in a card's header:
 * List | Calendar on the scheduled maintenance events. The control the status
 * timelines' Timeline | Table switch draws (StatusTimelineView), for any set
 * of views: a grey track, the chosen view raised in white with its icon in
 * the accent colour, the others plain until hovered.
 *
 * Each option is a button with aria-pressed, in a group a screen reader
 * names; pressing the chosen one does nothing. Labels and the group's name
 * are English the switch translates (Translator).
 */
export interface ViewSwitchOption<T extends string> {
  value: T;
  label: string;
  icon: IconProp;
}

export interface ComponentProps<T extends string> {
  options: ReadonlyArray<ViewSwitchOption<T>>;
  value: T;
  onChange: (value: T) => void;
  // What the group is, for a screen reader: "Show the events as".
  ariaLabel: string;
  // The group's test id; each option's is `<dataTestId>-<value>`.
  dataTestId: string;
}

export const VIEW_SWITCH_CLASS_NAME: string =
  "inline-flex shrink-0 items-center rounded-lg bg-gray-100 p-0.5";

export const VIEW_SWITCH_OPTION_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export const VIEW_SWITCH_ACTIVE_CLASS_NAME: string =
  "bg-white text-gray-900 shadow-sm";

export const VIEW_SWITCH_IDLE_CLASS_NAME: string =
  "text-gray-600 hover:text-gray-900";

function ViewSwitch<T extends string>(props: ComponentProps<T>): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <div
      role="group"
      aria-label={translator.translateText(props.ariaLabel)}
      className={VIEW_SWITCH_CLASS_NAME}
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
            <Icon
              icon={option.icon}
              className={`h-4 w-4 ${isActive ? "text-indigo-600" : ""}`}
            />
            {translator.translateText(option.label)}
          </button>
        );
      })}
    </div>
  );
}

export default ViewSwitch;
