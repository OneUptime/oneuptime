import Color from "Common/Types/Color";
import ColorCircle from "Common/UI/Components/ColorCircle/ColorCircle";
import AppLink from "../AppLink/AppLink";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import React, { FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  SpanStatusPresentation,
  getSpanStatusPresentation,
} from "../../Utils/SpanStatusPresentation";

export interface ComponentProps {
  spanStatusCode: SpanStatus;
  title?: string | undefined;
  titleClassName?: string | undefined;
  traceId?: string | undefined;
}

const SpanStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { spanStatusCode } = props;

  // Unset is 0, so test for a missing value rather than a falsy one.
  const hasStatus: boolean =
    spanStatusCode !== null && spanStatusCode !== undefined;

  const status: SpanStatusPresentation =
    getSpanStatusPresentation(spanStatusCode);

  return (
    <div className="flex space-x-2">
      <div className="mt-1">
        {hasStatus ? (
          <ColorCircle
            color={new Color(status.color)}
            tooltip={`Span Status: ${status.displayLabel}`}
          />
        ) : (
          <></>
        )}
      </div>
      {props.title ? (
        <div className={`${props.titleClassName} hover:underline`}>
          <AppLink
            to={RouteUtil.populateRouteParams(RouteMap[PageMap.TRACE_VIEW]!, {
              modelId: props.traceId,
            })}
          >
            <p>{props.title}</p>
          </AppLink>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SpanStatusElement;
