import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";

/*
 * When the Notification Templates tab of Subscriber Settings warns that a
 * custom template will not be used.
 *
 * A linked Email template is used only when the status page sends through
 * its own Custom SMTP, and a linked SMS template only through its own Twilio
 * Config (the senders check smtpConfig and callSmsConfig before they fill a
 * template in); Slack, Microsoft Teams and webhook templates need nothing
 * more. The tab used to warn whenever the page had no Custom SMTP or no
 * Twilio Config - nearly every page, linked templates or not, so the warning
 * sat there for nothing. It warns now only when a linked template is one of
 * those that cannot be used.
 */

export enum TemplateConfigurationWarning {
  // Linked Email and SMS templates, and neither a Custom SMTP nor a Twilio Config.
  SmtpAndTwilio = "SmtpAndTwilio",
  // A linked Email template, and no Custom SMTP.
  Smtp = "Smtp",
  // A linked SMS template, and no Twilio Config.
  Twilio = "Twilio",
}

export interface TemplateConfigurationState {
  // The notification method of each template linked to the status page.
  linkedMethods: ReadonlyArray<
    StatusPageSubscriberNotificationMethod | undefined
  >;
  hasCustomSmtp: boolean;
  hasCustomTwilio: boolean;
}

export const getTemplateConfigurationWarning: (
  state: TemplateConfigurationState,
) => TemplateConfigurationWarning | null = (
  state: TemplateConfigurationState,
): TemplateConfigurationWarning | null => {
  const emailTemplateUnused: boolean =
    !state.hasCustomSmtp &&
    state.linkedMethods.includes(StatusPageSubscriberNotificationMethod.Email);

  const smsTemplateUnused: boolean =
    !state.hasCustomTwilio &&
    state.linkedMethods.includes(StatusPageSubscriberNotificationMethod.SMS);

  if (emailTemplateUnused && smsTemplateUnused) {
    return TemplateConfigurationWarning.SmtpAndTwilio;
  }

  if (emailTemplateUnused) {
    return TemplateConfigurationWarning.Smtp;
  }

  if (smsTemplateUnused) {
    return TemplateConfigurationWarning.Twilio;
  }

  return null;
};
