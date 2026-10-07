import CustomCallSMSTable from "../../Components/CallSMS/CallSMSConfigTable";
import CustomSMTPTable from "../../Components/CustomSMTP/CustomSMTPTable";
import ProjectNotificationChannelsCard from "../../Components/NotificationMethods/ProjectNotificationChannelsCard";
import {
  getProjectBalanceAccess,
  getProjectBalanceCardDescription,
  getRechargeBalanceButtons,
  ProjectBalanceAccess,
} from "../../Components/ProjectBalance/ProjectBalanceAccess";
import AutoRechargeFailedNotice from "../../Components/ProjectBalance/AutoRechargeFailedNotice";
import {
  getProjectColumnsEditGate,
  ProjectColumnsEditGate,
} from "./ProjectColumnEditGate";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Project Settings -> Notification Settings: the balance SMS, calls,
 * WhatsApp and Telegram are paid from (billing only), the four channel
 * switches, Auto Recharge (billing only), and the project's own SMTP and
 * Twilio configs.
 *
 * Only a project owner or someone with Manage Billing may add to the
 * balance or change Auto Recharge (Common/Utils/Project/ProjectBalance). So
 * the balance card asks them to recharge it and offers the button; everyone
 * else is told who can, and the button stays locked, saying why - it used
 * to open a form whose save the server then refused. Auto Recharge's Edit is
 * gated on its own columns rather than the Project table's wider update
 * list, for the same reason.
 *
 * When Auto Recharge's last charge failed, the page says so first
 * (AutoRechargeFailedNotice), with what to do or who can.
 */
const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [showRechargeBalanceModal, setShowRechargeBalanceModal] =
    useState<boolean>(false);
  const [isRechargeBalanceLoading, setIsRechargeBalanceLoading] =
    useState<boolean>(false);
  const [rechargeBalanceError, setRechargeBalanceError] = useState<
    string | null
  >(null);
  // Saving Auto Recharge tries the card at once: ask again whether it failed.
  const [autoRechargeSaves, setAutoRechargeSaves] = useState<number>(0);

  /*
   * Read on every render rather than remembered: the permission snapshot
   * arrives on a response header, and may land after the first paint.
   */
  const balanceAccess: ProjectBalanceAccess = getProjectBalanceAccess(
    ProjectBalanceType.SmsOrCall,
  );
  const autoRechargeGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: [
      ...PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[ProjectBalanceType.SmsOrCall],
    ],
    buttonTitle: "Edit Auto Recharge",
  });

  return (
    <Fragment>
      {BILLING_ENABLED ? (
        <AutoRechargeFailedNotice
          balance={ProjectBalanceType.SmsOrCall}
          access={balanceAccess}
          refreshKey={autoRechargeSaves}
        />
      ) : (
        <></>
      )}

      {BILLING_ENABLED ? (
        <CardModelDetail
          name="Current Balance"
          cardProps={{
            title: "Current Balance",
            description: getProjectBalanceCardDescription(
              ProjectBalanceType.SmsOrCall,
              balanceAccess,
            ),
            buttons: getRechargeBalanceButtons({
              access: balanceAccess,
              translator: translator,
              onRecharge: () => {
                setShowRechargeBalanceModal(true);
                setRechargeBalanceError(null);
                setIsRechargeBalanceLoading(false);
              },
            }),
          }}
          isEditable={false}
          modelDetailProps={{
            modelType: Project,
            id: "current-balance",
            fields: [
              {
                field: {
                  smsOrCallCurrentBalanceInUSDCents: true,
                },
                fieldType: FieldType.USDCents,
                title: "SMS, Call, WhatsApp, and Telegram Current Balance",
                description:
                  "This is your current balance for SMS, Call, WhatsApp, and Telegram. It is in USD. ",
                placeholder: "0 USD",
              },
            ],
            modelId: ProjectUtil.getCurrentProjectId()!,
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * SMS, calls, WhatsApp and Telegram: one switch each, saved the
       * moment it is flipped.
       */}
      <ProjectNotificationChannelsCard />

      {BILLING_ENABLED ? (
        <CardModelDetail
          name="Auto Recharge"
          cardProps={{
            title: "Auto Recharge",
            description:
              "Enable Auto Recharge for SMS, Call, and WhatsApp balance. This will make sure you always have enough balance for sending notifications.",
            buttons: autoRechargeGate.lockedButtons,
          }}
          isEditable={autoRechargeGate.isEditable}
          editButtonText="Edit Auto Recharge"
          onSaveSuccess={() => {
            setAutoRechargeSaves(autoRechargeSaves + 1);
          }}
          formFields={[
            {
              field: {
                enableAutoRechargeSmsOrCallBalance: true,
              },
              title: "Enable Auto Recharge",
              description:
                "Enable Auto Recharge. This will be used for sending an SMS, Call, or WhatsApp message.",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
            {
              field: {
                autoRechargeSmsOrCallByBalanceInUSD: true,
              },
              title: "Auto Recharge Balance by (in USD)",
              description:
                "Amount of balance to be recharged when the balance is low. It is in USD. ",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: [
                {
                  value: 10,
                  label: "10 USD",
                },
                {
                  value: 20,
                  label: "20 USD",
                },
                {
                  value: 25,
                  label: "25 USD",
                },
                {
                  value: 50,
                  label: "50 USD",
                },
                {
                  value: 75,
                  label: "75 USD",
                },
                {
                  value: 100,
                  label: "100 USD",
                },
                {
                  value: 200,
                  label: "200 USD",
                },
                {
                  value: 500,
                  label: "500 USD",
                },
                {
                  value: 500,
                  label: "500 USD",
                },
                {
                  value: 1000,
                  label: "1000 USD",
                },
              ],
              required: true,
            },
            {
              field: {
                autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
              },
              title: "Auto Recharge when balance falls to (in USD)",
              description:
                "Trigger auto recharge when balance falls to this amount. It is in USD. ",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: [
                {
                  value: 10,
                  label: "10 USD",
                },
                {
                  value: 20,
                  label: "20 USD",
                },
                {
                  value: 25,
                  label: "25 USD",
                },
                {
                  value: 50,
                  label: "50 USD",
                },
                {
                  value: 75,
                  label: "75 USD",
                },
                {
                  value: 100,
                  label: "100 USD",
                },
                {
                  value: 200,
                  label: "200 USD",
                },
                {
                  value: 500,
                  label: "500 USD",
                },
                {
                  value: 500,
                  label: "500 USD",
                },
                {
                  value: 1000,
                  label: "1000 USD",
                },
              ],
              required: true,
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "notifications",
            fields: [
              {
                field: {
                  enableAutoRechargeSmsOrCallBalance: true,
                },
                fieldType: FieldType.Boolean,
                title: "Auto Recharge Balance by (in USD)",
                description:
                  "Amount of balance to be recharged when the balance is low. It is in USD. ",
                placeholder: "Not Enabled",
              },
              {
                field: {
                  autoRechargeSmsOrCallByBalanceInUSD: true,
                },
                fieldType: FieldType.Text,
                title: "Auto Recharge by (in USD)",
                placeholder: "0 USD",
              },
              {
                field: {
                  autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
                },
                fieldType: FieldType.Text,
                title: "Trigger auto recharge if balance falls below (in USD)",
                placeholder: "0 USD",
              },
            ],
            modelId: ProjectUtil.getCurrentProjectId()!,
          }}
        />
      ) : (
        <></>
      )}

      {showRechargeBalanceModal ? (
        <BasicFormModal
          title={"Recharge Balance"}
          onClose={() => {
            setShowRechargeBalanceModal(false);
          }}
          isLoading={isRechargeBalanceLoading}
          submitButtonText={"Recharge"}
          onSubmit={async (item: JSONObject) => {
            setIsRechargeBalanceLoading(true);
            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/notification/recharge",
                  ),
                  data: {
                    amount: item["amount"],
                    projectId: ProjectUtil.getCurrentProjectId()!,
                  },
                });

              if (response.isFailure()) {
                setRechargeBalanceError(API.getFriendlyMessage(response));
                setIsRechargeBalanceLoading(false);
              } else {
                setIsRechargeBalanceLoading(false);
                setShowRechargeBalanceModal(false);
                Navigation.reload();
              }
            } catch (e) {
              setRechargeBalanceError(API.getFriendlyMessage(e));
              setIsRechargeBalanceLoading(false);
            }
          }}
          formProps={{
            name: "Recharge Balance",
            error: rechargeBalanceError || "",
            fields: [
              {
                title: "Amount (in USD)",
                description: `Please enter the amount to recharge. It is in USD.`,
                field: {
                  amount: true,
                },
                placeholder: "100",
                required: true,
                validation: {
                  minValue: 20,
                  maxValue: 1000,
                },
                fieldType: FormFieldSchemaType.Number,
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      <CustomSMTPTable />
      <CustomCallSMSTable />
    </Fragment>
  );
};

export default Settings;
