import { JSONObject } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventFormat from "../../Types/SecurityEvent/SecurityEventFormat";
import GenericNormalizer from "./GenericNormalizer";
import GoogleSecOpsAlertNormalizer from "./GoogleSecOpsAlertNormalizer";
import OcsfNormalizer from "./OcsfNormalizer";
import UdmNormalizer from "./UdmNormalizer";

/*
 * Entry point for security-event normalization: pick the dialect (caller
 * can name it; otherwise sniff per event) and produce the canonical
 * NormalizedSecurityEvent. Sniffing is per event, not per batch — one
 * webhook can legitimately mix a detection alert with raw UDM events.
 */
export default class SecurityEventNormalizer {
  public static detectFormat(payload: JSONObject): SecurityEventFormat {
    if (OcsfNormalizer.isOcsfEvent(payload)) {
      return SecurityEventFormat.Ocsf;
    }

    if (UdmNormalizer.isUdmEvent(payload)) {
      return SecurityEventFormat.Udm;
    }

    if (GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert(payload)) {
      return SecurityEventFormat.GoogleSecOpsAlert;
    }

    return SecurityEventFormat.Generic;
  }

  public static parseFormat(value: string): SecurityEventFormat | null {
    const normalized: string = (value || "").trim().toLowerCase();

    if (!normalized) {
      return null;
    }

    const aliases: Record<string, SecurityEventFormat> = {
      ocsf: SecurityEventFormat.Ocsf,
      udm: SecurityEventFormat.Udm,
      chronicle: SecurityEventFormat.Udm,
      "google-secops": SecurityEventFormat.Udm,
      "google-secops-alert": SecurityEventFormat.GoogleSecOpsAlert,
      "secops-alert": SecurityEventFormat.GoogleSecOpsAlert,
      detection: SecurityEventFormat.GoogleSecOpsAlert,
      generic: SecurityEventFormat.Generic,
    };

    return aliases[normalized] || null;
  }

  public static normalize(
    payload: JSONObject,
    format?: SecurityEventFormat | undefined,
  ): NormalizedSecurityEvent | null {
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).length === 0
    ) {
      return null;
    }

    const resolvedFormat: SecurityEventFormat =
      format || this.detectFormat(payload);

    switch (resolvedFormat) {
      case SecurityEventFormat.Ocsf:
        return OcsfNormalizer.normalize(payload);
      case SecurityEventFormat.Udm:
        return UdmNormalizer.normalize(payload);
      case SecurityEventFormat.GoogleSecOpsAlert:
        return GoogleSecOpsAlertNormalizer.normalize(payload);
      case SecurityEventFormat.Generic:
        return GenericNormalizer.normalize(payload);
      default:
        return GenericNormalizer.normalize(payload);
    }
  }
}
