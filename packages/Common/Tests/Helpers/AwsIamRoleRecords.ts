import { JSONObject } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityCaseEventSnapshot,
  buildSecurityCaseEventSnapshot,
} from "../../Types/SecurityCase/SecurityCaseEventEvidence";
import CloudTrailLogParser from "../../Utils/SecurityEvent/LogParsers/CloudTrailLogParser";

/*
 * AN ATTACK'S IAM ROLE CHANGES AS AWS RECORDS AND ANSWERS THEM (#11038),
 * from AWS's own documentation, for the tests of the step "Undo what
 * changed on the account":
 *
 *   - CloudTrail: the CloudTrail User Guide's CreateRole record ("CloudTrail
 *     log file examples", IAM log examples), word for word. AWS documents no
 *     record of the other three calls, so each is that record's envelope
 *     with the call's name and the IAM API Reference's own sample request
 *     as its requestParameters - CloudTrail writes a call's parameters
 *     there, named in camelCase, and records no responseElements for these
 *     three (they answer nothing but a request id).
 *   - IAM's Query API: the IAM API Reference's sample responses of GetRole,
 *     ListAttachedRolePolicies and ListRolePolicies, word for word, and
 *     answers of the same shape for the roles a test sets up - a trust
 *     policy URL-encoded, as GetRole's reference says it is written.
 *
 * AWS's pages write a run of tabs and spaces after a policy's "Version",
 * kept here as they have it.
 */

export const AWS_DOCS_GAP: string = "\t\t \t \t ";

// ---------- CloudTrail ----------

// The CloudTrail User Guide's CreateRole record: Saanvi made TestRole, trusting EC2.
export const CREATE_ROLE_RECORD: JSONObject = {
  eventVersion: "1.08",
  userIdentity: {
    type: "IAMUser",
    principalId: "AIDA6ON6E4XEGITEXAMPLE",
    arn: "arn:aws:iam::777777777777:user/Saanvi",
    accountId: "777777777777",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    userName: "Saanvi",
    sessionContext: {
      sessionIssuer: {},
      webIdFederationData: {},
      attributes: {
        creationDate: "2023-07-19T21:11:57Z",
        mfaAuthenticated: "false",
      },
    },
  },
  eventTime: "2023-07-19T21:29:12Z",
  eventSource: "iam.amazonaws.com",
  eventName: "CreateRole",
  awsRegion: "us-east-1",
  sourceIPAddress: "192.0.2.0",
  userAgent:
    "aws-cli/2.13.5 Python/3.11.4 Linux/4.14.255-314-253.539.amzn2.x86_64 exec-env/CloudShell exe/x86_64.amzn.2 prompt/off command/iam.create-role",
  requestParameters: {
    roleName: "TestRole",
    description: "Allows EC2 instances to call AWS services on your behalf.",
    assumeRolePolicyDocument: `{"Version":"2012-10-17",${AWS_DOCS_GAP}"Statement":[{"Effect":"Allow","Action":["sts:AssumeRole"],"Principal":{"Service":["ec2.amazonaws.com"]}}]}`,
  },
  responseElements: {
    role: {
      assumeRolePolicyDocument: "{{policy-statement}}",
      arn: "arn:aws:iam::777777777777:role/TestRole",
      roleId: "AROA6ON6E4XEFFEXAMPLE",
      createDate: "Jul 19, 2023 9:29:12 PM",
      roleName: "TestRole",
      path: "/",
    },
  },
  requestID: "ff38f36e-ebd3-425b-9939-EXAMPLE1bbe",
  eventID: "9da77cd0-493f-4c89-8852-EXAMPLEa887c",
  readOnly: false,
  eventType: "AwsApiCall",
  managementEvent: true,
  recipientAccountId: "777777777777",
  eventCategory: "Management",
  tlsDetails: {
    tlsVersion: "TLSv1.2",
    cipherSuite: "ECDHE-RSA-AES128-GCM-SHA256",
    clientProvidedHostHeader: "iam.amazonaws.com",
  },
  sessionCredentialFromConsole: "true",
};

// The account the recorded calls were made in.
export const RECORDED_ACCOUNT: string = "777777777777";

/*
 * Another IAM call, recorded as CloudTrail records CreateRole: its name,
 * its parameters, an event id of its own, and no response elements.
 */
export function recordedRoleCall(data: {
  eventName: string;
  requestParameters: JSONObject;
  eventID: string;
  eventTime?: string | undefined;
  errorCode?: string | undefined;
}): JSONObject {
  return {
    ...CREATE_ROLE_RECORD,
    eventName: data.eventName,
    eventTime: data.eventTime || CREATE_ROLE_RECORD["eventTime"],
    userAgent: `aws-cli/2.13.5 Python/3.11.4 Linux/4.14.255-314-253.539.amzn2.x86_64 exec-env/CloudShell exe/x86_64.amzn.2 prompt/off command/iam.${data.eventName}`,
    requestParameters: data.requestParameters,
    responseElements: null,
    eventID: data.eventID,
    ...(data.errorCode
      ? {
          errorCode: data.errorCode,
          errorMessage: `User: arn:aws:iam::777777777777:user/Saanvi is not authorized to perform: iam:${data.eventName}`,
        }
      : {}),
  };
}

// The IAM API Reference's UpdateAssumeRolePolicy sample request: EC2 may assume S3AccessForEC2Instances.
export const UPDATE_ASSUME_ROLE_POLICY_RECORD: JSONObject = recordedRoleCall({
  eventName: "UpdateAssumeRolePolicy",
  requestParameters: {
    policyDocument: `{"Version":"2012-10-17",${AWS_DOCS_GAP}"Statement":[{"Effect":"Allow",\n"Principal":{"Service":["ec2.amazonaws.com"]},"Action":["sts:AssumeRole"]}]}`,
    roleName: "S3AccessForEC2Instances",
  },
  eventID: "3b1e5c2d-6f0a-4b8e-9c7d-EXAMPLE30a11",
});

// The IAM API Reference's AttachRolePolicy sample request: ReadOnlyAccess on ReadOnlyRole.
export const ATTACH_ROLE_POLICY_RECORD: JSONObject = recordedRoleCall({
  eventName: "AttachRolePolicy",
  requestParameters: {
    policyArn: "arn:aws:iam::aws:policy/ReadOnlyAccess",
    roleName: "ReadOnlyRole",
  },
  eventID: "5d2f7a91-0b3c-4e6d-8a1f-EXAMPLE30a12",
});

// The IAM API Reference's PutRolePolicy sample request: S3AccessPolicy, s3:* on everything, in S3Access.
export const PUT_ROLE_POLICY_RECORD: JSONObject = recordedRoleCall({
  eventName: "PutRolePolicy",
  requestParameters: {
    roleName: "S3Access",
    policyName: "S3AccessPolicy",
    policyDocument: `{"Version":"2012-10-17",${AWS_DOCS_GAP}"Statement":{"Effect":"Allow","Action":"s3:*","Resource":"*"}}`,
  },
  eventID: "8e4a6c13-2d5f-4f70-b9e2-EXAMPLE30a13",
});

/*
 * A record as a case keeps it: read by OneUptime's own CloudTrail parser,
 * as Cloud audit logs and "Your logs" read one, then snapshot as the case's
 * detections keep their events.
 */
export function readRecordedEvent(
  record: JSONObject,
): SecurityCaseEventSnapshot {
  const events: Array<NormalizedSecurityEvent> = CloudTrailLogParser.parse({
    body: JSON.stringify(record),
    attributes: {},
    time: new Date("2026-11-17T21:00:00.000Z"),
  });

  if (events.length !== 1) {
    throw new Error(
      `CloudTrail's parser read ${events.length} events of the record`,
    );
  }

  return buildSecurityCaseEventSnapshot({
    event: events[0] as unknown as { [column: string]: unknown },
  });
}

// ---------- IAM's Query API ----------

// The IAM API Reference's GetRole sample response, word for word.
export const GET_ROLE_SAMPLE_RESPONSE: string = `<GetRoleResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
<GetRoleResult>
  <Role>
    <Path>/application_abc/component_xyz/</Path>
    <Arn>arn:aws:iam::123456789012:role/application_abc/component_xyz/S3Access</Arn>
    <RoleName>S3Access</RoleName>
    <AssumeRolePolicyDocument>
      {"Version":"2012-10-17",${AWS_DOCS_GAP}"Statement":[{"Effect":"Allow",
      "Principal":{"Service":["ec2.amazonaws.com"]},"Action":["sts:AssumeRole"]}]}
    </AssumeRolePolicyDocument>
    <CreateDate>2012-05-08T23:34:01Z</CreateDate>
    <RoleId>AROADBQP57FF2AEXAMPLE</RoleId>
    <RoleLastUsed>
      <LastUsedDate>2019-11-20T17:09:20Z</LastUsedDate>
      <Region>us-east-1</Region>
    </RoleLastUsed>
  </Role>
</GetRoleResult>
<ResponseMetadata>
  <RequestId>df37e965-9967-11e1-a4c3-270EXAMPLE04</RequestId>
</ResponseMetadata>
</GetRoleResponse>`;

// The IAM API Reference's ListAttachedRolePolicies sample response, word for word.
export const LIST_ATTACHED_ROLE_POLICIES_SAMPLE_RESPONSE: string = `<ListAttachedRolePoliciesResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
  <ListAttachedRolePoliciesResult>
    <AttachedPolicies>
      <member>
        <PolicyName>ReadOnlyAccess</PolicyName>
        <PolicyArn>arn:aws:iam::aws:policy/ReadOnlyAccess</PolicyArn>
      </member>
    </AttachedPolicies>
    <IsTruncated>false</IsTruncated>
  </ListAttachedRolePoliciesResult>
  <ResponseMetadata>
    <RequestId>9a3b490d-3ea5-11e4-9d0d-6f969EXAMPLE</RequestId>
  </ResponseMetadata>
</ListAttachedRolePoliciesResponse>`;

// The IAM API Reference's ListRolePolicies sample response, word for word.
export const LIST_ROLE_POLICIES_SAMPLE_RESPONSE: string = `<ListRolePoliciesResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
<ListRolePoliciesResult>
  <PolicyNames>
    <member>CloudwatchPutMetricPolicy</member>
    <member>S3AccessPolicy</member>
  </PolicyNames>
  <IsTruncated>false</IsTruncated>
</ListRolePoliciesResult>
<ResponseMetadata>
  <RequestId>8c7e1816-99f0-11e1-a4c3-27EXAMPLE804</RequestId>
</ResponseMetadata>
</ListRolePoliciesResponse>`;

// A role, answered as GetRole's sample answers: its trust policy URL-encoded, as GetRole writes it.
export function getRoleResponse(data: {
  accountId: string;
  roleName: string;
  roleId: string;
  trustPolicy: JSONObject | string;
}): string {
  const policy: string =
    typeof data.trustPolicy === "string"
      ? data.trustPolicy
      : JSON.stringify(data.trustPolicy);

  return `<GetRoleResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
<GetRoleResult>
  <Role>
    <Path>/</Path>
    <Arn>arn:aws:iam::${data.accountId}:role/${data.roleName}</Arn>
    <RoleName>${data.roleName}</RoleName>
    <AssumeRolePolicyDocument>${encodeURIComponent(policy)}</AssumeRolePolicyDocument>
    <CreateDate>2023-07-19T21:29:12Z</CreateDate>
    <RoleId>${data.roleId}</RoleId>
    <RoleLastUsed/>
  </Role>
</GetRoleResult>
<ResponseMetadata>
  <RequestId>df37e965-9967-11e1-a4c3-270EXAMPLE04</RequestId>
</ResponseMetadata>
</GetRoleResponse>`;
}

// IAM's error, as its Query API writes one: NoSuchEntity once a role is gone.
export function iamErrorBody(code: string, message: string): string {
  return `<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>4f2f7d33-89e7-4d8c-a3c5-EXAMPLE1f00</RequestId></ErrorResponse>`;
}
