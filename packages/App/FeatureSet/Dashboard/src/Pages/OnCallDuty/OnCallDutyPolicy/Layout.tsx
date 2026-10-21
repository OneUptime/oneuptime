import { getOnCallDutyBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ArchivedResourceBanner from "../../../Components/Archive/ArchivedResourceBanner";
import { ON_CALL_POLICY_ARCHIVE_COPY } from "../../../Components/Archive/ResourceArchiveCopy";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const OnCallDutyPolicyViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="On-Call Policy"
      modelType={OnCallDutyPolicy}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getOnCallDutyBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <ArchivedResourceBanner<OnCallDutyPolicy>
        modelType={OnCallDutyPolicy}
        modelId={modelId}
        copy={ON_CALL_POLICY_ARCHIVE_COPY}
      />
      <Outlet />
    </ModelPage>
  );
};

export default OnCallDutyPolicyViewLayout;
