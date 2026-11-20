import { CloudConnectionFailureKind } from "../../../Types/CloudConnection/CloudConnectionTest";
import { isAwsRoleArn } from "../../../Types/CloudConnection/CloudConnectionPaste";
import {
  getAmazonSesRoleTrustPolicy,
  getAwsSesExternalIdForProject,
} from "../../../Types/Email/AmazonSesRoleExternalId";
import { AmazonSesRoleSetup } from "../../../Types/Email/AmazonSesRoleSetup";
import {
  AMAZON_SES_ROLE_ARN_INVALID,
  AMAZON_SES_ROLE_CONFIG_INCOMPLETE,
  AMAZON_SES_ROLE_IN_SERVER_ACCOUNT,
  AMAZON_SES_ROLE_SIGN_IN_WORDS,
  AMAZON_SES_SERVER_ACCOUNT_UNKNOWN,
} from "../../../Types/Email/AmazonSesRoleWords";
import { AwsCredentialChainError } from "../Aws/AwsDefaultCredentialChain";
import { AwsCredentials } from "../CloudConnection/Aws/AwsApi";
import AwsServerIdentity, {
  AwsServerCredentials,
} from "../CloudConnection/Aws/AwsServerIdentity";
import {
  AssumedRoleCache,
  AwsAssumedRole,
  AwsCallerIdentity,
  AwsRolePurpose,
  assumeRole,
  getStsRegion,
} from "../CloudConnection/Aws/AwsSts";
import { CloudConnectorTransport } from "../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import logger from "../Logger";

/*
 * A PROJECT'S AMAZON SES CONFIG, SIGNED IN TO AN IAM ROLE IN THE PROJECT'S
 * OWN AWS ACCOUNT (#7378).
 *
 * The config stores no key: OneUptime signs in to the role the project
 * made, with its own AWS identity (AwsServerIdentity: the Cloud Connect key,
 * or the server's own credentials) and the project's email external id
 * (getAwsSesExternalIdForProject), and signs each email to SES with the
 * hour-long session AWS hands back. In order, each time a session is
 * needed:
 *
 *   1. The role is never in the AWS account of OneUptime's own identity.
 *      That account holds the operator's roles and the operator's verified
 *      SES domains: a project sending through it could send as the
 *      operator, to anyone. The probe below already keeps out a role that
 *      does not require this project's external id, so only someone who can
 *      change that account's IAM could let a project in - but for email
 *      the cost of that one mistake on a shared server is phishing in the
 *      operator's name, so OneUptime does not sign in to such a role for a
 *      project's email at all, whatever its trust policy says. Cloud Connect
 *      decided otherwise for reads (#10410), and keeps its way. The server's
 *      own Amazon SES settings (Admin Dashboard > Settings > Emails) are the
 *      way to send through the account OneUptime runs in. The account is
 *      asked of AWS (sts:GetCallerIdentity, kept an hour); when AWS does not
 *      say, nothing is signed in to (fail closed).
 *   2. A session kept from an earlier email is used while it lasts and
 *      while the check that allowed it holds (AssumedRoleCache, its key of
 *      email's own: per project, SMTP config and role ARN).
 *   3. Otherwise AwsSts.assumeRole, the one way into a customer's role,
 *      signs in: it checks first that the role requires the external id
 *      (probeRoleExternalId, one AccessDenied in the customer's CloudTrail
 *      about once a day), refuses a role that takes any id, and keeps its
 *      verdict for every server (AwsRoleCheckCache), in email's own key
 *      space: a Cloud Connect verdict never stands for an email one.
 *
 * What fails is said in OneUptime's words (AmazonSesRoleWords): never
 * AWS's own answer, which names OneUptime's identity, nor a key or a token.
 * A failure that could pass on another try (AWS slowed down or did not
 * answer) says so (isRetryable); one the project must fix does not.
 */

// A sign-in that failed, in OneUptime's words, and whether another try could work.
export class AmazonSesRoleSignInError extends Error {
  public readonly isRetryable: boolean;

  public constructor(message: string, options: { isRetryable: boolean }) {
    super(message);
    this.name = "AmazonSesRoleSignInError";
    this.isRetryable = options.isRetryable;
  }
}

// What an email is signed with, and the key its session is kept under.
export interface AmazonSesRoleSession {
  credentials: AwsCredentials;
  key: string;
}

// The 12-digit account of a role ARN (arn:<partition>:iam::<account>:role/...).
export function getAwsRoleArnAccount(roleArn: string): string {
  return roleArn.trim().split(":")[4] || "";
}

// What AWS's answer means for another try: slowed down, or no answer, could pass.
function isRetryableKind(kind: CloudConnectionFailureKind): boolean {
  return (
    kind === CloudConnectionFailureKind.RateLimited ||
    kind === CloudConnectionFailureKind.Unavailable
  );
}

export default class AmazonSesProjectRole {
  // How STS is reached: the data sources' own fetch, unless a test hands in its own.
  private static transport: CloudConnectorTransport | null = null;

  public static useTransport(transport: CloudConnectorTransport | null): void {
    AmazonSesProjectRole.transport = transport;
  }

  private static getTransport(): CloudConnectorTransport {
    return (
      AmazonSesProjectRole.transport ||
      DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch)
    );
  }

  // Where a config's session and its role's verdict are kept: email's own key space.
  public static keyOf(data: {
    projectId: string;
    configId: string;
    roleArn: string;
  }): string {
    return AssumedRoleCache.keyOf({
      purpose: AwsRolePurpose.AmazonSes,
      projectId: data.projectId,
      connectionId: data.configId,
      roleArn: data.roleArn,
    });
  }

  /*
   * The session an email of this config is signed with. projectId is the
   * config row's own (ProjectSmtpConfigService.toEmailServer reads it from
   * the row), and the external id is derived from it alone. Send Test
   * Email (checksAfresh) checks the role afresh and keeps what it found for
   * every server, so a trust policy fixed a minute ago is sent through at
   * once - and a role found taking any id is sent through no more. The
   * session it signs in to is kept for the emails after it, as any is: a
   * config's test is of the saved config.
   */
  public static async getSession(data: {
    projectId: string;
    configId: string;
    roleArn: string;
    region: string;
    checksAfresh?: boolean | undefined;
  }): Promise<AmazonSesRoleSession> {
    const projectId: string = data.projectId.trim();
    const configId: string = data.configId.trim();
    const roleArn: string = data.roleArn.trim();
    const region: string = data.region.trim().toLowerCase();

    if (!projectId || !configId || !region) {
      throw new AmazonSesRoleSignInError(AMAZON_SES_ROLE_CONFIG_INCOMPLETE, {
        isRetryable: false,
      });
    }

    if (!isAwsRoleArn(roleArn)) {
      throw new AmazonSesRoleSignInError(AMAZON_SES_ROLE_ARN_INVALID, {
        isRetryable: false,
      });
    }

    const transport: CloudConnectorTransport =
      AmazonSesProjectRole.getTransport();

    // 1. Never a role in OneUptime's own AWS account, and never unknown whether it is.
    await AmazonSesProjectRole.assertNotInServerAccount({
      roleArn,
      projectId,
      configId,
      transport,
    });

    const key: string = AmazonSesProjectRole.keyOf({
      projectId,
      configId,
      roleArn,
    });

    // 2. A session kept from an earlier email, while its role's check holds.
    if (!data.checksAfresh) {
      const kept: AwsCredentials | undefined = await AssumedRoleCache.get(key);

      if (kept) {
        return { credentials: kept, key };
      }
    }

    // 3. Signed in, after the role is checked to require the external id.
    const server: AwsServerCredentials =
      await AmazonSesProjectRole.getServerCredentials();
    let session: AwsAssumedRole;

    try {
      session = await assumeRole({
        purpose: AwsRolePurpose.AmazonSes,
        transport,
        credentials: server.credentials,
        roleArn,
        projectId,
        connectionId: configId,
        region: getStsRegion([region]),
        noCache: data.checksAfresh,
        // A test send is of a saved config: what it found holds for every server's emails.
        keepsVerdict: true,
      });
    } catch (error) {
      // The server's own credentials expired or are unknown: new ones next time.
      AwsServerIdentity.refusedBy({ source: server.source, error });

      throw AmazonSesProjectRole.describe(error, roleArn);
    }

    AssumedRoleCache.set(key, session);

    return { credentials: session.credentials, key };
  }

  /*
   * A session Amazon SES no longer takes (it expired, or SES does not know
   * its token): dropped, so the next try signs in again.
   */
  public static forgetSession(session: AmazonSesRoleSession): void {
    AssumedRoleCache.forget(session.key, session.credentials);
  }

  /*
   * What the project's form shows to set up a role (GET
   * /smtp-config/aws-role-setup): whether OneUptime has an AWS identity to
   * sign in with, the principal to trust, this project's email external id
   * and the trust policy written from them.
   */
  public static async getRoleSetup(data: {
    projectId: string;
  }): Promise<AmazonSesRoleSetup> {
    const externalId: string = getAwsSesExternalIdForProject(data.projectId);
    const identity: AwsCallerIdentity | null =
      await AwsServerIdentity.getIdentity(AmazonSesProjectRole.getTransport());

    if (!identity) {
      return { isAvailable: false, externalId };
    }

    const trustedPrincipalArn: string =
      AwsServerIdentity.getTrustedPrincipalArn(identity);

    return {
      isAvailable: true,
      trustedPrincipalArn,
      externalId,
      trustPolicy: getAmazonSesRoleTrustPolicy({
        trustedPrincipalArn,
        externalId,
      }),
    };
  }

  /*
   * Refuses a role in the account of OneUptime's own identity, and a role
   * whose account cannot be compared because AWS did not say who OneUptime
   * is: in neither case is anything signed in to.
   */
  private static async assertNotInServerAccount(data: {
    roleArn: string;
    projectId: string;
    configId: string;
    transport: CloudConnectorTransport;
  }): Promise<void> {
    const identity: AwsCallerIdentity | null =
      await AwsServerIdentity.getIdentity(data.transport);

    if (!identity) {
      if (!AwsServerIdentity.isConfigured()) {
        throw new AmazonSesRoleSignInError(
          AMAZON_SES_ROLE_SIGN_IN_WORDS.noServerIdentity,
          { isRetryable: false },
        );
      }

      throw new AmazonSesRoleSignInError(AMAZON_SES_SERVER_ACCOUNT_UNKNOWN, {
        isRetryable: true,
      });
    }

    if (getAwsRoleArnAccount(data.roleArn) === identity.account) {
      logger.warn(
        `Amazon SES: SMTP config ${data.configId} of project ${data.projectId} names role ${data.roleArn}, in this OneUptime's own AWS account, so it is not signed in to: a project's email never goes through the account OneUptime runs in.`,
      );

      throw new AmazonSesRoleSignInError(AMAZON_SES_ROLE_IN_SERVER_ACCOUNT, {
        isRetryable: false,
      });
    }
  }

  /*
   * OneUptime's own credentials, to sign in to the role with. Without any,
   * the project is told so in words that name nothing of the server; the
   * server's log says why.
   */
  private static async getServerCredentials(): Promise<AwsServerCredentials> {
    try {
      return await AwsServerIdentity.getCredentials();
    } catch (error) {
      if (!(error instanceof AwsCredentialChainError)) {
        throw error;
      }

      logger.warn(
        `Amazon SES: this OneUptime could not sign in to a project's IAM role: it has no Cloud Connect access key (CLOUD_CONNECT_AWS_ACCESS_KEY_ID), and its own AWS credentials did not work. ${error.message}`,
      );

      throw new AmazonSesRoleSignInError(
        error.isRetryable
          ? AMAZON_SES_ROLE_SIGN_IN_WORDS.serverCredentialsUnavailable
          : AMAZON_SES_ROLE_SIGN_IN_WORDS.noServerIdentity,
        { isRetryable: error.isRetryable },
      );
    }
  }

  /*
   * assumeRole's failure as the project reads it: its own words already
   * (AwsSts says each in email's words), with whether another try could
   * work. Anything else - nothing AWS answered - is no message of
   * OneUptime's, so it is logged and said as AWS not answering.
   */
  private static describe(
    error: unknown,
    roleArn: string,
  ): AmazonSesRoleSignInError {
    if (error instanceof LlmProviderError) {
      return new AmazonSesRoleSignInError(error.message, {
        isRetryable: isRetryableKind(error.kind),
      });
    }

    logger.error(
      `Amazon SES: signing in to role ${roleArn} failed unexpectedly. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return new AmazonSesRoleSignInError(
      AMAZON_SES_ROLE_SIGN_IN_WORDS.signInUnanswered,
      { isRetryable: true },
    );
  }
}
