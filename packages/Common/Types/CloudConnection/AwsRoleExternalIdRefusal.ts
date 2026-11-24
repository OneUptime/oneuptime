import {
  readRefusalValues,
  RefusalWithValues,
} from "../Exception/RefusalWithValues";
import { TemplateValues, translationKey } from "../Translator";

/*
 * AN AWS ROLE THAT LETS ONEUPTIME IN WITHOUT THE PROJECT'S EXTERNAL ID, IN
 * THE READER'S LANGUAGE (#10405, #10425).
 *
 * OneUptime refuses a role whose trust policy does not hold it to the
 * project's external id (AwsSts.assumeRole): any project that knows the
 * role's ARN could otherwise read the account through OneUptime. The
 * refusal is OneUptime's own words, not a cloud's answer, and a customer
 * who upgrades meets it more often than most failures, so the Dashboard
 * says it in the reader's language: a headline and advice of its own, and
 * the refusal itself around the exact condition to add.
 *
 * The server refuses in English (AwsSts.getRoleWithoutExternalIdMessage),
 * with the condition as the setup command's trust policy writes it
 * (getAwsExternalIdConditionText), for the API, the logs and the
 * connection's stored error. The sentence is a key of the Dashboard's
 * locales with the condition as its value (RefusalWithValues): the
 * Dashboard reads the condition back out of the English
 * (readAwsRoleWithoutExternalIdCondition) and says the sentence with it
 * wherever it draws the message (Common/UI/Utils/ErrorInSentence). The
 * condition is code, and goes in as written in every language.
 *
 * Imports nothing but the refusal and the Translator: ErrorInSentence is
 * in every page's first load. React-free and server-safe.
 */
export const AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "This role lets OneUptime sign in without your project's external ID, so any project that knows its ARN could read your AWS account through OneUptime. OneUptime does not use it until its trust policy requires the external ID: add {{condition}} to the statement that trusts OneUptime, or run the setup command again and connect the role it prints.",
  ),
  terms: [],
};

/*
 * What a test and a failed read say of the refusal, in place of a failed
 * setting's words: the headline is the docs' troubleshooting entry for it,
 * and the advice points at the condition the refusal names below it.
 */
export const AWS_ROLE_WITHOUT_EXTERNAL_ID_WORDS: {
  headline: string;
  advice: string;
} = {
  headline: translationKey(
    "This role lets OneUptime sign in without your project's external ID.",
  ),
  advice: translationKey(
    "Add the condition below to the role's trust policy, or run the setup command again, then test again.",
  ),
};

/*
 * The condition a refusal names: the one the setup command's trust policy
 * writes (getAwsExternalIdConditionText), around an external id of every
 * project's shape (formatAwsExternalId). Written out here, so the setup
 * commands stay out of a page's first load; a test holds the two to each
 * other.
 */
export const AWS_EXTERNAL_ID_CONDITION_SHAPE: RegExp =
  /^"Condition":\{"StringEquals":\{"sts:ExternalId":"oneuptime-[0-9a-f]{32}"\}\}$/;

/*
 * The condition a message names when it is this refusal, as written; null
 * for any other message - a cloud's answer, another refusal, the refusal
 * cut short or with anything but a condition where its condition goes.
 */
export function readAwsRoleWithoutExternalIdCondition(
  message: string | null | undefined,
): string | null {
  const values: TemplateValues | null = readRefusalValues(
    AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL,
    message,
  );
  const condition: unknown = values?.["condition"];

  return typeof condition === "string" &&
    AWS_EXTERNAL_ID_CONDITION_SHAPE.test(condition)
    ? condition
    : null;
}

// Whether a message is this refusal.
export function isAwsRoleWithoutExternalIdRefusal(
  message: string | null | undefined,
): boolean {
  return readAwsRoleWithoutExternalIdCondition(message) !== null;
}
