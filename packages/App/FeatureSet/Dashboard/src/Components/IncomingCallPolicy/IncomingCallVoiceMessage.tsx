import { IncomingCallVoiceMessagesCopy } from "./IncomingCallPolicySettingsCopy";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The policy's own message, as stored.
  message: string | null | undefined;
  // What callers hear while it is empty (IncomingCallMessages).
  defaultMessage: string;
  dataTestId?: string | undefined;
}

/*
 * A voice message on an incoming call policy's Settings page: the policy's
 * own words, or - when it was emptied - the words callers hear instead,
 * quoted and quiet. It used to read "No greeting message set", as if callers
 * heard nothing.
 */
const IncomingCallVoiceMessage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const message: string = props.message?.toString().trim() || "";

  if (message) {
    return (
      <span className="whitespace-pre-line" data-testid={props.dataTestId}>
        {message}
      </span>
    );
  }

  return (
    <span className="text-gray-500" data-testid={props.dataTestId}>
      {translator.translateTemplate(IncomingCallVoiceMessagesCopy.emptyMessage, {
        message: props.defaultMessage,
      })}
    </span>
  );
};

export default IncomingCallVoiceMessage;
