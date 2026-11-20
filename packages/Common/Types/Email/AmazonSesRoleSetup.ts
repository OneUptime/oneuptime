import { JSONObject } from "../JSON";

/*
 * WHAT A PROJECT'S AMAZON SES FORM IS TOLD TO SET UP AN IAM ROLE (#7378).
 *
 * GET /api/notification/smtp-config/aws-role-setup, for a signed-in member
 * of the project who may create its SMTP configs: whether this OneUptime
 * can sign in to a role at all (it has an AWS identity of its own: the
 * Cloud Connect key, or the server's own credentials), the principal the
 * role must trust (that identity's whole account), this project's email
 * external id, and a trust policy written from the two. Like Cloud
 * Connect's GET /cloud-connection/aws-role-setup, with email's own id.
 *
 * Nothing here is a secret: the external id and OneUptime's account are
 * what every role trusting OneUptime names in its trust policy. It never
 * carries a key or a token.
 *
 * React-free and imports nothing heavy: the form reads it on the page.
 */

export const AMAZON_SES_ROLE_SETUP_ROUTE: string =
  "/smtp-config/aws-role-setup";

export interface AmazonSesRoleSetup {
  // Whether this OneUptime has an AWS identity to sign in to a role with.
  isAvailable: boolean;
  // The principal the role's trust policy names: arn:<partition>:iam::<account>:root.
  trustedPrincipalArn?: string | undefined;
  // This project's email external id (getAwsSesExternalIdForProject).
  externalId: string;
  // The whole trust policy to copy, when the identity is known.
  trustPolicy?: string | undefined;
}

// The longest text read back: a principal ARN, an id or a short policy.
const MAX_TEXT_LENGTH: number = 4096;

const readText: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  return typeof value === "string" &&
    value.trim() &&
    value.length <= MAX_TEXT_LENGTH
    ? value
    : undefined;
};

/*
 * An answer as the form reads it from the server's JSON, or null when it
 * is not one: then the form says it could not read the setup, and never
 * draws a trust policy it was not given.
 */
export function readAmazonSesRoleSetup(
  value: unknown,
): AmazonSesRoleSetup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const externalId: string | undefined = readText(json["externalId"]);

  if (!externalId || typeof json["isAvailable"] !== "boolean") {
    return null;
  }

  if (!json["isAvailable"]) {
    return { isAvailable: false, externalId: externalId };
  }

  const trustedPrincipalArn: string | undefined = readText(
    json["trustedPrincipalArn"],
  );
  const trustPolicy: string | undefined = readText(json["trustPolicy"]);

  if (!trustedPrincipalArn || !trustPolicy) {
    return null;
  }

  return {
    isAvailable: true,
    trustedPrincipalArn: trustedPrincipalArn,
    externalId: externalId,
    trustPolicy: trustPolicy,
  };
}
