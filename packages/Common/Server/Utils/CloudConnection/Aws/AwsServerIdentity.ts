import {
  CloudConnectionAwsRoleSetup,
  getAwsExternalIdForProject,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import logger from "../../Logger";
import { CloudConnectorTransport } from "../CloudConnectorTypes";
import { AwsCredentials } from "./AwsApi";
import { AwsCallerIdentity, STS_HOME_REGIONS, getCallerIdentity } from "./AwsSts";

/*
 * THIS ONEUPTIME'S OWN AWS IDENTITY: the one that assumes the read-only
 * roles customers create (Cloud > Connect, AWS, IAM role).
 *
 * A role is the safer way in - the customer stores no key with OneUptime
 * and can cut access by deleting the role - but AWS only lets an AWS
 * principal assume a role. So the IAM role way is offered only when the
 * installation has one: an IAM user's access key in
 * CLOUD_CONNECT_AWS_ACCESS_KEY_ID and CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY
 * (config.env, or cloudConnect.aws in the Helm chart), allowed to call
 * sts:AssumeRole. Every other installation connects AWS with an access
 * key, which works everywhere.
 *
 * The roles trust the identity's whole account ("arn:aws:iam::<id>:root")
 * with the project's external id, so the user and its key can be rotated
 * without customers changing anything. The account id is asked of AWS
 * (sts:GetCallerIdentity) once an hour, not configured.
 */

const IDENTITY_CACHE_MS: number = 60 * 60 * 1000;
// After a failed identity check, the next is tried this much later.
const FAILURE_CACHE_MS: number = 5 * 60 * 1000;

export default class AwsServerIdentity {
  private static cached:
    | { identity: AwsCallerIdentity | null; atMs: number; validForMs: number }
    | undefined = undefined;

  // Read at call time, so a test (or a restart with new env) sees changes.
  public static getCredentials(): AwsCredentials | null {
    const accessKeyId: string = (
      process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] || ""
    ).trim();
    const secretAccessKey: string = (
      process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] || ""
    ).trim();

    if (!accessKeyId || !secretAccessKey) {
      return null;
    }

    return { accessKeyId, secretAccessKey };
  }

  public static isConfigured(): boolean {
    return AwsServerIdentity.getCredentials() !== null;
  }

  // Forget the account read from AWS (tests; a key rotated in place).
  public static clearCache(): void {
    AwsServerIdentity.cached = undefined;
  }

  /*
   * Who this OneUptime is on AWS, or null when it has no identity or AWS
   * refused it (logged: the IAM role way is then not offered).
   */
  public static async getIdentity(
    transport: CloudConnectorTransport,
  ): Promise<AwsCallerIdentity | null> {
    const credentials: AwsCredentials | null =
      AwsServerIdentity.getCredentials();

    if (!credentials) {
      return null;
    }

    const cached:
      | { identity: AwsCallerIdentity | null; atMs: number; validForMs: number }
      | undefined = AwsServerIdentity.cached;

    if (cached && Date.now() - cached.atMs < cached.validForMs) {
      return cached.identity;
    }

    try {
      const identity: AwsCallerIdentity = await getCallerIdentity({
        transport,
        credentials,
        region: STS_HOME_REGIONS.aws,
      });

      AwsServerIdentity.cached = {
        identity,
        atMs: Date.now(),
        validForMs: IDENTITY_CACHE_MS,
      };

      return identity;
    } catch (error) {
      logger.error(
        `Cloud connections: AWS refused this OneUptime's own identity (CLOUD_CONNECT_AWS_ACCESS_KEY_ID), so the IAM role way of connecting AWS is not offered. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      AwsServerIdentity.cached = {
        identity: null,
        atMs: Date.now(),
        validForMs: FAILURE_CACHE_MS,
      };

      return null;
    }
  }

  // The principal a customer's role trusts: this identity's whole account.
  public static getTrustedPrincipalArn(identity: AwsCallerIdentity): string {
    const partition: string = identity.arn.startsWith("arn:aws-us-gov:")
      ? "aws-us-gov"
      : identity.arn.startsWith("arn:aws-cn:")
        ? "aws-cn"
        : "aws";

    return `arn:${partition}:iam::${identity.account}:root`;
  }

  // What the form needs to show the IAM role command for a project.
  public static async getRoleSetup(data: {
    projectId: string;
    transport: CloudConnectorTransport;
  }): Promise<CloudConnectionAwsRoleSetup> {
    const externalId: string = getAwsExternalIdForProject(data.projectId);
    const identity: AwsCallerIdentity | null =
      await AwsServerIdentity.getIdentity(data.transport);

    if (!identity) {
      return { isAvailable: false, externalId };
    }

    return {
      isAvailable: true,
      trustedPrincipalArn: AwsServerIdentity.getTrustedPrincipalArn(identity),
      externalId,
    };
  }
}
