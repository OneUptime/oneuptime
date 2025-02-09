import Link from "Common/UI/Components/Link/Link";
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
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_TRACE_VIEW]!,
              {
                modelId: props.traceId,
              },
            )}
          >
            <p>{props.traceId}</p>
          </Link>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TraceElement;
