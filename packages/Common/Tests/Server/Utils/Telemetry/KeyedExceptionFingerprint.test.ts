import { describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import KeyedExceptionFingerprint from "../../../../Server/Utils/Telemetry/KeyedExceptionFingerprint";
import {
  ExceptionGroupingBasis,
  getExceptionGroupingKey,
  getExceptionGroupingText,
} from "../../../../Server/Utils/Telemetry/ExceptionGrouping";
import { normalizeExceptionText } from "../../../../Server/Utils/Telemetry/ExceptionSanitizer";
import ObjectID from "../../../../Types/ObjectID";

/*
 * ---------------------------------------------------------------------------
 * THE FINGERPRINT OF AN EXCEPTION A SCRUB RULE HID PART OF IS KEYED, AND NO
 * ONE CAN WORK IT BACK TO WHAT WAS HIDDEN (#10434).
 *
 * An exception is grouped by what it said as it arrived, before the scrub
 * rules, so a new rule does not split it. Everyone who can read the
 * exception reads its fingerprint, beside the text the rules left: an
 * unkeyed SHA-256 of the text as it arrived gives back a hidden value the
 * normalizer leaves in, a card's last four digits or a Social Security
 * number, to anyone who hashes every guess. These tests hold the keyed one
 * to what the issue asks: the same for one exception every time, another in
 * every other project and installation, a known vector under a fixed secret
 * - and they try to reverse it the way the unkeyed one can be.
 * ---------------------------------------------------------------------------
 */

type KeyedExceptionFingerprintClass = typeof KeyedExceptionFingerprint;

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000e4341",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000e4342",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000e4343",
);

// The secret the known vector below was made with, and no install's.
const KNOWN_VECTOR_SECRET: string =
  "keyed-exception-fingerprint-known-vector-secret";

// An installation's own secret, as one that set ENCRYPTION_SECRET has.
const INSTALL_SECRET: string = "an-installation-secret-that-never-shipped";

// The secrets that ship with OneUptime (EnvironmentConfig), as public as the source.
const PUBLIC_SECRETS: Array<string> = [
  "secret",
  "please-change-this-to-random-value",
];

const HEX_64: RegExp = /^[0-9a-f]{64}$/;

// A message-only exception's grouping v2 text, as ingest builds it.
function groupingTextOf(data: {
  projectId: ObjectID;
  message: string;
}): string {
  return getExceptionGroupingText({
    projectId: data.projectId.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    key: getExceptionGroupingKey({
      exceptionType: "PaymentDeclinedError",
      message: data.message,
    }),
  });
}

// What a card's message said before a Credit Card rule hid the card.
function cardMessage(lastFour: string): string {
  return `card 4111-1111-1111-${lastFour} declined`;
}

// Every last four digits: what anyone who reads the message would try.
function everyLastFour(): Array<string> {
  const candidates: Array<string> = [];

  for (let value: number = 0; value < 10000; value++) {
    candidates.push(value.toString().padStart(4, "0"));
  }

  return candidates;
}

// The unkeyed grouping v2 fingerprint: SHA-256 of the same text.
function unkeyed(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// The keyed fingerprint, as an attacker would make it with a key it guesses.
function keyedWith(secret: string, projectId: ObjectID, text: string): string {
  const key: Buffer = crypto
    .createHmac("sha256", secret)
    .update(`oneuptime-exception-fingerprint:${projectId.toString()}`)
    .digest();

  return crypto.createHmac("sha256", key).update(text, "utf8").digest("hex");
}

// Loads a private copy of the module that hashes with another secret.
function loadWithEncryptionSecret(
  secret: string,
): KeyedExceptionFingerprintClass {
  let loaded: KeyedExceptionFingerprintClass | null = null;

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
        "../../../../Server/Utils/Telemetry/KeyedExceptionFingerprint",
      ) as { default: KeyedExceptionFingerprintClass }
    ).default;
  });

  jest.dontMock("../../../../Server/EnvironmentConfig");

  if (!loaded) {
    throw new Error("module did not load");
  }

  return loaded;
}

describe("an exception's keyed fingerprint", () => {
  const text: string = groupingTextOf({
    projectId: PROJECT_ID,
    message: cardMessage("1234"),
  });

  test("is 64 lowercase hex characters, the shape of every fingerprint", () => {
    expect(
      KeyedExceptionFingerprint.ofGroupingText({
        projectId: PROJECT_ID,
        text,
      }),
    ).toMatch(HEX_64);
  });

  test("is the same for the same exception every time, however the project's id is written", () => {
    const first: string = KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text,
    });

    expect(
      KeyedExceptionFingerprint.ofGroupingText({
        projectId: PROJECT_ID,
        text,
      }),
    ).toBe(first);
    expect(
      KeyedExceptionFingerprint.ofGroupingText({
        projectId: PROJECT_ID.toString().toUpperCase(),
        text,
      }),
    ).toBe(first);
    expect(
      KeyedExceptionFingerprint.ofGroupingText({
        projectId: ` ${PROJECT_ID.toString()} `,
        text,
      }),
    ).toBe(first);
  });

  test("is another for another exception", () => {
    expect(
      KeyedExceptionFingerprint.ofGroupingText({
        projectId: PROJECT_ID,
        text,
      }),
    ).not.toBe(
      KeyedExceptionFingerprint.ofGroupingText({
        projectId: PROJECT_ID,
        text: groupingTextOf({
          projectId: PROJECT_ID,
          message: cardMessage("1235"),
        }),
      }),
    );
  });

  test("is another in another project, for the very same text", () => {
    expect(
      KeyedExceptionFingerprint.ofGroupingText({
        projectId: PROJECT_ID,
        text,
      }),
    ).not.toBe(
      KeyedExceptionFingerprint.ofGroupingText({
        projectId: OTHER_PROJECT_ID,
        text,
      }),
    );
  });

  test("is another under another installation's secret", () => {
    const install: KeyedExceptionFingerprintClass =
      loadWithEncryptionSecret(INSTALL_SECRET);
    const other: KeyedExceptionFingerprintClass = loadWithEncryptionSecret(
      `${INSTALL_SECRET}-2`,
    );

    expect(install.ofGroupingText({ projectId: PROJECT_ID, text })).not.toBe(
      other.ofGroupingText({ projectId: PROJECT_ID, text }),
    );
  });

  test("is not the unkeyed SHA-256 of the text, which grouping v2 stores", () => {
    expect(
      KeyedExceptionFingerprint.ofGroupingText({
        projectId: PROJECT_ID,
        text,
      }),
    ).not.toBe(unkeyed(text));
  });

  test("is made as written: a project key under the secret and a label, then the text under it", () => {
    const install: KeyedExceptionFingerprintClass =
      loadWithEncryptionSecret(KNOWN_VECTOR_SECRET);

    expect(install.ofGroupingText({ projectId: PROJECT_ID, text })).toBe(
      keyedWith(KNOWN_VECTOR_SECRET, PROJECT_ID, text),
    );
    // A known vector, so a change to the label or the derivation is a decision.
    expect(text).toBe(
      [
        "grouping-v2",
        PROJECT_ID.toString(),
        SERVICE_ID.toString(),
        "PaymentDeclinedError",
        ExceptionGroupingBasis.Message,
        "card 4111-1111-1111-1234 declined",
      ].join("\n"),
    );
    expect(install.ofGroupingText({ projectId: PROJECT_ID, text })).toBe(
      "935fae228312840008a04c77c4bd2b7a25ebc2858a06280d5da084940e9b3582",
    );
  });

  test("is not made for no project", () => {
    expect(() => {
      return KeyedExceptionFingerprint.ofGroupingText({
        projectId: "  ",
        text,
      });
    }).toThrow();
  });
});

describe("working a fingerprint back to what a rule hid", () => {
  /*
   * A Credit Card rule left "card [REDACTED] declined" of the message; the
   * fingerprint is of what it said as it arrived. Its last four digits are
   * what is hidden: everyone who reads the exception can try all 10,000.
   */
  const TARGET: string = "4821";

  // The normalizer leaves a card written in groups in what is hashed.
  test("the normalizer keeps the hidden digits in the grouping text", () => {
    expect(normalizeExceptionText(cardMessage(TARGET))).toContain(TARGET);
    expect(
      groupingTextOf({ projectId: PROJECT_ID, message: cardMessage(TARGET) }),
    ).toContain(TARGET);
  });

  function recover(
    fingerprint: string,
    hash: (text: string) => string,
  ): Array<string> {
    return everyLastFour().filter((candidate: string): boolean => {
      return (
        hash(
          groupingTextOf({
            projectId: PROJECT_ID,
            message: cardMessage(candidate),
          }),
        ) === fingerprint
      );
    });
  }

  test("an unkeyed SHA-256 of the text gives the digits back", () => {
    const stolen: string = unkeyed(
      groupingTextOf({ projectId: PROJECT_ID, message: cardMessage(TARGET) }),
    );

    expect(recover(stolen, unkeyed)).toEqual([TARGET]);
  });

  test("the keyed one gives nothing back: unkeyed, under the secrets that ship, or under another project's key", () => {
    const install: KeyedExceptionFingerprintClass =
      loadWithEncryptionSecret(INSTALL_SECRET);
    const stolen: string = install.ofGroupingText({
      projectId: PROJECT_ID,
      text: groupingTextOf({
        projectId: PROJECT_ID,
        message: cardMessage(TARGET),
      }),
    });

    expect(recover(stolen, unkeyed)).toEqual([]);

    for (const secret of PUBLIC_SECRETS) {
      expect(
        recover(stolen, (guess: string): string => {
          return keyedWith(secret, PROJECT_ID, guess);
        }),
      ).toEqual([]);
    }

    // A reader of another project, with that project's key.
    expect(
      recover(stolen, (guess: string): string => {
        return install.ofGroupingText({
          projectId: OTHER_PROJECT_ID,
          text: guess,
        });
      }),
    ).toEqual([]);
  });

  test("only the installation itself, which holds the secret, could", () => {
    const install: KeyedExceptionFingerprintClass =
      loadWithEncryptionSecret(INSTALL_SECRET);
    const stolen: string = install.ofGroupingText({
      projectId: PROJECT_ID,
      text: groupingTextOf({
        projectId: PROJECT_ID,
        message: cardMessage(TARGET),
      }),
    });

    // The attempt above is sound: with the key, the same search finds it.
    expect(
      recover(stolen, (guess: string): string => {
        return install.ofGroupingText({
          projectId: PROJECT_ID,
          text: guess,
        });
      }),
    ).toEqual([TARGET]);
  });
});
