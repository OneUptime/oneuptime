import PageComponentProps from "../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResetObjectID<CodeRepository>
        modelType={CodeRepository}
        fieldName={"secretToken"}
        title={"Reset Secret Token"}
        description={"Reset the secret token to a new value."}
        modelId={modelId}
      />
    </Fragment>
  );
};

export default ServiceDelete;
