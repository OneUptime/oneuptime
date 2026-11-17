import { getAIInsightsBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

/*
 * An insight is one page: OneUptime AI writes it, nobody deletes it, and
 * every panel (evidence, triage, fix link, actions) is on it. Its side menu
 * held a Basic section with Overview alone, so it has none (#9216).
 */
const AIInsightViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Insight"
      modelType={AIInsight}
      modelId={modelId}
      modelNameField="title"
      breadcrumbLinks={getAIInsightsBreadcrumbs(path)}
    >
      <Outlet />
    </ModelPage>
  );
};

export default AIInsightViewLayout;
