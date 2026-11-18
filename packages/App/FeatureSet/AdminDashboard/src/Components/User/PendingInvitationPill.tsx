import { Yellow } from "Common/Types/BrandColors";
import { InvitationEmailNotSent } from "Common/Types/Team/InvitationEmailsNotSent";
import InvitationEmailNotSentPill, {
  INVITATION_EMAIL_NOT_SENT_COPY,
} from "Common/UI/Components/InvitationLink/InvitationEmailNotSentPill";
import { INVITATION_LINK_COPY } from "Common/UI/Components/InvitationLink/InvitationLinkModal";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A PENDING PERSON'S STATUS, IN THE ADMIN DASHBOARD'S LISTS OF A PROJECT'S
 * PEOPLE (#9518): a project's Users, one of its teams, one of its people,
 * and a person's projects and team memberships. One pill, as the
 * Dashboard's lists draw it (Dashboard's Components/User/
 * PendingInvitationPill):
 *
 *   - Invited, on a server known not to send email: the invitation is
 *     created, and nobody was emailed;
 *   - Email Not Sent, when the mail service refused the person's latest
 *     invitation email to that project (useInvitationEmailsNotSent, across
 *     projects): pressed or pointed at, it says why, as the project's Email
 *     Log words it, and - every reader here being a master admin, whom the
 *     row hands the link - that they can still join with it;
 *   - Invitation Sent, otherwise.
 */

export const PENDING_INVITATION_PILL_TEST_ID: string = "pending-invitation";

export interface ComponentProps {
  // The server is known not to send email: nothing was sent.
  cannotSendEmail: boolean;
  // The person's latest invitation email to the row's project was not sent: why.
  notSent?: InvitationEmailNotSent | undefined;
}

const PendingInvitationPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Nothing was sent by a server that cannot send email.
  if (props.cannotSendEmail) {
    return (
      <Pill
        text={INVITATION_LINK_COPY.invitedPill}
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
      advice={INVITATION_EMAIL_NOT_SENT_COPY.forMasterAdmin}
    />
  );
};

export default PendingInvitationPill;
