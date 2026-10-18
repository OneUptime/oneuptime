import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import RepeatChoiceCard from "../../../Components/OnCallPolicy/RepeatChoice/RepeatChoiceCard";
import { INCOMING_CALL_POLICY_REPEAT } from "../../../Components/OnCallPolicy/RepeatChoice/RepeatChoice";
import {
  INCOMING_CALL_ANSWER_CALLS_COLUMN,
  INCOMING_CALL_ANSWER_CALLS_TEST_ID,
  IncomingCallAnswerCallsCopy,
  IncomingCallVoiceMessagesCopy,
} from "../../../Components/IncomingCallPolicy/IncomingCallPolicySettingsCopy";
import IncomingCallVoiceMessage from "../../../Components/IncomingCallPolicy/IncomingCallVoiceMessage";

/*
 * Turning calls away asks first: it is the one press here that silences a
 * hotline. Turning them back on saves at once.
 */
export const getStopAnsweringCallsConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (isTurningOn) {
    return undefined;
  }

  return {
    title: IncomingCallAnswerCallsCopy.turnOffConfirmTitle,
    description: IncomingCallAnswerCallsCopy.turnOffConfirmDescription,
    submitButtonText: IncomingCallAnswerCallsCopy.turnOffConfirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

/*
 * An incoming call policy's Settings: whether it answers calls, what happens
 * when nobody answers, and what callers hear - a card each
 * (IncomingCallPolicySettingsCopy.ts says what they replaced).
 */
const IncomingCallPolicySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelSwitchCard<IncomingCallPolicy>
        modelType={IncomingCallPolicy}
        modelId={modelId}
        column={INCOMING_CALL_ANSWER_CALLS_COLUMN}
        cardTitle={IncomingCallAnswerCallsCopy.cardTitle}
        cardDescription={IncomingCallAnswerCallsCopy.cardDescription}
        title={IncomingCallAnswerCallsCopy.switchTitle}
        getDescription={(isOn: boolean): string => {
          return isOn
            ? IncomingCallAnswerCallsCopy.switchOnDescription
            : IncomingCallAnswerCallsCopy.switchOffDescription;
        }}
        getConfirmation={getStopAnsweringCallsConfirmation}
        dataTestId={INCOMING_CALL_ANSWER_CALLS_TEST_ID}
      />

      <div className="mt-5">
        <RepeatChoiceCard<IncomingCallPolicy>
          config={INCOMING_CALL_POLICY_REPEAT}
          modelType={IncomingCallPolicy}
          modelId={modelId}
          name="Incoming Call Policy > Repeat Policy"
        />
      </div>

      <div className="mt-5">
        <CardModelDetail<IncomingCallPolicy>
          name="Incoming Call Policy > Messages"
          editButtonText={IncomingCallVoiceMessagesCopy.editButtonText}
          editModalTitle={IncomingCallVoiceMessagesCopy.dialogTitle}
          cardProps={{
            title: IncomingCallVoiceMessagesCopy.cardTitle,
            description: IncomingCallVoiceMessagesCopy.cardDescription,
          }}
          isEditable={true}
          formFields={[
            {
              field: {
                greetingMessage: true,
              },
              title: IncomingCallVoiceMessagesCopy.greeting.title,
              description: IncomingCallVoiceMessagesCopy.greeting.description,
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              // A sentence or two: three lines to start, growing as it is written.
              autoGrow: true,
            },
            {
              field: {
                noAnswerMessage: true,
              },
              title: IncomingCallVoiceMessagesCopy.noAnswer.title,
              description: IncomingCallVoiceMessagesCopy.noAnswer.description,
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              autoGrow: true,
            },
            {
              field: {
                noOneAvailableMessage: true,
              },
              title: IncomingCallVoiceMessagesCopy.noOneAvailable.title,
              description:
                IncomingCallVoiceMessagesCopy.noOneAvailable.description,
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              autoGrow: true,
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
                title: IncomingCallVoiceMessagesCopy.greeting.title,
                description: IncomingCallVoiceMessagesCopy.greeting.description,
                getElement: (item: IncomingCallPolicy): ReactElement => {
                  return (
                    <IncomingCallVoiceMessage
                      message={item.greetingMessage}
                      defaultMessage={
                        IncomingCallVoiceMessagesCopy.greeting.defaultMessage
                      }
                    />
                  );
                },
              },
              {
                field: {
                  noAnswerMessage: true,
                },
                title: IncomingCallVoiceMessagesCopy.noAnswer.title,
                description: IncomingCallVoiceMessagesCopy.noAnswer.description,
                getElement: (item: IncomingCallPolicy): ReactElement => {
                  return (
                    <IncomingCallVoiceMessage
                      message={item.noAnswerMessage}
                      defaultMessage={
                        IncomingCallVoiceMessagesCopy.noAnswer.defaultMessage
                      }
                    />
                  );
                },
              },
              {
                field: {
                  noOneAvailableMessage: true,
                },
                title: IncomingCallVoiceMessagesCopy.noOneAvailable.title,
                description:
                  IncomingCallVoiceMessagesCopy.noOneAvailable.description,
                getElement: (item: IncomingCallPolicy): ReactElement => {
                  return (
                    <IncomingCallVoiceMessage
                      message={item.noOneAvailableMessage}
                      defaultMessage={
                        IncomingCallVoiceMessagesCopy.noOneAvailable
                          .defaultMessage
                      }
                    />
                  );
                },
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
