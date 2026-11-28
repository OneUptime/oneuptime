import CustomCallSMSTable from "../../Components/CallSMS/CallSMSConfigTable";
import CustomSMTPTable from "../../Components/CustomSMTP/CustomSMTPTable";
import { getOwnSendersFoldedItems } from "../../Components/NotificationMethods/OwnSendersFold";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import ProjectNotificationChannelsCard from "../../Components/NotificationMethods/ProjectNotificationChannelsCard";
import DefaultPagingLadderCard from "../../Components/NotificationRule/PagingLadder/DefaultPagingLadderCard";
import PhoneForOnCallCard from "../../Components/NotificationRule/PagingLadder/PhoneForOnCallCard";
import VoicemailDetectionCard from "../../Components/NotificationMethods/VoicemailDetectionCard";
import ProjectCallVoiceCard from "../../Components/NotificationMethods/ProjectCallVoiceCard";
import { getProjectCallVoiceFoldedItem } from "../../Components/NotificationMethods/ProjectCallVoiceWords";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "Common/UI/Utils/GlobalConfig";
import { getVoicemailDetectionFoldedItem } from "../../Components/NotificationMethods/VoicemailDetectionWords";
import { getProjectPagingDefaultsFoldedItems } from "../../Components/NotificationRule/PagingLadder/ProjectPagingDefaultsWords";
import {
  getAddToBalanceAmountDescription,
  getCurrentProjectBillingMarketplace,
  getMarketplaceBalanceCardDescription,
  getProjectBalanceAccess,
  getProjectBalanceCardDescription,
  getRechargeBalanceButtons,
  isPaymentMethodNeededFirst,
  ProjectBalanceAccess,
} from "../../Components/ProjectBalance/ProjectBalanceAccess";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import AddPaymentMethodFirstModal from "../../Components/ProjectBalance/AddPaymentMethodFirstModal";
import AutoRechargeFailedNotice from "../../Components/ProjectBalance/AutoRechargeFailedNotice";
import {
  ProjectPaymentMethodsState,
  useProjectPaymentMethods,
} from "../../Utils/ProjectPaymentMethods";
import AutoRechargeCard from "../../Components/ProjectBalance/AutoRechargeCard";
import {
  ADD_TO_BALANCE_AMOUNT_TITLE,
  ADD_TO_BALANCE_TITLE,
  CURRENT_BALANCE_ROW_TITLE,
} from "../../Components/ProjectBalance/ProjectBalanceCopy";
import {
  getProjectColumnsEditGate,
  ProjectColumnsEditGate,
} from "./ProjectColumnEditGate";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
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
  useEffect,
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
 * On a project known to have no payment method, and no cloud marketplace
 * billing it, Add to Balance says a payment method is needed first, and
 * where it is added, before it asks for an amount (AddPaymentMethodFirstModal,
 * #11053).
 *
 * The project's own mail servers and Twilio accounts - what a status page
 * sends its subscribers through, and what an incoming call policy answers
 * on, instead of OneUptime's - wait folded under More settings: most
 * projects never add one (Components/NotificationMethods/OwnSendersFold).
 * So do how members are paged by default (#7449): the project's default
 * ladder for new members, and its ask for a phone method from everyone on
 * call (Components/NotificationRule/PagingLadder/DefaultPagingLadderCard and
 * PhoneForOnCallCard) - first, as what an on-call admin comes for - and
 * whether its on-call calls tell a voicemail from a person answering
 * (#6594, VoicemailDetectionCard), on for every project. Each is a card of
 * its own module, so the card-in-card guard reads it as a whole card drawn
 * as a section of the fold (#9464).
 */
export const NOTIFICATION_SETTINGS_MORE_TEST_ID: string =
  "notification-settings-more";

// What the fold holds, under its title once open.
export const NOTIFICATION_SETTINGS_MORE_DESCRIPTION: string = translationKey(
  "How members are paged by default, and your own mail servers and Twilio accounts.",
);

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [showRechargeBalanceModal, setShowRechargeBalanceModal] =
    useState<boolean>(false);
  const [isRechargeBalanceLoading, setIsRechargeBalanceLoading] =
    useState<boolean>(false);
  const [rechargeBalanceError, setRechargeBalanceError] = useState<
    string | null
  >(null);
  // Add to Balance pressed on a project with no payment method (#11053).
  const [showAddPaymentMethodFirst, setShowAddPaymentMethodFirst] =
    useState<boolean>(false);
  // Saving Auto Recharge tries the card at once: ask again whether it failed.
  const [autoRechargeSaves, setAutoRechargeSaves] = useState<number>(0);
  // How many own mail servers and Twilio accounts there are, once listed.
  const [smtpConfigCount, setSmtpConfigCount] = useState<number>(0);
  const [twilioConfigCount, setTwilioConfigCount] = useState<number>(0);
  // The default ladder's steps, and whether a phone is asked for, once read.
  const [defaultStepCount, setDefaultStepCount] = useState<number>(0);
  const [isPhoneAsked, setIsPhoneAsked] = useState<boolean>(false);
  // Whether on-call calls tell voicemail apart, once read: on, as projects start.
  const [isDetectingVoicemail, setIsDetectingVoicemail] =
    useState<boolean>(true);
  /*
   * Whether the server lets projects choose their call voice (#11065):
   * never on OneUptime Cloud. Not offered until the server says so.
   */
  const [canChooseCallVoice, setCanChooseCallVoice] = useState<boolean>(false);
  // The voice the project chose, once read: none, the server's.
  const [projectCallVoice, setProjectCallVoice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted: boolean = true;

    GlobalConfigUtil.fetchVars()
      .then((vars: GlobalConfigVars) => {
        if (isMounted) {
          setCanChooseCallVoice(vars.canProjectsChooseCallVoice === true);
        }
      })
      .catch(() => {
        // Not offered: the server refuses a voice it does not offer anyway.
      });

    return () => {
      isMounted = false;
    };
  }, []);

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
  // Whether the project has a payment method, once counted (no request here).
  const paymentMethods: ProjectPaymentMethodsState = useProjectPaymentMethods();
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
                // No payment method yet: say so before asking for an amount.
                if (
                  isPaymentMethodNeededFirst({
                    paymentMethods: paymentMethods,
                    marketplace: billingMarketplace,
                  })
                ) {
                  setShowAddPaymentMethodFirst(true);
                  return;
                }

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

      {showAddPaymentMethodFirst ? (
        <AddPaymentMethodFirstModal
          balance={ProjectBalanceType.SmsOrCall}
          onClose={() => {
            setShowAddPaymentMethodFirst(false);
          }}
        />
      ) : (
        <></>
      )}

      {showRechargeBalanceModal ? (
        <BasicFormModal
          // One verb from the card's button to the dialog's (#7475).
          title={ADD_TO_BALANCE_TITLE}
          onClose={() => {
            setShowRechargeBalanceModal(false);
          }}
          isLoading={isRechargeBalanceLoading}
          submitButtonText={ADD_TO_BALANCE_TITLE}
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
            name: ADD_TO_BALANCE_TITLE,
            error: rechargeBalanceError || "",
            fields: [
              {
                title: ADD_TO_BALANCE_AMOUNT_TITLE,
                /*
                 * What the money is for and where it is charged, in the
                 * reader's words already: an element, which the form's
                 * label draws as given.
                 */
                description: (
                  <>
                    {getAddToBalanceAmountDescription({
                      balance: ProjectBalanceType.SmsOrCall,
                      marketplace: billingMarketplace,
                      translator: translator,
                    })}
                  </>
                ),
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
        description={NOTIFICATION_SETTINGS_MORE_DESCRIPTION}
        items={[
          ...getProjectPagingDefaultsFoldedItems({
            defaultStepCount: defaultStepCount,
            isPhoneAsked: isPhoneAsked,
          }),
          getVoicemailDetectionFoldedItem(isDetectingVoicemail),
          ...(canChooseCallVoice
            ? [getProjectCallVoiceFoldedItem(projectCallVoice)]
            : []),
          ...getOwnSendersFoldedItems({
            smtpConfigCount: smtpConfigCount,
            twilioConfigCount: twilioConfigCount,
          }),
        ]}
        dataTestId={NOTIFICATION_SETTINGS_MORE_TEST_ID}
      >
        <DefaultPagingLadderCard
          projectId={ProjectUtil.getCurrentProjectId()!}
          onStepCountChange={(count: number) => {
            setDefaultStepCount(count);
          }}
        />
        <PhoneForOnCallCard
          projectId={ProjectUtil.getCurrentProjectId()!}
          onChange={(isOn: boolean) => {
            setIsPhoneAsked(isOn);
          }}
        />
        <VoicemailDetectionCard
          projectId={ProjectUtil.getCurrentProjectId()!}
          onChange={(isOn: boolean) => {
            setIsDetectingVoicemail(isOn);
          }}
        />
        {canChooseCallVoice ? (
          <ProjectCallVoiceCard
            projectId={ProjectUtil.getCurrentProjectId()!}
            onChange={(voice: string | null) => {
              setProjectCallVoice(voice);
            }}
          />
        ) : (
          <></>
        )}
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
