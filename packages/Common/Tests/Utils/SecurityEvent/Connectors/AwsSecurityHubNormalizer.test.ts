import { describe, expect, test } from "@jest/globals";
import AwsSecurityHubNormalizer, {
  AWS_SECURITY_HUB_COMPLIANCE_CLASS_NAME,
  AWS_SECURITY_HUB_COMPLIANCE_CLASS_UID,
  AWS_SECURITY_HUB_DETECTION_CLASS_NAME,
  AWS_SECURITY_HUB_DETECTION_CLASS_UID,
  AWS_SECURITY_HUB_TACTIC_IDS,
} from "../../../../Utils/SecurityEvent/Connectors/AwsSecurityHubNormalizer";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { JSONObject } from "../../../../Types/JSON";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

/*
 * Fixtures are shaped like AWS Security Finding Format (ASFF) records as
 * GetFindings returns them: the GuardDuty example of the Security Hub
 * integration guide, a Security Hub control finding, and a partner-style
 * finding carrying the Network, Process, Malware and ThreatIntelIndicators
 * objects from the ASFF attribute reference.
 */

const definition: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.AwsSecurityHub,
  )!;

const GUARDDUTY_ID: string =
  "arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64/finding/46ba0ac2845071e23ccdeb2ae03bfdea";

// The GuardDuty integration guide's "typical finding", verbatim in substance.
function guardDutyFinding(): JSONObject {
  return {
    SchemaVersion: "2018-10-08",
    Id: GUARDDUTY_ID,
    ProductArn: "arn:aws:securityhub:us-east-1:product/aws/guardduty",
    GeneratorId:
      "arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64",
    AwsAccountId: "193043430472",
    Types: ["TTPs/Initial Access/UnauthorizedAccess:EC2-SSHBruteForce"],
    FirstObservedAt: "2020-08-22T09:15:57Z",
    LastObservedAt: "2020-09-30T11:56:49Z",
    CreatedAt: "2020-08-22T09:34:34.146Z",
    UpdatedAt: "2020-09-30T12:14:00.206Z",
    Severity: { Product: 2, Label: "MEDIUM", Normalized: 40 },
    Title:
      "199.241.229.197 is performing SSH brute force attacks against i-0c10c2c7863d1a356.",
    Description:
      "199.241.229.197 is performing SSH brute force attacks against i-0c10c2c7863d1a356. Brute force attacks are used to gain unauthorized access to your instance by guessing the SSH password.",
    SourceUrl:
      "https://us-east-1.console.aws.amazon.com/guardduty/home?region=us-east-1#/findings?macros=current&fId=46ba0ac2845071e23ccdeb2ae03bfdea",
    ProductFields: {
      "aws/guardduty/service/action/networkConnectionAction/remoteIpDetails/ipAddressV4":
        "199.241.229.197",
      "aws/guardduty/service/action/networkConnectionAction/localIpDetails/ipAddressV4":
        "172.31.43.6",
      "aws/guardduty/service/action/actionType": "NETWORK_CONNECTION",
      "aws/guardduty/service/count": "74",
      "aws/securityhub/ProductName": "GuardDuty",
      "aws/securityhub/CompanyName": "Amazon",
    },
    Resources: [
      {
        Type: "AwsEc2Instance",
        Id: "arn:aws:ec2:us-east-1:193043430472:instance/i-0c10c2c7863d1a356",
        Partition: "aws",
        Region: "us-east-1",
        Tags: { Name: "kubectl" },
        Details: {
          AwsEc2Instance: {
            Type: "t2.micro",
            ImageId: "ami-02354e95b39ca8dec",
            IpV4Addresses: ["18.234.130.16", "172.31.43.6"],
            VpcId: "vpc-a0c2d7c7",
            SubnetId: "subnet-4975b475",
            LaunchedAt: "2020-08-03T23:21:57Z",
          },
        },
      },
    ],
    WorkflowState: "NEW",
    Workflow: { Status: "NEW" },
    RecordState: "ACTIVE",
  };
}

// A Security Hub control finding (consolidated control findings on).
function controlFinding(): JSONObject {
  return {
    SchemaVersion: "2018-10-08",
    Id: "arn:aws:securityhub:eu-central-1:123456789012:security-control/iam.9/finding/ab6d6a26-a156-48f0-9403-115983e5a956",
    ProductArn: "arn:aws:securityhub:eu-central-1::product/aws/securityhub",
    ProductName: "Security Hub",
    CompanyName: "AWS",
    Region: "eu-central-1",
    GeneratorId: "security-control/IAM.9",
    AwsAccountId: "123456789012",
    Types: [
      "Software and Configuration Checks/Industry and Regulatory Standards",
    ],
    FirstObservedAt: "2026-09-10T02:11:09.501Z",
    LastObservedAt: "2026-09-12T02:10:58.113Z",
    CreatedAt: "2026-09-10T02:11:09.501Z",
    UpdatedAt: "2026-09-12T02:10:58.113Z",
    Severity: { Label: "CRITICAL", Normalized: 90, Original: "CRITICAL" },
    Title: "IAM.9 MFA should be enabled for the root user",
    Description:
      "This AWS control checks whether your AWS account is enabled to use a multi-factor authentication (MFA) device to sign in with root user credentials.",
    Remediation: {
      Recommendation: {
        Text: "For information on how to correct this issue, consult the AWS Security Hub controls documentation.",
        Url: "https://docs.aws.amazon.com/console/securityhub/IAM.9/remediation",
      },
    },
    ProductFields: {
      "RelatedAWSResources:0/name":
        "securityhub-root-account-mfa-enabled-5a3c1b",
      "aws/securityhub/ProductName": "Security Hub",
      "aws/securityhub/CompanyName": "AWS",
    },
    Resources: [
      {
        Type: "AwsAccount",
        Id: "AWS::::Account:123456789012",
        Partition: "aws",
        Region: "eu-central-1",
      },
    ],
    Compliance: {
      Status: "FAILED",
      SecurityControlId: "IAM.9",
      AssociatedStandards: [
        {
          StandardsId:
            "standards/aws-foundational-security-best-practices/v/1.0.0",
        },
        { StandardsId: "standards/cis-aws-foundations-benchmark/v/1.4.0" },
      ],
      RelatedRequirements: ["CIS AWS Foundations Benchmark v1.4.0/1.5"],
    },
    WorkflowState: "NEW",
    Workflow: { Status: "NOTIFIED" },
    RecordState: "ACTIVE",
  } as unknown as JSONObject;
}

// A partner (third-party) finding with the retired Network object and friends.
function partnerFinding(): JSONObject {
  return {
    SchemaVersion: "2018-10-08",
    Id: "us-west-2/111111111111/98aebb2207407c87f51e89943f12b1ef",
    ProductArn:
      "arn:aws:securityhub:us-west-2:222222222222:product/generico/secure-pro",
    ProductName: "Secure Pro",
    CompanyName: "Generico",
    GeneratorId: "acme-vpn-anomaly-rule-7",
    AwsAccountId: "111111111111",
    Region: "us-west-2",
    Types: [
      "TTPs/Command and Control/Beaconing",
      "TTPs/Exfiltration",
      "Unusual Behaviors/Network Flow",
      "TTPs/Command and Control/Beaconing",
    ],
    CreatedAt: "2026-09-12T13:22:13.933Z",
    UpdatedAt: "2026-09-12T13:22:13.933Z",
    Severity: { Label: "HIGH", Normalized: 70 },
    Title: "Outbound beaconing to a known C2 host",
    Description: "The instance contacted a threat-intel listed host.",
    Resources: [
      {
        Type: "AwsEc2Instance",
        Id: "arn:aws:ec2:us-west-2:111111111111:instance/i-0abcdef1234567890",
        Region: "us-west-2",
      },
      {
        Type: "AwsIamAccessKey",
        Id: "AKIAI44QH8DHBEXAMPLE",
        Details: {
          AwsIamAccessKey: {
            PrincipalName: "svc-deploy",
            UserName: "svc-deploy",
            Status: "Active",
          },
        },
      },
    ],
    Network: {
      Direction: "OUT",
      Protocol: "TCP",
      SourceIpV4: "172.31.43.6",
      SourcePort: 51234,
      SourceDomain: "ip-172-31-43-6.internal",
      DestinationIpV4: "203.0.113.5",
      DestinationPort: 443,
      DestinationDomain: "beacon.example.net",
    },
    Process: {
      Name: "curl",
      Path: "/usr/bin/curl",
      Pid: 4242,
      LaunchedAt: "2026-09-12T13:20:01Z",
    },
    Malware: [
      {
        Name: "Stringler",
        Type: "COIN_MINER",
        Path: "/usr/sbin/stringler",
        State: "OBSERVED",
      },
      { Path: "/tmp/dropper" },
    ],
    ThreatIntelIndicators: [
      {
        Category: "BACKDOOR",
        Type: "IPV4_ADDRESS",
        Value: "203.0.113.5",
        Source: "Threat Intel Weekly",
      },
      { Type: "DOMAIN", Value: "beacon.example.net" },
    ],
    UserDefinedFields: { reviewedByCio: "true" },
    Workflow: { Status: "NEW" },
    RecordState: "ACTIVE",
  };
}

describe("AwsSecurityHubNormalizer", () => {
  describe("isRecognized", () => {
    test("recognizes ASFF findings by their Id plus a required attribute", () => {
      expect(AwsSecurityHubNormalizer.isRecognized(guardDutyFinding())).toBe(
        true,
      );
      expect(AwsSecurityHubNormalizer.isRecognized(controlFinding())).toBe(
        true,
      );
      expect(
        AwsSecurityHubNormalizer.isRecognized({
          Id: "custom/1",
          CreatedAt: "2026-09-12T13:22:13.933Z",
        }),
      ).toBe(true);
      expect(
        AwsSecurityHubNormalizer.isRecognized({
          Id: "custom/2",
          AwsAccountId: "111111111111",
        }),
      ).toBe(true);
    });

    test("rejects error envelopes, id-less objects, empty objects and non-objects", () => {
      expect(
        AwsSecurityHubNormalizer.isRecognized({
          __type: "AccessDeniedException",
          Message: "not authorized",
        }),
      ).toBe(false);
      expect(
        AwsSecurityHubNormalizer.isRecognized({
          Title: "no id",
          CreatedAt: "2026-09-12T13:22:13.933Z",
        }),
      ).toBe(false);
      expect(AwsSecurityHubNormalizer.isRecognized({ Id: "only-an-id" })).toBe(
        false,
      );
      expect(AwsSecurityHubNormalizer.isRecognized({})).toBe(false);
      expect(
        AwsSecurityHubNormalizer.isRecognized(null as unknown as JSONObject),
      ).toBe(false);
      expect(
        AwsSecurityHubNormalizer.isRecognized(
          "finding" as unknown as JSONObject,
        ),
      ).toBe(false);
      expect(
        AwsSecurityHubNormalizer.isRecognized([
          guardDutyFinding(),
        ] as unknown as JSONObject),
      ).toBe(false);
    });
  });

  describe("normalize", () => {
    test("maps the GuardDuty reference finding to an OCSF Detection Finding", () => {
      const event: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(guardDutyFinding());

      expect(event.classUid).toBe(AWS_SECURITY_HUB_DETECTION_CLASS_UID);
      expect(event.className).toBe(AWS_SECURITY_HUB_DETECTION_CLASS_NAME);
      expect(event.classUid).toBe(2004);
      expect(event.categoryUid).toBe(2);
      expect(event.categoryName).toBe("Findings");
      expect(event.activityName).toBe("Create");
      expect(event.time.toISOString()).toBe("2020-08-22T09:34:34.146Z");
      expect(event.eventUid).toBe(GUARDDUTY_ID);
      expect(event.severityName).toBe(OcsfSeverity.Medium);
      expect(event.severityId).toBe(3);
      expect(event.statusName).toBe("NEW");
      expect(event.message).toBe(
        "199.241.229.197 is performing SSH brute force attacks against i-0c10c2c7863d1a356.",
      );
      expect(event.ruleName).toBe(event.message);
      expect(event.ruleId).toBe(
        "arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64",
      );
      expect(event.vendorName).toBe(definition.vendorName);
      expect(event.productName).toBe(definition.productName);
      expect(event.vendorName).toBe("Amazon Web Services");
      expect(event.productName).toBe("AWS Security Hub");
      expect(event.mitreTactics).toEqual(["TA0001"]);
      expect(event.mitreTechniques).toEqual([
        "UnauthorizedAccess:EC2-SSHBruteForce",
      ]);
      expect(event.targetResource).toBe(
        "arn:aws:ec2:us-east-1:193043430472:instance/i-0c10c2c7863d1a356",
      );
      expect(event.targetHost).toBe("i-0c10c2c7863d1a356");
      expect(event.principalUser).toBe("");
      expect(event.principalIp).toBe("");
      expect(event.principalProcess).toBe("");
      expect(event.targetIp).toBe("");
      expect(event.targetPort).toBe(0);
      expect(event.observables).toEqual([
        "i-0c10c2c7863d1a356",
        "arn:aws:ec2:us-east-1:193043430472:instance/i-0c10c2c7863d1a356",
        "193043430472",
      ]);
    });

    test("maps a control finding (Compliance present) to an OCSF Compliance Finding", () => {
      const event: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(controlFinding());

      expect(event.classUid).toBe(AWS_SECURITY_HUB_COMPLIANCE_CLASS_UID);
      expect(event.className).toBe(AWS_SECURITY_HUB_COMPLIANCE_CLASS_NAME);
      expect(event.classUid).toBe(2003);
      expect(event.categoryName).toBe("Findings");
      expect(event.severityName).toBe(OcsfSeverity.Critical);
      expect(event.severityId).toBe(5);
      expect(event.statusName).toBe("NOTIFIED");
      expect(event.ruleId).toBe("security-control/IAM.9");
      expect(event.ruleName).toBe(
        "IAM.9 MFA should be enabled for the root user",
      );
      expect(event.mitreTactics).toEqual([]);
      expect(event.mitreTechniques).toEqual([]);
      expect(event.targetResource).toBe("AWS::::Account:123456789012");
      expect(event.observables).toEqual([
        "AWS::::Account:123456789012",
        "123456789012",
      ]);
      expect(event.attributes["Compliance.Status"]).toBe("FAILED");
      expect(event.attributes["Compliance.SecurityControlId"]).toBe("IAM.9");
      expect(
        event.attributes["Compliance.AssociatedStandards.0.StandardsId"],
      ).toBe("standards/aws-foundational-security-best-practices/v/1.0.0");
    });

    test("does not treat an empty Compliance object as a control finding", () => {
      const raw: JSONObject = guardDutyFinding();
      raw["Compliance"] = {};

      expect(AwsSecurityHubNormalizer.isComplianceFinding(raw)).toBe(false);
      expect(AwsSecurityHubNormalizer.normalize(raw).classUid).toBe(2004);
    });

    test("extracts network, process, identity, malware and threat-intel observables from a partner finding", () => {
      const event: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(partnerFinding());

      expect(event.classUid).toBe(2004);
      expect(event.severityName).toBe(OcsfSeverity.High);
      expect(event.principalUser).toBe("svc-deploy");
      expect(event.principalIp).toBe("172.31.43.6");
      expect(event.principalProcess).toBe("curl");
      expect(event.targetHost).toBe("i-0abcdef1234567890");
      expect(event.targetIp).toBe("203.0.113.5");
      expect(event.targetPort).toBe(443);
      expect(event.targetResource).toBe(
        "arn:aws:ec2:us-west-2:111111111111:instance/i-0abcdef1234567890",
      );
      // TTPs entries map to tactic ids, deduped; non-TTPs namespaces are ignored.
      expect(event.mitreTactics).toEqual(["TA0011", "TA0010"]);
      expect(event.mitreTechniques).toEqual(["Beaconing"]);
      expect(event.observables).toEqual([
        "svc-deploy",
        "i-0abcdef1234567890",
        "172.31.43.6",
        "203.0.113.5",
        "ip-172-31-43-6.internal",
        "beacon.example.net",
        "arn:aws:ec2:us-west-2:111111111111:instance/i-0abcdef1234567890",
        "AKIAI44QH8DHBEXAMPLE",
        "111111111111",
        "curl",
        "Stringler",
        "/tmp/dropper",
      ]);
      expect(event.attributes["UserDefinedFields.reviewedByCio"]).toBe("true");
      expect(event.attributes["ThreatIntelIndicators.0.Category"]).toBe(
        "BACKDOOR",
      );
    });

    test("flattens the whole payload into string attributes", () => {
      const event: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(guardDutyFinding());

      expect(event.attributes["Id"]).toBe(GUARDDUTY_ID);
      expect(event.attributes["Severity.Normalized"]).toBe("40");
      expect(event.attributes["Types"]).toBe(
        "TTPs/Initial Access/UnauthorizedAccess:EC2-SSHBruteForce",
      );
      expect(event.attributes["Resources.0.Tags.Name"]).toBe("kubectl");
      expect(
        event.attributes["Resources.0.Details.AwsEc2Instance.IpV4Addresses"],
      ).toBe("18.234.130.16,172.31.43.6");
      expect(
        event.attributes[
          "ProductFields.aws/guardduty/service/action/actionType"
        ],
      ).toBe("NETWORK_CONNECTION");
      expect(event.attributes["FirstObservedAt"]).toBe("2020-08-22T09:15:57Z");
      expect(event.attributes["RecordState"]).toBe("ACTIVE");

      for (const value of Object.values(event.attributes)) {
        expect(typeof value).toBe("string");
      }
    });

    test("maps every TTPs tactic name to its ATT&CK id and keeps unknown names", () => {
      const names: Array<[string, string]> = [
        ["Initial Access", "TA0001"],
        ["Execution", "TA0002"],
        ["Persistence", "TA0003"],
        ["Privilege Escalation", "TA0004"],
        ["Defense Evasion", "TA0005"],
        ["Credential Access", "TA0006"],
        ["Discovery", "TA0007"],
        ["Lateral Movement", "TA0008"],
        ["Collection", "TA0009"],
        ["Command and Control", "TA0011"],
        ["Exfiltration", "TA0010"],
        ["Impact", "TA0040"],
      ];

      for (const [name, id] of names) {
        const raw: JSONObject = guardDutyFinding();
        raw["Types"] = [`TTPs/${name}/Something`];

        expect(AwsSecurityHubNormalizer.normalize(raw).mitreTactics).toEqual([
          id,
        ]);
      }

      expect(Object.keys(AWS_SECURITY_HUB_TACTIC_IDS)).toHaveLength(14);

      const raw: JSONObject = guardDutyFinding();
      raw["Types"] = ["TTPs/Made Up Tactic", "TTPs", "Effects/Data Exposure"];
      const event: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(raw);
      expect(event.mitreTactics).toEqual(["Made Up Tactic"]);
      expect(event.mitreTechniques).toEqual([]);
    });

    test("maps the five ASFF severity labels, falls back to the Normalized score ranges, then to Unknown", () => {
      const labels: Array<[string, OcsfSeverity, number]> = [
        ["INFORMATIONAL", OcsfSeverity.Informational, 1],
        ["LOW", OcsfSeverity.Low, 2],
        ["MEDIUM", OcsfSeverity.Medium, 3],
        ["HIGH", OcsfSeverity.High, 4],
        ["CRITICAL", OcsfSeverity.Critical, 5],
      ];

      for (const [label, severity, id] of labels) {
        const raw: JSONObject = guardDutyFinding();
        raw["Severity"] = { Label: label };
        const event: NormalizedSecurityEvent =
          AwsSecurityHubNormalizer.normalize(raw);
        expect(event.severityName).toBe(severity);
        expect(event.severityId).toBe(id);
      }

      const scores: Array<[number, OcsfSeverity]> = [
        [0, OcsfSeverity.Informational],
        [1, OcsfSeverity.Low],
        [39, OcsfSeverity.Low],
        [40, OcsfSeverity.Medium],
        [69, OcsfSeverity.Medium],
        [70, OcsfSeverity.High],
        [89, OcsfSeverity.High],
        [90, OcsfSeverity.Critical],
        [100, OcsfSeverity.Critical],
      ];

      for (const [score, severity] of scores) {
        const raw: JSONObject = guardDutyFinding();
        raw["Severity"] = { Normalized: score };
        expect(AwsSecurityHubNormalizer.normalize(raw).severityName).toBe(
          severity,
        );
      }

      const unknownLabel: JSONObject = guardDutyFinding();
      unknownLabel["Severity"] = { Label: "PURPLE" };
      expect(
        AwsSecurityHubNormalizer.normalize(unknownLabel).severityName,
      ).toBe(OcsfSeverity.Unknown);

      const missing: JSONObject = guardDutyFinding();
      delete missing["Severity"];
      const event: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(missing);
      expect(event.severityName).toBe(OcsfSeverity.Unknown);
      expect(event.severityId).toBe(0);
    });

    test("takes the status from Workflow.Status, then the retired WorkflowState, then nothing", () => {
      const raw: JSONObject = guardDutyFinding();
      raw["Workflow"] = { Status: "SUPPRESSED" };
      expect(AwsSecurityHubNormalizer.normalize(raw).statusName).toBe(
        "SUPPRESSED",
      );

      delete raw["Workflow"];
      raw["WorkflowState"] = "RESOLVED";
      expect(AwsSecurityHubNormalizer.normalize(raw).statusName).toBe(
        "RESOLVED",
      );

      delete raw["WorkflowState"];
      expect(AwsSecurityHubNormalizer.normalize(raw).statusName).toBe("");
    });

    test("prefers IPv4 network addresses and falls back to IPv6", () => {
      const raw: JSONObject = partnerFinding();
      raw["Network"] = {
        SourceIpV6: "2001:db8::1",
        DestinationIpV6: "2001:db8::2",
        DestinationPort: "8443",
      };

      const event: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(raw);

      expect(event.principalIp).toBe("2001:db8::1");
      expect(event.targetIp).toBe("2001:db8::2");
      expect(event.targetPort).toBe(8443);
    });

    test("uses a content hash as the event uid when the finding has no Id", () => {
      const raw: JSONObject = guardDutyFinding();
      delete raw["Id"];

      const first: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(raw);
      const second: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(
          JSON.parse(JSON.stringify(raw)) as JSONObject,
        );

      expect(first.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(second.eventUid).toBe(first.eventUid);

      raw["Title"] = "something else";
      expect(AwsSecurityHubNormalizer.normalize(raw).eventUid).not.toBe(
        first.eventUid,
      );
    });

    test("uses creation time as the event time, falling back to update, first-observed and then now", () => {
      const raw: JSONObject = guardDutyFinding();

      delete raw["CreatedAt"];
      expect(AwsSecurityHubNormalizer.normalize(raw).time.toISOString()).toBe(
        "2020-09-30T12:14:00.206Z",
      );

      delete raw["UpdatedAt"];
      expect(AwsSecurityHubNormalizer.normalize(raw).time.toISOString()).toBe(
        "2020-08-22T09:15:57.000Z",
      );

      delete raw["FirstObservedAt"];
      const before: number = Date.now();
      const event: NormalizedSecurityEvent =
        AwsSecurityHubNormalizer.normalize(raw);
      expect(event.time.getTime()).toBeGreaterThanOrEqual(before);
      expect(event.time.getTime()).toBeLessThanOrEqual(Date.now());

      raw["CreatedAt"] = "not a date";
      raw["UpdatedAt"] = "2024-01-04T15:25:10+17:59";
      expect(AwsSecurityHubNormalizer.normalize(raw).time.toISOString()).toBe(
        "2024-01-03T21:26:10.000Z",
      );
    });

    test("builds a message from the title, then the description, then a class-specific default", () => {
      const raw: JSONObject = guardDutyFinding();

      delete raw["Title"];
      expect(AwsSecurityHubNormalizer.normalize(raw).message).toBe(
        raw["Description"],
      );
      expect(AwsSecurityHubNormalizer.normalize(raw).ruleName).toBe("");

      delete raw["Description"];
      expect(AwsSecurityHubNormalizer.normalize(raw).message).toBe(
        "AWS Security Hub finding",
      );

      raw["Compliance"] = { Status: "PASSED" };
      expect(AwsSecurityHubNormalizer.normalize(raw).message).toBe(
        "AWS Security Hub control finding",
      );
    });

    test("does not mutate the raw payload", () => {
      const raw: JSONObject = partnerFinding();
      const snapshot: string = JSON.stringify(raw);

      AwsSecurityHubNormalizer.normalize(raw);

      expect(JSON.stringify(raw)).toBe(snapshot);
    });
  });
});
