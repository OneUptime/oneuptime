import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ObjectID from "Common/Types/ObjectID";
import DatabaseServerOwnerTeam from "Common/Models/DatabaseModels/DatabaseServerOwnerTeam";
import DatabaseServerOwnerUser from "Common/Models/DatabaseModels/DatabaseServerOwnerUser";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Who owns this database. Owner rules (Databases → Settings → Owner Rules)
 * assign owners automatically; this page shows the result and lets people
 * adjust it by hand.
 */
const DatabaseServerOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/owners, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OwnersCard<DatabaseServerOwnerUser, DatabaseServerOwnerTeam>
      resourceId={modelId}
      resourceIdField="databaseServerId"
      resourceDisplayName="database"
      ownerUserModelType={DatabaseServerOwnerUser}
      ownerTeamModelType={DatabaseServerOwnerTeam}
    />
  );
};

export default DatabaseServerOwners;
