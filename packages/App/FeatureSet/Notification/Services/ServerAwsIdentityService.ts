import { isAwsRegion } from "Common/Types/Cloud/AwsRegionCode";
import {
  ServerAwsIdentityAnswer,
  ServerAwsIdentityVia,
} from "Common/Types/Email/ServerAwsIdentity";
import AwsDefaultCredentialChain, {
  AwsChainCredentials,
  AwsCredentialChainError,
  AwsCredentialSource,
} from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import { CloudConnectorTransport } from "Common/Server/Utils/CloudConnection/CloudConnectorTypes";
import { awsErrorCodeOf } from "Common/Server/Utils/CloudConnection/Aws/AwsApi";
import { AWS_CREDENTIAL_REFUSAL_CODES } from "Common/Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import {
  AwsCallerIdentity,
  getCallerIdentity,
} from "Common/Server/Utils/CloudConnection/Aws/AwsSts";
import DataSourceHttpFetch from "Common/Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "Common/Server/Utils/LlmObservability/LlmProviderError";

/*
 * WHICH AWS IDENTITY THIS SERVER SIGNS IN AS (#7380), for the Admin
 * Dashboard's Amazon SES card (Common/Types/Email/ServerAwsIdentity).
 *
 * The server's own credentials, from the chain its Amazon SES email signs
 * in with, for the Region the email goes to (STS is asked there when the
 * server does not say where it runs), asked of AWS with
 * sts:GetCallerIdentity, signed with their session token. The answer is
 * the identity's ARN and account and where the credentials came from - or
 * why there are none, in the chain's words, which name what to change and
 * never a key, a token or what a credential_process printed. Credentials
 * AWS no longer takes are dropped, so the next email fetches new ones.
 */

// How long AWS may take to say who the server is.
export const SERVER_AWS_IDENTITY_TIMEOUT_IN_MS: number = 10 * 1000;

const FALLBACK_REGION: string = "us-east-1";

export default class ServerAwsIdentityService {
  public static async check(options?: {
    // The Region the server's Amazon SES sends from: STS is asked in its partition.
    region?: string | undefined;
    chain?: AwsDefaultCredentialChain | undefined;
    transport?: CloudConnectorTransport | undefined;
  }): Promise<ServerAwsIdentityAnswer> {
    const chain: AwsDefaultCredentialChain =
      options?.chain || AwsDefaultCredentialChain.getShared();
    const region: string = ServerAwsIdentityService.getRegion(
      options?.region,
      chain,
    );
    let credentials: AwsChainCredentials;

    try {
      credentials = await chain.getCredentials({ regionHint: region });
    } catch (error) {
      if (!(error instanceof AwsCredentialChainError)) {
        throw error;
      }

      return {
        isSignedIn: false,
        ...ServerAwsIdentityService.viaOf(error.source, chain),
        problem: error.message,
      };
    }

    const via: { via?: ServerAwsIdentityVia } = ServerAwsIdentityService.viaOf(
      credentials.source,
      chain,
    );

    try {
      const identity: AwsCallerIdentity = await getCallerIdentity({
        transport:
          options?.transport ||
          DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken || undefined,
        },
        region: region,
        timeoutInMs: SERVER_AWS_IDENTITY_TIMEOUT_IN_MS,
      });

      return {
        isSignedIn: true,
        arn: identity.arn,
        account: identity.account,
        ...via,
      };
    } catch (error) {
      // Credentials AWS does not take any more: the next email fetches new ones.
      if (
        error instanceof LlmProviderError &&
        AWS_CREDENTIAL_REFUSAL_CODES.includes(
          awsErrorCodeOf(error.responseBody || ""),
        )
      ) {
        chain.invalidate();
      }

      /*
       * The sender's words: AWS's code and message, the request's secret
       * and session token scrubbed from them (sendAwsRequest).
       */
      return {
        isSignedIn: false,
        ...via,
        problem: `AWS did not say which identity this server signs in as. ${
          error instanceof Error ? error.message : "The request failed."
        }`,
      };
    }
  }

  /*
   * The Region STS is asked in: the email's, when it is a Region code;
   * else the server's own (AWS_REGION); else us-east-1.
   */
  public static getRegion(
    region: string | undefined,
    chain: AwsDefaultCredentialChain,
  ): string {
    const named: string = (region || "").trim().toLowerCase();

    if (named && isAwsRegion(named)) {
      return named;
    }

    return chain.getRegion() || FALLBACK_REGION;
  }

  // Where credentials of a source came from, in the answer's words.
  public static viaOf(
    source: AwsCredentialSource | null,
    chain: AwsDefaultCredentialChain,
  ): { via?: ServerAwsIdentityVia } {
    switch (source) {
      case "environment":
        return { via: ServerAwsIdentityVia.Environment };
      case "profile":
        return { via: ServerAwsIdentityVia.Profile };
      case "web-identity":
        return { via: ServerAwsIdentityVia.WebIdentity };
      case "instance-profile":
        return { via: ServerAwsIdentityVia.InstanceProfile };
      case "container": {
        const agent: "ecs" | "eks-pod-identity" | "other" | null =
          chain.getContainerAgent();

        return {
          via:
            agent === "ecs"
              ? ServerAwsIdentityVia.EcsTaskRole
              : agent === "eks-pod-identity"
                ? ServerAwsIdentityVia.EksPodIdentity
                : ServerAwsIdentityVia.Container,
        };
      }
      case null:
        return {};
    }
  }
}
