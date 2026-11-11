/*
 * THE SIGN-UP OF SOMEBODY WHO WAS INVITED (issue #6807).
 *
 * An invitation to a project sends somebody without an account to
 * /accounts/register?email=<address>&token=<claim token>
 * (Common/Server/Utils/InvitationLink, UserRegistrationToken): the email is
 * theirs and locked, and the token proves the mailbox. Such a person is
 * asked for their name and a password, and nothing else:
 *
 *   - not the company name: the project that invited them already has one;
 *   - not a phone number: it is asked for where it is used, as a way for
 *     OneUptime to reach them (User Settings > Notification Methods), which
 *     Home's first steps for an invited member lead to;
 *   - on a self-hosted server, not the optional company and phone either:
 *     they tell OneUptime about a new installation, and an invited person is
 *     not installing one.
 *
 * The server never required either field (Identity's signup reads them as
 * given), so this is the whole change.
 */
export const isInvitedSignUp: (query: {
  email: string | null | undefined;
  token: string | null | undefined;
}) => boolean = (query: {
  email: string | null | undefined;
  token: string | null | undefined;
}): boolean => {
  return Boolean(query.email?.trim() && query.token?.trim());
};

// Whether the sign-up form asks for the company name and phone number.
export const shouldAskForCompanyDetails: (data: {
  isInvitedSignUp: boolean;
}) => boolean = (data: { isInvitedSignUp: boolean }): boolean => {
  return !data.isInvitedSignUp;
};
