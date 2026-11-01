import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import { useDataStoreViewContext } from "./DataStoreViewContext";
import DataStoreOwnerTeam from "Common/Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "Common/Models/DatabaseModels/DataStoreOwnerUser";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Who answers for a store: the people and teams its issues go to. Owner
 * rules (Data Security > Rules > Owner Rules) name them automatically from a
 * store's kind, tags and labels; here they are seen, and changed by hand.
 */
const DataStoreOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataStoreId } = useDataStoreViewContext();

  return (
    <OwnersCard<DataStoreOwnerUser, DataStoreOwnerTeam>
      resourceId={dataStoreId}
      resourceIdField="dataStoreId"
      resourceDisplayName="data store"
      ownerUserModelType={DataStoreOwnerUser}
      ownerTeamModelType={DataStoreOwnerTeam}
    />
  );
};

export default DataStoreOwners;
