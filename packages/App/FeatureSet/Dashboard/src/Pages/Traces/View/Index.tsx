import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import TraceExplorer from "../../../Components/Traces/TraceExplorer";

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
    <TraceExplorer traceId={traceId} highlightSpanIds={highlightSpanIds} />
  );
};

export default TraceViewPage;
