import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  message: string;
  isResolved: boolean;
  isArchived: boolean;
}

const TelemetryExceptionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getResolvedIcon: GetReactElementFunction = (): ReactElement => {
    if (!props.isResolved) {
      return <></>;
    }

    return (
      <div className="rounded bg-red-200 h-6 w-6 p-1">
        <Icon icon={IconProp.Check} className="text-emerald-600" />
      </div>
    );
  };

  const getUnresolvedIcon: GetReactElementFunction = (): ReactElement => {
    if (!props.isResolved && !props.isArchived) {
      return (
        <Tooltip text="Unresolved Exception">
          <div className="rounded bg-red-200 h-6 w-6 p-1">
            <Icon icon={IconProp.Alert} className="text-red-600" />
          </div>
        </Tooltip>
      );
    }

    return <></>;
  };

  const getArchivedIcon: GetReactElementFunction = (): ReactElement => {
    if (!props.isResolved || !props.isArchived) {
      return <></>;
    }

    return (
      <div className="rounded bg-red-200 h-6 w-6 p-1">
        <Icon icon={IconProp.Archive} className="text-gray-600" />
      </div>
    );
  };

  return (
    <div className={` flex truncate`}>
      {getResolvedIcon()}
      {getUnresolvedIcon()}
      {getArchivedIcon()}
      <div className="mt-0.5 ml-2 font-mono">{props.message}</div>
    </div>
  );
};

export default TelemetryExceptionElement;
