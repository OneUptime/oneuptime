/**
 * How OneUptime signs in to Amazon SES.
 *
 * - AccessKey: an IAM user's access key - an Access Key ID and a Secret
 *   Access Key, stored encrypted. What every config signed in with before
 *   there was a choice, and still the only way for a project's config.
 * - ServerIamRole: the IAM role AWS gives the server itself - IAM roles for
 *   service accounts or EKS Pod Identity on Amazon EKS, a task role on
 *   Amazon ECS, an instance profile on Amazon EC2 - found the way every AWS
 *   SDK finds it (Common/Server/Utils/Aws/AwsDefaultCredentialChain). No key
 *   is stored, and every credential is short-lived (#7000). Only the
 *   server's own email settings (Admin Dashboard > Settings > Emails) may
 *   sign in this way: the role is the server's, not a project's.
 *
 * The values are what the API stores.
 */
enum AmazonSesAuthenticationType {
  AccessKey = "Access Key",
  ServerIamRole = "Server IAM Role",
}

export default AmazonSesAuthenticationType;

export function isAmazonSesAuthenticationType(
  value: unknown,
): value is AmazonSesAuthenticationType {
  return (
    typeof value === "string" &&
    (Object.values(AmazonSesAuthenticationType) as Array<string>).includes(
      value,
    )
  );
}

/*
 * A stored or submitted sign-in as it is read: one of the two, or an
 * access key for anything else (an empty value included) - what every
 * config written before there was a choice signs in with.
 */
export function toAmazonSesAuthenticationType(
  value: unknown,
): AmazonSesAuthenticationType {
  return isAmazonSesAuthenticationType(value)
    ? value
    : AmazonSesAuthenticationType.AccessKey;
}
