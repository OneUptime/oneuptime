import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import CloudResourceOwnerTeam from "Common/Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerUser from "Common/Models/DatabaseModels/CloudResourceOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Who owns a cloud resource: owner rules (Cloud → Settings → Owner Rules)
 * assign owners automatically, and this page shows who ended up owning it
 * and lets a person adjust it by hand.
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
      resourceDisplayName="cloud resource"
      ownerUserModelType={CloudResourceOwnerUser}
      ownerTeamModelType={CloudResourceOwnerTeam}
    />
  );
};

export default CloudResourceOwners;
