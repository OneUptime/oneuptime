import PageComponentProps from "../../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TraceTable from "../../../../../Components/Traces/TraceTable";

const TracesList: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <TraceTable modelId={modelId} />
    </Fragment>
  );
};

export default TracesList;
