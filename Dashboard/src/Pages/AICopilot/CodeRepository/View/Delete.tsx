import PageMap from "../../../../Utils/PageMap";
import RouteMap from "../../../../Utils/RouteMap";
import PageComponentProps from "../../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/src/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/src/Utils/Navigation";
import CodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const CodeRepositoryDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={CodeRepository}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[PageMap.AI_COPILOT_CODE_REPOSITORY] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default CodeRepositoryDelete;
