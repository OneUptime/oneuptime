import { DEFAULT_READER_LANGUAGE } from "../ReaderLanguage";
import { translationKey, Translator } from "../Translator";
import { getUserChosenLanguage } from "../UserLanguage";

/*
 * THE INVITATION EMAIL, IN THE INVITEE'S LANGUAGE (#9897).
 *
 * The invitation email (Notification/Templates/InviteMember.hbs, sent by
 * TeamMemberService.buildInvitationEmail for a new invitation and a resend
 * alike) was written in English only, while the sign-up page it opens
 * reads in the visitor's language: a German invitee got an English email,
 * then a German page. It is now written, subject and body, in:
 *
 *   1. the invitee's own language: the one their account picked
 *      (Types/UserLanguage), English included - it is a choice of its own;
 *   2. else the inviter's: they are the one writing to the person, and most
 *      often share a language with them;
 *   3. else English: a project has no language of its own, and OneUptime
 *      writes English to whoever picked none, as it always has.
 *
 * An account the invitation itself made has no language, so its person is
 * written to in the inviter's. An invitation OneUptime makes itself (SCIM,
 * a first sign-in through SSO) names no inviter: the invitee's language,
 * else English.
 *
 * WHAT THE INVITING PROJECT SEES OF IT. The project's email log
 * (Notification MailService, EmailLog) is read by its members and viewers.
 * A subject written in the invitee's own language would tell them that the
 * address already had an account - one the invitation made has no language
 * - and which language it reads, which #9823 keeps from them. So the log
 * keeps the subject in the language the email has for an invitee with no
 * language of their own (getInvitationProjectLogLanguage): the inviter's,
 * else English - the same for every address the project invites
 * (EmailEnvelope.projectLogSubject).
 *
 * Pure: no Node, browser or database APIs.
 */

// A language somebody picked, as OneUptime writes in it, or "" for none.
const toChosenLanguage: (language: string | null | undefined) => string = (
  language: string | null | undefined,
): string => {
  return getUserChosenLanguage({ language: language });
};

// The language the invitation email is written in (see the top of this file).
export const getInvitationLanguage: (data: {
  // The language the invitee's account picked, if any.
  inviteeLanguage: string | null | undefined;
  // The language the inviter's account picked, if any.
  inviterLanguage: string | null | undefined;
}) => string = (data: {
  inviteeLanguage: string | null | undefined;
  inviterLanguage: string | null | undefined;
}): string => {
  return (
    toChosenLanguage(data.inviteeLanguage) ||
    toChosenLanguage(data.inviterLanguage) ||
    DEFAULT_READER_LANGUAGE
  );
};

/*
 * The language the project's email log keeps the invitation's subject in:
 * the email's for an invitee with no language of their own - the
 * inviter's, else English - whatever the invitee's account says.
 */
export const getInvitationProjectLogLanguage: (data: {
  inviterLanguage: string | null | undefined;
}) => string = (data: {
  inviterLanguage: string | null | undefined;
}): string => {
  return getInvitationLanguage({
    inviteeLanguage: null,
    inviterLanguage: data.inviterLanguage,
  });
};

/*
 * The invitation email's subject, in `translator`'s language: who sent it
 * and where to - or, naming nobody, what it always said. The names go in
 * as written.
 */
export const getInvitationSubject: (
  translator: Translator,
  data: {
    projectName: string;
    // How the invitation names its inviter ("Ada Walker"), or null for nobody.
    inviterName: string | null;
    // Accepted for them as it was made: they were added, not invited.
    isAccepted: boolean;
  },
) => string = (
  translator: Translator,
  data: {
    projectName: string;
    inviterName: string | null;
    isAccepted: boolean;
  },
): string => {
  if (!data.inviterName) {
    return data.isAccepted
      ? translator.translateTemplate(
          translationKey("You have been added to {{project}}"),
          { project: data.projectName },
        )
      : translator.translateTemplate(
          translationKey("You have been invited to {{project}}"),
          { project: data.projectName },
        );
  }

  return data.isAccepted
    ? translator.translateTemplate(
        translationKey("{{inviter}} added you to {{project}}"),
        { inviter: data.inviterName, project: data.projectName },
      )
    : translator.translateTemplate(
        translationKey("{{inviter}} invited you to {{project}}"),
        { inviter: data.inviterName, project: data.projectName },
      );
};
