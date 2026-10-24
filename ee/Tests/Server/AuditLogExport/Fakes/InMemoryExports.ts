import { jest } from "@jest/globals";
import AuditLogExportService from "Common/Server/Services/AuditLogExportService";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * The exports as the exporter reads and writes them, in memory: what
 * AuditLogExportService answers findAllBy and findOneById with, and how its
 * two hook-free writes behave - compareAndSetColumnsByIdWithoutHooks writes
 * only while every expected value still holds (null-safe), as its single
 * UPDATE ... WHERE does. The Postgres suite runs the same exporter on the
 * real table. Not a test file itself.
 */

export interface StoredExport {
  _id: string;
  projectId: string | null;
  name: string;
  destinationType: AuditLogExportDestinationType;
  config: JSONObject;
  secrets: JSONObject;
  isEnabled: boolean;
  startsAt: Date;
  createdAt: Date;
  cursorCreatedAt: Date | null;
  cursorEntryId: string | null;
  exportedEntryCount: number;
  lastExportedAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  failingSince: Date | null;
  consecutiveFailureCount: number;
  nextAttemptAt: Date | null;
}

export interface InMemoryExports {
  rows: Map<string, StoredExport>;
  get: (id: string) => StoredExport;
  // Every compare-and-set the exporter asked for, and whether it wrote.
  compareAndSets: Array<{ id: string; wrote: boolean }>;
  // Moves a row's cursor behind the exporter's back (another worker, a restart from a date).
  moveCursor: (
    id: string,
    cursor: { createdAt: Date; id: string } | null,
  ) => void;
}

export function newStoredExport(
  overrides: Partial<StoredExport> & {
    destinationType: AuditLogExportDestinationType;
    config: JSONObject;
  },
): StoredExport {
  return {
    _id: ObjectID.generate().toString(),
    projectId: null,
    name: "Export",
    secrets: {},
    isEnabled: true,
    startsAt: new Date("2026-10-24T00:00:00.000Z"),
    createdAt: new Date("2026-10-24T00:00:00.000Z"),
    cursorCreatedAt: null,
    cursorEntryId: null,
    exportedEntryCount: 0,
    lastExportedAt: null,
    lastAttemptAt: null,
    lastError: null,
    failingSince: null,
    consecutiveFailureCount: 0,
    nextAttemptAt: null,
    ...overrides,
  };
}

function toModel(row: StoredExport): AuditLogExport {
  const item: AuditLogExport = new AuditLogExport();
  item.id = new ObjectID(row._id);

  if (row.projectId) {
    item.projectId = new ObjectID(row.projectId);
  }

  item.name = row.name;
  item.destinationType = row.destinationType;
  item.config = row.config;
  item.secrets = JSON.stringify(row.secrets);
  item.isEnabled = row.isEnabled;
  item.startsAt = row.startsAt;
  item.createdAt = row.createdAt;

  if (row.cursorCreatedAt) {
    item.cursorCreatedAt = row.cursorCreatedAt;
  }

  if (row.cursorEntryId) {
    item.cursorEntryId = new ObjectID(row.cursorEntryId);
  }

  item.exportedEntryCount = row.exportedEntryCount;

  if (row.lastError) {
    item.lastError = row.lastError;
  }

  if (row.failingSince) {
    item.failingSince = row.failingSince;
  }

  item.consecutiveFailureCount = row.consecutiveFailureCount;

  if (row.nextAttemptAt) {
    item.nextAttemptAt = row.nextAttemptAt;
  }

  return item;
}

function sameValue(stored: unknown, expected: unknown): boolean {
  const normalize: (value: unknown) => string | null = (
    value: unknown,
  ): string | null => {
    if (value === undefined || value === null) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return String(value).toLowerCase();
  };

  return normalize(stored) === normalize(expected);
}

export function useInMemoryExports(rows: Array<StoredExport>): InMemoryExports {
  const store: Map<string, StoredExport> = new Map<string, StoredExport>(
    rows.map((row: StoredExport): [string, StoredExport] => {
      return [row._id, row];
    }),
  );
  const compareAndSets: InMemoryExports["compareAndSets"] = [];

  const apply: (id: string, data: Record<string, unknown>) => void = (
    id: string,
    data: Record<string, unknown>,
  ): void => {
    const row: StoredExport | undefined = store.get(id);

    if (!row) {
      return;
    }

    for (const [key, value] of Object.entries(data)) {
      (row as unknown as Record<string, unknown>)[key] =
        value instanceof ObjectID ? value.toString() : value ?? null;
    }
  };

  jest
    .spyOn(AuditLogExportService, "findAllBy")
    .mockImplementation((async (data: { query: JSONObject }) => {
      return Array.from(store.values())
        .filter((row: StoredExport): boolean => {
          return data.query["isEnabled"] === undefined || row.isEnabled;
        })
        .map(toModel);
    }) as never);

  jest
    .spyOn(AuditLogExportService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      const row: StoredExport | undefined = store.get(data.id.toString());
      return row ? toModel(row) : null;
    }) as never);

  jest
    .spyOn(AuditLogExportService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData: Record<string, unknown>;
    }) => {
      const row: StoredExport | undefined = store.get(input.id.toString());
      const wrote: boolean =
        Boolean(row) &&
        Object.entries(input.expectedData).every(
          ([key, value]: [string, unknown]): boolean => {
            return sameValue(
              (row as unknown as Record<string, unknown>)[key],
              value instanceof ObjectID ? value.toString() : value,
            );
          },
        );

      compareAndSets.push({ id: input.id.toString(), wrote });

      if (wrote) {
        apply(input.id.toString(), input.data);
      }

      return wrote;
    }) as never);

  jest
    .spyOn(AuditLogExportService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      apply(input.id.toString(), input.data);
    }) as never);

  return {
    rows: store,
    compareAndSets,
    get: (id: string): StoredExport => {
      const row: StoredExport | undefined = store.get(id);

      if (!row) {
        throw new Error(`No export ${id}.`);
      }

      return row;
    },
    moveCursor: (
      id: string,
      cursor: { createdAt: Date; id: string } | null,
    ): void => {
      const row: StoredExport = store.get(id)!;
      row.cursorCreatedAt = cursor ? cursor.createdAt : null;
      row.cursorEntryId = cursor ? cursor.id : null;
    },
  };
}
