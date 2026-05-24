import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "./OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const RunbookOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OwnersCard runbookId={modelId} />;
};

export default RunbookOwners;
