import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { Green } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { NOTIFICATION_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import TwilioConfigDefaultCopy, {
  TwilioConfigDefaultState,
  getDefaultSwitchDescription,
  getProjectDefaultPillText,
  getSetDefaultTitle,
  getStopDefaultConfirmDescription,
  getTwilioConfigCardDescription,
  getTwilioConfigDefaultState,
  isDefaultSwitchOnWhenCreating,
} from "./TwilioConfigDefaultCopy";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import TwilioConfigNumbersCopy, {
  getTwilioConfigNumbersForExport,
} from "./TwilioConfigNumbersCopy";
import TwilioConfigUseCopy, {
  getTwilioConfigUseOptions,
  getTwilioConfigUseTitle,
  isFormUsedFor,
  TwilioConfigUseOption,
} from "./TwilioConfigUseCopy";
import TwilioConfigUses, {
  TwilioConfigUse,
} from "Common/Types/CallAndSMS/TwilioConfigUse";
import { getPhoneNumberListError } from "Common/UI/Utils/PhoneNumberListError";
import { PHONE_NUMBER_LIST_EXAMPLE } from "Common/Types/CallAndSMS/TwilioPhoneNumbers";
import TwilioConfigPhoneNumbers from "./TwilioConfigPhoneNumbers";
import { phoneNumberInLine } from "Common/Types/PhoneNumberDirection";
import TwilioTestSendCopy, {
  getTestSendFromPhoneNumber,
  getTestSentMessage,
  TwilioTestSendKind,
  TwilioTestSentMessage,
} from "./TwilioTestSendCopy";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  getTestSendLock,
  TestSendLock,
  TestSendTargets,
} from "../TestSend/TestSendLock";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * What the create form starts with for the project's first config: the
 * default switch on, as the server would store it if the switch were left
 * out (TwilioConfigDefaultCopy says why).
 */
const FIRST_CONFIG_INITIAL_VALUES: FormValues<ProjectCallSMSConfig> = {
  isProjectDefault: true,
};

/*
 * The numbers few configs need, folded under More fields at the end of the
 * Twilio step: numbers to send SMS from, for numbers that can only make
 * calls (in some countries, national numbers are voice-only), and the
 * numbers for recipients in other countries (TwilioConfigNumbersCopy).
 */
const moreNumbersSection: FormFieldCollapsibleSection<ProjectCallSMSConfig> =
  getAdvancedFormSection<ProjectCallSMSConfig>();

/*
 * WHAT THE ACCOUNT IS USED FOR, ASKED FIRST (TwilioConfigUseCopy): calls and
 * SMS, SMS only or calls only. The Twilio step then asks only for the
 * numbers that answer takes, each required where it is needed and nowhere
 * else, and says what each number sends:
 *
 *   - Calls and SMS: the primary number - SMS go out from it too, unless SMS
 *     numbers are added under More fields, with the secondary numbers;
 *   - SMS only: the SMS numbers, open and required, and nothing folded;
 *   - Calls only: the primary number, and the secondary numbers folded.
 *
 * A field whose help, fold or need follows the answer is written once for
 * each answer that shows it, with a showIf for that answer alone
 * (isFormUsedFor): ModelForm keeps two fields for one column when both are
 * shown only on a condition, and the form never shows two at once. The
 * default switch is too, so its help names what goes through the default.
 */
const isUsedForCallsAndSms: (
  values: FormValues<ProjectCallSMSConfig>,
) => boolean = isFormUsedFor(TwilioConfigUse.CallsAndSms);
const isUsedForSmsOnly: (values: FormValues<ProjectCallSMSConfig>) => boolean =
  isFormUsedFor(TwilioConfigUse.SmsOnly);
const isUsedForCallsOnly: (
  values: FormValues<ProjectCallSMSConfig>,
) => boolean = isFormUsedFor(TwilioConfigUse.CallsOnly);
const isUsedForCalls: (values: FormValues<ProjectCallSMSConfig>) => boolean =
  isFormUsedFor(TwilioConfigUse.CallsAndSms, TwilioConfigUse.CallsOnly);

/*
 * How wide a config's Twilio Account SID may be drawn in its row, once
 * someone switches its column on (it starts hidden): cut short with an
 * ellipsis, whole under the pointer (the table's FullValueTitle) and in the
 * config's Edit dialog. A SID is 34 characters, the widest value in the
 * row, and drawn whole it made the table wider than its card: beside the
 * page's side menu the table has 938px at a 1280px window, and the other
 * columns of a config with SMS numbers take some 700px of it. Whole from
 * 1536px on, where the table has 1194px.
 */
export const TWILIO_ACCOUNT_SID_CELL_WIDTH_CLASS_NAME: string =
  "max-w-[10rem] 2xl:max-w-[17rem]";

export interface ComponentProps {
  /*
   * How many configs the table lists after each load, so the page's folded
   * More settings can say so.
   */
  onCountChange?: ((count: number) => void) | undefined;
}

const CustomCallSMSTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Whether the project has a Twilio config, and whether the SMS and the
   * calls its configs send each have a project default among them: what
   * the card says, and what the create form starts with. Read apart from
   * the table's own list, which filters and pages can narrow - a project
   * has a handful of configs, and only what each sends and is the default
   * for is read.
   */
  const [defaultState, setDefaultState] = useState<TwilioConfigDefaultState>(
    TwilioConfigDefaultState.Unknown,
  );
  const [refreshToggle, setRefreshToggle] = useState<string>("0");

  // Only the latest read may set the state: an older one can answer last.
  const latestDefaultStateRead: MutableRefObject<number> = useRef<number>(0);

  const readDefaultState: () => Promise<void> = async (): Promise<void> => {
    latestDefaultStateRead.current += 1;
    const read: number = latestDefaultStateRead.current;

    let nextState: TwilioConfigDefaultState = TwilioConfigDefaultState.Unknown;

    try {
      const configs: ListResult<ProjectCallSMSConfig> =
        await ModelAPI.getList<ProjectCallSMSConfig>({
          modelType: ProjectCallSMSConfig,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            usedFor: true,
            isProjectDefault: true,
            isProjectDefaultForSms: true,
            isProjectDefaultForCalls: true,
          },
          sort: {},
        });

      nextState = getTwilioConfigDefaultState(configs.data);
    } catch {
      // Claims nothing: the form starts the switch off, the card says the rule.
      nextState = TwilioConfigDefaultState.Unknown;
    }

    if (read === latestDefaultStateRead.current) {
      setDefaultState(nextState);
    }
  };

  const createInitialValues: FormValues<ProjectCallSMSConfig> | undefined =
    useMemo((): FormValues<ProjectCallSMSConfig> | undefined => {
      return isDefaultSwitchOnWhenCreating(defaultState)
        ? FIRST_CONFIG_INITIAL_VALUES
        : undefined;
    }, [defaultState]);

  /*
   * Making a config the default, or stopping, writes one column, which a
   * role may be allowed to edit or not: the row actions are locked, with
   * the reason, for someone who may not, and hidden while the permissions
   * are still loading.
   */
  const setDefaultGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new ProjectCallSMSConfig(),
    "isProjectDefault",
  );

  const isDefaultActionShown: boolean =
    setDefaultGate.isAllowed || Boolean(setDefaultGate.disabledReason);

  /*
   * The one write behind every default action of a row: true makes the
   * config the default for everything it is used for, taking that - and
   * only that - from the configs that had it; false gives it all up, and
   * a default config that sends what it gave up takes it
   * (Common/Types/CallAndSMS/TwilioConfigDefaults). The server writes what
   * each config is the default for, so the rows are read again.
   */
  const saveProjectDefault: (
    item: ProjectCallSMSConfig,
    isProjectDefault: boolean,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ) => Promise<void> = async (
    item: ProjectCallSMSConfig,
    isProjectDefault: boolean,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById<ProjectCallSMSConfig>({
        modelType: ProjectCallSMSConfig,
        id: new ObjectID(item["_id"]?.toString() || ""),
        data: {
          isProjectDefault: isProjectDefault,
        },
      });

      onCompleteAction();

      setRefreshToggle((value: string): string => {
        return String(Number(value) + 1);
      });
    } catch (err) {
      onCompleteAction();
      onError(err as Error);
    }
  };

  const makeProjectDefault: (
    item: ProjectCallSMSConfig,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ) => Promise<void> = async (
    item: ProjectCallSMSConfig,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ): Promise<void> => {
    await saveProjectDefault(item, true, onCompleteAction, onError);
  };

  /*
   * "Set as Project Default" in the row's menu, named for what the config
   * would take (getSetDefaultTitle): one action for each name, each on
   * the rows it names - on every config but one that is the default for
   * everything it sends. So a config for calls only says it takes the
   * calls, and the default for SMS keeps them.
   */
  const getSetDefaultAction: (
    title: string,
  ) => ActionButtonSchema<ProjectCallSMSConfig> = (
    title: string,
  ): ActionButtonSchema<ProjectCallSMSConfig> => {
    return {
      title: title,
      buttonStyleType: ButtonStyleType.OUTLINE,
      icon: IconProp.Check,
      placement: ActionButtonPlacement.MoreMenu,
      disabled: !setDefaultGate.isAllowed,
      tooltip: setDefaultGate.disabledReason,
      isVisible: (item: ProjectCallSMSConfig): boolean => {
        return isDefaultActionShown && getSetDefaultTitle(item) === title;
      },
      onClick: makeProjectDefault,
    };
  };

  const [showCallTestModal, setShowCallTestModal] = useState<boolean>(false);
  const [showCallSuccessModal, setCallShowSuccessModal] =
    useState<boolean>(false);

  const [showSMSTestModal, setShowSMSTestModal] = useState<boolean>(false);
  const [showSMSSuccessModal, setSMSShowSuccessModal] =
    useState<boolean>(false);

  const [error, setError] = useState<string>("");

  // Locked, saying why, for someone who may not send a test (TestSendLock).
  const testSendLock: TestSendLock = getTestSendLock(
    TestSendTargets.TwilioConfig,
  );

  const [currentCallSMSTestConfig, setCurrentCallSMSTestConfig] =
    useState<ProjectCallSMSConfig | null>(null);

  const [isCallSMSTestLoading, setIsCallSMSTestLoading] =
    useState<boolean>(false);

  /*
   * The number the last test went out from, as the Notification service
   * answered it: the dialog that says it went out names it.
   */
  const [testSentFromPhoneNumber, setTestSentFromPhoneNumber] =
    useState<string>("");

  const translator: Translator = useTranslator();

  /*
   * What the dialog after a test says went out, and from which number - a
   * number that reads +447700900123 in a Persian or Arabic sentence too
   * (phoneNumberInLine).
   */
  const getTestSentDescription: (kind: TwilioTestSendKind) => string = (
    kind: TwilioTestSendKind,
  ): string => {
    const message: TwilioTestSentMessage = getTestSentMessage({
      kind: kind,
      fromPhoneNumber: testSentFromPhoneNumber,
    });

    return translator.translateTemplate(message.template, {
      phoneNumber: phoneNumberInLine(message.phoneNumber, translator.language),
    });
  };

  useEffect(() => {
    setError("");
  }, [showCallTestModal, showSMSTestModal]);

  return (
    <>
      <ModelTable<ProjectCallSMSConfig>
        modelType={ProjectCallSMSConfig}
        id="call-sms-table"
        userPreferencesKey="call-sms-table"
        refreshToggle={refreshToggle}
        onFetchSuccess={(
          _items: Array<ProjectCallSMSConfig>,
          totalCount: number,
        ): void => {
          props.onCountChange?.(totalCount);

          /*
           * A row on screen means the project has a config, so the next
           * create form is not its first's - before the count says so too.
           */
          if (totalCount > 0) {
            setDefaultState(
              (current: TwilioConfigDefaultState): TwilioConfigDefaultState => {
                return current === TwilioConfigDefaultState.NoConfigs
                  ? TwilioConfigDefaultState.Unknown
                  : current;
              },
            );
          }

          void readDefaultState();
        }}
        createInitialValues={createInitialValues}
        actionButtons={[
          {
            title: "Send Test SMS",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.SMS,
            disabled: testSendLock.isLocked,
            tooltip: testSendLock.tooltip,
            // A config used for calls only sends no SMS: nothing to test.
            isVisible: (item: ProjectCallSMSConfig): boolean => {
              return TwilioConfigUses.sendsSms(item.usedFor);
            },
            onClick: async (
              item: ProjectCallSMSConfig,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentCallSMSTestConfig(item);
                setShowSMSTestModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          {
            title: "Send Test Call",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Call,
            disabled: testSendLock.isLocked,
            tooltip: testSendLock.tooltip,
            // A config used for SMS only makes no calls: nothing to test.
            isVisible: (item: ProjectCallSMSConfig): boolean => {
              return TwilioConfigUses.makesCalls(item.usedFor);
            },
            onClick: async (
              item: ProjectCallSMSConfig,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentCallSMSTestConfig(item);
                setShowCallTestModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          /*
           * One click to send the project's SMS, its calls or both through
           * this config instead, in the ⋯ menu, so the test buttons stay
           * the row's own: "Set as Project Default", or "... for SMS" /
           * "... for Calls" where the config would take only those.
           */
          getSetDefaultAction(TwilioConfigDefaultCopy.setDefaultTitle),
          getSetDefaultAction(TwilioConfigDefaultCopy.setSmsDefaultTitle),
          getSetDefaultAction(TwilioConfigDefaultCopy.setCallsDefaultTitle),
          {
            /*
             * The default's way back, asked first: what it is the default
             * for stops going through it. The Edit form has no default
             * switch (see the switch below).
             */
            title: TwilioConfigDefaultCopy.stopDefaultTitle,
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Close,
            placement: ActionButtonPlacement.MoreMenu,
            disabled: !setDefaultGate.isAllowed,
            tooltip: setDefaultGate.disabledReason,
            isVisible: (item: ProjectCallSMSConfig): boolean => {
              return isDefaultActionShown && item.isProjectDefault === true;
            },
            getConfirmation: (
              item: ProjectCallSMSConfig,
            ): RowActionConfirmation => {
              return {
                title: translator.translateTemplate(
                  TwilioConfigDefaultCopy.stopDefaultConfirmTitle,
                  { config: item.name || "" },
                ),
                description: getStopDefaultConfirmDescription(item),
                submitButtonText:
                  TwilioConfigDefaultCopy.stopDefaultConfirmButton,
              };
            },
            onClick: async (
              item: ProjectCallSMSConfig,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): Promise<void> => {
              await saveProjectDefault(item, false, onCompleteAction, onError);
            },
          },
        ]}
        isDeleteable={true}
        /*
         * The card, its button and its dialogs name a config the way the
         * docs and the card's title do - "Create Twilio Config" - not by
         * the model's name ("Call and SMS Config").
         */
        singularName="Twilio Config"
        pluralName="Twilio Configs"
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Twilio Config",
          description: getTwilioConfigCardDescription(defaultState),
        }}
        formSteps={[
          {
            title: "Basic",
            id: "basic-info",
          },
          {
            title: "Twilio Config",
            id: "twilio-info",
          },
        ]}
        name="Settings > Custom CallSMS Config"
        noItemsMessage={"No Twilio config found."}
        selectMoreFields={{
          /*
           * The numbers the Phone Numbers column shows and counts beside
           * the primary one: the first SMS number, and how many more of
           * each kind there are - and what the config is used for, which
           * says which of them it sends from and which tests it offers.
           * And what it is the project default for, which the Project
           * Default column says and the row's ⋯ menu offers to change.
           */
          usedFor: true,
          twilioSmsPhoneNumbers: true,
          twilioSecondaryPhoneNumbers: true,
          isProjectDefaultForSms: true,
          isProjectDefaultForCalls: true,
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            // The placeholder shows one; "Friendly name for this config ..." said nothing more.
            hideColumnDescription: true,
            placeholder: "Company Twilio Account",
            stepId: "basic-info",
            validation: {
              minLength: 2,
            },
          },
          {
            /*
             * Asked first, before any number: what the account is for
             * decides which numbers the next step asks for.
             */
            field: {
              usedFor: true,
            },
            title: TwilioConfigUseCopy.fieldTitle,
            fieldType: FormFieldSchemaType.RadioButton,
            required: true,
            stepId: "basic-info",
            /*
             * Calls and SMS - what most accounts are, and every config made
             * before the choice - unless the config says otherwise.
             */
            defaultValue: TwilioConfigUse.CallsAndSms,
            // Each answer says in one line what it means.
            hideColumnDescription: true,
            radioButtonOptions: getTwilioConfigUseOptions().map(
              (option: TwilioConfigUseOption) => {
                return {
                  title: option.title,
                  description: option.description,
                  value: option.value,
                };
              },
            ),
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            stepId: "basic-info",
            hideColumnDescription: true,
            /*
             * An example that holds for every answer above it: "for SMS
             * and calls" read as a contradiction under SMS only.
             */
            placeholder: "Twilio account for on-call alerts",
          },
          {
            field: {
              twilioAccountSID: true,
            },
            title: "Twilio Account SID",
            fieldType: FormFieldSchemaType.Text,
            stepId: "twilio-info",
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
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "You can find this in your Twilio console.",
            placeholder: "",
            validation: {
              minLength: 2,
            },
          },
          /*
           * Calls and SMS: the number calls go out from, and SMS too unless
           * SMS numbers are added under More fields.
           */
          {
            field: {
              twilioPrimaryPhoneNumber: true,
            },
            title: "Twilio Primary Phone Number",
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.Phone,
            required: true,
            description: TwilioConfigNumbersCopy.primaryPhoneNumberDescription,
            placeholder: "+14155550100",
            validation: {
              minLength: 2,
            },
            showIf: isUsedForCallsAndSms,
          },
          // Calls only: the number calls go out from, and nothing for SMS.
          {
            field: {
              twilioPrimaryPhoneNumber: true,
            },
            title: "Twilio Primary Phone Number",
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.Phone,
            required: true,
            description:
              TwilioConfigUseCopy.callsOnlyPrimaryPhoneNumberDescription,
            placeholder: "+14155550100",
            validation: {
              minLength: 2,
            },
            showIf: isUsedForCallsOnly,
          },
          /*
           * SMS only: the numbers every SMS goes out from, open and
           * required - no number to make calls from is asked for.
           */
          {
            field: {
              twilioSmsPhoneNumbers: true,
            },
            title: "Twilio SMS Phone Numbers",
            stepId: "twilio-info",
            // One line: most lists hold one number or two.
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: TwilioConfigUseCopy.smsOnlyPhoneNumbersDescription,
            // The list the error under the field gives: no one country's.
            placeholder: PHONE_NUMBER_LIST_EXAMPLE,
            /*
             * A list of numbers reads left to right in every language, its
             * example with it: on a Persian or Arabic page the example's
             * "+" went after its digits (#7180).
             */
            readsLeftToRight: true,
            customValidation: (
              values: FormValues<ProjectCallSMSConfig>,
            ): string | null => {
              // Refused under the field, by the server's rule.
              return getPhoneNumberListError(values.twilioSmsPhoneNumbers);
            },
            showIf: isUsedForSmsOnly,
          },
          /*
           * On for the project's first config (createInitialValues), with
           * help that says why; off, where its column starts, for any other.
           * Its help names what goes through the config: the SMS and calls
           * of the project's people, or only the ones the config sends.
           *
           * On the create form only. Saved on, it makes the config the
           * default for everything it sends; an Edit form would send it
           * back on as it read it, and a config that is the default for
           * calls alone - beside a default for SMS only - would take the
           * SMS on every save of a new name. A config already made becomes
           * the default, or stops being one, from its row's ⋯ menu.
           */
          {
            field: {
              isProjectDefault: true,
            },
            title: TwilioConfigDefaultCopy.setDefaultTitle,
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            doNotShowWhenEditing: true,
            description: getDefaultSwitchDescription(
              defaultState,
              TwilioConfigUse.CallsAndSms,
            ),
            showIf: isUsedForCallsAndSms,
          },
          {
            field: {
              isProjectDefault: true,
            },
            title: TwilioConfigDefaultCopy.setDefaultTitle,
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            doNotShowWhenEditing: true,
            description: getDefaultSwitchDescription(
              defaultState,
              TwilioConfigUse.SmsOnly,
            ),
            showIf: isUsedForSmsOnly,
          },
          {
            field: {
              isProjectDefault: true,
            },
            title: TwilioConfigDefaultCopy.setDefaultTitle,
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            doNotShowWhenEditing: true,
            description: getDefaultSwitchDescription(
              defaultState,
              TwilioConfigUse.CallsOnly,
            ),
            showIf: isUsedForCallsOnly,
          },
          /*
           * Under More fields: the numbers SMS go out from instead, once
           * listed (Common/Types/CallAndSMS/TwilioPhoneNumbers) - for a
           * config used for calls and SMS - and numbers for other
           * countries, for any config that makes calls.
           */
          {
            field: {
              twilioSmsPhoneNumbers: true,
            },
            title: "Twilio SMS Phone Numbers",
            stepId: "twilio-info",
            // One line: most lists hold one number or two.
            fieldType: FormFieldSchemaType.Text,
            required: false,
            collapsibleSection: moreNumbersSection,
            description: TwilioConfigNumbersCopy.smsPhoneNumbersDescription,
            // The list the error under the field gives: no one country's.
            placeholder: PHONE_NUMBER_LIST_EXAMPLE,
            /*
             * A list of numbers reads left to right in every language, its
             * example with it: on a Persian or Arabic page the example's
             * "+" went after its digits (#7180).
             */
            readsLeftToRight: true,
            customValidation: (
              values: FormValues<ProjectCallSMSConfig>,
            ): string | null => {
              // Refused under the field, by the server's rule.
              return getPhoneNumberListError(values.twilioSmsPhoneNumbers);
            },
            showIf: isUsedForCallsAndSms,
          },
          {
            field: {
              twilioSecondaryPhoneNumbers: true,
            },
            title: "Twilio Secondary Phone Numbers",
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            collapsibleSection: moreNumbersSection,
            description:
              TwilioConfigNumbersCopy.secondaryPhoneNumbersDescription,
            placeholder: "+441234567890, +461234567890",
            // A list of numbers reads left to right, as the ones above.
            readsLeftToRight: true,
            customValidation: (
              values: FormValues<ProjectCallSMSConfig>,
            ): string | null => {
              return getPhoneNumberListError(
                values.twilioSecondaryPhoneNumbers,
              );
            },
            showIf: isUsedForCalls,
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            title: "Name",
            type: FieldType.Text,
            field: {
              name: true,
            },
          },
          {
            title: "Description",
            type: FieldType.LongText,
            field: {
              description: true,
            },
          },
          {
            title: "Used For",
            type: FieldType.Dropdown,
            field: {
              usedFor: true,
            },
            filterDropdownOptions: getTwilioConfigUseOptions().map(
              (option: TwilioConfigUseOption) => {
                return {
                  value: option.value,
                  label: option.title,
                };
              },
            ),
          },
          {
            title: "Twilio Account SID",
            type: FieldType.Text,
            field: {
              twilioAccountSID: true,
            },
          },
          {
            title: "Twilio Primary Phone Number",
            type: FieldType.Phone,
            field: {
              twilioPrimaryPhoneNumber: true,
            },
          },
          {
            title: "Twilio SMS Phone Numbers",
            type: FieldType.LongText,
            field: {
              twilioSmsPhoneNumbers: true,
            },
          },
          {
            title: "Twilio Secondary Phone Numbers",
            type: FieldType.LongText,
            field: {
              twilioSecondaryPhoneNumbers: true,
            },
          },
          {
            title: "Project Default",
            type: FieldType.Boolean,
            field: {
              isProjectDefault: true,
            },
          },
        ]}
        /*
         * What tells the configs apart at a glance: the name, what it is
         * used for - Calls and SMS, SMS only or Calls only, as the form's
         * first question words it - the numbers it sends from - its
         * primary number, and its first SMS number beside it when SMS have
         * their own - and whether it is the project's default. Description
         * and the other numbers are in the config's Edit dialog (and in the
         * filters).
         *
         * The Twilio account starts hidden, in the table's Customize
         * Columns: a SID is 34 characters, the widest value in the row, and
         * beside the side menu at 1280px it was cut to half under the row's
         * actions, while what a config is used for - the one answer that
         * decides what it sends - had no column at all.
         */
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              usedFor: true,
            },
            title: "Used For",
            type: FieldType.Text,
            // The answer's own words, in the reader's language.
            getElement: (item: ProjectCallSMSConfig): ReactElement => {
              const useTitle: string = getTwilioConfigUseTitle(item.usedFor);

              return (
                <span data-testid="twilio-config-used-for">
                  {translator.translateText(useTitle) || useTitle}
                </span>
              );
            },
            // As the API and the Used For filter name it.
            getExportValue: (item: ProjectCallSMSConfig): string => {
              return TwilioConfigUses.getUse(item.usedFor);
            },
          },
          {
            field: {
              twilioPrimaryPhoneNumber: true,
            },
            // Its primary number, and its first SMS number when SMS have their own.
            title: "Phone Numbers",
            type: FieldType.Phone,
            getElement: (item: ProjectCallSMSConfig): ReactElement => {
              return <TwilioConfigPhoneNumbers config={item} />;
            },
            // Every number it sends from, not only the ones the row shows.
            getExportValue: (item: ProjectCallSMSConfig): string => {
              return getTwilioConfigNumbersForExport(item);
            },
          },
          {
            field: {
              isProjectDefault: true,
            },
            title: "Project Default",
            type: FieldType.Boolean,
            /*
             * "Default", or "Default for SMS" / "Default for calls" for the
             * default for one of the two: a config for SMS only beside one
             * for calls only, both the default, each says what for.
             */
            getElement: (item: ProjectCallSMSConfig): ReactElement => {
              const pillText: string | undefined =
                getProjectDefaultPillText(item);

              if (pillText) {
                // The pill draws it in the reader's language.
                return <Pill text={pillText} color={Green} />;
              }
              return <span className="text-gray-400">-</span>;
            },
            // As the row says it.
            getExportValue: (item: ProjectCallSMSConfig): string => {
              return getProjectDefaultPillText(item) || "";
            },
          },
          {
            field: {
              twilioAccountSID: true,
            },
            title: "Twilio Account SID",
            type: FieldType.Text,
            contentClassName: TWILIO_ACCOUNT_SID_CELL_WIDTH_CLASS_NAME,
            // One switch away in Customize Columns, last when switched on.
            isHiddenByDefault: true,
          },
        ]}
      />

      {/** SMS */}

      {showSMSTestModal && currentCallSMSTestConfig ? (
        <BasicFormModal
          title={`Send Test SMS`}
          description={TwilioTestSendCopy.smsDescription}
          formProps={{
            error: error,
            fields: [
              {
                field: {
                  toPhone: true,
                },
                title: "Phone Number",
                fieldType: FormFieldSchemaType.Phone,
                required: true,
                placeholder: "+1234567890",
              },
            ],
          }}
          submitButtonText={"Send Test SMS"}
          onClose={() => {
            setShowSMSTestModal(false);
            setError("");
          }}
          isLoading={isCallSMSTestLoading}
          onSubmit={async (values: JSONObject) => {
            try {
              setIsCallSMSTestLoading(true);
              setError("");
              setTestSentFromPhoneNumber("");

              // test CallSMS config
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post<JSONObject>({
                  url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
                    `/sms/test`,
                  ),
                  data: {
                    toPhone: values["toPhone"],
                    callSMSConfigId: new ObjectID(
                      currentCallSMSTestConfig["_id"]
                        ? currentCallSMSTestConfig["_id"].toString()
                        : "",
                    ).toString(),
                  },
                  /*
                   * A custom route, so this is a raw API.post rather than
                   * ModelAPI - and BaseAPI.getHeaders() does not add a
                   * `tenantid` header. ModelAPI.getCommonHeaders() is the
                   * only thing in the codebase that does, so without it the
                   * request arrives with no project scope at all.
                   */
                  headers: ModelAPI.getCommonHeaders(),
                });

              if (response instanceof HTTPErrorResponse) {
                throw response;
              }

              // The number it went out from, which the next dialog names.
              setTestSentFromPhoneNumber(
                getTestSendFromPhoneNumber(response.data),
              );
              setIsCallSMSTestLoading(false);
              setShowSMSTestModal(false);
              setSMSShowSuccessModal(true);
            } catch (err) {
              setError(API.getFriendlyMessage(err));
              setIsCallSMSTestLoading(false);
            }
          }}
        />
      ) : (
        <></>
      )}

      {showSMSSuccessModal ? (
        <ConfirmModal
          title={TwilioTestSendCopy.smsSentTitle}
          description={getTestSentDescription(TwilioTestSendKind.SMS)}
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setSMSShowSuccessModal(false);
            setError("");
          }}
        />
      ) : (
        <></>
      )}

      {/** Call */}

      {showCallTestModal && currentCallSMSTestConfig ? (
        <BasicFormModal
          title={`Send Test Call`}
          description={TwilioTestSendCopy.callDescription}
          formProps={{
            error: error,
            fields: [
              {
                field: {
                  toPhone: true,
                },
                title: "Phone Number",
                fieldType: FormFieldSchemaType.Phone,
                required: true,
                placeholder: "+1234567890",
              },
            ],
          }}
          submitButtonText={"Send Test Call"}
          onClose={() => {
            setShowCallTestModal(false);
            setError("");
          }}
          isLoading={isCallSMSTestLoading}
          onSubmit={async (values: JSONObject) => {
            try {
              setIsCallSMSTestLoading(true);
              setError("");
              setTestSentFromPhoneNumber("");

              // test CallSMS config
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post<JSONObject>({
                  url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
                    `/call/test`,
                  ),
                  data: {
                    toPhone: values["toPhone"],
                    callSMSConfigId: new ObjectID(
                      currentCallSMSTestConfig["_id"]
                        ? currentCallSMSTestConfig["_id"].toString()
                        : "",
                    ).toString(),
                  },
                  /*
                   * A custom route, so this is a raw API.post rather than
                   * ModelAPI - and BaseAPI.getHeaders() does not add a
                   * `tenantid` header. ModelAPI.getCommonHeaders() is the
                   * only thing in the codebase that does, so without it the
                   * request arrives with no project scope at all.
                   */
                  headers: ModelAPI.getCommonHeaders(),
                });

              if (response instanceof HTTPErrorResponse) {
                throw response;
              }

              // The number it is calling from, which the next dialog names.
              setTestSentFromPhoneNumber(
                getTestSendFromPhoneNumber(response.data),
              );
              setIsCallSMSTestLoading(false);
              setShowCallTestModal(false);
              setCallShowSuccessModal(true);
            } catch (err) {
              setError(API.getFriendlyMessage(err));
              setIsCallSMSTestLoading(false);
            }
          }}
        />
      ) : (
        <></>
      )}

      {showCallSuccessModal ? (
        <ConfirmModal
          title={TwilioTestSendCopy.callPlacedTitle}
          description={getTestSentDescription(TwilioTestSendKind.Call)}
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setCallShowSuccessModal(false);
            setError("");
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default CustomCallSMSTable;
