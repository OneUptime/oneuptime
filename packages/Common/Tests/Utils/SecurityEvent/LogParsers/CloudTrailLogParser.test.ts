import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import CloudTrailLogParser, {
  isSecurityRelevantCloudTrailRecord,
  readCloudTrailActor,
} from "../../../../Utils/SecurityEvent/LogParsers/CloudTrailLogParser";
import { cloudTrailRecord, logLine } from "./LogParserFixtures";

function parse(document: JSONObject): Array<NormalizedSecurityEvent> {
  return CloudTrailLogParser.parse(logLine(JSON.stringify(document)));
}

const CONSOLE_LOGIN_WITHOUT_MFA: JSONObject = cloudTrailRecord({
  eventSource: "signin.amazonaws.com",
  eventName: "ConsoleLogin",
  readOnly: undefined,
  responseElements: { ConsoleLogin: "Success" },
  additionalEventData: {
    MFAUsed: "No",
    LoginTo: "https://console.aws.amazon.com/",
  },
  eventType: "AwsConsoleSignIn",
});

/*
 * CloudTrail records most of what AWS does on its own; only what a
 * security team looks at becomes an event - errors, console sign-ins, the
 * root user and changes a person or a workload made - with the record kept
 * as attributes for the rule library's CloudTrail rules.
 */
describe("CloudTrailLogParser", () => {
  test("an access key created is an API Activity event about the caller", () => {
    const events: Array<NormalizedSecurityEvent> = parse(cloudTrailRecord({}));

    expect(events).toHaveLength(1);

    const event: NormalizedSecurityEvent = events[0]!;

    expect(event.classUid).toBe(6003);
    expect(event.className).toBe("API Activity");
    expect(event.activityName).toBe("CreateAccessKey");
    expect(event.statusName).toBe("Success");
    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(event.principalUser).toBe("arn:aws:iam::111122223333:user/alice");
    expect(event.principalIp).toBe("198.51.100.30");
    expect(event.targetHost).toBe("111122223333");
    expect(event.targetResource).toBe("iam.amazonaws.com CreateAccessKey");
    expect(event.message).toBe(
      "arn:aws:iam::111122223333:user/alice called CreateAccessKey on iam.amazonaws.com",
    );
    expect(event.vendorName).toBe("AWS");
    expect(event.productName).toBe("AWS CloudTrail");
    expect(event.eventUid).toBe(
      "cloudtrail:8f1c2e3d-0000-0000-0000-000000000001",
    );
    expect(event.time.toISOString()).toBe("2026-10-19T09:58:00.000Z");
    expect(event.attributes["eventSource"]).toBe("iam.amazonaws.com");
    expect(event.attributes["eventName"]).toBe("CreateAccessKey");
    expect(event.attributes["userIdentity.type"]).toBe("IAMUser");
  });

  test("a console sign-in is an Authentication event, with what the MFA rule reads", () => {
    const event: NormalizedSecurityEvent = parse(CONSOLE_LOGIN_WITHOUT_MFA)[0]!;

    expect(event.className).toBe("Authentication");
    expect(event.activityName).toBe("Logon");
    expect(event.statusName).toBe("Success");
    expect(event.message).toBe(
      "AWS console sign-in for arn:aws:iam::111122223333:user/alice from 198.51.100.30",
    );
    expect(event.attributes["additionalEventData.MFAUsed"]).toBe("No");
    expect(event.attributes["responseElements.ConsoleLogin"]).toBe("Success");
  });

  test("a failed console sign-in is a Low failure", () => {
    const event: NormalizedSecurityEvent = parse(
      cloudTrailRecord({
        eventSource: "signin.amazonaws.com",
        eventName: "ConsoleLogin",
        responseElements: { ConsoleLogin: "Failure" },
        errorMessage: "Failed authentication",
      }),
    )[0]!;

    expect(event.statusName).toBe("Failure");
    expect(event.severityName).toBe(OcsfSeverity.Low);
    expect(event.message.startsWith("Failed AWS console sign-in")).toBe(true);
  });

  test("a refused call is a failure even when it only read", () => {
    const event: NormalizedSecurityEvent = parse(
      cloudTrailRecord({
        eventSource: "ec2.amazonaws.com",
        eventName: "DescribeInstances",
        readOnly: true,
        errorCode: "Client.UnauthorizedOperation",
      }),
    )[0]!;

    expect(event.statusName).toBe("Failure");
    expect(event.message).toBe(
      "arn:aws:iam::111122223333:user/alice called DescribeInstances on ec2.amazonaws.com (Client.UnauthorizedOperation)",
    );
    expect(event.attributes["errorCode"]).toBe("Client.UnauthorizedOperation");
  });

  test("a call from inside AWS names the service as the host, not an address", () => {
    const event: NormalizedSecurityEvent = parse(
      cloudTrailRecord({ sourceIPAddress: "cloudformation.amazonaws.com" }),
    )[0]!;

    expect(event.principalIp).toBe("");
    expect(event.principalHost).toBe("cloudformation.amazonaws.com");
  });

  test.each<[string, JSONObject, boolean]>([
    ["a change by a person", cloudTrailRecord({}), true],
    [
      "a read",
      cloudTrailRecord({ eventName: "ListUsers", readOnly: true }),
      false,
    ],
    [
      "a read refused",
      cloudTrailRecord({
        eventName: "ListUsers",
        readOnly: true,
        errorCode: "AccessDenied",
      }),
      true,
    ],
    ["a console sign-in", CONSOLE_LOGIN_WITHOUT_MFA, true],
    [
      "anything the root user does",
      cloudTrailRecord({
        readOnly: true,
        userIdentity: { type: "Root", arn: "arn:aws:iam::111122223333:root" },
      }),
      true,
    ],
    [
      "a service acting for itself",
      cloudTrailRecord({
        userIdentity: {
          type: "AWSService",
          invokedBy: "autoscaling.amazonaws.com",
        },
      }),
      false,
    ],
    [
      "a call a service made for someone",
      cloudTrailRecord({
        userIdentity: {
          type: "AssumedRole",
          invokedBy: "cloudformation.amazonaws.com",
        },
      }),
      false,
    ],
    [
      "a data event that worked",
      cloudTrailRecord({
        eventSource: "s3.amazonaws.com",
        eventName: "GetObject",
        eventCategory: "Data",
      }),
      false,
    ],
    [
      "a data event that was refused",
      cloudTrailRecord({
        eventSource: "s3.amazonaws.com",
        eventName: "GetObject",
        eventCategory: "Data",
        errorCode: "AccessDenied",
      }),
      true,
    ],
    [
      "a record that does not say whether it changed anything",
      cloudTrailRecord({ readOnly: undefined }),
      false,
    ],
    ["readOnly written as text", cloudTrailRecord({ readOnly: "false" }), true],
  ])("%s -> kept: %s", (_name: string, record: JSONObject, kept: boolean) => {
    expect(isSecurityRelevantCloudTrailRecord(record)).toBe(kept);
    expect(parse(record).length > 0).toBe(kept);
  });

  test("a CloudTrail file of records gives one event per record worth keeping", () => {
    const events: Array<NormalizedSecurityEvent> = parse({
      Records: [
        cloudTrailRecord({ eventID: "a" }),
        cloudTrailRecord({
          eventID: "b",
          eventName: "ListUsers",
          readOnly: true,
        }),
        cloudTrailRecord({
          eventID: "c",
          eventSource: "cloudtrail.amazonaws.com",
          eventName: "StopLogging",
        }),
      ],
    });

    expect(
      events.map((event: NormalizedSecurityEvent): string => {
        return event.eventUid;
      }),
    ).toEqual(["cloudtrail:a", "cloudtrail:c"]);
  });

  test("a record without an event ID is named after its log record and place", () => {
    const events: Array<NormalizedSecurityEvent> = CloudTrailLogParser.parse(
      logLine(
        JSON.stringify({ Records: [cloudTrailRecord({ eventID: undefined })] }),
        {},
        "0192f1a0-0000-7000-8000-0000000000ff",
      ),
    );

    expect(events[0]!.eventUid).toBe(
      "log:0192f1a0-0000-7000-8000-0000000000ff:0",
    );
  });

  test("who made a call, in the order a person would name them", () => {
    expect(readCloudTrailActor(cloudTrailRecord({}))).toBe(
      "arn:aws:iam::111122223333:user/alice",
    );
    expect(readCloudTrailActor({ userIdentity: { userName: "bob" } })).toBe(
      "bob",
    );
    expect(
      readCloudTrailActor({
        userIdentity: {
          sessionContext: { sessionIssuer: { userName: "deploy-role" } },
        },
      }),
    ).toBe("deploy-role");
    expect(
      readCloudTrailActor({ userIdentity: { principalId: "AROAEXAMPLE:x" } }),
    ).toBe("AROAEXAMPLE:x");
  });

  test("lines that are not CloudTrail are no event", () => {
    for (const body of [
      "",
      "eventSource but not json",
      JSON.stringify({ eventSource: "x" }),
      JSON.stringify({ Records: "not a list" }),
      JSON.stringify({ Records: [1, "two", null] }),
      `{"eventSource":"iam.amazonaws.com"`,
    ]) {
      expect(CloudTrailLogParser.parse(logLine(body))).toEqual([]);
    }
  });
});
