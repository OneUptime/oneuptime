import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import PhoneNumberPurchase from "../../../Components/CallSMS/PhoneNumberPurchase";
import ProjectUtil from "Common/UI/Utils/Project";
import useAsyncEffect from "use-async-effect";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import Modal from "Common/UI/Components/Modal/Modal";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { includeLegacyIncomingCallPolicyPhoneNumber } from "../../../Components/CallSMS/IncomingCallPolicyPhoneNumberUtil";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import IncomingCallAnswerCallsOffBanner from "../../../Components/IncomingCallPolicy/IncomingCallAnswerCallsOffBanner";
import { TWILIO_CONFIG_PLACE } from "../../../Components/NotificationMethods/OwnSendersFold";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";

const IncomingCallPolicyView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  const [policy, setPolicy] = useState<IncomingCallPolicy | null>(null);
  const [phoneNumbers, setPhoneNumbers] = useState<
    Array<IncomingCallPolicyPhoneNumber>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  const [showTwilioConfigModal, setShowTwilioConfigModal] =
    useState<boolean>(false);
  const [twilioConfigCount, setTwilioConfigCount] = useState<number | null>(
    null,
  );
  const [isLoadingTwilioConfigs, setIsLoadingTwilioConfigs] =
    useState<boolean>(false);
  const [escalationRulesCount, setEscalationRulesCount] = useState<number>(0);
  /*
   * Whether the policy answers calls (its Answer Calls switch, isEnabled).
   * Off, the page opens with a banner that turns calls back on in place;
   * a policy whose switch could not be read is not called off.
   */
  const [isAnsweringCalls, setIsAnsweringCalls] = useState<boolean>(true);
  // Toggled to read the details card again: its Status follows the switch.
  const [detailsRefresher, setDetailsRefresher] = useState<boolean>(false);

  // Fetch policy data and escalation rules count
  useAsyncEffect(async () => {
    try {
      setIsLoading(true);
      setError("");

      // Fetch the policy, escalation rules, and all attached numbers in parallel.
      const [fetchedPolicy, rulesCount, fetchedPhoneNumbers] =
        await Promise.all([
          ModelAPI.getItem({
            modelType: IncomingCallPolicy,
            id: modelId,
            select: {
              isEnabled: true,
              projectCallSMSConfigId: true,
              projectCallSMSConfig: {
                name: true,
              },
              projectId: true,
              routingPhoneNumber: true,
              callProviderPhoneNumberId: true,
              phoneNumberCountryCode: true,
              phoneNumberAreaCode: true,
              phoneNumberPurchasedAt: true,
            },
          }),
          ModelAPI.count({
            modelType: IncomingCallPolicyEscalationRule,
            query: {
              incomingCallPolicyId: modelId,
              projectId: projectId,
            },
          }),
          ModelAPI.getList<IncomingCallPolicyPhoneNumber>({
            modelType: IncomingCallPolicyPhoneNumber,
            query: {
              incomingCallPolicyId: modelId,
              projectId: projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              incomingCallPolicyId: true,
              phoneNumber: true,
              callProviderPhoneNumberId: true,
              countryCode: true,
              areaCode: true,
              phoneNumberPurchasedAt: true,
            },
            sort: {
              phoneNumberPurchasedAt: SortOrder.Ascending,
            },
          }),
        ]);

      setPolicy(fetchedPolicy);
      setIsAnsweringCalls(fetchedPolicy?.isEnabled !== false);
      setEscalationRulesCount(rulesCount);
      setPhoneNumbers(
        fetchedPolicy
          ? includeLegacyIncomingCallPolicyPhoneNumber(
              fetchedPhoneNumbers.data,
              fetchedPolicy,
            )
          : fetchedPhoneNumbers.data,
      );
      setIsLoading(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  }, [modelId.toString(), refreshToggle]);

  const handlePhoneNumberChange: () => void = (): void => {
    setRefreshToggle((currentValue: boolean): boolean => {
      return !currentValue;
    });
  };

  // Fetch Twilio config count when modal opens
  useAsyncEffect(async () => {
    if (!showTwilioConfigModal) {
      return;
    }

    try {
      setIsLoadingTwilioConfigs(true);
      const count: number = await ModelAPI.count({
        modelType: ProjectCallSMSConfig,
        query: {},
      });
      setTwilioConfigCount(count);
    } catch {
      setTwilioConfigCount(0);
    } finally {
      setIsLoadingTwilioConfigs(false);
    }
  }, [showTwilioConfigModal]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  // Determine step completion status
  const hasTwilioConfig: boolean = Boolean(policy?.projectCallSMSConfigId);
  const hasPhoneNumbers: boolean = phoneNumbers.length > 0;
  const hasEscalationRules: boolean = escalationRulesCount > 0;
  const isSetupComplete: boolean =
    hasTwilioConfig && hasPhoneNumbers && hasEscalationRules;

  const detailsCard: ReactElement = (
    <CardModelDetail<IncomingCallPolicy>
      name="Incoming Call Policy > Details"
      cardProps={{
        title: "Incoming Call Policy Details",
      }}
      refresher={detailsRefresher}
      isEditable={true}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g., Production Support Hotline",
          hideColumnDescription: true,
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
          placeholder: "Description",
          hideColumnDescription: true,
        },
        getLabelsFormField<IncomingCallPolicy>(),
      ]}
      modelDetailProps={{
        modelType: IncomingCallPolicy,
        id: "model-detail-incoming-call-policy",
        fields: [
          {
            field: {
              _id: true,
            },
            title: "Incoming Call Policy ID",
            // The card's ID line, not a field of raw text.
            fieldType: FieldType.ObjectID,
          },
          {
            field: {
              name: true,
            },
            title: "Name",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            getElement: (item: IncomingCallPolicy): ReactElement => {
              if (item.isEnabled) {
                return <Pill text="Enabled" color={Green} />;
              }
              return <Pill text="Disabled" color={Red} />;
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            getElement: (item: IncomingCallPolicy): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ],
        modelId: modelId,
      }}
    />
  );

  /*
   * While a step is left, the Setup card comes first: it is the one thing to
   * do on a new policy, and it used to sit under the details of a policy
   * that has none yet. Once every step is done, the details lead and the
   * card shows what is set up.
   */
  const setupCard: ReactElement = !isSetupComplete ? (
    <Card
      title="Setup"
      description="Three steps, in order, before this policy can take calls."
    >
      <div className="space-y-6 pt-2">
        {/* Step 1: Twilio Configuration */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex items-center justify-center w-8 h-8 shrink-0 rounded-full bg-gray-200 text-gray-700 font-semibold text-sm">
              1
            </div>
            {hasTwilioConfig ? (
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-10 h-10 shrink-0 bg-green-100 rounded-full flex items-center justify-center">
                  <Icon
                    icon={IconProp.CheckCircle}
                    className="h-6 w-6 text-green-600"
                  />
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {policy?.projectCallSMSConfig?.name}
                  </p>
                  <p className="text-sm text-green-600">
                    {translator.translateText("Twilio configuration selected")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-10 h-10 shrink-0 bg-yellow-100 rounded-full flex items-center justify-center">
                  <Icon
                    icon={IconProp.ExclaimationCircle}
                    className="h-6 w-6 text-yellow-600"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {translator.translateText("Select Twilio Configuration")}
                  </p>
                  <p className="text-sm text-gray-500">
                    <TranslatedSentence
                      template="Choose which Twilio account to use or {{createLink}}"
                      slots={{
                        createLink: (
                          <Link
                            to={getRouteToPageAnchor(
                              RouteUtil.populateRouteParams(
                                RouteMap[
                                  PageMap.SETTINGS_NOTIFICATION_SETTINGS
                                ] as Route,
                              ),
                              /*
                               * The Twilio Config table waits folded under
                               * the page's More settings: this opens it.
                               */
                              TWILIO_CONFIG_PLACE,
                            )}
                            className="text-blue-600 hover:underline"
                          >
                            {translator.translateText(
                              "create one in Project Settings",
                            )}
                          </Link>
                        ),
                      }}
                    />
                  </p>
                </div>
              </div>
            )}
          </div>
          {hasPhoneNumbers ? (
            <p className="ml-auto text-xs text-gray-500 text-right">
              {translator.translateText("Remove all phone numbers to change")}
            </p>
          ) : (
            <div className="ml-auto shrink-0">
              <Button
                title={hasTwilioConfig ? "Change" : "Select"}
                buttonStyle={
                  hasTwilioConfig
                    ? ButtonStyleType.NORMAL
                    : ButtonStyleType.PRIMARY
                }
                onClick={() => {
                  setShowTwilioConfigModal(true);
                }}
              />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200" />

        {/* Step 2: Phone Number */}
        <div className="flex items-start gap-4">
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full font-semibold text-sm flex-shrink-0 ${!hasTwilioConfig ? "bg-gray-100 text-gray-400" : "bg-gray-200 text-gray-700"}`}
          >
            2
          </div>
          {!hasTwilioConfig && !hasPhoneNumbers ? (
            <div className="flex min-w-0 items-center gap-3 text-gray-400 pt-1">
              <Icon icon={IconProp.Lock} className="h-5 w-5 shrink-0" />
              <p>
                {translator.translateText(
                  "Complete Step 1 to add phone numbers",
                )}
              </p>
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <PhoneNumberPurchase
                projectId={projectId}
                incomingCallPolicyId={modelId}
                projectCallSMSConfigId={policy?.projectCallSMSConfigId}
                phoneNumbers={phoneNumbers}
                onPhoneNumbersChanged={handlePhoneNumberChange}
                hideCard={true}
              />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200" />

        {/* Step 3: Escalation Rules */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className={`flex items-center justify-center w-8 h-8 shrink-0 rounded-full font-semibold text-sm ${!hasPhoneNumbers ? "bg-gray-100 text-gray-400" : "bg-gray-200 text-gray-700"}`}
            >
              3
            </div>
            {!hasPhoneNumbers ? (
              <div className="flex min-w-0 items-center gap-3 text-gray-400">
                <Icon icon={IconProp.Lock} className="h-5 w-5 shrink-0" />
                <p>
                  {translator.translateText(
                    "Complete Step 2 to add escalation rules",
                  )}
                </p>
              </div>
            ) : hasEscalationRules ? (
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-10 h-10 shrink-0 bg-green-100 rounded-full flex items-center justify-center">
                  <Icon
                    icon={IconProp.CheckCircle}
                    className="h-6 w-6 text-green-600"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {translator.translateText("Escalation Rules")}
                  </p>
                  <p className="text-sm text-green-600">
                    {translator.translatePlural(
                      {
                        one: "{{count}} rule configured",
                        other: "{{count}} rules configured",
                      },
                      escalationRulesCount,
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-10 h-10 shrink-0 bg-yellow-100 rounded-full flex items-center justify-center">
                  <Icon
                    icon={IconProp.ExclaimationCircle}
                    className="h-6 w-6 text-yellow-600"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {translator.translateText("Escalation Rules")}
                  </p>
                  <p className="text-sm text-gray-500">
                    {translator.translateText(
                      "Add the on-call schedules or people to call when someone dials this number.",
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
          {hasPhoneNumbers && (
            <div className="ml-auto shrink-0">
              <Button
                title="Manage Rules"
                buttonStyle={
                  hasEscalationRules
                    ? ButtonStyleType.NORMAL
                    : ButtonStyleType.PRIMARY
                }
                icon={IconProp.ArrowCircleRight}
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[
                        PageMap
                          .ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION
                      ] as Route,
                      { modelId: modelId },
                    ),
                  );
                }}
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  ) : (
    <Card
      title="Phone Numbers & Twilio Configuration"
      description="Calls to these numbers ring the people its escalation rules name."
    >
      {/*
       * Each row wraps on a phone - its note or button under it, at the
       * right - and drops its icon there, which only decorates: the rows
       * used to squeeze their words into a column a word or two wide.
       */}
      <div className="space-y-6 pt-2">
        {/* Twilio Configuration Row */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-10 h-10 shrink-0 bg-blue-100 rounded-full flex items-center justify-center max-sm:hidden">
              <Icon
                icon={IconProp.Settings}
                className="h-5 w-5 text-blue-600"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">
                {translator.translateText("Twilio Configuration")}
              </p>
              <p className="font-medium text-gray-900">
                {policy?.projectCallSMSConfig?.name}
              </p>
            </div>
          </div>
          <p className="ml-auto text-xs text-gray-500">
            {translator.translateText("Remove all phone numbers to change")}
          </p>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200" />

        {/* Phone Numbers Row */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 max-sm:hidden">
            <Icon icon={IconProp.Call} className="h-5 w-5 text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <PhoneNumberPurchase
              projectId={projectId}
              incomingCallPolicyId={modelId}
              projectCallSMSConfigId={policy?.projectCallSMSConfigId}
              phoneNumbers={phoneNumbers}
              onPhoneNumbersChanged={handlePhoneNumberChange}
              hideCard={true}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200" />

        {/* Escalation Rules Row */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-10 h-10 shrink-0 bg-purple-100 rounded-full flex items-center justify-center max-sm:hidden">
              <Icon
                icon={IconProp.BarsArrowDown}
                className="h-5 w-5 text-purple-600"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">
                {translator.translateText("Escalation Rules")}
              </p>
              <p className="font-medium text-gray-900">
                {translator.translatePlural(
                  {
                    one: "{{count}} rule configured",
                    other: "{{count}} rules configured",
                  },
                  escalationRulesCount,
                )}
              </p>
            </div>
          </div>
          <div className="ml-auto shrink-0">
            <Button
              title="Manage Rules"
              buttonStyle={ButtonStyleType.NORMAL}
              icon={IconProp.ArrowCircleRight}
              onClick={() => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[
                      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION
                    ] as Route,
                    { modelId: modelId },
                  ),
                );
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );

  return (
    <Fragment>
      {!isAnsweringCalls ? (
        <IncomingCallAnswerCallsOffBanner
          policyId={modelId}
          onStartedAnswering={() => {
            setIsAnsweringCalls(true);
            setDetailsRefresher((currentValue: boolean): boolean => {
              return !currentValue;
            });
          }}
        />
      ) : (
        <></>
      )}

      {isSetupComplete ? detailsCard : setupCard}

      <div className="mt-5">{isSetupComplete ? setupCard : detailsCard}</div>

      {/* Twilio Configuration Modal - No Configs Warning */}
      {showTwilioConfigModal &&
        !isLoadingTwilioConfigs &&
        twilioConfigCount === 0 && (
          <Modal
            title="No Twilio Configuration Found"
            onClose={() => {
              setShowTwilioConfigModal(false);
            }}
            submitButtonText="Go to Settings"
            onSubmit={() => {
              // At the Twilio Config table, folded under More settings.
              Navigation.navigate(
                getRouteToPageAnchor(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route,
                  ),
                  TWILIO_CONFIG_PLACE,
                ),
              );
            }}
          >
            <Alert
              type={AlertType.WARNING}
              title="Add a Twilio configuration first, under Project Settings > Notifications > Notification Settings."
            />
          </Modal>
        )}

      {/* Twilio Configuration Modal - Loading */}
      {showTwilioConfigModal && isLoadingTwilioConfigs && (
        <Modal
          title="Select Twilio Configuration"
          onClose={() => {
            setShowTwilioConfigModal(false);
          }}
        >
          <PageLoader isVisible={true} />
        </Modal>
      )}

      {/* Twilio Configuration Modal - Form */}
      {showTwilioConfigModal &&
        !isLoadingTwilioConfigs &&
        twilioConfigCount !== null &&
        twilioConfigCount > 0 && (
          <ModelFormModal<IncomingCallPolicy>
            title="Select Twilio Configuration"
            description="The Twilio account this policy's numbers and calls run on."
            modelType={IncomingCallPolicy}
            modelIdToEdit={modelId}
            name="Select Twilio Config"
            onClose={() => {
              setShowTwilioConfigModal(false);
            }}
            submitButtonText="Save"
            onSuccess={() => {
              setShowTwilioConfigModal(false);
              setRefreshToggle(!refreshToggle);
            }}
            formProps={{
              modelType: IncomingCallPolicy,
              id: "twilio-config-form",
              formType: FormType.Update,
              fields: [
                {
                  field: {
                    projectCallSMSConfig: true,
                  },
                  title: "Twilio Configuration",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: ProjectCallSMSConfig,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: true,
                  description:
                    "Select the Twilio configuration to use for incoming calls.",
                },
              ],
            }}
          />
        )}
    </Fragment>
  );
};

export default IncomingCallPolicyView;
