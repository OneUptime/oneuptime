import UserService from "../../Services/UserService";
import logger from "../Logger";
import { getServerTranslator } from "../ServerTranslation";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import { getInvitationSubject } from "../../../Types/Team/InvitationEmailWords";
import { getUserChosenLanguage } from "../../../Types/UserLanguage";
import User from "../../../Models/DatabaseModels/User";

/*
 * WHO INVITED SOMEBODY, AS THE INVITATION NAMES THEM (#7471).
 *
 * An invitation email said "You've been invited to join a project on
 * OneUptime" and named nobody: someone deciding whether to trust an email
 * from a tool they have never heard of looks for a name they know. The
 * invitation now names the person who made it - "Ada Walker
 * (ada@walk.co) invited you to join Walk Co on OneUptime." - in its
 * subject and its first line, and on a self-hosted server its help line
 * sends questions to them (or the server's admin), and a reply goes to
 * them: OneUptime's support cannot help with somebody's own server.
 *
 * The inviter is the person making the membership (the request's user),
 * read as OneUptime: an invitation OneUptime makes itself - SCIM, a first
 * sign-in through SSO - or that an API key or a workflow makes, names
 * nobody, and the email reads as it always did. Nor does one a person
 * makes for themselves. The sign-up page an invitation opens names them
 * the same way, from the membership's creator (SignUpInvitation).
 */

export interface InvitationInviter {
  // Their name as their account writes it, on one line; "" while they have none.
  name: string;
  email: string;
  /*
   * The language their account picked (Types/UserLanguage), when it picked
   * one: what an invitation is written in for an invitee who picked none
   * (#9897, Types/Team/InvitationEmailWords).
   */
  language?: string | undefined;
}

// The longest name an invitation carries: a person's name is shorter.
export const MAX_INVITER_NAME_LENGTH: number = 100;

const WHITESPACE_RUN: RegExp = /\s+/g;

// A control character, or a line or paragraph separator: never in a subject.
const isControlCharacter: (character: string) => boolean = (
  character: string,
): boolean => {
  const code: number = character.codePointAt(0) || 0;

  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029
  );
};

export default class InvitationInviterUtil {
  /*
   * A name as a subject line and a sentence may carry it: one line, with
   * no control characters - a subject is a mail header - and no longer
   * than MAX_INVITER_NAME_LENGTH characters, never cut inside one.
   */
  public static toOneLine(text: string | null | undefined): string {
    const characters: Array<string> = Array.from(
      Array.from(text || "")
        .map((character: string): string => {
          return isControlCharacter(character) ? " " : character;
        })
        .join("")
        .replace(WHITESPACE_RUN, " ")
        .trim(),
    );

    return characters.slice(0, MAX_INVITER_NAME_LENGTH).join("").trimEnd();
  }

  // The account, as an invitation names it, or null when it names nobody.
  public static fromUser(
    user: User | null | undefined,
  ): InvitationInviter | null {
    const email: string = user?.email?.toString().trim() || "";

    if (!email) {
      return null;
    }

    const language: string = getUserChosenLanguage(user);

    return {
      name: InvitationInviterUtil.toOneLine(user?.name?.toString()),
      email: email,
      ...(language ? { language: language } : {}),
    };
  }

  // "Ada Walker", or the address alone for an account with no name.
  public static getName(inviter: InvitationInviter): string {
    return inviter.name || inviter.email;
  }

  // "Ada Walker (ada@walk.co)": a name the reader knows, and an address to check it by.
  public static getLabel(inviter: InvitationInviter): string {
    return inviter.name ? `${inviter.name} (${inviter.email})` : inviter.email;
  }

  /*
   * The invitation email's subject: who sent it and where to, or - naming
   * nobody - what it always said. In `language` (#9897), English without
   * one (Types/Team/InvitationEmailWords).
   */
  public static getSubject(data: {
    projectName: string;
    inviter: InvitationInviter | null;
    isAccepted: boolean;
    language?: string | undefined;
  }): string {
    return getInvitationSubject(getServerTranslator(data.language), {
      projectName: data.projectName,
      inviterName: data.inviter
        ? InvitationInviterUtil.getName(data.inviter)
        : null,
      isAccepted: data.isAccepted,
    });
  }

  // The invitation template's variables that name the inviter, or none.
  public static getTemplateVars(
    inviter: InvitationInviter | null,
  ): Dictionary<string> {
    if (!inviter) {
      return {};
    }

    return {
      inviterLabel: InvitationInviterUtil.getLabel(inviter),
      inviterName: InvitationInviterUtil.getName(inviter),
    };
  }

  /*
   * Where a reply to the invitation goes: to the inviter, on a self-hosted
   * server, whose own mailbox is the one place a question about it is
   * answered; OneUptime Cloud's replies go where they always went.
   */
  public static getReplyTo(data: {
    inviter: InvitationInviter | null;
    isSelfHosted: boolean;
  }): Email | undefined {
    if (
      !data.isSelfHosted ||
      !data.inviter ||
      !Email.isValid(data.inviter.email)
    ) {
      return undefined;
    }

    return new Email(data.inviter.email);
  }

  /*
   * Who is making this invitation, as it names them: the request's person,
   * when there is one and it is not the person invited. Read as OneUptime,
   * since the inviter's own account is all it reads. Never fails the
   * invitation: a name that cannot be read is no name, and the email reads
   * as it always did.
   */
  @CaptureSpan()
  public static async read(data: {
    props: DatabaseCommonInteractionProps;
    inviteeUserId?: ObjectID | null | undefined;
  }): Promise<InvitationInviter | null> {
    const inviterId: ObjectID | undefined = data.props.userId;

    if (!inviterId) {
      return null;
    }

    if (
      data.inviteeUserId &&
      data.inviteeUserId.toString().toLowerCase() ===
        inviterId.toString().toLowerCase()
    ) {
      return null;
    }

    try {
      return await InvitationInviterUtil.readById(inviterId);
    } catch (err) {
      logger.warn("Could not read who made an invitation; it names nobody.");
      logger.warn(err);
      return null;
    }
  }

  // The account with this id, as an invitation names it, or null.
  @CaptureSpan()
  public static async readById(
    userId: ObjectID | null | undefined,
  ): Promise<InvitationInviter | null> {
    if (!userId) {
      return null;
    }

    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        _id: true,
        name: true,
        email: true,
        // What the invitation is written in when the invitee picked none (#9897).
        language: true,
      },
      props: {
        isRoot: true,
      },
    });

    return InvitationInviterUtil.fromUser(user);
  }
}
