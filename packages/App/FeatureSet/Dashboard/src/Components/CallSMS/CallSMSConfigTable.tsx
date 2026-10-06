import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { Green } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { NOTIFICATION_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import TwilioConfigDefaultCopy, {
  TwilioConfigDefaultState,
  getDefaultSwitchDescription,
  getTwilioConfigCardDescription,
  getTwilioConfigDefaultState,
  isDefaultSwitchOnWhenCreating,
} from "./TwilioConfigDefaultCopy";
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

const CustomCallSMSTable: FunctionComponent = (): ReactElement => {
  /*
   * Whether the project has a Twilio config, and whether one of them is the
   * default: what the card says, and what the create form starts with.
   * Counted apart from the table's own list, which filters can narrow.
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
      const [configCount, defaultCount]: [number, number] = await Promise.all([
        ModelAPI.count<ProjectCallSMSConfig>({
          modelType: ProjectCallSMSConfig,
          query: {},
        }),
        ModelAPI.count<ProjectCallSMSConfig>({
          modelType: ProjectCallSMSConfig,
          query: {
            isProjectDefault: true,
          },
        }),
      ]);

      nextState = getTwilioConfigDefaultState({ configCount, defaultCount });
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
   * Making a config the default writes one column, which a role may be
   * allowed to edit or not: the row action is locked, with the reason, for
   * someone who may not, and hidden while the permissions are still loading.
   */
  const setDefaultGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new ProjectCallSMSConfig(),
    "isProjectDefault",
  );

  const makeProjectDefault: (
    item: ProjectCallSMSConfig,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ) => Promise<void> = async (
    item: ProjectCallSMSConfig,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ): Promise<void> => {
    try {
      // The server takes the default from the config that had it.
      await ModelAPI.updateById<ProjectCallSMSConfig>({
        modelType: ProjectCallSMSConfig,
        id: new ObjectID(item["_id"]?.toString() || ""),
        data: {
          isProjectDefault: true,
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
          {
            /*
             * One click to send the project's SMS and calls through this
             * config instead: on every row but the default's, in the ⋯
             * menu, so the test buttons stay the row's own.
             */
            title: TwilioConfigDefaultCopy.setDefaultTitle,
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Check,
            placement: ActionButtonPlacement.MoreMenu,
            disabled: !setDefaultGate.isAllowed,
            tooltip: setDefaultGate.disabledReason,
            isVisible: (item: ProjectCallSMSConfig): boolean => {
              return (
                !item.isProjectDefault &&
                (setDefaultGate.isAllowed ||
                  Boolean(setDefaultGate.disabledReason))
              );
            },
            onClick: makeProjectDefault,
          },
        ]}
        isDeleteable={true}
        createVerb="Create Twilio Config"
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
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description:
              "Friendly name for this config so you remember what this is about.",
            placeholder: "Company CallSMS Server",
            stepId: "basic-info",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            stepId: "basic-info",
            description:
              "Friendly description for this config so you remember what this is about.",
            placeholder: "Company CallSMS server hosted on AWS",
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
          {
            field: {
              twilioPrimaryPhoneNumber: true,
            },
            title: "Twilio Primary Phone Number",
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.Phone,
            required: true,
            description: "You can find this in your Twilio console.",
            placeholder: "",
            validation: {
              minLength: 2,
            },
          },

          // add twilioSecondaryPhoneNumbers
          {
            field: {
              twilioSecondaryPhoneNumbers: true,
            },
            title: "Twilio Secondary Phone Numbers",
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            description:
              "If you have multiple phone numbers, add them here. These numbers will be used to send SMS and make calls if the country code matches instead of primary phone number. If the country code does not match, then primary phone number will be used.",
            placeholder: "+441234567890, +461234567890",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              isProjectDefault: true,
            },
            title: TwilioConfigDefaultCopy.setDefaultTitle,
            stepId: "twilio-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            /*
             * On for the project's first config (createInitialValues), with
             * help that says why; off, where its column starts, for any other.
             */
            description: getDefaultSwitchDescription(defaultState),
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
            title: "Twilio Secondary Primary Phone Numbers",
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
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              twilioAccountSID: true,
            },
            title: "Twilio Account SID",
            type: FieldType.Text,
          },
          {
            field: {
              twilioPrimaryPhoneNumber: true,
            },
            title: "Primary Twilio Phone Number",
            type: FieldType.Phone,
          },
          {
            field: {
              twilioSecondaryPhoneNumbers: true,
            },
            title: "Secondary Twilio Phone Number",
            type: FieldType.LongText,
          },
          {
            field: {
              isProjectDefault: true,
            },
            title: "Project Default",
            type: FieldType.Boolean,
            getElement: (item: ProjectCallSMSConfig): ReactElement => {
              if (item.isProjectDefault) {
                return <Pill text="Default" color={Green} />;
              }
              return <span className="text-gray-400">-</span>;
            },
          },
        ]}
      />

      {/** SMS */}

      {showSMSTestModal && currentCallSMSTestConfig ? (
        <BasicFormModal
          title={`Send Test SMS`}
          description={`Send a test sms to verify your twilio config.`}
          formProps={{
            error: error,
            fields: [
              {
                field: {
                  toPhone: true,
                },
                title: "Phone Number",
                description: "Phone number to send test sms to.",
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

              // test CallSMS config
              const response:
                | HTTPResponse<EmptyResponseData>
                | HTTPErrorResponse = await API.post({
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
                 * `tenantid` header. ModelAPI.getCommonHeaders() is the only
                 * thing in the codebase that does, so without it the request
                 * arrives with no project scope at all.
                 */
                headers: ModelAPI.getCommonHeaders(),
              });
              if (response.isSuccess()) {
                setIsCallSMSTestLoading(false);
                setShowSMSTestModal(false);
                setSMSShowSuccessModal(true);
              }

              if (response instanceof HTTPErrorResponse) {
                throw response;
              }
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
          title={`SMS Sent`}
          error={
            error ===
            "Error connecting to server. Please try again in few minutes."
              ? "Request timed out. Please check your twilio credentials and make sure they are correct."
              : error
          }
          description={`SMS sent successfully. It should take couple of minutes to arrive, please don't forget to check spam.`}
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
          description={`Send a test call to verify your twilio config.`}
          formProps={{
            error: error,
            fields: [
              {
                field: {
                  toPhone: true,
                },
                title: "Phone Number",
                description: "Phone number to send test call to.",
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

              // test CallSMS config
              const response:
                | HTTPResponse<EmptyResponseData>
                | HTTPErrorResponse = await API.post({
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
                 * `tenantid` header. ModelAPI.getCommonHeaders() is the only
                 * thing in the codebase that does, so without it the request
                 * arrives with no project scope at all.
                 */
                headers: ModelAPI.getCommonHeaders(),
              });
              if (response.isSuccess()) {
                setIsCallSMSTestLoading(false);
                setShowCallTestModal(false);
                setCallShowSuccessModal(true);
              }

              if (response instanceof HTTPErrorResponse) {
                throw response;
              }
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
          title={`Call Sent`}
          error={
            error ===
            "Error connecting to server. Please try again in few minutes."
              ? "Request timed out. Please check your twilio credentials and make sure they are correct."
              : error
          }
          description={`Call sent successfully. It should take couple of minutes to arrive, please don't forget to check spam.`}
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
