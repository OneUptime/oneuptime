import { JSONObject } from "Common/Types/JSON";
import { phoneNumberInLine } from "Common/Types/PhoneNumberDirection";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import {
  getServerTestSendSentence,
  getServerTestSendTitle,
  isServerTestSendReasonKey,
  SERVER_TEST_SEND_WORDS,
  ServerTestSendAnswer,
  ServerTestSendResult,
} from "Common/Types/ServerSetup/ServerTestSend";
import { translationKey } from "Common/Types/Translator";
import ServerSetUpProblem, {
  ServerSetUpProblemWords,
} from "Common/Types/ServerSending/ServerSetUpProblem";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import { sendServerTest } from "Common/UI/Utils/ServerSetupChecklist";
import {
  composedValue,
  TemplateValues,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "SEND TEST EMAIL", "SEND TEST SMS", "MAKE TEST CALL", "SEND TEST PUSH" -
 * THROUGH THE SERVER'S OWN SETTINGS.
 *
 * A button, and the one-field dialog it opens: the address (the admin's own
 * to start with) or the phone number. The test goes out exactly as a real
 * one would (POST /server-test/<channel>, ServerTestSendService), so its
 * outcome is what the setup checklist and the banner read afterwards.
 *
 * A test push (#7028) asks nothing: it goes to the admin who pressed it, on
 * the phones and browsers they registered, and its dialog says so.
 *
 * Accepted closes the dialog and is told to the page (onAnswer), which says
 * what took it - no second dialog to dismiss. Refused, or not set up, stays
 * in the dialog, in the provider's words, so the admin can try again.
 */

// What the test push's dialog says, before anything is sent.
export const SERVER_TEST_PUSH_DESCRIPTION: string = translationKey(
  "A test notification goes to the phones and browsers you registered for push notifications, and to nobody else.",
);

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
  const values: TemplateValues = { ...sentence.values };

  // A number; a test push's `to` is the names of the admin's devices.
  if (
    (answer.channel === ServerSendingChannel.SMS ||
      answer.channel === ServerSendingChannel.Call) &&
    sentence.values["to"]
  ) {
    values["to"] = phoneNumberInLine(
      sentence.values["to"],
      translator.language,
    );
  }

  const reason: string | undefined = sentence.values["reason"];
  const reasonWords: ServerSetUpProblemWords | undefined = answer.messageWords;

  /*
   * What the settings are missing, in the words the server sent (#9437),
   * and OneUptime's own reasons for a test push: each said in the language
   * the sentence around it is said in. A provider's own words are its own.
   */
  if (reasonWords) {
    values["reason"] = composedValue((inSentence: Translator): string => {
      return inSentence.translateTemplate(
        reasonWords.template,
        ServerSetUpProblem.toValues(reasonWords),
      );
    });
  } else if (reason && isServerTestSendReasonKey(reason)) {
    values["reason"] = composedValue((inSentence: Translator): string => {
      return inSentence.translateText(reason) || reason;
    });
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
  const isPush: boolean = props.channel === ServerSendingChannel.Push;
  const testId: string = props.dataTestId || `server-test-${props.channel}`;

  // Sends the test to `to` (nobody, for a push: the admin's own devices).
  const send: (to: string) => Promise<void> = async (
    to: string,
  ): Promise<void> => {
    setIsSending(true);
    setError("");

    try {
      const answer: ServerTestSendAnswer = await sendServerTest({
        channel: props.channel,
        to: to,
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
  };

  const onClose: () => void = (): void => {
    setIsOpen(false);
    setError("");
  };

  return (
    <>
      <Button
        title={title}
        icon={
          props.channel === ServerSendingChannel.Call
            ? IconProp.Call
            : props.channel === ServerSendingChannel.SMS
              ? IconProp.SMS
              : isPush
                ? IconProp.Bell
                : IconProp.Email
        }
        buttonStyle={props.buttonStyle || ButtonStyleType.NORMAL}
        onClick={() => {
          setError("");
          setIsOpen(true);
        }}
        dataTestId={testId}
      />

      {isOpen && isPush ? (
        <ConfirmModal
          title={title}
          // ConfirmModal words it in the reader's language.
          description={SERVER_TEST_PUSH_DESCRIPTION}
          submitButtonText={title}
          isLoading={isSending}
          error={error}
          onClose={onClose}
          onSubmit={() => {
            void send("");
          }}
        />
      ) : (
        <></>
      )}

      {isOpen && !isPush ? (
        <BasicFormModal<JSONObject>
          title={title}
          submitButtonText={title}
          isLoading={isSending}
          onClose={onClose}
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
            await send(String(values[fieldName] || "").trim());
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ServerTestSendButton;
