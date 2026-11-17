import { formatServerSetupTime } from "./ServerSetupChecklist";
import {
  ServerSendingChannel,
  ServerSendingRecipientRefusal,
} from "Common/Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupCheckResult,
  ServerSetupChecklistAnswer,
} from "Common/Types/ServerSetup/ServerSetupChecklist";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * ADDRESSES THE SERVER'S MAIL SERVICE REFUSED, WHILE EMAIL WORKS (#9217).
 *
 * An address that does not exist, a full mailbox, a recipient an Amazon
 * SES sandbox has not verified: the mail service refused that one email,
 * and every other went out. That is no reason for the banner that tells
 * every admin the server's email is failing - it used to be, and one
 * unverified address raised it for everyone, until any admin's test to
 * another address took it down again with nothing fixed.
 *
 * So the server keeps the last few such refusals with their recipients
 * (ServerSendingStatus), the checklist's email check carries them, and
 * Settings > Emails lists them here, under the test card's status: who,
 * when, and what the mail service said. A send to that address that goes
 * out takes it off; a test to another does not. A project's owners read
 * the same failure on the email's row in their Notification Logs.
 */

export const SERVER_EMAIL_RECIPIENT_REFUSALS_COPY: {
  title: string;
  description: string;
  lastRefused: string;
} = {
  title: translationKey("Addresses the mail server refused"),
  description: translationKey(
    "Other emails went out, so only these addresses are affected. Correct the address, or have your mail provider accept it: an Amazon SES sandbox sends only to addresses it has verified.",
  ),
  lastRefused: translationKey("Last refused {{time}}"),
};

// The refusals the checklist's email check carries, newest first.
export const getEmailRecipientRefusals: (
  answer: ServerSetupChecklistAnswer | null,
) => Array<ServerSendingRecipientRefusal> = (
  answer: ServerSetupChecklistAnswer | null,
): Array<ServerSendingRecipientRefusal> => {
  if (!answer) {
    return [];
  }

  const email: ServerSetupCheckResult | null =
    ServerSetupChecklistUtil.getCheck(answer, ServerSetupCheckId.Email);

  const channel: ServerSetupCheckResult["channels"][number] | undefined =
    email?.channels.find(
      (status: ServerSetupCheckResult["channels"][number]): boolean => {
        return status.channel === ServerSendingChannel.Email;
      },
    );

  return channel?.recipientRefusals || [];
};

export interface ComponentProps {
  refusals: Array<ServerSendingRecipientRefusal>;
}

const ServerEmailRecipientRefusals: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.refusals.length === 0) {
    return <></>;
  }

  return (
    <div
      className="border-t border-gray-200 pt-3"
      data-testid="server-email-recipient-refusals"
    >
      <h3 className="text-sm font-medium text-gray-900">
        {translator.translateText(SERVER_EMAIL_RECIPIENT_REFUSALS_COPY.title)}
      </h3>
      <p className="mt-1 text-sm text-gray-600 text-pretty">
        {translator.translateText(
          SERVER_EMAIL_RECIPIENT_REFUSALS_COPY.description,
        )}
      </p>
      <ul className="mt-2 space-y-2">
        {props.refusals.map(
          (refusal: ServerSendingRecipientRefusal): ReactElement => {
            return (
              <li
                key={refusal.recipient}
                className="min-w-0"
                data-testid="server-email-recipient-refusal"
              >
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="break-all font-medium text-gray-900">
                    {refusal.recipient}
                  </span>
                  <span className="text-xs text-gray-500">
                    {translator.translateTemplate(
                      SERVER_EMAIL_RECIPIENT_REFUSALS_COPY.lastRefused,
                      { time: formatServerSetupTime(refusal.at) },
                    )}
                  </span>
                </p>
                <p className="mt-0.5 break-words text-xs text-gray-500">
                  {refusal.reason}
                </p>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
};

export default ServerEmailRecipientRefusals;
