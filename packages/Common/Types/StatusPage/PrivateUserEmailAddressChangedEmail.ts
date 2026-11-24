import Dictionary from "../Dictionary";
import { translationKey, Translator } from "../Translator";
import {
  EmailAddressChangedBy,
  isEmailAddressChangedBy,
  maskEmailAddress,
} from "../Accounts/EmailAddressChangedEmail";

/*
 * THE EMAIL A STATUS PAGE PRIVATE USER'S OLD ADDRESS GETS WHEN THEIR ADDRESS
 * CHANGES (#10156).
 *
 * A private user signs in to a private status page with their address, and
 * resets their password through it (StatusPageForgotPassword). The address
 * can change without them: the status page's team edits it on Private
 * Users, and the page's identity provider writes a new one through SCIM
 * (StatusPageSCIM). Nothing told the address they had, so whoever moved it
 * could reset the password at the new one - the takeover #9907 closed for
 * accounts, on a smaller scale.
 *
 * Now every time a private user's address really changes, the address they
 * had is told, once (Server/Utils/StatusPage/
 * PrivateUserEmailAddressChangedNotice, sent from
 * StatusPagePrivateUserService.onUpdateSuccess), in the status page's
 * branding and default language, as the page's own emails are:
 *
 *   - that it changed, and to which address, masked as the email to an
 *     account's old address masks it (maskEmailAddress): enough for the
 *     owner to recognise an address of their own, too little for anybody
 *     else who reads the old mailbox to write to the new one;
 *   - when;
 *   - who changed it, by role: the team that runs the status page, or its
 *     identity provider through SCIM - never a person's name, address or
 *     device;
 *   - whom to ask if it was not expected.
 *
 * A write of the address the user already has - SCIM sends it again with
 * every push, in any case - changes nothing and sends nothing. No link that
 * does anything, no token: as #9907 says, undoing the change from the old
 * mailbox would work for whoever reads it.
 *
 * React-free and server-safe: the sender, the service and the tests read it.
 */

// Who changed a private user's address, as the email names them: by role.
export enum PrivateUserEmailAddressChangedBy {
  // The status page's team, on the Dashboard's Private Users page or the API.
  StatusPageTeam = "StatusPageTeam",
  // The status page's identity provider, through SCIM.
  IdentityProvider = "IdentityProvider",
  // A write OneUptime made itself that names nobody: said without a role.
  OneUptime = "OneUptime",
}

/*
 * Who changed a private user's address, from the write that changed it.
 * OneUptime's own write (root) names its changer in miscDataProps
 * (EMAIL_ADDRESS_CHANGED_BY_KEY, as SCIM names the identity provider for an
 * account), and a request's miscDataProps are its caller's to write, so a
 * named changer is honoured on a root write only. A request's write is the
 * team's: a private user never changes their own address.
 */
export const getPrivateUserEmailAddressChanger: (data: {
  isRoot: boolean;
  namedChanger: unknown;
}) => PrivateUserEmailAddressChangedBy = (data: {
  isRoot: boolean;
  namedChanger: unknown;
}): PrivateUserEmailAddressChangedBy => {
  if (!data.isRoot) {
    return PrivateUserEmailAddressChangedBy.StatusPageTeam;
  }

  return isEmailAddressChangedBy(data.namedChanger) &&
    data.namedChanger === EmailAddressChangedBy.IdentityProvider
    ? PrivateUserEmailAddressChangedBy.IdentityProvider
    : PrivateUserEmailAddressChangedBy.OneUptime;
};

/*
 * The email's subject, in the page's language: literal, since the page's
 * name is its team's own words.
 */
export const getPrivateUserEmailAddressChangedSubject: (
  translator: Translator,
  statusPageName: string,
) => string = (translator: Translator, statusPageName: string): string => {
  return translator.translateTemplate(
    translationKey("Your email address for {{statusPage}} was changed"),
    { statusPage: statusPageName },
  );
};

// What the template is handed, beside the brand's and the page's own variables.
export interface PrivateUserEmailAddressChangedEmailData {
  changedBy: PrivateUserEmailAddressChangedBy;
  statusPageName: string;
  // The address the user moved to: masked here, never handed on whole.
  newEmail: { toString(): string } | string;
  // When, already written in the page's language.
  changedAt: string;
}

/*
 * The template's variables. A flag is "true" or left out, as its {{#if}}
 * reads it, and exactly one changer is set. The new address goes in masked.
 */
export const getPrivateUserEmailAddressChangedEmailVariables: (
  data: PrivateUserEmailAddressChangedEmailData,
) => Dictionary<string> = (
  data: PrivateUserEmailAddressChangedEmailData,
): Dictionary<string> => {
  const vars: Dictionary<string> = {
    statusPageName: data.statusPageName,
    changedAt: data.changedAt,
    newEmailAddress: maskEmailAddress(data.newEmail),
  };

  if (data.changedBy === PrivateUserEmailAddressChangedBy.StatusPageTeam) {
    vars["changedByStatusPageTeam"] = "true";
  } else if (
    data.changedBy === PrivateUserEmailAddressChangedBy.IdentityProvider
  ) {
    vars["changedByIdentityProvider"] = "true";
  } else {
    vars["changedByOneUptime"] = "true";
  }

  return vars;
};
