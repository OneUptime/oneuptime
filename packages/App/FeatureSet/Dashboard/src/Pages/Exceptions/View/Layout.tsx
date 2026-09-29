import { getExceptionsBreadcrumbs } from "../../../Utils/Breadcrumbs";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";
import PageMap from "../../../Utils/PageMap";
import SideMenu from "./SideMenu";

const ExceptionViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  if (path.endsWith("exceptions")) {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.EXCEPTIONS]!),
    );

    return <></>;
  }

  return (
    <Page
      title="Exception"
      description="Investigate this error, understand its impact, and coordinate a resolution."
      breadcrumbLinks={getExceptionsBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Outlet />
    </Page>
  );
};

export default ExceptionViewLayout;
