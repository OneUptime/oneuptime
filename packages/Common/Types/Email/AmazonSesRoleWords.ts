import type { AwsRoleSignInWords } from "../CloudConnection/AwsRoleSignInFailures";
import { translationKey } from "../Translator";

/*
 * WHAT A PROJECT IS TOLD OF ITS AMAZON SES IAM ROLE, IN ONEUPTIME'S WORDS
 * (#7378).
 *
 * A project's Amazon SES config that signs in with an IAM role in its own
 * AWS account (ProjectAmazonSesAuthenticationType.IamRole) is signed in to
 * by AwsSts.assumeRole, as Cloud Connect's roles are: checked first, then
 * signed in to with this project's email external id. What fails is said
 * here, in email's words (an email not sent, a test email, the trust policy
 * the config's form shows) - never AWS's own answer, which names
 * OneUptime's identity, and never a key or a token.
 *
 * Every sentence is whole and carries no value, so each is a key of the
 * Dashboard's locales: the Send Test Email dialog and a save that is
 * refused say it in the reader's language. The server sends it in English,
 * for the API and the project's Email Logs. What the project needs to act -
 * the role's external id and its trust policy - is on the config's Amazon
 * SES step, which every sentence points to.
 *
 * Imports the Translator alone. React-free and server-safe.
 */

// When the check of the role, or the sign-in to it, fails.
export const AMAZON_SES_ROLE_SIGN_IN_WORDS: AwsRoleSignInWords = {
  checkRateLimited: translationKey(
    "AWS asked OneUptime to slow down while it checked that this config's IAM role requires its external ID, so the email was not sent. OneUptime checks again for the next email.",
  ),
  signInRateLimited: translationKey(
    "AWS asked OneUptime to slow down while it signed in to this config's IAM role, so the email was not sent. OneUptime signs in again for the next email.",
  ),
  checkUnanswered: translationKey(
    "AWS did not answer while OneUptime checked that this config's IAM role requires its external ID, so the email was not sent. OneUptime checks again for the next email.",
  ),
  signInUnanswered: translationKey(
    "AWS did not answer while OneUptime signed in to this config's IAM role, so the email was not sent. OneUptime signs in again for the next email.",
  ),
  serverCredentialsRefused: translationKey(
    "AWS did not take the credentials this OneUptime signs in to roles with, so the email was not sent. That is not the role's setup: OneUptime tries again for the next email, and the server's log says why.",
  ),
  checkFailed: translationKey(
    "OneUptime could not check that this config's IAM role requires its external ID, so it does not send through it. Check that the Role ARN is right, then send a test email.",
  ),
  signInNotPermitted: translationKey(
    "OneUptime could not sign in to this config's IAM role. Check that the role exists and that its trust policy is the one this config shows, with its external ID.",
  ),
  signInRefused: translationKey(
    "AWS did not let OneUptime sign in to this config's IAM role. Check that the Role ARN is right and that the role's trust policy is the one this config shows, with its external ID.",
  ),
  noCredentialsReturned: translationKey(
    "AWS did not return credentials for this config's IAM role, so the email was not sent.",
  ),
  serverCredentialsUnavailable: translationKey(
    "This OneUptime could not get its own AWS credentials just now, so the email was not sent. It tries again for the next email.",
  ),
  noServerIdentity: translationKey(
    "This OneUptime has no AWS identity to sign in to a role with, so it cannot send through this config's IAM role. Sign in to Amazon SES with an access key instead.",
  ),
};

/*
 * A role whose trust policy lets OneUptime in with any external id: any
 * project that knows its ARN could send email through it. Not sent
 * through, and dropped unread (AwsSts.assumeRole).
 */
export const AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID: string = translationKey(
  "This role lets OneUptime sign in without this config's external ID, so any project that knows its ARN could send email through your AWS account. OneUptime does not send through it until you add the sts:ExternalId condition of this config's trust policy to the role.",
);

/*
 * A role in the AWS account of OneUptime's own identity: never signed in
 * to for a project's email (AmazonSesProjectRole), whatever its trust
 * policy says.
 */
export const AMAZON_SES_ROLE_IN_SERVER_ACCOUNT: string = translationKey(
  "This role is in this OneUptime's own AWS account, which OneUptime never sends a project's email through. Create the role in your own AWS account.",
);

/*
 * OneUptime could not ask AWS which account its own identity is in, so it
 * cannot tell whether the role is in it: it does not sign in (fail closed).
 */
export const AMAZON_SES_SERVER_ACCOUNT_UNKNOWN: string = translationKey(
  "OneUptime could not tell which AWS account it signs in from, so it does not sign in to this config's IAM role. It tries again for the next email.",
);

// A config signing in with a role, sent without what it needs.
export const AMAZON_SES_ROLE_CONFIG_INCOMPLETE: string = translationKey(
  "Amazon SES needs a Role ARN and a Region to sign in with an IAM role.",
);

// What a save of a config that signs in with a role is refused for.
export const AMAZON_SES_AUTHENTICATION_TYPE_INVALID: string = translationKey(
  'Amazon SES\'s Authentication Type must be "Access Key" or "IAM Role".',
);

export const AMAZON_SES_ROLE_ARN_INVALID: string = translationKey(
  "Enter the ARN of an IAM role in your AWS account, such as arn:aws:iam::123456789012:role/OneUptimeSes.",
);

export const AMAZON_SES_ROLE_REGION_REQUIRED: string = translationKey(
  "Enter the AWS Region your sender's identity is verified in, such as us-east-1.",
);

export const AMAZON_SES_ROLE_NOT_AVAILABLE: string = translationKey(
  "This OneUptime has no AWS identity to sign in to a role with. Sign in to Amazon SES with an access key instead.",
);

// Every sentence a project may be told of its role, for the tests that hold each one to the locales.
export const AMAZON_SES_ROLE_SENTENCES: ReadonlyArray<string> = [
  ...Object.values(AMAZON_SES_ROLE_SIGN_IN_WORDS),
  AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID,
  AMAZON_SES_ROLE_IN_SERVER_ACCOUNT,
  AMAZON_SES_SERVER_ACCOUNT_UNKNOWN,
  AMAZON_SES_ROLE_CONFIG_INCOMPLETE,
  AMAZON_SES_AUTHENTICATION_TYPE_INVALID,
  AMAZON_SES_ROLE_ARN_INVALID,
  AMAZON_SES_ROLE_REGION_REQUIRED,
  AMAZON_SES_ROLE_NOT_AVAILABLE,
];
