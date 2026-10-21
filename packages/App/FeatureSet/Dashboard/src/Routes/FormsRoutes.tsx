import ComponentProps from "../Pages/PageComponentProps";
import FormsLayout from "../Pages/Forms/Layout";
import FormViewLayout from "../Pages/Forms/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { FormsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import Forms from "../Pages/Forms/Forms";
import FormsSubmissions from "../Pages/Forms/Submissions";
import FormBuild from "../Pages/Forms/View/Build";
import FormTemplates from "../Pages/Forms/View/Templates";
import FormOnSubmit from "../Pages/Forms/View/OnSubmit";
import FormShare from "../Pages/Forms/View/Share";
import FormViewSubmissions from "../Pages/Forms/View/Submissions";
import FormDuplicate from "../Pages/Forms/View/Duplicate";
import FormDelete from "../Pages/Forms/View/Delete";
import FormModel from "Common/Models/DatabaseModels/Form";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";

/*
 * The Forms product, mounted at /dashboard/:projectId/forms/*: the list and
 * every submission under the product's own menu, and each form under its
 * view menu, landing on its builder.
 */
const FormsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<FormsLayout {...props} />}>
        <PageRoute
          index
          element={
            <Forms {...props} pageRoute={RouteMap[PageMap.FORMS] as Route} />
          }
        />
        <PageRoute
          path={FormsRoutePath[PageMap.FORMS_SUBMISSIONS] || ""}
          element={
            <FormsSubmissions
              {...props}
              pageRoute={RouteMap[PageMap.FORMS_SUBMISSIONS] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: FormModel,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.FORMS_ROOT,
        })}
      </PageRoute>

      <PageRoute
        path={FormsRoutePath[PageMap.FORM_VIEW] || ""}
        element={<FormViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <FormBuild
              {...props}
              pageRoute={RouteMap[PageMap.FORM_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.FORM_VIEW_TEMPLATES)}
          element={
            <FormTemplates
              {...props}
              pageRoute={RouteMap[PageMap.FORM_VIEW_TEMPLATES] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.FORM_VIEW_ON_SUBMIT)}
          element={
            <FormOnSubmit
              {...props}
              pageRoute={RouteMap[PageMap.FORM_VIEW_ON_SUBMIT] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.FORM_VIEW_SHARE)}
          element={
            <FormShare
              {...props}
              pageRoute={RouteMap[PageMap.FORM_VIEW_SHARE] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.FORM_VIEW_SUBMISSIONS)}
          element={
            <FormViewSubmissions
              {...props}
              pageRoute={RouteMap[PageMap.FORM_VIEW_SUBMISSIONS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.FORM_VIEW_DUPLICATE)}
          element={
            <FormDuplicate
              {...props}
              pageRoute={RouteMap[PageMap.FORM_VIEW_DUPLICATE] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.FORM_VIEW_DELETE)}
          element={
            <FormDelete
              {...props}
              pageRoute={RouteMap[PageMap.FORM_VIEW_DELETE] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: FormModel,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>
    </Routes>
  );
};

export default FormsRoutes;
