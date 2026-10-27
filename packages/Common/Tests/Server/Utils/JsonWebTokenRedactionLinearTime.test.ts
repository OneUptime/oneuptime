import ToolResultSerializer from "../../../Server/Utils/AI/Toolbox/Serializer";
import { REDACTED, redactLogString } from "../../../Server/Utils/LogRedaction";
import {
  normalizeExceptionText,
  sanitizeExceptionMessage,
} from "../../../Server/Utils/Telemetry/ExceptionSanitizer";
import KubectlOutputRedactor from "../../../Utils/AiRemediation/KubectlOutputRedactor";
import { GenericOutputRedactor } from "../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * EVERY RULE THAT FINDS A JWT IN TEXT READS THE TEXT IN TIME IN LINE WITH ITS
 * LENGTH, AND STILL FINDS EXACTLY THE TOKENS IT FOUND BEFORE.
 *
 * A JWT is "eyJ" and three runs of base64url characters split by dots, and
 * it is looked for in text somebody outside wrote: the server's own log
 * lines (which quote requests), tool results and cluster or resource output
 * on their way to a model, and exception messages at ingest. Each rule now
 * looks for a token once per run of the characters a token is made of, from
 * the first place in the run one may begin, instead of again from every
 * "eyJ" in it - so a run of 400,000 characters is read in well under two
 * seconds - and the runs it replaces are exactly the ones it replaced
 * before, of any length: no bound on a segment's size, nothing more and
 * nothing less.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const WORST_CASES: Array<[string, string]> = [
  ["token starts run together", repeat("eyJ", LENGTH)],
  ["token starts between hyphens", repeat("-eyJ-", LENGTH)],
  ["short token starts after hyphens", repeat("eyJab-", LENGTH)],
  ["a first segment over and over", repeat("eyJeeeeeeeeee", LENGTH)],
  [
    "many first segments before one long second",
    repeat("eyJ".repeat(170) + "." + "a".repeat(16384) + "!", LENGTH),
  ],
  [
    "two segments and no third",
    repeat("-eyJaaaaaaaaaa.eyJaaaaaaaaaa.", LENGTH),
  ],
  [
    "first segments joined by underscores",
    repeat("eyJ_aaaaaaaaaa_", LENGTH) + ".",
  ],
];

interface Redactor {
  name: string;
  redact: (text: string) => string;
  // What the redactor puts where a token was.
  tokenMarker: string;
}

const REDACTORS: Array<Redactor> = [
  {
    name: "server log redaction",
    redact: (text: string): string => {
      return redactLogString(text);
    },
    tokenMarker: REDACTED,
  },
  {
    name: "tool result redaction",
    redact: (text: string): string => {
      return ToolResultSerializer.redact(text).text;
    },
    tokenMarker: "[redacted-jwt]",
  },
  {
    name: "exception fingerprinting",
    redact: (text: string): string => {
      return normalizeExceptionText(text);
    },
    tokenMarker: "<JWT>",
  },
  {
    name: "exception message sanitizing",
    redact: (text: string): string => {
      return sanitizeExceptionMessage(text);
    },
    tokenMarker: "<JWT>",
  },
  {
    name: "cluster output redaction",
    redact: (text: string): string => {
      return KubectlOutputRedactor.redact(text).text;
    },
    tokenMarker: "[redacted-jwt]",
  },
  {
    name: "resource output redaction",
    redact: (text: string): string => {
      return GenericOutputRedactor.redact(text).text;
    },
    tokenMarker: "[redacted-jwt]",
  },
];

describe.each(REDACTORS)(
  "$name reads a JWT-shaped text in time in line with its length",
  (redactor: Redactor) => {
    test.each(WORST_CASES)("%s", (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          redactor.redact(text);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    });
  },
);

// Three real-shaped tokens: an ordinary one, and two longer than any bound a segment could have been given.
const SIGNATURE: string = "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const ORDINARY_TOKEN: string = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${SIGNATURE}`;
// A header carrying a certificate chain (x5c) runs to kilobytes.
const LONG_HEADER_TOKEN: string = `eyJ${"x5cMIIC".repeat(700)}.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${SIGNATURE}`;
// A token with many claims.
const LONG_PAYLOAD_TOKEN: string = `eyJhbGciOiJIUzI1NiJ9.eyJ${"Z3JvdXBz".repeat(2600)}.${SIGNATURE}`;

/*
 * In text that names no credential, so it is the token rule itself - not a
 * rule for an Authorization header or a key name - that has to find it.
 */
describe.each(REDACTORS)("$name still finds a token", (redactor: Redactor) => {
  test.each([
    ["an ordinary token", ORDINARY_TOKEN],
    ["a token with a header of kilobytes", LONG_HEADER_TOKEN],
    ["a token with a payload of tens of kilobytes", LONG_PAYLOAD_TOKEN],
  ])("%s", (_label: string, token: string) => {
    expect(redactor.redact(`failed with ${token} at login`)).toBe(
      `failed with ${redactor.tokenMarker} at login`,
    );
  });
});

describe("a token is found where it was found before", () => {
  test("after a hyphen, by the rules that start at a word boundary", () => {
    expect(redactLogString(`id-${ORDINARY_TOKEN} end`)).toBe(
      `id-${REDACTED} end`,
    );
    expect(normalizeExceptionText(`bad session-${ORDINARY_TOKEN}`)).toBe(
      "bad session-<JWT>",
    );
  });

  test("glued to the text before it, by the rules that start anywhere", () => {
    // "%3D" is a URL-encoded "=": the token is glued to the "D".
    expect(
      ToolResultSerializer.redact(`next=%3D${ORDINARY_TOKEN}&x=1`).text,
    ).toBe("next=%3D[redacted-jwt]&x=1");
    expect(
      KubectlOutputRedactor.redact(`next=%3D${ORDINARY_TOKEN} x`).text,
    ).toBe("next=%3D[redacted-jwt] x");
    expect(
      GenericOutputRedactor.redact(`next=%3D${ORDINARY_TOKEN} x`).text,
    ).toBe("next=%3D[redacted-jwt] x");
  });

  test("two tokens side by side are both replaced", () => {
    expect(
      ToolResultSerializer.redact(`${ORDINARY_TOKEN} ${ORDINARY_TOKEN}`).text,
    ).toBe("[redacted-jwt] [redacted-jwt]");
    expect(redactLogString(`${ORDINARY_TOKEN},${ORDINARY_TOKEN}`)).toBe(
      `${REDACTED},${REDACTED}`,
    );
    expect(
      normalizeExceptionText(`${ORDINARY_TOKEN} and ${ORDINARY_TOKEN}`),
    ).toBe("<JWT> and <JWT>");
  });

  test("a counted redaction counts each token once", () => {
    expect(
      ToolResultSerializer.redact(`${ORDINARY_TOKEN} ${ORDINARY_TOKEN}`).count,
    ).toBe(2);
    expect(
      KubectlOutputRedactor.redact(`a ${ORDINARY_TOKEN}\nb ${ORDINARY_TOKEN}`)
        .redactionCount,
    ).toBeGreaterThanOrEqual(2);
  });
});

/*
 * The rules as they were - a search from every "eyJ" (or every word
 * boundary) - kept here only as the reference each rule must agree with, on
 * texts drawn from an alphabet no other rule of the function reacts to.
 */
interface ExactnessCase {
  name: string;
  before: RegExp;
  replacement: string;
  alphabet: ReadonlyArray<string>;
  redact: (text: string) => string;
}

const EXACTNESS_CASES: Array<ExactnessCase> = [
  {
    name: "tool result redaction",
    before: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
    replacement: "[redacted-jwt]",
    alphabet: [
      "eyJxyzQRSTUVW.",
      "eyJxyzQRSTUVW",
      "xyzQRSTUVW.",
      "xyzQRSTUVW",
      "xyzQR",
      "eyJ",
      "Q",
      "-",
      "_",
      ".",
      " ",
      "!",
      "%3D",
    ],
    redact: (text: string): string => {
      return ToolResultSerializer.redact(text).text;
    },
  },
  {
    name: "server log redaction",
    before: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
    replacement: REDACTED,
    alphabet: [
      "eyJxyzQR.",
      "eyJxyzQR",
      "xyzQR.",
      "xyzQR",
      "eyJ",
      "Q",
      "-",
      "-",
      "_",
      ".",
      " ",
      "!",
      "%3D",
    ],
    redact: (text: string): string => {
      return redactLogString(text);
    },
  },
  {
    name: "exception fingerprinting",
    before: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/g,
    replacement: "<JWT>",
    alphabet: [
      "eyJ.",
      "eyJx.",
      "eyJ",
      "x",
      "x.",
      "Q",
      "-",
      "-",
      ".",
      " ",
      "!",
      "%",
    ],
    redact: (text: string): string => {
      return normalizeExceptionText(text);
    },
  },
];

describe.each(EXACTNESS_CASES)(
  "$name replaces exactly the tokens it replaced before",
  (exactness: ExactnessCase) => {
    test("on twenty thousand drawn texts", () => {
      const mismatches: Array<{ text: string; now: string; before: string }> =
        [];
      let replaced: number = 0;

      for (const text of generatedTexts(20000, 4242, exactness.alphabet, 14)) {
        const before: string = text.replace(
          new RegExp(exactness.before.source, exactness.before.flags),
          exactness.replacement,
        );
        const now: string = exactness.redact(text);

        if (before !== text) {
          replaced++;
        }

        if (now !== before) {
          mismatches.push({ text, now, before });
        }
      }

      expect(mismatches.slice(0, 5)).toEqual([]);
      // The drawn texts hold tokens in every arrangement, not just none.
      expect(replaced).toBeGreaterThan(500);
    });
  },
);
