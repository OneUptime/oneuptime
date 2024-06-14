import PageComponentProps from "../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ResetObjectID from "CommonUI/src/Components/ResetObjectID/ResetObjectID";
import Navigation from "CommonUI/src/Utils/Navigation";
import CodeRepository from "Model/Models/CodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceDelete: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
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
