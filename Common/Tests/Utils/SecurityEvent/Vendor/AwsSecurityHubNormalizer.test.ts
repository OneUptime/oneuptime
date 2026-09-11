import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import AwsSecurityHubNormalizer from "../../../../Utils/SecurityEvent/Vendor/AwsSecurityHubNormalizer";

describe("AwsSecurityHubNormalizer", () => {
  function finding(): JSONObject {
    return {
      SchemaVersion: "2018-10-08",
      Id: "arn:aws:securityhub:eu-west-1:123:finding/f-1",
      ProductArn: "arn:aws:securityhub:eu-west-1::product/aws/guardduty",
      AwsAccountId: "123456789012",
      GeneratorId: "guardduty-detector-1",
      CompanyName: "Amazon",
      ProductName: "GuardDuty",
      Title: "Unusual API calls from an EC2 instance",
      Description: "An instance called an unusual API.",
      Types: ["TTPs/Command and Control"],
      CreatedAt: "2026-01-01T10:00:00Z",
      UpdatedAt: "2026-01-01T11:00:00Z",
      LastObservedAt: "2026-01-01T12:00:00Z",
      Severity: { Label: "HIGH", Normalized: 80 },
      Workflow: { Status: "NEW" },
      Resources: [
        {
          Type: "AwsEc2Instance",
          Id: "arn:aws:ec2:eu-west-1:123:instance/i-target",
          ResourceRole: "Target",
        },
        {
          Type: "AwsIamRole",
          Id: "arn:aws:iam::123:role/suspicious-actor",
          ResourceRole: "Actor",
        },
      ],
      Network: {
        SourceIpV4: "198.51.100.4",
        SourceDomain: "scanner.example",
        DestinationIpV4: "10.0.0.8",
        DestinationDomain: "api.internal.example",
        DestinationPort: 443,
      },
      Process: { Name: "curl" },
      ThreatIntelIndicators: [{ Type: "IPV4_ADDRESS", Value: "203.0.113.9" }],
      Threats: [
        {
          Name: "Example.Backdoor",
          FilePaths: [
            {
              FileName: "backdoor",
              Hash: "sha256:abc123",
              ResourceId: "volume-1",
            },
          ],
        },
      ],
      ProductFields: {
        mitreTactic: "TA0011",
        mitreTechnique: "T1071.001",
      },
    };
  }

  test("detects direct ASFF findings and common delivery envelopes", () => {
    expect(AwsSecurityHubNormalizer.isAwsSecurityHubFinding(finding())).toBe(
      true,
    );
    expect(
      AwsSecurityHubNormalizer.isAwsSecurityHubFinding({
        "detail-type": "Security Hub Findings - Imported",
        detail: { findings: [finding()] },
      }),
    ).toBe(true);
    expect(
      AwsSecurityHubNormalizer.isAwsSecurityHubFinding({
        Findings: [finding()],
      }),
    ).toBe(true);
  });

  test("rejects unrelated AWS-shaped payloads", () => {
    expect(
      AwsSecurityHubNormalizer.isAwsSecurityHubFinding({
        AwsAccountId: "123",
        message: "ordinary event",
      }),
    ).toBe(false);
  });

  test("maps the ASFF finding identity, classification, and provenance", () => {
    const result: NormalizedSecurityEvent =
      AwsSecurityHubNormalizer.normalize(finding());

    expect(result).toMatchObject({
      eventUid:
        "arn:aws:securityhub:eu-west-1::product/aws/guardduty|arn:aws:securityhub:eu-west-1:123:finding/f-1",
      categoryUid: 2,
      categoryName: "Findings",
      classUid: 2004,
      className: "Detection Finding",
      activityName: "Create",
      severityId: 4,
      severityName: OcsfSeverity.High,
      statusName: "NEW",
      message: "Unusual API calls from an EC2 instance",
      vendorName: "Amazon",
      productName: "GuardDuty",
      ruleId: "guardduty-detector-1",
      ruleName: "Unusual API calls from an EC2 instance",
    });
    expect(result.time.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  test("scopes finding identity by product ARN", () => {
    const first: JSONObject = finding();
    const second: JSONObject = {
      ...finding(),
      ProductArn:
        "arn:aws:securityhub:eu-west-1::product/partner/different-product",
    };

    expect(AwsSecurityHubNormalizer.normalize(first).eventUid).not.toBe(
      AwsSecurityHubNormalizer.normalize(second).eventUid,
    );
  });

  test("extracts network, process, resource, threat, and MITRE context", () => {
    const result: NormalizedSecurityEvent =
      AwsSecurityHubNormalizer.normalize(finding());

    expect(result.principalUser).toBe("arn:aws:iam::123:role/suspicious-actor");
    expect(result.principalHost).toBe("scanner.example");
    expect(result.principalIp).toBe("198.51.100.4");
    expect(result.principalProcess).toBe("curl");
    expect(result.targetHost).toBe("api.internal.example");
    expect(result.targetIp).toBe("10.0.0.8");
    expect(result.targetPort).toBe(443);
    expect(result.targetResource).toBe(
      "arn:aws:ec2:eu-west-1:123:instance/i-target",
    );
    expect(result.mitreTactics).toEqual(["TA0011"]);
    expect(result.mitreTechniques).toEqual(["T1071.001"]);
    expect(result.observables).toEqual(
      expect.arrayContaining([
        "198.51.100.4",
        "api.internal.example",
        "203.0.113.9",
        "Example.Backdoor",
        "sha256:abc123",
        "backdoor",
        "volume-1",
      ]),
    );
  });

  test("retains the complete EventBridge envelope in attributes", () => {
    const result: NormalizedSecurityEvent = AwsSecurityHubNormalizer.normalize({
      id: "eventbridge-id",
      "detail-type": "Security Hub Findings - Imported",
      detail: { findings: [finding()] },
    });

    expect(result.eventUid).toContain("finding/f-1");
    expect(result.attributes["id"]).toBe("eventbridge-id");
    expect(result.attributes["detail.findings.0.Title"]).toBe(
      "Unusual API calls from an EC2 instance",
    );
  });

  test.each<[number, OcsfSeverity]>([
    [0, OcsfSeverity.Informational],
    [1, OcsfSeverity.Low],
    [39, OcsfSeverity.Low],
    [40, OcsfSeverity.Medium],
    [69, OcsfSeverity.Medium],
    [70, OcsfSeverity.High],
    [89, OcsfSeverity.High],
    [90, OcsfSeverity.Critical],
    [100, OcsfSeverity.Critical],
  ])(
    "maps ASFF normalized severity %i",
    (score: number, expected: OcsfSeverity) => {
      const payload: JSONObject = finding();
      payload["Severity"] = { Normalized: score };

      expect(AwsSecurityHubNormalizer.normalize(payload).severityName).toBe(
        expected,
      );
    },
  );

  test("uses provider severity when the mutable top-level severity is absent", () => {
    const payload: JSONObject = finding();
    payload["Severity"] = undefined;
    payload["FindingProviderFields"] = { Severity: { Label: "CRITICAL" } };

    expect(AwsSecurityHubNormalizer.normalize(payload).severityName).toBe(
      OcsfSeverity.Critical,
    );
  });

  test("classifies compliance and vulnerability findings separately", () => {
    expect(
      AwsSecurityHubNormalizer.normalize({
        ...finding(),
        Compliance: { Status: "FAILED" },
      }).classUid,
    ).toBe(2003);
    expect(
      AwsSecurityHubNormalizer.normalize({
        ...finding(),
        Vulnerabilities: [{ Id: "CVE-2026-1234" }],
      }).classUid,
    ).toBe(2002);
  });

  test("uses action network details when retired Network fields are absent", () => {
    const result: NormalizedSecurityEvent = AwsSecurityHubNormalizer.normalize({
      ...finding(),
      Network: undefined,
      Action: {
        NetworkConnectionAction: {
          RemoteIpDetails: { IpAddressV4: "192.0.2.4" },
          LocalIpDetails: { IpAddressV4: "10.1.2.3" },
          LocalPortDetails: { Port: 22 },
        },
      },
    });

    expect(result.principalIp).toBe("192.0.2.4");
    expect(result.targetIp).toBe("10.1.2.3");
    expect(result.targetPort).toBe(22);
  });

  test("falls back safely when optional fields are missing", () => {
    const payload: JSONObject = {
      SchemaVersion: "2018-10-08",
      ProductArn: "arn:aws:securityhub:eu-west-1::product/aws/guardduty",
      AwsAccountId: "123",
      GeneratorId: "generator",
    };
    const result: NormalizedSecurityEvent =
      AwsSecurityHubNormalizer.normalize(payload);

    expect(result.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.message).toBe("AWS Security Hub finding");
    expect(result.vendorName).toBe("Amazon Web Services");
    expect(result.productName).toBe("Amazon GuardDuty");
    expect(result.severityName).toBe(OcsfSeverity.Unknown);
  });
});
