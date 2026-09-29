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
          title: t("breadcrumbs.callsAndSms"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_CALL_AND_SMS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <CardModelDetail
        name="Call and SMS Settings"
        cardProps={{
          title: t("pages.settings.callSms.cardTitle"),
          description: t("pages.settings.callSms.cardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.callSms.editButton")}
        formFields={[
          {
            field: {
              twilioAccountSID: true,
            },
            title: "Twilio Account SID",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "You can find this in your Twilio console.",
            placeholder: "",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              twilioAuthToken: true,
            },
            title: "Twilio Auth Token",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "You can find this in your Twilio console.",
            placeholder: "",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              twilioPrimaryPhoneNumber: true,
            },
            title: "Primary Twilio Phone Number",
            fieldType: FormFieldSchemaType.Phone,
            required: true,
            description: "You can find this in your Twilio console.",
            placeholder: "",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              twilioSecondaryPhoneNumbers: true,
            },
            title: "Secondary Twilio Phone Number",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            description:
              "If you have bought more phone numbers from Twilio for specific countries, you can add them here.",
            placeholder: "+1234567890, +4444444444",
            validation: {
              minLength: 2,
            },
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config",
          fields: [
            {
              field: {
                twilioAccountSID: true,
              },
              title: "Twilio Account SID",
              placeholder: t("common.none"),
            },
            {
              field: {
                twilioPrimaryPhoneNumber: true,
              },
              title: "Primary Twilio Phone Number",
              fieldType: FieldType.Phone,
              placeholder: t("common.none"),
            },
            {
              field: {
                twilioSecondaryPhoneNumbers: true,
              },
              title: "Secondary Twilio Phone Numbers",
              fieldType: FieldType.LongText,
              placeholder: t("common.none"),
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;
