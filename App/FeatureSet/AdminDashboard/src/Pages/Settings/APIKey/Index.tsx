import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.apiKey"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_HOST] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <CardModelDetail
        name="API Key Settings"
        cardProps={{
          title: t("pages.settings.apiKey.cardTitle"),
          description: t("pages.settings.apiKey.cardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.apiKey.editButton")}
        formFields={[
          {
            field: {
              masterApiKey: true,
            },
            title: "Master API Key",
            fieldType: FormFieldSchemaType.ObjectID,
            required: false,
          },
          {
            field: {
              isMasterApiKeyEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config",
          fields: [
            {
              field: {
                masterApiKey: true,
              },
              title: "Master API Key",
              description:
                "This API key has root access to all the resources in all the projects on OneUptime.",
              fieldType: FieldType.HiddenText,
              opts: {
                isCopyable: true,
              },
              placeholder: t("pages.settings.apiKey.apiKeyNotGenerated"),
            },
            {
              field: {
                isMasterApiKeyEnabled: true,
              },
              title: "Enabled",
              description:
                "Enable or disable the master API key. If disabled, all requests using this key will fail.",
              fieldType: FieldType.Boolean,
              placeholder: t("common.notEnabled"),
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;
