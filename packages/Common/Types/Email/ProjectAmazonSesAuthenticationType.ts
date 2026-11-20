/**
 * How a PROJECT's Amazon SES config signs in (#7378).
 *
 * - AccessKey: an IAM user's access key - an Access Key ID and a Secret
 *   Access Key, stored encrypted. What every project config signed in with
 *   before there was a choice, and still the default.
 * - IamRole: an IAM role in the project's own AWS account, which OneUptime
 *   signs in to with sts:AssumeRole and an external id only this project's
 *   email uses (AmazonSesRoleExternalId). No key is stored, and every
 *   credential lasts an hour. OneUptime checks that the role requires the
 *   external id before it sends through it (AwsSts.assumeRole), and never
 *   signs in to a role in its own AWS account (AmazonSesProjectRole).
 *
 * A project's own type, apart from the server's (AmazonSesAuthenticationType,
 * "Access Key" or "Server IAM Role"): the server's settings key a Record by
 * that enum (ServerEmailEnvironment) and must never take a project's value,
 * and a project's config must never ask for the server's role. Neither set
 * reads the other's values.
 *
 * The values are what the API stores.
 */
enum ProjectAmazonSesAuthenticationType {
  AccessKey = "Access Key",
  IamRole = "IAM Role",
}

export default ProjectAmazonSesAuthenticationType;

export function isProjectAmazonSesAuthenticationType(
  value: unknown,
): value is ProjectAmazonSesAuthenticationType {
  return (
    typeof value === "string" &&
    (
      Object.values(ProjectAmazonSesAuthenticationType) as Array<string>
    ).includes(value)
  );
}

/*
 * A stored or submitted sign-in as it is read: one of the two, or an
 * access key for anything else (an empty value, the server's "Server IAM
 * Role" included) - what every config written before there was a choice
 * signs in with. A write is checked apart (ProjectSmtpConfigService), and
 * refuses any other value rather than read it as an access key.
 */
export function toProjectAmazonSesAuthenticationType(
  value: unknown,
): ProjectAmazonSesAuthenticationType {
  return isProjectAmazonSesAuthenticationType(value)
    ? value
    : ProjectAmazonSesAuthenticationType.AccessKey;
}
