import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  AWS_SHARED_IDENTITY_PROVIDERS,
  AwsIdentityProviderKind,
  AwsIdentityProviderReach,
  AwsTrustedIdentityProvider,
  getAwsIdentityProviderId,
  getAwsTrustedIdentityProviders,
  getAwsTrustedOutsideAccounts,
  isAwsIdentityProviderOpen,
  readAwsFederatedPrincipal,
  readAwsPolicyDocument,
} from "../../../Utils/SecurityCase/AwsTrustPolicy";
import {
  COGNITO_GUESTS_TRUST,
  COGNITO_TRUST,
  EKS_AUDIENCE_ONLY_TRUST,
  EKS_NAMESPACE_TRUST,
  EKS_SERVICE_ACCOUNT_TRUST,
  FACEBOOK_TRUST,
  GITHUB_AUDIENCE_ONLY_TRUST,
  GITHUB_BRANCH_TRUST,
  GITHUB_ORGANIZATION_TRUST,
  GITHUB_REPOSITORY_TRUST,
  GOOGLE_TRUST,
  LOGIN_WITH_AMAZON_TRUST,
  OTHER_OIDC_PROVIDER_TRUST,
  SAML_TRUST,
} from "../../Helpers/AwsTrustPolicyExamples";

/*
 * THE IDENTITY PROVIDERS A ROLE'S TRUST POLICY LETS IN (#11378): a
 * "Federated" principal - an OIDC provider in the account, one built into
 * AWS, a SAML provider - and what its conditions hold the token's claims
 * to. Every documented trust policy (Helpers/AwsTrustPolicyExamples, AWS's
 * own words) reads as held to what AWS says it is held to; what AWS warns
 * of - a shared provider's tenancy claim not held, a wildcard where an
 * organization goes, a provider of your own with no sub - reads as open to
 * anyone. Never read as holding more than it does: a statement that may
 * let more in is read as letting it in.
 */

const GITHUB: string = "token.actions.githubusercontent.com";
const GITHUB_PROVIDER: string = `arn:aws:iam::012345678910:oidc-provider/${GITHUB}`;

function providersOf(text: string): Array<AwsTrustedIdentityProvider> {
  const policy: JSONObject | null = readAwsPolicyDocument(text);

  expect(policy).not.toBeNull();

  return getAwsTrustedIdentityProviders(policy!);
}

// The one provider a policy lets in, as the step names it: its name, how far, and what holds it.
function only(
  text: string,
): Pick<
  AwsTrustedIdentityProvider,
  "name" | "kind" | "reach" | "claim" | "values"
> {
  const providers: Array<AwsTrustedIdentityProvider> = providersOf(text);

  expect(providers).toHaveLength(1);

  const { name, kind, reach, claim, values } = providers[0]!;

  return { name, kind, reach, claim, values };
}

// A GitHub Actions trust of one statement, with these conditions.
function github(condition: JSONObject | undefined): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: GITHUB_PROVIDER },
        Action: "sts:AssumeRoleWithWebIdentity",
        ...(condition ? { Condition: condition } : {}),
      },
    ],
  });
}

describe("AWS's documented trust policies read as held to what AWS says", () => {
  test("GitHub Actions: one branch, one repository, one organization - by sub", () => {
    expect(only(GITHUB_BRANCH_TRUST)).toEqual({
      name: GITHUB,
      kind: AwsIdentityProviderKind.Oidc,
      reach: AwsIdentityProviderReach.Limited,
      claim: "sub",
      values: ["repo:GitHubOrg/GitHubRepo:ref:refs/heads/GitHubBranch"],
    });
    expect(only(GITHUB_REPOSITORY_TRUST)).toMatchObject({
      reach: AwsIdentityProviderReach.Limited,
      claim: "sub",
      values: ["repo:GitHubOrg/GitHubRepo:*"],
    });
    expect(only(GITHUB_ORGANIZATION_TRUST)).toMatchObject({
      reach: AwsIdentityProviderReach.Limited,
      claim: "sub",
      values: ["repo:GitHubOrg/*"],
    });
  });

  test("the providers built into AWS: an Amazon Cognito identity pool by aud, Google by aud, Facebook and Login with Amazon by app_id", () => {
    expect(
      [
        COGNITO_GUESTS_TRUST,
        COGNITO_TRUST,
        GOOGLE_TRUST,
        FACEBOOK_TRUST,
        LOGIN_WITH_AMAZON_TRUST,
      ].map(only),
    ).toEqual([
      {
        name: "cognito-identity.amazonaws.com",
        kind: AwsIdentityProviderKind.Oidc,
        reach: AwsIdentityProviderReach.Limited,
        claim: "aud",
        values: ["us-east-2:12345678-abcd-abcd-abcd-123456"],
      },
      {
        name: "cognito-identity.amazonaws.com",
        kind: AwsIdentityProviderKind.Oidc,
        reach: AwsIdentityProviderReach.Limited,
        claim: "aud",
        values: ["us-east:12345678-ffff-ffff-ffff-123456"],
      },
      {
        name: "accounts.google.com",
        kind: AwsIdentityProviderKind.Oidc,
        reach: AwsIdentityProviderReach.Limited,
        claim: "aud",
        values: ["666777888999000"],
      },
      {
        name: "graph.facebook.com",
        kind: AwsIdentityProviderKind.Oidc,
        reach: AwsIdentityProviderReach.Limited,
        claim: "app_id",
        values: ["111222333444555"],
      },
      {
        name: "www.amazon.com",
        kind: AwsIdentityProviderKind.Oidc,
        reach: AwsIdentityProviderReach.Limited,
        claim: "app_id",
        values: ["amzn1.application-oa2-123456"],
      },
    ]);
  });

  test("another OIDC provider, the account's own, by the app its aud names", () => {
    expect(only(OTHER_OIDC_PROVIDER_TRUST)).toEqual({
      name: "server.example.com",
      kind: AwsIdentityProviderKind.Oidc,
      reach: AwsIdentityProviderReach.Limited,
      claim: "aud",
      values: ["appid_from_oidc_idp"],
    });
  });

  test("an EKS cluster's service account by sub - and every one of a namespace, as the EKS guide says StringLike does", () => {
    const cluster: string =
      "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE";

    expect(only(EKS_SERVICE_ACCOUNT_TRUST)).toEqual({
      name: cluster,
      kind: AwsIdentityProviderKind.Oidc,
      reach: AwsIdentityProviderReach.Limited,
      claim: "sub",
      values: ["system:serviceaccount:default:my-service-account"],
    });
    expect(only(EKS_NAMESPACE_TRUST)).toEqual({
      name: cluster,
      kind: AwsIdentityProviderKind.Oidc,
      reach: AwsIdentityProviderReach.Limited,
      claim: "sub",
      values: ["system:serviceaccount:default:*"],
    });
  });

  test("a SAML provider, by its name: whomever it signs in as the role", () => {
    expect(only(SAML_TRUST)).toEqual({
      name: "PROVIDER-NAME",
      kind: AwsIdentityProviderKind.Saml,
      reach: AwsIdentityProviderReach.SignedIn,
      claim: "",
      values: [],
    });
  });

  test("none of them trusts an outside AWS account, and none is open to anyone", () => {
    for (const text of [
      GITHUB_BRANCH_TRUST,
      GITHUB_REPOSITORY_TRUST,
      GITHUB_ORGANIZATION_TRUST,
      COGNITO_GUESTS_TRUST,
      COGNITO_TRUST,
      GOOGLE_TRUST,
      FACEBOOK_TRUST,
      LOGIN_WITH_AMAZON_TRUST,
      OTHER_OIDC_PROVIDER_TRUST,
      SAML_TRUST,
      EKS_SERVICE_ACCOUNT_TRUST,
      EKS_NAMESPACE_TRUST,
    ]) {
      const policy: JSONObject = readAwsPolicyDocument(text)!;

      expect({
        text,
        outside: getAwsTrustedOutsideAccounts(policy, "012345678910"),
        open: getAwsTrustedIdentityProviders(policy).some(
          isAwsIdentityProviderOpen,
        ),
      }).toEqual({ text, outside: [], open: false });
    }
  });

  test("read as GetRole writes them: URL-encoded", () => {
    expect(
      getAwsTrustedIdentityProviders(
        readAwsPolicyDocument(encodeURIComponent(GITHUB_BRANCH_TRUST))!,
      ),
    ).toEqual(providersOf(GITHUB_BRANCH_TRUST));
  });
});

describe("what AWS warns of reads as open to anyone", () => {
  test("GitHub Actions with its audience alone: anyone with a token from it, in any organization - by sub", () => {
    expect(only(GITHUB_AUDIENCE_ONLY_TRUST)).toEqual({
      name: GITHUB,
      kind: AwsIdentityProviderKind.Oidc,
      reach: AwsIdentityProviderReach.AnyOrganization,
      claim: "sub",
      values: [],
    });
    // No condition at all, as before IAM checked.
    expect(only(github(undefined)).reach).toBe(
      AwsIdentityProviderReach.AnyOrganization,
    );
  });

  test("a sub IAM lets through that still names no organization: wildcards alone, or one where the organization goes", () => {
    for (const sub of [
      "*",
      "**",
      "?*",
      "repo:*",
      "repo:*:*",
      "repo:*/*",
      "repo:*/GitHubRepo:*",
      // Anyone can make an organization whose name matches.
      "repo:octo-*/*",
      "repo:octo?org/app:*",
      "repo:/app:*",
    ]) {
      expect({
        sub,
        reach: only(
          github({
            StringEquals: { [`${GITHUB}:aud`]: "sts.amazonaws.com" },
            StringLike: { [`${GITHUB}:sub`]: sub },
          }),
        ).reach,
      }).toEqual({ sub, reach: AwsIdentityProviderReach.AnyOrganization });
    }
  });

  test("one loose value among held ones lets in what it matches", () => {
    expect(
      only(
        github({
          StringLike: {
            [`${GITHUB}:sub`]: ["repo:GitHubOrg/GitHubRepo:*", "repo:*"],
          },
        }),
      ).reach,
    ).toBe(AwsIdentityProviderReach.AnyOrganization);
  });

  test("StringEquals reads a wildcard as itself: it holds the claim to that one value", () => {
    expect(
      only(github({ StringEquals: { [`${GITHUB}:sub`]: "repo:*" } })),
    ).toMatchObject({
      reach: AwsIdentityProviderReach.Limited,
      values: ["repo:*"],
    });
  });

  test("an operator that holds nothing to a value is no hold: a negation, a Null check", () => {
    for (const condition of [
      { StringNotEquals: { [`${GITHUB}:sub`]: "repo:evil/app:*" } },
      { StringNotLike: { [`${GITHUB}:sub`]: "repo:evil/*" } },
      { Null: { [`${GITHUB}:sub`]: "false" } },
      { StringEquals: { [`${GITHUB}:actor`]: "octocat" } },
    ]) {
      expect({ condition, reach: only(github(condition)).reach }).toEqual({
        condition,
        reach: AwsIdentityProviderReach.AnyOrganization,
      });
    }
  });

  test("Amazon Cognito without its identity pool, or any pool of a Region: users of any pool, in any AWS account", () => {
    const guestsOfAnyPool: JSONObject =
      readAwsPolicyDocument(COGNITO_GUESTS_TRUST)!;
    const statement: JSONObject = guestsOfAnyPool["Statement"] as JSONObject;

    delete (statement["Condition"] as JSONObject)["StringEquals"];

    expect(getAwsTrustedIdentityProviders(guestsOfAnyPool)).toEqual([
      {
        principal: "cognito-identity.amazonaws.com",
        name: "cognito-identity.amazonaws.com",
        kind: AwsIdentityProviderKind.Oidc,
        reach: AwsIdentityProviderReach.AnyOrganization,
        claim: "aud",
        values: [],
      },
    ]);
    expect(
      only(
        COGNITO_TRUST.replace('"StringEquals"', '"StringLike"').replace(
          "us-east:12345678-ffff-ffff-ffff-123456",
          "us-east:*",
        ),
      ).reach,
    ).toBe(AwsIdentityProviderReach.AnyOrganization);
  });

  test("Google without the app its aud names: anyone with a Google account", () => {
    expect(
      only(
        GOOGLE_TRUST.replace(
          ',\n          "Condition": {"StringEquals": {"accounts.google.com:aud": "666777888999000"}}',
          "",
        ),
      ),
    ).toMatchObject({
      name: "accounts.google.com",
      reach: AwsIdentityProviderReach.AnyOrganization,
      claim: "aud",
    });
  });

  test("a provider of your own with no sub, and an aud of AWS STS's own: anyone it gives a token to - every service account of the cluster", () => {
    expect(only(EKS_AUDIENCE_ONLY_TRUST)).toEqual({
      name: "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE",
      kind: AwsIdentityProviderKind.Oidc,
      reach: AwsIdentityProviderReach.Anyone,
      claim: "sub",
      values: [],
    });
    expect(
      only(
        EKS_SERVICE_ACCOUNT_TRUST.replace(
          "system:serviceaccount:default:my-service-account",
          "*",
        ).replace('"StringEquals"', '"StringLike"'),
      ).reach,
    ).toBe(AwsIdentityProviderReach.Anyone);
  });

  test("open is what the step marks: anyone of any organization, or anyone at all - never a held one, nor SAML's", () => {
    expect(
      [
        AwsIdentityProviderReach.AnyOrganization,
        AwsIdentityProviderReach.Anyone,
        AwsIdentityProviderReach.Limited,
        AwsIdentityProviderReach.SignedIn,
      ].map((reach: AwsIdentityProviderReach): boolean => {
        return isAwsIdentityProviderOpen({ reach });
      }),
    ).toEqual([true, true, false, false]);
  });
});

describe("how IAM reads a condition", () => {
  test("keys case aside; ForAnyValue:, ForAllValues: and IfExists aside; StringEqualsIgnoreCase holds too", () => {
    for (const condition of [
      {
        StringEquals: {
          "Token.Actions.GitHubUserContent.com:SUB": "repo:GitHubOrg/app:*",
        },
      },
      { "ForAnyValue:StringLike": { [`${GITHUB}:sub`]: "repo:GitHubOrg/*" } },
      {
        "ForAllValues:StringEquals": {
          [`${GITHUB}:sub`]: "repo:GitHubOrg/app:*",
        },
      },
      { StringLikeIfExists: { [`${GITHUB}:sub`]: "repo:GitHubOrg/*" } },
      { StringEqualsIgnoreCase: { [`${GITHUB}:sub`]: "repo:githuborg/app:*" } },
    ] as Array<JSONObject>) {
      expect({ condition, reach: only(github(condition)).reach }).toEqual({
        condition,
        reach: AwsIdentityProviderReach.Limited,
      });
    }
  });

  test("GitHub Actions is held by its job_workflow_ref as well as its sub, as AWS's list says", () => {
    expect(
      only(
        github({
          StringLike: {
            [`${GITHUB}:job_workflow_ref`]:
              "octo-org/octo-automation/.github/workflows/oidc.yml@refs/heads/main",
          },
        }),
      ),
    ).toMatchObject({
      reach: AwsIdentityProviderReach.Limited,
      claim: "job_workflow_ref",
      values: [
        "octo-org/octo-automation/.github/workflows/oidc.yml@refs/heads/main",
      ],
    });
    expect(
      only(
        github({
          StringLike: { [`${GITHUB}:job_workflow_ref`]: "*/octo-automation/*" },
        }),
      ).reach,
    ).toBe(AwsIdentityProviderReach.AnyOrganization);
  });

  test("other shared providers by the claim AWS names for each: GitLab's sub, HCP Terraform's organization, Vercel's aud", () => {
    function trustOf(url: string, condition: JSONObject): string {
      return JSON.stringify({
        Version: "2012-10-17",
        Statement: {
          Effect: "Allow",
          Principal: {
            Federated: `arn:aws:iam::123456789012:oidc-provider/${url}`,
          },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: condition,
        },
      });
    }

    expect(
      only(
        trustOf("gitlab.com", {
          StringLike: {
            "gitlab.com:sub":
              "project_path:mygroup/myproject:ref_type:branch:ref:main",
          },
        }),
      ).reach,
    ).toBe(AwsIdentityProviderReach.Limited);
    expect(
      only(
        trustOf("app.terraform.io", {
          StringLike: {
            "app.terraform.io:sub":
              "organization:*:project:*:workspace:*:run_phase:*",
          },
        }),
      ).reach,
    ).toBe(AwsIdentityProviderReach.AnyOrganization);
    expect(
      only(
        trustOf("app.terraform.io", {
          StringLike: {
            "app.terraform.io:sub":
              "organization:my-org:project:*:workspace:*:run_phase:*",
          },
        }),
      ).reach,
    ).toBe(AwsIdentityProviderReach.Limited);
    expect(
      only(
        trustOf("oidc.vercel.com", {
          StringEquals: { "oidc.vercel.com:aud": "https://vercel.com/my-team" },
        }),
      ),
    ).toMatchObject({
      reach: AwsIdentityProviderReach.Limited,
      claim: "aud",
    });
    expect(
      only(
        trustOf("oidc.vercel.com", {
          StringLike: { "oidc.vercel.com:aud": "https://vercel.com/*" },
        }),
      ).reach,
    ).toBe(AwsIdentityProviderReach.AnyOrganization);
  });

  test("Azure Sentinel is held by a key of STS's own, sts:RoleSessionName", () => {
    const sentinel: string = JSON.stringify({
      Version: "2012-10-17",
      Statement: {
        Effect: "Allow",
        Principal: {
          Federated:
            "arn:aws:iam::123456789012:oidc-provider/sts.windows.net/33e01921-4d64-4f8c-a055-5bdaffd5e33d/",
        },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: { "sts:RoleSessionName": "MicrosoftSentinel_1234" },
        },
      },
    });

    expect(only(sentinel)).toMatchObject({
      name: "sts.windows.net/33e01921-4d64-4f8c-a055-5bdaffd5e33d",
      reach: AwsIdentityProviderReach.Limited,
      claim: "sts:RoleSessionName",
      values: ["MicrosoftSentinel_1234"],
    });
  });

  test("AWS's list of shared providers, as its page has it", () => {
    expect(AWS_SHARED_IDENTITY_PROVIDERS[GITHUB]).toEqual([
      "sub",
      "job_workflow_ref",
    ]);
    expect(AWS_SHARED_IDENTITY_PROVIDERS["gitlab.com"]).toEqual(["sub"]);
    expect(
      AWS_SHARED_IDENTITY_PROVIDERS["cognito-identity.amazonaws.com"],
    ).toEqual(["aud"]);
    // A GitHub Enterprise's own issuer is unique to it: not shared.
    expect(
      AWS_SHARED_IDENTITY_PROVIDERS[`${GITHUB}/octo-enterprise`],
    ).toBeUndefined();

    for (const [url, claims] of Object.entries(AWS_SHARED_IDENTITY_PROVIDERS)) {
      expect(url).toBe(url.toLowerCase());
      expect(url).not.toMatch(/^https:|\/$/);
      expect(claims.length).toBeGreaterThan(0);
    }
  });
});

describe("a policy's statements, together", () => {
  test("each provider once, in the policy's order; a statement of its own lets it in as far as it says", () => {
    const policy: JSONObject = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Federated: GITHUB_PROVIDER },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringLike: { [`${GITHUB}:sub`]: "repo:GitHubOrg/GitHubRepo:*" },
          },
        },
        {
          Effect: "Allow",
          Principal: {
            Federated: [
              "accounts.google.com",
              "arn:aws:iam::111122223333:saml-provider/Okta",
            ],
          },
          Action: ["sts:AssumeRoleWithWebIdentity", "sts:AssumeRoleWithSAML"],
          Condition: {
            StringEquals: { "accounts.google.com:aud": "666777888999000" },
          },
        },
        // The same GitHub provider again, with nothing held: the role's way in for anyone.
        {
          Effect: "Allow",
          Principal: { Federated: GITHUB_PROVIDER },
          Action: "sts:AssumeRoleWithWebIdentity",
        },
      ],
    };

    expect(
      getAwsTrustedIdentityProviders(policy).map(
        (provider: AwsTrustedIdentityProvider): [string, string] => {
          return [provider.name, provider.reach];
        },
      ),
    ).toEqual([
      [GITHUB, AwsIdentityProviderReach.AnyOrganization],
      ["accounts.google.com", AwsIdentityProviderReach.Limited],
      ["Okta", AwsIdentityProviderReach.SignedIn],
    ]);
  });

  test("two statements that each hold a provider hold it to every value either names", () => {
    const policy: JSONObject = {
      Version: "2012-10-17",
      Statement: [
        "repo:GitHubOrg/app:*",
        "repo:GitHubOrg/api:*",
        "repo:GitHubOrg/app:*",
      ].map((sub: string): JSONObject => {
        return {
          Effect: "Allow",
          Principal: { Federated: GITHUB_PROVIDER },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: { StringLike: { [`${GITHUB}:sub`]: sub } },
        };
      }),
    };

    expect(getAwsTrustedIdentityProviders(policy)).toEqual([
      {
        principal: GITHUB_PROVIDER,
        name: GITHUB,
        kind: AwsIdentityProviderKind.Oidc,
        reach: AwsIdentityProviderReach.Limited,
        claim: "sub",
        values: ["repo:GitHubOrg/app:*", "repo:GitHubOrg/api:*"],
      },
    ]);
  });

  test("a Deny lets nobody in, and a statement with no Federated principal names no provider", () => {
    expect(
      getAwsTrustedIdentityProviders({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Deny",
            Principal: { Federated: GITHUB_PROVIDER },
            Action: "sts:AssumeRoleWithWebIdentity",
          },
          {
            Effect: "Allow",
            Principal: { AWS: "arn:aws:iam::444455556666:root" },
            Action: "sts:AssumeRole",
          },
          { Effect: "Allow", Principal: "*", Action: "sts:AssumeRole" },
          {
            Effect: "Allow",
            Principal: { Service: "ec2.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    ).toEqual([]);
  });

  test("one provider however its ARN is written: an ARN's case, a trailing slash", () => {
    const named: Array<string> = [
      GITHUB_PROVIDER,
      `ARN:AWS:IAM::012345678910:OIDC-PROVIDER/${GITHUB.toUpperCase()}/`,
    ];

    expect(
      new Set(
        named.map((principal: string): string => {
          return getAwsIdentityProviderId(readAwsFederatedPrincipal(principal));
        }),
      ).size,
    ).toBe(1);
    // Said as written, matched case aside.
    expect(readAwsFederatedPrincipal(named[1]!)).toEqual({
      kind: AwsIdentityProviderKind.Oidc,
      name: GITHUB.toUpperCase(),
      url: GITHUB,
    });
    expect(
      readAwsFederatedPrincipal(
        "arn:aws-us-gov:iam::123456789012:saml-provider/Okta",
      ),
    ).toEqual({ kind: AwsIdentityProviderKind.Saml, name: "Okta", url: "" });
  });
});
