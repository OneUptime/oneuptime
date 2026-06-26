import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import IoTFleetOwnerTeam from "Common/Models/DatabaseModels/IoTFleetOwnerTeam";
import IoTFleetOwnerUser from "Common/Models/DatabaseModels/IoTFleetOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const IoTFleetOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<IoTFleetOwnerUser, IoTFleetOwnerTeam>
      resourceId={modelId}
      resourceIdField="iotFleetId"
      resourceDisplayName="IoT fleet"
      ownerUserModelType={IoTFleetOwnerUser}
      ownerTeamModelType={IoTFleetOwnerTeam}
    />
  );
};

export default IoTFleetOwners;
