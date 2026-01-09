import AppLink from "../AppLink/AppLink";
import React, { FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";

export interface ComponentProps {
  traceId?: string | undefined;
}

const TraceElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flex space-x-2">
      {props.traceId ? (
        <div className={`hover:underline`}>
          <AppLink
            to={RouteUtil.populateRouteParams(RouteMap[PageMap.TRACE_VIEW]!, {
              modelId: props.traceId,
            })}
          >
            <p>{props.traceId}</p>
          </AppLink>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TraceElement;
