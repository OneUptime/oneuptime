import { describe, expect, test } from "@jest/globals";
import {
  AwsRefusalCause,
  awsErrorMessageOf,
  awsRefusalCauseOf,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsApi";

/*
 * Why AWS refused a call, read from its access-denied message (#10427):
 * the wording is AWS's own, from "Troubleshoot access denied error
 * messages" (IAM User Guide) and "Troubleshoot access denied (403
 * Forbidden) errors in Amazon S3". Only two causes are told apart - the
 * caller's own policies never allow the action, and the resource's own
 * policy refuses it - because only they say what else would be refused;
 * every other cause, and a message with none, is Unknown.
 */

const ROLE: string =
  "arn:aws:sts::123456789012:assumed-role/OneUptimeReadOnly-5f3a9c1e/OneUptime-33333333333343338333333333333333";

// S3's XML error, as S3 writes it.
function s3Body(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>${message}</Message><RequestId>4442587FB7D0A2F9</RequestId><HostId>x</HostId></Error>`;
}

// The Query protocol's error (RDS, Redshift, STS), as those services write it.
function queryBody(message: string): string {
  return `<ErrorResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/"><Error><Type>Sender</Type><Code>AccessDenied</Code><Message>${message}</Message></Error><RequestId>1</RequestId></ErrorResponse>`;
}

describe("awsErrorMessageOf", () => {
  test("reads XML's <Message>, decoding its entities", () => {
    expect(
      awsErrorMessageOf(
        s3Body(
          "User: a is not authorized to perform: s3:GetBucketAcl on resource: &quot;arn:aws:s3:::b&quot;",
        ),
      ),
    ).toBe(
      'User: a is not authorized to perform: s3:GetBucketAcl on resource: "arn:aws:s3:::b"',
    );
  });

  test("reads JSON's message, in either case AWS writes it", () => {
    expect(
      awsErrorMessageOf(
        JSON.stringify({ __type: "AccessDeniedException", message: "lower" }),
      ),
    ).toBe("lower");
    expect(
      awsErrorMessageOf(
        JSON.stringify({ __type: "AccessDeniedException", Message: "upper" }),
      ),
    ).toBe("upper");
  });

  test.each<[string, string]>([
    ["an empty body", ""],
    ["a JSON body with no message", '{"__type":"AccessDeniedException"}'],
    ["a JSON message that is not words", '{"message":42}'],
    ["a JSON list", "[1,2]"],
    ["broken JSON", '{"message":'],
    ["XML with no message", "<Error><Code>AccessDenied</Code></Error>"],
  ])("is empty for %s", (_case: string, body: string) => {
    expect(awsErrorMessageOf(body)).toBe("");
  });
});

describe("awsRefusalCauseOf", () => {
  test.each<[string, string, AwsRefusalCause]>([
    [
      "no identity-based policy allows the action (S3)",
      s3Body(
        `User: ${ROLE} is not authorized to perform: s3:GetBucketPolicy on resource: "arn:aws:s3:::orders" because no identity-based policy allows the s3:GetBucketPolicy action`,
      ),
      AwsRefusalCause.NoIdentityPolicyAllows,
    ],
    [
      "no identity-based policy allows the action (RDS)",
      queryBody(
        `User: ${ROLE} is not authorized to perform: rds:DescribeDBSnapshotAttributes on resource: arn:aws:rds:us-east-1:123456789012:snapshot:nightly because no identity-based policy allows the rds:DescribeDBSnapshotAttributes action`,
      ),
      AwsRefusalCause.NoIdentityPolicyAllows,
    ],
    [
      "no identity-based policy allows the action (DynamoDB's JSON)",
      JSON.stringify({
        __type: "com.amazon.coral.service#AccessDeniedException",
        Message: `User: ${ROLE} is not authorized to perform: dynamodb:DescribeContinuousBackups on resource: arn:aws:dynamodb:us-east-1:123456789012:table/sessions because no identity-based policy allows the dynamodb:DescribeContinuousBackups action`,
      }),
      AwsRefusalCause.NoIdentityPolicyAllows,
    ],
    [
      "an explicit deny in the bucket's own policy",
      s3Body(
        `User: ${ROLE} is not authorized to perform: s3:GetBucketPolicy on resource: "arn:aws:s3:::vpc-only" with an explicit deny in a resource-based policy`,
      ),
      AwsRefusalCause.ResourcePolicy,
    ],
    [
      "no resource-based policy allows the action",
      s3Body(
        `User: ${ROLE} is not authorized to perform: s3:GetObject because no resource-based policy allows the s3:GetObject action`,
      ),
      AwsRefusalCause.ResourcePolicy,
    ],
    [
      "an explicit deny in a service control policy",
      s3Body(
        `User: ${ROLE} is not authorized to perform: s3:GetObject with an explicit deny in a service control policy, with policy ARN: arn:aws:organizations::777788889999:policy/o-exampleorgid/service_control_policy/p-examplepolicyid`,
      ),
      AwsRefusalCause.Unknown,
    ],
    [
      "no service control policy allows the action",
      queryBody(
        `User: ${ROLE} is not authorized to perform: rds:DescribeDBInstances because no service control policy allows the rds:DescribeDBInstances action`,
      ),
      AwsRefusalCause.Unknown,
    ],
    [
      "an explicit deny in a resource control policy - the organization's, not the resource's own",
      s3Body(
        `User: ${ROLE} is not authorized to perform: s3:GetObject on resource: "arn:aws:s3:::b/o" with an explicit deny in a resource control policy, with policy ARN: arn:aws:organizations::777788889999:policy/o-exampleorgid/resource_control_policy/p-examplepolicyid`,
      ),
      AwsRefusalCause.Unknown,
    ],
    [
      "an explicit deny in the caller's own policy, which may name some resources only",
      s3Body(
        `User: ${ROLE} is not authorized to perform: s3:GetObject on resource: "arn:aws:s3:::b/o" with an explicit deny in an identity-based policy, with policy ARN: arn:aws:iam::123456789012:policy/ExampleIdentityBasedPolicy`,
      ),
      AwsRefusalCause.Unknown,
    ],
    [
      "a permissions boundary",
      s3Body(
        `User: ${ROLE} is not authorized to perform: s3:GetObject on resource: "arn:aws:s3:::b/o" because no permissions boundary allows the s3:GetObject action`,
      ),
      AwsRefusalCause.Unknown,
    ],
    [
      "a session policy",
      s3Body(
        `User: ${ROLE} is not authorized to perform: s3:GetObject because no session policy allows the s3:GetObject action`,
      ),
      AwsRefusalCause.Unknown,
    ],
    [
      "a VPC endpoint policy",
      s3Body(
        `User: ${ROLE} is not authorized to perform: s3:GetObject on resource: "arn:aws:s3:::b/o" with an explicit deny in a VPC endpoint policy`,
      ),
      AwsRefusalCause.Unknown,
    ],
    [
      "S3's bare Access Denied, as it answers across accounts",
      s3Body("Access Denied"),
      AwsRefusalCause.Unknown,
    ],
    ["no body at all", "", AwsRefusalCause.Unknown],
  ])("%s", (_case: string, body: string, cause: AwsRefusalCause) => {
    expect(awsRefusalCauseOf(body)).toBe(cause);
  });

  test("reads the message however it is wrapped or cased", () => {
    expect(
      awsRefusalCauseOf(
        s3Body(
          `User: ${ROLE} is not authorized to perform:\n s3:GetObject BECAUSE NO IDENTITY-BASED\tPOLICY ALLOWS the s3:GetObject action`,
        ),
      ),
    ).toBe(AwsRefusalCause.NoIdentityPolicyAllows);
  });

  test("a resource named like a cause is not taken for one: only AWS's words count", () => {
    // The phrase in a bucket's name, not AWS's reason: a bare refusal.
    expect(awsRefusalCauseOf(s3Body("Access Denied"))).toBe(
      AwsRefusalCause.Unknown,
    );
    expect(
      awsRefusalCauseOf(
        "<Error><Code>AccessDenied</Code><Resource>because no identity-based policy allows</Resource></Error>",
      ),
    ).toBe(AwsRefusalCause.Unknown);
  });
});
