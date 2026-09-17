import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import CloudResourceOwnerTeam from "Common/Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerUser from "Common/Models/DatabaseModels/CloudResourceOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Owner rules (Cloud → Settings → Owner Rules) assign owners to environments
 * automatically, but until this page existed there was nowhere to see who
 * ended up owning one or to adjust it by hand.
 */
const CloudResourceOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/owners, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<CloudResourceOwnerUser, CloudResourceOwnerTeam>
      resourceId={modelId}
      resourceIdField="cloudResourceId"
      resourceDisplayName="cloud environment"
      ownerUserModelType={CloudResourceOwnerUser}
      ownerTeamModelType={CloudResourceOwnerTeam}
    />
  );
};

export default CloudResourceOwners;
