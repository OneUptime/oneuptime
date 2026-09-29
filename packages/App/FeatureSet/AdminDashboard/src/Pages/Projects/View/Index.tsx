import AdminModelAPI from "../../../Utils/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import SideMenuComponent from "./SideMenu";
import { BILLING_ENABLED } from "Common/UI/Config";
import DataResidencyUtil from "Common/Utils/Project/DataResidency";

const Projects: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectView.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.projects"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECTS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.project"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_VIEW] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <div>
        <CardModelDetail<Project>
          name="Project"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: t("pages.projectView.cardTitle"),
            description: t("pages.projectView.cardDescription"),
          }}
          isEditable={true}
          editButtonText={t("pages.projectView.editButton")}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-user",
            fields: [
              {
                field: {
                  _id: true,
                },
                title: "Project ID",
                fieldType: FieldType.ObjectID,
                placeholder: "-",
              },
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FieldType.Text,
              },
            ],
            modelId: modelId,
          }}
        />

        {/*
         * Data residency is a SaaS concept - a self-hosted install is wherever
         * its operator put it, and the server refuses a value when billing is
         * off - so the card is not offered there at all.
         */}
        {BILLING_ENABLED ? (
          <CardModelDetail<Project>
            name="Project Data Residency"
            modelAPI={AdminModelAPI}
            cardProps={{
              title: t("pages.projectView.dataResidencyCardTitle"),
              description: t("pages.projectView.dataResidencyCardDescription"),
            }}
            isEditable={true}
            editButtonText={t("pages.projectView.dataResidencyEditButton")}
            formFields={[
              {
                field: {
                  dataResidency: true,
                },
                title: t("pages.projectView.dataResidencyFieldTitle"),
                description: t(
                  "pages.projectView.dataResidencyFieldDescription",
                ),
                fieldType: FormFieldSchemaType.Text,
                required: false,
                placeholder: t(
                  "pages.projectView.dataResidencyFieldPlaceholder",
                ),
                validation: {
                  maxLength: DataResidencyUtil.MAX_LENGTH,
                },
              },
            ]}
            modelDetailProps={{
              modelType: Project,
              id: "model-detail-project-data-residency",
              fields: [
                {
                  field: {
                    dataResidency: true,
                  },
                  title: t("pages.projectView.dataResidencyFieldTitle"),
                  fieldType: FieldType.Text,
                  placeholder: t("pages.projectView.dataResidencyNotSet"),
                },
              ],
              modelId: modelId,
            }}
          />
        ) : (
          <></>
        )}
      </div>
    </ModelPage>
  );
};

export default Projects;
