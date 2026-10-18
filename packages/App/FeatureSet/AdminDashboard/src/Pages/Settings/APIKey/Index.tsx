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
      {/*
       * The card says what the key is, once: its rows no longer repeat
       * the card's line under their names, and the Edit dialog's fields
       * say it in the same words.
       */}
      <CardModelDetail
        name="API Key Settings"
        cardProps={{
          title: t("pages.settings.apiKey.cardTitle"),
          description: t("pages.settings.apiKey.cardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.apiKey.editButton")}
        // Titled like the button that opens it, not "Edit Global Config".
        editModalTitle={t("pages.settings.apiKey.editButton")}
        formFields={[
          {
            field: {
              masterApiKey: true,
            },
            title: "Master API Key",
            description: "Has root access to every project on this server.",
            fieldType: FormFieldSchemaType.ObjectID,
            required: false,
          },
          {
            field: {
              isMasterApiKeyEnabled: true,
            },
            title: "Enabled",
            description: "While it is off, every request with the key fails.",
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
