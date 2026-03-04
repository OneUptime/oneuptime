import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import AppLink from "../AppLink/AppLink";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import React, { FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";

export interface ComponentProps {
  message: string;
  isResolved?: boolean | undefined;
  isArchived?: boolean | undefined;
  fingerprint?: string | undefined;
  className?: string;
}

const TelemetryExceptionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const viewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS_VIEW_ROOT]!,
  );

  const getResolvedIcon: GetReactElementFunction = (): ReactElement => {
    if (props.isResolved === undefined) {
      return <></>;
    }

    if (!props.isResolved) {
      return <></>;
    }

    if (props.isArchived) {
      return <></>;
    }

    return (
      <Tooltip text="Resolved Exception">
        <div className="rounded bg-emerald-200 h-6 w-6 min-h-6 min-w-6 p-1">
          <Icon icon={IconProp.Check} className="text-emerald-600" />
        </div>
      </Tooltip>
    );
  };

  const getUnresolvedIcon: GetReactElementFunction = (): ReactElement => {
    if (props.isResolved === undefined) {
      return <></>;
    }

    if (!props.isResolved && !props.isArchived) {
      return (
        <Tooltip text="Unresolved Exception">
          <div className="rounded bg-red-200 h-6 w-6 min-h-6 min-w-6 p-1">
            <Icon icon={IconProp.Alert} className="text-red-600" />
          </div>
        </Tooltip>
      );
    }

    return <></>;
  };

  const getArchivedIcon: GetReactElementFunction = (): ReactElement => {
    if (props.isArchived === undefined) {
      return <></>;
    }

    if (!props.isArchived) {
      return <></>;
    }

    return (
      <Tooltip text="Archived Exception">
        <div className="rounded bg-gray-200 h-6 w-6 min-h-6 min-w-6 p-1">
          <Icon icon={IconProp.Archive} className="text-gray-600" />
        </div>
      </Tooltip>
    );
  };

  return (
    <div className={` ${props.className} flex`}>
      {getResolvedIcon()}
      {getUnresolvedIcon()}
      {getArchivedIcon()}
      {!props.fingerprint && (
        <div className="mt-0.5 ml-2 font-mono break-words">
          {props.message || "-"}
        </div>
      )}
      {props.fingerprint && (
        <AppLink
          to={new Route(viewRoute.toString()).addRoute(props.fingerprint)}
        >
          <div className="mt-0.5 ml-2 font-mono break-words">
            {props.message || props.fingerprint || "-"}
          </div>
        </AppLink>
      )}
    </div>
  );
};

export default TelemetryExceptionElement;
