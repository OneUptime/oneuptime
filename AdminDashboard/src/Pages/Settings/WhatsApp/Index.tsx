import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent = (): ReactElement => {
  return (
    <Page
      title={"Admin Settings"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "WhatsApp",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_WHATSAPP] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {/* WhatsApp Settings View  */}
      <CardModelDetail
        name="WhatsApp Settings"
        cardProps={{
          title: "Meta WhatsApp Business API Config",
          description: "Configure Meta WhatsApp Business API to send WhatsApp messages.",
        }}
        isEditable={true}
        editButtonText="Edit WhatsApp Config"
        formFields={[
          {
            field: {
              metaWhatsAppAccessToken: true,
            },
            title: "Access Token",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "You can find this in your Meta Developer Console.",
            placeholder: "Enter your Meta WhatsApp Access Token",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              metaWhatsAppPhoneNumberId: true,
            },
            title: "Phone Number ID",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "The Phone Number ID from your WhatsApp Business Account.",
            placeholder: "Enter Phone Number ID",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              metaWhatsAppBusinessAccountId: true,
            },
            title: "Business Account ID",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "Your WhatsApp Business Account ID.",
            placeholder: "Enter Business Account ID",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              metaWhatsAppAppId: true,
            },
            title: "App ID",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "App ID from your Meta Developer Console.",
            placeholder: "Enter App ID",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              metaWhatsAppAppSecret: true,
            },
            title: "App Secret",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "App Secret from your Meta Developer Console.",
            placeholder: "Enter App Secret",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              metaWhatsAppWebhookVerifyToken: true,
            },
            title: "Webhook Verify Token",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "Token used to verify webhook requests from Meta.",
            placeholder: "Enter Webhook Verify Token",
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
                metaWhatsAppAccessToken: true,
              },
              title: "Access Token",
              placeholder: "None",
            },
            {
              field: {
                metaWhatsAppPhoneNumberId: true,
              },
              title: "Phone Number ID",
              placeholder: "None",
            },
            {
              field: {
                metaWhatsAppBusinessAccountId: true,
              },
              title: "Business Account ID",
              placeholder: "None",
            },
            {
              field: {
                metaWhatsAppAppId: true,
              },
              title: "App ID",
              placeholder: "None",
            },
            {
              field: {
                metaWhatsAppAppSecret: true,
              },
              title: "App Secret",
              placeholder: "None",
            },
            {
              field: {
                metaWhatsAppWebhookVerifyToken: true,
              },
              title: "Webhook Verify Token",
              placeholder: "None",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;