import { describe, expect, test } from "@jest/globals";
import {
  ExceptionGroupFingerprintsOfException,
  MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP,
  MAX_MERGED_FINGERPRINTS_PER_EXCEPTION,
  readExceptionGroupFingerprints,
} from "../../../Types/Telemetry/ExceptionGroupFingerprints";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * The Dashboard reads the group fingerprints route's answer back
 * defensively (readExceptionGroupFingerprints): each exception with an id
 * and its own fingerprint first, the rest held to the group's bound, and
 * anything that is not one left out rather than thrown on.
 */

const ID: string = "80000000-0000-4000-8000-000000000001";

describe("reading the group fingerprints answer", () => {
  test("each exception, in the answer's order, its own fingerprint first", () => {
    expect(
      readExceptionGroupFingerprints({
        exceptions: [
          { telemetryExceptionId: ` ${ID} `, fingerprints: ["a", "b", "c"] },
          { telemetryExceptionId: "other", fingerprints: ["d"] },
        ],
      }),
    ).toEqual([
      { telemetryExceptionId: ID, fingerprints: ["a", "b", "c"] },
      { telemetryExceptionId: "other", fingerprints: ["d"] },
    ]);
  });

  test("what is not an answer reads as nothing", () => {
    for (const value of [
      undefined,
      null,
      "exceptions",
      7,
      [],
      {},
      { exceptions: "x" },
      { exceptions: {} },
    ]) {
      expect(readExceptionGroupFingerprints(value)).toEqual([]);
    }
  });

  test("an entry without an id, or without its own fingerprint first, is left out", () => {
    expect(
      readExceptionGroupFingerprints({
        exceptions: [
          null,
          "x",
          { fingerprints: ["a"] },
          { telemetryExceptionId: 7, fingerprints: ["a"] },
          { telemetryExceptionId: "  ", fingerprints: ["a"] },
          { telemetryExceptionId: ID },
          { telemetryExceptionId: ID, fingerprints: "a" },
          { telemetryExceptionId: ID, fingerprints: [] },
          { telemetryExceptionId: ID, fingerprints: [7, "b"] },
          { telemetryExceptionId: ID, fingerprints: ["", "b"] },
          { telemetryExceptionId: ID, fingerprints: ["kept"] },
        ],
      }),
    ).toEqual([{ telemetryExceptionId: ID, fingerprints: ["kept"] }]);
  });

  test("the merged ones lose blanks, repeats and anything that is not text, and are held to the bound", () => {
    const merged: Array<string> = Array.from(
      { length: MAX_MERGED_FINGERPRINTS_PER_EXCEPTION + 7 },
      (_value: unknown, index: number): string => {
        return `m-${index}`;
      },
    );

    const read: Array<ExceptionGroupFingerprintsOfException> =
      readExceptionGroupFingerprints({
        exceptions: [
          {
            telemetryExceptionId: ID,
            fingerprints: ["own", "", 3, "own", null, ...merged],
          },
        ],
      });

    expect(read[0]!.fingerprints).toEqual([
      "own",
      ...merged.slice(0, MAX_MERGED_FINGERPRINTS_PER_EXCEPTION),
    ]);
  });

  test("the lookup takes as many exceptions as the monitor preview leaves out of a status", () => {
    expect(MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP).toBe(1000);
  });

  /*
   * A seeded sweep over answers of random shape: whatever arrives, every
   * entry read has an id, its own fingerprint first, no blank or repeat,
   * and no more than the bound - and an answer the server would write is
   * read back as it was written.
   */
  test("a seeded sweep: whatever arrives, what is read is well formed, and a well-formed answer reads as written", () => {
    const random: SeededRandom = seededRandom(6151);
    const pieces: Array<unknown> = ["a", "b", "", " ", 0, null, {}, "c", "a"];

    for (let round: number = 0; round < 2000; round++) {
      const written: Array<ExceptionGroupFingerprintsOfException> = [];
      const sent: Array<unknown> = [];

      for (let entry: number = 0; entry < random(6); entry++) {
        if (random(3) === 0) {
          // A well-formed entry, as the server writes it.
          const fingerprints: Array<string> = Array.from(
            { length: 1 + random(MAX_MERGED_FINGERPRINTS_PER_EXCEPTION + 1) },
            (_value: unknown, index: number): string => {
              return `fp-${round}-${entry}-${index}`;
            },
          );
          const telemetryExceptionId: string = `id-${round}-${entry}`;
          written.push({ telemetryExceptionId, fingerprints });
          sent.push({ telemetryExceptionId, fingerprints });
        } else {
          sent.push({
            telemetryExceptionId: random(2) === 0 ? `id-${round}` : random(9),
            fingerprints: Array.from({ length: random(8) }, () => {
              return pieces[random(pieces.length)];
            }),
          });
        }
      }

      const read: Array<ExceptionGroupFingerprintsOfException> =
        readExceptionGroupFingerprints({ exceptions: sent });

      for (const entry of read) {
        expect(entry.telemetryExceptionId.length).toBeGreaterThan(0);
        expect(entry.fingerprints.length).toBeGreaterThan(0);
        expect(entry.fingerprints.length).toBeLessThanOrEqual(
          MAX_MERGED_FINGERPRINTS_PER_EXCEPTION + 1,
        );
        expect(new Set(entry.fingerprints).size).toBe(
          entry.fingerprints.length,
        );
        for (const fingerprint of entry.fingerprints) {
          expect(typeof fingerprint).toBe("string");
          expect(fingerprint.length).toBeGreaterThan(0);
        }
      }

      for (const entry of written) {
        expect(read).toContainEqual(entry);
      }
    }
  });
});
