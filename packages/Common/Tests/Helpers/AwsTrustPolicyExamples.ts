import { AWS_DOCS_GAP } from "./AwsIamRoleRecords";

/*
 * ROLE TRUST POLICIES THAT LET PEOPLE IN THROUGH AN IDENTITY PROVIDER, AS
 * AWS DOCUMENTS THEM (#11378), word for word, for the tests of what the
 * step "Undo what changed on the account" names under a role:
 *
 *   - IAM User Guide, "Create a role for OpenID Connect federation": the
 *     Amazon Cognito, Login with Amazon, Facebook and Google examples, the
 *     GitHub Actions example and the two conditions it gives beside it,
 *     and the principal and condition it gives for another OIDC provider;
 *   - IAM User Guide, "Create a role for SAML 2.0 federation": its SAML
 *     example;
 *   - Amazon EKS User Guide, "Assign IAM roles to Kubernetes service
 *     accounts": the trust policy get-role prints for a service account,
 *     and the StringLike it says lets every service account of a namespace
 *     in.
 *
 * AWS's placeholders are kept as its pages write them (GitHubOrg,
 * PROVIDER-NAME, region-code), and so is the run of tabs and spaces they
 * write after a policy's "Version". A condition AWS gives on its own is
 * put in its example's statement, as AWS says to.
 */

// The GitHub Actions example: one organization, repository and branch.
export const GITHUB_BRANCH_TRUST: string = `{
  "Version":"2012-10-17",${AWS_DOCS_GAP}
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::012345678910:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:GitHubOrg/GitHubRepo:ref:refs/heads/GitHubBranch"
        }
      }
    }
  ]
}`;

// The GitHub Actions example's statement, with a condition of AWS's in place of its own.
function githubTrust(condition: string): string {
  return `{
  "Version":"2012-10-17",${AWS_DOCS_GAP}
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::012345678910:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      ${condition}
    }
  ]
}`;
}

// "limits access to the defined GitHub organization and repository, but grants access to any branch".
export const GITHUB_REPOSITORY_TRUST: string = githubTrust(`"Condition": {
  "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
  },
  "StringLike": {
    "token.actions.githubusercontent.com:sub": "repo:GitHubOrg/GitHubRepo:*"
  }
}`);

// "limits access to any repository or branch within the defined GitHub organization".
export const GITHUB_ORGANIZATION_TRUST: string = githubTrust(`"Condition": {
  "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
  },
  "StringLike": {
    "token.actions.githubusercontent.com:sub": "repo:GitHubOrg/*"
  }
}`);

/*
 * The trust AWS warns of: "If you do not limit the condition key
 * token.actions.githubusercontent.com:sub to a specific organization or
 * repository, then GitHub Actions from organizations or repositories
 * outside of your control are able to assume roles" - the example's
 * audience alone, as a role written before IAM checked for sub may have.
 */
export const GITHUB_AUDIENCE_ONLY_TRUST: string = githubTrust(`"Condition": {
  "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
  }
}`);

// The Amazon Cognito example the page opens with: one identity pool, and its guests.
export const COGNITO_GUESTS_TRUST: string = `{
    "Version":"2012-10-17",${AWS_DOCS_GAP}
    "Statement": {
        "Effect": "Allow",
        "Principal": {"Federated": "cognito-identity.amazonaws.com"},
        "Action": "sts:AssumeRoleWithWebIdentity",
        "Condition": {
            "StringEquals": {"cognito-identity.amazonaws.com:aud": "us-east-2:12345678-abcd-abcd-abcd-123456"},
            "ForAnyValue:StringLike": {"cognito-identity.amazonaws.com:amr": "unauthenticated"}
        }
    }
}`;

export const LOGIN_WITH_AMAZON_TRUST: string = `{
      "Version":"2012-10-17",${AWS_DOCS_GAP}
      "Statement": [{
          "Sid": "RoleForLoginWithAmazon",
          "Effect": "Allow",
          "Principal": {"Federated": "www.amazon.com"},
          "Action": "sts:AssumeRoleWithWebIdentity",
          "Condition": {"StringEquals": {"www.amazon.com:app_id": "amzn1.application-oa2-123456"}}
      }]
  }`;

export const FACEBOOK_TRUST: string = `{
      "Version":"2012-10-17",${AWS_DOCS_GAP}
      "Statement": [{
          "Sid": "RoleForFacebook",
          "Effect": "Allow",
          "Principal": {"Federated": "graph.facebook.com"},
          "Action": "sts:AssumeRoleWithWebIdentity",
          "Condition": {"StringEquals": {"graph.facebook.com:app_id": "111222333444555"}}
      }]
  }`;

export const GOOGLE_TRUST: string = `{
      "Version":"2012-10-17",${AWS_DOCS_GAP}
      "Statement": [{
          "Sid": "RoleForGoogle",
          "Effect": "Allow",
          "Principal": {"Federated": "accounts.google.com"},
          "Action": "sts:AssumeRoleWithWebIdentity",
          "Condition": {"StringEquals": {"accounts.google.com:aud": "666777888999000"}}
      }]
  }`;

export const COGNITO_TRUST: string = `{
      "Version":"2012-10-17",${AWS_DOCS_GAP}
      "Statement": [{
          "Sid": "RoleForCognito",
          "Effect": "Allow",
          "Principal": {"Federated": "cognito-identity.amazonaws.com"},
          "Action": "sts:AssumeRoleWithWebIdentity",
          "Condition": {"StringEquals": {"cognito-identity.amazonaws.com:aud": "us-east:12345678-ffff-ffff-ffff-123456"}}
      }]
  }`;

// "For other OIDC providers, use the Amazon Resource Name (ARN) of the OIDC IdP", with its aud condition.
export const OTHER_OIDC_PROVIDER_TRUST: string = `{
  "Version":"2012-10-17",${AWS_DOCS_GAP}
  "Statement": [{
    "Effect": "Allow",
    "Principal":{"Federated":"arn:aws:iam::123456789012:oidc-provider/server.example.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {"StringEquals": {"server.example.com:aud": "appid_from_oidc_idp"}}
  }]
}`;

// The SAML example: "designed for a SAML federated user".
export const SAML_TRUST: string = `{
    "Version":"2012-10-17",${AWS_DOCS_GAP}
    "Statement": {
        "Effect": "Allow",
        "Action": "sts:AssumeRoleWithSAML",
        "Principal": {
            "Federated": "arn:aws:iam::111122223333:saml-provider/PROVIDER-NAME"
        },
        "Condition": {
            "StringEquals": {
                "SAML:aud": "https://region-code.signin.aws.amazon.com/saml"
            }
        }
    }
}`;

// What get-role prints for a Kubernetes service account's role: the EKS User Guide's example output.
export const EKS_SERVICE_ACCOUNT_TRUST: string = `{
    "Version":"2012-10-17",${AWS_DOCS_GAP}
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::111122223333:oidc-provider/oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:sub": "system:serviceaccount:default:my-service-account",
                    "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:aud": "sts.amazonaws.com"
                }
            }
        }
    ]
}`;

/*
 * "If you want to allow all service accounts within a namespace to use the
 * role ... Replace StringEquals with StringLike and replace
 * $service_account with *."
 */
export const EKS_NAMESPACE_TRUST: string = EKS_SERVICE_ACCOUNT_TRUST.replace(
  '"StringEquals"',
  '"StringLike"',
).replace(
  "system:serviceaccount:default:my-service-account",
  "system:serviceaccount:default:*",
);

// The EKS example's audience alone: every service account of the cluster.
export const EKS_AUDIENCE_ONLY_TRUST: string =
  EKS_SERVICE_ACCOUNT_TRUST.replace(
    `
                    "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:sub": "system:serviceaccount:default:my-service-account",`,
    "",
  );
