import { Yellow } from "Common/Types/BrandColors";
import { InvitationEmailNotSent } from "Common/Types/Team/InvitationEmailsNotSent";
import ExplainedPill from "Common/UI/Components/Pill/ExplainedPill";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { BILLING_ENABLED } from "Common/UI/Config";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { EmailLogReason, getEmailLogReason } from "../../Utils/EmailLogReason";
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
 *     answer as the project's Email Log words it, then what to do - a
 *     master admin is handed the link on the row; anybody else is told to
 *     invite them again once email works or ask the server's admin for it,
 *     and on OneUptime Cloud to check the address;
 *   - Invitation Sent, otherwise.
 */

export const PENDING_INVITATION_PILL_TEST_ID: string = "pending-invitation";
export const EMAIL_NOT_SENT_PILL_TEST_ID: string = "invitation-email-not-sent";
export const EMAIL_NOT_SENT_REASON_TEST_ID: string =
  "invitation-email-not-sent-reason";

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

export interface InvitationEmailNotSentExplanation {
  // OneUptime's words: the email was not sent.
  notSent: string;
  // The mail service's answer, as the Email Log words it; none when it said nothing.
  reason: EmailLogReason | null;
  // What to do.
  advice: string;
}

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
  const reason: EmailLogReason = getEmailLogReason(
    data.notSent.statusMessage,
    data.translator,
  );
  const advice: string = getInvitationEmailNotSentAdvice({
    isMasterAdmin: data.isMasterAdmin,
    isCloud: data.isCloud,
  });

  return {
    notSent:
      data.translator.translateText(SERVER_EMAIL_COPY.emailNotSent) ||
      SERVER_EMAIL_COPY.emailNotSent,
    reason: reason.text.trim() ? reason : null,
    advice: data.translator.translateText(advice) || advice,
  };
};

export interface ComponentProps {
  serverEmail: ServerEmail;
  // The person's latest invitation email was not sent: why.
  notSent?: InvitationEmailNotSent | undefined;
}

const PendingInvitationPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

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

  const explanation: InvitationEmailNotSentExplanation =
    getInvitationEmailNotSentExplanation({
      notSent: props.notSent,
      isMasterAdmin: props.serverEmail.isMasterAdmin,
      isCloud: BILLING_ENABLED,
      translator: translator,
    });

  return (
    <ExplainedPill
      text={SERVER_EMAIL_COPY.emailNotSentPill}
      // It broke: the email did not go (Docs/ux/README.md#one-control-for-one-job).
      tone={PillTone.Danger}
      dataTestId={EMAIL_NOT_SENT_PILL_TEST_ID}
      explanation={joinSentences([
        explanation.notSent,
        explanation.reason?.text || "",
        explanation.advice,
      ])}
      isExplanationTranslated={true}
      explanationContent={
        <div className="max-w-xs space-y-1 text-start text-xs leading-5 text-gray-900">
          <p className="font-medium">{explanation.notSent}</p>
          {explanation.reason ? (
            <p
              className="break-words text-gray-600"
              /*
               * The mail service's own words read in their own direction:
               * on a page read from the right, "535 5.7.8 Authentication
               * failed" keeps its numbers at its start.
               */
              dir={explanation.reason.isAsSaid ? "auto" : undefined}
              data-testid={EMAIL_NOT_SENT_REASON_TEST_ID}
            >
              {explanation.reason.text}
            </p>
          ) : (
            <></>
          )}
          <p>{explanation.advice}</p>
        </div>
      }
    />
  );
};

export default PendingInvitationPill;
