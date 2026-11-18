import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import DataPipelineOwnerTeam from "Common/Models/DatabaseModels/DataPipelineOwnerTeam";
import DataPipelineOwnerUser from "Common/Models/DatabaseModels/DataPipelineOwnerUser";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

// The pipeline as the Owners card's sentences name it, mid-sentence, in the reader's words.
const PIPELINE_TERM: string = translationKey("pipeline");

/*
 * Who fixes a pipeline (#6551): the people and teams named beside its failed
 * or late run in Needs Attention and Issues, and told of its alerts - a run
 * that failed, ran far longer than usual or has not started when it usually
 * does.
 */
const DataPipelineOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<DataPipelineOwnerUser, DataPipelineOwnerTeam>
      resourceId={modelId}
      resourceIdField="dataPipelineId"
      resourceDisplayName={PIPELINE_TERM}
      ownerUserModelType={DataPipelineOwnerUser}
      ownerTeamModelType={DataPipelineOwnerTeam}
    />
  );
};

export default DataPipelineOwners;
