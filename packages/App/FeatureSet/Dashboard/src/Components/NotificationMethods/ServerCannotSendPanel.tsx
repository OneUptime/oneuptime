import { getAdminEmailSettingsUrl } from "../../Utils/ServerEmail";
import { ADMIN_DASHBOARD_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHEN THIS SERVER CANNOT REACH THESE METHODS AT ALL (#6880, #7151).
 *
 * At the top of a person's own email addresses, SMS numbers or call numbers
 * while a page cannot reach any of them (GET /project-can-send): the server
 * cannot send email, or neither the project nor the server has a Twilio
 * account or gateway that sends SMS or makes calls. The lists used to read
 * as if a page would reach every address, and a member typed a phone number
 * only to be refused at Add - after an owner had turned SMS on for nothing.
 *
 * It says what cannot happen, and who can fix it: the server's admin. A
 * master admin, who is that admin, is sent to the Admin Dashboard instead.
 * Never why it cannot, nor what a provider said: those are the server's
 * admins' (Admin Dashboard > Server Setup). Nothing is drawn while the
 * answer is on its way, or could not be read: the list says what it always
 * did, and the server still refuses what it must.
 */

export enum ServerCannotSendChannel {
  Email = "email",
  SMS = "sms",
  Call = "call",
}

export const SERVER_CANNOT_SEND_PANEL_TEST_ID: string =
  "server-cannot-send-panel";

export const SERVER_CANNOT_SEND_COPY: Readonly<
  Record<ServerCannotSendChannel, { member: string; admin: string }>
> = {
  [ServerCannotSendChannel.Email]: {
    member: translationKey(
      "This server can't send email right now, so these addresses get no email. Ask your server's admin to set up email.",
    ),
    admin: translationKey(
      "This server can't send email right now, so these addresses get no email. Set up email in the Admin Dashboard.",
    ),
  },
  [ServerCannotSendChannel.SMS]: {
    member: translationKey(
      "This server can't send SMS right now, so these numbers get no SMS. Ask your server's admin to set up SMS and calls.",
    ),
    admin: translationKey(
      "This server can't send SMS right now, so these numbers get no SMS. Set up SMS and calls in the Admin Dashboard.",
    ),
  },
  [ServerCannotSendChannel.Call]: {
    member: translationKey(
      "This server can't make calls right now, so these numbers get no calls. Ask your server's admin to set up SMS and calls.",
    ),
    admin: translationKey(
      "This server can't make calls right now, so these numbers get no calls. Set up SMS and calls in the Admin Dashboard.",
    ),
  },
};

// What the master admin's link says, by what it opens.
export const SERVER_CANNOT_SEND_FIX_WORDS: Readonly<
  Record<ServerCannotSendChannel, string>
> = {
  [ServerCannotSendChannel.Email]: translationKey("Set up email"),
  [ServerCannotSendChannel.SMS]: translationKey("Set up SMS and calls"),
  [ServerCannotSendChannel.Call]: translationKey("Set up SMS and calls"),
};

// The Admin Dashboard's Settings > Call and SMS, under ADMIN_DASHBOARD_URL.
export const ADMIN_CALL_AND_SMS_SETTINGS_ROUTE: string =
  "/settings/call-and-sms";

// Where a master admin sets the channel up.
export const getServerCannotSendFixUrl: (
  channel: ServerCannotSendChannel,
) => URL = (channel: ServerCannotSendChannel): URL => {
  return channel === ServerCannotSendChannel.Email
    ? getAdminEmailSettingsUrl()
    : URL.fromString(ADMIN_DASHBOARD_URL.toString()).addRoute(
        ADMIN_CALL_AND_SMS_SETTINGS_ROUTE,
      );
};

export interface ComponentProps {
  channel: ServerCannotSendChannel;
  // False only once the server is known not to reach this channel; null while not known.
  canSend: boolean | null | undefined;
}

const ServerCannotSendPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.canSend !== false) {
    return <></>;
  }

  const isMasterAdmin: boolean = Boolean(UserUtil.isMasterAdmin());
  const words: { member: string; admin: string } =
    SERVER_CANNOT_SEND_COPY[props.channel];

  return (
    <div className="mb-5" data-testid={SERVER_CANNOT_SEND_PANEL_TEST_ID}>
      <Alert
        type={AlertType.WARNING}
        dataTestId={`${SERVER_CANNOT_SEND_PANEL_TEST_ID}-${props.channel}`}
        title={
          <span>
            {translator.translateText(
              isMasterAdmin ? words.admin : words.member,
            )}
            {isMasterAdmin ? (
              <>
                {" "}
                <a
                  href={getServerCannotSendFixUrl(props.channel).toString()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                  data-testid={`${SERVER_CANNOT_SEND_PANEL_TEST_ID}-fix`}
                >
                  {translator.translateText(
                    SERVER_CANNOT_SEND_FIX_WORDS[props.channel],
                  )}
                </a>
              </>
            ) : (
              <></>
            )}
          </span>
        }
      />
    </div>
  );
};

export default ServerCannotSendPanel;
