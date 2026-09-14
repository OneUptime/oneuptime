import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { useTranslation } from "react-i18next";

const ProjectSupport: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const modelIdString: string = Navigation.getLastParamAsString(1);

  /*
   * ModelDetail refetches whenever the modelId it is handed changes by
   * identity, and editing the toggle re-renders this page. A fresh ObjectID
   * per render would therefore refetch on every render, forever - so the id
   * is memoized on the route param it came from. Same reasoning as the
   * subscription page next door.
   */
  const modelId: ObjectID = useMemo(() => {
    return new ObjectID(modelIdString);
  }, [modelIdString]);

  const breadcrumbLinks: Array<{ title: string; to: Route }> = [
    {
      title: t("breadcrumbs.adminDashboard"),
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: t("breadcrumbs.projects"),
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECTS] as Route),
    },
    {
      title: t("breadcrumbs.project"),
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_VIEW] as Route,
        { modelId: modelId },
      ),
    },
    {
      title: t("breadcrumbs.projectSupport"),
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_SUPPORT] as Route,
        { modelId: modelId },
      ),
    },
  ];

  /*
   * Customer support is a hosted-edition function: on a self-hosted install
   * the operator already has full access to their own instance, so there is
   * nobody to grant access to. The side menu hides the link on that edition,
   * and this early return covers the URL being reached directly.
   */
  if (!BILLING_ENABLED) {
    return (
      <ModelPage<Project>
        modelId={modelId}
        modelNameField="name"
        modelType={Project}
        modelAPI={AdminModelAPI}
        title={t("pages.projectSupport.title")}
        breadcrumbLinks={breadcrumbLinks}
        sideMenu={<SideMenuComponent modelId={modelId} />}
      >
        <Alert
          type={AlertType.INFO}
          title={t("pages.projectSupport.billingDisabled")}
        />
      </ModelPage>
    );
  }

  return (
    <ModelPage<Project>
      modelId={modelId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectSupport.title")}
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <div>
        {/*
         * The customer owns this switch - it is the same toggle they have in
         * Project Settings. Staff flip it here only when the customer has
         * asked for support to look at their project and cannot reach the
         * setting themselves, which is why the card says so out loud.
         */}
        <Alert
          type={AlertType.WARNING}
          title={t("pages.projectSupport.consentWarning")}
          className="mb-5"
        />

        <CardModelDetail<Project>
          name="Customer Support Access"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: t("pages.projectSupport.cardTitle"),
            description: t("pages.projectSupport.cardDescription"),
          }}
          isEditable={true}
          editButtonText={t("pages.projectSupport.editButton")}
          formFields={[
            {
              field: {
                letCustomerSupportAccessProject: true,
              },
              title: t("pages.projectSupport.fieldLabel"),
              description: t("pages.projectSupport.fieldDescription"),
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-support",
            fields: [
              {
                field: {
                  letCustomerSupportAccessProject: true,
                },
                title: t("pages.projectSupport.fieldLabel"),
                description: t("pages.projectSupport.fieldDescription"),
                fieldType: FieldType.Boolean,
                placeholder: "No",
              },
            ],
            modelId: modelId,
          }}
        />
      </div>
    </ModelPage>
  );
};

export default ProjectSupport;
