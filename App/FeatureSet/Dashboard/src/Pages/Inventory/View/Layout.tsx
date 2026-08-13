import { getInventoryBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import useInventoryItem, {
  UseInventoryItemResult,
} from "../../../Components/Inventory/useInventoryItem";
import { isDeletePermanentForSource } from "../../../Components/Inventory/InventorySource";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const InventoryItemViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const { item }: UseInventoryItemResult = useInventoryItem(modelId);

  /*
   * Only rows the user owns get Settings and Delete. Everything else is
   * maintained by whatever created it, so editing is overwritten and deleting
   * is undone — see InventorySource. While the item is still loading this is
   * false, so the two destructive entries appear once we know they apply
   * rather than flickering in and out.
   */
  const canEdit: boolean = isDeletePermanentForSource(item?.source);

  return (
    <ModelPage
      title="Inventory Item"
      modelType={InventoryItem}
      modelId={modelId}
      modelNameField="displayName"
      breadcrumbLinks={getInventoryBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} canEdit={canEdit} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default InventoryItemViewLayout;
