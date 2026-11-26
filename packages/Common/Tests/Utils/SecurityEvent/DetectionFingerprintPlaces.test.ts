import {
  DetectionFingerprintKind,
  getFindingUidPlaces,
  getFiringKeyPlaces,
  getSourceFingerprintPlaces,
  putFingerprintAt,
  rewriteFingerprintIn,
} from "../../../Utils/SecurityEvent/DetectionFingerprintPlaces";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE A DETECTION'S FINGERPRINT STANDS (#11130): in a source's
 * fingerprint, a Detection Finding's eventUid and a firing's name, and the
 * text with another fingerprint there. The erasure's ClickHouse statement
 * does to a finding's id what putFingerprintAt does; the shapes here are
 * the ones DetectionRuleEvaluator and ThreatIntelMatcher write.
 */

const RULE: string = "11130000-0000-4000-8000-0000000000b1";
const FEED: string = "11130000-0000-4000-8000-0000000000c1";
const OLD: string = "0123456789abcdef";
const NEW: string = "fedcba9876543210";

describe("getSourceFingerprintPlaces", () => {
  test("a rule's and a feed's fingerprint keep it third", () => {
    expect(getSourceFingerprintPlaces(`detection-rule:${RULE}:${OLD}`)).toEqual(
      {
        source: DetectionFingerprintKind.DetectionRule,
        positions: [3],
        fingerprint: OLD,
      },
    );
    expect(getSourceFingerprintPlaces(`threat-intel:${FEED}:${OLD}`)).toEqual({
      source: DetectionFingerprintKind.ThreatIntel,
      positions: [3],
      fingerprint: OLD,
    });
  });

  test.each([
    [`detection-rule:${RULE}:overflow`],
    [`threat-intel:${FEED}:overflow`],
    ["entity-risk:alice@example.com"],
    [`connection:${RULE}:abc`],
    [`logs:${OLD}`],
    [`detection-rule:${RULE}:${OLD}:extra`],
    [`detection-rule::${OLD}`],
    [`detection-rule:${RULE}:0123456789ABCDEF`],
    [`detection-rule:${RULE}:0123`],
    [""],
  ])("%s keeps none", (text: string) => {
    expect(getSourceFingerprintPlaces(text)).toBeNull();
  });

  test("nothing for no text", () => {
    expect(getSourceFingerprintPlaces(undefined)).toBeNull();
    expect(getSourceFingerprintPlaces(null)).toBeNull();
  });
});

describe("getFindingUidPlaces", () => {
  test("a scheduled run's finding keeps it in its fingerprint and its firing's name", () => {
    expect(
      getFindingUidPlaces(
        `detection:${RULE}:detection-rule:${RULE}:${OLD}:run:1764000000000:1764000060000:${OLD}`,
      ),
    ).toEqual({
      source: DetectionFingerprintKind.DetectionRule,
      positions: [5, 9],
      fingerprint: OLD,
    });
    expect(
      getFindingUidPlaces(
        `detection:${RULE}:detection-rule:${RULE}:${OLD}:run:1764000000000:each:${OLD}`,
      ),
    ).toEqual({
      source: DetectionFingerprintKind.DetectionRule,
      positions: [5, 9],
      fingerprint: OLD,
    });
  });

  test("a finding named by when it was written keeps it once", () => {
    expect(
      getFindingUidPlaces(
        `detection:${RULE}:detection-rule:${RULE}:${OLD}:1764000000123456789`,
      ),
    ).toEqual({
      source: DetectionFingerprintKind.DetectionRule,
      positions: [5],
      fingerprint: OLD,
    });
    expect(
      getFindingUidPlaces(
        `threat-intel:${FEED}:threat-intel:${FEED}:${OLD}:1764000000123456789`,
      ),
    ).toEqual({
      source: DetectionFingerprintKind.ThreatIntel,
      positions: [5],
      fingerprint: OLD,
    });
  });

  test.each([
    // An id a connected product gave.
    ["4f1c2b9e-2a6d-4c8e-9f3b-1d2e3f4a5b6c"],
    // A rule's id with another rule's fingerprint.
    [
      `detection:${RULE}:detection-rule:11130000-0000-4000-8000-0000000000b2:${OLD}:1764000000123456789`,
    ],
    // A firing whose name carries another fingerprint.
    [
      `detection:${RULE}:detection-rule:${RULE}:${OLD}:run:1764000000000:each:${NEW}`,
    ],
    // A feed's id in a rule's shape.
    [`threat-intel:${FEED}:detection-rule:${FEED}:${OLD}:1764000000123456789`],
    [`detection:${RULE}:detection-rule:${RULE}:${OLD}`],
    [`detection:${RULE}:detection-rule:${RULE}:${OLD}:run:x:each:${OLD}`],
    [`detection:${RULE}:detection-rule:${RULE}:overflow:1764000000123456789`],
    [`threat-intel:${FEED}:threat-intel:${FEED}:${OLD}:run:1:each:${OLD}`],
    [""],
  ])("%s keeps none", (eventUid: string) => {
    expect(getFindingUidPlaces(eventUid)).toBeNull();
  });
});

describe("getFiringKeyPlaces", () => {
  test("a firing keeps its group's fingerprint last", () => {
    expect(getFiringKeyPlaces(`run:1764000000000:each:${OLD}`)).toEqual({
      source: DetectionFingerprintKind.DetectionRule,
      positions: [4],
      fingerprint: OLD,
    });
    expect(
      getFiringKeyPlaces(`run:1764000000000:1764000060000:${OLD}`),
    ).toEqual({
      source: DetectionFingerprintKind.DetectionRule,
      positions: [4],
      fingerprint: OLD,
    });
  });

  test.each([
    ["run:1764000000000:each:overflow"],
    [`run:1764000000000:${OLD}`],
    [`run:x:each:${OLD}`],
    [`walk:1764000000000:each:${OLD}`],
    [`run:1764000000000:each:${OLD}:more`],
  ])("%s keeps none", (firingKey: string) => {
    expect(getFiringKeyPlaces(firingKey)).toBeNull();
  });
});

describe("putFingerprintAt and rewriteFingerprintIn", () => {
  test("the new fingerprint in every place, the rest of the text its own", () => {
    const eventUid: string = `detection:${RULE}:detection-rule:${RULE}:${OLD}:run:1764000000000:each:${OLD}`;

    expect(
      rewriteFingerprintIn({
        text: eventUid,
        placesOf: getFindingUidPlaces,
        fingerprint: NEW,
      }),
    ).toBe(
      `detection:${RULE}:detection-rule:${RULE}:${NEW}:run:1764000000000:each:${NEW}`,
    );
    expect(
      rewriteFingerprintIn({
        text: `detection-rule:${RULE}:${OLD}`,
        placesOf: getSourceFingerprintPlaces,
        fingerprint: NEW,
      }),
    ).toBe(`detection-rule:${RULE}:${NEW}`);
    expect(
      rewriteFingerprintIn({
        text: `run:1764000000000:each:${OLD}`,
        placesOf: getFiringKeyPlaces,
        fingerprint: NEW,
      }),
    ).toBe(`run:1764000000000:each:${NEW}`);
  });

  test("a text with no place is left as it was", () => {
    expect(
      rewriteFingerprintIn({
        text: `detection-rule:${RULE}:overflow`,
        placesOf: getSourceFingerprintPlaces,
        fingerprint: NEW,
      }),
    ).toBe(`detection-rule:${RULE}:overflow`);
  });

  test("a rewritten text keeps its shape, so it can be rewritten again", () => {
    const eventUid: string = `threat-intel:${FEED}:threat-intel:${FEED}:${OLD}:1764000000123456789`;
    const once: string = rewriteFingerprintIn({
      text: eventUid,
      placesOf: getFindingUidPlaces,
      fingerprint: NEW,
    });

    expect(getFindingUidPlaces(once)).toEqual({
      source: DetectionFingerprintKind.ThreatIntel,
      positions: [5],
      fingerprint: NEW,
    });
    expect(
      rewriteFingerprintIn({
        text: once,
        placesOf: getFindingUidPlaces,
        fingerprint: NEW,
      }),
    ).toBe(once);
  });

  test("puts the fingerprint only where the places say", () => {
    expect(
      putFingerprintAt({
        text: "a:b:c:d",
        places: {
          source: DetectionFingerprintKind.DetectionRule,
          positions: [2, 4],
          fingerprint: "b",
        },
        fingerprint: "x",
      }),
    ).toBe("a:x:c:x");
  });
});
