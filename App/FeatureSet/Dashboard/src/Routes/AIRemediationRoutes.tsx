import ComponentProps from "../Pages/PageComponentProps";
import AIRemediationLayout from "../Pages/AIRemediation/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import AIRemediation from "../Pages/AIRemediation/Remediation";

const AIRemediationRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<AIRemediationLayout {...props} />}>
        <PageRoute
          index
          element={
            <AIRemediation
              {...props}
              pageRoute={RouteMap[PageMap.AI_REMEDIATION] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default AIRemediationRoutes;
