import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import RouteMap from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";

const IncomingCallPolicyView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

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

      {/* Phone Number Routing Card */}
      <div className="mt-5">
        <Card
          title="Phone Number Routing"
          description="Configure a phone number for incoming calls to route to your on-call team"
        >
          <div className="p-6">
            {/* Current Status */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Current Status</h4>
              <CardModelDetail<IncomingCallPolicy>
                name="Phone Number Status"
                cardProps={{
                  title: "",
                  description: "",
                }}
                isEditable={false}
                formFields={[]}
                modelDetailProps={{
                  showDetailsInNumberOfColumns: 1,
                  modelType: IncomingCallPolicy,
                  id: "model-detail-phone-number-status",
                  fields: [
                    {
                      field: {
                        routingPhoneNumber: true,
                      },
                      title: "Phone Number",
                      fieldType: FieldType.Phone,
                      getElement: (item: IncomingCallPolicy): ReactElement => {
                        if (item.routingPhoneNumber) {
                          return (
                            <div className="flex items-center space-x-2">
                              <Icon icon={IconProp.CheckCircle} className="text-green-500 h-5 w-5" />
                              <span className="font-medium">{item.routingPhoneNumber.toString()}</span>
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-center space-x-2">
                            <Icon icon={IconProp.ExclaimationCircle} className="text-yellow-500 h-5 w-5" />
                            <span className="text-gray-500">No phone number configured - follow the steps below</span>
                          </div>
                        );
                      },
                    },
                    {
                      field: {
                        projectCallSMSConfig: {
                          name: true,
                        },
                      },
                      title: "Twilio Configuration",
                      getElement: (item: IncomingCallPolicy): ReactElement => {
                        if (item.projectCallSMSConfig?.name) {
                          return (
                            <div className="flex items-center space-x-2">
                              <Icon icon={IconProp.CheckCircle} className="text-green-500 h-5 w-5" />
                              <span>{item.projectCallSMSConfig.name}</span>
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-center space-x-2">
                            <Icon icon={IconProp.ExclaimationCircle} className="text-yellow-500 h-5 w-5" />
                            <span className="text-gray-500">Not configured</span>
                          </div>
                        );
                      },
                    },
                  ],
                  modelId: modelId,
                }}
              />
            </div>

            {/* Setup Steps */}
            <div className="space-y-6">
              <h4 className="text-lg font-semibold text-gray-900">Setup Instructions</h4>

              {/* Step 1 */}
              <div className="flex space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm">
                    1
                  </div>
                </div>
                <div className="flex-1">
                  <h5 className="font-medium text-gray-900">Create a Twilio Configuration</h5>
                  <p className="text-sm text-gray-600 mt-1">
                    Go to{" "}
                    <Link
                      to={RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Project Settings → Notification Settings
                    </Link>{" "}
                    and create a new Call/SMS configuration with your Twilio Account SID and Auth Token.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm">
                    2
                  </div>
                </div>
                <div className="flex-1">
                  <h5 className="font-medium text-gray-900">Link Twilio Configuration to This Policy</h5>
                  <p className="text-sm text-gray-600 mt-1 mb-3">
                    Select your Twilio configuration below to link it to this incoming call policy.
                  </p>
                  <CardModelDetail<IncomingCallPolicy>
                    name="Twilio Config Selection"
                    editButtonText="Select Twilio Config"
                    cardProps={{
                      title: "",
                      description: "",
                    }}
                    isEditable={true}
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
                        required: false,
                        description:
                          "Select the Twilio configuration to use for this policy.",
                      },
                    ]}
                    modelDetailProps={{
                      showDetailsInNumberOfColumns: 1,
                      modelType: IncomingCallPolicy,
                      id: "model-detail-twilio-config-select",
                      fields: [
                        {
                          field: {
                            projectCallSMSConfig: {
                              name: true,
                            },
                          },
                          title: "Selected Configuration",
                          getElement: (item: IncomingCallPolicy): ReactElement => {
                            if (item.projectCallSMSConfig?.name) {
                              return <Pill text={item.projectCallSMSConfig.name} color={Green} />;
                            }
                            return <Pill text="None Selected" color={Yellow} />;
                          },
                        },
                      ],
                      modelId: modelId,
                    }}
                  />
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm">
                    3
                  </div>
                </div>
                <div className="flex-1">
                  <h5 className="font-medium text-gray-900">Purchase a Phone Number from Twilio</h5>
                  <p className="text-sm text-gray-600 mt-1">
                    Visit the{" "}
                    <Link
                      to={new Route("https://console.twilio.com/us1/develop/phone-numbers/manage/incoming")}
                      openInNewTab={true}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Twilio Console → Phone Numbers
                    </Link>{" "}
                    to purchase a phone number. Choose a number with voice capabilities.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm">
                    4
                  </div>
                </div>
                <div className="flex-1">
                  <h5 className="font-medium text-gray-900">Configure Webhook URL in Twilio</h5>
                  <p className="text-sm text-gray-600 mt-1">
                    In the Twilio Console, configure your phone number&apos;s voice webhook URL to point to your OneUptime instance:
                  </p>
                  <div className="mt-2 p-3 bg-gray-100 rounded font-mono text-sm break-all">
                    https://your-oneuptime-domain/notification/incoming-call/voice
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Replace &quot;your-oneuptime-domain&quot; with your actual OneUptime instance domain.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </Fragment>
  );
};

export default IncomingCallPolicyView;
