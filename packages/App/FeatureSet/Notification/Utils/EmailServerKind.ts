import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import Dictionary from "Common/Types/Dictionary";

/*
 * WHO RUNS THE SERVER AN EMAIL COMES FROM (#8190), AND WHERE ITS PEOPLE
 * WRITE FOR HELP (#10941).
 *
 * An account email ends with where to get help (Partials/SupportBlock.hbs).
 * On OneUptime Cloud that is OneUptime's support. On a self-hosted server
 * it is the server's own admin: OneUptime's support cannot help with
 * somebody's own server, and every account email there - a password reset,
 * a sign-in link, an invitation - sent its people to support@oneuptime.com.
 * The self-hosted welcome already said "Need help? Ask your server's admin."
 * (SignupAccountReadyEmail, #7988); now every email that offers help does.
 *
 * Where the server's admins set a support address of their own (Admin
 * Dashboard > Settings > Help and Support > Support Email), the emails
 * name that address instead, as a mailto: link: "Need help? Write to
 * it-help@example.com." On OneUptime's default, or hidden, they say what
 * they always did. The address is public already - the sign-in pages'
 * env.js carries it - so an email reveals nothing new by naming it.
 *
 * MailService.render adds this to every email, decided in one place rather
 * than by each sender:
 *
 *   isSelfHosted        "true" on a self-hosted server (billing off, as
 *                       GlobalConfigAPI's isSelfHosted reads it), else absent
 *   serverSupportEmail  the server's own support address, on a self-hosted
 *                       server that set one, else absent - never on
 *                       OneUptime Cloud, whatever its settings say
 *
 * Reserved, like the brand's variables: whatever a sender put there is
 * replaced, so no email can claim to come from a server it does not, or
 * send its reader to an address the server's admins did not set.
 */

export const SERVER_KIND_VARIABLE_NAMES: ReadonlyArray<string> = [
  "isSelfHosted",
  "serverSupportEmail",
];

/*
 * What an email from a server that bills (Cloud), or one that does not,
 * gets, with the server's own support address when it has one.
 */
export const getEmailServerKindVariables: (
  isBillingEnabled: boolean,
  serverSupportEmail?: string | null | undefined,
) => Dictionary<string> = (
  isBillingEnabled: boolean,
  serverSupportEmail?: string | null | undefined,
): Dictionary<string> => {
  if (isBillingEnabled) {
    return {};
  }

  const address: string = (serverSupportEmail || "").trim();

  return address
    ? { isSelfHosted: "true", serverSupportEmail: address }
    : { isSelfHosted: "true" };
};

// Whether this server is self-hosted, as it is configured right now.
export const isCurrentServerSelfHosted: () => boolean = (): boolean => {
  return IsBillingEnabled !== true;
};

// The variables for this server, as it is configured right now.
export const getCurrentEmailServerKindVariables: (
  serverSupportEmail?: string | null | undefined,
) => Dictionary<string> = (
  serverSupportEmail?: string | null | undefined,
): Dictionary<string> => {
  return getEmailServerKindVariables(
    IsBillingEnabled === true,
    serverSupportEmail,
  );
};
