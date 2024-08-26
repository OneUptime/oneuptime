import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
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
      <div className="rounded bg-emerald-200">
        <Icon icon={IconProp.Check} className="text-emerald-600" />
      </div>
    );
  };

  const getUnresolvedIcon: GetReactElementFunction = (): ReactElement => {
    if (!props.isResolved && !props.isArchived) {
      return <></>;
    }

    return (
      <div className="rounded bg-red-200">
        <Icon icon={IconProp.Alert} className="text-red-600" />
      </div>
    );
  };

  const getArchivedIcon: GetReactElementFunction = (): ReactElement => {
    if (!props.isResolved || !props.isArchived) {
      return <></>;
    }

    return (
      <div className="rounded bg-gray-200">
        <Icon icon={IconProp.Archive} className="text-gray-600" />
      </div>
    );
  };

  return (
    <div className={`font-mono flex truncate`}>
      {getResolvedIcon()}
      {getUnresolvedIcon()}
      {getArchivedIcon()}
      {props.message}
    </div>
  );
};

export default TelemetryExceptionElement;
