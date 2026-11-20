import { JSONObject } from "../JSON";

/*
 * WHICH AWS IDENTITY THIS SERVER SIGNS IN AS (#7380): what the Admin
 * Dashboard's Amazon SES card asks when the server's own email signs in
 * with the server's IAM role, so a missing or wrong role shows on the card,
 * not first on a test email.
 *
 * GET /api/notification/server-aws-identity?region=<the SES Region>, master
 * admins only (never the master API key): the server's own credentials
 * (AwsDefaultCredentialChain) are asked of AWS with sts:GetCallerIdentity,
 * which needs no permission at all. So the answer proves which identity
 * the server is, not that it may send: the test email is still the check
 * of that. It never carries a key, a secret or a token.
 */

export const SERVER_AWS_IDENTITY_ROUTE: string = "/server-aws-identity";

// Where the server's credentials came from, finer than the chain's source.
export enum ServerAwsIdentityVia {
  // AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the server's environment.
  Environment = "environment",
  // A profile of the AWS shared config files: its keys or its credential_process.
  Profile = "profile",
  // IAM roles for service accounts, or another OIDC provider the role trusts.
  WebIdentity = "web-identity",
  EksPodIdentity = "eks-pod-identity",
  EcsTaskRole = "ecs-task-role",
  // Another container credentials endpoint.
  Container = "container",
  InstanceProfile = "instance-profile",
}

export interface ServerAwsIdentityAnswer {
  // Whether AWS took the server's credentials.
  isSignedIn: boolean;
  // Who AWS says the server is (sts:GetCallerIdentity's Arn and Account).
  arn?: string | undefined;
  account?: string | undefined;
  // Where the credentials came from, when the server has a source.
  via?: ServerAwsIdentityVia | undefined;
  // Why it could not sign in, in the server's words: never a key or a token.
  problem?: string | undefined;
}

const VIAS: ReadonlyArray<string> = Object.values(ServerAwsIdentityVia);

// The longest ARN or problem read back: a page draws one line of each.
const MAX_TEXT_LENGTH: number = 2048;

const readText: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, MAX_TEXT_LENGTH)
    : undefined;
};

/*
 * An answer as the page reads it from the server's JSON, or null when the
 * JSON is not one.
 */
export const parseServerAwsIdentityAnswer: (
  json: JSONObject | null | undefined,
) => ServerAwsIdentityAnswer | null = (
  json: JSONObject | null | undefined,
): ServerAwsIdentityAnswer | null => {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }

  if (typeof json["isSignedIn"] !== "boolean") {
    return null;
  }

  const via: unknown = json["via"];
  const answer: ServerAwsIdentityAnswer = {
    isSignedIn: json["isSignedIn"],
  };
  const arn: string | undefined = readText(json["arn"]);
  const account: string | undefined = readText(json["account"]);
  const problem: string | undefined = readText(json["problem"]);

  if (typeof via === "string" && VIAS.includes(via)) {
    answer.via = via as ServerAwsIdentityVia;
  }

  if (answer.isSignedIn) {
    if (!arn) {
      return null;
    }

    answer.arn = arn;

    if (account) {
      answer.account = account;
    }

    return answer;
  }

  answer.problem = problem || "";

  return answer;
};
