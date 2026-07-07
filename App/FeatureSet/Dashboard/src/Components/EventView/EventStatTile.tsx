import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  id?: string | undefined;
  label: string;
  value: string | ReactElement;
  description?: string | undefined;
  icon?: IconProp | undefined;
  className?: string | undefined;
}

const EventStatTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
