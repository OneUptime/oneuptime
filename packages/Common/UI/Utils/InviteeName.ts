import Email from "../../Types/Email";
import { translationKey } from "../../Types/Translator";

/*
 * THE NAME AN INVITATION SETS UP A NEW ACCOUNT WITH (#9745).
 *
 * Every invite form - Invite New User and a team's Invite New Team Member
 * on the Dashboard, and their twins on the Admin Dashboard's project pages
 * - asks for the invitee's name beside their address, for someone new to
 * OneUptime, whose account the invitation creates.
 *
 * The forms used to ask the server first whether the address had an
 * account (POST /team-member/is-user-registered), and offered the name only
 * when it had none. That question told any signed-in account whether any
 * address uses OneUptime, one address at a time, so it is gone. The name is
 * offered once an address is typed, optional, whoever it belongs to; the
 * server uses it only for an account nobody has signed up to yet
 * (TeamMemberService.onBeforeCreate), so a person with an account keeps
 * their own name, and the inviter learns nothing either way.
 *
 * Not offered for the person the email box's suggestions named and the
 * inviter picked (the Dashboard's InviteeEmailField): the suggestions list
 * only people the reader may see, each with the name they have, so there
 * is nothing to ask.
 */

/*
 * What the name is for, under the field (each form's "name" row, beside
 * its "email" row).
 */
export const INVITEE_NAME_DESCRIPTION: string = translationKey(
  "If they have no OneUptime account yet, it is set up with this name.",
);

/*
 * Whether the form asks for the name: once a whole address is typed,
 * unless it is the address of the person picked from the suggestions.
 */
export const shouldAskForInviteeName: (data: {
  email: unknown;
  // The address of the suggestion picked last, if one was.
  pickedEmail?: string | null | undefined;
}) => boolean = (data: {
  email: unknown;
  pickedEmail?: string | null | undefined;
}): boolean => {
  if (typeof data.email !== "string") {
    return false;
  }

  const typed: string = data.email.trim();

  if (!typed || !Email.isValid(typed)) {
    return false;
  }

  const picked: string = (data.pickedEmail || "").trim();

  return !picked || picked.toLowerCase() !== typed.toLowerCase();
};
