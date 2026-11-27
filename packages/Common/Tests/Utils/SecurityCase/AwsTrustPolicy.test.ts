import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  AWS_EVERY_ACCOUNT,
  getAwsTrustedOutsideAccounts,
  isSameAwsPolicy,
  readAwsPolicyDocument,
  readAwsPrincipalAccount,
} from "../../../Utils/SecurityCase/AwsTrustPolicy";

/*
 * AN IAM ROLE'S TRUST POLICY, READ (#11038): who may assume the role, as
 * IAM's GetRole writes it (URL-encoded, RFC 3986) and as CloudTrail
 * records the one a call set (as the caller sent it). The texts and the
 * principals are AWS's own, from its documentation:
 *
 *   - the trust policy of the IAM API Reference's GetRole and
 *     UpdateAssumeRolePolicy samples, and of the CloudTrail User Guide's
 *     CreateRole record - each with the run of tabs and spaces AWS's pages
 *     carry after "Version";
 *   - every form of principal the IAM User Guide's "AWS JSON policy
 *     elements: Principal" names: an account by its id or its root's ARN,
 *     a role, a role session, a user, an STS federated user, the built-in
 *     and the account's own identity providers, services, "*", and the
 *     unique id a deleted principal is written as.
 */

// The account the role is in: the GetRole sample's.
const OWN: string = "123456789012";

// The whitespace AWS's documentation writes after "Version" in its samples.
const DOCS_GAP: string = "\t\t \t \t ";

// The IAM API Reference's GetRole sample: the trust policy as its page shows it, over two lines.
const GET_ROLE_SAMPLE_POLICY: string = `
      {"Version":"2012-10-17",${DOCS_GAP}"Statement":[{"Effect":"Allow",
      "Principal":{"Service":["ec2.amazonaws.com"]},"Action":["sts:AssumeRole"]}]}
    `;

// The CloudTrail User Guide's CreateRole record: requestParameters.assumeRolePolicyDocument.
const CREATE_ROLE_RECORDED_POLICY: string = `{"Version":"2012-10-17",${DOCS_GAP}"Statement":[{"Effect":"Allow","Action":["sts:AssumeRole"],"Principal":{"Service":["ec2.amazonaws.com"]}}]}`;

function trust(principal: unknown, extra: JSONObject = {}): JSONObject {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: principal,
        Action: "sts:AssumeRole",
        ...extra,
      } as JSONObject,
    ],
  };
}

// A policy as GetRole writes it: URL-encoded, as RFC 3986 encodes it.
function asGetRoleWritesIt(policy: JSONObject | string): string {
  return encodeURIComponent(
    typeof policy === "string" ? policy : JSON.stringify(policy),
  );
}

describe("a policy's text, read", () => {
  test("as GetRole's sample shows it: plain, over two lines, with AWS's own whitespace", () => {
    expect(readAwsPolicyDocument(GET_ROLE_SAMPLE_POLICY)).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: ["ec2.amazonaws.com"] },
          Action: ["sts:AssumeRole"],
        },
      ],
    });
  });

  test("as GetRole writes it: URL-encoded (RFC 3986), the same policy", () => {
    expect(
      readAwsPolicyDocument(asGetRoleWritesIt(GET_ROLE_SAMPLE_POLICY.trim())),
    ).toEqual(readAwsPolicyDocument(GET_ROLE_SAMPLE_POLICY));
  });

  test("with a + for a space, as a form encodes one, and a + of its own as %2B", () => {
    const policy: JSONObject = trust({ AWS: "arn:aws:iam::444455556666:role/a+b" });
    const formEncoded: string = encodeURIComponent(JSON.stringify(policy, null, 1))
      .split("%20")
      .join("+");

    expect(readAwsPolicyDocument(formEncoded)).toEqual(policy);
  });

  test("as CloudTrail recorded the one CreateRole set", () => {
    expect(readAwsPolicyDocument(CREATE_ROLE_RECORDED_POLICY)).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["sts:AssumeRole"],
          Principal: { Service: ["ec2.amazonaws.com"] },
        },
      ],
    });
  });

  test("a text cut short - CloudTrail's attributes end at 1,000 characters - is no policy, never read in part", () => {
    const whole: string = JSON.stringify(
      trust({ AWS: ["arn:aws:iam::444455556666:root", "555555555555"] }),
      null,
      2,
    );

    for (const cut of [whole.slice(0, whole.length - 3), whole.slice(0, 40)]) {
      expect(readAwsPolicyDocument(cut)).toBeNull();
      expect(readAwsPolicyDocument(asGetRoleWritesIt(cut))).toBeNull();
    }
  });

  test("anything that is not a policy is none", () => {
    for (const text of [
      "",
      "   ",
      undefined,
      null,
      "{{policy-statement}}",
      "%7B%7Bpolicy-statement%7D%7D",
      "%E0%A4%A",
      "[]",
      '{"Version":"2012-10-17"}',
      "not a policy",
      "null",
    ]) {
      expect({ text, policy: readAwsPolicyDocument(text) }).toEqual({
        text,
        policy: null,
      });
    }
  });
});

describe("the outside accounts a trust policy trusts", () => {
  test.each([
    // An account, by its root's ARN or its id: the same account.
    [{ AWS: "arn:aws:iam::444455556666:root" }, ["444455556666"]],
    [{ AWS: "444455556666" }, ["444455556666"]],
    // Several at once, as the IAM User Guide's array.
    [{ AWS: ["123456789012", "555555555555"] }, ["555555555555"]],
    [
      {
        AWS: ["arn:aws:iam::123456789012:root", "999999999999"],
        CanonicalUser:
          "79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be",
      },
      ["999999999999"],
    ],
    // A role, a role session, a user, an STS federated user: their account.
    [{ AWS: "arn:aws:iam::444455556666:role/role-name" }, ["444455556666"]],
    [
      {
        AWS: "arn:aws:sts::444455556666:assumed-role/role-name/role-session-name",
      },
      ["444455556666"],
    ],
    [{ AWS: "arn:aws:iam::444455556666:user/user-name" }, ["444455556666"]],
    [
      { AWS: "arn:aws:sts::444455556666:federated-user/user-name" },
      ["444455556666"],
    ],
    // Another partition's ARNs name their account the same way.
    [{ AWS: "arn:aws-us-gov:iam::444455556666:root" }, ["444455556666"]],
    [{ AWS: "arn:aws-cn:iam::444455556666:role/r" }, ["444455556666"]],
    // Every AWS account, either way it is written.
    ["*", [AWS_EVERY_ACCOUNT]],
    [{ AWS: "*" }, [AWS_EVERY_ACCOUNT]],
    // Services and identity providers are no account of AWS's.
    [{ Service: ["ecs.amazonaws.com", "elasticloadbalancing.amazonaws.com"] }, []],
    [{ Federated: "cognito-identity.amazonaws.com" }, []],
    [{ Federated: "accounts.google.com" }, []],
    [
      {
        Federated:
          "arn:aws:iam::444455556666:oidc-provider/tokens.actions.githubusercontent.com",
      },
      [],
    ],
    [{ Federated: "arn:aws:iam::444455556666:saml-provider/provider-name" }, []],
    // A principal deleted since, written as its unique id, lets nobody in.
    [{ AWS: "AROADBQP57FF2AEXAMPLE" }, []],
    [{ AWS: "AIDACKCEVSQ6C2EXAMPLE" }, []],
    // The role's own account is not outside it.
    [{ AWS: "arn:aws:iam::123456789012:root" }, []],
    [{ AWS: "arn:aws:iam::123456789012:user/deploy-bot" }, []],
  ])(
    "%j trusts %j",
    (principal: unknown, outside: Array<string>) => {
      expect(getAwsTrustedOutsideAccounts(trust(principal), OWN)).toEqual(
        outside,
      );
    },
  );

  test("over every statement, in the order the policy names them, each once", () => {
    expect(
      getAwsTrustedOutsideAccounts(
        {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { AWS: ["555555555555", "444455556666"] },
              Action: "sts:AssumeRole",
            },
            {
              Effect: "Allow",
              Principal: { AWS: "arn:aws:iam::555555555555:role/again" },
              Action: "sts:TagSession",
            },
            {
              Effect: "Allow",
              Principal: { AWS: "arn:aws:iam::999999999999:root" },
              Action: ["sts:AssumeRole", "sts:SetSourceIdentity"],
              Condition: { StringEquals: { "sts:ExternalId": "secret" } },
            },
          ],
        },
        OWN,
      ),
    ).toEqual(["555555555555", "444455556666", "999999999999"]);
  });

  test("only what an Allow trusts: a Deny narrows, and is no account let in", () => {
    expect(
      getAwsTrustedOutsideAccounts(
        {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Deny",
              Principal: { AWS: "444455556666" },
              Action: "sts:AssumeRole",
            },
            {
              Effect: "allow",
              Principal: { AWS: "555555555555" },
              Action: "sts:AssumeRole",
            },
          ],
        },
        OWN,
      ),
    ).toEqual(["555555555555"]);
  });

  test("one statement on its own, not in a list, is read the same", () => {
    expect(
      getAwsTrustedOutsideAccounts(
        {
          Version: "2012-10-17",
          Statement: {
            Effect: "Allow",
            Principal: { AWS: "444455556666" },
            Action: "sts:AssumeRole",
          },
        },
        OWN,
      ),
    ).toEqual(["444455556666"]);
  });

  test("the samples AWS documents trust a service, and no account", () => {
    for (const text of [GET_ROLE_SAMPLE_POLICY, CREATE_ROLE_RECORDED_POLICY]) {
      expect(
        getAwsTrustedOutsideAccounts(readAwsPolicyDocument(text)!, OWN),
      ).toEqual([]);
    }
  });

  test("a principal's account, read on its own", () => {
    expect(readAwsPrincipalAccount(" 444455556666 ")).toBe("444455556666");
    expect(readAwsPrincipalAccount("*")).toBe("*");
    expect(readAwsPrincipalAccount("arn:aws:iam::444455556666:root")).toBe(
      "444455556666",
    );
    expect(readAwsPrincipalAccount("arn:aws:s3:::bucket")).toBe("");
    expect(readAwsPrincipalAccount("4444555566667")).toBe("");
    expect(readAwsPrincipalAccount("arn:aws:iam::44445555666:root")).toBe("");
  });
});

describe("whether two trust policies grant the same", () => {
  const ATTACKER: JSONObject = trust({ AWS: "arn:aws:iam::444455556666:root" });

  test("the policy CloudTrail recorded and the one GetRole writes back are the same, however each is written", () => {
    expect(
      isSameAwsPolicy(
        readAwsPolicyDocument(CREATE_ROLE_RECORDED_POLICY)!,
        readAwsPolicyDocument(asGetRoleWritesIt(GET_ROLE_SAMPLE_POLICY.trim()))!,
      ),
    ).toBe(true);
  });

  test("an account by its id is the account by its root's ARN, as IAM saves it", () => {
    expect(isSameAwsPolicy(trust({ AWS: "444455556666" }), ATTACKER)).toBe(
      true,
    );
    expect(
      isSameAwsPolicy(trust({ AWS: ["444455556666"] }), ATTACKER),
    ).toBe(true);
  });

  test("statements in another order, a Sid, an action's case, a list's order: the same", () => {
    const left: JSONObject = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "Partner",
          Effect: "Allow",
          Principal: { AWS: ["555555555555", "444455556666"] },
          Action: ["sts:AssumeRole", "sts:TagSession"],
          Condition: {
            StringEquals: { "sts:ExternalId": ["b", "a"] },
          },
        },
        {
          Effect: "Allow",
          Principal: { Service: "ec2.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    };
    const right: JSONObject = {
      Statement: [
        {
          Action: "STS:AssumeRole",
          Principal: { Service: ["ec2.amazonaws.com"] },
          Effect: "Allow",
        },
        {
          Effect: "Allow",
          Action: ["sts:TagSession", "sts:AssumeRole"],
          Principal: {
            AWS: ["arn:aws:iam::444455556666:root", "555555555555"],
          },
          Condition: { StringEquals: { "sts:ExternalId": ["a", "b"] } },
        },
      ],
      Version: "2012-10-17",
    };

    expect(isSameAwsPolicy(left, right)).toBe(true);
  });

  test("another account, another effect, a condition added or changed, another action, every account: two policies", () => {
    for (const other of [
      trust({ AWS: "arn:aws:iam::555555555555:root" }),
      trust({ AWS: "arn:aws:iam::444455556666:role/one-role" }),
      {
        ...ATTACKER,
        Statement: [
          {
            ...(ATTACKER["Statement"] as Array<JSONObject>)[0]!,
            Effect: "Deny",
          },
        ],
      },
      trust(
        { AWS: "arn:aws:iam::444455556666:root" },
        { Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } } },
      ),
      trust(
        { AWS: "arn:aws:iam::444455556666:root" },
        { Action: ["sts:AssumeRole", "sts:TagSession"] },
      ),
      trust("*"),
      { ...ATTACKER, Version: "2008-10-17" },
    ]) {
      expect({ other, same: isSameAwsPolicy(other, ATTACKER) }).toEqual({
        other,
        same: false,
      });
    }
  });
});
