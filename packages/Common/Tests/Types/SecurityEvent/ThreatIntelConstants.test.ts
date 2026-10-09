/*
 * The threat-intel contract: how a STIX confidence becomes an OCSF severity,
 * and the attribute keys and bounds that the matcher, the enricher and the
 * dashboard share (ThreatIntelConstants).
 */

import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  ENRICHMENT_CONFIDENCE_ATTRIBUTE,
  ENRICHMENT_FEED_ATTRIBUTE,
  ENRICHMENT_FEED_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE,
  ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
  ENRICHMENT_MATCHED_ATTRIBUTE,
  ENRICHMENT_MATCHED_VALUE,
  ENRICHMENT_MATCH_COUNT_ATTRIBUTE,
  THREAT_CONFIDENCE_ATTRIBUTE,
  THREAT_FEED_ID_ATTRIBUTE,
  THREAT_FEED_NAME_ATTRIBUTE,
  THREAT_INDICATOR_ID_ATTRIBUTE,
  THREAT_INDICATOR_TYPE_ATTRIBUTE,
  THREAT_INDICATOR_VALUE_ATTRIBUTE,
  THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
  THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES,
  THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
  THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
  THREAT_MATCH_COUNT_ATTRIBUTE,
  ThreatIntelIndicatorType,
  ocsfSeverityForConfidence,
} from "../../../Types/SecurityEvent/ThreatIntelConstants";
import { describe, expect, test } from "@jest/globals";

describe("ocsfSeverityForConfidence", () => {
  test("90 and above is Critical", () => {
    expect(ocsfSeverityForConfidence(90)).toBe(OcsfSeverity.Critical);
    expect(ocsfSeverityForConfidence(95)).toBe(OcsfSeverity.Critical);
    expect(ocsfSeverityForConfidence(100)).toBe(OcsfSeverity.Critical);
  });

  test("70 up to 90 is High", () => {
    expect(ocsfSeverityForConfidence(70)).toBe(OcsfSeverity.High);
    expect(ocsfSeverityForConfidence(80)).toBe(OcsfSeverity.High);
    expect(ocsfSeverityForConfidence(89.99)).toBe(OcsfSeverity.High);
  });

  test("40 up to 70 is Medium", () => {
    expect(ocsfSeverityForConfidence(40)).toBe(OcsfSeverity.Medium);
    expect(ocsfSeverityForConfidence(55)).toBe(OcsfSeverity.Medium);
    expect(ocsfSeverityForConfidence(69.5)).toBe(OcsfSeverity.Medium);
  });

  test("above 0 and below 40 is Low", () => {
    expect(ocsfSeverityForConfidence(1)).toBe(OcsfSeverity.Low);
    expect(ocsfSeverityForConfidence(0.5)).toBe(OcsfSeverity.Low);
    expect(ocsfSeverityForConfidence(39.999)).toBe(OcsfSeverity.Low);
  });

  test("0 means not specified, which reads as Medium", () => {
    expect(ocsfSeverityForConfidence(0)).toBe(OcsfSeverity.Medium);
  });

  test("negative and non-finite confidence read as Medium", () => {
    for (const confidence of [
      -1,
      -100,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(ocsfSeverityForConfidence(confidence)).toBe(OcsfSeverity.Medium);
    }
  });

  test("above the STIX maximum is still Critical", () => {
    expect(ocsfSeverityForConfidence(150)).toBe(OcsfSeverity.Critical);
  });

  test("never more severe as confidence falls", () => {
    const rank: Record<string, number> = {
      [OcsfSeverity.Low]: 1,
      [OcsfSeverity.Medium]: 2,
      [OcsfSeverity.High]: 3,
      [OcsfSeverity.Critical]: 4,
    };

    let previous: number = 0;

    for (let confidence: number = 1; confidence <= 100; confidence++) {
      const current: number = rank[ocsfSeverityForConfidence(confidence)]!;

      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe("attribute keys", () => {
  test("finding row keys live under oneuptime.threat.", () => {
    for (const key of [
      THREAT_FEED_ID_ATTRIBUTE,
      THREAT_FEED_NAME_ATTRIBUTE,
      THREAT_INDICATOR_ID_ATTRIBUTE,
      THREAT_INDICATOR_TYPE_ATTRIBUTE,
      THREAT_INDICATOR_VALUE_ATTRIBUTE,
      THREAT_CONFIDENCE_ATTRIBUTE,
      THREAT_MATCH_COUNT_ATTRIBUTE,
    ]) {
      expect(key.startsWith("oneuptime.threat.")).toBe(true);
    }
  });

  test("enrichment keys live under the short threat. prefix", () => {
    const keys: Array<string> = [
      ENRICHMENT_MATCHED_ATTRIBUTE,
      ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
      ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE,
      ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
      ENRICHMENT_FEED_ATTRIBUTE,
      ENRICHMENT_FEED_ID_ATTRIBUTE,
      ENRICHMENT_CONFIDENCE_ATTRIBUTE,
      ENRICHMENT_MATCH_COUNT_ATTRIBUTE,
    ];

    for (const key of keys) {
      expect(key.startsWith("threat.")).toBe(true);
      expect(key.startsWith("oneuptime.")).toBe(false);
    }

    expect(new Set(keys).size).toBe(keys.length);
  });

  test("a matched event is stamped with the literal string true", () => {
    expect(ENRICHMENT_MATCHED_ATTRIBUTE).toBe("threat.matched");
    expect(ENRICHMENT_MATCHED_VALUE).toBe("true");
  });
});

describe("indicator types", () => {
  test("are the STIX cyber-observable names", () => {
    expect(ThreatIntelIndicatorType.Ipv4Address).toBe("ipv4-addr");
    expect(ThreatIntelIndicatorType.Ipv6Address).toBe("ipv6-addr");
    expect(ThreatIntelIndicatorType.DomainName).toBe("domain-name");
    expect(ThreatIntelIndicatorType.Url).toBe("url");
    expect(ThreatIntelIndicatorType.EmailAddress).toBe("email-addr");
  });

  test("are unique", () => {
    const values: Array<string> = Object.values(ThreatIntelIndicatorType);

    expect(new Set(values).size).toBe(values.length);
  });
});

describe("bounds", () => {
  test("minimum confidence spans the whole STIX range", () => {
    expect(THREAT_INTEL_MINIMUM_CONFIDENCE_MIN).toBe(0);
    expect(THREAT_INTEL_MINIMUM_CONFIDENCE_MAX).toBe(100);
  });

  test("the default poll interval lies within the allowed range", () => {
    expect(
      THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
    ).toBeGreaterThanOrEqual(THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES);
    expect(THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES).toBeLessThanOrEqual(
      THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
    );
  });

  test("the first match window fits inside the maximum lookback", () => {
    expect(THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES).toBeLessThanOrEqual(
      THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES,
    );
    expect(THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES).toBe(24 * 60);
  });
});
