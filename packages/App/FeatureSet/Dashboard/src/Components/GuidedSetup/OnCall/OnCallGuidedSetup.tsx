import OnCallSetupApi, {
  MyReach,
  PolicyChoiceFacts,
  ProjectPhoneFacts,
  maySecondEscalationLevel,
} from "./OnCallSetupApi";
import {
  CALL_METHOD_TYPE,
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  DEFAULT_REPEAT_TIMES,
  EMAIL_METHOD_TYPE,
  NoAnswerChoice,
  ON_CALL_POLICY_NAME,
  ON_CALL_SETUP,
  ON_CALL_SETUP_COPY,
  ON_CALL_SETUP_GUIDE_DOCS_PATH,
  OnCallPolicyRecord,
  OnCallProgressFacts,
  OnCallRunValue,
  OnCallSetupStep,
  OnCallSummaryRow,
  PHONE_BALANCE_FLOOR_IN_USD_CENTS,
  PUSH_METHOD_TYPE,
  PhoneChannelFacts,
  PolicyLevel,
  ReachMethod,
  ResponderReach,
  SMS_METHOD_TYPE,
  canAddPhone,
  describeFirstLevel,
  describeResponder,
  formatUsdCents,
  getDefaultNoAnswerChoice,
  getMissingRuleKinds,
  getOnCallProgress,
  getOnCallSummaryRows,
  getPhoneBreaks,
  getPolicyBreaks,
  getVerifiedMethodsOfType,
  isOnCallSetupFinished,
  isPhoneBalanceTooLow,
  isServerWithoutTwilio,
  parsePhoneNumber,
  parseRepeatTimes,
  parseWaitMinutes,
} from "./OnCallSetup";
import GuidedSetupFrame, { GuidedSetupFrameStep } from "../GuidedSetupFrame";
import GuidedSetupRunStore, {
  GuidedSetupRun,
  getFirstOpenStepKey,
} from "../GuidedSetupProgress";
import AppLink from "../../AppLink/AppLink";
import {
  getBreakSentence,
  getChannelName,
} from "../../Monitor/Overview/WhoIsToldWords";
import {
  canChangeProjectNotificationChannels,
  isKnownNotToChangeProjectNotificationChannels,
} from "../../NotificationMethods/ProjectNotificationChannels";
import {
  ChannelGatedMethodList,
  ProjectNotificationChannel,
  getChannelGatedMethodList,
} from "../../NotificationMethods/ProjectNotificationChannelsCopy";
import VerificationCodeModal from "../../NotificationMethods/VerificationCodeModal";
import { VerificationCodeChannel } from "../../NotificationMethods/VerificationCodeChannels";
import {
  SetupReminderStatus,
  SetupReminderStatuses,
} from "../../OnCallPolicy/EscalationRule/EscalationRuleReadiness";
import OnCallTestPageApi from "../../OnCallTestPage/OnCallTestPageApi";
import SendTestPageButton from "../../OnCallTestPage/SendTestPageButton";
import TestPageResult, {
  getResultSentence,
} from "../../OnCallTestPage/TestPageResult";
import {
  canAddProjectBalance,
  getCurrentProjectBillingMarketplace,
} from "../../ProjectBalance/ProjectBalanceAccess";
import {
  RECHARGE_AMOUNT_DESCRIPTION,
  RECHARGE_AMOUNT_TITLE,
} from "../../ProjectBalance/ProjectBalanceCopy";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  ServerEmail,
  cannotSendEmail,
  getAdminServerSetupUrl,
  useServerEmail,
} from "../../../Utils/ServerEmail";
import Route from "Common/Types/API/Route";
import ProjectBalanceType from "Common/Types/Billing/ProjectBalanceType";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldFix,
  WhoIsToldServerChannel,
  makeWhoIsToldBreak,
} from "Common/Types/Monitor/WhoIsTold";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "Common/Types/ServerSending/ServerSendingStatus";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import LazyPeoplePicker from "Common/UI/Components/PeoplePicker/LazyPeoplePicker";
import {
  PeoplePickerKind,
  PeoplePickerValue,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import GroupRadioButtons from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { useServerSendingStatus } from "Common/UI/Utils/ServerSending";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * GUIDED SETUP: PAGE THE RIGHT PERSON, AND ESCALATE (issue #6805), drawn
 * in GuidedSetupFrame. The rules and words are OnCallSetup.ts; the records
 * OnCallSetupApi.ts.
 */

const routeOf: (page: PageMap, modelId?: string | undefined) => Route = (
  page: PageMap,
  modelId?: string | undefined,
): Route => {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: modelId,
  });
};

// A row of the step's actions, lined up with the words above (as #6804's).
const ACTIONS_CLASS_NAME: string =
  "flex flex-wrap items-center gap-y-2 md:-ml-3";

const linkClassName: string =
  "text-sm font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline";

const NOT_KNOWN_PHONE_FACTS: ProjectPhoneFacts = {
  isSmsOn: null,
  isCallOn: null,
  balanceInUSDCents: null,
};

// Whether the server can send on a channel, as a master admin reads it.
const canServerSend: (
  status: ServerSendingStatusAnswer | null,
  channel: ServerSendingChannel,
) => boolean | null = (
  status: ServerSendingStatusAnswer | null,
  channel: ServerSendingChannel,
): boolean | null => {
  const entry: ServerChannelStatus | undefined = status?.channels.find(
    (candidate: ServerChannelStatus): boolean => {
      return candidate.channel === channel;
    },
  );

  if (!entry) {
    return null;
  }

  return entry.state !== ServerSendingState.NotSetUp;
};

const pickedIds: (
  value: PeoplePickerValue,
  kind: PeoplePickerKind,
) => Array<string> = (
  value: PeoplePickerValue,
  kind: PeoplePickerKind,
): Array<string> => {
  return value[kind] || [];
};

const OnCallGuidedSetup: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const serverEmail: ServerEmail = useServerEmail();
  const sendingStatus: ServerSendingStatusAnswer | null =
    useServerSendingStatus();
  const userId: string = UserUtil.getUserId()?.toString() || "";

  const store: GuidedSetupRunStore = useMemo(() => {
    return new GuidedSetupRunStore({
      setup: ON_CALL_SETUP,
      projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
      userId: userId,
    });
  }, [userId]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [run, setRun] = useState<GuidedSetupRun>({});
  const [reach, setReach] = useState<MyReach | null>(null);
  const [phoneFacts, setPhoneFacts] = useState<ProjectPhoneFacts>(
    NOT_KNOWN_PHONE_FACTS,
  );
  const [choices, setChoices] = useState<PolicyChoiceFacts | null>(null);
  const [policy, setPolicy] = useState<OnCallPolicyRecord | null>(null);
  const [responders, setResponders] = useState<Array<ResponderReach>>([]);
  const [testResult, setTestResult] = useState<OnCallTestPageResult | null>(
    null,
  );
  const [openStepKey, setOpenStepKey] = useState<string | null>(
    OnCallSetupStep.ReachYou,
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  // Step 1.
  const [phoneText, setPhoneText] = useState<string>("");
  const [phoneError, setPhoneError] = useState<string>("");
  const [verifying, setVerifying] = useState<{
    id: string;
    phone: string;
  } | null>(null);
  const [reachError, setReachError] = useState<string>("");
  const [showRecharge, setShowRecharge] = useState<boolean>(false);
  const [isRecharging, setIsRecharging] = useState<boolean>(false);
  const [rechargeError, setRechargeError] = useState<string>("");

  // Step 2: you, to start with.
  const [people, setPeople] = useState<PeoplePickerValue>({
    [PeoplePickerKind.User]: userId ? [userId] : [],
  });
  const [peopleError, setPeopleError] = useState<string>("");
  const [chosenPolicyId, setChosenPolicyId] = useState<string>("");
  /*
   * Save and continue found a policy another tab or device made since the
   * step opened, and made none (#7252): said first in the step, for this
   * page's run.
   */
  const [isPolicyMadeElsewhere, setIsPolicyMadeElsewhere] =
    useState<boolean>(false);
  const [reminders, setReminders] = useState<SetupReminderStatuses>({});

  // Step 3.
  const maySecondLevel: boolean = maySecondEscalationLevel();
  const [noAnswerChoice, setNoAnswerChoice] = useState<NoAnswerChoice>(
    getDefaultNoAnswerChoice({ maySecondLevel: maySecondLevel }),
  );
  const [waitText, setWaitText] = useState<string>(
    String(DEFAULT_ESCALATE_AFTER_IN_MINUTES),
  );
  const [repeatText, setRepeatText] = useState<string>(
    String(DEFAULT_REPEAT_TIMES),
  );
  const [nextPeople, setNextPeople] = useState<PeoplePickerValue>({});
  const [noAnswerError, setNoAnswerError] = useState<string>("");

  // Step 4.
  const [showNotReceivedHelp, setShowNotReceivedHelp] =
    useState<boolean>(false);

  const executionLogId: string =
    typeof run[OnCallRunValue.TestExecutionLogId] === "string"
      ? (run[OnCallRunValue.TestExecutionLogId] as string)
      : "";

  const facts: OnCallProgressFacts = {
    isReachConfirmed: run[OnCallRunValue.ReachConfirmed] === true,
    hasPolicy: Boolean(policy),
    isNoAnswerDone: run[OnCallRunValue.NoAnswerDone] === true,
    testStatus: testResult?.status || null,
    isTestSkipped: run[OnCallRunValue.TestSkipped] === true,
  };

  const progress: ReturnType<typeof getOnCallProgress> =
    getOnCallProgress(facts);

  const saveRun: (values: Record<string, string | boolean | null>) => void = (
    values: Record<string, string | boolean | null>,
  ): void => {
    setRun(store.save(values));
  };

  // Where a step leads once it is done: the next step not done, or the summary.
  const openNextStep: (doneKey: string) => void = (doneKey: string): void => {
    const next: string | null = getFirstOpenStepKey(
      progress.map((step: { key: string; isDone: boolean }) => {
        return step.key === doneKey ? { ...step, isDone: true } : step;
      }),
    );
    setOpenStepKey(next);
  };

  // The run's policy and whether a page reaches each of its people.
  const readPolicy: (
    policyId: string,
    refresh: boolean,
  ) => Promise<Array<WhoIsToldBreak> | null> = async (
    policyId: string,
    refresh: boolean,
  ): Promise<Array<WhoIsToldBreak> | null> => {
    const loaded: OnCallPolicyRecord | null = await OnCallSetupApi.loadPolicy(
      policyId,
    ).catch(() => {
      return null;
    });
    const people: Array<ResponderReach> = loaded
      ? await OnCallSetupApi.loadPolicyReadiness({
          policyId: policyId,
          refresh: refresh,
        }).catch(() => {
          return [];
        })
      : [];

    setPolicy(loaded);
    setResponders(people);

    // What still stands between the policy and its people; null when it is gone.
    return loaded
      ? getPolicyBreaks({ policy: loaded, responders: people })
      : null;
  };

  const readReach: (refresh: boolean) => Promise<void> = async (
    refresh: boolean,
  ): Promise<void> => {
    setReach(
      await OnCallSetupApi.loadMyReach(refresh).catch(() => {
        return null;
      }),
    );
  };

  // Reads the run's records: what exists decides which step opens.
  useEffect(() => {
    let isActive: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      let nextRun: GuidedSetupRun = store.read();

      const [loadedReach, loadedPhone, loadedChoices]: [
        MyReach | null,
        ProjectPhoneFacts,
        PolicyChoiceFacts,
      ] = await Promise.all([
        OnCallSetupApi.loadMyReach(false).catch(() => {
          return null;
        }),
        OnCallSetupApi.loadProjectPhoneFacts(),
        OnCallSetupApi.loadPolicyChoices(),
      ]);

      let loadedPolicy: OnCallPolicyRecord | null = null;
      let loadedResponders: Array<ResponderReach> = [];
      let loadedResult: OnCallTestPageResult | null = null;

      const policyId: string | boolean | undefined =
        nextRun[OnCallRunValue.PolicyId];

      if (typeof policyId === "string") {
        loadedPolicy = await OnCallSetupApi.loadPolicy(policyId).catch(() => {
          return null;
        });

        if (!loadedPolicy) {
          // The policy is gone: everything after "who is reached" starts again.
          nextRun = store.save({
            [OnCallRunValue.PolicyId]: null,
            [OnCallRunValue.PolicyIsExisting]: null,
            [OnCallRunValue.NoAnswerDone]: null,
            [OnCallRunValue.TestExecutionLogId]: null,
            [OnCallRunValue.TestSkipped]: null,
          });
        } else {
          loadedResponders = await OnCallSetupApi.loadPolicyReadiness({
            policyId: policyId,
            refresh: false,
          }).catch(() => {
            return [];
          });
        }
      }

      const testId: string | boolean | undefined =
        nextRun[OnCallRunValue.TestExecutionLogId];

      if (loadedPolicy && typeof testId === "string") {
        loadedResult = await OnCallTestPageApi.getResult(testId).catch(() => {
          return null;
        });
      }

      if (!isActive) {
        return;
      }

      setRun(nextRun);
      setReach(loadedReach);
      setPhoneFacts(loadedPhone);
      setChoices(loadedChoices);
      setChosenPolicyId(loadedChoices.policies[0]?.id || "");
      setPolicy(loadedPolicy);
      setResponders(loadedResponders);
      setTestResult(loadedResult);
      setOpenStepKey(
        getFirstOpenStepKey(
          getOnCallProgress({
            isReachConfirmed: nextRun[OnCallRunValue.ReachConfirmed] === true,
            hasPolicy: Boolean(loadedPolicy),
            isNoAnswerDone: nextRun[OnCallRunValue.NoAnswerDone] === true,
            testStatus: loadedResult?.status || null,
            isTestSkipped: nextRun[OnCallRunValue.TestSkipped] === true,
          }),
        ),
      );
      setIsLoading(false);
    };

    load().catch((err: Error) => {
      if (isActive) {
        setLoadError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      isActive = false;
    };
  }, [store]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (loadError) {
    return <Alert type={AlertType.DANGER} title={loadError} />;
  }

  const errorLine: ReactElement = saveError ? (
    <p role="alert" className="text-sm text-red-600">
      {saveError}
    </p>
  ) : (
    <></>
  );

  /*
   * STEP 1: HOW SHOULD WE REACH YOU?
   */
  const methods: Array<ReachMethod> = reach?.methods || [];
  const emails: Array<ReachMethod> = getVerifiedMethodsOfType(methods, [
    EMAIL_METHOD_TYPE,
  ]);
  const phones: Array<ReachMethod> = getVerifiedMethodsOfType(methods, [
    SMS_METHOD_TYPE,
    CALL_METHOD_TYPE,
  ]);
  const pushes: Array<ReachMethod> = getVerifiedMethodsOfType(methods, [
    PUSH_METHOD_TYPE,
  ]);
  const hasSmsNumber: boolean = phones.some((method: ReachMethod): boolean => {
    return method.methodType === SMS_METHOD_TYPE;
  });

  const channelFacts: PhoneChannelFacts = {
    isBillingEnabled: BILLING_ENABLED,
    isSmsOn: phoneFacts.isSmsOn,
    isCallOn: phoneFacts.isCallOn,
    balanceInUSDCents: phoneFacts.balanceInUSDCents,
    serverCanSendSms: canServerSend(sendingStatus, ServerSendingChannel.SMS),
    serverCanCall: canServerSend(sendingStatus, ServerSendingChannel.Call),
  };
  const phoneBreaks: Array<WhoIsToldBreak> = getPhoneBreaks(channelFacts);
  const channelsOff: Array<ProjectNotificationChannel> = [];

  if (phoneFacts.isSmsOn === false) {
    channelsOff.push(ProjectNotificationChannel.SMS);
  }

  if (phoneFacts.isCallOn === false) {
    channelsOff.push(ProjectNotificationChannel.Call);
  }

  const mayTurnOnPhone: boolean =
    channelsOff.length > 0 &&
    canChangeProjectNotificationChannels([
      ProjectNotificationChannel.SMS,
      ProjectNotificationChannel.Call,
    ]);

  const describeMethods: (list: Array<ReachMethod>) => string = (
    list: Array<ReachMethod>,
  ): string => {
    return list
      .map((method: ReachMethod): string => {
        const channel: string = getChannelName(
          method.methodType as OnCallPageChannel,
          translator,
        );

        return method.maskedIdentifier
          ? `${channel} · ${method.maskedIdentifier}`
          : channel;
      })
      .join(", ");
  };

  const turnOnPhone: () => Promise<void> = async (): Promise<void> => {
    setSaveError("");
    setIsSaving(true);

    try {
      await OnCallSetupApi.turnOnPhoneChannels();
      setPhoneFacts({
        ...phoneFacts,
        isSmsOn: true,
        isCallOn: true,
      });
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const sendCode: () => Promise<void> = async (): Promise<void> => {
    const phone: string | null = parsePhoneNumber(phoneText);

    if (!phone) {
      setPhoneError(
        translator.translateText(ON_CALL_SETUP_COPY.phoneError) || "",
      );
      return;
    }

    setPhoneError("");
    setSaveError("");
    setIsSaving(true);

    try {
      const added: { id: string; isVerified: boolean } =
        await OnCallSetupApi.addSmsNumber(phone);

      if (added.isVerified) {
        await onPhoneVerified(phone);
      } else {
        setVerifying({ id: added.id, phone: phone });
      }
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  // A number proven by text: the same number for calls needs no second code.
  const onPhoneVerified: (phone: string) => Promise<void> = async (
    phone: string,
  ): Promise<void> => {
    if (phoneFacts.isCallOn !== false) {
      await OnCallSetupApi.addCallNumber(phone).catch(() => {
        // Calls refused (switched off since, say): SMS still pages.
        return null;
      });
    }

    setPhoneText("");
    await readReach(true);
  };

  const smsAndCallProblems: ReactElement = (
    <div className="space-y-2" data-testid="on-call-setup-phone-problems">
      {isServerWithoutTwilio(channelFacts) ? (
        <div data-testid="on-call-setup-no-twilio">
          <p className="text-sm text-amber-700">
            {translator.translateText(
              serverEmail.isMasterAdmin
                ? ON_CALL_SETUP_COPY.serverNoTwilioForAdmin
                : ON_CALL_SETUP_COPY.serverNoTwilio,
            )}
          </p>
          {serverEmail.isMasterAdmin ? (
            <a
              href={getAdminServerSetupUrl().toString()}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
              data-testid="on-call-setup-set-up-twilio"
            >
              {translator.translateText(ON_CALL_SETUP_COPY.setUpTwilio)}
            </a>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      {phoneBreaks
        .filter((brk: WhoIsToldBreak): boolean => {
          return brk.kind === WhoIsToldBreakKind.ChannelOff;
        })
        .map((brk: WhoIsToldBreak) => {
          return (
            <p
              key={`${brk.kind}-${brk.channel}`}
              className="text-sm text-amber-700"
              data-testid={`on-call-setup-break-${brk.kind}-${brk.channel}`}
            >
              {getBreakSentence(brk, translator)}
            </p>
          );
        })}
      {channelsOff.length > 0 &&
      !mayTurnOnPhone &&
      isKnownNotToChangeProjectNotificationChannels(channelsOff) ? (
        <p
          className="text-sm text-gray-700"
          data-testid="on-call-setup-who-can-turn-on"
        >
          {translator.translateText(
            getChannelGatedMethodList(
              channelsOff[0] === ProjectNotificationChannel.SMS
                ? ChannelGatedMethodList.SMS
                : ChannelGatedMethodList.Call,
            ).offSentence,
          )}
        </p>
      ) : (
        <></>
      )}
      {BILLING_ENABLED && phoneFacts.balanceInUSDCents !== null ? (
        <p
          className={`text-sm ${
            isPhoneBalanceTooLow(channelFacts)
              ? "text-amber-700"
              : "text-gray-500"
          }`}
          data-testid="on-call-setup-balance"
        >
          {translator.translateTemplate(ON_CALL_SETUP_COPY.phoneBalance, {
            balance: formatUsdCents(phoneFacts.balanceInUSDCents),
            floor: formatUsdCents(PHONE_BALANCE_FLOOR_IN_USD_CENTS),
          })}
        </p>
      ) : (
        <></>
      )}
      {isPhoneBalanceTooLow(channelFacts) ? (
        canAddProjectBalance(ProjectBalanceType.SmsOrCall) ? (
          getCurrentProjectBillingMarketplace() ? (
            // A marketplace bills the recharge: Notification Settings says how.
            <AppLink
              to={routeOf(PageMap.SETTINGS_NOTIFICATION_SETTINGS)}
              className={linkClassName}
              dataTestId="on-call-setup-add-balance-link"
            >
              {translator.translateText(ON_CALL_SETUP_COPY.addBalance) || ""}
            </AppLink>
          ) : (
            <div className={ACTIONS_CLASS_NAME}>
              <Button
                title={ON_CALL_SETUP_COPY.addBalance}
                buttonStyle={ButtonStyleType.NORMAL}
                dataTestId="on-call-setup-add-balance"
                onClick={() => {
                  setRechargeError("");
                  setShowRecharge(true);
                }}
              />
            </div>
          )
        ) : (
          <p
            className="text-sm text-gray-700"
            data-testid="on-call-setup-who-can-add-balance"
          >
            {translator.translateText(ON_CALL_SETUP_COPY.whoCanAddBalance)}
          </p>
        )
      ) : (
        <></>
      )}
      {mayTurnOnPhone ? (
        <div className={ACTIONS_CLASS_NAME}>
          <Button
            title={ON_CALL_SETUP_COPY.turnOnSmsAndCalls}
            buttonStyle={ButtonStyleType.NORMAL}
            isLoading={isSaving}
            dataTestId="on-call-setup-turn-on-phone"
            onClick={() => {
              void turnOnPhone();
            }}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  const smsAndCallForm: ReactElement =
    !hasSmsNumber && canAddPhone(channelFacts) ? (
      <form
        className="space-y-2"
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          void sendCode();
        }}
      >
        <label
          htmlFor="on-call-setup-phone"
          className="block text-sm font-medium text-gray-700"
        >
          {translator.translateText(ON_CALL_SETUP_COPY.phoneLabel)}
        </label>
        <Input
          id="on-call-setup-phone"
          value={phoneText}
          placeholder="+15551234567"
          /*
           * A phone number: a phone offers its dial pad, and the box reads
           * left to right on every page, as a Phone field does - on a
           * Persian or Arabic page its "+" went after its digits (#7180).
           */
          inputMode="tel"
          onChange={(value: string) => {
            setPhoneText(value);
            setPhoneError("");
          }}
          error={phoneError || undefined}
          disableSpellCheck={true}
          dataTestId="on-call-setup-phone"
        />
        <div className={ACTIONS_CLASS_NAME}>
          <Button
            title={ON_CALL_SETUP_COPY.sendSmsCode}
            type={ButtonType.Submit}
            buttonStyle={ButtonStyleType.NORMAL}
            isLoading={isSaving}
            dataTestId="on-call-setup-send-code"
          />
        </div>
      </form>
    ) : (
      <></>
    );

  const reachRow: (data: {
    key: string;
    title: string;
    value: string;
    children?: ReactElement | undefined;
  }) => ReactElement = (data: {
    key: string;
    title: string;
    value: string;
    children?: ReactElement | undefined;
  }): ReactElement => {
    return (
      <div
        className="py-3 sm:grid sm:grid-cols-3 sm:gap-4"
        data-testid={`on-call-setup-reach-${data.key}`}
      >
        <dt className="text-sm font-medium text-gray-900">
          {translator.translateText(data.title)}
        </dt>
        <dd className="mt-1 space-y-2 text-sm text-gray-700 sm:col-span-2 sm:mt-0">
          <p data-testid={`on-call-setup-reach-${data.key}-value`}>
            {data.value}
          </p>
          {data.children || <></>}
        </dd>
      </div>
    );
  };

  const confirmReach: () => void = (): void => {
    if (reach && !reach.isReachable) {
      setReachError(
        translator.translateText(ON_CALL_SETUP_COPY.notReachable) || "",
      );
      return;
    }

    setReachError("");
    saveRun({ [OnCallRunValue.ReachConfirmed]: true });
    openNextStep(OnCallSetupStep.ReachYou);
  };

  const reachContent: ReactElement = (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {translator.translateText(ON_CALL_SETUP_COPY.reachHelp)}
      </p>
      <dl className="divide-y divide-gray-100">
        {reachRow({
          key: "email",
          title: ON_CALL_SETUP_COPY.emailRow,
          value:
            emails.length > 0
              ? describeMethods(emails)
              : translator.translateText(ON_CALL_SETUP_COPY.emailNone) || "",
          children: cannotSendEmail(serverEmail) ? (
            <p
              className="text-sm text-amber-700"
              data-testid="on-call-setup-no-email"
            >
              {getBreakSentence(
                makeWhoIsToldBreak({
                  kind: WhoIsToldBreakKind.ServerCannotSend,
                  fix: WhoIsToldFix.ServerSettings,
                  channel: WhoIsToldServerChannel.Email,
                }),
                translator,
              )}
            </p>
          ) : undefined,
        })}
        {reachRow({
          key: "phone",
          title: ON_CALL_SETUP_COPY.phoneRow,
          value:
            phones.length > 0
              ? describeMethods(phones)
              : translator.translateText(ON_CALL_SETUP_COPY.phoneNone) || "",
          children:
            phones.length > 0 ? undefined : (
              <>
                {smsAndCallProblems}
                {smsAndCallForm}
              </>
            ),
        })}
        {reachRow({
          key: "push",
          title: ON_CALL_SETUP_COPY.pushRow,
          value:
            pushes.length > 0
              ? describeMethods(pushes)
              : translator.translateText(ON_CALL_SETUP_COPY.pushNone) || "",
          children:
            pushes.length > 0 ? undefined : (
              <>
                <p className="text-sm text-gray-500">
                  {translator.translateText(ON_CALL_SETUP_COPY.pushHelp)}
                </p>
                <AppLink
                  to={routeOf(PageMap.USER_SETTINGS_NOTIFICATION_METHODS)}
                  className={linkClassName}
                  dataTestId="on-call-setup-push-link"
                >
                  {translator.translateText(ON_CALL_SETUP_COPY.pushLink) || ""}
                </AppLink>
              </>
            ),
        })}
      </dl>
      {reachError ? (
        <p
          role="alert"
          className="text-sm text-red-600"
          data-testid="on-call-setup-not-reachable"
        >
          {reachError}
        </p>
      ) : (
        <></>
      )}
      {errorLine}
      <div className={ACTIONS_CLASS_NAME}>
        <Button
          title={ON_CALL_SETUP_COPY.continueButton}
          buttonStyle={ButtonStyleType.PRIMARY}
          dataTestId="on-call-setup-reach-continue"
          onClick={confirmReach}
        />
        <Button
          title="Recheck"
          buttonStyle={ButtonStyleType.LINK}
          dataTestId="on-call-setup-reach-recheck"
          onClick={() => {
            setReachError("");
            void readReach(true);
            void OnCallSetupApi.loadProjectPhoneFacts().then(setPhoneFacts);
          }}
        />
      </div>
      {showRecharge ? (
        <BasicFormModal
          title={ON_CALL_SETUP_COPY.addBalance}
          onClose={() => {
            setShowRecharge(false);
          }}
          isLoading={isRecharging}
          submitButtonText="Recharge"
          onSubmit={async (item: JSONObject) => {
            setIsRecharging(true);
            setRechargeError("");

            try {
              await OnCallSetupApi.rechargeBalance(Number(item["amount"]));
              setPhoneFacts(await OnCallSetupApi.loadProjectPhoneFacts());
              setShowRecharge(false);
            } catch (err) {
              setRechargeError(API.getFriendlyMessage(err));
            }

            setIsRecharging(false);
          }}
          formProps={{
            name: "Add balance",
            error: rechargeError,
            fields: [
              {
                title: RECHARGE_AMOUNT_TITLE,
                description: RECHARGE_AMOUNT_DESCRIPTION,
                field: { amount: true },
                placeholder: "20",
                required: true,
                validation: { minValue: 20, maxValue: 1000 },
                fieldType: FormFieldSchemaType.Number,
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
      {verifying ? (
        <VerificationCodeModal
          channel={VerificationCodeChannel.SMS}
          itemId={verifying.id}
          destination={verifying.phone}
          onClose={() => {
            setVerifying(null);
          }}
          onVerified={(_result: JSONObject) => {
            const phone: string = verifying.phone;
            void onPhoneVerified(phone);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );

  /*
   * STEP 2: WHO ELSE IS ON CALL?
   */
  const policies: Array<{ id: string; name: string }> = choices?.policies || [];
  const isExistingMode: boolean = !policy && policies.length > 0;
  const mayCreatePolicy: boolean = Boolean(choices?.mayCreatePolicy);
  const mayAddRules: boolean = Boolean(choices?.mayAddRules);
  const mayEditLevels: boolean = Boolean(choices?.mayEditLevels);
  const firstLevel: PolicyLevel | undefined = policy?.levels[0];
  const missingRules: { incident: boolean; alert: boolean } | null = policy
    ? getMissingRuleKinds(policy)
    : null;
  const isMissingRules: boolean = Boolean(
    missingRules && (missingRules.incident || missingRules.alert),
  );

  const savePeople: () => Promise<void> = async (): Promise<void> => {
    setSaveError("");
    const userIds: Array<string> = pickedIds(people, PeoplePickerKind.User);
    const teamIds: Array<string> = pickedIds(people, PeoplePickerKind.Team);

    if (!isExistingMode && userIds.length + teamIds.length === 0) {
      setPeopleError(
        translator.translateText(ON_CALL_SETUP_COPY.whoNobodyPicked) || "",
      );
      return;
    }

    setIsSaving(true);

    try {
      let policyId: string;

      if (isExistingMode) {
        policyId = chosenPolicyId;
        const chosen: OnCallPolicyRecord | null =
          await OnCallSetupApi.loadPolicy(policyId);

        // Who is on its first level already is not added twice.
        const newUserIds: Array<string> = userIds.filter(
          (id: string): boolean => {
            return !chosen?.levels[0]?.userIds.includes(id);
          },
        );

        if (mayEditLevels && newUserIds.length + teamIds.length > 0) {
          await OnCallSetupApi.addToFirstLevel({
            policyId: policyId,
            firstLevelId: chosen?.levels[0]?.id || null,
            userIds: newUserIds,
            teamIds: teamIds,
          });
        }

        saveRun({
          [OnCallRunValue.PolicyId]: policyId,
          [OnCallRunValue.PolicyIsExisting]: true,
        });
      } else {
        /*
         * Asked again just before the policy is made: another tab or device
         * may have made the project's first one since this page read it (the
         * website-down setup's step 2, say). Then the step turns to the
         * project's policies, says why, and makes nothing - no second policy,
         * and no second pair of on-call rules paging for every new incident
         * and alert (#7252). Choices that cannot be read make nothing on a
         * guess: the step stays as it is, to try again.
         */
        const latest: PolicyChoiceFacts | null =
          await OnCallSetupApi.loadPolicyChoices().catch(() => {
            return null;
          });

        if (!latest) {
          setSaveError(
            translator.translateText(ON_CALL_SETUP_COPY.couldNotSave) || "",
          );
          setIsSaving(false);
          return;
        }

        if (latest.policies.length > 0 || !latest.mayCreatePolicy) {
          setChoices(latest);
          setChosenPolicyId(latest.policies[0]?.id || "");
          setIsPolicyMadeElsewhere(latest.policies.length > 0);
          setIsSaving(false);
          return;
        }

        policyId = await OnCallSetupApi.createPolicy({
          userIds: userIds,
          teamIds: teamIds,
          addRules: latest.mayAddRules,
        });
        saveRun({ [OnCallRunValue.PolicyId]: policyId });
      }

      /*
       * Everyone reached and the policy runs: on to the next step. Otherwise
       * the step stays open on what stands in the way - who a page can't
       * reach, with a setup reminder, or the rules it still needs.
       */
      const breaks: Array<WhoIsToldBreak> | null = await readPolicy(
        policyId,
        true,
      );

      if (breaks && breaks.length === 0) {
        openNextStep(OnCallSetupStep.WhoElse);
      }
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  // Adds the on-call rules nothing ran the policy by, then moves on.
  const continueFromPeople: () => Promise<void> = async (): Promise<void> => {
    setSaveError("");

    if (policy && isMissingRules && mayAddRules && missingRules) {
      setIsSaving(true);

      try {
        /*
         * The policy's rules are read again just before they are added:
         * another tab or device may have added them since, and a second
         * pair would run the policy twice for every new incident and alert
         * (#7252). Only the kinds still missing are added.
         */
        const latest: OnCallPolicyRecord | null =
          await OnCallSetupApi.loadPolicy(policy.id);
        const stillMissing: { incident: boolean; alert: boolean } | null =
          latest ? getMissingRuleKinds(latest) : null;

        if (stillMissing && (stillMissing.incident || stillMissing.alert)) {
          await OnCallSetupApi.addEveryNewEventRules({
            policyId: policy.id,
            policyName: policy.name,
            incident: stillMissing.incident,
            alert: stillMissing.alert,
          });
        }

        await readPolicy(policy.id, false);
      } catch (err) {
        setSaveError(API.getFriendlyMessage(err));
        setIsSaving(false);
        return;
      }

      setIsSaving(false);
    }

    openNextStep(OnCallSetupStep.WhoElse);
  };

  const policyBreaks: Array<WhoIsToldBreak> = policy
    ? getPolicyBreaks({ policy: policy, responders: responders })
    : [];

  const readinessList: ReactElement = (
    <div className="space-y-2" data-testid="on-call-setup-readiness">
      <p className="text-sm font-medium text-gray-900">
        {translator.translateText(ON_CALL_SETUP_COPY.whoReadinessTitle)}
      </p>
      <ul className="space-y-2">
        {responders.map((person: ResponderReach) => {
          const reminder: SetupReminderStatus | undefined =
            reminders[person.userId];

          return (
            <li
              key={person.userId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
              data-testid={`on-call-setup-responder-${person.userId}`}
              data-reachable={person.isReachable ? "true" : "false"}
            >
              <span
                className={
                  person.isReachable ? "text-gray-700" : "text-amber-700"
                }
              >
                {describeResponder(translator, person)}
              </span>
              {!person.isReachable && person.userId !== userId ? (
                reminder && reminder.state !== "idle" ? (
                  <span
                    className="text-gray-500"
                    data-testid={`on-call-setup-reminder-${person.userId}`}
                  >
                    {reminder.state === "sent"
                      ? translator.translateText(
                          ON_CALL_SETUP_COPY.reminderSent,
                        )
                      : reminder.message}
                  </span>
                ) : (
                  <Button
                    title={ON_CALL_SETUP_COPY.sendReminder}
                    buttonStyle={ButtonStyleType.LINK}
                    dataTestId={`on-call-setup-send-reminder-${person.userId}`}
                    onClick={() => {
                      setReminders({
                        ...reminders,
                        [person.userId]: { state: "sending", message: "" },
                      });
                      void OnCallSetupApi.sendSetupReminders([
                        person.userId,
                      ]).then((statuses: SetupReminderStatuses) => {
                        setReminders((previous: SetupReminderStatuses) => {
                          return { ...previous, ...statuses };
                        });
                      });
                    }}
                  />
                )
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  const breakLines: (
    breaks: ReadonlyArray<WhoIsToldBreak>,
    testIdPrefix: string,
  ) => ReactElement = (
    breaks: ReadonlyArray<WhoIsToldBreak>,
    testIdPrefix: string,
  ): ReactElement => {
    if (breaks.length === 0) {
      return <></>;
    }

    return (
      <ul className="space-y-1">
        {breaks.map((brk: WhoIsToldBreak) => {
          return (
            <li
              key={`${brk.kind}-${brk.userId || ""}-${brk.channel || ""}`}
              className="text-sm text-amber-700"
              data-testid={`${testIdPrefix}-${brk.kind}`}
            >
              {getBreakSentence(brk, translator)}
            </li>
          );
        })}
      </ul>
    );
  };

  const policyChoiceOptions: Array<DropdownOption> = policies.map(
    (entry: { id: string; name: string }): DropdownOption => {
      return { value: entry.id, label: entry.name };
    },
  );

  const whoDoneLine: string = policy
    ? translator.translateTemplate('"{{policy}}" pages {{people}}.', {
        policy: policy.name,
        people:
          describeFirstLevel(translator, {
            level: firstLevel,
            responders: responders,
          }) || "-",
      })
    : "";

  let whoContent: ReactElement;

  if (policy) {
    whoContent = (
      <div className="space-y-4">
        <p className="text-sm text-gray-700" data-testid="on-call-setup-policy">
          {whoDoneLine}
        </p>
        {readinessList}
        {breakLines(
          policyBreaks.filter((brk: WhoIsToldBreak): boolean => {
            return brk.kind !== WhoIsToldBreakKind.PersonUnreachable;
          }),
          "on-call-setup-policy-break",
        )}
        {errorLine}
        <div className={ACTIONS_CLASS_NAME}>
          <Button
            title={
              isMissingRules && mayAddRules
                ? ON_CALL_SETUP_COPY.whoAddRules
                : ON_CALL_SETUP_COPY.continueButton
            }
            buttonStyle={ButtonStyleType.PRIMARY}
            isLoading={isSaving}
            dataTestId="on-call-setup-who-continue"
            onClick={() => {
              void continueFromPeople();
            }}
          />
        </div>
      </div>
    );
  } else if (!isExistingMode && !mayCreatePolicy) {
    whoContent = (
      <div data-testid="on-call-setup-cannot-create">
        <Alert
          type={AlertType.INFO}
          title={
            translator.translateText(ON_CALL_SETUP_COPY.whoCannotCreate) || ""
          }
        />
      </div>
    );
  } else {
    whoContent = (
      <div className="space-y-4">
        {/*
         * Why the step turned to the project's policies, said first, and
         * what to do now. Save and continue stays where it was, so the two
         * lines are read out when they change (#7252): a screen reader
         * hears why nothing was made instead of nothing at all.
         */}
        <div
          className="space-y-4"
          aria-live="polite"
          data-testid="on-call-setup-who-help"
        >
          {isPolicyMadeElsewhere && isExistingMode ? (
            <p
              className="text-sm text-gray-700"
              data-testid="on-call-setup-policy-made-elsewhere"
            >
              {translator.translateText(ON_CALL_SETUP_COPY.policyMadeElsewhere)}
            </p>
          ) : (
            <></>
          )}
          <p className="text-sm text-gray-500">
            {isExistingMode
              ? translator.translateText(ON_CALL_SETUP_COPY.whoExistingHelp)
              : translator.translateTemplate(ON_CALL_SETUP_COPY.whoCreateHelp, {
                  policy: ON_CALL_POLICY_NAME,
                })}
          </p>
        </div>
        {isExistingMode ? (
          <div>
            <p
              id="on-call-setup-policy-label"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {translator.translateText(ON_CALL_SETUP_COPY.whoPolicyLabel)}
            </p>
            <Dropdown
              options={policyChoiceOptions}
              value={policyChoiceOptions.find(
                (option: DropdownOption): boolean => {
                  return option.value === chosenPolicyId;
                },
              )}
              isClearable={false}
              ariaLabelledby="on-call-setup-policy-label"
              dataTestId="on-call-setup-policy-choice"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (typeof value === "string") {
                  setChosenPolicyId(value);
                }
              }}
            />
          </div>
        ) : (
          <></>
        )}
        {!isExistingMode || mayEditLevels ? (
          <div>
            <p
              id="on-call-setup-people-label"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {translator.translateText(
                isExistingMode
                  ? ON_CALL_SETUP_COPY.whoAddToLevel
                  : ON_CALL_SETUP_COPY.whoPeopleLabel,
              )}
            </p>
            <LazyPeoplePicker
              kinds={[PeoplePickerKind.User, PeoplePickerKind.Team]}
              value={people}
              onChange={(value: PeoplePickerValue) => {
                setPeople(value);
                setPeopleError("");
              }}
              addButtonText={ON_CALL_SETUP_COPY.whoAddPeople}
              error={peopleError || undefined}
              ariaLabelledby="on-call-setup-people-label"
              dataTestId="on-call-setup-people"
            />
          </div>
        ) : (
          <></>
        )}
        {errorLine}
        <div className={ACTIONS_CLASS_NAME}>
          <Button
            title={ON_CALL_SETUP_COPY.saveButton}
            buttonStyle={ButtonStyleType.PRIMARY}
            isLoading={isSaving}
            dataTestId="on-call-setup-who-save"
            onClick={() => {
              void savePeople();
            }}
          />
        </div>
      </div>
    );
  }

  /*
   * STEP 3: WHAT IF NOBODY ANSWERS?
   */
  const secondLevel: PolicyLevel | undefined = policy?.levels[1];

  const saveNoAnswer: () => Promise<void> = async (): Promise<void> => {
    setSaveError("");
    setNoAnswerError("");

    if (!policy) {
      return;
    }

    if (secondLevel || noAnswerChoice === NoAnswerChoice.Nothing) {
      saveRun({ [OnCallRunValue.NoAnswerDone]: true });
      openNextStep(OnCallSetupStep.NoAnswer);
      return;
    }

    const wait: number | null = parseWaitMinutes(waitText);

    if (wait === null) {
      setNoAnswerError(
        translator.translateText(ON_CALL_SETUP_COPY.noAnswerWaitError) || "",
      );
      return;
    }

    if (!firstLevel) {
      setNoAnswerError(
        translator.translateText(ON_CALL_SETUP_COPY.whoNobodyPicked) || "",
      );
      return;
    }

    setIsSaving(true);

    try {
      if (noAnswerChoice === NoAnswerChoice.Escalate) {
        const userIds: Array<string> = pickedIds(
          nextPeople,
          PeoplePickerKind.User,
        );
        const teamIds: Array<string> = pickedIds(
          nextPeople,
          PeoplePickerKind.Team,
        );

        if (userIds.length + teamIds.length === 0) {
          setNoAnswerError(
            translator.translateText(ON_CALL_SETUP_COPY.whoNobodyPicked) || "",
          );
          setIsSaving(false);
          return;
        }

        await OnCallSetupApi.addSecondLevel({
          policyId: policy.id,
          firstLevel: firstLevel,
          waitMinutes: wait,
          userIds: userIds,
          teamIds: teamIds,
        });
      } else {
        const times: number | null = parseRepeatTimes(repeatText);

        if (times === null) {
          setNoAnswerError(
            translator.translateText(ON_CALL_SETUP_COPY.noAnswerRepeatError) ||
              "",
          );
          setIsSaving(false);
          return;
        }

        await OnCallSetupApi.setRepeat({
          policyId: policy.id,
          firstLevel: firstLevel,
          waitMinutes: wait,
          times: times,
        });
      }

      await readPolicy(policy.id, false);
      saveRun({ [OnCallRunValue.NoAnswerDone]: true });
      openNextStep(OnCallSetupStep.NoAnswer);
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const noAnswerOptions: Array<{
    title: string;
    description?: string | undefined;
    value: string;
  }> = [];

  if (maySecondLevel) {
    noAnswerOptions.push({
      title:
        translator.translateText(ON_CALL_SETUP_COPY.noAnswerEscalate) || "",
      value: NoAnswerChoice.Escalate,
    });
  }

  noAnswerOptions.push(
    {
      title: translator.translateText(ON_CALL_SETUP_COPY.noAnswerRepeat) || "",
      value: NoAnswerChoice.Repeat,
    },
    {
      title: translator.translateText(ON_CALL_SETUP_COPY.noAnswerNothing) || "",
      value: NoAnswerChoice.Nothing,
    },
  );

  const noAnswerContent: ReactElement = secondLevel ? (
    <div className="space-y-4">
      <p
        className="text-sm text-gray-700"
        data-testid="on-call-setup-has-levels"
      >
        {translator.translateText(ON_CALL_SETUP_COPY.noAnswerHasLevels)}
      </p>
      {errorLine}
      <div className={ACTIONS_CLASS_NAME}>
        <Button
          title={ON_CALL_SETUP_COPY.continueButton}
          buttonStyle={ButtonStyleType.PRIMARY}
          dataTestId="on-call-setup-no-answer-save"
          onClick={() => {
            void saveNoAnswer();
          }}
        />
      </div>
    </div>
  ) : (
    <div className="space-y-4">
      <p id="on-call-setup-no-answer-label" className="text-sm text-gray-500">
        {translator.translateText(ON_CALL_SETUP_COPY.noAnswerHelp)}
      </p>
      {!maySecondLevel ? (
        <p
          className="text-sm text-gray-700"
          data-testid="on-call-setup-free-plan"
        >
          {translator.translateText(ON_CALL_SETUP_COPY.noAnswerFreePlan)}
        </p>
      ) : (
        <></>
      )}
      <GroupRadioButtons
        options={noAnswerOptions}
        initialValue={noAnswerChoice}
        ariaLabelledby="on-call-setup-no-answer-label"
        dataTestId="on-call-setup-no-answer-choice"
        onChange={(value: string) => {
          setNoAnswerChoice(value as NoAnswerChoice);
          setNoAnswerError("");
        }}
      />
      {noAnswerChoice !== NoAnswerChoice.Nothing ? (
        <div>
          <label
            htmlFor="on-call-setup-wait"
            className="block text-sm font-medium text-gray-700"
          >
            {translator.translateText(ON_CALL_SETUP_COPY.noAnswerWaitLabel)}
          </label>
          <div className="mt-1 max-w-[10rem]">
            <Input
              id="on-call-setup-wait"
              type={InputType.NUMBER}
              value={waitText}
              onChange={(value: string) => {
                setWaitText(value);
                setNoAnswerError("");
              }}
              dataTestId="on-call-setup-wait"
            />
          </div>
        </div>
      ) : (
        <></>
      )}
      {noAnswerChoice === NoAnswerChoice.Escalate ? (
        <div>
          <p
            id="on-call-setup-next-label"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            {translator.translateText(
              ON_CALL_SETUP_COPY.noAnswerSecondLevelLabel,
            )}
          </p>
          <LazyPeoplePicker
            kinds={[PeoplePickerKind.User, PeoplePickerKind.Team]}
            value={nextPeople}
            onChange={(value: PeoplePickerValue) => {
              setNextPeople(value);
              setNoAnswerError("");
            }}
            addButtonText={ON_CALL_SETUP_COPY.whoAddPeople}
            ariaLabelledby="on-call-setup-next-label"
            dataTestId="on-call-setup-next-people"
          />
        </div>
      ) : (
        <></>
      )}
      {noAnswerChoice === NoAnswerChoice.Repeat ? (
        <div>
          <label
            htmlFor="on-call-setup-repeat"
            className="block text-sm font-medium text-gray-700"
          >
            {translator.translateText(ON_CALL_SETUP_COPY.noAnswerRepeatLabel)}
          </label>
          <div className="mt-1 max-w-[10rem]">
            <Input
              id="on-call-setup-repeat"
              type={InputType.NUMBER}
              value={repeatText}
              onChange={(value: string) => {
                setRepeatText(value);
                setNoAnswerError("");
              }}
              dataTestId="on-call-setup-repeat"
            />
          </div>
        </div>
      ) : (
        <></>
      )}
      {noAnswerError ? (
        <p
          role="alert"
          className="text-sm text-red-600"
          data-testid="on-call-setup-no-answer-error"
        >
          {noAnswerError}
        </p>
      ) : (
        <></>
      )}
      {errorLine}
      <div className={ACTIONS_CLASS_NAME}>
        <Button
          title={ON_CALL_SETUP_COPY.saveButton}
          buttonStyle={ButtonStyleType.PRIMARY}
          isLoading={isSaving}
          dataTestId="on-call-setup-no-answer-save"
          onClick={() => {
            void saveNoAnswer();
          }}
        />
      </div>
    </div>
  );

  const noAnswerDoneLine: string = !policy
    ? ""
    : secondLevel && firstLevel
      ? translator.translatePlural(
          {
            one: "After {{count}} minute, {{people}} is paged.",
            other: "After {{count}} minutes, {{people}} is paged.",
          },
          firstLevel.escalateAfterInMinutes,
          { people: secondLevel.names.join(", ") || "-" },
        )
      : policy.repeatTimes > 0
        ? translator.translatePlural(
            {
              one: "The page starts again, {{count}} more time at most.",
              other: "The page starts again, {{count}} more times at most.",
            },
            policy.repeatTimes,
          )
        : translator.translateText(ON_CALL_SETUP_COPY.nobodyElse) || "";

  /*
   * STEP 4: SEND A TEST PAGE.
   */
  const isAcknowledged: boolean =
    testResult?.status === OnCallTestPageStatus.Acknowledged;

  const testContent: ReactElement = (
    <div className="space-y-4">
      {executionLogId ? (
        <TestPageResult
          executionLogId={executionLogId}
          onResult={(result: OnCallTestPageResult) => {
            setTestResult(result);
          }}
        />
      ) : (
        <p className="text-sm text-gray-500">
          {translator.translateText(ON_CALL_SETUP_COPY.testHelp)}
        </p>
      )}
      {isAcknowledged ? (
        <div className={ACTIONS_CLASS_NAME}>
          <Button
            title={ON_CALL_SETUP_COPY.continueButton}
            buttonStyle={ButtonStyleType.PRIMARY}
            dataTestId="on-call-setup-test-continue"
            onClick={() => {
              setOpenStepKey(null);
            }}
          />
        </div>
      ) : (
        <div className={ACTIONS_CLASS_NAME}>
          {policy ? (
            <SendTestPageButton
              target={{
                kind: "policy",
                policyId: policy.id,
                policyName: policy.name,
              }}
              title={
                executionLogId ? ON_CALL_SETUP_COPY.testSendAnother : undefined
              }
              buttonStyle={
                executionLogId
                  ? ButtonStyleType.NORMAL
                  : ButtonStyleType.PRIMARY
              }
              onSent={(id: string) => {
                setTestResult(null);
                setShowNotReceivedHelp(false);
                saveRun({
                  [OnCallRunValue.TestExecutionLogId]: id,
                  [OnCallRunValue.TestSkipped]: null,
                });
              }}
              onResult={(result: OnCallTestPageResult) => {
                setTestResult(result);
              }}
            />
          ) : (
            <></>
          )}
          {executionLogId ? (
            <Button
              title={ON_CALL_SETUP_COPY.testDidNotGetIt}
              buttonStyle={ButtonStyleType.NORMAL}
              dataTestId="on-call-setup-did-not-get-it"
              onClick={() => {
                setShowNotReceivedHelp(true);
              }}
            />
          ) : (
            <></>
          )}
          <Button
            title={ON_CALL_SETUP_COPY.testSkip}
            buttonStyle={ButtonStyleType.LINK}
            dataTestId="on-call-setup-skip-test"
            onClick={() => {
              saveRun({ [OnCallRunValue.TestSkipped]: true });
              setOpenStepKey(null);
            }}
          />
        </div>
      )}
      {showNotReceivedHelp && !isAcknowledged ? (
        <div className="space-y-2" data-testid="on-call-setup-not-received">
          <p className="text-sm text-gray-700">
            {translator.translateText(ON_CALL_SETUP_COPY.testDidNotGetItHelp)}
          </p>
          <AppLink
            to={routeOf(PageMap.USER_SETTINGS_NOTIFICATION_METHODS)}
            className={linkClassName}
          >
            {translator.translateText(ON_CALL_SETUP_COPY.testMethodsLink) || ""}
          </AppLink>
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  const steps: Array<GuidedSetupFrameStep> = [
    {
      ...progress[0]!,
      title: ON_CALL_SETUP_COPY.reachTitle,
      doneLine: [emails, phones, pushes]
        .filter((list: Array<ReachMethod>): boolean => {
          return list.length > 0;
        })
        .map(describeMethods)
        .join(", "),
      content: reachContent,
    },
    {
      ...progress[1]!,
      title: ON_CALL_SETUP_COPY.whoTitle,
      doneLine: whoDoneLine,
      content: whoContent,
    },
    {
      ...progress[2]!,
      title: ON_CALL_SETUP_COPY.noAnswerTitle,
      doneLine: noAnswerDoneLine,
      content: noAnswerContent,
    },
    {
      ...progress[3]!,
      title: ON_CALL_SETUP_COPY.testTitle,
      doneLine:
        isAcknowledged && testResult
          ? getResultSentence(translator, testResult)
          : translator.translateText("Skipped") || "",
      content: testContent,
    },
  ];

  /*
   * THE SUMMARY.
   */
  const summaryRows: Array<OnCallSummaryRow> = policy
    ? getOnCallSummaryRows(translator, {
        policy: policy,
        responders: responders,
        breaks: policyBreaks,
        isCatchAll: run[OnCallRunValue.PolicyIsExisting] !== true,
        testResult: testResult,
        testResultSentence: testResult
          ? getResultSentence(translator, testResult)
          : null,
      })
    : [];

  const isFreeCloudPlan: boolean =
    BILLING_ENABLED && ProjectUtil.getCurrentPlan() === PlanType.Free;

  const summary: ReactElement = (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-gray-900">
        {translator.translateText(ON_CALL_SETUP_COPY.summaryTitle)}
      </h2>
      <dl className="mt-4 divide-y divide-gray-100">
        {summaryRows.map((row: OnCallSummaryRow) => {
          return (
            <div
              key={row.key}
              className="py-3 sm:grid sm:grid-cols-4 sm:gap-4"
              data-testid={`on-call-setup-summary-${row.key}`}
            >
              <dt className="text-sm font-medium text-gray-900">{row.label}</dt>
              <dd className="mt-1 text-sm text-gray-700 sm:col-span-3 sm:mt-0">
                {row.text}
              </dd>
            </div>
          );
        })}
        {policyBreaks.length > 0 ? (
          <div
            className="py-3 sm:grid sm:grid-cols-4 sm:gap-4"
            data-testid="on-call-setup-summary-breaks"
          >
            <dt className="text-sm font-medium text-gray-900">
              {translator.translateText(
                ON_CALL_SETUP_COPY.summaryNeedsAttention,
              )}
            </dt>
            <dd className="mt-1 sm:col-span-3 sm:mt-0">
              {breakLines(policyBreaks, "on-call-setup-summary-break")}
            </dd>
          </div>
        ) : (
          <></>
        )}
      </dl>
      <h3 className="mt-5 text-sm font-semibold text-gray-900">
        {translator.translateText(ON_CALL_SETUP_COPY.summaryNext)}
      </h3>
      <ul className="mt-2 space-y-1">
        <li>
          <AppLink
            to={routeOf(PageMap.ON_CALL_DUTY_SCHEDULES)}
            className={linkClassName}
            dataTestId="on-call-setup-next-schedule"
          >
            {isFreeCloudPlan
              ? translator.translateTemplate(
                  ON_CALL_SETUP_COPY.nextScheduleNeedsPlan,
                  { plan: PlanType.Growth },
                )
              : translator.translateText(ON_CALL_SETUP_COPY.nextSchedule) || ""}
          </AppLink>
        </li>
        <li>
          <AppLink
            to={routeOf(PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTIONS)}
            className={linkClassName}
          >
            {translator.translateText(ON_CALL_SETUP_COPY.nextChat) || ""}
          </AppLink>
        </li>
        <li>
          <AppLink
            to={routeOf(PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES)}
            className={linkClassName}
          >
            {translator.translateText(ON_CALL_SETUP_COPY.nextWorkingHours) ||
              ""}
          </AppLink>
        </li>
        <li>
          <AppLink
            to={routeOf(PageMap.ON_CALL_DUTY_READINESS)}
            className={linkClassName}
          >
            {translator.translateText(ON_CALL_SETUP_COPY.nextReadiness) || ""}
          </AppLink>
        </li>
        {policy ? (
          <li>
            <AppLink
              to={routeOf(
                PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
                policy.id,
              )}
              className={linkClassName}
              dataTestId="on-call-setup-open-policy"
            >
              {translator.translateText(ON_CALL_SETUP_COPY.openPolicy) || ""}
            </AppLink>
          </li>
        ) : (
          <></>
        )}
      </ul>
      <div className={`mt-5 ${ACTIONS_CLASS_NAME}`}>
        <Button
          title={ON_CALL_SETUP_COPY.startOver}
          buttonStyle={ButtonStyleType.NORMAL}
          icon={IconProp.Add}
          dataTestId="on-call-setup-start-over"
          onClick={() => {
            // Who is reached stays confirmed: it is the person's, not the policy's.
            store.forget();
            setRun(store.save({ [OnCallRunValue.ReachConfirmed]: true }));
            setPolicy(null);
            setIsPolicyMadeElsewhere(false);
            setResponders([]);
            setTestResult(null);
            setReminders({});
            setNextPeople({});
            setShowNotReceivedHelp(false);
            setPeople({ [PeoplePickerKind.User]: userId ? [userId] : [] });
            setOpenStepKey(OnCallSetupStep.WhoElse);
            // The project has a policy now: the choice is asked afresh.
            OnCallSetupApi.loadPolicyChoices()
              .then((loaded: PolicyChoiceFacts) => {
                setChoices(loaded);
                setChosenPolicyId(loaded.policies[0]?.id || "");
              })
              .catch(() => {
                // The previous choices stay.
              });
          }}
        />
      </div>
    </div>
  );

  return (
    <GuidedSetupFrame
      setup={ON_CALL_SETUP}
      steps={steps}
      openStepKey={openStepKey}
      onOpenStep={(key: string) => {
        setSaveError("");
        setOpenStepKey(key);
      }}
      summary={summary}
      isFinished={isOnCallSetupFinished(facts)}
      guideDocsPath={ON_CALL_SETUP_GUIDE_DOCS_PATH}
    />
  );
};

export default OnCallGuidedSetup;
