import {
  CloudConnectionAwsRoleSetup,
  getAwsExternalIdForProject,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import AwsDefaultCredentialChain, {
  AwsChainCredentials,
  AwsCredentialChainError,
  AwsCredentialSource,
  NO_AWS_CREDENTIALS_MESSAGE,
} from "../../Aws/AwsDefaultCredentialChain";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import logger from "../../Logger";
import { CloudConnectorTransport } from "../CloudConnectorTypes";
import { AwsCredentials, awsErrorCodeOf } from "./AwsApi";
import {
  AwsCallerIdentity,
  STS_HOME_REGIONS,
  getCallerIdentity,
  getStsRegion,
} from "./AwsSts";

/*
 * THIS ONEUPTIME'S OWN AWS IDENTITY: the one that assumes the IAM roles
 * customers create for it (Cloud > Connect, AWS, IAM role; a project's
 * Amazon SES config that signs in with a role in its own account).
 *
 * A role is the safer way in - the customer stores no key with OneUptime
 * and can cut access by deleting the role - but AWS only lets an AWS
 * principal assume a role. So the IAM role way is offered only when the
 * installation has one:
 *
 *   1. An IAM user's access key in CLOUD_CONNECT_AWS_ACCESS_KEY_ID and
 *      CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY (config.env, or cloudConnect.aws
 *      in the Helm chart). Set, it wins: an installation that set it signs
 *      in as before.
 *   2. Otherwise the server's own credentials, found where every AWS SDK
 *      finds them (#7379, AwsDefaultCredentialChain): the IAM role of its
 *      pods (IAM roles for service accounts or EKS Pod Identity), its ECS
 *      task or its EC2 instance - or, off AWS, a profile of the shared
 *      config files (IAM Roles Anywhere). No key is stored, and every
 *      credential is short-lived; a session token signs with them.
 *
 * Every other installation connects AWS with an access key, which works
 * everywhere. Whichever it is, the identity needs sts:AssumeRole on the
 * customers' roles, and nothing else.
 *
 * The roles trust the identity's whole account ("arn:aws:iam::<id>:root")
 * with the project's external id, so the user, its key or the role can be
 * rotated without customers changing anything. The account id is asked of
 * AWS (sts:GetCallerIdentity) once an hour, not configured.
 */

const IDENTITY_CACHE_MS: number = 60 * 60 * 1000;
// After a failed identity check, the next is tried this much later.
const FAILURE_CACHE_MS: number = 5 * 60 * 1000;

export const CLOUD_CONNECT_AWS_ACCESS_KEY_ID_ENV: string =
  "CLOUD_CONNECT_AWS_ACCESS_KEY_ID";
export const CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY_ENV: string =
  "CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY";

/*
 * What AWS answers when it does not take the credentials themselves: they
 * expired, or it does not know them. The server's own are fetched again.
 */
export const AWS_CREDENTIAL_REFUSAL_CODES: ReadonlyArray<string> = [
  "ExpiredToken",
  "ExpiredTokenException",
  "InvalidClientTokenId",
  "UnrecognizedClientException",
];

// Where OneUptime's identity came from: the Cloud Connect key, or a source of the server's own.
export type AwsServerIdentitySource = "cloud-connect-key" | AwsCredentialSource;

export interface AwsServerCredentials {
  credentials: AwsCredentials;
  source: AwsServerIdentitySource;
}

export default class AwsServerIdentity {
  private static cached:
    | { identity: AwsCallerIdentity | null; atMs: number; validForMs: number }
    | undefined = undefined;

  private static credentialChain: AwsDefaultCredentialChain | null = null;

  // The chain the server's own credentials come from (tests hand in their own; null is the process's).
  public static useCredentialChain(
    chain: AwsDefaultCredentialChain | null,
  ): void {
    AwsServerIdentity.credentialChain = chain;
    AwsServerIdentity.cached = undefined;
  }

  private static getCredentialChain(): AwsDefaultCredentialChain {
    return (
      AwsServerIdentity.credentialChain || AwsDefaultCredentialChain.getShared()
    );
  }

  // The Cloud Connect key, read at call time, so a test (or a restart with new env) sees changes.
  public static getConfiguredKey(): AwsCredentials | null {
    const accessKeyId: string = (
      process.env[CLOUD_CONNECT_AWS_ACCESS_KEY_ID_ENV] || ""
    ).trim();
    const secretAccessKey: string = (
      process.env[CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY_ENV] || ""
    ).trim();

    if (!accessKeyId || !secretAccessKey) {
      return null;
    }

    return { accessKeyId, secretAccessKey };
  }

  /*
   * Whether this OneUptime may have an AWS identity, without asking AWS: a
   * Cloud Connect key, or a source of the server's own credentials. An EC2
   * instance profile is known only by asking, which getIdentity does.
   */
  public static isConfigured(): boolean {
    return (
      AwsServerIdentity.getConfiguredKey() !== null ||
      AwsServerIdentity.getCredentialChain().getSource() !== null
    );
  }

  /*
   * The credentials sts:AssumeRole is signed with: the Cloud Connect key,
   * else the server's own. Throws AwsCredentialChainError - in words for
   * the server's log, which name its infrastructure - when it has none.
   */
  public static async getCredentials(): Promise<AwsServerCredentials> {
    const key: AwsCredentials | null = AwsServerIdentity.getConfiguredKey();

    if (key) {
      return { credentials: key, source: "cloud-connect-key" };
    }

    const chain: AwsDefaultCredentialChain =
      AwsServerIdentity.getCredentialChain();
    const own: AwsChainCredentials = await chain.getCredentials({
      regionHint: AwsServerIdentity.getServerStsRegion(),
    });

    return {
      credentials: {
        accessKeyId: own.accessKeyId,
        secretAccessKey: own.secretAccessKey,
        sessionToken: own.sessionToken || undefined,
      },
      source: own.source,
    };
  }

  /*
   * AWS did not take the server's own credentials (they expired, or it does
   * not know them): the next call fetches new ones. A Cloud Connect key is
   * what it is.
   */
  public static refusedBy(data: {
    source: AwsServerIdentitySource;
    error: unknown;
  }): void {
    if (data.source === "cloud-connect-key") {
      return;
    }

    const body: string | undefined =
      data.error instanceof LlmProviderError
        ? data.error.responseBody
        : undefined;

    if (AWS_CREDENTIAL_REFUSAL_CODES.includes(awsErrorCodeOf(body || ""))) {
      AwsServerIdentity.getCredentialChain().invalidate();
    }
  }

  /*
   * Where OneUptime's identity is asked who it is: us-east-1 for a Cloud
   * Connect key, as before; the server's own credentials in the home
   * Region of the partition the server runs in (GovCloud's, China's).
   */
  private static getIdentityStsRegion(source: AwsServerIdentitySource): string {
    return source === "cloud-connect-key"
      ? STS_HOME_REGIONS.aws
      : AwsServerIdentity.getServerStsRegion();
  }

  // The home Region of the partition the server runs in (AWS_REGION), or us-east-1.
  private static getServerStsRegion(): string {
    return getStsRegion([
      AwsServerIdentity.getCredentialChain().getRegion() ||
        STS_HOME_REGIONS.aws,
    ]);
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
    const cached:
      | { identity: AwsCallerIdentity | null; atMs: number; validForMs: number }
      | undefined = AwsServerIdentity.cached;

    if (cached && Date.now() - cached.atMs < cached.validForMs) {
      return cached.identity;
    }

    const remember: (
      identity: AwsCallerIdentity | null,
    ) => AwsCallerIdentity | null = (
      identity: AwsCallerIdentity | null,
    ): AwsCallerIdentity | null => {
      AwsServerIdentity.cached = {
        identity,
        atMs: Date.now(),
        validForMs: identity ? IDENTITY_CACHE_MS : FAILURE_CACHE_MS,
      };

      return identity;
    };

    let server: AwsServerCredentials;

    try {
      server = await AwsServerIdentity.getCredentials();
    } catch (error) {
      if (!(error instanceof AwsCredentialChainError)) {
        throw error;
      }

      // No AWS here at all is how most installations run: said quietly.
      const words: string = `Cloud connections: this OneUptime has no Cloud Connect access key (${CLOUD_CONNECT_AWS_ACCESS_KEY_ID_ENV}) and no AWS credentials of its own, so the IAM role way of connecting AWS is not offered. ${error.message}`;

      if (error.message.startsWith(NO_AWS_CREDENTIALS_MESSAGE)) {
        logger.debug(words);
      } else {
        logger.warn(words);
      }

      return remember(null);
    }

    try {
      return remember(
        await getCallerIdentity({
          transport,
          credentials: server.credentials,
          region: AwsServerIdentity.getIdentityStsRegion(server.source),
        }),
      );
    } catch (error) {
      AwsServerIdentity.refusedBy({ source: server.source, error });

      logger.error(
        `Cloud connections: AWS refused this OneUptime's own identity (${AwsServerIdentity.describeSource(server.source)}), so the IAM role way of connecting AWS is not offered. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return remember(null);
    }
  }

  // Where the identity came from, in words for the server's log.
  public static describeSource(source: AwsServerIdentitySource): string {
    switch (source) {
      case "cloud-connect-key":
        return CLOUD_CONNECT_AWS_ACCESS_KEY_ID_ENV;
      case "environment":
        return "the server's AWS_ACCESS_KEY_ID";
      case "profile":
        return "the server's AWS profile";
      case "web-identity":
        return "the server's web identity (IAM roles for service accounts)";
      case "container":
        return "the server's container role (Amazon ECS, EKS Pod Identity)";
      case "instance-profile":
        return "the server's EC2 instance profile";
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
