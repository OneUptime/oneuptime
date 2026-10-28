import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "card" is a standalone bordered tile. "segment" is one cell of an
 * EventStatBar: the bar owns the border, rounding and dividers, so the cell
 * only pads itself, and its value wraps instead of truncating because a cell
 * in a narrow bar has no hover affordance to reveal the rest.
 */
export type EventStatTileVariant = "card" | "segment";

export interface ComponentProps {
  id?: string | undefined;
  /*
   * The tile's name, in English: "Declared", "Duration". The tile looks it
   * up in the reader's language where it draws it, as the event header does
   * its facts' labels; a label the page has already put in the reader's
   * words ("{{stateName}} in") has no entry of its own and reads as given.
   */
  label: string;
  value: string | ReactElement;
  /*
   * A second reading of the value, under it: "4 minutes after paging" under
   * the time to acknowledge. Quieter than the value and above the
   * description, so the three read value, note, date. In a narrow cell it
   * wraps into even lines ("4 minutes / after paging"), never leaving one
   * word on a line of its own. An element for a note drawn in a tone of its
   * own - a security case's target, amber when it is about to be missed.
   */
  note?: string | ReactElement | undefined;
  description?: string | undefined;
  icon?: IconProp | undefined;
  className?: string | undefined;
  variant?: EventStatTileVariant | undefined;
}

const EventStatTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const label: string = translateString(props.label) || props.label;

  if (props.variant === "segment") {
    return (
      <div
        id={props.id}
        className={`min-w-0 bg-white px-5 py-4 ${props.className || ""}`}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
          {props.icon && (
            <Icon
              icon={props.icon}
              className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
            />
          )}
          <span>{label}</span>
        </div>
        <div className="mt-1 break-words text-lg font-semibold text-gray-900">
          {props.value}
        </div>
        {props.note && (
          <div className="mt-0.5 text-balance break-words text-sm text-gray-600">
            {props.note}
          </div>
        )}
        {props.description && (
          <div className="mt-0.5 text-xs text-gray-500">
            {props.description}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      id={props.id}
      className={`rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm ${
        props.className || ""
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
        {props.icon && (
          <Icon icon={props.icon} className="h-3.5 w-3.5 text-gray-400" />
        )}
        <span>{label}</span>
      </div>
      <div className="mt-1.5 truncate text-lg font-semibold text-gray-900">
        {props.value}
      </div>
      {props.note && (
        <div className="mt-0.5 truncate text-sm text-gray-600">
          {props.note}
        </div>
      )}
      {props.description && (
        <div className="mt-0.5 text-xs text-gray-500">{props.description}</div>
      )}
    </div>
  );
};

export default EventStatTile;
