import PageComponentProps from "../../PageComponentProps";
import RunbookVariablesTable from "../../../Components/Runbook/RunbookVariablesTable";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

// A runbook's own variables, in its Settings section.
const RunbookVariables: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <RunbookVariablesTable runbookId={modelId} />;
};

export default RunbookVariables;
