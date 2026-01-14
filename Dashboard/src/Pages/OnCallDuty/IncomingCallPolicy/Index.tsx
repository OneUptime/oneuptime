import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";

const IncomingCallPolicyView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      <CardModelDetail<IncomingCallPolicy>
        name="Incoming Call Policy > Details"
        cardProps={{
          title: "Incoming Call Policy Details",
          description:
            "Here are more details for this incoming call policy.",
        }}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Messages",
            id: "messages",
          },
          {
            title: "Settings",
            id: "settings",
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
              greetingMessage: true,
            },
            title: "Greeting Message",
            stepId: "messages",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Please wait while we connect you to the on-call engineer.",
            description: "Text-to-speech message played to callers when they first connect",
          },
          {
            field: {
              noAnswerMessage: true,
            },
            title: "No Answer Message",
            stepId: "messages",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "No one is available. Please try again later.",
            description: "Message when all escalation rules are exhausted",
          },
          {
            field: {
              noOneAvailableMessage: true,
            },
            title: "No One Available Message",
            stepId: "messages",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "We're sorry, but no on-call engineer is currently available.",
            description: "Message when no one is on-call",
          },
          {
            field: {
              busyMessage: true,
            },
            title: "Busy Message",
            stepId: "messages",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "All lines are currently busy. Please try again in a few minutes.",
            description: "Message when max concurrent calls is reached",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "settings",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Enable or disable this policy",
          },
          {
            field: {
              repeatPolicyIfNoOneAnswers: true,
            },
            title: "Repeat Policy If No One Answers",
            stepId: "settings",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Restart from first rule if all escalations fail",
          },
          {
            field: {
              repeatPolicyIfNoOneAnswersTimes: true,
            },
            title: "Repeat Policy Times",
            stepId: "settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "1",
            description: "Maximum number of times to repeat the policy",
          },
          {
            field: {
              maxConcurrentCalls: true,
            },
            title: "Max Concurrent Calls",
            stepId: "settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "1",
            description: "Maximum number of simultaneous calls to route",
          },
          {
            field: {
              maxTotalCallDurationSeconds: true,
            },
            title: "Max Total Call Duration (Seconds)",
            stepId: "settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "300",
            description: "Maximum duration for entire call including escalations",
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
                routingPhoneNumber: true,
              },
              title: "Phone Number",
              fieldType: FieldType.Phone,
              placeholder: "No phone number assigned",
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
                greetingMessage: true,
              },
              title: "Greeting Message",
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
    </Fragment>
  );
};

export default IncomingCallPolicyView;
