import Crypto from "../../Utils/Crypto";
import {
  formatAwsExternalId,
  getAwsTrustPolicyDocument,
} from "../CloudConnection/CloudConnectionSetupCommands";

/*
 * THE EXTERNAL ID A PROJECT'S AMAZON SES ROLE TRUSTS ONEUPTIME WITH (#7378).
 *
 * A project's Amazon SES config may sign in with an IAM role in the
 * project's own AWS account: OneUptime assumes it with sts:AssumeRole and
 * this external id, which AWS checks against the condition in the role's
 * trust policy. So nobody can make OneUptime send email through a role made
 * for someone else (the "confused deputy"): a role ARN copied into another
 * project's config fails to assume, because that config is signed in with
 * its own project's id.
 *
 * Derived the way Cloud Connect's is (getAwsExternalIdForProject), but from
 * a label only email uses: a role made for a project's email cannot be
 * signed in to by its Cloud Connect connections, nor a Cloud Connect role
 * by its email, though the two belong to one project. Written in every
 * project's shape ("oneuptime-" and 32 hexadecimal digits,
 * formatAwsExternalId), so the role check's random id
 * (AwsSts.probeRoleExternalId) has that shape too, and a trust policy that
 * lets in any id of it ("oneuptime-*") is caught.
 *
 * The server always derives it from the config's own projectId, read from
 * the row - never from a request - and nobody chooses it. It is not a
 * secret: the config's form shows it, with a trust policy to copy.
 *
 * Its own file, beside the email code rather than in the setup commands, so
 * email and Cloud Connect each keep theirs. Server-side: the form is told
 * it by GET /smtp-config/aws-role-setup (AmazonSesRoleSetup).
 */

const AMAZON_SES_EXTERNAL_ID_LABEL: string = "amazon-ses-aws-external-id";

export function getAwsSesExternalIdForProject(projectId: string): string {
  return formatAwsExternalId(
    Crypto.getSha256Hash(
      `${AMAZON_SES_EXTERNAL_ID_LABEL}:${projectId.trim().toLowerCase()}`,
    ),
  );
}

/*
 * The trust policy a project's Amazon SES role is made with: OneUptime's
 * account may assume it, with this project's email external id. The same
 * statement Cloud Connect's roles trust OneUptime with
 * (getAwsTrustPolicyDocument), laid out to be read and copied.
 */
export function getAmazonSesRoleTrustPolicy(data: {
  trustedPrincipalArn: string;
  externalId: string;
}): string {
  return JSON.stringify(
    JSON.parse(getAwsTrustPolicyDocument(data)) as unknown,
    null,
    2,
  );
}
