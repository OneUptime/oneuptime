import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
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
}

const TelemetryExceptionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

  let viewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TELEMETRY_EXCEPTIONS_ROOT]!,
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
        <div className="rounded bg-emerald-200 h-6 w-6 p-1">
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
          <div className="rounded bg-red-200 h-6 w-6 p-1">
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
        <div className="rounded bg-gray-200 h-6 w-6 p-1">
          <Icon icon={IconProp.Archive} className="text-gray-600" />
        </div>
      </Tooltip>
    );
  };

  return (
    <div className={` flex truncate`}>
      {getResolvedIcon()}
      {getUnresolvedIcon()}
      {getArchivedIcon()}
      {!props.fingerprint && <div className="mt-0.5 ml-2 font-mono">{props.message || "-"}</div>}
      {props.fingerprint && (
        <Link to={new Route(viewRoute.toString()).addRoute(props.fingerprint)}>
          <div className="mt-0.5 ml-2 font-mono">{props.message || props.fingerprint || "-"}</div>
        </Link>
      )}
    </div>
  );
};

export default TelemetryExceptionElement;
