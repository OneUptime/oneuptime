import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import TraceTable from "../../Components/Traces/TraceTable";

const TracesListPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <TraceTable />;
};

export default TracesListPage;
