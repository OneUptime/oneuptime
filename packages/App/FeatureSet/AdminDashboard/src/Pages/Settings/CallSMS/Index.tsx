import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import CallAndSmsGatewayCard from "./CallAndSmsGatewayCard";
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
import { PHONE_NUMBER_LIST_EXAMPLE } from "Common/Types/CallAndSMS/TwilioPhoneNumbers";
import TwilioConfigUses, {
  TwilioConfigUse,
} from "Common/Types/CallAndSMS/TwilioConfigUse";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * The numbers few installations need, folded under More fields below the
 * three values the Twilio console shows together: numbers to send SMS from,
 * for numbers that can only make calls (in some countries, national numbers
 * are voice-only and SMS need a mobile number), and the numbers bought for
 * other countries. Once SMS numbers are listed, every SMS goes out from one
 * of them (Common/Types/CallAndSMS/TwilioPhoneNumbers), as on a project's
 * own Twilio config.
 *
 * Its fields carry the titles, help and examples of the Dashboard's Twilio
 * Config form (CallSMSConfigTable), so the docs' one table of what goes
 * out from which field reads the same for the server's config as for a
 * project's. Like the Dashboard's, the help names no country and the
 * example is no one country's number: OneUptime is used worldwide.
 */
const advancedSection: FormFieldCollapsibleSection<GlobalConfig> =
  getAdvancedFormSection<GlobalConfig>();

/*
 * What the server's account is used for, asked first, as a project's
 * Twilio config asks it (Dashboard TwilioConfigUseCopy,
 * Common/Types/CallAndSMS/TwilioConfigUse): calls and SMS, SMS only or calls
 * only. Then only the numbers that answer takes, each required where it is
 * needed: the primary number for calls - with the SMS numbers folded beside
 * the secondary ones when it sends SMS too - or the SMS numbers alone, open
 * and required. A field whose help, fold or need follows the answer is
 * written once for each answer that shows it, with a showIf for that
 * answer alone: the form never shows two at once.
 *
 * An account used for one of the two sends nothing of the other: those go
 * only through the Twilio configs projects add themselves, which each
 * answer says.
 */
const usedFor: (
  ...uses: Array<TwilioConfigUse>
) => (values: FormValues<GlobalConfig>) => boolean = (
  ...uses: Array<TwilioConfigUse>
): ((values: FormValues<GlobalConfig>) => boolean) => {
  return (values: FormValues<GlobalConfig>): boolean => {
    return uses.includes(TwilioConfigUses.getUse(values.twilioUsedFor));
  };
};

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
      {/* What carries the server's SMS and calls: Twilio, or a gateway. */}
      <CallAndSmsGatewayCard />

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
              twilioUsedFor: true,
            },
            title: "Use This Account For",
            fieldType: FormFieldSchemaType.RadioButton,
            required: true,
            /*
             * Calls and SMS where nothing is stored, as every installation's
             * account was before the choice.
             */
            defaultValue: TwilioConfigUse.CallsAndSms,
            // Each answer says in one line what it means.
            hideColumnDescription: true,
            radioButtonOptions: [
              {
                title: "Calls and SMS",
                description: "Calls and SMS go out from this account.",
                value: TwilioConfigUse.CallsAndSms,
              },
              {
                title: "SMS only",
                description:
                  "This account makes no calls. Projects can make them through a Twilio config of their own.",
                value: TwilioConfigUse.SmsOnly,
              },
              {
                title: "Calls only",
                description:
                  "This account sends no SMS. Projects can send them through a Twilio config of their own.",
                value: TwilioConfigUse.CallsOnly,
              },
            ],
          },
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
            title: "Twilio Primary Phone Number",
            fieldType: FormFieldSchemaType.Phone,
            required: true,
            description:
              "Calls go out from this number, and SMS too unless you add SMS phone numbers under More fields.",
            placeholder: "+14155550100",
            validation: {
              minLength: 2,
            },
            showIf: usedFor(TwilioConfigUse.CallsAndSms),
          },
          {
            field: {
              twilioPrimaryPhoneNumber: true,
            },
            title: "Twilio Primary Phone Number",
            fieldType: FormFieldSchemaType.Phone,
            required: true,
            description: "Calls go out from this number.",
            placeholder: "+14155550100",
            validation: {
              minLength: 2,
            },
            showIf: usedFor(TwilioConfigUse.CallsOnly),
          },
          {
            field: {
              twilioSmsPhoneNumbers: true,
            },
            title: "Twilio SMS Phone Numbers",
            // One line: most lists hold one number or two.
            fieldType: FormFieldSchemaType.Text,
            // Used for SMS only, every SMS goes out from these: required, and open.
            required: true,
            description:
              "Every SMS goes out from one of these: the one in the recipient's country, or else the first.",
            // The list the error under the field gives: no one country's.
            placeholder: PHONE_NUMBER_LIST_EXAMPLE,
            customValidation: (
              values: FormValues<GlobalConfig>,
            ): string | null => {
              // Refused under the field, by the server's rule.
              return getPhoneNumberListError(values.twilioSmsPhoneNumbers);
            },
            showIf: usedFor(TwilioConfigUse.SmsOnly),
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
              "Numbers to send SMS from if yours can only make calls. Each SMS uses the one in the recipient's country, or the first.",
            // The list the error under the field gives: no one country's.
            placeholder: PHONE_NUMBER_LIST_EXAMPLE,
            customValidation: (
              values: FormValues<GlobalConfig>,
            ): string | null => {
              // Refused under the field, by the server's rule.
              return getPhoneNumberListError(values.twilioSmsPhoneNumbers);
            },
            showIf: usedFor(TwilioConfigUse.CallsAndSms),
          },
          {
            field: {
              twilioSecondaryPhoneNumbers: true,
            },
            title: "Twilio Secondary Phone Numbers",
            fieldType: FormFieldSchemaType.Text,
            /*
             * Optional, as the server treats it: without extra numbers every
             * call and SMS goes out from the primary number.
             */
            required: false,
            collapsibleSection: advancedSection,
            description:
              "Numbers to use instead of the primary one when they match the recipient's country code.",
            placeholder: "+441234567890, +461234567890",
            customValidation: (
              values: FormValues<GlobalConfig>,
            ): string | null => {
              // Refused under the field, by the server's rule.
              return getPhoneNumberListError(
                values.twilioSecondaryPhoneNumbers,
              );
            },
            showIf: usedFor(
              TwilioConfigUse.CallsAndSms,
              TwilioConfigUse.CallsOnly,
            ),
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config",
          fields: [
            {
              // What the account is used for, as the form's first answer names it.
              field: {
                twilioUsedFor: true,
              },
              title: "Used For",
              fieldType: FieldType.Element,
              getElement: (item: GlobalConfig): ReactElement => {
                switch (TwilioConfigUses.getUse(item.twilioUsedFor)) {
                  case TwilioConfigUse.SmsOnly:
                    return <span>{t("SMS only")}</span>;
                  case TwilioConfigUse.CallsOnly:
                    return <span>{t("Calls only")}</span>;
                  default:
                    return <span>{t("Calls and SMS")}</span>;
                }
              },
            },
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
              title: "Twilio Primary Phone Number",
              fieldType: FieldType.Phone,
              placeholder: t("common.none"),
              // An account used for SMS only makes no calls, from any number.
              showIf: (item: GlobalConfig): boolean => {
                return TwilioConfigUses.makesCalls(item.twilioUsedFor);
              },
            },
            {
              field: {
                twilioSmsPhoneNumbers: true,
              },
              title: "Twilio SMS Phone Numbers",
              fieldType: FieldType.LongText,
              // Without them, SMS go out from the numbers calls do.
              placeholder: t("pages.settings.callSms.smsSameAsCalls"),
              // An account used for calls only sends no SMS, from any number.
              showIf: (item: GlobalConfig): boolean => {
                return TwilioConfigUses.sendsSms(item.twilioUsedFor);
              },
            },
            {
              field: {
                twilioSecondaryPhoneNumbers: true,
              },
              title: "Twilio Secondary Phone Numbers",
              fieldType: FieldType.LongText,
              placeholder: t("common.none"),
              showIf: (item: GlobalConfig): boolean => {
                return TwilioConfigUses.makesCalls(item.twilioUsedFor);
              },
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;
