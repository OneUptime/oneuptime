import Dictionary from "../Dictionary";
import { translationKey, Translator } from "../Translator";

/*
 * THE EMAIL AN ACCOUNT'S OLD ADDRESS GETS WHEN THE ACCOUNT MOVES (#9907).
 *
 * Since #9821 a person's own change of email address waits for the new
 * address to confirm it: the account moves only when the link sent there is
 * opened. Nothing was sent to the address the account was leaving, so
 * somebody else holding a session - a shared computer, a session taken some
 * other way - could move the account to an address of their own, confirm it
 * from their own mailbox and reset the password there, and the owner learned
 * of it only when signing in stopped working.
 *
 * Now every time an account's address actually changes - the confirmation
 * link's write, a master admin's change, SCIM, any other write OneUptime
 * makes - the address it had is told, once
 * (Server/Utils/EmailChange/EmailAddressChangedNotice, sent from
 * UserService.onUpdateSuccess), in the language on the account:
 *
 *   - that the address changed, and to which, masked (maskEmailAddress):
 *     enough for the owner to recognise an address of their own, too little
 *     for anybody else who reads the old mailbox to write to the new one;
 *   - when, in the reader's own time zone;
 *   - from where - the IP address, rough place and device of the request
 *     that made the change (Partials/RequestOriginFields.hbs) - when that
 *     request was the account's own: its confirmation link, or a master
 *     admin changing their own address. A server admin's change of somebody
 *     else's address and an identity provider's are named by role and say
 *     when alone, as the other emails about a server admin's action do
 *     (Types/SSO/SignInSettingsClearedEmail);
 *   - what to do if it was not them, and whom to ask.
 *
 * A write that leaves the address as it was - SCIM and single sign-on send
 * it again with every push and sign-in, in any case - changes nothing and
 * sends nothing.
 *
 * NO UNDO LINK. A link that let the old address move the account back for a
 * few days would be the same link whoever made the change, and the server
 * cannot tell them apart: the owner and somebody holding their session both
 * ask from a signed-in session and confirm from the new mailbox, and a
 * session alone can set a new password (Update Password asks for no current
 * one), so nothing the owner knows could stand guard over it. Moving away
 * from a mailbox somebody else reads is the very recovery step UserService
 * protects (expirePasswordResetTokensForEmailChange); a link mailed to that
 * mailbox would hand the account back to whoever reads it, for as long as
 * the link worked. So the email says whom to ask instead: a server admin
 * can move an address back at once.
 *
 * NOTHING SECRET. The email carries no link that does anything, no token,
 * no password, and the new address masked; its only button-like words are
 * whom to ask.
 *
 * React-free and server-safe: the sender, UserService and the tests read it.
 */

// Who changed an account's address, as the email names them: by role, never by name.
export enum EmailAddressChangedBy {
  /*
   * The account itself: the person's own change, confirmed with the link
   * sent to the new address (#9821), or a master admin's change of their own
   * address, which is written at once. Whoever was signed in made it, so the
   * email says from where.
   */
  AccountOwner = "AccountOwner",
  // A master admin, changing somebody else's address (Admin Dashboard, the API).
  ServerAdmin = "ServerAdmin",
  // The organization's identity provider, through SCIM.
  IdentityProvider = "IdentityProvider",
  // A write OneUptime made itself that names nobody: said without a role.
  OneUptime = "OneUptime",
}

const EMAIL_ADDRESS_CHANGERS: ReadonlyArray<string> = [
  EmailAddressChangedBy.AccountOwner,
  EmailAddressChangedBy.ServerAdmin,
  EmailAddressChangedBy.IdentityProvider,
  EmailAddressChangedBy.OneUptime,
];

export const isEmailAddressChangedBy: (
  value: unknown,
) => value is EmailAddressChangedBy = (
  value: unknown,
): value is EmailAddressChangedBy => {
  return typeof value === "string" && EMAIL_ADDRESS_CHANGERS.includes(value);
};

/*
 * Where OneUptime's own write of an address names who it is for: a key of
 * the update's miscDataProps (UpdateOneBy). The confirmation link names the
 * account's own change, SCIM the identity provider. Read on a root write
 * only (getEmailAddressChanger): a request's miscDataProps are its caller's
 * to write.
 */
export const EMAIL_ADDRESS_CHANGED_BY_KEY: string = "emailAddressChangedBy";

/*
 * Who changed an account's address, from the write that changed it:
 *
 *   - OneUptime's own write (root) says so itself, through
 *     EMAIL_ADDRESS_CHANGED_BY_KEY, or names nobody;
 *   - a request's write of the caller's own account is the account's own
 *     change (a master admin's, which is written at once: everybody else's
 *     waits for its link and is written by the link, as root);
 *   - a request's write of somebody else's account is a master admin's,
 *     the only callers who may write another account's address.
 */
export const getEmailAddressChanger: (data: {
  isRoot: boolean;
  isMasterAdmin: boolean;
  callerUserId: string | undefined;
  accountUserId: string;
  namedChanger: unknown;
}) => EmailAddressChangedBy = (data: {
  isRoot: boolean;
  isMasterAdmin: boolean;
  callerUserId: string | undefined;
  accountUserId: string;
  namedChanger: unknown;
}): EmailAddressChangedBy => {
  if (data.isRoot) {
    return isEmailAddressChangedBy(data.namedChanger)
      ? data.namedChanger
      : EmailAddressChangedBy.OneUptime;
  }

  if (
    data.callerUserId &&
    data.callerUserId.toLowerCase() === data.accountUserId.toLowerCase()
  ) {
    return EmailAddressChangedBy.AccountOwner;
  }

  return data.isMasterAdmin
    ? EmailAddressChangedBy.ServerAdmin
    : EmailAddressChangedBy.OneUptime;
};

// What stands for the part of an address the email leaves out.
export const MASKED_ADDRESS_PART: string = "•••";

// A text's first character, whole: an emoji or an accented letter is one.
const firstCharacterOf: (value: string) => string = (value: string): string => {
  return Array.from(value)[0] || "";
};

/*
 * An address as the email to the old one names it: the first character of
 * its name and of its domain, a mask of one width for the rest, and the
 * domain's last label - "r•••@n•••.com". Never its length, and never more
 * than two of its characters besides the top-level label: the owner
 * recognises an address of their own, and somebody else who reads the old
 * mailbox learns too little to write to the new one. An address that
 * cannot be read is the mask alone.
 */
export const maskEmailAddress: (
  address: { toString(): string } | string | null | undefined,
) => string = (
  address: { toString(): string } | string | null | undefined,
): string => {
  const text: string = (address?.toString() || "").trim();
  const at: number = text.lastIndexOf("@");

  if (at < 1 || at === text.length - 1) {
    return MASKED_ADDRESS_PART;
  }

  const name: string = firstCharacterOf(text.slice(0, at));
  const labels: Array<string> = text
    .slice(at + 1)
    .split(".")
    .filter((label: string): boolean => {
      return label.length > 0;
    });
  const host: string = firstCharacterOf(labels[0] || "");

  if (!name || !host) {
    return MASKED_ADDRESS_PART;
  }

  const topLevel: string =
    labels.length > 1 ? `.${labels[labels.length - 1]}` : "";

  return `${name}${MASKED_ADDRESS_PART}@${host}${MASKED_ADDRESS_PART}${topLevel}`;
};

/*
 * The email's subject, in the reader's language: literal, since the
 * product's name is the installation's own (ProductBrandingText).
 */
export const getEmailAddressChangedSubject: (
  translator: Translator,
  productName: string,
) => string = (translator: Translator, productName: string): string => {
  return translator.translateTemplate(
    translationKey("Your {{product}} email address was changed"),
    { product: productName },
  );
};

// What the template is handed, beside the brand's own variables.
export interface EmailAddressChangedEmailData {
  changedBy: EmailAddressChangedBy;
  productName: string;
  // The address the account moved to: masked here, never handed on whole.
  newEmail: { toString(): string } | string;
  // When, already written in the reader's time zone and language.
  changedAt: string;
  /*
   * Where the change came from, as RequestOriginUtil writes it: "" for what
   * is not known. Drawn for the account's own change only.
   */
  requestIpAddress: string;
  requestLocation: string;
  requestDevice: string;
}

/*
 * The template's variables. A flag is "true" or left out, as the template's
 * {{#if}} reads it. The new address goes in masked, and where the change
 * came from only when it was the account's own: a server admin's own
 * address and device, or an identity provider's server, are nobody's
 * business in the email, whatever the caller hands in.
 */
export const getEmailAddressChangedEmailVariables: (
  data: EmailAddressChangedEmailData,
) => Dictionary<string> = (
  data: EmailAddressChangedEmailData,
): Dictionary<string> => {
  const isAccountOwner: boolean =
    data.changedBy === EmailAddressChangedBy.AccountOwner;

  const vars: Dictionary<string> = {
    productName: data.productName,
    changedAt: data.changedAt,
    newEmailAddress: maskEmailAddress(data.newEmail),
    requestIpAddress: isAccountOwner ? data.requestIpAddress || "" : "",
    requestLocation: isAccountOwner ? data.requestLocation || "" : "",
    requestDevice: isAccountOwner ? data.requestDevice || "" : "",
  };

  if (isAccountOwner) {
    vars["changedByAccountOwner"] = "true";
  } else if (data.changedBy === EmailAddressChangedBy.ServerAdmin) {
    vars["changedByServerAdmin"] = "true";
  } else if (data.changedBy === EmailAddressChangedBy.IdentityProvider) {
    vars["changedByIdentityProvider"] = "true";
  } else {
    vars["changedByOneUptime"] = "true";
  }

  return vars;
};
