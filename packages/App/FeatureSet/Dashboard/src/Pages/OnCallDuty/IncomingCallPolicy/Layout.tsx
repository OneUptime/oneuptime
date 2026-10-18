import { getIncomingCallPolicyBreadcrumbs } from "../../../Utils/Breadcrumbs/OnCallDutyBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

/*
 * A policy's pages are headed with its name - "Incoming Call Policy -
 * Support Hotline" - and its labels, as an on-call policy's and a schedule's
 * are. The header used to read "Incoming Call Policy" on every policy.
 */
const IncomingCallPolicyLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <ModelPage
      title="Incoming Call Policy"
      modelType={IncomingCallPolicy}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getIncomingCallPolicyBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default IncomingCallPolicyLayout;
