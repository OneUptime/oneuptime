import { Yellow } from "Common/Types/BrandColors";
import { InvitationEmailNotSent } from "Common/Types/Team/InvitationEmailsNotSent";
import InvitationEmailNotSentPill, {
  EMAIL_NOT_SENT_PILL_TEST_ID,
  EMAIL_NOT_SENT_REASON_TEST_ID,
  InvitationEmailNotSentExplanation,
  getInvitationEmailNotSentExplanation as getExplanationForAdvice,
} from "Common/UI/Components/InvitationLink/InvitationEmailNotSentPill";
import Pill from "Common/UI/Components/Pill/Pill";
import { BILLING_ENABLED } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import {
  SERVER_EMAIL_COPY,
  ServerEmail,
  cannotSendEmail,
} from "../../Utils/ServerEmail";

/*
 * A PENDING PERSON'S STATUS, WHERE A LIST OF PEOPLE DRAWS IT.
 *
 * Settings > Users, a person's Teams and a team's Members say where an
 * invitation that has not been accepted stands, in one pill:
 *
 *   - Invited, on a server known not to send email: the invitation is
 *     created, and nobody was emailed (Utils/ServerEmail);
 *   - Email Not Sent, when the mail service refused the person's latest
 *     invitation email (#9511, useInvitationEmailsNotSent): pressed or
 *     pointed at, it says so in OneUptime's words, then the mail service's
 *     answer as the project's Email Log words it, then what to do
 *     (InvitationEmailNotSentPill, which the Admin Dashboard draws too) - a
 *     master admin is handed the link on the row; anybody else is told to
 *     resend the invitation from the row once email works (#9519) or ask
 *     the server's admin for the link, and on OneUptime Cloud to check the
 *     address first;
 *   - Invitation Sent, otherwise.
 */

export const PENDING_INVITATION_PILL_TEST_ID: string = "pending-invitation";

// The Email Not Sent pill's own, as the Dashboard's tests find it.
export { EMAIL_NOT_SENT_PILL_TEST_ID, EMAIL_NOT_SENT_REASON_TEST_ID };
export type { InvitationEmailNotSentExplanation };

// What a reader is told to do about an invitation email that was not sent.
export const getInvitationEmailNotSentAdvice: (data: {
  isMasterAdmin: boolean;
  isCloud: boolean;
}) => string = (data: { isMasterAdmin: boolean; isCloud: boolean }): string => {
  if (data.isMasterAdmin) {
    return SERVER_EMAIL_COPY.emailNotSentForAdmin;
  }

  return data.isCloud
    ? SERVER_EMAIL_COPY.emailNotSentCheckAddress
    : SERVER_EMAIL_COPY.emailNotSentAskAdmin;
};

// The pill's explanation, in the reader's words, a sentence at a time.
export const getInvitationEmailNotSentExplanation: (data: {
  notSent: InvitationEmailNotSent;
  isMasterAdmin: boolean;
  isCloud: boolean;
  translator: Translator;
}) => InvitationEmailNotSentExplanation = (data: {
  notSent: InvitationEmailNotSent;
  isMasterAdmin: boolean;
  isCloud: boolean;
  translator: Translator;
}): InvitationEmailNotSentExplanation => {
  return getExplanationForAdvice({
    statusMessage: data.notSent.statusMessage,
    advice: getInvitationEmailNotSentAdvice({
      isMasterAdmin: data.isMasterAdmin,
      isCloud: data.isCloud,
    }),
    translator: data.translator,
  });
};

export interface ComponentProps {
  serverEmail: ServerEmail;
  // The person's latest invitation email was not sent: why.
  notSent?: InvitationEmailNotSent | undefined;
}

const PendingInvitationPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Nothing was sent by a server that cannot send email.
  if (cannotSendEmail(props.serverEmail)) {
    return (
      <Pill
        text={SERVER_EMAIL_COPY.invitedPill}
        color={Yellow}
        dataTestId={PENDING_INVITATION_PILL_TEST_ID}
      />
    );
  }

  if (!props.notSent) {
    return (
      <Pill
        text="Invitation Sent"
        color={Yellow}
        dataTestId={PENDING_INVITATION_PILL_TEST_ID}
      />
    );
  }

  return (
    <InvitationEmailNotSentPill
      statusMessage={props.notSent.statusMessage}
      advice={getInvitationEmailNotSentAdvice({
        isMasterAdmin: props.serverEmail.isMasterAdmin,
        isCloud: BILLING_ENABLED,
      })}
    />
  );
};

export default PendingInvitationPill;
