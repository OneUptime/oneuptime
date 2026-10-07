import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import {
  getProjectBalanceAccess,
  getProjectBalanceCardDescription,
  getRechargeBalanceButtons,
  ProjectBalanceAccess,
} from "../../Components/ProjectBalance/ProjectBalanceAccess";
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
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
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

/*
 * Project Settings -> AI Credits (listed only where billing is on): the
 * balance OneUptime AI is paid from on the OneUptime-hosted provider, and
 * its Auto Recharge.
 *
 * Only a project owner or someone with Manage Billing may add AI credits or
 * change Auto Recharge (Common/Utils/Project/ProjectBalance). So the balance
 * card asks them to recharge it and offers the button; everyone else is
 * told who can, and the button stays locked, saying why - it used to open a
 * form whose save the server then refused. Auto Recharge's Edit is gated on
 * its own columns rather than the Project table's wider update list, for
 * the same reason.
 */
const AIBillingSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [showRechargeBalanceModal, setShowRechargeBalanceModal] =
    useState<boolean>(false);
  const [isRechargeBalanceLoading, setIsRechargeBalanceLoading] =
    useState<boolean>(false);
  const [rechargeBalanceError, setRechargeBalanceError] = useState<
    string | null
  >(null);

  /*
   * Read on every render rather than remembered: the permission snapshot
   * arrives on a response header, and may land after the first paint.
   */
  const balanceAccess: ProjectBalanceAccess = getProjectBalanceAccess(
    ProjectBalanceType.AI,
  );
  const autoRechargeGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: [...PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[ProjectBalanceType.AI]],
    buttonTitle: "Edit Auto Recharge",
  });

  return (
    <Fragment>
      {/* Current Balance */}
      <CardModelDetail
        name="Current Balance"
        cardProps={{
          title: "Current Balance",
          description: getProjectBalanceCardDescription(
            ProjectBalanceType.AI,
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

      {/*
       * Enable AI moved to Project Settings → AI Features
       * (Pages/Settings/AIFeatures), which every install shows. This page is
       * listed only when billing is on, so it keeps the balance and recharge
       * settings alone.
       */}
      {/* Auto Recharge */}
      <CardModelDetail
        name="Auto Recharge"
        cardProps={{
          title: "Auto Recharge",
          description:
            "Enable Auto Recharge for AI balance. This will make sure you always have enough balance for AI services.",
          buttons: autoRechargeGate.lockedButtons,
        }}
        isEditable={autoRechargeGate.isEditable}
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
              description: "Enable auto recharge for AI balance.",
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
