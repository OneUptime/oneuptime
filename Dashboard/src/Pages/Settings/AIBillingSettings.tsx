import ProjectUtil from "Common/UI/Utils/Project";
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
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const AIBillingSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showRechargeBalanceModal, setShowRechargeBalanceModal] =
    useState<boolean>(false);
  const [isRechargeBalanceLoading, setIsRechargeBalanceLoading] =
    useState<boolean>(false);
  const [rechargeBalanceError, setRechargeBalanceError] = useState<
    string | null
  >(null);

  return (
    <Fragment>
      {/* Current Balance */}
      <CardModelDetail
        name="Current Balance"
        cardProps={{
          title: "Current Balance",
          description:
            "Here is your current AI balance for this project.",
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
          id: "ai-current-balance",
          fields: [
            {
              field: {
                aiCurrentBalanceInUSDCents: true,
              },
              fieldType: FieldType.USDCents,
              title: "AI Current Balance",
              description:
                "This is your current balance for AI services. It is in USD.",
              placeholder: "0 USD",
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />

      {/* Enable AI */}
      <CardModelDetail
        name="Enable AI"
        cardProps={{
          title: "Enable AI",
          description: "Enable AI services for this project.",
        }}
        isEditable={true}
        editButtonText="Edit AI Settings"
        formFields={[
          {
            field: {
              enableAi: true,
            },
            title: "Enable AI",
            description:
              "Enable AI services for this project. This allows the use of AI features like copilot, automatic improvements, and more.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "enable-ai",
          fields: [
            {
              field: {
                enableAi: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable AI",
              placeholder: "Not Enabled",
              description:
                "Enable AI services for this project.",
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />

      {/* Auto Recharge */}
      <CardModelDetail
        name="Auto Recharge"
        cardProps={{
          title: "Auto Recharge",
          description:
            "Enable Auto Recharge for AI balance. This will make sure you always have enough balance for AI services.",
        }}
        isEditable={true}
        editButtonText="Edit Auto Recharge"
        formFields={[
          {
            field: {
              enableAutoRechargeAiBalance: true,
            },
            title: "Enable Auto Recharge",
            description:
              "Enable Auto Recharge. This will automatically recharge your AI balance when it falls below a threshold.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              autoAiRechargeByBalanceInUSD: true,
            },
            title: "Auto Recharge Balance by (in USD)",
            description:
              "Amount of balance to be recharged when the balance is low. It is in USD.",
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
                value: 1000,
                label: "1000 USD",
              },
            ],
            required: true,
          },
          {
            field: {
              autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
            },
            title: "Auto Recharge when balance falls to (in USD)",
            description:
              "Trigger auto recharge when balance falls to this amount. It is in USD.",
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
                value: 1000,
                label: "1000 USD",
              },
            ],
            required: true,
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "ai-auto-recharge",
          fields: [
            {
              field: {
                enableAutoRechargeAiBalance: true,
              },
              fieldType: FieldType.Boolean,
              title: "Auto Recharge Enabled",
              description:
                "Enable auto recharge for AI balance.",
              placeholder: "Not Enabled",
            },
            {
              field: {
                autoAiRechargeByBalanceInUSD: true,
              },
              fieldType: FieldType.Text,
              title: "Auto Recharge by (in USD)",
              placeholder: "0 USD",
            },
            {
              field: {
                autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
              },
              fieldType: FieldType.Text,
              title: "Trigger auto recharge if balance falls below (in USD)",
              placeholder: "0 USD",
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />

      {showRechargeBalanceModal ? (
        <BasicFormModal
          title={"Recharge AI Balance"}
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
                    "/ai/recharge",
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
            name: "Recharge AI Balance",
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
    </Fragment>
  );
};

export default AIBillingSettings;
