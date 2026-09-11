import { JSONObject } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventConnectorType from "../../Types/SecurityEvent/SecurityEventConnectorType";
import AwsSecurityHubNormalizer from "./Vendor/AwsSecurityHubNormalizer";
import CloudflareSecurityEventNormalizer from "./Vendor/CloudflareSecurityEventNormalizer";
import CrowdStrikeFalconNormalizer from "./Vendor/CrowdStrikeFalconNormalizer";
import GoogleSecurityCommandCenterNormalizer from "./Vendor/GoogleSecurityCommandCenterNormalizer";
import MicrosoftGraphSecurityNormalizer from "./Vendor/MicrosoftGraphSecurityNormalizer";
import OktaSystemLogNormalizer from "./Vendor/OktaSystemLogNormalizer";
import SplunkEnterpriseSecurityNormalizer from "./Vendor/SplunkEnterpriseSecurityNormalizer";

export default class VendorSecurityEventNormalizer {
  public static isEvent(
    provider: SecurityEventConnectorType,
    payload: JSONObject,
  ): boolean {
    switch (provider) {
      case SecurityEventConnectorType.AwsSecurityHub:
        return AwsSecurityHubNormalizer.isAwsSecurityHubFinding(payload);
      case SecurityEventConnectorType.MicrosoftDefender:
        return MicrosoftGraphSecurityNormalizer.isMicrosoftGraphSecurityEvent(
          payload,
        );
      case SecurityEventConnectorType.Cloudflare:
        return CloudflareSecurityEventNormalizer.isCloudflareSecurityEvent(
          payload,
        );
      case SecurityEventConnectorType.CrowdStrikeFalcon:
        return CrowdStrikeFalconNormalizer.isCrowdStrikeFalconEvent(payload);
      case SecurityEventConnectorType.GoogleSecurityCommandCenter:
        return GoogleSecurityCommandCenterNormalizer.isGoogleSecurityCommandCenterEvent(
          payload,
        );
      case SecurityEventConnectorType.Okta:
        return OktaSystemLogNormalizer.isOktaSystemLogEvent(payload);
      case SecurityEventConnectorType.SplunkEnterpriseSecurity:
        return SplunkEnterpriseSecurityNormalizer.isSplunkEnterpriseSecurityEvent(
          payload,
        );
    }
  }

  public static normalize(
    provider: SecurityEventConnectorType,
    payload: JSONObject,
  ): NormalizedSecurityEvent {
    switch (provider) {
      case SecurityEventConnectorType.AwsSecurityHub:
        return AwsSecurityHubNormalizer.normalize(payload);
      case SecurityEventConnectorType.MicrosoftDefender:
        return MicrosoftGraphSecurityNormalizer.normalize(payload);
      case SecurityEventConnectorType.Cloudflare:
        return CloudflareSecurityEventNormalizer.normalize(payload);
      case SecurityEventConnectorType.CrowdStrikeFalcon:
        return CrowdStrikeFalconNormalizer.normalize(payload);
      case SecurityEventConnectorType.GoogleSecurityCommandCenter:
        return GoogleSecurityCommandCenterNormalizer.normalize(payload);
      case SecurityEventConnectorType.Okta:
        return OktaSystemLogNormalizer.normalize(payload);
      case SecurityEventConnectorType.SplunkEnterpriseSecurity:
        return SplunkEnterpriseSecurityNormalizer.normalize(payload);
    }
  }
}
