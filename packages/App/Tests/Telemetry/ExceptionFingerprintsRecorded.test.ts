/*
 * ---------------------------------------------------------------------------
 * NO EXCEPTION THAT EXISTS CHANGES ITS FINGERPRINT (#10898).
 *
 * Every exception is found by the fingerprint it was made under: grouping
 * v1's, v2's or v3's, or the keyed one of each a scrub rule's occurrence
 * made (KeyedExceptionFingerprint). A new grouping version is tried after
 * them (ExceptionUtil.getOccurrenceFingerprints), so an occurrence that finds
 * an exception under one of them still lands on it: nothing splits, and two
 * exceptions that exist never merge.
 *
 * Fixtures/ExceptionFingerprintsRecorded/fingerprints.json holds what the
 * code gave, before grouping v4, for every exception of
 * Helpers/ExceptionFingerprintCorpus: the texts v1, v2 and v3 hash, their
 * fingerprints and keyed fingerprints, and the occurrence's fingerprints as
 * it arrived untouched, and as a span's and a log's when a rule changed it.
 * These tests hold today's code to it, byte for byte, and resolve an
 * occurrence against an exception under each fingerprint it tried before.
 *
 * Keyed fingerprints are made with one fixed ENCRYPTION_SECRET here, so the
 * file is the same on every machine. To record it again - only on main's
 * code, never to make a change pass: RECORD_EXCEPTION_FINGERPRINTS=1.
 * ---------------------------------------------------------------------------
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const ObjectIDType: new (value: string) => unknown = (
    jest.requireActual("Common/Types/ObjectID") as {
      default: new (value: string) => unknown;
    }
  ).default;

  return {
    ...actual,
    __esModule: true,
    EncryptionSecret: new ObjectIDType(
      "recorded-exception-fingerprints-secret",
    ),
  };
});

import fs from "fs";
import path from "path";
import ExceptionUtil, {
  ExceptionFingerprintInput,
  ExceptionGroupingContent,
  GROUP_FINGERPRINT_LOOKUP_SQL,
  GroupFingerprintCandidate,
  OccurrenceFingerprints,
  clearExistingV1FingerprintCache,
  groupFingerprintKey,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import { fingerprintSha256 } from "../../FeatureSet/Telemetry/Utils/FingerprintHash";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import {
  EXCEPTION_FINGERPRINT_CORPUS,
  ExceptionCorpusEntry,
} from "./Helpers/ExceptionFingerprintCorpus";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000010898",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000010899",
);

const FIXTURE_PATH: string = path.join(
  __dirname,
  "Fixtures",
  "ExceptionFingerprintsRecorded",
  "fingerprints.json",
);

const RECORD: boolean = process.env["RECORD_EXCEPTION_FINGERPRINTS"] === "1";

// What the code gave for one exception of the corpus.
interface RecordedEntry {
  name: string;
  arrived: ExceptionGroupingContent;
  stored?: ExceptionGroupingContent | undefined;
  v1Text: string;
  v1: string;
  keyedV1: string;
  v2Text: string;
  v2: string;
  keyedV2: string;
  v3Text: string;
  v3: string;
  keyedV3: string;
  // As it arrived, no rule changing it.
  unchanged: OccurrenceFingerprints;
  // A rule changed it: as a span's exception, and as a log's.
  span?: OccurrenceFingerprints | undefined;
  log?: OccurrenceFingerprints | undefined;
}

interface RecordedFile {
  recordedBefore: string;
  entries: Array<RecordedEntry>;
}

function inputOf(content: ExceptionGroupingContent): ExceptionFingerprintInput {
  return {
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    message: content.message,
    stackTrace: content.stackTrace,
    exceptionType: content.exceptionType,
  };
}

function occurrenceOf(data: {
  arrived: ExceptionGroupingContent;
  stored: ExceptionGroupingContent;
  fromLog: boolean;
}): OccurrenceFingerprints {
  return ExceptionUtil.getOccurrenceFingerprints({
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    arrived: data.arrived,
    stored: data.stored,
    findsGroupsOfStoredText: data.fromLog,
  });
}

// What today's code gives for one exception of the corpus.
function fingerprintsNow(entry: ExceptionCorpusEntry): RecordedEntry {
  const input: ExceptionFingerprintInput = inputOf(entry.arrived);
  const v1Text: string = ExceptionUtil.getGroupingTextV1(input);
  const texts: { v2: string; v3: string } =
    ExceptionUtil.getGroupingTexts(input);

  return {
    name: entry.name,
    arrived: entry.arrived,
    ...(entry.stored ? { stored: entry.stored } : {}),
    v1Text,
    v1: ExceptionUtil.getFingerprint(input),
    keyedV1: KeyedExceptionFingerprint.ofFirstGroupingText({
      projectId: PROJECT_ID,
      text: v1Text,
    }),
    v2Text: texts.v2,
    v2: ExceptionUtil.getFingerprintV2(input),
    keyedV2: KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text: texts.v2,
    }),
    v3Text: texts.v3,
    v3: ExceptionUtil.getFingerprintV3(input),
    keyedV3: KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text: texts.v3,
    }),
    unchanged: occurrenceOf({
      arrived: entry.arrived,
      stored: entry.arrived,
      fromLog: false,
    }),
    ...(entry.stored
      ? {
          span: occurrenceOf({
            arrived: entry.arrived,
            stored: entry.stored,
            fromLog: false,
          }),
          log: occurrenceOf({
            arrived: entry.arrived,
            stored: entry.stored,
            fromLog: true,
          }),
        }
      : {}),
  };
}

function readRecorded(): RecordedFile {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8")) as RecordedFile;
}

// Each occurrence of a recorded exception, by how it was made.
function occurrencesOf(
  entry: RecordedEntry,
): Array<{ variant: string; fingerprints: OccurrenceFingerprints }> {
  return [
    { variant: "unchanged", fingerprints: entry.unchanged },
    ...(entry.span ? [{ variant: "span", fingerprints: entry.span }] : []),
    ...(entry.log ? [{ variant: "log", fingerprints: entry.log }] : []),
  ];
}

// The occurrence as resolveGroupFingerprints reads it, moving nothing.
function candidateOf(
  fingerprints: OccurrenceFingerprints,
): GroupFingerprintCandidate {
  return {
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    v1: fingerprints.fingerprint,
    v2: fingerprints.fingerprintV2,
    candidates: fingerprints.fingerprintCandidates,
    ...(fingerprints.fingerprintsOfStoredText
      ? { storedOnly: fingerprints.fingerprintsOfStoredText }
      : {}),
  };
}

// The fingerprints the mocked Postgres holds exceptions under.
let existing: Set<string> = new Set<string>();

function mockPostgres(): void {
  jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        if (sql === GROUP_FINGERPRINT_LOOKUP_SQL) {
          return (params[1] as Array<string>)
            .filter((fingerprint: string): boolean => {
              return existing.has(fingerprint);
            })
            .map((fingerprint: string) => {
              return { fingerprint, movedTo: null };
            });
        }

        // Recording a pair a rule split (#10618) changes no fingerprint.
        return [];
      },
    },
  } as never);
  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
}

async function resolveWith(data: {
  exceptions: Array<string>;
  candidates: Array<GroupFingerprintCandidate>;
}): Promise<Map<string, string>> {
  clearExistingV1FingerprintCache();
  existing = new Set<string>(data.exceptions);

  return ExceptionUtil.resolveGroupFingerprints(data.candidates);
}

if (RECORD) {
  describe("recording what the code gives", () => {
    test("writes the fingerprints of every exception of the corpus", () => {
      const file: RecordedFile = {
        recordedBefore: "grouping v4 (#10898)",
        entries: EXCEPTION_FINGERPRINT_CORPUS.map(fingerprintsNow),
      };

      // One exception a line, so a change to one reads as one line's diff.
      fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
      fs.writeFileSync(
        FIXTURE_PATH,
        `{\n"recordedBefore": ${JSON.stringify(file.recordedBefore)},\n"entries": [\n${file.entries
          .map((entry: RecordedEntry): string => {
            return JSON.stringify(entry);
          })
          .join(",\n")}\n]\n}\n`,
      );

      expect(file.entries.length).toBe(EXCEPTION_FINGERPRINT_CORPUS.length);
    });
  });
} else {
  describe("the fingerprints every exception was made under, as recorded", () => {
    const recorded: RecordedFile = readRecorded();
    const now: Array<RecordedEntry> =
      EXCEPTION_FINGERPRINT_CORPUS.map(fingerprintsNow);

    test("the corpus is the one recorded, entry by entry, and holds both kinds of exception", () => {
      expect(
        now.map((entry: RecordedEntry) => {
          return [entry.name, entry.arrived, entry.stored || null];
        }),
      ).toEqual(
        recorded.entries.map((entry: RecordedEntry) => {
          return [entry.name, entry.arrived, entry.stored || null];
        }),
      );
      expect(recorded.entries.length).toBeGreaterThan(400);

      // Messages grouped by their text, and stack traces grouped by frames.
      const byFrames: Array<RecordedEntry> = recorded.entries.filter(
        (entry: RecordedEntry): boolean => {
          return entry.v2Text.split("\n")[4] !== "message";
        },
      );
      expect(byFrames.length).toBeGreaterThanOrEqual(5);
      expect(recorded.entries.length - byFrames.length).toBeGreaterThan(400);
    });

    test("the texts v1, v2 and v3 hash, and their fingerprints, keyed or not, are byte for byte what they were", () => {
      for (const [index, entry] of now.entries()) {
        const before: RecordedEntry = recorded.entries[index]!;

        expect({
          name: entry.name,
          v1Text: entry.v1Text,
          v1: entry.v1,
          keyedV1: entry.keyedV1,
          v2Text: entry.v2Text,
          v2: entry.v2,
          keyedV2: entry.keyedV2,
          v3Text: entry.v3Text,
          v3: entry.v3,
          keyedV3: entry.keyedV3,
        }).toEqual({
          name: before.name,
          v1Text: before.v1Text,
          v1: before.v1,
          keyedV1: before.keyedV1,
          v2Text: before.v2Text,
          v2: before.v2,
          keyedV2: before.keyedV2,
          v3Text: before.v3Text,
          v3: before.v3,
          keyedV3: before.keyedV3,
        });

        // Each is the hash of its text, as recorded.
        expect(fingerprintSha256(before.v1Text)).toBe(before.v1);
        expect(fingerprintSha256(before.v2Text)).toBe(before.v2);
        expect(fingerprintSha256(before.v3Text)).toBe(before.v3);
      }
    });

    test("an occurrence tries every fingerprint it tried before, in the same order, before any new one", () => {
      for (const [index, entry] of now.entries()) {
        const before: RecordedEntry = recorded.entries[index]!;
        const pairs: Array<[OccurrenceFingerprints, OccurrenceFingerprints]> = [
          [entry.unchanged, before.unchanged],
          ...(entry.span && before.span
            ? ([[entry.span, before.span]] as Array<
                [OccurrenceFingerprints, OccurrenceFingerprints]
              >)
            : []),
          ...(entry.log && before.log
            ? ([[entry.log, before.log]] as Array<
                [OccurrenceFingerprints, OccurrenceFingerprints]
              >)
            : []),
        ];

        for (const [current, then] of pairs) {
          expect({
            name: entry.name,
            tried: current.fingerprintCandidates.slice(
              0,
              then.fingerprintCandidates.length,
            ),
          }).toEqual({ name: entry.name, tried: then.fingerprintCandidates });

          // Anything tried after them is new: no fingerprint of before.
          for (const added of current.fingerprintCandidates.slice(
            then.fingerprintCandidates.length,
          )) {
            expect(then.fingerprintCandidates).not.toContain(added);
            expect([
              before.v1,
              before.keyedV1,
              before.v2,
              before.keyedV2,
              before.v3,
              before.keyedV3,
            ]).not.toContain(added);
          }

          // A new exception is made under one of them, so the next finds it.
          expect(current.fingerprintCandidates).toContain(
            current.fingerprintV2,
          );
        }
      }
    });

    test("grouping v4: a new exception grouped by its message is made under a fingerprint no exception of before had, and one grouped by its frames under v2's, as before", () => {
      const recordedFingerprints: Set<string> = new Set<string>();

      for (const before of recorded.entries) {
        for (const occurrence of occurrencesOf(before)) {
          for (const fingerprint of occurrence.fingerprints
            .fingerprintCandidates) {
            recordedFingerprints.add(fingerprint);
          }
        }
      }

      let byMessage: number = 0;

      for (const [index, entry] of now.entries()) {
        const before: RecordedEntry = recorded.entries[index]!;

        for (const then of occurrencesOf(before)) {
          const current: OccurrenceFingerprints = occurrencesOf(entry).find(
            (occurrence: { variant: string }): boolean => {
              return occurrence.variant === then.variant;
            },
          )!.fingerprints;

          if (before.v2Text === before.v3Text) {
            // Grouped by its frames: v4 is v2, every fingerprint as it was.
            expect(current).toEqual(then.fingerprints);
            continue;
          }

          byMessage++;
          expect({
            name: entry.name,
            new: recordedFingerprints.has(current.fingerprintV2),
          }).toEqual({ name: entry.name, new: false });
          // Two more fingerprints tried, after every one of before.
          expect(current.fingerprintCandidates).toHaveLength(
            then.fingerprints.fingerprintCandidates.length + 2,
          );
        }
      }

      expect(byMessage).toBeGreaterThan(400);
    });

    test("the pairs a scrub rule split (#10618) are found by what they were found by", () => {
      for (const [index, entry] of now.entries()) {
        const before: RecordedEntry = recorded.entries[index]!;

        expect(entry.span?.fingerprintsOfStoredText).toEqual(
          before.span?.fingerprintsOfStoredText,
        );
        expect(entry.log?.fingerprintsOfStoredText).toEqual(
          before.log?.fingerprintsOfStoredText,
        );
        expect(entry.unchanged.fingerprintsOfStoredText).toBeUndefined();
      }
    });

    test("each exception moved to a private fingerprint (#10619) moves where it did, and only a new one is added", () => {
      for (const [index, entry] of now.entries()) {
        const before: RecordedEntry = recorded.entries[index]!;

        for (const [current, then] of [
          [entry.span, before.span],
          [entry.log, before.log],
          [entry.unchanged, before.unchanged],
        ] as Array<
          [
            OccurrenceFingerprints | undefined,
            OccurrenceFingerprints | undefined,
          ]
        >) {
          const rekeysThen: Record<string, string> =
            then?.fingerprintRekeys || {};
          const rekeysNow: Record<string, string> =
            current?.fingerprintRekeys || {};

          for (const from of Object.keys(rekeysThen)) {
            expect({ name: entry.name, from, to: rekeysNow[from] }).toEqual({
              name: entry.name,
              from,
              to: rekeysThen[from],
            });
          }

          // A fingerprint that hashed nothing hidden before still does not.
          for (const from of Object.keys(rekeysNow)) {
            if (!(from in rekeysThen)) {
              expect([
                before.v1,
                before.keyedV1,
                before.v2,
                before.keyedV2,
                before.v3,
                before.keyedV3,
              ]).not.toContain(from);
            }
          }
        }
      }
    });

    /*
     * An occurrence's `fingerprint`: what it was filed under when the
     * exceptions could not be read until #11027, which is how a duplicate
     * that made is told apart now (TelemetryExceptionSplitHeal). Byte for
     * byte as recorded.
     */
    test("an occurrence's own fingerprint: v1, as before, unless v1 hashes what a rule hid", () => {
      for (const [index, entry] of now.entries()) {
        const before: RecordedEntry = recorded.entries[index]!;

        for (const [current, then] of [
          [entry.unchanged, before.unchanged],
          [entry.span, before.span],
          [entry.log, before.log],
        ] as Array<
          [
            OccurrenceFingerprints | undefined,
            OccurrenceFingerprints | undefined,
          ]
        >) {
          if (!current || !then) {
            continue;
          }

          if (then.fingerprint === before.v1) {
            // v1 kept, as it always was.
            expect({ name: entry.name, kept: current.fingerprint }).toEqual({
              name: entry.name,
              kept: before.v1,
            });
          } else {
            /*
             * v1 hashes what a rule hid, so the fingerprint a new exception
             * is made under is kept, the newest version's: tried after every
             * older one, so an exception found under any of those is still
             * found by the next occurrence.
             */
            expect(then.fingerprint).toBe(then.fingerprintV2);
            expect(current.fingerprint).toBe(current.fingerprintV2);
          }
        }
      }
    });

    describe("against the exceptions that exist", () => {
      beforeEach(() => {
        mockPostgres();
      });

      afterEach(() => {
        jest.restoreAllMocks();
        clearExistingV1FingerprintCache();
      });

      afterAll(() => {
        clearExistingV1FingerprintCache();
      });

      test("an exception under any fingerprint an occurrence tried before still gets the occurrence: nothing splits", async () => {
        let resolved: number = 0;

        for (const [index, entry] of now.entries()) {
          const before: RecordedEntry = recorded.entries[index]!;
          const nowOccurrences: Array<{
            variant: string;
            fingerprints: OccurrenceFingerprints;
          }> = occurrencesOf(entry);

          for (const then of occurrencesOf(before)) {
            const current: OccurrenceFingerprints = nowOccurrences.find(
              (occurrence: { variant: string }): boolean => {
                return occurrence.variant === then.variant;
              },
            )!.fingerprints;
            const candidate: GroupFingerprintCandidate = candidateOf(current);

            for (const fingerprint of then.fingerprints.fingerprintCandidates) {
              const chosen: Map<string, string> = await resolveWith({
                exceptions: [fingerprint],
                candidates: [candidate],
              });

              expect({
                name: entry.name,
                variant: then.variant,
                chosen: chosen.get(groupFingerprintKey(candidate)),
              }).toEqual({
                name: entry.name,
                variant: then.variant,
                chosen: fingerprint,
              });
              resolved++;
            }
          }
        }

        expect(resolved).toBeGreaterThan(2000);
      });

      test("with none of them, a new exception is made under the fingerprint a new one is made under", async () => {
        for (const entry of now) {
          for (const occurrence of occurrencesOf(entry)) {
            const candidate: GroupFingerprintCandidate = candidateOf(
              occurrence.fingerprints,
            );
            const chosen: Map<string, string> = await resolveWith({
              exceptions: [],
              candidates: [candidate],
            });

            expect(chosen.get(groupFingerprintKey(candidate))).toBe(
              occurrence.fingerprints.fingerprintV2,
            );
          }
        }

        // Grouped by frames, it is v2's, as it always was.
        for (const [index, entry] of now.entries()) {
          const before: RecordedEntry = recorded.entries[index]!;

          if (before.v2Text === before.v3Text) {
            expect(entry.unchanged.fingerprintV2).toBe(
              before.unchanged.fingerprintV2,
            );
          }
        }
      });

      /*
       * The exceptions of a project, made in each era: before grouping v2
       * (under v1), as each later version was the newest, and by occurrences
       * a scrub rule changed (keyed). Against any of them, every occurrence
       * of the corpus lands where the code of before put it - the first of
       * the fingerprints it tried then that an exception exists under - so
       * no exception that exists splits, and no two of them merge.
       */
      test.each([
        ["made before grouping v2, under v1", "v1"],
        ["made under v2, or its keyed one", "v2"],
        ["made under v3, or its keyed one", "v3"],
        ["made as each one's occurrences made them", "opened"],
        ["kept when the exceptions could not be read", "kept"],
        ["of every era at once", "all"],
      ])(
        "two exceptions that exist never merge, and none splits: exceptions %s",
        async (_era: string, era: string) => {
          const made: Set<string> = new Set<string>();

          for (const before of recorded.entries) {
            const opened: Array<string> = occurrencesOf(before).map(
              (occurrence: {
                fingerprints: OccurrenceFingerprints;
              }): string => {
                return occurrence.fingerprints.fingerprintV2;
              },
            );
            const kept: Array<string> = occurrencesOf(before).map(
              (occurrence: {
                fingerprints: OccurrenceFingerprints;
              }): string => {
                return occurrence.fingerprints.fingerprint;
              },
            );
            const byEra: Record<string, Array<string>> = {
              v1: [before.v1, before.keyedV1],
              v2: [before.v2, before.keyedV2],
              v3: [before.v3, before.keyedV3],
              opened,
              kept,
            };
            byEra["all"] = [
              ...byEra["v1"]!,
              ...byEra["v2"]!,
              ...byEra["v3"]!,
              ...opened,
              ...kept,
            ];

            for (const fingerprint of byEra[era]!) {
              made.add(fingerprint);
            }
          }

          const candidates: Array<GroupFingerprintCandidate> = [];
          const landedBefore: Map<string, string | undefined> = new Map<
            string,
            string | undefined
          >();

          for (const [index, entry] of now.entries()) {
            const before: RecordedEntry = recorded.entries[index]!;

            for (const then of occurrencesOf(before)) {
              const current: OccurrenceFingerprints = occurrencesOf(entry).find(
                (occurrence: { variant: string }): boolean => {
                  return occurrence.variant === then.variant;
                },
              )!.fingerprints;
              const candidate: GroupFingerprintCandidate = candidateOf(current);

              candidates.push(candidate);
              // Where the code of before put it: the first it tried that exists.
              landedBefore.set(
                groupFingerprintKey(candidate),
                then.fingerprints.fingerprintCandidates.find(
                  (fingerprint: string): boolean => {
                    return made.has(fingerprint);
                  },
                ),
              );
            }
          }

          const chosen: Map<string, string> = await resolveWith({
            exceptions: Array.from(made),
            candidates,
          });
          let found: number = 0;

          for (const candidate of candidates) {
            const key: string = groupFingerprintKey(candidate);
            const before: string | undefined = landedBefore.get(key);

            if (before === undefined) {
              // None existed for it: a new exception, as before.
              expect(made.has(chosen.get(key) || "")).toBe(false);
              continue;
            }

            expect(chosen.get(key)).toBe(before);
            found++;
          }

          expect(found).toBeGreaterThan(0);
        },
      );
    });
  });
}

beforeAll(() => {
  clearExistingV1FingerprintCache();
});
