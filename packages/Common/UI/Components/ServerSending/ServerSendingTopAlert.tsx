import Link from "../Link/Link";
import TopAlert, { TopAlertType } from "../TopAlert/TopAlert";
import { useServerSendingStatus } from "../../Utils/ServerSending";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import ServerSendingStatusUtil, {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "../../../Types/ServerSending/ServerSendingStatus";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE ONE BANNER THAT SAYS THIS SERVER CANNOT SEND.
 *
 * A master admin sees it at the top of every page of the Dashboard and the
 * Admin Dashboard while something the server needs does not work:
 *
 *   - email is not set up, so invitations, password resets and incident
 *     emails are not sent - a fresh self-hosted server, until its admin sets
 *     email up;
 *   - email was set up and its sends now fail, since when and why - a
 *     failure of the settings, the way to the mail service or the sender,
 *     never one recipient's (#9217): an address that does not exist, or one
 *     an Amazon SES sandbox has not verified, is said on that email's log
 *     row and in Settings > Emails, and every other email still goes out.
 *     It goes once an email goes out through the same settings again - a
 *     real one, or a test, which takes the same way to the mail service;
 *   - the server's global probes have all stopped reporting, so monitors
 *     that run on them are not checked.
 *
 * Each says what is not happening and opens the place that fixes it. It is
 * one of the few things a banner is for (NoAlwaysOnInfoBannersGuard lists
 * it): an exception the reader must act on, drawn only while it lasts, and
 * gone by itself once email is set up and sends, or a probe reports. Email
 * comes first: one banner at a time.
 *
 * Nobody else sees it (GET /global-config/sending-status answers master
 * admins only): a project's owners read why an email was not sent in their
 * Notification Logs, and anybody signed out reads only that the server
 * cannot send email yet, on the pages that would have emailed them.
 */

export enum ServerSendingAlertKind {
  EmailNotSetUp = "email-not-set-up",
  EmailFailing = "email-failing",
  GlobalProbesSilent = "global-probes-silent",
}

export interface ServerSendingAlert {
  kind: ServerSendingAlertKind;
  // Email failing: since when, and why, as the server words it.
  failingSince?: string | null | undefined;
  lastFailure?: string | null | undefined;
}

export const SERVER_SENDING_ALERT_COPY: {
  emailNotSetUpTitle: string;
  emailNotSetUpDescription: string;
  setUpEmail: string;
  emailFailingTitle: string;
  emailFailingDescription: string;
  emailFailingWithReasonDescription: string;
  checkEmailSettings: string;
  seeEmailLogs: string;
  probesSilentTitle: string;
  probesSilentDescription: string;
  seeGlobalProbes: string;
} = {
  emailNotSetUpTitle: translationKey("Email is not set up"),
  emailNotSetUpDescription: translationKey(
    "Invitations, password resets and incident emails are not sent.",
  ),
  setUpEmail: translationKey("Set up email"),
  emailFailingTitle: translationKey("Email is failing"),
  emailFailingDescription: translationKey(
    "No email has gone out through this server's email settings since {{time}}.",
  ),
  emailFailingWithReasonDescription: translationKey(
    "No email has gone out through this server's email settings since {{time}}. The mail server said: {{reason}}",
  ),
  checkEmailSettings: translationKey("Check email settings"),
  seeEmailLogs: translationKey("See email logs"),
  probesSilentTitle: translationKey("No global probe is reporting"),
  probesSilentDescription: translationKey(
    "Monitors that run on global probes are not being checked.",
  ),
  seeGlobalProbes: translationKey("See global probes"),
};

/*
 * What the banner says for an answer, or null when it says nothing: email
 * first (not set up, then failing), then the global probes.
 */
export const getServerSendingAlert: (
  answer: ServerSendingStatusAnswer | null,
) => ServerSendingAlert | null = (
  answer: ServerSendingStatusAnswer | null,
): ServerSendingAlert | null => {
  if (!answer) {
    return null;
  }

  const email: ServerChannelStatus | null = ServerSendingStatusUtil.getChannel(
    answer,
    ServerSendingChannel.Email,
  );

  if (email && email.state === ServerSendingState.NotSetUp) {
    return { kind: ServerSendingAlertKind.EmailNotSetUp };
  }

  if (email && email.state === ServerSendingState.Failing) {
    return {
      kind: ServerSendingAlertKind.EmailFailing,
      failingSince: email.failingSince,
      lastFailure: email.lastFailure,
    };
  }

  if (ServerSendingStatusUtil.areGlobalProbesSilent(answer.globalProbes)) {
    return { kind: ServerSendingAlertKind.GlobalProbesSilent };
  }

  return null;
};

export interface ComponentProps {
  // Where email is set up: the Admin Dashboard's Settings > Emails.
  emailSettingsLink: Route | URL;
  // Where the global probes are listed: the Admin Dashboard's Settings > Probes.
  globalProbesLink: Route | URL;
  /*
   * Where the emails that failed are listed, when the page has such a
   * list: the project's Notification Logs, in the Dashboard.
   */
  emailLogsLink?: Route | URL | undefined;
  /*
   * Open the settings links in a new tab: from the Dashboard, they are
   * another app. The email logs are in this one.
   */
  openLinksInNewTab?: boolean | undefined;
  // For tests: the answer to draw, instead of reading it.
  answer?: ServerSendingStatusAnswer | null | undefined;
}

const ServerSendingTopAlert: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const loaded: ServerSendingStatusAnswer | null = useServerSendingStatus();
  const answer: ServerSendingStatusAnswer | null =
    props.answer !== undefined ? props.answer : loaded;

  const alert: ServerSendingAlert | null = getServerSendingAlert(answer);

  if (!alert) {
    return <></>;
  }

  const link: (
    to: Route | URL,
    text: string,
    testId: string,
    isInThisApp?: boolean,
  ) => ReactElement = (
    to: Route | URL,
    text: string,
    testId: string,
    isInThisApp?: boolean,
  ): ReactElement => {
    return (
      <Link
        to={to}
        openInNewTab={isInThisApp ? false : props.openLinksInNewTab}
        className="font-semibold underline"
        dataTestId={testId}
      >
        {translator.translateText(text)}
      </Link>
    );
  };

  let title: string = SERVER_SENDING_ALERT_COPY.emailNotSetUpTitle;
  let description: string = "";
  let action: ReactElement = <></>;

  switch (alert.kind) {
    case ServerSendingAlertKind.EmailNotSetUp:
      title = SERVER_SENDING_ALERT_COPY.emailNotSetUpTitle;
      description =
        translator.translateText(
          SERVER_SENDING_ALERT_COPY.emailNotSetUpDescription,
        ) || SERVER_SENDING_ALERT_COPY.emailNotSetUpDescription;
      action = link(
        props.emailSettingsLink,
        SERVER_SENDING_ALERT_COPY.setUpEmail,
        "server-sending-alert-action",
      );
      break;
    case ServerSendingAlertKind.EmailFailing: {
      const since: string = alert.failingSince
        ? OneUptimeDate.getDateAsLocalFormattedString(
            OneUptimeDate.fromString(alert.failingSince),
          )
        : "";

      title = SERVER_SENDING_ALERT_COPY.emailFailingTitle;
      description = alert.lastFailure
        ? translator.translateTemplate(
            SERVER_SENDING_ALERT_COPY.emailFailingWithReasonDescription,
            { time: since, reason: alert.lastFailure },
          )
        : translator.translateTemplate(
            SERVER_SENDING_ALERT_COPY.emailFailingDescription,
            { time: since },
          );
      action = (
        <>
          {link(
            props.emailSettingsLink,
            SERVER_SENDING_ALERT_COPY.checkEmailSettings,
            "server-sending-alert-action",
          )}
          {props.emailLogsLink ? (
            <span className="ms-3 inline-block">
              {link(
                props.emailLogsLink,
                SERVER_SENDING_ALERT_COPY.seeEmailLogs,
                "server-sending-alert-logs",
                true,
              )}
            </span>
          ) : (
            <></>
          )}
        </>
      );
      break;
    }
    case ServerSendingAlertKind.GlobalProbesSilent:
      title = SERVER_SENDING_ALERT_COPY.probesSilentTitle;
      description =
        translator.translateText(
          SERVER_SENDING_ALERT_COPY.probesSilentDescription,
        ) || SERVER_SENDING_ALERT_COPY.probesSilentDescription;
      action = link(
        props.globalProbesLink,
        SERVER_SENDING_ALERT_COPY.seeGlobalProbes,
        "server-sending-alert-action",
      );
      break;
  }

  return (
    <div data-testid="server-sending-alert" data-kind={alert.kind}>
      <TopAlert
        alertType={TopAlertType.WARNING}
        title={title}
        description={
          <span>
            {description} {action}
          </span>
        }
      />
    </div>
  );
};

export default ServerSendingTopAlert;
