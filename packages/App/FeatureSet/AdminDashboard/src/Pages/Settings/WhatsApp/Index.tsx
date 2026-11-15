import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import {
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
} from "Common/Types/WhatsApp/WhatsAppTemplates";
import { getReadingDirection } from "Common/Types/ReadingDirection";
import { buildWhatsAppSetupMarkdown } from "./WhatsAppSetupGuide";
import { useTranslation } from "react-i18next";

/*
 * Everything but the two values a WhatsApp message is sent with: the
 * webhook's verify token and the app secret its calls are signed with (only
 * needed for Meta's delivery status updates), and the business account and
 * app IDs. Folded under More fields, whose header shows the ones that are set.
 */
const advancedSection: FormFieldCollapsibleSection<GlobalConfig> =
  getAdvancedFormSection<GlobalConfig>();

const SettingsWhatsApp: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();
  // The guide in the reader's language (#8677), laid out the way it reads.
  const whatsappSetupMarkdown: string = buildWhatsAppSetupMarkdown(translator);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [testError, setTestError] = useState<string>("");
  const [testSuccess, setTestSuccess] = useState<string>("");

  return (
    <Page
      title={t("pages.settings.title")}
      isTitleTranslated={true}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.whatsapp"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_WHATSAPP] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <CardModelDetail
        name="Meta WhatsApp Settings"
        cardProps={{
          title: t("pages.settings.whatsapp.metaCardTitle"),
          description: t("pages.settings.whatsapp.metaCardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.whatsapp.metaEditButton")}
        // Titled like the button that opens it, not "Edit Global Config".
        editModalTitle={t("pages.settings.whatsapp.metaEditButton")}
        /*
         * One page: the access token and the phone number ID, which is all
         * a message is sent with, and the rest folded under Advanced. It was
         * two steps (Credentials, Meta App) of six fields.
         */
        formFields={[
          {
            field: {
              metaWhatsAppAccessToken: true,
            },
            title: "Access Token",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: true,
            description:
              "Long-lived access token generated in the Meta WhatsApp Business Platform.",
            placeholder: "EAAG...",
          },
          {
            field: {
              metaWhatsAppPhoneNumberId: true,
            },
            title: "Phone Number ID",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description:
              "The WhatsApp Business phone number ID associated with your sending number.",
            placeholder: "123456789012345",
          },
          {
            field: {
              metaWhatsAppWebhookVerifyToken: true,
            },
            title: "Webhook Verify Token",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: false,
            collapsibleSection: advancedSection,
            description:
              "Secret token configured in Meta to validate webhook subscription requests.",
            placeholder: "Webhook verify token",
          },
          {
            field: {
              metaWhatsAppAppSecret: true,
            },
            title: "App Secret",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: false,
            collapsibleSection: advancedSection,
            description:
              "Optional Facebook App Secret used for webhook signature verification.",
            placeholder: "Facebook App Secret",
          },
          {
            field: {
              metaWhatsAppBusinessAccountId: true,
            },
            title: "Business Account ID",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            collapsibleSection: advancedSection,
            description:
              "Optional Business Account ID that owns the WhatsApp templates.",
            placeholder: "123456789012345",
          },
          {
            field: {
              metaWhatsAppAppId: true,
            },
            title: "App ID",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            collapsibleSection: advancedSection,
            description:
              "Optional Facebook App ID tied to your WhatsApp integration.",
            placeholder: "987654321098765",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-meta-whatsapp",
          fields: [
            {
              field: {
                metaWhatsAppAccessToken: true,
              },
              title: "Access Token",
              fieldType: FieldType.HiddenText,
              placeholder: t("common.notConfigured"),
              isPlaceholderTranslated: true,
            },
            {
              field: {
                metaWhatsAppPhoneNumberId: true,
              },
              title: "Phone Number ID",
              fieldType: FieldType.ObjectID,
              placeholder: t("common.notConfigured"),
              isPlaceholderTranslated: true,
            },
            {
              field: {
                metaWhatsAppBusinessAccountId: true,
              },
              title: "Business Account ID",
              fieldType: FieldType.ObjectID,
              placeholder: t("common.notConfigured"),
              isPlaceholderTranslated: true,
            },
            {
              field: {
                metaWhatsAppWebhookVerifyToken: true,
              },
              title: "Webhook Verify Token",
              fieldType: FieldType.HiddenText,
              placeholder: t("common.notConfigured"),
              isPlaceholderTranslated: true,
            },
            {
              field: {
                metaWhatsAppAppId: true,
              },
              title: "App ID",
              fieldType: FieldType.ObjectID,
              placeholder: t("common.notConfigured"),
              isPlaceholderTranslated: true,
            },
            {
              field: {
                metaWhatsAppAppSecret: true,
              },
              title: "App Secret",
              fieldType: FieldType.HiddenText,
              placeholder: t("common.notConfigured"),
              isPlaceholderTranslated: true,
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      <Card
        title={t("pages.settings.whatsapp.testCardTitle")}
        description={t("pages.settings.whatsapp.testCardDescription")}
      >
        {testSuccess ? (
          <Alert
            type={AlertType.SUCCESS}
            title={testSuccess}
            className="mb-4"
          />
        ) : (
          <></>
        )}

        <BasicForm
          id="send-test-whatsapp-form"
          name="Send Test WhatsApp Message"
          isLoading={isSendingTest}
          error={testError || ""}
          submitButtonText={t("pages.settings.whatsapp.testSubmitButton")}
          maxPrimaryButtonWidth={true}
          initialValues={{
            phoneNumber: "",
          }}
          fields={[
            {
              field: {
                phoneNumber: true,
              },
              title: "Recipient WhatsApp Number",
              description:
                "Enter the full international phone number (including country code) that should receive the test message.",
              placeholder: "+11234567890",
              required: true,
              fieldType: FormFieldSchemaType.Phone,
              disableSpellCheck: true,
            },
          ]}
          onSubmit={async (
            values: JSONObject,
            onSubmitSuccessful?: () => void,
          ) => {
            const toPhone: string = String(values["phoneNumber"] || "").trim();

            if (!toPhone) {
              setTestSuccess("");
              setTestError(t("pages.settings.whatsapp.testMissingNumber"));
              return;
            }

            setIsSendingTest(true);
            setTestError("");
            setTestSuccess("");

            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/notification/whatsapp/test",
                  ),
                  data: {
                    toPhone,
                    templateKey: WhatsAppTemplateIds.TestNotification,
                    templateLanguageCode:
                      WhatsAppTemplateLanguage[
                        WhatsAppTemplateIds.TestNotification
                      ],
                  },
                });

              if (response instanceof HTTPErrorResponse) {
                throw response;
              }

              if (response.isFailure()) {
                throw new Error(t("pages.settings.whatsapp.testFailure"));
              }

              setTestSuccess(t("pages.settings.whatsapp.testSuccess"));

              if (onSubmitSuccessful) {
                onSubmitSuccessful();
              }
            } catch (err) {
              setTestError(API.getFriendlyMessage(err));
            } finally {
              setIsSendingTest(false);
            }
          }}
        />
      </Card>

      <Card
        title={t("pages.settings.whatsapp.setupCardTitle")}
        description={t("pages.settings.whatsapp.setupCardDescription")}
      >
        <MarkdownViewer
          text={whatsappSetupMarkdown}
          readingDirection={getReadingDirection(translator.language)}
        />
      </Card>
    </Page>
  );
};

export default SettingsWhatsApp;
