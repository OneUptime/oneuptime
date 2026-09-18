import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";

const IncomingCallPolicySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      {/* Messages Settings */}
      <CardModelDetail<IncomingCallPolicy>
        name="Incoming Call Policy > Messages"
        editButtonText="Edit Messages"
        cardProps={{
          title: "Voice Messages",
          description:
            "Configure the text-to-speech messages played to callers at different stages.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              greetingMessage: true,
            },
            title: "Greeting Message",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Please wait while we connect you to the on-call engineer.",
            description:
              "Text-to-speech message played to callers when they first connect",
          },
          {
            field: {
              noAnswerMessage: true,
            },
            title: "No Answer Message",
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
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "We're sorry, but no on-call engineer is currently available.",
            description: "Message when no one is on-call",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: IncomingCallPolicy,
          id: "model-detail-incoming-call-policy-messages",
          fields: [
            {
              field: {
                greetingMessage: true,
              },
              title: "Greeting Message",
              placeholder: "No greeting message set",
            },
            {
              field: {
                noAnswerMessage: true,
              },
              title: "No Answer Message",
              placeholder: "No message set",
            },
            {
              field: {
                noOneAvailableMessage: true,
              },
              title: "No One Available Message",
              placeholder: "No message set",
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Policy Settings */}
      <div className="mt-5">
        <CardModelDetail<IncomingCallPolicy>
          name="Incoming Call Policy > Policy Settings"
          editButtonText="Edit Policy Settings"
          cardProps={{
            title: "Policy Settings",
            description:
              "Configure how this policy behaves when handling incoming calls.",
          }}
          isEditable={true}
          formFields={[
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description: "Enable or disable this policy",
            },
            {
              field: {
                repeatPolicyIfNoOneAnswers: true,
              },
              title: "Repeat Policy If No One Answers",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description: "Restart from first rule if all escalations fail",
            },
            {
              field: {
                repeatPolicyIfNoOneAnswersTimes: true,
              },
              title: "Repeat Policy Times",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: "1",
              description: "Maximum number of times to repeat the policy",
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: IncomingCallPolicy,
            id: "model-detail-incoming-call-policy-settings",
            fields: [
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
                  repeatPolicyIfNoOneAnswers: true,
                },
                title: "Repeat Policy If No One Answers",
                fieldType: FieldType.Boolean,
              },
              {
                field: {
                  repeatPolicyIfNoOneAnswersTimes: true,
                },
                title: "Repeat Policy Times",
                fieldType: FieldType.Number,
                placeholder: "Not set",
              },
            ],
            modelId: modelId,
          }}
        />
      </div>
    </Fragment>
  );
};

export default IncomingCallPolicySettings;
