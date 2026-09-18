import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import EntityRunbooks from "../../../Components/Runbook/EntityRunbooks";
import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentViewRunbooks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <EntityRunbooks incidentId={modelId} />;
};

export default IncidentViewRunbooks;
