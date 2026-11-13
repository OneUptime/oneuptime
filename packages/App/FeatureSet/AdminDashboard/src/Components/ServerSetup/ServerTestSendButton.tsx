import { JSONObject } from "Common/Types/JSON";
import { phoneNumberInLine } from "Common/Types/PhoneNumberDirection";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import {
  getServerTestSendSentence,
  getServerTestSendTitle,
  SERVER_TEST_SEND_WORDS,
  ServerTestSendAnswer,
  ServerTestSendResult,
} from "Common/Types/ServerSetup/ServerTestSend";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import API from "Common/UI/Utils/API/API";
import { sendServerTest } from "Common/UI/Utils/ServerSetupChecklist";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "SEND TEST EMAIL", "SEND TEST SMS", "MAKE TEST CALL" - THROUGH THE
 * SERVER'S OWN SETTINGS.
 *
 * A button, and the one-field dialog it opens: the address (the admin's own
 * to start with) or the phone number. The test goes out exactly as a real
 * one would (POST /server-test/<channel>, ServerTestSendService), so its
 * outcome is what the setup checklist and the banner read afterwards.
 *
 * Accepted closes the dialog and is told to the page (onAnswer), which says
 * what took it - no second dialog to dismiss. Refused, or not set up, stays
 * in the dialog, in the provider's words, so the admin can try again.
 */

// What the dialog's field holds, for a channel.
export const getServerTestSendFieldName: (
  channel: ServerSendingChannel,
) => "toEmail" | "toPhone" = (
  channel: ServerSendingChannel,
): "toEmail" | "toPhone" => {
  return channel === ServerSendingChannel.Email ? "toEmail" : "toPhone";
};

/*
 * What a test answered, in the reader's language. The phone number a test
 * SMS or call went to reads +447700900123 in an Arabic sentence too
 * (phoneNumberInLine): printed as it is, its "+" stood after its digits.
 */
export const describeServerTestSend: (
  translator: Translator,
  answer: ServerTestSendAnswer,
) => string = (
  translator: Translator,
  answer: ServerTestSendAnswer,
): string => {
  const sentence: { template: string; values: Record<string, string> } =
    getServerTestSendSentence(answer);
  const values: Record<string, string> = { ...sentence.values };

  if (answer.channel !== ServerSendingChannel.Email && values["to"]) {
    values["to"] = phoneNumberInLine(values["to"], translator.language);
  }

  return translator.translateTemplate(sentence.template, values);
};

export interface ComponentProps {
  channel: ServerSendingChannel;
  buttonStyle?: ButtonStyleType | undefined;
  // How it went, accepted or not: the page reads what changed.
  onAnswer?: ((answer: ServerTestSendAnswer) => void) | undefined;
  dataTestId?: string | undefined;
}

const ServerTestSendButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const title: string = getServerTestSendTitle(props.channel);
  const fieldName: "toEmail" | "toPhone" = getServerTestSendFieldName(
    props.channel,
  );
  const isEmail: boolean = props.channel === ServerSendingChannel.Email;
  const testId: string = props.dataTestId || `server-test-${props.channel}`;

  return (
    <>
      <Button
        title={title}
        icon={
          props.channel === ServerSendingChannel.Call
            ? IconProp.Call
            : props.channel === ServerSendingChannel.SMS
              ? IconProp.SMS
              : IconProp.Email
        }
        buttonStyle={props.buttonStyle || ButtonStyleType.NORMAL}
        onClick={() => {
          setError("");
          setIsOpen(true);
        }}
        dataTestId={testId}
      />

      {isOpen ? (
        <BasicFormModal<JSONObject>
          title={title}
          submitButtonText={title}
          isLoading={isSending}
          onClose={() => {
            setIsOpen(false);
            setError("");
          }}
          formProps={{
            name: testId,
            error: error,
            fields: [
              {
                field: {
                  [fieldName]: true,
                },
                title: isEmail
                  ? SERVER_TEST_SEND_WORDS.sendTo
                  : SERVER_TEST_SEND_WORDS.phoneNumber,
                fieldType: isEmail
                  ? FormFieldSchemaType.Email
                  : FormFieldSchemaType.Phone,
                required: true,
                placeholder: isEmail ? "you@company.com" : "+14155550100",
                disableSpellCheck: true,
                // Your own inbox to start with: change it to try another.
                ...(isEmail && UserUtil.getEmail()
                  ? { defaultValue: UserUtil.getEmail()!.toString() }
                  : {}),
              },
            ],
          }}
          onSubmit={async (values: JSONObject) => {
            setIsSending(true);
            setError("");

            try {
              const answer: ServerTestSendAnswer = await sendServerTest({
                channel: props.channel,
                to: String(values[fieldName] || "").trim(),
              });

              props.onAnswer?.(answer);

              if (answer.result === ServerTestSendResult.Accepted) {
                setIsOpen(false);
              } else {
                setError(describeServerTestSend(translator, answer));
              }
            } catch (err) {
              setError(API.getFriendlyMessage(err));
            } finally {
              setIsSending(false);
            }
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ServerTestSendButton;
