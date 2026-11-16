import { fingerprintSha256 } from "../../FeatureSet/Telemetry/Utils/FingerprintHash";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import Crypto from "Common/Utils/Crypto";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * EXCEPTION FINGERPRINTS, HASHED BY NODE (#6086).
 *
 * Every exception ingest finds in a log or a span event is fingerprinted
 * twice, and each fingerprint is a SHA-256 in hex. crypto-js (pure
 * JavaScript, Common/Utils/Crypto) did the hashing; Node's own hash now
 * does. A fingerprint names an exception group, so it must not change by a
 * single character: here every text kind is hashed both ways - and a text
 * crypto-js could not hash (a lone surrogate) still fails as it did.
 * ---------------------------------------------------------------------------
 */

function prng(seed: number): () => number {
  let state: number = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t: number = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES: Array<string> = [
  "",
  "TypeError",
  "Cannot read properties of undefined (reading 'id')",
  "\n    at handler (/app/orders.js:12:5)",
  "naïve café",
  "日本語",
  "🚀",
  "\u0000",
  "￿",
  "🚀",
  "x".repeat(3000),
];

describe("fingerprintSha256 is crypto-js's SHA-256, by Node", () => {
  test("3,000 texts of every kind hash to the same hex", () => {
    const random: () => number = prng(6086);

    for (let i: number = 0; i < 3000; i++) {
      let text: string = "";
      const count: number = Math.floor(random() * 6);
      for (let j: number = 0; j < count; j++) {
        text += PIECES[Math.floor(random() * PIECES.length)]!;
      }

      expect(fingerprintSha256(text)).toBe(Crypto.getSha256Hash(text));
    }
  });

  test.each([
    ["a lone high surrogate", "before \ud800 after"],
    ["a lone low surrogate", "before \udc00 after"],
    ["a high surrogate at the end", "end \udbff"],
    ["a low surrogate at the start", "\udfff start"],
    ["two high surrogates", "\ud800𐀀"],
  ])("%s fails as crypto-js fails on it", (_name: string, text: string) => {
    let expected: Error | null = null;

    try {
      Crypto.getSha256Hash(text);
    } catch (error) {
      expected = error as Error;
    }

    expect(expected).toBeInstanceOf(URIError);
    expect(() => {
      return fingerprintSha256(text);
    }).toThrow(expected!.message);
  });

  test("an exception's fingerprints are the ones crypto-js gave", () => {
    const input: {
      message: string;
      stackTrace: string;
      exceptionType: string;
      projectId: ObjectID;
      primaryEntityId: ObjectID;
    } = {
      message: "Cannot read properties of undefined (reading 'id') for 日本",
      stackTrace:
        "TypeError: Cannot read properties of undefined (reading 'id')\n    at handler (/app/orders.js:12:5)\n    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
      exceptionType: "TypeError",
      projectId: new ObjectID("6f0d8bb1-6c55-4a39-a0a9-6b0a4a4e5a10"),
      primaryEntityId: new ObjectID("0e8f0b4c-2f5e-4c9a-9a52-8b6b2d3f1c22"),
    };

    // Grouping v1's preimage, hashed by crypto-js as it was.
    const v1: string = ExceptionUtil.getFingerprint(input as never);
    expect(v1).toBe(
      Crypto.getSha256Hash(
        input.projectId.toString() +
          input.primaryEntityId.toString() +
          ExceptionUtil.normalizeForFingerprint(input.message) +
          ExceptionUtil.normalizeForFingerprint(input.stackTrace) +
          input.exceptionType,
      ),
    );

    /*
     * v2, the hash that picks a new exception's group (its preimage is
     * ExceptionGrouping's): the same function hashes it.
     */
    const v2: string = ExceptionUtil.getFingerprintV2(input as never);
    expect(v2).toMatch(/^[0-9a-f]{64}$/);
    expect(v2).not.toBe(v1);
  });
});
