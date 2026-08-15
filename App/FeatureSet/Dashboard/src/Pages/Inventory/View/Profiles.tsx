import InventorySignalPage, {
  InventorySignalRenderProps,
} from "./InventorySignalPage";
import ProfileTable from "../../../Components/Profiles/ProfileTable";
import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const InventoryItemProfiles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <InventorySignalPage
      render={(signal: InventorySignalRenderProps): ReactElement => {
        return (
          <ProfileTable
            entityKeys={[signal.entityKey]}
            noItemsMessage="No performance profiles found for this inventory item."
          />
        );
      }}
    />
  );
};

export default InventoryItemProfiles;
