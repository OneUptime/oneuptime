import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import SecurityEventConnectorType from "../../../../Types/SecurityEvent/SecurityEventConnectorType";
import VendorSecurityEventNormalizer from "../../../../Utils/SecurityEvent/VendorSecurityEventNormalizer";

describe("VendorSecurityEventNormalizer", () => {
  test.each<[SecurityEventConnectorType, JSONObject, string]>([
    [
      SecurityEventConnectorType.AwsSecurityHub,
      {
        SchemaVersion: "2018-10-08",
        Id: "arn:aws:securityhub:eu-west-1:123:finding/f-1",
        ProductArn: "arn:aws:securityhub:eu-west-1::product/aws/guardduty",
        AwsAccountId: "123456789012",
        GeneratorId: "detector-1",
      },
      "Amazon Web Services",
    ],
    [
      SecurityEventConnectorType.Cloudflare,
      { Source: "waf", Action: "block", ClientIP: "198.51.100.1" },
      "Cloudflare",
    ],
    [
      SecurityEventConnectorType.CrowdStrikeFalcon,
      { detection_id: "detection-1" },
      "CrowdStrike",
    ],
    [
      SecurityEventConnectorType.GoogleSecurityCommandCenter,
      {
        resourceName: "projects/project-1/resources/resource-1",
        category: "MALWARE",
        state: "ACTIVE",
      },
      "Google",
    ],
    [
      SecurityEventConnectorType.MicrosoftDefender,
      {
        providerAlertId: "provider-alert-1",
        serviceSource: "defender",
      },
      "Microsoft",
    ],
    [
      SecurityEventConnectorType.Okta,
      { uuid: "okta-1", eventType: "user.session.start" },
      "Okta",
    ],
    [
      SecurityEventConnectorType.SplunkEnterpriseSecurity,
      { event_id: "notable-1" },
      "Splunk",
    ],
  ])(
    "routes %s detection and normalization",
    (
      provider: SecurityEventConnectorType,
      payload: JSONObject,
      vendorName: string,
    ) => {
      expect(VendorSecurityEventNormalizer.isEvent(provider, payload)).toBe(
        true,
      );
      expect(
        VendorSecurityEventNormalizer.normalize(provider, payload).vendorName,
      ).toBe(vendorName);
    },
  );

  test.each<[SecurityEventConnectorType]>([
    [SecurityEventConnectorType.Cloudflare],
    [SecurityEventConnectorType.CrowdStrikeFalcon],
    [SecurityEventConnectorType.GoogleSecurityCommandCenter],
    [SecurityEventConnectorType.MicrosoftDefender],
    [SecurityEventConnectorType.Okta],
    [SecurityEventConnectorType.SplunkEnterpriseSecurity],
  ])(
    "does not claim arbitrary payloads for %s",
    (provider: SecurityEventConnectorType) => {
      expect(
        VendorSecurityEventNormalizer.isEvent(provider, {
          message: "unrelated event",
        }),
      ).toBe(false);
    },
  );
});
