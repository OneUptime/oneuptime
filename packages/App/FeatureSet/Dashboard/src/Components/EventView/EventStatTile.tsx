import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
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
  label: string;
  value: string | ReactElement;
  description?: string | undefined;
  icon?: IconProp | undefined;
  className?: string | undefined;
  variant?: EventStatTileVariant | undefined;
}

const EventStatTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
          <span>{props.label}</span>
        </div>
        <div className="mt-1 break-words text-lg font-semibold text-gray-900">
          {props.value}
        </div>
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
        <span>{props.label}</span>
      </div>
      <div className="mt-1.5 truncate text-lg font-semibold text-gray-900">
        {props.value}
      </div>
      {props.description && (
        <div className="mt-0.5 text-xs text-gray-500">{props.description}</div>
      )}
    </div>
  );
};

export default EventStatTile;
