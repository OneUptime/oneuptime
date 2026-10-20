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
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getPhoneNumberListError } from "Common/UI/Utils/PhoneNumberListError";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * The numbers few installations need, folded under More fields below the
 * three values the Twilio console shows together: numbers to send SMS from,
 * for numbers that can only make calls (in Singapore, national numbers are
 * voice-only and SMS need a mobile number), and the numbers bought for
 * other countries. Once SMS numbers are listed, every SMS goes out from one
 * of them (Common/Types/CallAndSMS/TwilioPhoneNumbers), as on a project's
 * own Twilio config.
 */
const advancedSection: FormFieldCollapsibleSection<GlobalConfig> =
  getAdvancedFormSection<GlobalConfig>();

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
        // Titled like the button that opens it, not "Edit Global Config".
        editModalTitle={t("pages.settings.callSms.editButton")}
        /*
         * One page: the account SID, its auth token and the number to send
         * from are copied out of the Twilio console together and only work
         * together. It was two steps - the account, then the numbers - which
         * split one copy-and-paste across a Next.
         */
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
            description:
              "Calls go out from this number, and SMS too unless you add SMS phone numbers under More fields.",
            placeholder: "+14155550100",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              twilioSmsPhoneNumbers: true,
            },
            title: "Twilio SMS Phone Numbers",
            // One line: most lists hold one number or two.
            fieldType: FormFieldSchemaType.Text,
            // Optional: without them, SMS go out from the numbers calls do.
            required: false,
            collapsibleSection: advancedSection,
            description:
              "If your Twilio numbers can't send SMS (in Singapore, national numbers are voice-only), add numbers that can. Every SMS then goes out from the one in the recipient's country, or else the first.",
            placeholder: "+6581234567",
            customValidation: (
              values: FormValues<GlobalConfig>,
            ): string | null => {
              // Refused under the field, by the server's rule.
              return getPhoneNumberListError(values.twilioSmsPhoneNumbers);
            },
          },
          {
            field: {
              twilioSecondaryPhoneNumbers: true,
            },
            title: "Secondary Twilio Phone Numbers",
            fieldType: FormFieldSchemaType.Text,
            /*
             * Optional, as the server treats it: without extra numbers every
             * call and SMS goes out from the primary number.
             */
            required: false,
            collapsibleSection: advancedSection,
            description:
              "If you have bought more phone numbers from Twilio for specific countries, you can add them here.",
            placeholder: "+1234567890, +4444444444",
            customValidation: (
              values: FormValues<GlobalConfig>,
            ): string | null => {
              // Refused under the field, by the server's rule.
              return getPhoneNumberListError(
                values.twilioSecondaryPhoneNumbers,
              );
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
                twilioSmsPhoneNumbers: true,
              },
              title: "Twilio SMS Phone Numbers",
              fieldType: FieldType.LongText,
              // Without them, SMS go out from the numbers calls do.
              placeholder: t("pages.settings.callSms.smsSameAsCalls"),
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
