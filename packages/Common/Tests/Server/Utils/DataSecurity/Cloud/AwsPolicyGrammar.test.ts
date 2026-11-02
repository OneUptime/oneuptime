import { describe, expect, test } from "@jest/globals";
import {
  PolicyPrincipal,
  coversAny,
  describePrincipal,
  hasRestrictingCondition,
  isAccountId,
  isBroadCidr,
  isFixedValue,
  policyValues,
  readPrincipals,
  wildcardMatches,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsPolicyGrammar";
import { DataStorePrincipalType } from "../../../../../Types/DataSecurity/DataStoreAccess";

/*
 * Data Security reads a bucket's, a domain's and an identity's policies the
 * way IAM does. Whether a store is reported public, and to whom it is
 * open, rests on these readings of the customer's own policy text.
 */

describe("isAccountId", () => {
  test("is twelve digits", () => {
    expect(isAccountId("123456789012")).toBe(true);
  });

  test("is not fewer or more digits", () => {
    expect(isAccountId("12345678901")).toBe(false);
    expect(isAccountId("1234567890123")).toBe(false);
    expect(isAccountId("")).toBe(false);
  });

  test("is not twelve characters that are not all digits", () => {
    expect(isAccountId("12345678901a")).toBe(false);
    expect(isAccountId("1234-5678-90")).toBe(false);
    expect(isAccountId("************")).toBe(false);
  });
});

describe("policyValues", () => {
  test("reads a single value as a list of one", () => {
    expect(policyValues("s3:GetObject")).toEqual(["s3:GetObject"]);
  });

  test("reads a list of values", () => {
    expect(policyValues(["s3:GetObject", "s3:PutObject"])).toEqual([
      "s3:GetObject",
      "s3:PutObject",
    ]);
  });

  test("writes numbers and booleans out as text", () => {
    expect(policyValues([123456789012, true, false])).toEqual([
      "123456789012",
      "true",
      "false",
    ]);
  });

  test("trims values and drops empty ones", () => {
    expect(policyValues(["  s3:GetObject ", "", "   "])).toEqual([
      "s3:GetObject",
    ]);
  });

  test("drops what is not a value", () => {
    expect(policyValues([null, undefined, { AWS: "*" }, ["x"]])).toEqual([]);
    expect(policyValues(undefined)).toEqual([]);
    expect(policyValues(null)).toEqual([]);
  });
});

describe("wildcardMatches", () => {
  test("matches the same text, case ignored", () => {
    expect(wildcardMatches("s3:GetObject", "s3:GetObject")).toBe(true);
    expect(wildcardMatches("S3:GETOBJECT", "s3:getobject")).toBe(true);
  });

  test("does not match different text", () => {
    expect(wildcardMatches("s3:GetObject", "s3:PutObject")).toBe(false);
    expect(wildcardMatches("s3:Get", "s3:GetObject")).toBe(false);
    expect(wildcardMatches("s3:GetObject", "s3:Get")).toBe(false);
  });

  test("a lone * matches anything, even nothing", () => {
    expect(wildcardMatches("*", "s3:GetObject")).toBe(true);
    expect(wildcardMatches("*", "")).toBe(true);
  });

  test("* matches any run of characters", () => {
    expect(wildcardMatches("s3:Get*", "s3:GetObject")).toBe(true);
    expect(wildcardMatches("s3:Get*", "s3:Get")).toBe(true);
    expect(wildcardMatches("s3:*Object", "s3:GetObject")).toBe(true);
    expect(wildcardMatches("s3:*Object", "s3:GetObjectAcl")).toBe(false);
    expect(wildcardMatches("*:*", "s3:GetObject")).toBe(true);
  });

  test("backtracks to the last * to find a later match", () => {
    expect(wildcardMatches("*Object*Acl", "s3:GetObjectVersionAcl")).toBe(true);
    expect(wildcardMatches("a*b*c", "aXbYbZc")).toBe(true);
    expect(wildcardMatches("a*b*c", "aXbYbZ")).toBe(false);
  });

  test("? matches exactly one character", () => {
    expect(wildcardMatches("s3:?etObject", "s3:GetObject")).toBe(true);
    expect(wildcardMatches("s3:?etObject", "s3:etObject")).toBe(false);
    expect(wildcardMatches("s3:??tObject", "s3:GetObject")).toBe(true);
  });

  test("an empty pattern matches only an empty value", () => {
    expect(wildcardMatches("", "")).toBe(true);
    expect(wildcardMatches("", "s3:GetObject")).toBe(false);
  });

  test("reads regular-expression characters as themselves", () => {
    expect(
      wildcardMatches("arn:aws:s3:::my.bucket/*", "arn:aws:s3:::myxbucket/key"),
    ).toBe(false);
    expect(
      wildcardMatches("arn:aws:s3:::my.bucket/*", "arn:aws:s3:::my.bucket/key"),
    ).toBe(true);
    expect(wildcardMatches("(a+)+", "aaaa")).toBe(false);
  });
});

describe("coversAny", () => {
  const samples: Array<string> = ["s3:GetObject", "s3:ListBucket"];

  test("an Action covers the samples it matches", () => {
    expect(coversAny(["s3:Get*"], [], samples)).toBe(true);
    expect(coversAny(["s3:*"], [], samples)).toBe(true);
    expect(coversAny(["s3:PutObject"], [], samples)).toBe(false);
  });

  test("a NotAction covers the samples it does not name", () => {
    expect(coversAny([], ["s3:PutObject"], samples)).toBe(true);
    expect(coversAny([], ["s3:GetObject"], samples)).toBe(true);
    expect(coversAny([], ["s3:*"], samples)).toBe(false);
  });

  test("an Action is read before a NotAction", () => {
    expect(coversAny(["s3:PutObject"], ["s3:PutObject"], samples)).toBe(false);
  });

  test("a statement with neither covers nothing", () => {
    expect(coversAny([], [], samples)).toBe(false);
  });

  test("nothing is covered without samples", () => {
    expect(coversAny(["*"], [], [])).toBe(false);
    expect(coversAny([], ["s3:PutObject"], [])).toBe(false);
  });
});

describe("isFixedValue", () => {
  test("is a value with no wildcard or policy variable", () => {
    expect(isFixedValue("123456789012")).toBe(true);
    expect(isFixedValue("vpc-1a2b3c4d")).toBe(true);
  });

  test("is not a value with a wildcard", () => {
    expect(isFixedValue("arn:aws:iam::*:role/admin")).toBe(false);
    expect(isFixedValue("o-?bcdef")).toBe(false);
  });

  test("is not a value with a policy variable", () => {
    expect(isFixedValue("${aws:username}")).toBe(false);
  });
});

describe("isBroadCidr", () => {
  test("is an IPv4 range wider than /8", () => {
    expect(isBroadCidr("0.0.0.0/0")).toBe(true);
    expect(isBroadCidr("10.0.0.0/7")).toBe(true);
  });

  test("is not an IPv4 range of /8 or narrower", () => {
    expect(isBroadCidr("10.0.0.0/8")).toBe(false);
    expect(isBroadCidr("203.0.113.0/24")).toBe(false);
  });

  test("is an IPv6 range wider than /32", () => {
    expect(isBroadCidr("::/0")).toBe(true);
    expect(isBroadCidr("2001:db8::/31")).toBe(true);
  });

  test("is not an IPv6 range of /32 or narrower", () => {
    expect(isBroadCidr("2001:db8::/32")).toBe(false);
    expect(isBroadCidr("2001:db8::/64")).toBe(false);
  });

  test("is not a single address", () => {
    expect(isBroadCidr("203.0.113.7")).toBe(false);
    expect(isBroadCidr("2001:db8::1")).toBe(false);
  });

  test("is a range whose prefix cannot be read", () => {
    expect(isBroadCidr("10.0.0.0/abc")).toBe(true);
  });
});

describe("hasRestrictingCondition", () => {
  test("holds a grant to a fixed account, organization or network", () => {
    expect(
      hasRestrictingCondition({
        StringEquals: { "aws:SourceAccount": "123456789012" },
      }),
    ).toBe(true);
    expect(
      hasRestrictingCondition({
        StringEquals: { "aws:PrincipalOrgID": ["o-abc123"] },
      }),
    ).toBe(true);
    expect(
      hasRestrictingCondition({
        IpAddress: { "aws:SourceIp": "203.0.113.0/24" },
      }),
    ).toBe(true);
  });

  test("reads operator and key names with case ignored", () => {
    expect(
      hasRestrictingCondition({
        stringequals: { "AWS:SOURCEVPCE": "vpce-1a2b3c4d" },
      }),
    ).toBe(true);
  });

  test("does not hold anything with no conditions", () => {
    expect(hasRestrictingCondition({})).toBe(false);
  });

  test("does not hold anything with a key that names no caller", () => {
    expect(
      hasRestrictingCondition({
        Bool: { "aws:SecureTransport": "true" },
      }),
    ).toBe(false);
  });

  test("does not hold anything with a negated test", () => {
    expect(
      hasRestrictingCondition({
        StringNotEquals: { "aws:SourceAccount": "123456789012" },
      }),
    ).toBe(false);
    expect(
      hasRestrictingCondition({
        NotIpAddress: { "aws:SourceIp": "203.0.113.0/24" },
      }),
    ).toBe(false);
  });

  test("does not hold anything with a Null test", () => {
    expect(
      hasRestrictingCondition({
        Null: { "aws:SourceAccount": "false" },
      }),
    ).toBe(false);
  });

  test("does not hold anything with a test a request without the key passes", () => {
    expect(
      hasRestrictingCondition({
        StringEqualsIfExists: { "aws:SourceAccount": "123456789012" },
      }),
    ).toBe(false);
  });

  test("does not hold anything with a test an empty set passes", () => {
    expect(
      hasRestrictingCondition({
        "ForAllValues:StringEquals": { "aws:PrincipalOrgPaths": "o-a/r-b/" },
      }),
    ).toBe(false);
  });

  test("holds a grant with a test any value of a set must pass", () => {
    expect(
      hasRestrictingCondition({
        "ForAnyValue:StringEquals": { "aws:PrincipalOrgPaths": "o-a/r-b/" },
      }),
    ).toBe(true);
  });

  test("does not hold anything with a wildcard or variable value", () => {
    expect(
      hasRestrictingCondition({
        StringLike: { "aws:PrincipalArn": "arn:aws:iam::*:role/*" },
      }),
    ).toBe(false);
    expect(
      hasRestrictingCondition({
        StringEquals: { "aws:userid": ["AIDAEXAMPLE", "${aws:userid}"] },
      }),
    ).toBe(false);
  });

  test("does not hold anything with no values", () => {
    expect(
      hasRestrictingCondition({
        StringEquals: { "aws:SourceAccount": [] },
      }),
    ).toBe(false);
  });

  test("does not hold anything with a source address range that lets most of the internet in", () => {
    expect(
      hasRestrictingCondition({
        IpAddress: { "aws:SourceIp": ["203.0.113.0/24", "0.0.0.0/0"] },
      }),
    ).toBe(false);
  });

  test("holds a grant when any one test restricts it", () => {
    expect(
      hasRestrictingCondition({
        StringNotEquals: { "aws:SourceAccount": "123456789012" },
        Bool: { "aws:SecureTransport": "true" },
        StringEquals: { "aws:SourceVpc": "vpc-1a2b3c4d" },
      }),
    ).toBe(true);
  });

  test("ignores a test whose block is not an object", () => {
    expect(
      hasRestrictingCondition({
        StringEquals: "aws:SourceAccount",
      }),
    ).toBe(false);
  });
});

describe("readPrincipals", () => {
  test("Principal * is the public", () => {
    expect(readPrincipals({ Principal: "*" })).toEqual([
      { kind: "public", value: "*" },
    ]);
  });

  test("an AWS * is the public", () => {
    expect(readPrincipals({ Principal: { AWS: "*" } })).toEqual([
      { kind: "public", value: "*" },
    ]);
  });

  test("a NotPrincipal is open to everyone but those it names", () => {
    expect(
      readPrincipals({
        NotPrincipal: { AWS: "arn:aws:iam::123456789012:root" },
      }),
    ).toEqual([{ kind: "public", value: "*" }]);
  });

  test("reads each kind of named principal, single or listed", () => {
    expect(
      readPrincipals({
        Principal: {
          AWS: ["arn:aws:iam::123456789012:role/reader", "210987654321"],
          Service: "cloudtrail.amazonaws.com",
          CanonicalUser: "79a59df900b949e55d96a1e698fbaced",
          Federated: "cognito-identity.amazonaws.com",
        },
      }),
    ).toEqual([
      { kind: "AWS", value: "arn:aws:iam::123456789012:role/reader" },
      { kind: "AWS", value: "210987654321" },
      { kind: "Service", value: "cloudtrail.amazonaws.com" },
      { kind: "CanonicalUser", value: "79a59df900b949e55d96a1e698fbaced" },
      { kind: "Federated", value: "cognito-identity.amazonaws.com" },
    ]);
  });

  test("ignores kinds it does not know", () => {
    expect(readPrincipals({ Principal: { Unknown: "x" } })).toEqual([]);
  });

  test("is none for a statement without a principal", () => {
    expect(readPrincipals({})).toEqual([]);
    expect(
      readPrincipals({ Principal: "arn:aws:iam::123456789012:root" }),
    ).toEqual([]);
  });
});

describe("describePrincipal", () => {
  function describeAws(value: string): ReturnType<typeof describePrincipal> {
    const principal: PolicyPrincipal = { kind: "AWS", value };
    return describePrincipal(principal);
  }

  test("a service is a service", () => {
    expect(
      describePrincipal({ kind: "Service", value: "logs.amazonaws.com" }),
    ).toEqual({
      principal: "logs.amazonaws.com",
      principalType: DataStorePrincipalType.Service,
      accountId: "",
    });
  });

  test("a canonical user is an account", () => {
    expect(
      describePrincipal({ kind: "CanonicalUser", value: "79a59df9" }),
    ).toEqual({
      principal: "79a59df9",
      principalType: DataStorePrincipalType.Account,
      accountId: "",
    });
  });

  test("a bare account id is that account", () => {
    expect(describeAws("123456789012")).toEqual({
      principal: "123456789012",
      principalType: DataStorePrincipalType.Account,
      accountId: "123456789012",
    });
  });

  test("an account's root is that account", () => {
    expect(describeAws("arn:aws:iam::123456789012:root")).toEqual({
      principal: "arn:aws:iam::123456789012:root",
      principalName: "123456789012",
      principalType: DataStorePrincipalType.Account,
      accountId: "123456789012",
    });
  });

  test("a role is a role, named by its last path segment", () => {
    expect(describeAws("arn:aws:iam::123456789012:role/team/reader")).toEqual({
      principal: "arn:aws:iam::123456789012:role/team/reader",
      principalName: "reader",
      principalType: DataStorePrincipalType.Role,
      accountId: "123456789012",
    });
  });

  test("a session of a role is that role", () => {
    expect(
      describeAws("arn:aws:sts::123456789012:assumed-role/reader/session-1"),
    ).toEqual({
      principal: "arn:aws:sts::123456789012:assumed-role/reader/session-1",
      principalName: "reader",
      principalType: DataStorePrincipalType.Role,
      accountId: "123456789012",
    });
  });

  test("a user or a federated user is a user", () => {
    expect(describeAws("arn:aws:iam::123456789012:user/alex")).toEqual({
      principal: "arn:aws:iam::123456789012:user/alex",
      principalName: "alex",
      principalType: DataStorePrincipalType.User,
      accountId: "123456789012",
    });
    expect(
      describeAws("arn:aws:sts::123456789012:federated-user/sam"),
    ).toMatchObject({
      principalName: "sam",
      principalType: DataStorePrincipalType.User,
      accountId: "123456789012",
    });
  });

  test("an AWS-owned principal is a service", () => {
    expect(
      describeAws(
        "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E2QWRUHAPOMQZL",
      ),
    ).toEqual({
      principal:
        "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E2QWRUHAPOMQZL",
      principalName: "CloudFront Origin Access Identity E2QWRUHAPOMQZL",
      principalType: DataStorePrincipalType.Service,
      accountId: "",
    });
  });

  test("a deleted user, shown by its unique id, is a user", () => {
    expect(describeAws("AIDAJQABLZS4A3QDU576Q")).toEqual({
      principal: "AIDAJQABLZS4A3QDU576Q",
      principalType: DataStorePrincipalType.User,
      accountId: "",
    });
  });

  test("a deleted role, shown by its unique id, is a role", () => {
    expect(describeAws("AROADBQP57FF2AEXAMPLE")).toEqual({
      principal: "AROADBQP57FF2AEXAMPLE",
      principalType: DataStorePrincipalType.Role,
      accountId: "",
    });
  });
});
