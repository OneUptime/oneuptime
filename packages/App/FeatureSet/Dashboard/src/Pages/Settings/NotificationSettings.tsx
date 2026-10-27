import CustomCallSMSTable from "../../Components/CallSMS/CallSMSConfigTable";
import CustomSMTPTable from "../../Components/CustomSMTP/CustomSMTPTable";
import {
  getOwnSendersFoldedItems,
  OWN_SENDERS_MORE_DESCRIPTION,
} from "../../Components/NotificationMethods/OwnSendersFold";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import ProjectNotificationChannelsCard from "../../Components/NotificationMethods/ProjectNotificationChannelsCard";
import {
  getCurrentProjectBillingMarketplace,
  getMarketplaceBalanceCardDescription,
  getProjectBalanceAccess,
  getProjectBalanceCardDescription,
  getRechargeBalanceButtons,
  ProjectBalanceAccess,
} from "../../Components/ProjectBalance/ProjectBalanceAccess";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import AutoRechargeFailedNotice from "../../Components/ProjectBalance/AutoRechargeFailedNotice";
import AutoRechargeCard from "../../Components/ProjectBalance/AutoRechargeCard";
import {
  CURRENT_BALANCE_ROW_TITLE,
  RECHARGE_AMOUNT_DESCRIPTION,
  RECHARGE_AMOUNT_TITLE,
} from "../../Components/ProjectBalance/ProjectBalanceCopy";
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
 * Project Settings -> Notifications -> Notification Settings: the balance SMS,
 * calls, WhatsApp and Telegram are paid from (billing only), the four channel
 * switches, Auto Recharge (billing only), and the project's own SMTP and Twilio
 * configs.
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
 *
 * The project's own mail servers and Twilio accounts - what a status page
 * sends its subscribers through, and what an incoming call policy answers
 * on, instead of OneUptime's - wait folded under More settings: most
 * projects never add one (Components/NotificationMethods/OwnSendersFold).
 */
export const NOTIFICATION_SETTINGS_MORE_TEST_ID: string =
  "notification-settings-more";

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
  // How many own mail servers and Twilio accounts there are, once listed.
  const [smtpConfigCount, setSmtpConfigCount] = useState<number>(0);
  const [twilioConfigCount, setTwilioConfigCount] = useState<number>(0);

  /*
   * Read on every render rather than remembered: the permission snapshot
   * arrives on a response header, and may land after the first paint.
   */
  const balanceAccess: ProjectBalanceAccess = getProjectBalanceAccess(
    ProjectBalanceType.SmsOrCall,
  );
  // A project a cloud marketplace bills has no card: its recharges go there.
  const billingMarketplace: CloudMarketplace | null =
    getCurrentProjectBillingMarketplace();
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
            description: billingMarketplace
              ? getMarketplaceBalanceCardDescription({
                  balance: ProjectBalanceType.SmsOrCall,
                  access: balanceAccess,
                  marketplace: billingMarketplace,
                  translator: translator,
                })
              : getProjectBalanceCardDescription(
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
                // The card's description says what the balance pays for.
                title: CURRENT_BALANCE_ROW_TITLE,
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
        <AutoRechargeCard
          balance={ProjectBalanceType.SmsOrCall}
          projectId={ProjectUtil.getCurrentProjectId()!}
          isEditable={autoRechargeGate.isEditable}
          lockedButtons={autoRechargeGate.lockedButtons}
          onSaveSuccess={() => {
            setAutoRechargeSaves(autoRechargeSaves + 1);
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
                title: RECHARGE_AMOUNT_TITLE,
                description: RECHARGE_AMOUNT_DESCRIPTION,
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

      <AdvancedPageSection
        description={OWN_SENDERS_MORE_DESCRIPTION}
        items={getOwnSendersFoldedItems({
          smtpConfigCount: smtpConfigCount,
          twilioConfigCount: twilioConfigCount,
        })}
        dataTestId={NOTIFICATION_SETTINGS_MORE_TEST_ID}
      >
        <CustomSMTPTable
          onCountChange={(count: number) => {
            setSmtpConfigCount(count);
          }}
        />
        <CustomCallSMSTable
          onCountChange={(count: number) => {
            setTwilioConfigCount(count);
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default Settings;
