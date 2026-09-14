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
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Label from "Common/Models/DatabaseModels/Label";
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

const IncomingCallPolicyView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
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

  return (
    <Fragment>
      {/* Policy Details Card */}
      <CardModelDetail<IncomingCallPolicy>
        name="Incoming Call Policy > Details"
        cardProps={{
          title: "Incoming Call Policy Details",
          description: "Here are more details for this incoming call policy.",
        }}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Policy Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            stepId: "labels",
            description:
              "Team members with access to these labels will only be able to access this resource.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
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

      {/* Show either Setup Steps Card OR Completed Configuration Card */}
      {!isSetupComplete ? (
        /* Setup Steps Card - shown when setup is incomplete */
        <div className="mt-5">
          <Card
            title="Setup"
            description="Complete these steps to configure your incoming call policy"
          >
            <div className="p-6 space-y-6">
              {/* Step 1: Twilio Configuration */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 text-gray-700 font-semibold text-sm">
                    1
                  </div>
                  {hasTwilioConfig ? (
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
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
                          Twilio configuration selected
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                        <Icon
                          icon={IconProp.ExclaimationCircle}
                          className="h-6 w-6 text-yellow-600"
                        />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          Select Twilio Configuration
                        </p>
                        <p className="text-sm text-gray-500">
                          Choose which Twilio account to use or{" "}
                          <Link
                            to={
                              RouteMap[
                                PageMap.SETTINGS_NOTIFICATION_SETTINGS
                              ] as Route
                            }
                            className="text-blue-600 hover:underline"
                          >
                            create one in Project Settings
                          </Link>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                {hasPhoneNumbers ? (
                  <p className="text-xs text-gray-400 text-right">
                    Remove all phone numbers to change
                  </p>
                ) : (
                  <Button
                    title={hasTwilioConfig ? "Change" : "Select"}
                    buttonStyle={
                      hasTwilioConfig
                        ? ButtonStyleType.SECONDARY_LINK
                        : ButtonStyleType.PRIMARY
                    }
                    onClick={() => {
                      setShowTwilioConfigModal(true);
                    }}
                  />
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-gray-200" />

              {/* Step 2: Phone Number */}
              <div className="flex items-start space-x-4">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full font-semibold text-sm flex-shrink-0 ${!hasTwilioConfig ? "bg-gray-100 text-gray-400" : "bg-gray-200 text-gray-700"}`}
                >
                  2
                </div>
                {!hasTwilioConfig && !hasPhoneNumbers ? (
                  <div className="flex items-center space-x-3 text-gray-400 pt-1">
                    <Icon icon={IconProp.Lock} className="h-5 w-5" />
                    <p>Complete Step 1 to add phone numbers</p>
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
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full font-semibold text-sm ${!hasPhoneNumbers ? "bg-gray-100 text-gray-400" : "bg-gray-200 text-gray-700"}`}
                  >
                    3
                  </div>
                  {!hasPhoneNumbers ? (
                    <div className="flex items-center space-x-3 text-gray-400">
                      <Icon icon={IconProp.Lock} className="h-5 w-5" />
                      <p>Complete Step 2 to add escalation rules</p>
                    </div>
                  ) : hasEscalationRules ? (
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                        <Icon
                          icon={IconProp.CheckCircle}
                          className="h-6 w-6 text-green-600"
                        />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          Escalation Rules
                        </p>
                        <p className="text-sm text-green-600">
                          {escalationRulesCount} rule
                          {escalationRulesCount !== 1 ? "s" : ""} configured
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                        <Icon
                          icon={IconProp.ExclaimationCircle}
                          className="h-6 w-6 text-yellow-600"
                        />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          Escalation Rules
                        </p>
                        <p className="text-sm text-gray-500">
                          Add on-call schedules, teams, or users to handle
                          incoming calls
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                {hasPhoneNumbers && (
                  <Button
                    title="Manage Rules"
                    buttonStyle={
                      hasEscalationRules
                        ? ButtonStyleType.SECONDARY_LINK
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
                )}
              </div>
            </div>
          </Card>
        </div>
      ) : (
        /* Completed Configuration Card - shown when setup is complete */
        <div className="mt-5">
          <Card
            title="Phone Numbers & Twilio Configuration"
            description="Your incoming call policy is configured and ready to receive calls"
          >
            <div className="p-6 space-y-6">
              {/* Twilio Configuration Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Icon
                      icon={IconProp.Settings}
                      className="h-5 w-5 text-blue-600"
                    />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">
                      Twilio Configuration
                    </p>
                    <p className="font-medium text-gray-900">
                      {policy?.projectCallSMSConfig?.name}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  Remove all phone numbers to change
                </p>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-200" />

              {/* Phone Numbers Row */}
              <div className="flex items-start space-x-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Icon
                    icon={IconProp.Call}
                    className="h-5 w-5 text-green-600"
                  />
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
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                    <Icon
                      icon={IconProp.BarsArrowDown}
                      className="h-5 w-5 text-purple-600"
                    />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Escalation Rules</p>
                    <p className="font-medium text-gray-900">
                      {escalationRulesCount} rule
                      {escalationRulesCount !== 1 ? "s" : ""} configured
                    </p>
                  </div>
                </div>
                <Button
                  title="Manage Rules"
                  buttonStyle={ButtonStyleType.SECONDARY_LINK}
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
            </div>
          </Card>
        </div>
      )}

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
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route,
                ),
              );
            }}
          >
            <Alert
              type={AlertType.WARNING}
              title="You need to add a Twilio configuration before you can use this feature. Go to Project Settings → Call & SMS to add your Twilio Account SID and Auth Token."
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
            description="Choose which Twilio account to use for this incoming call policy"
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
