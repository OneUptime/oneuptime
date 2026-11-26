import crypto from "crypto";
import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import DetectionFingerprint, {
  DETECTION_FINGERPRINT_PATTERN,
  DetectionFingerprintKind,
} from "../../../../Server/Utils/SecurityEvent/DetectionFingerprint";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "../../../../Types/ObjectID";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE FINGERPRINT OF WHAT A DETECTION IS ABOUT (#11130): keyed in its
 * project, so a guessed value cannot be fingerprinted outside OneUptime,
 * with the unkeyed form it had before kept to match what was opened under
 * it.
 */

type DetectionFingerprintClass = typeof DetectionFingerprint;

const PROJECT_ID: ObjectID = new ObjectID(
  "11130000-0000-4000-8000-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11130000-0000-4000-8000-0000000000a2",
);
const RULE_ID: ObjectID = new ObjectID("11130000-0000-4000-8000-0000000000b1");
const FEED_ID: ObjectID = new ObjectID("11130000-0000-4000-8000-0000000000c1");

const ALICE: string = "alice@example.com";

// The keyed fingerprint, worked out here on its own: what the module must make.
function expectedKeyed(data: {
  secret: string;
  projectId: ObjectID;
  label: string;
  value: string;
}): string {
  const key: Buffer = crypto
    .createHmac("sha256", data.secret)
    .update(
      `oneuptime-security-detection-fingerprint:${data.projectId.toString()}`,
    )
    .digest();

  const hex: string = crypto
    .createHmac("sha256", key)
    .update(`${data.label}=${data.value}`)
    .digest("hex");

  for (let offset: number = 0; offset + 16 <= hex.length; offset += 16) {
    const part: string = hex.slice(offset, offset + 16);

    if (!/^[0-9]+$/.test(part)) {
      return part;
    }
  }

  return "f" + hex.slice(1, 16);
}

// Loads a private copy of the module that keys with another secret.
function loadWithEncryptionSecret(secret: string): DetectionFingerprintClass {
  let loaded: DetectionFingerprintClass | null = null;

  jest.isolateModules((): void => {
    jest.doMock("../../../../Server/EnvironmentConfig", (): unknown => {
      return {
        ...(jest.requireActual(
          "../../../../Server/EnvironmentConfig",
        ) as Record<string, unknown>),
        EncryptionSecret: new ObjectID(secret),
      };
    });

    loaded = (
      jest.requireActual(
        "../../../../Server/Utils/SecurityEvent/DetectionFingerprint",
      ) as { default: DetectionFingerprintClass }
    ).default;
  });

  jest.dontMock("../../../../Server/EnvironmentConfig");

  if (!loaded) {
    throw new Error("module did not load");
  }

  return loaded;
}

describe("DetectionFingerprint.of", () => {
  test.each([
    [DetectionFingerprintKind.DetectionRule, "groupValue"],
    [DetectionFingerprintKind.ThreatIntel, "indicatorValue"],
  ])(
    "a %s's is the keyed HMAC of its canonical text in the project",
    (kind: DetectionFingerprintKind, label: string) => {
      expect(
        DetectionFingerprint.of({ projectId: PROJECT_ID, kind, value: ALICE }),
      ).toBe(
        expectedKeyed({
          secret: EncryptionSecret.toString(),
          projectId: PROJECT_ID,
          label,
          value: ALICE,
        }),
      );
    },
  );

  test("is 16 lowercase hex characters, the shape it always had", () => {
    const fingerprint: string = DetectionFingerprint.of({
      projectId: PROJECT_ID,
      kind: DetectionFingerprintKind.DetectionRule,
      value: ALICE,
    });

    expect(fingerprint).toMatch(DETECTION_FINGERPRINT_PATTERN);
    expect(fingerprint).toHaveLength(16);
  });

  test("the same value makes the same fingerprint in its project, every time", () => {
    const first: string = DetectionFingerprint.of({
      projectId: PROJECT_ID,
      kind: DetectionFingerprintKind.DetectionRule,
      value: ALICE,
    });

    expect(
      DetectionFingerprint.of({
        projectId: PROJECT_ID.toString().toUpperCase(),
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      }),
    ).toBe(first);
    expect(
      DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      }),
    ).toBe(first);
  });

  test("another project fingerprints the same value differently", () => {
    expect(
      DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      }),
    ).not.toBe(
      DetectionFingerprint.of({
        projectId: OTHER_PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      }),
    );
  });

  test("a rule's group and a feed's indicator of the same value differ", () => {
    expect(
      DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      }),
    ).not.toBe(
      DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.ThreatIntel,
        value: ALICE,
      }),
    );
  });

  test("cannot be worked out from a guess: it is not the unkeyed SHA-256 of the guess", () => {
    const guess: string = ALICE;
    const unkeyed: string = crypto
      .createHash("sha256")
      .update(`groupValue=${guess}`)
      .digest("hex")
      .slice(0, 16);

    expect(
      DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: guess,
      }),
    ).not.toBe(unkeyed);
    expect(
      DetectionFingerprint.legacyOf({
        kind: DetectionFingerprintKind.DetectionRule,
        value: guess,
      }),
    ).toBe(unkeyed);
  });

  test("changes with ENCRYPTION_SECRET: no one without it makes the same", () => {
    const otherSecret: DetectionFingerprintClass = loadWithEncryptionSecret(
      "11130000-0000-4000-8000-00000000ffff",
    );
    const sameSecret: DetectionFingerprintClass = loadWithEncryptionSecret(
      EncryptionSecret.toString(),
    );
    const of: (module: DetectionFingerprintClass) => string = (
      module: DetectionFingerprintClass,
    ): string => {
      return module.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      });
    };

    expect(of(otherSecret)).not.toBe(of(DetectionFingerprint));
    expect(of(sameSecret)).toBe(of(DetectionFingerprint));
  });

  test("is not what a Hash scrub rule leaves for the same text: its key is its own", () => {
    for (const value of [ALICE, `groupValue=${ALICE}`]) {
      const tokenHex: string = ScrubHashToken.ofValue({
        projectId: PROJECT_ID,
        value,
      }).slice("[HASHED:".length, -1);

      expect(
        DetectionFingerprint.of({
          projectId: PROJECT_ID,
          kind: DetectionFingerprintKind.DetectionRule,
          value: ALICE,
        }),
      ).not.toBe(tokenHex);
    }
  });

  test("a group of nothing keeps the fingerprint it always had", () => {
    for (const value of ["", undefined, null]) {
      expect(
        DetectionFingerprint.of({
          projectId: PROJECT_ID,
          kind: DetectionFingerprintKind.DetectionRule,
          value,
        }),
      ).toBe(MetricSeriesFingerprint.computeFingerprint({ groupValue: "" }));
    }
  });

  test("is never sixteen digits, a card number's shape", () => {
    for (let index: number = 0; index < 3000; index++) {
      expect(
        DetectionFingerprint.of({
          projectId: PROJECT_ID,
          kind: DetectionFingerprintKind.DetectionRule,
          value: `user-${index}@example.com`,
        }),
      ).toMatch(/[a-f]/);
    }
  });

  test("project ids that are empty are refused", () => {
    expect(() => {
      return DetectionFingerprint.of({
        projectId: "  ",
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      });
    }).toThrow();
  });
});

describe("DetectionFingerprint.legacyOf", () => {
  test("is exactly what MetricSeriesFingerprint made before #11130", () => {
    expect(
      DetectionFingerprint.legacyOf({
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      }),
    ).toBe(MetricSeriesFingerprint.computeFingerprint({ groupValue: ALICE }));
    expect(
      DetectionFingerprint.legacyOf({
        kind: DetectionFingerprintKind.ThreatIntel,
        value: "203.0.113.7",
      }),
    ).toBe(
      MetricSeriesFingerprint.computeFingerprint({
        indicatorValue: "203.0.113.7",
      }),
    );
  });
});

describe("DetectionFingerprint.allOf and ofSource", () => {
  test("the keyed fingerprint first, then the unkeyed one", () => {
    expect(
      DetectionFingerprint.allOf({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      }),
    ).toEqual([
      DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      }),
      DetectionFingerprint.legacyOf({
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      }),
    ]);
  });

  test("one for a group of nothing, which never changed", () => {
    expect(
      DetectionFingerprint.allOf({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: "",
      }),
    ).toEqual([MetricSeriesFingerprint.computeFingerprint({ groupValue: "" })]);
  });

  test("a rule's: detection-rule:<rule id>:<fingerprint>, the one before as its former", () => {
    expect(
      DetectionFingerprint.ofSource({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        sourceId: RULE_ID,
        value: ALICE,
      }),
    ).toEqual({
      fingerprint: `detection-rule:${RULE_ID.toString()}:${DetectionFingerprint.of(
        {
          projectId: PROJECT_ID,
          kind: DetectionFingerprintKind.DetectionRule,
          value: ALICE,
        },
      )}`,
      formerFingerprints: [
        `detection-rule:${RULE_ID.toString()}:${MetricSeriesFingerprint.computeFingerprint(
          { groupValue: ALICE },
        )}`,
      ],
    });
  });

  test("a feed's: threat-intel:<feed id>:<fingerprint>", () => {
    const fingerprints: {
      fingerprint: string;
      formerFingerprints: Array<string>;
    } = DetectionFingerprint.ofSource({
      projectId: PROJECT_ID,
      kind: DetectionFingerprintKind.ThreatIntel,
      sourceId: FEED_ID,
      value: "203.0.113.7",
    });

    expect(fingerprints.fingerprint).toBe(
      `threat-intel:${FEED_ID.toString()}:${DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.ThreatIntel,
        value: "203.0.113.7",
      })}`,
    );
    expect(fingerprints.formerFingerprints).toEqual([
      `threat-intel:${FEED_ID.toString()}:${MetricSeriesFingerprint.computeFingerprint(
        { indicatorValue: "203.0.113.7" },
      )}`,
    ]);
  });

  test("a rule that groups on nothing has no former fingerprint", () => {
    expect(
      DetectionFingerprint.ofSource({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        sourceId: RULE_ID,
        value: "",
      }),
    ).toEqual({
      fingerprint: `detection-rule:${RULE_ID.toString()}:${MetricSeriesFingerprint.computeFingerprint(
        { groupValue: "" },
      )}`,
      formerFingerprints: [],
    });
  });
});
