import MergeBackExceptionsSplitByFailedLookups, {
  FIRST_ID,
  GROUPING_V2_SINCE,
  MAX_TEXT_BYTES,
  MERGE_BACK_SPLITS_JOB_NAME,
  MERGE_BACK_SPLITS_MIGRATION_NAME,
  MIGRATION_TIME_BUDGET_MS,
  MergeBackSplitsEnvironment,
  MergeBackSplitsResult,
  OCCURRENCES_READ,
  OCCURRENCE_READ_TIME_LIMIT_SECONDS,
  OCCURRENCE_WINDOW_SLACK_MS,
  PAGE_SIZE,
  SWEEP_PAGE_SQL,
  SWEEP_PROGRESS_NAMESPACE,
  SWEEP_PROGRESS_TTL_SECONDS,
  SWEPT_MARKER_NAME,
  SweepProgress,
  SweptException,
  getDefaultMergeBackSplitsEnvironment,
  isTooLongToRead,
  occurrenceOfText,
  readOccurrenceTextsFromClickhouse,
  readSweepProgress,
  storedTextOf,
  writeSweepProgress,
} from "../../../FeatureSet/Workers/DataMigrations/MergeBackExceptionsSplitByFailedLookups";
import ExceptionUtil, {
  ExceptionGroupingContent,
  ExceptionSplitByFailedLookup,
  GROUP_FINGERPRINT_LOOKUP_SQL,
  GroupLookupRow,
  KnownGroup,
  OccurrenceFingerprints,
  knownGroupsOfLookupRows,
} from "../../../FeatureSet/Telemetry/Utils/Exception";
import { fingerprintSha256 } from "../../../FeatureSet/Telemetry/Utils/FingerprintHash";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import PresentedKeysAtRest from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import TelemetryExceptionSplitHeal, {
  ExceptionSplitHealOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionSplitHeal";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import ObjectID from "Common/Types/ObjectID";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";

/*
 * MERGING BACK THE DUPLICATES A FAILED LOOKUP MADE BEFORE #11027 (#11113).
 *
 * Until #11027 an occurrence whose project's exceptions could not be read
 * was filed under its grouping v1 fingerprint, and for an exception made
 * since grouping v2 that made a duplicate, which took every later
 * occurrence. #11089 merges one back on its next occurrence; one whose
 * error never happens again stayed. MergeBackExceptionsSplitByFailedLookups
 * finds those from what each stored and merges them back with the heal the
 * next occurrence would run.
 *
 * Here the sweep runs against a world that answers its reads as its
 * statements do: SWEEP_PAGE_SQL's page (made since grouping v2, before the
 * sweep started, not deleted, merged or a former fingerprint, by id, texts
 * up to the cap), GROUP_FINGERPRINT_LOOKUP_SQL's lookup (read through
 * ingest's own knownGroupsOfLookupRows), ClickHouse's occurrences, the heal,
 * Valkey's progress and the DataMigrations marker. Every fingerprint is the
 * real one, made by ExceptionUtil as ingest makes it. The real statements
 * run in MergeBackExceptionsSplitByFailedLookupsPostgres (Postgres, with
 * ClickHouse when TEST_CLICKHOUSE_URL is set) and
 * MergeBackExceptionsSplitByFailedLookupsClickhouse.
 */

const PROJECT: string = "11113000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT: string = "11113000-0000-4000-8000-0000000000a2";
const SERVICE: string = "11113000-0000-4000-8000-0000000000b1";
const OTHER_SERVICE: string = "11113000-0000-4000-8000-0000000000b2";

const DAY: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-27T12:00:00.000Z");

function day(offset: number): Date {
  return new Date(GROUPING_V2_SINCE.getTime() + offset * DAY);
}

// An exception grouped by its frames: v3's and v4's fingerprints are v2's.
function framesText(name: string): ExceptionGroupingContent {
  return {
    exceptionType: "TypeError",
    message: `Cannot read properties of undefined (reading '${name}')`,
    stackTrace: `TypeError: Cannot read properties of undefined (reading '${name}')\n    at load${name} (/app/src/${name}.js:10:5)\n    at main (/app/src/index.js:3:1)`,
  };
}

/*
 * The same code reached through a library frame: grouping v2 reads the
 * in-app frames alone and makes it the same exception, while v1 reads every
 * frame and makes it another (v1 folds line numbers, so another line would
 * not do).
 */
function throughALibrary(
  text: ExceptionGroupingContent,
): ExceptionGroupingContent {
  return {
    ...text,
    stackTrace: `${text.stackTrace}\n    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)`,
  };
}

/*
 * An exception grouped by its message, which holds a card number in groups
 * and an international phone number: v2's, v3's and v4's all differ.
 */
function messageText(name: string): ExceptionGroupingContent {
  return {
    exceptionType: "PaymentError",
    message: `Payment ${name} declined for card 4111 1111 1111 1111, call +44 20 7946 0958`,
    stackTrace: "",
  };
}

/*
 * Two errors grouping v1 cannot tell apart: it runs the normalized message,
 * the stack trace and the type together with nothing between them, so
 * "PaymentGateway" thrown as an Error and "Payment" thrown as a
 * GatewayError hash alike. Grouping v2 reads the type apart, and keeps them
 * apart. An exception v1 made may hold both.
 */
const ONE_FOR_V1: ExceptionGroupingContent = {
  exceptionType: "Error",
  message: "PaymentGateway",
  stackTrace: "",
};
const OTHER_FOR_V1: ExceptionGroupingContent = {
  exceptionType: "GatewayError",
  message: "Payment",
  stackTrace: "",
};

function fingerprintsOf(
  text: ExceptionGroupingContent,
  data?: {
    projectId?: string;
    serviceId?: string;
    stored?: ExceptionGroupingContent;
  },
): OccurrenceFingerprints {
  return ExceptionUtil.getOccurrenceFingerprints({
    projectId: new ObjectID(data?.projectId || PROJECT),
    primaryEntityId: new ObjectID(data?.serviceId || SERVICE),
    arrived: text,
    stored: data?.stored || text,
  });
}

// What the grouping version `era` names, of text as it arrived.
type Era =
  | "v1"
  | "keyed v1"
  | "v2"
  | "keyed v2"
  | "v3"
  | "keyed v3"
  | "v4"
  | "keyed v4";

function fingerprintOfEra(
  era: Era,
  text: ExceptionGroupingContent,
  data?: { projectId?: string; serviceId?: string },
): string {
  const projectId: ObjectID = new ObjectID(data?.projectId || PROJECT);
  const primaryEntityId: ObjectID = new ObjectID(data?.serviceId || SERVICE);
  const input: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    message: string;
    stackTrace: string;
    exceptionType: string;
  } = { projectId, primaryEntityId, ...text };
  const texts: { v2: string; v3: string; v4: string } =
    ExceptionUtil.getGroupingTexts(input);

  switch (era) {
    case "v1":
      return ExceptionUtil.getFingerprint(input);
    case "keyed v1":
      return KeyedExceptionFingerprint.ofFirstGroupingText({
        projectId,
        text: ExceptionUtil.getGroupingTextV1(input),
      });
    case "v2":
      return fingerprintSha256(texts.v2);
    case "keyed v2":
      return KeyedExceptionFingerprint.ofGroupingText({
        projectId,
        text: texts.v2,
      });
    case "v3":
      return fingerprintSha256(texts.v3);
    case "keyed v3":
      return KeyedExceptionFingerprint.ofGroupingText({
        projectId,
        text: texts.v3,
      });
    case "v4":
      return fingerprintSha256(texts.v4);
    default:
      return KeyedExceptionFingerprint.ofGroupingText({
        projectId,
        text: texts.v4,
      });
  }
}

interface WorldRow {
  id: string;
  projectId: string;
  primaryEntityId: string | null;
  fingerprint: string;
  createdAt: Date;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  message: string | null;
  stackTrace: string | null;
  exceptionType: string | null;
  mergedInto: string | null;
  formerFingerprintOf: string | null;
  deletedAt: Date | null;
}

let rowNumber: number = 0;

/*
 * A name of letters alone for a number: the normalizer folds digits, so
 * "e1" and "e2" would be one error, and one exception.
 */
function letters(index: number): string {
  let name: string = "";
  let left: number = index;

  do {
    name = String.fromCharCode(97 + (left % 26)) + name;
    left = Math.floor(left / 26);
  } while (left > 0);

  return name;
}

function nextId(): string {
  rowNumber++;
  return `11113000-0000-4000-8000-${rowNumber.toString(16).padStart(12, "0")}`;
}

function byteLength(text: string | null): number {
  return text === null ? 0 : Buffer.byteLength(text, "utf8");
}

/*
 * A project's exceptions, their occurrences in ClickHouse and the sweep's
 * progress, answering every read the sweep makes as its statement would.
 */
class World {
  public rows: Array<WorldRow> = [];
  // An exception's occurrences ClickHouse keeps, by project|service|fingerprint, oldest first.
  public occurrences: Map<string, Array<ExceptionGroupingContent>> = new Map();
  public progress: SweepProgress | null = null;
  public sweptAt: Date | null = null;
  public migratedAt: Date | null = NOW;
  public now: Date = NOW;

  // What the sweep asked, in order.
  public pageReads: Array<{ after: string; cutoff: Date; limit: number }> = [];
  public lookups: Array<{ projectId: string; fingerprints: Array<string> }> =
    [];
  public occurrenceReads: Array<{
    projectId: string;
    primaryEntityId: string;
    fingerprint: string;
    from: Date;
    to: Date;
    limit: number;
  }> = [];
  public heals: Array<ExceptionSplitByFailedLookup> = [];
  public progressWrites: Array<SweepProgress> = [];
  public markers: Array<Date> = [];

  // What a heal answers; Merged by default, the duplicate then merged.
  public healOutcome: (
    pair: ExceptionSplitByFailedLookup,
  ) => ExceptionSplitHealOutcome = (): ExceptionSplitHealOutcome => {
    return ExceptionSplitHealOutcome.Merged;
  };
  public occurrencesFail: boolean = false;
  public lookupFails: boolean = false;
  public pageFailsAt: number | null = null;

  public add(data: {
    text: ExceptionGroupingContent;
    fingerprint: string;
    createdAt: Date;
    projectId?: string;
    serviceId?: string | null;
    stored?: ExceptionGroupingContent;
    lastSeenAt?: Date;
    mergedInto?: string | null;
    formerFingerprintOf?: string | null;
    deletedAt?: Date | null;
    id?: string;
  }): WorldRow {
    const stored: ExceptionGroupingContent = data.stored || data.text;
    const projectId: string = data.projectId || PROJECT;
    const serviceId: string | null =
      data.serviceId === null ? null : data.serviceId || SERVICE;

    // As the table's unique index on (projectId, primaryEntityId, fingerprint).
    if (
      this.rows.some((row: WorldRow): boolean => {
        return (
          row.projectId === projectId &&
          row.primaryEntityId === serviceId &&
          row.fingerprint === data.fingerprint
        );
      })
    ) {
      throw new Error(
        `Two exceptions under one fingerprint: ${data.fingerprint}`,
      );
    }

    const row: WorldRow = {
      id: data.id || nextId(),
      projectId,
      primaryEntityId: serviceId,
      fingerprint: data.fingerprint,
      createdAt: data.createdAt,
      firstSeenAt: data.createdAt,
      lastSeenAt: data.lastSeenAt || data.createdAt,
      message: stored.message,
      stackTrace: stored.stackTrace,
      exceptionType: stored.exceptionType,
      mergedInto: data.mergedInto || null,
      formerFingerprintOf: data.formerFingerprintOf || null,
      deletedAt: data.deletedAt || null,
    };

    this.rows.push(row);

    return row;
  }

  // An occurrence of an exception, as ClickHouse keeps it.
  public occur(row: WorldRow, text?: ExceptionGroupingContent): void {
    const key: string = `${row.projectId}|${row.primaryEntityId}|${row.fingerprint}`;
    this.occurrences.set(key, [
      ...(this.occurrences.get(key) || []),
      text || storedTextOf(row),
    ]);
  }

  public byId(id: string): WorldRow {
    return this.rows.find((row: WorldRow): boolean => {
      return row.id === id;
    })!;
  }

  public environment(
    overrides?: Partial<MergeBackSplitsEnvironment>,
  ): Partial<MergeBackSplitsEnvironment> {
    return {
      now: (): Date => {
        return this.now;
      },
      pageSize: PAGE_SIZE,
      readPage: async (data: {
        after: string;
        since: Date;
        cutoff: Date;
        limit: number;
        maxTextBytes: number;
      }): Promise<Array<SweptException>> => {
        this.pageReads.push({
          after: data.after,
          cutoff: data.cutoff,
          limit: data.limit,
        });

        if (
          this.pageFailsAt !== null &&
          this.pageReads.length === this.pageFailsAt
        ) {
          throw new Error("Connection terminated unexpectedly");
        }

        expect(data.since).toEqual(GROUPING_V2_SINCE);
        expect(data.maxTextBytes).toBe(MAX_TEXT_BYTES);

        return this.rows
          .filter((row: WorldRow): boolean => {
            return (
              row.id > data.after &&
              row.createdAt.getTime() >= data.since.getTime() &&
              row.createdAt.getTime() <= data.cutoff.getTime() &&
              !row.deletedAt &&
              !row.mergedInto &&
              !row.formerFingerprintOf
            );
          })
          .sort((a: WorldRow, b: WorldRow): number => {
            return a.id < b.id ? -1 : 1;
          })
          .slice(0, data.limit)
          .map((row: WorldRow): SweptException => {
            const textBytes: number =
              byteLength(row.message) +
              byteLength(row.stackTrace) +
              byteLength(row.exceptionType);
            const isRead: boolean = textBytes <= data.maxTextBytes;

            return {
              id: row.id,
              projectId: row.projectId,
              primaryEntityId: row.primaryEntityId,
              fingerprint: row.fingerprint,
              createdAt: row.createdAt,
              firstSeenAt: row.firstSeenAt,
              lastSeenAt: row.lastSeenAt,
              textBytes,
              message: isRead ? row.message : null,
              stackTrace: isRead ? row.stackTrace : null,
              exceptionType: isRead ? row.exceptionType : null,
            };
          });
      },
      readKnownGroups: async (
        projectId: string,
        fingerprints: Array<string>,
      ): Promise<Map<string, KnownGroup>> => {
        this.lookups.push({ projectId, fingerprints: [...fingerprints] });

        if (this.lookupFails) {
          throw new Error("canceling statement due to statement timeout");
        }

        // As GROUP_FINGERPRINT_LOOKUP_SQL: a project's rows by fingerprint.
        const rows: Array<GroupLookupRow> = this.rows
          .filter((row: WorldRow): boolean => {
            return (
              row.projectId === projectId &&
              fingerprints.includes(row.fingerprint) &&
              !row.deletedAt
            );
          })
          .map((row: WorldRow): GroupLookupRow => {
            const moved: WorldRow | undefined = row.formerFingerprintOf
              ? this.rows.find((other: WorldRow): boolean => {
                  return (
                    other.id === row.formerFingerprintOf && !other.deletedAt
                  );
                })
              : undefined;

            return {
              fingerprint: row.fingerprint,
              movedTo: moved?.fingerprint || null,
              createdAt: moved?.createdAt || row.createdAt,
              mergedInto: row.mergedInto,
            };
          });

        return knownGroupsOfLookupRows(rows);
      },
      readOccurrenceTexts: async (data: {
        projectId: string;
        primaryEntityId: string;
        fingerprint: string;
        from: Date;
        to: Date;
        limit: number;
      }): Promise<Array<ExceptionGroupingContent>> => {
        this.occurrenceReads.push({ ...data });

        if (this.occurrencesFail) {
          throw new Error("Timeout exceeded: elapsed 20.1 seconds");
        }

        const all: Array<ExceptionGroupingContent> =
          this.occurrences.get(
            `${data.projectId}|${data.primaryEntityId}|${data.fingerprint}`,
          ) || [];

        // The earliest and the latest, as the two reads give them.
        return [
          ...all.slice(0, data.limit),
          ...[...all].reverse().slice(0, data.limit),
        ];
      },
      heal: async (
        pair: ExceptionSplitByFailedLookup,
      ): Promise<ExceptionSplitHealOutcome> => {
        this.heals.push({ ...pair });

        const outcome: ExceptionSplitHealOutcome = this.healOutcome(pair);

        if (outcome === ExceptionSplitHealOutcome.Merged) {
          const duplicate: WorldRow | undefined = this.rows.find(
            (row: WorldRow): boolean => {
              return (
                row.projectId === pair.projectId &&
                row.primaryEntityId === pair.primaryEntityId &&
                row.fingerprint === pair.duplicate
              );
            },
          );
          const original: WorldRow | undefined = this.rows.find(
            (row: WorldRow): boolean => {
              return (
                row.projectId === pair.projectId &&
                row.primaryEntityId === pair.primaryEntityId &&
                row.fingerprint === pair.original
              );
            },
          );

          const survivor: string | undefined = original
            ? original.formerFingerprintOf || original.id
            : undefined;

          // As the heal's merge: one merged already is merged already.
          if (duplicate && survivor && duplicate.mergedInto === survivor) {
            return ExceptionSplitHealOutcome.AlreadyMerged;
          }

          if (duplicate && survivor) {
            duplicate.mergedInto = survivor;
          }
        }

        return outcome;
      },
      readProgress: async (): Promise<SweepProgress | null> => {
        return this.progress ? { ...this.progress } : null;
      },
      writeProgress: async (progress: SweepProgress): Promise<void> => {
        this.progress = { ...progress };
        this.progressWrites.push({ ...progress });
      },
      readMigratedAt: async (): Promise<Date | null> => {
        return this.migratedAt;
      },
      isSwept: async (): Promise<boolean> => {
        return this.sweptAt !== null;
      },
      recordSwept: async (at: Date): Promise<void> => {
        this.markers.push(at);
        this.sweptAt = at;
      },
      ...(overrides || {}),
    };
  }

  public migration(
    overrides?: Partial<MergeBackSplitsEnvironment>,
  ): MergeBackExceptionsSplitByFailedLookups {
    return new MergeBackExceptionsSplitByFailedLookups(
      this.environment(overrides),
    );
  }

  public async sweep(
    overrides?: Partial<MergeBackSplitsEnvironment>,
    options?: { deadline?: JobDeadline; timeBudgetMs?: number },
  ): Promise<MergeBackSplitsResult> {
    return this.migration(overrides).sweep(options || {});
  }
}

/*
 * The pair as the old fallback left it: the exception made under the
 * newest fingerprint (`era`) before, and the duplicate made under v1 since.
 */
function splitPair(
  world: World,
  data?: {
    text?: ExceptionGroupingContent;
    era?: Era;
    originalAt?: Date;
    duplicateAt?: Date;
    projectId?: string;
    serviceId?: string;
  },
): { original: WorldRow; duplicate: WorldRow } {
  const text: ExceptionGroupingContent = data?.text || framesText("cart");
  const options: { projectId?: string; serviceId?: string } = {
    ...(data?.projectId ? { projectId: data.projectId } : {}),
    ...(data?.serviceId ? { serviceId: data.serviceId } : {}),
  };
  const original: WorldRow = world.add({
    text,
    fingerprint: fingerprintOfEra(data?.era || "v4", text, options),
    createdAt: data?.originalAt || day(2),
    ...options,
  });
  const duplicate: WorldRow = world.add({
    text,
    fingerprint: fingerprintOfEra("v1", text, options),
    createdAt: data?.duplicateAt || day(9),
    lastSeenAt: day(11),
    ...options,
  });

  return { original, duplicate };
}

function expectLeft(world: World, result: MergeBackSplitsResult): void {
  expect(world.heals).toEqual([]);
  expect(result.merged).toBe(0);
}

beforeEach(() => {
  rowNumber = 0;

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a duplicate a failed lookup made is merged back", () => {
  test("into the exception it was split from, by the heal the next occurrence runs", async () => {
    const world: World = new World();
    const { original, duplicate } = splitPair(world);

    const result: MergeBackSplitsResult = await world.sweep();

    expect(world.heals).toEqual([
      {
        projectId: PROJECT,
        primaryEntityId: SERVICE,
        duplicate: duplicate.fingerprint,
        original: original.fingerprint,
      },
    ]);
    expect(result).toMatchObject({
      isDone: true,
      pages: 1,
      read: 2,
      merged: 1,
      notOfTheirOwnText: 1,
    });
    expect(world.byId(duplicate.id).mergedInto).toBe(original.id);
  });

  test.each([
    ["keyed v1", framesText("orders")],
    ["v2", framesText("orders")],
    ["keyed v2", framesText("orders")],
    ["v2", messageText("A")],
    ["keyed v2", messageText("A")],
    ["v3", messageText("A")],
    ["keyed v3", messageText("A")],
    ["v4", messageText("A")],
    ["keyed v4", messageText("A")],
  ] as Array<[Era, ExceptionGroupingContent]>)(
    "an exception made under %s is found where an occurrence of the text tries it",
    async (era: Era, text: ExceptionGroupingContent) => {
      const world: World = new World();
      const { original, duplicate } = splitPair(world, { text, era });

      const result: MergeBackSplitsResult = await world.sweep();

      expect(result.merged).toBe(1);
      expect(world.heals).toEqual([
        {
          projectId: PROJECT,
          primaryEntityId: SERVICE,
          duplicate: duplicate.fingerprint,
          original: original.fingerprint,
        },
      ]);
    },
  );

  test("the first exception its text tries after v1 is the one it was split from", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = messageText("B");
    const underV2: WorldRow = world.add({
      text,
      fingerprint: fingerprintOfEra("v2", text),
      createdAt: day(1),
    });
    world.add({
      text,
      fingerprint: fingerprintOfEra("v4", text),
      createdAt: day(3),
    });
    const duplicate: WorldRow = world.add({
      text,
      fingerprint: fingerprintOfEra("v1", text),
      createdAt: day(8),
    });

    await world.sweep();

    expect(world.heals).toEqual([
      {
        projectId: PROJECT,
        primaryEntityId: SERVICE,
        duplicate: duplicate.fingerprint,
        original: underV2.fingerprint,
      },
    ]);
  });

  test("its fingerprints are those an occurrence of its text tries, in order, as ingest makes them", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = messageText("C");
    const { duplicate } = splitPair(world, { text });

    await world.sweep();

    // One lookup for the project: every fingerprint its text tries.
    expect(world.lookups).toHaveLength(1);
    expect(world.lookups[0]!.projectId).toBe(PROJECT);
    expect(world.lookups[0]!.fingerprints).toEqual(
      fingerprintsOf(text).fingerprintCandidates,
    );
    expect(world.lookups[0]!.fingerprints[0]).toBe(duplicate.fingerprint);
    expect(new Set(world.lookups[0]!.fingerprints).size).toBe(8);
  });

  test("an exception moved to a private fingerprint since is merged into where it moved", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("moved");
    // Made under v2, moved since to its keyed fingerprint (#10619).
    const moved: WorldRow = world.add({
      text,
      fingerprint: fingerprintOfEra("keyed v2", text),
      createdAt: day(1),
    });
    const formerRow: WorldRow = world.add({
      text,
      fingerprint: fingerprintOfEra("v2", text),
      createdAt: day(20),
      formerFingerprintOf: moved.id,
    });
    const duplicate: WorldRow = world.add({
      text,
      fingerprint: fingerprintOfEra("v1", text),
      createdAt: day(5),
    });

    const result: MergeBackSplitsResult = await world.sweep();

    // The former fingerprint is tried first, and stands for the moved one.
    expect(world.heals).toEqual([
      {
        projectId: PROJECT,
        primaryEntityId: SERVICE,
        duplicate: duplicate.fingerprint,
        original: formerRow.fingerprint,
      },
    ]);
    expect(result.merged).toBe(1);
    expect(world.byId(duplicate.id).mergedInto).toBe(moved.id);
    // The row that only keeps a former fingerprint is never read as one.
    expect(result.read).toBe(2);
  });

  test("duplicates in several projects and services, each merged into its own", async () => {
    const world: World = new World();
    const a: { original: WorldRow; duplicate: WorldRow } = splitPair(world, {
      text: framesText("alpha"),
    });
    const b: { original: WorldRow; duplicate: WorldRow } = splitPair(world, {
      text: framesText("alpha"),
      serviceId: OTHER_SERVICE,
    });
    const c: { original: WorldRow; duplicate: WorldRow } = splitPair(world, {
      text: messageText("D"),
      projectId: OTHER_PROJECT,
    });

    const result: MergeBackSplitsResult = await world.sweep();

    expect(result.merged).toBe(3);
    expect(world.byId(a.duplicate.id).mergedInto).toBe(a.original.id);
    expect(world.byId(b.duplicate.id).mergedInto).toBe(b.original.id);
    expect(world.byId(c.duplicate.id).mergedInto).toBe(c.original.id);
    // One lookup per project of the page.
    expect(
      world.lookups.map((lookup: { projectId: string }): string => {
        return lookup.projectId;
      }),
    ).toEqual([PROJECT, OTHER_PROJECT]);
  });
});

describe("a lookalike that is not provably a duplicate is left as it is", () => {
  test("made before the exception its text finds: never one", async () => {
    const world: World = new World();
    splitPair(world, { originalAt: day(9), duplicateAt: day(2) });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.notADuplicate).toBe(1);
  });

  test("made at the very moment the other was: not one either", async () => {
    const world: World = new World();
    splitPair(world, { originalAt: day(4), duplicateAt: day(4) });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.notADuplicate).toBe(1);
  });

  test("its stored text is not what it arrived as: a scrub rule changed it, and nothing proves which fingerprints it tried", async () => {
    const world: World = new World();
    const arrived: ExceptionGroupingContent = framesText("scrubbed");
    const stored: ExceptionGroupingContent = {
      ...arrived,
      message: "Cannot read properties of undefined (reading '[REDACTED]')",
    };
    world.add({
      text: arrived,
      fingerprint: fingerprintOfEra("v4", arrived),
      createdAt: day(1),
    });
    // Filed under the v1 of what it arrived as; it stored what the rule left.
    world.add({
      text: arrived,
      stored,
      fingerprint: fingerprintOfEra("v1", arrived),
      createdAt: day(6),
    });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.notOfTheirOwnText).toBe(2);
  });

  test("an exception made under its newest fingerprint, as every new one is, beside an older one of the same code", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("newest");
    // The same code through a library: the same v2, its own v1.
    const otherLine: ExceptionGroupingContent = throughALibrary(text);
    expect(fingerprintOfEra("v2", otherLine)).toBe(
      fingerprintOfEra("v2", text),
    );
    expect(fingerprintOfEra("v1", otherLine)).not.toBe(
      fingerprintOfEra("v1", text),
    );
    world.add({
      text: otherLine,
      fingerprint: fingerprintOfEra("v1", otherLine),
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    world.add({
      text,
      fingerprint: fingerprintOfEra("v4", text),
      createdAt: day(3),
    });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    // Made before grouping v2: never read. The new one is not under its v1.
    expect(result.read).toBe(1);
    expect(result.notOfTheirOwnText).toBe(1);
  });

  test("no exception exists under any fingerprint its text tries later: its error is its own", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("alone");
    world.add({
      text,
      fingerprint: fingerprintOfEra("v1", text),
      createdAt: day(6),
    });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.notADuplicate).toBe(1);
  });

  test("the same error in another service is another service's exception", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("elsewhere");
    world.add({
      text,
      fingerprint: fingerprintOfEra("v4", text, { serviceId: OTHER_SERVICE }),
      serviceId: OTHER_SERVICE,
      createdAt: day(1),
    });
    world.add({
      text,
      fingerprint: fingerprintOfEra("v1", text),
      createdAt: day(6),
    });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.notADuplicate).toBe(1);
  });

  test("the same error in another project is never looked up there", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("project");
    world.add({
      text,
      projectId: OTHER_PROJECT,
      fingerprint: fingerprintOfEra("v4", text, { projectId: OTHER_PROJECT }),
      createdAt: day(1),
    });
    world.add({
      text,
      fingerprint: fingerprintOfEra("v1", text),
      createdAt: day(6),
    });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    for (const lookup of world.lookups) {
      expect(lookup.projectId).toBe(PROJECT);
    }
  });

  test("merged, deleted, a former fingerprint, made before grouping v2 or after the sweep started: never read", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("unread");
    const original: WorldRow = world.add({
      text,
      fingerprint: fingerprintOfEra("v4", text),
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    });

    for (const [name, extra] of [
      ["merged", { mergedInto: original.id }],
      ["deleted", { deletedAt: day(12) }],
      ["former", { formerFingerprintOf: original.id }],
    ] as Array<
      [
        string,
        { mergedInto?: string; deletedAt?: Date; formerFingerprintOf?: string },
      ]
    >) {
      const other: ExceptionGroupingContent = framesText(name);
      world.add({
        text: other,
        fingerprint: fingerprintOfEra("v1", other),
        createdAt: day(6),
        ...extra,
      });
    }

    world.add({
      text,
      fingerprint: fingerprintOfEra("v1", text),
      createdAt: new Date("2026-10-29T23:59:59.000Z"),
    });
    world.add({
      text: framesText("later"),
      fingerprint: fingerprintOfEra("v1", framesText("later")),
      createdAt: new Date(NOW.getTime() + 1000),
    });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.read).toBe(0);
  });

  test("an exception whose text is longer than it reads is left, and no text of it is handled", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = {
      ...framesText("huge"),
      stackTrace: `${framesText("huge").stackTrace}\n${"    at frame (/app/src/deep.js:1:1)\n".repeat(20000)}`,
    };
    expect(
      Buffer.byteLength(text.stackTrace) + Buffer.byteLength(text.message),
    ).toBeGreaterThan(MAX_TEXT_BYTES);
    splitPair(world, { text });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    // Both too long: neither is read.
    expect(result.tooLongToRead).toBe(2);
    expect(world.lookups).toEqual([]);
  });

  test("one with no service, which no fingerprint was ever made without", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("serviceless");
    world.add({
      text,
      fingerprint: fingerprintOfEra("v1", text),
      createdAt: day(6),
      serviceId: null,
    });

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.notOfTheirOwnText).toBe(1);
  });

  test("when the read does not say when the other was made, nothing is assumed", async () => {
    const world: World = new World();
    const { duplicate } = splitPair(world);

    const result: MergeBackSplitsResult = await world.sweep({
      readKnownGroups: async (
        projectId: string,
        fingerprints: Array<string>,
      ): Promise<Map<string, KnownGroup>> => {
        const groups: Map<string, KnownGroup> = new Map();

        for (const row of world.rows) {
          if (
            row.projectId === projectId &&
            fingerprints.includes(row.fingerprint)
          ) {
            groups.set(
              row.fingerprint,
              row.id === duplicate.id
                ? { exists: true, createdAt: row.createdAt.getTime() }
                : { exists: true },
            );
          }
        }

        return groups;
      },
    });

    expectLeft(world, result);
    expect(result.notADuplicate).toBe(1);
  });
});

describe("every occurrence ClickHouse keeps must say the same", () => {
  test("every one leads to the same exception: merged", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("agree");
    const { duplicate } = splitPair(world, { text });
    // The same error, other values the normalizer folds.
    world.occur(duplicate, text);
    world.occur(duplicate, {
      ...text,
      stackTrace: text.stackTrace.replace(":10:5", ":10:6"),
    });

    const result: MergeBackSplitsResult = await world.sweep();

    expect(result.merged).toBe(1);
  });

  test("two texts v1 cannot tell apart are two errors to v2", () => {
    expect(fingerprintOfEra("v1", ONE_FOR_V1)).toBe(
      fingerprintOfEra("v1", OTHER_FOR_V1),
    );
    for (const era of ["v2", "v3", "v4"] as Array<Era>) {
      expect(fingerprintOfEra(era, ONE_FOR_V1)).not.toBe(
        fingerprintOfEra(era, OTHER_FOR_V1),
      );
    }
  });

  test("one of them leads to another exception: they may not be one error, and are left", async () => {
    const world: World = new World();
    const { duplicate } = splitPair(world, { text: ONE_FOR_V1 });
    // The other error has an exception of its own, older too.
    world.add({
      text: OTHER_FOR_V1,
      fingerprint: fingerprintOfEra("v4", OTHER_FOR_V1),
      createdAt: day(1),
    });
    world.occur(duplicate, ONE_FOR_V1);
    world.occur(duplicate, OTHER_FOR_V1);

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.occurrencesDisagree).toBe(1);
  });

  test("one of them leads to no exception at all: left", async () => {
    const world: World = new World();
    const { duplicate } = splitPair(world, { text: ONE_FOR_V1 });
    world.occur(duplicate, OTHER_FOR_V1);

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.occurrencesDisagree).toBe(1);
    // Its fingerprints were looked up, beside the page's: only those unread.
    expect(world.lookups).toHaveLength(2);
    expect(world.lookups[1]!.fingerprints).not.toContain(duplicate.fingerprint);
    expect(world.lookups[1]!.fingerprints).toEqual(
      fingerprintsOf(OTHER_FOR_V1).fingerprintCandidates.filter(
        (fingerprint: string): boolean => {
          return !world.lookups[0]!.fingerprints.includes(fingerprint);
        },
      ),
    );
  });

  test("without its occurrences, the stored text is all there is: one v1 conflated is merged as the stored text says", async () => {
    const world: World = new World();
    const { original, duplicate } = splitPair(world, { text: ONE_FOR_V1 });

    await world.sweep();

    // Nothing ClickHouse keeps says otherwise.
    expect(world.byId(duplicate.id).mergedInto).toBe(original.id);
  });

  test("one whose text a scrub rule changed proves nothing either way, and is passed over", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("passed");
    const { duplicate } = splitPair(world, { text });
    world.occur(duplicate, {
      ...text,
      message: "Cannot read properties of undefined (reading '[REDACTED]')",
    });
    world.occur(duplicate, text);

    const result: MergeBackSplitsResult = await world.sweep();

    expect(result.merged).toBe(1);
  });

  test("none kept, past their retention: the stored text stands alone", async () => {
    const world: World = new World();
    splitPair(world);

    const result: MergeBackSplitsResult = await world.sweep();

    expect(result.merged).toBe(1);
    expect(world.occurrenceReads).toHaveLength(1);
  });

  test("they could not be read: left, and the sweep goes on", async () => {
    const world: World = new World();
    splitPair(world, { text: framesText("first") });
    world.occurrencesFail = true;

    const result: MergeBackSplitsResult = await world.sweep();

    expectLeft(world, result);
    expect(result.occurrencesUnread).toBe(1);
    expect(result.isDone).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("they are read for the duplicate alone, over its seen times and a minute either side, the earliest and the latest", async () => {
    const world: World = new World();
    const { duplicate } = splitPair(world);

    await world.sweep();

    expect(world.occurrenceReads).toEqual([
      {
        projectId: PROJECT,
        primaryEntityId: SERVICE,
        fingerprint: duplicate.fingerprint,
        from: new Date(day(9).getTime() - OCCURRENCE_WINDOW_SLACK_MS),
        to: new Date(day(11).getTime() + OCCURRENCE_WINDOW_SLACK_MS),
        limit: OCCURRENCES_READ,
      },
    ]);
  });

  test("an occurrence leading to the moved exception's former fingerprint leads to the same exception", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("formerly");
    const moved: WorldRow = world.add({
      text,
      fingerprint: fingerprintOfEra("keyed v2", text),
      createdAt: day(1),
    });
    world.add({
      text,
      fingerprint: fingerprintOfEra("v2", text),
      createdAt: day(20),
      formerFingerprintOf: moved.id,
    });
    const duplicate: WorldRow = world.add({
      text,
      fingerprint: fingerprintOfEra("v1", text),
      createdAt: day(5),
    });
    world.occur(duplicate, text);

    const result: MergeBackSplitsResult = await world.sweep();

    expect(result.merged).toBe(1);
  });

  test("the same text many times over is worked out once", async () => {
    const world: World = new World();
    const text: ExceptionGroupingContent = framesText("repeated");
    const { duplicate } = splitPair(world, { text });

    for (let index: number = 0; index < 50; index++) {
      world.occur(duplicate, text);
    }

    const spy: SpyInstance<typeof ExceptionUtil.getOccurrenceFingerprints> =
      jest.spyOn(ExceptionUtil, "getOccurrenceFingerprints");

    const result: MergeBackSplitsResult = await world.sweep();

    expect(result.merged).toBe(1);
    // The stored text's and the one distinct occurrence's.
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("what the heal decides is what happens", () => {
  test.each([
    [ExceptionSplitHealOutcome.AlreadyMerged, "alreadyMerged"],
    [ExceptionSplitHealOutcome.NotADuplicate, "notADuplicate"],
    [ExceptionSplitHealOutcome.LeftToAPerson, "leftToAPerson"],
    [ExceptionSplitHealOutcome.NotFound, "notFound"],
    [ExceptionSplitHealOutcome.Failed, "mergeFailed"],
  ] as Array<[ExceptionSplitHealOutcome, keyof MergeBackSplitsResult]>)(
    "%s",
    async (
      outcome: ExceptionSplitHealOutcome,
      counted: keyof MergeBackSplitsResult,
    ) => {
      const world: World = new World();
      splitPair(world);
      world.healOutcome = (): ExceptionSplitHealOutcome => {
        return outcome;
      };

      const result: MergeBackSplitsResult = await world.sweep();

      expect(world.heals).toHaveLength(1);
      expect(result.merged).toBe(0);
      expect(result[counted]).toBe(1);
      expect(result.isDone).toBe(true);
    },
  );

  test("a merge that failed is named in the log, without the exception's text", async () => {
    const world: World = new World();
    const { duplicate } = splitPair(world);
    world.healOutcome = (): ExceptionSplitHealOutcome => {
      return ExceptionSplitHealOutcome.Failed;
    };

    await world.sweep();

    const warned: string = JSON.stringify(jest.mocked(logger.warn).mock.calls);
    expect(warned).toContain(duplicate.id);
    expect(warned).not.toContain("reading 'cart'");
  });

  test("the default heal is TelemetryExceptionSplitHeal's", async () => {
    const heal: SpyInstance<typeof TelemetryExceptionSplitHeal.heal> = jest
      .spyOn(TelemetryExceptionSplitHeal, "heal")
      .mockResolvedValue(ExceptionSplitHealOutcome.Merged);
    const pair: ExceptionSplitByFailedLookup = {
      projectId: PROJECT,
      primaryEntityId: SERVICE,
      duplicate: "d",
      original: "o",
    };

    expect(await getDefaultMergeBackSplitsEnvironment().heal(pair)).toBe(
      ExceptionSplitHealOutcome.Merged,
    );
    expect(heal).toHaveBeenCalledWith(pair);
  });
});

describe("a page at a time, from where it stopped", () => {
  function manyExceptions(world: World, count: number): void {
    for (let index: number = 0; index < count; index++) {
      const text: ExceptionGroupingContent = framesText(`e${letters(index)}`);
      world.add({
        text,
        fingerprint: fingerprintOfEra("v4", text),
        createdAt: day(1 + (index % 20)),
      });
    }
  }

  test("pages in id order, each after the last id of the one before, the cut-off and where it is kept after each", async () => {
    const world: World = new World();
    manyExceptions(world, 250);

    const result: MergeBackSplitsResult = await world.sweep();

    expect(result).toMatchObject({ isDone: true, pages: 3, read: 250 });
    expect(
      world.pageReads.map((read: { after: string }): string => {
        return read.after;
      }),
    ).toEqual([FIRST_ID, world.rows[99]!.id, world.rows[199]!.id]);
    for (const read of world.pageReads) {
      expect(read.cutoff).toEqual(NOW);
      expect(read.limit).toBe(PAGE_SIZE);
    }
    // Where it is: written before the first page, then after each.
    expect(world.progressWrites).toEqual([
      { cutoff: NOW, after: FIRST_ID },
      { cutoff: NOW, after: world.rows[99]!.id },
      { cutoff: NOW, after: world.rows[199]!.id },
      { cutoff: NOW, after: world.rows[249]!.id },
    ]);
    expect(world.markers).toEqual([NOW]);
  });

  test("a full last page reads once more, finds nothing and is done", async () => {
    const world: World = new World();
    manyExceptions(world, 200);

    const result: MergeBackSplitsResult = await world.sweep();

    expect(result).toMatchObject({ isDone: true, pages: 2, read: 200 });
    expect(world.pageReads).toHaveLength(3);
  });

  test("it goes on from where it is kept, with the first run's cut-off", async () => {
    const world: World = new World();
    manyExceptions(world, 150);
    const cutoff: Date = new Date(NOW.getTime() - DAY);
    world.progress = { cutoff, after: world.rows[119]!.id };

    const result: MergeBackSplitsResult = await world.sweep();

    expect(result.read).toBe(30);
    expect(world.pageReads[0]).toEqual({
      after: world.rows[119]!.id,
      cutoff,
      limit: PAGE_SIZE,
    });
  });

  test("it stops at its time budget between pages, and the next run goes on", async () => {
    const world: World = new World();
    manyExceptions(world, 300);
    const duplicates: Array<{ original: WorldRow; duplicate: WorldRow }> = [
      splitPair(world, { text: framesText("pone") }),
      splitPair(world, { text: framesText("ptwo") }),
    ];
    let clock: number = NOW.getTime();
    // Each page takes a minute.
    const now: () => Date = (): Date => {
      return new Date(clock);
    };
    const readPage: MergeBackSplitsEnvironment["readPage"] =
      world.environment().readPage!;

    const first: MergeBackSplitsResult = await world.sweep(
      {
        now,
        readPage: async (data: Parameters<typeof readPage>[0]) => {
          clock += 60 * 1000;
          return readPage(data);
        },
      },
      { timeBudgetMs: 2 * 60 * 1000 },
    );

    expect(first).toMatchObject({ isDone: false, pages: 2, read: 200 });
    expect(world.markers).toEqual([]);

    const second: MergeBackSplitsResult = await world.sweep();

    expect(second.isDone).toBe(true);
    expect(first.read + second.read).toBe(304);
    // Each read once, across the two runs.
    expect(world.pageReads[2]!.after).toBe(world.rows[199]!.id);
    for (const pair of duplicates) {
      expect(world.byId(pair.duplicate.id).mergedInto).toBe(pair.original.id);
    }
    expect(world.heals).toHaveLength(2);
  });

  test("it stops when its job's deadline passes", async () => {
    const world: World = new World();
    manyExceptions(world, 250);
    const deadline: JobDeadline = new JobDeadline();
    const readPage: MergeBackSplitsEnvironment["readPage"] =
      world.environment().readPage!;

    const result: MergeBackSplitsResult = await world.sweep(
      {
        readPage: async (data: Parameters<typeof readPage>[0]) => {
          const page: Array<SweptException> = await readPage(data);
          deadline.end();
          return page;
        },
      },
      { deadline },
    );

    expect(result).toMatchObject({ isDone: false, pages: 1, read: 100 });
    expect(world.progress?.after).toBe(world.rows[99]!.id);
  });

  test("a read that fails stops the run where it is, and the next run reads that page again", async () => {
    const world: World = new World();
    manyExceptions(world, 250);
    const pair: { original: WorldRow; duplicate: WorldRow } = splitPair(world, {
      text: framesText("after-failure"),
    });
    world.pageFailsAt = 2;

    await expect(world.sweep()).rejects.toThrow(
      "Connection terminated unexpectedly",
    );
    expect(world.progress?.after).toBe(world.rows[99]!.id);
    expect(world.markers).toEqual([]);

    world.pageFailsAt = null;
    const result: MergeBackSplitsResult = await world.sweep();

    expect(result.isDone).toBe(true);
    expect(world.pageReads[2]!.after).toBe(world.rows[99]!.id);
    expect(world.byId(pair.duplicate.id).mergedInto).toBe(pair.original.id);
  });

  test("a lookup that fails stops the run before its page is counted done", async () => {
    const world: World = new World();
    const pair: { original: WorldRow; duplicate: WorldRow } = splitPair(world);
    world.lookupFails = true;

    await expect(world.sweep()).rejects.toThrow("statement timeout");
    expect(world.progress?.after).toBe(FIRST_ID);
    expect(world.heals).toEqual([]);

    world.lookupFails = false;
    await world.sweep();

    expect(world.byId(pair.duplicate.id).mergedInto).toBe(pair.original.id);
  });

  test("a page that does not move on is refused rather than read for ever", async () => {
    const world: World = new World();
    manyExceptions(world, 100);
    const readPage: MergeBackSplitsEnvironment["readPage"] =
      world.environment().readPage!;

    await expect(
      world.sweep({
        readPage: async (data: Parameters<typeof readPage>[0]) => {
          return readPage({ ...data, after: FIRST_ID });
        },
        pageSize: 100,
      }),
    ).rejects.toThrow("did not move on");
  });

  test("once every exception is read it is recorded, and a run after reads nothing", async () => {
    const world: World = new World();
    splitPair(world);

    await world.sweep();
    world.pageReads = [];
    const again: MergeBackSplitsResult = await world.sweep();

    expect(again).toMatchObject({
      isDone: true,
      wasSweptBefore: true,
      read: 0,
    });
    expect(world.pageReads).toEqual([]);
    expect(world.markers).toHaveLength(1);
  });

  test("a large table, in small pages, cut short again and again, finishes with every duplicate merged once", async () => {
    const random: SeededRandom = seededRandom(11113);
    const world: World = new World();
    const pairs: Array<{ original: WorldRow; duplicate: WorldRow }> = [];

    for (let index: number = 0; index < 1200; index++) {
      if (random(10) === 0) {
        pairs.push(
          splitPair(world, {
            text:
              random(2) === 0
                ? framesText(`dup${letters(index)}`)
                : messageText(`dup${letters(index)}`),
            era: (["v2", "keyed v2", "v4"] as Array<Era>)[random(3)]!,
            originalAt: day(random(10)),
            duplicateAt: day(11 + random(15)),
          }),
        );
      } else {
        const text: ExceptionGroupingContent = framesText(
          `one${letters(index)}`,
        );
        world.add({
          text,
          fingerprint: fingerprintOfEra("v4", text),
          createdAt: day(random(25)),
        });
      }
    }

    // Ids drawn at random: the duplicates are everywhere in the table.
    const ids: Array<string> = world.rows.map((row: WorldRow): string => {
      return row.id;
    });
    for (let index: number = ids.length - 1; index > 0; index--) {
      const other: number = random(index + 1);
      [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    }
    world.rows.forEach((row: WorldRow, index: number): void => {
      row.id = ids[index]!;
    });

    expect(pairs.length).toBeGreaterThan(50);

    let runs: number = 0;
    const clock: { at: number } = { at: NOW.getTime() };

    while (!world.sweptAt) {
      runs++;
      const readPage: MergeBackSplitsEnvironment["readPage"] =
        world.environment().readPage!;
      const run: MergeBackExceptionsSplitByFailedLookups = world.migration({
        pageSize: 40,
        now: (): Date => {
          return new Date(clock.at);
        },
        readPage: async (data: Parameters<typeof readPage>[0]) => {
          clock.at += 1000;
          return readPage(data);
        },
      });

      // Three pages a run.
      await run.sweep({ timeBudgetMs: 3000 });
      expect(runs).toBeLessThan(100);
    }

    expect(runs).toBeGreaterThan(5);
    expect(world.heals).toHaveLength(pairs.length);
    for (const pair of pairs) {
      expect(world.byId(pair.duplicate.id).mergedInto).toBe(pair.original.id);
    }
    // Nothing else was merged.
    expect(
      world.rows.filter((row: WorldRow): boolean => {
        return Boolean(row.mergedInto);
      }),
    ).toHaveLength(pairs.length);
    // Every page read once, after the last: no row read twice.
    const afters: Array<string> = world.pageReads.map(
      (read: { after: string }): string => {
        return read.after;
      },
    );
    expect(new Set(afters).size).toBe(afters.length);
  });

  test("two runs at once merge each duplicate once", async () => {
    const world: World = new World();
    manyExceptions(world, 120);
    const pairs: Array<{ original: WorldRow; duplicate: WorldRow }> = [
      splitPair(world, { text: framesText("twiceone") }),
      splitPair(world, { text: framesText("twicetwo") }),
    ];

    const [first, second] = await Promise.all([world.sweep(), world.sweep()]);

    for (const pair of pairs) {
      expect(world.byId(pair.duplicate.id).mergedInto).toBe(pair.original.id);
    }
    // Merged once between them: a heal after finds it merged already.
    expect(first.merged + second.merged).toBe(2);
    expect(
      world.rows.filter((row: WorldRow): boolean => {
        return Boolean(row.mergedInto);
      }),
    ).toHaveLength(2);
  });

  test("a second run over every exception again changes nothing", async () => {
    const world: World = new World();
    manyExceptions(world, 30);
    splitPair(world, { text: framesText("rerun") });
    splitPair(world, { originalAt: day(9), duplicateAt: day(2) });

    await world.sweep();
    const merged: Array<string | null> = world.rows.map(
      (row: WorldRow): string | null => {
        return row.mergedInto;
      },
    );

    // Forgotten where it was and that it was done: it reads every one again.
    world.progress = null;
    world.sweptAt = null;
    world.heals = [];
    const again: MergeBackSplitsResult = await world.sweep();

    expect(again.isDone).toBe(true);
    expect(again.merged).toBe(0);
    expect(world.heals).toEqual([]);
    expect(
      world.rows.map((row: WorldRow): string | null => {
        return row.mergedInto;
      }),
    ).toEqual(merged);
  });
});

describe("at the upgrade, and the job after it", () => {
  test("the upgrade's run takes MIGRATION_TIME_BUDGET_MS at most", async () => {
    const world: World = new World();
    const migration: MergeBackExceptionsSplitByFailedLookups =
      world.migration();
    const sweep: SpyInstance<typeof migration.sweep> = jest.spyOn(
      migration,
      "sweep",
    );

    await migration.migrate();

    expect(sweep).toHaveBeenCalledWith({
      timeBudgetMs: MIGRATION_TIME_BUDGET_MS,
    });
    expect(MIGRATION_TIME_BUDGET_MS).toBeLessThanOrEqual(2 * 60 * 1000);
    expect(migration.name).toBe(MERGE_BACK_SPLITS_MIGRATION_NAME);
  });

  test("the upgrade's run never fails the chain of migrations", async () => {
    const world: World = new World();
    world.pageFailsAt = 1;

    await expect(world.migration().migrate()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  test("the job waits for the upgrade's run, then goes on, then does nothing", async () => {
    const world: World = new World();
    const pair: { original: WorldRow; duplicate: WorldRow } = splitPair(world);
    world.migratedAt = null;

    const before: MergeBackSplitsResult = await world
      .migration()
      .continueSweep({});

    expect(before.isWaitingForUpgrade).toBe(true);
    expect(world.pageReads).toEqual([]);

    world.migratedAt = NOW;
    const after: MergeBackSplitsResult = await world
      .migration()
      .continueSweep({});

    expect(after.isDone).toBe(true);
    expect(world.byId(pair.duplicate.id).mergedInto).toBe(pair.original.id);

    const done: MergeBackSplitsResult = await world
      .migration()
      .continueSweep({});

    expect(done.wasSweptBefore).toBe(true);
  });

  test("rollback changes nothing: Unmerge undoes a merge", async () => {
    await expect(new World().migration().rollback()).resolves.toBeUndefined();
  });

  test("it is registered after the migrations before it, and before the two kept last", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../FeatureSet/Workers/DataMigrations/Index.ts",
      ),
      "utf8",
    );
    const registered: number = source.indexOf(
      "new MergeBackExceptionsSplitByFailedLookups(),",
    );

    expect(registered).toBeGreaterThan(
      source.indexOf("new WorkOutMonitorsPausedByIncidents(),"),
    );
    expect(registered).toBeLessThan(
      source.indexOf("new BackfillIncidentCallTranscriptSignInAccount(),"),
    );
    expect(registered).toBeLessThan(
      source.indexOf("new AddAuditLogMcpClientColumns(),"),
    );
  });

  test("its job runs in the worker: every 15 minutes and at startup, bounded", () => {
    const workers: string = fs.readFileSync(
      path.join(__dirname, "../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );
    const job: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../FeatureSet/Workers/Jobs/TelemetryException/MergeBackExceptionsSplitByFailedLookups.ts",
      ),
      "utf8",
    );

    expect(workers).toContain(
      'import "./Jobs/TelemetryException/MergeBackExceptionsSplitByFailedLookups";',
    );
    expect(job).toContain("MERGE_BACK_SPLITS_JOB_NAME,");
    expect(job).toContain(
      "schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,",
    );
    expect(job).toContain("runOnStartup: true,");
    expect(job).toContain(".continueSweep({");
    expect(MERGE_BACK_SPLITS_JOB_NAME).toBe(
      "TelemetryException:MergeBackExceptionsSplitByFailedLookups",
    );
    expect(SWEPT_MARKER_NAME).toBe(
      "MergeBackExceptionsSplitByFailedLookups:Swept",
    );
  });
});

describe("the pieces", () => {
  test("an exception's stored text, with nothing for what it did not store", () => {
    expect(
      storedTextOf({ message: null, stackTrace: "at x", exceptionType: null }),
    ).toEqual({ message: "", stackTrace: "at x", exceptionType: "" });
  });

  test("too long to read is what the page left out", () => {
    const exception: SweptException = {
      id: FIRST_ID,
      projectId: PROJECT,
      primaryEntityId: SERVICE,
      fingerprint: "f",
      createdAt: day(1),
      firstSeenAt: null,
      lastSeenAt: null,
      textBytes: MAX_TEXT_BYTES,
      message: "m",
      stackTrace: null,
      exceptionType: null,
    };

    expect(isTooLongToRead(exception)).toBe(false);
    expect(
      isTooLongToRead({ ...exception, textBytes: MAX_TEXT_BYTES + 1 }),
    ).toBe(true);
    // Postgres hands a bigint back as text.
    expect(
      isTooLongToRead({ ...exception, textBytes: String(MAX_TEXT_BYTES + 1) }),
    ).toBe(true);
    expect(isTooLongToRead({ ...exception, textBytes: null })).toBe(false);
  });

  test("an occurrence of a text is worked out only when the fingerprint is grouping v1's of it", () => {
    const text: ExceptionGroupingContent = messageText("E");
    const fingerprints: OccurrenceFingerprints = fingerprintsOf(text);

    expect(
      occurrenceOfText({
        projectId: PROJECT,
        primaryEntityId: SERVICE,
        fingerprint: fingerprints.fingerprint,
        text,
      }),
    ).toEqual({
      projectId: PROJECT,
      primaryEntityId: SERVICE,
      v1: fingerprints.fingerprint,
      v2: fingerprints.fingerprintV2,
      candidates: fingerprints.fingerprintCandidates,
    });

    for (const era of [
      "keyed v1",
      "v2",
      "keyed v2",
      "v3",
      "v4",
      "keyed v4",
    ] as Array<Era>) {
      expect(
        occurrenceOfText({
          projectId: PROJECT,
          primaryEntityId: SERVICE,
          fingerprint: fingerprintOfEra(era, text),
          text,
        }),
      ).toBeNull();
    }

    // Another service's v1, or another project's: not this text's.
    expect(
      occurrenceOfText({
        projectId: PROJECT,
        primaryEntityId: OTHER_SERVICE,
        fingerprint: fingerprints.fingerprint,
        text,
      }),
    ).toBeNull();
    expect(
      occurrenceOfText({
        projectId: PROJECT,
        primaryEntityId: null,
        fingerprint: fingerprints.fingerprint,
        text,
      }),
    ).toBeNull();
  });

  test("where the sweep is reads back as it was written, and nothing else reads as anything", () => {
    const progress: SweepProgress = {
      cutoff: NOW,
      after: "11113000-0000-4000-8000-00000000abcd",
    };

    expect(readSweepProgress(writeSweepProgress(progress))).toEqual(progress);
    expect(
      readSweepProgress(
        JSON.stringify({
          cutoff: NOW.toISOString(),
          after: "11113000-0000-4000-8000-00000000ABCD",
        }),
      ),
    ).toEqual(progress);

    for (const value of [
      null,
      "",
      "not json",
      "[]",
      "42",
      JSON.stringify({ cutoff: "tomorrow", after: progress.after }),
      JSON.stringify({ cutoff: NOW.toISOString(), after: "1; DROP TABLE" }),
      JSON.stringify({ cutoff: NOW.toISOString() }),
    ]) {
      expect(readSweepProgress(value)).toBeNull();
    }
  });

  test("ingest's lookup rows read as ingest reads them", () => {
    const known: Map<string, KnownGroup> = knownGroupsOfLookupRows([
      { fingerprint: "a", createdAt: day(1) },
      {
        fingerprint: "b",
        movedTo: "b-keyed",
        createdAt: day(2).toISOString(),
        mergedInto: null,
      },
      { fingerprint: "c", createdAt: null, mergedInto: "survivor" },
      { fingerprint: "d", createdAt: "not a date" },
    ]);

    expect(known.get("a")).toEqual({
      exists: true,
      createdAt: day(1).getTime(),
    });
    expect(known.get("b")).toEqual({
      exists: true,
      movedTo: "b-keyed",
      createdAt: day(2).getTime(),
    });
    expect(known.get("c")).toEqual({ exists: true, mergedInto: "survivor" });
    expect(known.get("d")).toEqual({ exists: true });
    expect(known.has("e")).toBe(false);
    expect(knownGroupsOfLookupRows(null).size).toBe(0);
  });

  test("the page: since grouping v2, before the sweep, none deleted, merged or a former fingerprint, by id, its texts capped", () => {
    const sql: string = SWEEP_PAGE_SQL;

    expect(sql).toContain('WHERE "_id" > $1::uuid');
    expect(sql).toContain('"createdAt" >= $2');
    expect(sql).toContain('"createdAt" <= $4');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('"mergedIntoTelemetryExceptionId" IS NULL');
    expect(sql).toContain('"formerFingerprintOfTelemetryExceptionId" IS NULL');
    expect(sql).toContain('ORDER BY "_id" ASC LIMIT $5');
    expect(sql).toContain(
      'COALESCE(octet_length("message"), 0) + COALESCE(octet_length("stackTrace"), 0) + COALESCE(octet_length("exceptionType"), 0) AS "textBytes"',
    );
    expect(sql).toContain(
      'CASE WHEN "page"."textBytes" <= $3 THEN "page"."message" END AS "message"',
    );
    expect(sql).toContain(
      'CASE WHEN "page"."textBytes" <= $3 THEN "page"."stackTrace" END AS "stackTrace"',
    );
    expect(sql).toContain(
      'CASE WHEN "page"."textBytes" <= $3 THEN "page"."exceptionType" END AS "exceptionType"',
    );
  });

  test("the default page read and lookup go to Postgres with ingest's statements", async () => {
    const query: Mock<(sql: unknown) => Promise<Array<GroupLookupRow>>> =
      jest.fn(async (sql: unknown): Promise<Array<GroupLookupRow>> => {
        return sql === GROUP_FINGERPRINT_LOOKUP_SQL
          ? [{ fingerprint: "a", createdAt: day(1), movedTo: null }]
          : [];
      });
    jest
      .spyOn(TelemetryExceptionService, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
    const environment: MergeBackSplitsEnvironment =
      getDefaultMergeBackSplitsEnvironment();

    expect(
      await environment.readPage({
        after: FIRST_ID,
        since: GROUPING_V2_SINCE,
        cutoff: NOW,
        limit: 7,
        maxTextBytes: 99,
      }),
    ).toEqual([]);
    expect(query).toHaveBeenCalledWith(SWEEP_PAGE_SQL, [
      FIRST_ID,
      GROUPING_V2_SINCE,
      99,
      NOW,
      7,
    ]);

    const groups: Map<string, KnownGroup> = await environment.readKnownGroups(
      PROJECT,
      ["a", "b"],
    );
    expect(query).toHaveBeenCalledWith(GROUP_FINGERPRINT_LOOKUP_SQL, [
      PROJECT,
      ["a", "b"],
    ]);
    expect(groups.get("a")).toEqual({
      exists: true,
      createdAt: day(1).getTime(),
    });
    expect(groups.has("b")).toBe(false);
    expect(environment.pageSize).toBe(PAGE_SIZE);
  });

  test("ClickHouse is asked for the earliest and the latest originals still kept, bounded", async () => {
    const statements: Array<Statement> = [];
    const settings: Array<unknown> = [];
    jest
      .spyOn(ExceptionInstanceService, "executeQuery")
      .mockImplementation((async (
        statement: Statement,
        options?: { clickhouseSettings?: unknown },
      ) => {
        statements.push(statement);
        settings.push(options?.clickhouseSettings);
        return {
          json: async () => {
            return {
              data: [
                {
                  message: `m${statements.length}`,
                  stackTrace: "",
                  exceptionType: null,
                },
              ],
            };
          },
        };
      }) as never);

    const texts: Array<ExceptionGroupingContent> =
      await readOccurrenceTextsFromClickhouse({
        projectId: PROJECT,
        primaryEntityId: SERVICE,
        fingerprint: "fp",
        from: day(1),
        to: day(2),
        limit: OCCURRENCES_READ,
      });

    expect(texts).toEqual([
      { message: "m1", stackTrace: "", exceptionType: "" },
      { message: "m2", stackTrace: "", exceptionType: "" },
    ]);
    expect(statements).toHaveLength(2);

    for (const [index, order] of [
      [0, "ASC"],
      [1, "DESC"],
    ] as Array<[number, string]>) {
      const query: string = statements[index]!.query;

      const params: Record<string, unknown> = statements[index]!.query_params;

      expect(query).toBe(
        `SELECT message, stackTrace, exceptionType FROM {p0:Identifier} WHERE projectId = {p1:String} AND primaryEntityId = {p2:String} AND fingerprint = {p3:String} AND time >= {p4:DateTime64(9)} AND time <= {p5:DateTime64(9)} AND retentionDate >= now() AND duplicateOf = '' ORDER BY time ${order} LIMIT {p6:Int32}`,
      );
      expect(params["p0"]).toBe(AnalyticsTableName.ExceptionInstance);
      expect(params["p1"]).toBe(PROJECT);
      expect(params["p2"]).toBe(SERVICE);
      expect(params["p3"]).toBe("fp");
      expect(params["p6"]).toBe(OCCURRENCES_READ);
      expect(settings[index]).toEqual({
        max_execution_time: OCCURRENCE_READ_TIME_LIMIT_SECONDS,
      });
    }
  });
});

describe("where the sweep is kept, and that it is done", () => {
  const manager: { query: () => Promise<Array<unknown>> } = {
    query: async (): Promise<Array<unknown>> => {
      return [];
    },
  };

  beforeEach(() => {
    jest
      .spyOn(DataMigrationService, "getRepository")
      .mockReturnValue({ manager } as never);
  });

  test("Valkey keeps where it is, under the migration's name, for sixty days after its last page", async () => {
    const kept: Map<string, string> = new Map();
    const set: SpyInstance<typeof GlobalCache.setString> = jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          kept.set(`${namespace}|${key}`, value);
        },
      );
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (namespace: string, key: string) => {
        return kept.get(`${namespace}|${key}`) || null;
      });
    const environment: MergeBackSplitsEnvironment =
      getDefaultMergeBackSplitsEnvironment();
    const progress: SweepProgress = {
      cutoff: NOW,
      after: "11113000-0000-4000-8000-0000000000ff",
    };

    expect(await environment.readProgress()).toBeNull();

    await environment.writeProgress(progress);

    expect(set).toHaveBeenCalledWith(
      SWEEP_PROGRESS_NAMESPACE,
      MERGE_BACK_SPLITS_MIGRATION_NAME,
      writeSweepProgress(progress),
      { expiresInSeconds: SWEEP_PROGRESS_TTL_SECONDS },
    );
    expect(SWEEP_PROGRESS_TTL_SECONDS).toBe(60 * 24 * 60 * 60);
    expect(await environment.readProgress()).toEqual(progress);
  });

  test("without Valkey it starts from the first exception, and goes on without keeping where it is", async () => {
    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new Error("Cache is not connected"));
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected"));
    const environment: MergeBackSplitsEnvironment =
      getDefaultMergeBackSplitsEnvironment();

    expect(await environment.readProgress()).toBeNull();
    await expect(
      environment.writeProgress({ cutoff: NOW, after: FIRST_ID }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  test("done and upgraded are read from the DataMigrations table, as the runner records them", async () => {
    const executedAt: SpyInstance<typeof PresentedKeysAtRest.getExecutedAt> =
      jest
        .spyOn(PresentedKeysAtRest, "getExecutedAt")
        .mockImplementation(async (_runner: unknown, name: string) => {
          return name === MERGE_BACK_SPLITS_MIGRATION_NAME ? NOW : null;
        });
    const environment: MergeBackSplitsEnvironment =
      getDefaultMergeBackSplitsEnvironment();

    expect(await environment.readMigratedAt()).toEqual(NOW);
    expect(await environment.isSwept()).toBe(false);
    expect(executedAt).toHaveBeenCalledWith(manager, SWEPT_MARKER_NAME);
    expect(executedAt).toHaveBeenCalledWith(
      manager,
      MERGE_BACK_SPLITS_MIGRATION_NAME,
    );
  });

  test("done is recorded once, as OneUptime", async () => {
    let recorded: Date | null = null;
    jest
      .spyOn(PresentedKeysAtRest, "getExecutedAt")
      .mockImplementation(async () => {
        return recorded;
      });
    const create: SpyInstance<typeof DataMigrationService.create> = jest
      .spyOn(DataMigrationService, "create")
      .mockImplementation((async (data: {
        data: { name?: string; executed?: boolean; executedAt?: Date };
        props: { isRoot?: boolean };
      }) => {
        recorded = data.data.executedAt || null;
        return data.data;
      }) as never);
    const environment: MergeBackSplitsEnvironment =
      getDefaultMergeBackSplitsEnvironment();

    await environment.recordSwept(NOW);
    await environment.recordSwept(NOW);

    expect(create).toHaveBeenCalledTimes(1);
    const marker: { name?: string; executed?: boolean; executedAt?: Date } = (
      create.mock.calls[0]![0] as unknown as {
        data: { name?: string; executed?: boolean; executedAt?: Date };
      }
    ).data;
    expect(marker.name).toBe(SWEPT_MARKER_NAME);
    expect(marker.executed).toBe(true);
    expect(marker.executedAt).toEqual(NOW);
    expect(
      (create.mock.calls[0]![0] as unknown as { props: { isRoot?: boolean } })
        .props,
    ).toEqual({ isRoot: true });
    expect(await environment.isSwept()).toBe(true);
  });
});
