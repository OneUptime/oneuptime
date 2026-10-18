import {
  INCOMING_CALL_DEFAULT_MESSAGE_PILL_TEST_ID,
  IncomingCallVoiceMessagesCopy,
} from "./IncomingCallPolicySettingsCopy";
import { Gray500 } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The policy's own message, as stored.
  message: string | null | undefined;
  // What callers hear while it is empty (IncomingCallMessages).
  defaultMessage: string;
  dataTestId?: string | undefined;
}

/*
 * A voice message on an incoming call policy's Settings page: the words
 * callers hear. The policy's own, or - when it was emptied - OneUptime's,
 * marked Default. It used to read "No greeting message set", as if callers
 * heard nothing; the words come first now, as they do for a message of the
 * policy's own, and a quiet pill says whose they are.
 *
 * The default words are not translated: Twilio reads them out in English.
 */
const IncomingCallVoiceMessage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const message: string = props.message?.toString().trim() || "";

  if (message) {
    return (
      <span className="whitespace-pre-line" data-testid={props.dataTestId}>
        {message}
      </span>
    );
  }

  return (
    <span data-testid={props.dataTestId}>
      <span className="mr-2">{props.defaultMessage}</span>
      <span
        className="inline-flex align-middle"
        data-testid={INCOMING_CALL_DEFAULT_MESSAGE_PILL_TEST_ID}
      >
        <Pill
          text={IncomingCallVoiceMessagesCopy.defaultPill}
          color={Gray500}
          isMinimal={true}
        />
      </span>
    </span>
  );
};

export default IncomingCallVoiceMessage;
