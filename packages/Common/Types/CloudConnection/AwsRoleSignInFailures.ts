import { translationKey } from "../Translator";

/*
 * A SIGN-IN TO A CUSTOMER'S AWS ROLE THAT FAILED, IN ONEUPTIME'S WORDS AND
 * THE READER'S LANGUAGE (#10474).
 *
 * OneUptime signs in to a customer's role (AwsSts.assumeRole) after it has
 * checked that the role requires the project's external id
 * (probeRoleExternalId). When the check or the sign-in fails, the project
 * is told why in OneUptime's own words, never AWS's: AWS's answer to
 * OneUptime's identity names that identity ("User: arn:aws:iam::... is not
 * authorized"), so it goes to the server's log instead
 * (AwsSts.describeRoleFailure).
 *
 * Each sentence here is a key of the Dashboard's locales. It carries no
 * value, so wherever a failure's details are drawn - a test, View error,
 * the Not working pill's tooltip (drawCloudFailureDetails) - the reader
 * gets it in their language by looking it up (sayErrorMessage). The server
 * still sends it in English, for the API, the logs and the connection's
 * stored error.
 *
 * Each purpose that signs in to a customer's role has a set of its own
 * (AwsRoleSignInWords): Cloud Connect's, here, speak of reads; a project's
 * Amazon SES role's (Types/Email/AmazonSesRoleWords) speak of email.
 *
 * Imports the Translator alone, so it may join a page's first load if
 * ErrorInSentence ever needs it. React-free and server-safe.
 */

// What a project is told when the check of its role, or the sign-in to it, fails.
export interface AwsRoleSignInWords {
  // AWS throttled the check that the role requires the external id.
  checkRateLimited: string;
  // AWS throttled the sign-in itself.
  signInRateLimited: string;
  // AWS did not answer the check.
  checkUnanswered: string;
  // AWS did not answer the sign-in.
  signInUnanswered: string;
  // AWS did not take OneUptime's own credentials: nothing the project can change.
  serverCredentialsRefused: string;
  // The check was refused for a reason other than the trust policy's.
  checkFailed: string;
  // The sign-in was refused as a permission (AccessDenied and its kin).
  signInNotPermitted: string;
  // The sign-in failed in any other way AWS answered.
  signInRefused: string;
  // AWS answered the sign-in, but with no credentials in it.
  noCredentialsReturned: string;
  // OneUptime could not get its own AWS credentials just now.
  serverCredentialsUnavailable: string;
  // OneUptime has no AWS identity to sign in to a role with.
  noServerIdentity: string;
}

/*
 * Cloud Connect's: a connection's reads, its test and the setup command
 * that makes its role. Word for word what #10405 sent before they were
 * keys, so a stored error reads the same.
 */
export const CLOUD_CONNECT_ROLE_SIGN_IN_WORDS: AwsRoleSignInWords = {
  checkRateLimited: translationKey(
    "AWS asked OneUptime to slow down while it checked that the role requires your project's external ID, so nothing was read through it. OneUptime tries again on the next read.",
  ),
  signInRateLimited: translationKey(
    "AWS asked OneUptime to slow down while it signed in to the role, so nothing was read through it. OneUptime tries again on the next read.",
  ),
  checkUnanswered: translationKey(
    "AWS did not answer while OneUptime checked that the role requires your project's external ID, so nothing was read through it. OneUptime tries again on the next read.",
  ),
  signInUnanswered: translationKey(
    "AWS did not answer while OneUptime signed in to the role, so nothing was read through it. OneUptime tries again on the next read.",
  ),
  serverCredentialsRefused: translationKey(
    "AWS did not take the credentials this OneUptime signs in to roles with, so it could not sign in to the role. That is not the role's setup: OneUptime tries again on the next read, and the server's log says why.",
  ),
  checkFailed: translationKey(
    "OneUptime could not check that the role requires your project's external ID, so it does not sign in to it. Check that the role ARN is right, then test the connection again.",
  ),
  signInNotPermitted: translationKey(
    "OneUptime could not sign in to the role. Check that the role exists and trusts OneUptime with your project's external ID: run the setup command again.",
  ),
  signInRefused: translationKey(
    "AWS did not let OneUptime sign in to the role. Check that the role ARN is right and that the role trusts OneUptime with your project's external ID: run the setup command again.",
  ),
  noCredentialsReturned: translationKey(
    "AWS did not return credentials for the role.",
  ),
  serverCredentialsUnavailable: translationKey(
    "This OneUptime could not get its own AWS credentials just now, so it could not sign in to the role. It tries again on the next read.",
  ),
  noServerIdentity: translationKey(
    "This OneUptime has no AWS identity to sign in to the role with: no Cloud Connect access key is set, and the server's own AWS credentials did not work. The server's log says why. Connect with an access key instead.",
  ),
};

// Every sentence of a set, for the tests that hold each one to the locales.
export function getAwsRoleSignInSentences(
  words: AwsRoleSignInWords,
): Array<string> {
  return Object.values(words);
}
