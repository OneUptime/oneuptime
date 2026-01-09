import { Green, Red } from "Common/Types/BrandColors";
import ColorCircle from "Common/UI/Components/ColorCircle/ColorCircle";
import AppLink from "../AppLink/AppLink";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import React, { FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";

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

  return (
    <div className="flex space-x-2">
      <div className="mt-1">
        {(spanStatusCode !== null || spanStatusCode !== undefined) &&
        spanStatusCode === SpanStatus.Unset ? (
          <ColorCircle color={Green} tooltip="Span Status: Unset" />
        ) : (
          <></>
        )}
        {spanStatusCode && spanStatusCode === SpanStatus.Ok ? (
          <ColorCircle color={Green} tooltip="Span Status: Ok" />
        ) : (
          <></>
        )}
        {spanStatusCode && spanStatusCode === SpanStatus.Error ? (
          <ColorCircle color={Red} tooltip="Span Status: Error" />
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
