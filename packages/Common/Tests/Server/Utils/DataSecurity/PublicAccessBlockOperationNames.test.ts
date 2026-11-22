import { describe, expect, test } from "@jest/globals";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { readAwsTrailEvent } from "../../../../Server/Utils/CloudConnection/Aws/AwsChanges";
import { CloudChange } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  PostureChange,
  buildDataStoreChangeEvent,
  getPostureChangeOperations,
} from "../../../../Server/Utils/DataSecurity/DataSecurityChangeSignals";
import { POSTURE_CHANGING_OPERATIONS } from "../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import {
  DATA_SECURITY_RESPONSE_ACTION_AWS_OPERATIONS,
  DataSecurityResponseAction,
} from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { DATA_STORE_PUBLIC_ACCESS_OPERATIONS } from "../../../../Types/SecurityEvent/DataSecuritySignal";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  DETECTION_RULE_LIBRARY_UPGRADES,
  DetectionRuleLibraryUpgrade,
} from "../../../../Types/SecurityEvent/DetectionRuleLibraryUpgrades";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { sigmaRuleMatchesEvent } from "../../../Utils/SecurityEvent/LogParsers/SigmaTestMatcher";

/*
 * A PUBLIC ACCESS BLOCK TAKEN OFF, BY THE NAME CLOUDTRAIL GIVES IT (found
 * while fixing #10428). S3's API calls a bucket's block PutPublicAccessBlock
 * and DeletePublicAccessBlock, but CloudTrail records them as
 * PutBucketPublicAccessBlock and DeleteBucketPublicAccessBlock ("Amazon S3
 * CloudTrail events", S3 User Guide), and a cloud change keeps CloudTrail's
 * name. So "A sensitive bucket was made public" never fired on a block
 * taken off, Data Security never wrote the change as a security event, and
 * never read the bucket again when its block changed. Each now reads
 * CloudTrail's name, and the projects that added the rule before get the
 * fix.
 */

const ACCOUNT: string = "111122223333";
const RULE_ID: string = "7c8121cd-87ff-4e1c-bd5e-b1c3ab130737";

// A bucket's public access block taken off, as CloudTrail records the call.
function removedBlockRecord(eventName: string): JSONObject {
  return {
    eventVersion: "1.09",
    userIdentity: {
      type: "IAMUser",
      principalId: "AIDA2ALICEEXAMPLE001",
      arn: `arn:aws:iam::${ACCOUNT}:user/alice`,
      accountId: ACCOUNT,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      userName: "alice",
    },
    eventTime: "2026-11-20T12:00:00Z",
    eventSource: "s3.amazonaws.com",
    eventName,
    awsRegion: "us-east-1",
    sourceIPAddress: "198.51.100.77",
    userAgent: "aws-cli/2.17.20",
    requestParameters: {
      bucketName: "orders-exports",
      Host: "orders-exports.s3.us-east-1.amazonaws.com",
      publicAccessBlock: "",
    },
    responseElements: null,
    requestID: "8C9F4E5B1A2D0101",
    eventID: "6e1b2c3d-4f50-4a61-8b72-9c3d4e5f0101",
    readOnly: false,
    resources: [
      {
        accountId: ACCOUNT,
        type: "AWS::S3::Bucket",
        ARN: "arn:aws:s3:::orders-exports",
      },
    ],
    eventType: "AwsApiCall",
    managementEvent: true,
    recipientAccountId: ACCOUNT,
    eventCategory: "Management",
  };
}

// The record as LookupEvents lists it, read as a connection's read of changes reads it.
function changeOf(record: JSONObject): CloudChange {
  return readAwsTrailEvent({
    event: {
      EventId: record["eventID"],
      EventName: record["eventName"],
      EventSource: record["eventSource"],
      EventTime: new Date(String(record["eventTime"])).getTime() / 1000,
      Username: "alice",
      Resources: [
        { ResourceType: "AWS::S3::Bucket", ResourceName: "orders-exports" },
      ],
      CloudTrailEvent: JSON.stringify(record),
    },
    accountId: ACCOUNT,
    region: "us-east-1",
  })!;
}

function sensitiveBucket(): DataStore {
  const model: DataStore = new DataStore();
  model._id = ObjectID.generate().toString();
  model.name = "orders-exports";
  model.kind = DataStoreKind.AwsS3Bucket;
  model.storeKey = `cloud:aws:${DataStoreKind.AwsS3Bucket}:arn:aws:s3:::orders-exports`;
  model.providerResourceId = "arn:aws:s3:::orders-exports";
  model.cloudAccountNumber = ACCOUNT;
  model.sensitivity = DataSensitivity.Restricted;
  return model;
}

function eventOf(change: CloudChange): NormalizedSecurityEvent {
  const posture: PostureChange = {
    time: change.time,
    operation: change.operation,
    actor: change.actor,
    provider: "aws",
    accountId: change.accountId,
    region: change.region,
    providerResourceId: change.resources[0]!.id,
    cloudResourceId: "",
    eventId: change.eventId,
    failed: change.failed,
    madeByOneUptime: false,
  };

  return buildDataStoreChangeEvent({
    change: posture,
    store: sensitiveBucket(),
    sensitivity: DataSensitivity.Restricted,
    recordedAt: new Date("2026-11-20T12:05:00Z"),
  });
}

function rule(): SigmaRule {
  return SigmaRuleParser.parse(
    getDetectionRuleLibraryEntry(RULE_ID)!.sigmaRuleYaml,
  );
}

describe("a bucket's public access block taken off", () => {
  test("is s3:DeleteBucketPublicAccessBlock once CloudTrail records it", () => {
    expect(
      changeOf(removedBlockRecord("DeleteBucketPublicAccessBlock")).operation,
    ).toBe("s3:DeleteBucketPublicAccessBlock");
  });

  test("is read as a change to a store's exposure, and makes Data Security read the bucket again", () => {
    expect(getPostureChangeOperations()).toContain(
      "s3:DeleteBucketPublicAccessBlock",
    );
    expect(POSTURE_CHANGING_OPERATIONS).toContain(
      "s3:DeleteBucketPublicAccessBlock",
    );
    expect(DATA_STORE_PUBLIC_ACCESS_OPERATIONS).toContain(
      "s3:DeleteBucketPublicAccessBlock",
    );
  });

  test("on a sensitive bucket, it opens A sensitive bucket was made public", () => {
    const event: NormalizedSecurityEvent = eventOf(
      changeOf(removedBlockRecord("DeleteBucketPublicAccessBlock")),
    );

    expect(sigmaRuleMatchesEvent(rule(), event)).toBe(true);
    // Collection from cloud storage, as a policy or ACL that opens a bucket is.
    expect(event.mitreTechniques).toEqual(["T1530"]);
  });

  test("a block put back on - Block public access, too - makes Data Security read the bucket again, and opens nothing", () => {
    const put: CloudChange = changeOf(
      removedBlockRecord("PutBucketPublicAccessBlock"),
    );

    expect(put.operation).toBe("s3:PutBucketPublicAccessBlock");
    expect(POSTURE_CHANGING_OPERATIONS).toContain(put.operation);
    expect(
      DATA_SECURITY_RESPONSE_ACTION_AWS_OPERATIONS[
        DataSecurityResponseAction.BlockPublicAccess
      ],
    ).toEqual([put.operation]);
    expect(sigmaRuleMatchesEvent(rule(), eventOf(put))).toBe(false);
  });

  test("no name S3's API uses but CloudTrail never records is read anywhere", () => {
    const read: Array<string> = [
      ...POSTURE_CHANGING_OPERATIONS,
      ...DATA_STORE_PUBLIC_ACCESS_OPERATIONS,
      ...getPostureChangeOperations(),
    ];

    for (const apiName of [
      "s3:DeletePublicAccessBlock",
      "s3:PutPublicAccessBlock",
    ]) {
      expect(read).not.toContain(apiName);

      for (const entry of DETECTION_RULE_LIBRARY) {
        expect({
          rule: entry.title,
          names: entry.sigmaRuleYaml.includes(apiName),
        }).toEqual({
          rule: entry.title,
          names: false,
        });
      }
    }
  });
});

describe("the projects that added the rule before", () => {
  test("get the fix: the copy as added is an upgrade of the library's, differing by the operation's name alone", () => {
    const upgrade: DetectionRuleLibraryUpgrade | undefined =
      DETECTION_RULE_LIBRARY_UPGRADES.find(
        (candidate: DetectionRuleLibraryUpgrade): boolean => {
          return candidate.id === RULE_ID;
        },
      );
    const entry: DetectionRuleLibraryEntry =
      getDetectionRuleLibraryEntry(RULE_ID)!;

    expect(upgrade).toBeDefined();
    expect(upgrade!.previousDescription).toBe(entry.description);
    expect(
      upgrade!.previousSigmaRuleYaml
        .split("s3:DeletePublicAccessBlock")
        .join("s3:DeleteBucketPublicAccessBlock"),
    ).toBe(entry.sigmaRuleYaml);
  });
});
