import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import ServiceOwnerTeam from "Common/Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "Common/Models/DatabaseModels/ServiceOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ServiceOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<ServiceOwnerUser, ServiceOwnerTeam>
      resourceId={modelId}
      resourceIdField="serviceId"
      resourceDisplayName="service"
      ownerUserModelType={ServiceOwnerUser}
      ownerTeamModelType={ServiceOwnerTeam}
    />
  );
};

export default ServiceOwners;
