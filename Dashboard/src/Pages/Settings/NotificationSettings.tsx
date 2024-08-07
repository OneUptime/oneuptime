import CustomCallSMSTable from "../../Components/CallSMS/CallSMSConfigTable";
import CustomSMTPTable from "../../Components/CustomSMTP/CustomSMTPTable";
import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
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

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showRechargeBalanceModal, setShowRechargeBalanceModal] =
    useState<boolean>(false);
  const [isRechargeBalanceLoading, setIsRechargeBalanceLoading] =
    useState<boolean>(false);
  const [rechargeBalanceError, setRechargeBalanceError] = useState<
    string | null
  >(null);

  return (
    <Fragment>
      {/* API Key View  */}
      {BILLING_ENABLED ? (
        <CardModelDetail
          name="Current Balance"
          cardProps={{
            title: "Current Balance",
            description:
              "Here is your current call and SMS balance for this project.",
            buttons: [
              {
                title: "Recharge Balance",
                icon: IconProp.Add,
                onClick: () => {
                  setShowRechargeBalanceModal(true);
                  setRechargeBalanceError(null);
                  setIsRechargeBalanceLoading(false);
                },
              },
            ],
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
                title: "SMS or Call Current Balance",
                description:
                  "This is your current balance for SMS or Call. It is in USD. ",
                placeholder: "0 USD",
              },
            ],
            modelId: DashboardNavigation.getProjectId()!,
          }}
        />
      ) : (
        <></>
      )}

      <CardModelDetail
        name="Enable Notifications"
        cardProps={{
          title: "Enable Notifications",
          description: "Enable Call and SMS notifications for this project.",
        }}
        isEditable={true}
        editButtonText="Edit Notification Settings"
        formFields={[
          {
            field: {
              enableCallNotifications: true,
            },
            title: "Enable Call Notifications",
            description:
              "Enable Call notifications for this project. This will be used for alerting users by phone call.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              enableSmsNotifications: true,
            },
            title: "Enable SMS Notifications",
            description:
              "Enable SMS notifications for this project. This will be used for alerting users by sending an SMS.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "notifications",
          fields: [
            {
              field: {
                enableCallNotifications: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable Call Notifications",
              placeholder: "Not Enabled",
              description:
                "Enable Call notifications for this project. This will be used for alerting users by phone call.",
            },
            {
              field: {
                enableSmsNotifications: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable SMS Notifications",
              placeholder: "Not Enabled",
              description:
                "Enable SMS notifications for this project. This will be used for alerting users by SMS.",
            },
          ],
          modelId: DashboardNavigation.getProjectId()!,
        }}
      />

      {BILLING_ENABLED ? (
        <CardModelDetail
          name="Auto Recharge"
          cardProps={{
            title: "Auto Recharge",
            description:
              "Enable Auto Recharge for call and SMS balance. This will make sure you always have enough balance for sending SMS or making calls.",
          }}
          isEditable={true}
          editButtonText="Edit Auto Recharge"
          formFields={[
            {
              field: {
                enableAutoRechargeSmsOrCallBalance: true,
              },
              title: "Enable Auto Recharge",
              description:
                "Enable Auto Recharge. This will be used for sending an SMS or Call.",
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
            modelId: DashboardNavigation.getProjectId()!,
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
                await API.post(
                  URL.fromString(APP_API_URL.toString()).addRoute(
                    "/notification/recharge",
                  ),
                  {
                    amount: item["amount"],
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                  },
                );

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
