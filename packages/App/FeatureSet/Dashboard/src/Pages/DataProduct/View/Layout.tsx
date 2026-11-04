import { getDataObservabilityBreadcrumbs } from "../../../Utils/Breadcrumbs/DataObservabilityBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import DataProductViewSideMenu from "./SideMenu";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { Outlet, useParams } from "react-router-dom";

/*
 * One data product, on pages of its own: whether it is fresh and its
 * tables, its settings, and deleting it. Named in the title and the trail
 * once read.
 */
const DataProductViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const dataProductId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <ModelPage
      title="Data Product"
      modelType={DataProduct}
      modelId={dataProductId}
      modelNameField="name"
      breadcrumbLinks={getDataObservabilityBreadcrumbs(path)}
      sideMenu={<DataProductViewSideMenu modelId={dataProductId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default DataProductViewLayout;
