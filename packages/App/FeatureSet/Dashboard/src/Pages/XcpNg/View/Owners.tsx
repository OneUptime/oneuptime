import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import XcpNgPoolOwnerTeam from "Common/Models/DatabaseModels/XcpNgPoolOwnerTeam";
import XcpNgPoolOwnerUser from "Common/Models/DatabaseModels/XcpNgPoolOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const XcpNgPoolOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<XcpNgPoolOwnerUser, XcpNgPoolOwnerTeam>
      resourceId={modelId}
      resourceIdField="xcpNgPoolId"
      resourceDisplayName="XCP-ng pool"
      ownerUserModelType={XcpNgPoolOwnerUser}
      ownerTeamModelType={XcpNgPoolOwnerTeam}
    />
  );
};

export default XcpNgPoolOwners;
