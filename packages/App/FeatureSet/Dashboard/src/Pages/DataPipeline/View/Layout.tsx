import { getDataObservabilityBreadcrumbs } from "../../../Utils/Breadcrumbs/DataObservabilityBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import PipelineViewSideMenu from "./SideMenu";
import DataPipeline from "Common/Models/DatabaseModels/DataPipeline";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { Outlet, useParams } from "react-router-dom";

/*
 * One pipeline, worked on pages of its own: its runs, and the monitors
 * recommended for them. Named in the title and the trail once read.
 */
const PipelineViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const dataPipelineId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <ModelPage
      title="Pipeline"
      modelType={DataPipeline}
      modelId={dataPipelineId}
      modelNameField="jobName"
      breadcrumbLinks={getDataObservabilityBreadcrumbs(path)}
      sideMenu={<PipelineViewSideMenu modelId={dataPipelineId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default PipelineViewLayout;
