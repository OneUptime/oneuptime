import PageComponentProps from "../../../../../PageComponentProps";
import Navigation from "Common/UI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import TraceExplorer from "../../../../../../Components/Traces/TraceExplorer";

const TraceView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const traceId: string = Navigation.getLastParamAsString(0);

  return <TraceExplorer traceId={traceId} />;
};

export default TraceView;
