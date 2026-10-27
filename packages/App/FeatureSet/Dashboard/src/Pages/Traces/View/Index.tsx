import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import TraceExplorer from "../../../Components/Traces/TraceExplorer";
import SecurityEventsInSignal from "../../../Components/SecurityEvents/SecurityEventsInSignal";

const TraceViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const traceId: string = Navigation.getLastParamAsString(0);
  const spanIdQuery: string | null = Navigation.getQueryStringByName("spanId");

  const highlightSpanIds: string[] = spanIdQuery
    ? spanIdQuery
        .split(",")
        .map((spanId: string) => {
          return spanId.trim();
        })
        .filter((spanId: string) => {
          return spanId.length > 0;
        })
    : [];

  return (
    <>
      {/*
       * A request that is part of an attack says so above its spans, for a
       * reader who may read security events.
       */}
      <SecurityEventsInSignal scope={{ traceId }} className="mb-4" />
      <TraceExplorer traceId={traceId} highlightSpanIds={highlightSpanIds} />
    </>
  );
};

export default TraceViewPage;
