import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import AIAgentTask from "Common/Models/DatabaseModels/AIAgentTask";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import { useParams } from "react-router-dom";

const DeletePage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <ModelDelete
      modelType={AIAgentTask}
      modelId={modelId}
      onDeleteSuccess={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.AI_AGENT_TASKS]!,
          ),
        );
      }}
    />
  );
};

export default DeletePage;
