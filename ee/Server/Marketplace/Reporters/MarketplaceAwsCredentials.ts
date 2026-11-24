import AwsDefaultCredentialChain, {
  AwsCredentialChainError,
  AwsCredentialSource,
  AwsDefaultCredentialChainOptions,
} from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import { isAwsRegion } from "Common/Types/Cloud/AwsRegionCode";
import MarketplaceApiError from "../../CloudMarketplace/MarketplaceApiError";

/*
 * AWS credentials for a self-hosted OneUptime that runs in the buyer's own
 * Amazon EKS cluster - the AWS Marketplace container product. It calls the
 * AWS Marketplace Metering Service as the buyer's AWS account, with the IAM
 * role the buyer attached to OneUptime's Kubernetes service account, never
 * with a key anybody types in.
 *
 * They come from the server's one AWS credential chain
 * (AwsDefaultCredentialChain, #7379), the one the server's Amazon SES email
 * and Cloud Connect sign in with - looking only where the reporter always
 * has, in its own order:
 *
 *   1. IAM roles for service accounts (IRSA): EKS mounts a projected service
 *      account token into the pod and sets AWS_ROLE_ARN and
 *      AWS_WEB_IDENTITY_TOKEN_FILE; the token is traded at STS
 *      (AssumeRoleWithWebIdentity), in the Region the reporter meters in
 *      when the pod does not say its own.
 *   2. Container credentials: EKS Pod Identity (the node's agent, at
 *      AWS_CONTAINER_CREDENTIALS_FULL_URI) or an Amazon ECS task role.
 *   3. Keys in AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (and
 *      AWS_SESSION_TOKEN), last.
 *
 * Not the AWS SDKs' order, in which keys in the environment come first: a
 * pod with an IRSA role and stray keys still meters as its role, which is
 * the only identity AWS takes MeterUsage from on EKS. Never the profile
 * files nor the EC2 instance profile: on EKS that would be the node's role,
 * which AWS refuses, and which is no buyer's grant to OneUptime.
 *
 * The chain caches what it fetches until five minutes before it expires,
 * shares one fetch between callers, reads the token files again for every
 * exchange (the kubelet rotates them), and scrubs every message. Its
 * failures reach the reporter as MarketplaceApiError, retryable or not as
 * the chain says, in words that hold no token or key.
 *
 * https://docs.aws.amazon.com/marketplace/latest/userguide/container-metering-meterusage.html
 * https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html
 */

// Where the reporter looks for credentials, in its order.
export const MARKETPLACE_AWS_CREDENTIAL_SOURCES: ReadonlyArray<AwsCredentialSource> =
  ["web-identity", "container", "environment"];

// How its STS sessions are named in the buyer's CloudTrail: oneuptime-marketplace-<time>.
export const MARKETPLACE_ROLE_SESSION_NAME_PREFIX: string =
  "oneuptime-marketplace";

// What a pod with none of the three is told.
export const MARKETPLACE_NO_AWS_CREDENTIALS_MESSAGE: string =
  "This pod has no AWS credentials. Give OneUptime's Kubernetes service account an IAM role (IAM roles for service accounts) that may call the AWS Marketplace Metering Service.";

export type MarketplaceAwsCredentialOptions = Omit<
  AwsDefaultCredentialChainOptions,
  "sources" | "roleSessionNamePrefix"
>;

export default class MarketplaceAwsCredentials {
  // The reporter's chain: the server's, looking where the reporter looks.
  public static createChain(
    options?: MarketplaceAwsCredentialOptions,
  ): AwsDefaultCredentialChain {
    return new AwsDefaultCredentialChain({
      ...(options || {}),
      sources: MARKETPLACE_AWS_CREDENTIAL_SOURCES,
      roleSessionNamePrefix: MARKETPLACE_ROLE_SESSION_NAME_PREFIX,
    });
  }

  /*
   * Where the pod's credentials would come from, or null when it has none
   * of the three - which on EKS means the service account has no IAM role.
   */
  public static getSource(
    env: Record<string, string | undefined>,
  ): AwsCredentialSource | null {
    return MarketplaceAwsCredentials.createChain({ env: env }).getSource();
  }

  /*
   * The AWS Region this pod runs in, as EKS tells it (the IRSA webhook sets
   * AWS_REGION and AWS_DEFAULT_REGION), or `fallback`. Null when neither is
   * a Region code.
   */
  public static getRegion(
    env: Record<string, string | undefined>,
    fallback?: string | null | undefined,
  ): string | null {
    const own: string | null = MarketplaceAwsCredentials.createChain({
      env: env,
    }).getRegion();

    if (own) {
      return own;
    }

    const named: string = (fallback || "").trim().toLowerCase();

    return named && isAwsRegion(named) ? named : null;
  }

  /*
   * A failure of the chain as the reporter's own error: retryable as the
   * chain says, and, for a pod with no credentials at all, in the words
   * that say what the buyer gives it.
   */
  public static toMarketplaceApiError(error: unknown): unknown {
    if (!(error instanceof AwsCredentialChainError)) {
      return error;
    }

    return new MarketplaceApiError({
      message:
        error.source === null
          ? MARKETPLACE_NO_AWS_CREDENTIALS_MESSAGE
          : error.message,
      status: null,
      isRetryable: error.isRetryable,
    });
  }
}
