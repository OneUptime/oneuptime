import ExplainedPill from "../Pill/ExplainedPill";
import { PillTone } from "../Pill/PillTone";
import { EmailLogReason, getEmailLogReason } from "../../Utils/EmailLogReason";
import { joinSentences } from "../../Utils/SentenceSeparator";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * EMAIL NOT SENT, ON A PENDING PERSON'S ROW (#9511, #9518).
 *
 * A pending person whose latest invitation email the mail service refused
 * says Email Not Sent, not Invitation Sent - in the Dashboard's lists of
 * people (Settings > Users, a person's Teams, a team's Members) and in the
 * Admin Dashboard's (a project's Users, one of its teams, one of its
 * people, a person's projects). Pressed or pointed at, it says so in
 * OneUptime's words, then the mail service's answer as the project's Email
 * Log words it (EmailLogReason), then what to do - which the page decides,
 * since it knows its reader: a master admin is handed the link on the row;
 * anybody else is told to send the invitation again once email works, or
 * to ask the server's admin for the link.
 *
 * The red of the danger tone: it broke - the email did not go
 * (Docs/ux/README.md#one-control-for-one-job).
 */

export const INVITATION_EMAIL_NOT_SENT_COPY: {
  pill: string;
  notSent: string;
  forMasterAdmin: string;
} = {
  pill: translationKey("Email Not Sent"),
  notSent: translationKey("Their invitation email was not sent."),
  // For a master admin, whom the row hands the link: as the server's Email Log says it.
  forMasterAdmin: translationKey(
    "They can still join: send them their invitation link yourself.",
  ),
};

export const EMAIL_NOT_SENT_PILL_TEST_ID: string = "invitation-email-not-sent";
export const EMAIL_NOT_SENT_REASON_TEST_ID: string =
  "invitation-email-not-sent-reason";

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
  // Why, as the project's Email Log holds it.
  statusMessage: string;
  // What to do, in English: a key, looked up here.
  advice: string;
  translator: Translator;
}) => InvitationEmailNotSentExplanation = (data: {
  statusMessage: string;
  advice: string;
  translator: Translator;
}): InvitationEmailNotSentExplanation => {
  const reason: EmailLogReason = getEmailLogReason(
    data.statusMessage,
    data.translator,
  );

  return {
    notSent:
      data.translator.translateText(INVITATION_EMAIL_NOT_SENT_COPY.notSent) ||
      INVITATION_EMAIL_NOT_SENT_COPY.notSent,
    reason: reason.text.trim() ? reason : null,
    advice: data.translator.translateText(data.advice) || data.advice,
  };
};

export interface ComponentProps {
  // Why their latest invitation email was not sent, as the Email Log holds it.
  statusMessage: string;
  // What to do, in English: the page's key for its reader.
  advice: string;
}

const InvitationEmailNotSentPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const explanation: InvitationEmailNotSentExplanation =
    getInvitationEmailNotSentExplanation({
      statusMessage: props.statusMessage,
      advice: props.advice,
      translator: translator,
    });

  return (
    <ExplainedPill
      text={INVITATION_EMAIL_NOT_SENT_COPY.pill}
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

export default InvitationEmailNotSentPill;
