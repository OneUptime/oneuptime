import PageComponentProps from "../../PageComponentProps";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import { useTableViewContext } from "./TableViewContext";
import DataAssetOwnerTeam from "Common/Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "Common/Models/DatabaseModels/DataAssetOwnerUser";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Who answers for a store: the people and teams its issues go to. Owner
 * rules (Data Security > Rules > Owner Rules) name them automatically from a
 * store's kind, tags and labels; here they are seen, and changed by hand.
 */
const DataAssetOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataAssetId } = useTableViewContext();

  return (
    <OwnersCard<DataAssetOwnerUser, DataAssetOwnerTeam>
      resourceId={dataAssetId}
      resourceIdField="dataAssetId"
      resourceDisplayName="table"
      ownerUserModelType={DataAssetOwnerUser}
      ownerTeamModelType={DataAssetOwnerTeam}
    />
  );
};

export default DataAssetOwners;
