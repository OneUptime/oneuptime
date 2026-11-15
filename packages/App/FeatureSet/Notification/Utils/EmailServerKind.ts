import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import Dictionary from "Common/Types/Dictionary";

/*
 * WHO RUNS THE SERVER AN EMAIL COMES FROM (#8190).
 *
 * An account email ends with where to get help (Partials/SupportBlock.hbs).
 * On OneUptime Cloud that is OneUptime's support. On a self-hosted server
 * it is the server's own admin: OneUptime's support cannot help with
 * somebody's own server, and every account email there - a password reset,
 * a sign-in link, an invitation - sent its people to support@oneuptime.com.
 * The self-hosted welcome already said "Need help? Ask your server's admin."
 * (SignupAccountReadyEmail, #7988); now every email that offers help does.
 *
 * MailService.render adds this to every email, decided in one place rather
 * than by each sender:
 *
 *   isSelfHosted  "true" on a self-hosted server (billing off, as
 *                 GlobalConfigAPI's isSelfHosted reads it), else absent
 *
 * Reserved, like the brand's variables: whatever a sender put there is
 * replaced, so no email can claim to come from a server it does not.
 */

export const SERVER_KIND_VARIABLE_NAMES: ReadonlyArray<string> = [
  "isSelfHosted",
];

// What an email from a server that bills (Cloud), or one that does not, gets.
export const getEmailServerKindVariables: (
  isBillingEnabled: boolean,
) => Dictionary<string> = (isBillingEnabled: boolean): Dictionary<string> => {
  return isBillingEnabled ? {} : { isSelfHosted: "true" };
};

// The variables for this server, as it is configured right now.
export const getCurrentEmailServerKindVariables: () => Dictionary<string> =
  (): Dictionary<string> => {
    return getEmailServerKindVariables(IsBillingEnabled === true);
  };
