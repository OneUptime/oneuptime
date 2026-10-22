import {
  GOOGLE_SECOPS_IOC_MAX_LABELS,
  GOOGLE_SECOPS_IOC_MAX_NAME_LENGTH,
  GoogleSecOpsIoc,
  decodeGoogleSecOpsIpAddress,
  googleSecOpsIocConfidence,
  mergeGoogleSecOpsIocs,
  readGoogleSecOpsIocMatch,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/GoogleSecOpsIocMatch";
import { JSONObject } from "../../../../../Types/JSON";
import { ThreatIntelIndicatorType } from "../../../../../Types/SecurityEvent/ThreatIntelConstants";
import { describe, expect, test } from "@jest/globals";

/*
 * One IoCDiscoveryInfo from legacySearchEnterpriseWideIoCs, as Google SecOps
 * answers it, -> the indicator OneUptime watches the rest of the project's
 * events for. The shapes below are the API reference's:
 * https://cloud.google.com/chronicle/docs/reference/rest/v1alpha/projects.locations.instances.legacy/legacySearchEnterpriseWideIoCs
 */

const SHA256: string =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

const domainMatch: JSONObject = {
  artifactIndicator: { domain: "C2.Evil.Example" },
  sources: ["Mandiant Active Breach Intelligence"],
  categories: ["Malware Command and Control Server"],
  confidenceScore: 95,
  confidenceBucket: "High",
  iocIngestTimestamp: "2026-10-01T08:00:00Z",
  firstSeenTimestamp: "2026-10-18T10:00:00Z",
  lastSeenTimestamp: "2026-10-20T12:30:00Z",
  rawSeverity: "High",
  iocState: "STATUS_MATCHED",
  priority: "HIGH",
  associationIdentifier: [
    { name: "APT29", associationType: "THREAT_ACTOR" },
    { name: "COBALT STRIKE", associationType: "MALWARE" },
  ],
  campaigns: ["Midnight Blizzard 2026"],
  feedName: "Mandiant Fusion",
};

describe("the artifact a match is about", () => {
  test("a domain, lowercased as a STIX value is", () => {
    const ioc: GoogleSecOpsIoc | null = readGoogleSecOpsIocMatch(domainMatch);

    expect(ioc).not.toBeNull();
    expect(ioc!.type).toBe(ThreatIntelIndicatorType.DomainName);
    expect(ioc!.value).toBe("c2.evil.example");
  });

  test.each([
    [{ hashSha256: SHA256 }, ThreatIntelIndicatorType.FileHashSha256, SHA256],
    [
      { hashSha1: "3395856CE81F2B7382DEE72602F798B642F14140" },
      ThreatIntelIndicatorType.FileHashSha1,
      "3395856ce81f2b7382dee72602f798b642f14140",
    ],
    [
      { hashMd5: "44d88612fea8a8f36de82e1278abb02f" },
      ThreatIntelIndicatorType.FileHashMd5,
      "44d88612fea8a8f36de82e1278abb02f",
    ],
    [
      { destinationIpAddress: "203.0.113.7" },
      ThreatIntelIndicatorType.Ipv4Address,
      "203.0.113.7",
    ],
    [
      { destinationIpAddress: "2001:DB8::7" },
      ThreatIntelIndicatorType.Ipv6Address,
      "2001:db8::7",
    ],
  ])("%j", (artifactIndicator: JSONObject, type: string, value: string) => {
    const ioc: GoogleSecOpsIoc | null = readGoogleSecOpsIocMatch({
      artifactIndicator,
    });

    expect(ioc).toMatchObject({ type, value });
  });

  test("an address given as base64 bytes, in the artifact or in ipAndPorts", () => {
    // 203.0.113.7 -> bytes cb 00 71 07.
    const encoded: string = Buffer.from([203, 0, 113, 7]).toString("base64");

    expect(
      readGoogleSecOpsIocMatch({
        artifactIndicator: { destinationIpAddress: encoded },
      }),
    ).toMatchObject({ type: "ipv4-addr", value: "203.0.113.7" });

    expect(
      readGoogleSecOpsIocMatch({
        ipAndPorts: { ipAddress: encoded, ports: [443] },
      }),
    ).toMatchObject({ type: "ipv4-addr", value: "203.0.113.7" });
  });

  test("an IPv6 address as 16 bytes", () => {
    const bytes: Array<number> = [
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x07,
    ];

    expect(
      decodeGoogleSecOpsIpAddress(Buffer.from(bytes).toString("base64")),
    ).toBe("2001:db8:0:0:0:0:0:7");
    expect(
      readGoogleSecOpsIocMatch({
        ipAndPorts: { ipAddress: Buffer.from(bytes).toString("base64") },
      }),
    ).toMatchObject({ type: "ipv6-addr", value: "2001:db8:0:0:0:0:0:7" });
  });

  test("bytes of another length, or no base64 at all, are no address", () => {
    expect(
      decodeGoogleSecOpsIpAddress(Buffer.from([1, 2, 3]).toString("base64")),
    ).toBe("");
    expect(decodeGoogleSecOpsIpAddress("")).toBe("");
    expect(decodeGoogleSecOpsIpAddress("x".repeat(100))).toBe("");
  });

  test("a domain in domainAndPorts", () => {
    expect(
      readGoogleSecOpsIocMatch({
        domainAndPorts: { domain: "Phish.Example", ports: [80] },
      }),
    ).toMatchObject({ type: "domain-name", value: "phish.example" });
  });

  test("a field of the wrong shape is not read as another type", () => {
    // A hash field holding a domain, a domain field holding a hash: neither is trusted.
    expect(
      readGoogleSecOpsIocMatch({
        artifactIndicator: { hashSha256: "evil.example" },
      }),
    ).toBeNull();
    expect(
      readGoogleSecOpsIocMatch({
        artifactIndicator: { domain: SHA256 },
      }),
    ).toBeNull();
  });

  test("a match about nothing OneUptime can match is none", () => {
    for (const match of [
      {},
      { artifactIndicator: {} },
      { artifactIndicator: { domain: 42 } },
      { artifactIndicator: "evil.example" },
      { ipAndPorts: { ipAddress: 7 } },
      { assetIndicators: [{ hostname: "laptop-7" }] },
    ] as Array<JSONObject>) {
      expect(readGoogleSecOpsIocMatch(match)).toBeNull();
    }
  });
});

describe("how sure Google SecOps is", () => {
  test("its score, whole and at most 100", () => {
    expect(googleSecOpsIocConfidence({ confidenceScore: 63 })).toBe(63);
    expect(googleSecOpsIocConfidence({ confidenceScore: "71" })).toBe(71);
    expect(googleSecOpsIocConfidence({ confidenceScore: 140 })).toBe(100);
    expect(googleSecOpsIocConfidence({ confidenceScore: 55.9 })).toBe(55);
  });

  test("its bucket when there is no score", () => {
    expect(googleSecOpsIocConfidence({ confidenceBucket: "High" })).toBe(80);
    expect(googleSecOpsIocConfidence({ confidenceBucket: "medium" })).toBe(50);
    expect(googleSecOpsIocConfidence({ confidenceBucket: "LOW" })).toBe(20);
    expect(googleSecOpsIocConfidence({ confidenceBucket: "unknown" })).toBe(0);
    expect(googleSecOpsIocConfidence({})).toBe(0);
  });

  test("an active breach is Critical, a high priority High at least", () => {
    expect(
      googleSecOpsIocConfidence({
        confidenceScore: 30,
        priority: "ACTIVE_BREACH",
      }),
    ).toBe(90);
    expect(
      googleSecOpsIocConfidence({ confidenceBucket: "low", priority: "HIGH" }),
    ).toBe(70);
    expect(
      googleSecOpsIocConfidence({ confidenceScore: 97, priority: "HIGH" }),
    ).toBe(97);
    expect(
      googleSecOpsIocConfidence({ confidenceScore: 30, priority: "LOW" }),
    ).toBe(30);
  });
});

describe("what the indicator says about itself", () => {
  test("its category and who it is tied to, as one short line, and every label", () => {
    const ioc: GoogleSecOpsIoc = readGoogleSecOpsIocMatch(domainMatch)!;

    expect(ioc.name).toBe(
      "Malware Command and Control Server: APT29, COBALT STRIKE, Midnight Blizzard 2026",
    );
    expect(ioc.labels).toEqual([
      "Malware Command and Control Server",
      "APT29",
      "COBALT STRIKE",
      "Midnight Blizzard 2026",
    ]);
    expect(ioc.confidence).toBe(95);
    expect(ioc.muted).toBe(false);
  });

  test("its first and last sighting, and when its feed says it ends", () => {
    const ioc: GoogleSecOpsIoc = readGoogleSecOpsIocMatch({
      ...domainMatch,
      activeTimerange: {
        startTime: "2026-10-01T00:00:00Z",
        endTime: "2026-11-01T00:00:00Z",
      },
    })!;

    expect(ioc.firstSeen?.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(ioc.lastSeen?.toISOString()).toBe("2026-10-20T12:30:00.000Z");
    expect(ioc.activeUntil?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  test("with no first sighting, when Google SecOps first received it", () => {
    const ioc: GoogleSecOpsIoc = readGoogleSecOpsIocMatch({
      artifactIndicator: { domain: "evil.example" },
      iocIngestTimestamp: "2026-10-01T08:00:00Z",
      lastSeenTimestamp: "not a date",
    })!;

    expect(ioc.firstSeen?.toISOString()).toBe("2026-10-01T08:00:00.000Z");
    expect(ioc.lastSeen).toBeNull();
    expect(ioc.activeUntil).toBeNull();
  });

  test("muted by an analyst in Google SecOps", () => {
    expect(
      readGoogleSecOpsIocMatch({ ...domainMatch, iocState: "STATUS_MUTED" })!
        .muted,
    ).toBe(true);
  });

  test("a long name is cut, labels are capped and deduplicated without regard to case", () => {
    const ioc: GoogleSecOpsIoc = readGoogleSecOpsIocMatch({
      artifactIndicator: { domain: "evil.example" },
      categorization: "Spyware",
      categories: [
        "spyware",
        "Phishing",
        ...Array.from({ length: 30 }, (_: unknown, index: number): string => {
          return `Category ${index}`;
        }),
      ],
      campaigns: ["x".repeat(500)],
    })!;

    expect(ioc.labels).toHaveLength(GOOGLE_SECOPS_IOC_MAX_LABELS);
    expect(ioc.labels.slice(0, 2)).toEqual(["Spyware", "Phishing"]);
    expect(ioc.name.length).toBeLessThanOrEqual(
      GOOGLE_SECOPS_IOC_MAX_NAME_LENGTH,
    );
  });

  test("a match with nothing to say has an empty name and no labels", () => {
    expect(
      readGoogleSecOpsIocMatch({
        artifactIndicator: { domain: "evil.example" },
      }),
    ).toMatchObject({ name: "", labels: [], confidence: 0 });
  });
});

describe("one artifact matched more than once in a window", () => {
  test("is one indicator: the surest confidence, every label, the widest sighting", () => {
    const first: GoogleSecOpsIoc = readGoogleSecOpsIocMatch({
      artifactIndicator: { domain: "evil.example" },
      confidenceScore: 40,
      categories: ["Phishing"],
      firstSeenTimestamp: "2026-10-10T00:00:00Z",
      lastSeenTimestamp: "2026-10-12T00:00:00Z",
    })!;
    const second: GoogleSecOpsIoc = readGoogleSecOpsIocMatch({
      artifactIndicator: { domain: "EVIL.example" },
      confidenceScore: 85,
      categories: ["Malware"],
      firstSeenTimestamp: "2026-10-11T00:00:00Z",
      lastSeenTimestamp: "2026-10-20T00:00:00Z",
    })!;
    const other: GoogleSecOpsIoc = readGoogleSecOpsIocMatch({
      artifactIndicator: { domain: "other.example" },
    })!;

    const merged: Array<GoogleSecOpsIoc> = mergeGoogleSecOpsIocs([
      first,
      other,
      second,
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      value: "evil.example",
      confidence: 85,
      name: "Malware",
      labels: ["Phishing", "Malware"],
    });
    expect(merged[0]!.firstSeen?.toISOString()).toBe(
      "2026-10-10T00:00:00.000Z",
    );
    expect(merged[0]!.lastSeen?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(merged[1]!.value).toBe("other.example");
  });

  test("is muted only when every match of it is", () => {
    const muted: GoogleSecOpsIoc = readGoogleSecOpsIocMatch({
      artifactIndicator: { domain: "evil.example" },
      iocState: "STATUS_MUTED",
    })!;
    const matched: GoogleSecOpsIoc = readGoogleSecOpsIocMatch({
      artifactIndicator: { domain: "evil.example" },
    })!;

    expect(mergeGoogleSecOpsIocs([muted, matched])[0]!.muted).toBe(false);
    expect(mergeGoogleSecOpsIocs([muted, { ...muted }])[0]!.muted).toBe(true);
  });
});
