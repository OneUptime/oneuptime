import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
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
  const { translateString, translateValue } = useTranslateValue();
  return (
    <dl
      id={props.id}
      className={`min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 ${
        props.className || ""
      }`}
    >
      <dt className="flex items-start gap-2 text-xs font-medium text-gray-500">
        {props.icon && (
          <span aria-hidden="true" className="shrink-0">
            <Icon icon={props.icon} className="h-4 w-4 text-gray-400" />
          </span>
        )}
        <span className="min-w-0 break-words">
          {translateString(props.label)}
        </span>
      </dt>
      <dd className="mt-2 break-words text-lg font-semibold leading-7 tabular-nums text-gray-900">
        {translateValue(props.value)}
      </dd>
      {props.description && (
        <dd className="mt-1 break-words text-xs leading-5 text-gray-500">
          {translateString(props.description)}
        </dd>
      )}
    </dl>
  );
};

export default EventStatTile;
