import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import React, { Fragment, FunctionComponent, ReactElement, useState } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
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
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";

const IncomingCallPolicyView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  const [policy, setPolicy] = useState<IncomingCallPolicy | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  // Fetch policy data
  useAsyncEffect(async () => {
    try {
      setIsLoading(true);
      setError("");

      const fetchedPolicy: IncomingCallPolicy | null = await ModelAPI.getItem({
        modelType: IncomingCallPolicy,
        id: modelId,
        select: {
          routingPhoneNumber: true,
          projectCallSMSConfigId: true,
          projectCallSMSConfig: {
            name: true,
          },
        },
      });

      setPolicy(fetchedPolicy);
      setIsLoading(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  }, [modelId.toString(), refreshToggle]);

  const handlePhoneNumberChange = (): void => {
    setRefreshToggle(!refreshToggle);
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  // Determine step completion status
  const hasTwilioConfig: boolean = !!policy?.projectCallSMSConfigId;
  const hasPhoneNumber: boolean = !!policy?.routingPhoneNumber;

  // Step indicator component
  const StepIndicator = (props: {
    stepNumber: number;
    isComplete: boolean;
    isActive: boolean;
  }): ReactElement => {
    if (props.isComplete) {
      return (
        <div className="w-10 h-10 bg-green-500 text-white rounded-full flex items-center justify-center">
          <Icon icon={IconProp.Check} className="h-5 w-5" />
        </div>
      );
    }

    if (props.isActive) {
      return (
        <div className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center font-semibold">
          {props.stepNumber}
        </div>
      );
    }

    return (
      <div className="w-10 h-10 bg-gray-200 text-gray-500 rounded-full flex items-center justify-center font-semibold">
        {props.stepNumber}
      </div>
    );
  };

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

      {/* Setup Steps Card */}
      <div className="mt-5">
        <Card
          title="Phone Number Setup"
          description="Complete these steps to configure incoming call routing"
        >
          <div className="p-6 space-y-8">
            {/* Step 1: Twilio Configuration */}
            <div className="flex space-x-4">
              <div className="flex-shrink-0">
                <StepIndicator
                  stepNumber={1}
                  isComplete={hasTwilioConfig}
                  isActive={!hasTwilioConfig}
                />
              </div>
              <div className="flex-1">
                <h5 className="text-lg font-medium text-gray-900">
                  Select Twilio Configuration
                </h5>
                <p className="text-sm text-gray-600 mt-1">
                  Choose which Twilio account to use for this incoming call policy.
                </p>

                <div className="mt-4">
                  {hasTwilioConfig ? (
                    <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Icon
                            icon={IconProp.CheckCircle}
                            className="text-green-500 h-6 w-6"
                          />
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              Twilio Configuration Selected
                            </p>
                            <p className="text-sm text-green-700">
                              {policy?.projectCallSMSConfig?.name}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Alert
                      type={AlertType.WARNING}
                      strongTitle="No Twilio Configuration"
                      title={
                        <span>
                          You need to create a Twilio configuration first. Go to{" "}
                          <Link
                            to={RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route}
                            className="text-blue-600 hover:underline font-medium"
                          >
                            Project Settings → Notification Settings
                          </Link>{" "}
                          to add your Twilio Account SID and Auth Token.
                        </span>
                      }
                    />
                  )}

                  <div className="mt-4">
                    <CardModelDetail<IncomingCallPolicy>
                      name="Twilio Config Selection"
                      editButtonText={hasTwilioConfig ? "Change Configuration" : "Select Configuration"}
                      cardProps={{
                        title: "",
                        description: "",
                      }}
                      isEditable={true}
                      onSaveSuccess={() => {
                        setRefreshToggle(!refreshToggle);
                      }}
                      formFields={[
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
                            "Select the Twilio configuration to use for this policy.",
                        },
                      ]}
                      modelDetailProps={{
                        showDetailsInNumberOfColumns: 1,
                        modelType: IncomingCallPolicy,
                        id: "model-detail-twilio-config-select",
                        fields: [],
                        modelId: modelId,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Connector Line */}
            <div className="ml-5 border-l-2 border-gray-200 h-4"></div>

            {/* Step 2: Phone Number */}
            <div className="flex space-x-4">
              <div className="flex-shrink-0">
                <StepIndicator
                  stepNumber={2}
                  isComplete={hasPhoneNumber}
                  isActive={hasTwilioConfig && !hasPhoneNumber}
                />
              </div>
              <div className="flex-1">
                <h5 className="text-lg font-medium text-gray-900">
                  Configure Phone Number
                </h5>
                <p className="text-sm text-gray-600 mt-1">
                  Use an existing phone number from your Twilio account or purchase a new one.
                </p>

                <div className="mt-4">
                  {!hasTwilioConfig ? (
                    <div className="p-4 bg-gray-100 rounded-lg border border-gray-200">
                      <p className="text-sm text-gray-500 flex items-center">
                        <Icon
                          icon={IconProp.Lock}
                          className="h-4 w-4 mr-2"
                        />
                        Complete Step 1 first to configure a phone number.
                      </p>
                    </div>
                  ) : (
                    <PhoneNumberPurchase
                      projectId={projectId}
                      incomingCallPolicyId={modelId}
                      projectCallSMSConfigId={policy?.projectCallSMSConfigId}
                      currentPhoneNumber={policy?.routingPhoneNumber?.toString()}
                      onPhoneNumberPurchased={handlePhoneNumberChange}
                      onPhoneNumberReleased={handlePhoneNumberChange}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Connector Line */}
            <div className="ml-5 border-l-2 border-gray-200 h-4"></div>

            {/* Step 3: Escalation Rules */}
            <div className="flex space-x-4">
              <div className="flex-shrink-0">
                <StepIndicator
                  stepNumber={3}
                  isComplete={false}
                  isActive={hasPhoneNumber}
                />
              </div>
              <div className="flex-1">
                <h5 className="text-lg font-medium text-gray-900">
                  Add Escalation Rules
                </h5>
                <p className="text-sm text-gray-600 mt-1">
                  Define how incoming calls should be routed to your on-call team.
                </p>

                <div className="mt-4">
                  {!hasPhoneNumber ? (
                    <div className="p-4 bg-gray-100 rounded-lg border border-gray-200">
                      <p className="text-sm text-gray-500 flex items-center">
                        <Icon
                          icon={IconProp.Lock}
                          className="h-4 w-4 mr-2"
                        />
                        Complete Step 2 first to add escalation rules.
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            Configure who receives incoming calls
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            Add on-call schedules, teams, or specific users to handle incoming calls.
                          </p>
                        </div>
                        <Button
                          title="Add Escalation Rules"
                          buttonStyle={ButtonStyleType.PRIMARY}
                          icon={IconProp.Add}
                          onClick={() => {
                            Navigation.navigate(
                              RouteUtil.populateRouteParams(
                                RouteMap[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION] as Route,
                                { modelId: modelId }
                              )
                            );
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Summary Card - Only show when all steps are complete */}
      {hasTwilioConfig && hasPhoneNumber && (
        <div className="mt-5">
          <Card
            title="Setup Complete"
            description="Your incoming call policy is ready to receive calls"
          >
            <div className="p-6">
              <div className="flex items-center space-x-4 p-4 bg-green-50 rounded-lg border border-green-200">
                <Icon
                  icon={IconProp.CheckCircle}
                  className="text-green-500 h-8 w-8"
                />
                <div>
                  <p className="font-medium text-gray-900">
                    Callers can reach your team at:
                  </p>
                  <p className="text-xl font-bold text-green-700">
                    {policy?.routingPhoneNumber?.toString()}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm text-gray-600">
                Make sure you have added escalation rules so calls can be routed to your on-call team.
              </p>
            </div>
          </Card>
        </div>
      )}
    </Fragment>
  );
};

export default IncomingCallPolicyView;
