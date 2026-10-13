import { afterEach, describe, expect, jest, test } from "@jest/globals";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import ToolImportRecord from "../../../../Models/DatabaseModels/ToolImportRecord";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import ToolImportRecordService from "../../../../Server/Services/ToolImportRecordService";
import ToolImportProjectStateReader from "../../../../Server/Utils/ToolImport/ToolImportProjectStateReader";
import ObjectID from "../../../../Types/ObjectID";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import { idsNamedBy } from "./ToolImportApplierWorld";

/*
 * The status page subscribers earlier imports of a tool brought over that
 * the project still has: what the next read of the tool reads past, so it
 * collects the subscribers still to come. Every one counts, however many
 * imports it took; one deleted in OneUptime since does not, so it is read,
 * and offered, again.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

// What earlier imports remembered: a row for each of `count` subscribers.
function rememberedSubscribers(count: number): Array<ToolImportRecord> {
  return Array.from(
    { length: count },
    (_value: unknown, index: number): ToolImportRecord => {
      const record: ToolImportRecord = new ToolImportRecord();
      record.projectId = PROJECT_ID;
      record.source = ToolImportSource.AtlassianStatuspage;
      record.kind = ToolImportResourceKind.StatusPageSubscriber;
      record.sourceId = `sub-${index}`;
      record.recordId = ObjectID.generate();
      record.isComplete = true;
      return record;
    },
  );
}

interface Reads {
  records: Array<Record<string, unknown>>;
  // The ids each read of subscribers named, and how many it asked for.
  subscribers: Array<{ ids: Set<string> | null; limit: unknown }>;
}

// The remembered rows, and the subscribers the project has (by id).
function serve(data: {
  records: Array<ToolImportRecord>;
  subscriberIds: Array<string>;
}): Reads {
  const reads: Reads = { records: [], subscribers: [] };

  jest.spyOn(ToolImportRecordService, "findAllBy").mockImplementation((async (
    args: Record<string, unknown>,
  ): Promise<Array<ToolImportRecord>> => {
    reads.records.push(args);
    return data.records;
  }) as never);

  jest
    .spyOn(StatusPageSubscriberService, "findBy")
    .mockImplementation((async (args: {
      query: { _id?: unknown };
      limit?: unknown;
    }): Promise<Array<StatusPageSubscriber>> => {
      const ids: Set<string> | null = idsNamedBy(args.query._id);
      reads.subscribers.push({ ids: ids, limit: args.limit });

      return data.subscriberIds
        .filter((id: string): boolean => {
          return !ids || ids.has(id.toLowerCase());
        })
        .map((id: string): StatusPageSubscriber => {
          const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
          subscriber._id = id;
          return subscriber;
        });
    }) as never);

  return reads;
}

async function readImported(): Promise<Set<string>> {
  return await ToolImportProjectStateReader.readImportedSubscriberIds({
    projectId: PROJECT_ID,
    source: ToolImportSource.AtlassianStatuspage,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ToolImportProjectStateReader.readImportedSubscriberIds", () => {
  test("the tool's ids of the subscribers its imports brought over that the project still has", async () => {
    const records: Array<ToolImportRecord> = rememberedSubscribers(3);
    // sub-1 was deleted in OneUptime since.
    const reads: Reads = serve({
      records: records,
      subscriberIds: [
        records[0]!.recordId!.toString(),
        records[2]!.recordId!.toString(),
      ],
    });

    expect([...(await readImported())]).toEqual(["sub-0", "sub-2"]);

    // This tool's subscribers only, and every one of them: no limit.
    expect(reads.records).toHaveLength(1);
    expect(reads.records[0]!["query"]).toEqual({
      projectId: PROJECT_ID,
      source: ToolImportSource.AtlassianStatuspage,
      kind: ToolImportResourceKind.StatusPageSubscriber,
    });
    expect(reads.records[0]).not.toHaveProperty("limit");
    // Looked up by their ids.
    expect(reads.subscribers).toEqual([
      {
        ids: new Set<string>(
          records.map((record: ToolImportRecord): string => {
            return record.recordId!.toString().toLowerCase();
          }),
        ),
        limit: 3,
      },
    ]);
  });

  test("more than one read's worth are looked up a thousand at a time, and all of them count", async () => {
    const records: Array<ToolImportRecord> = rememberedSubscribers(2500);
    const reads: Reads = serve({
      records: records,
      subscriberIds: records.map((record: ToolImportRecord): string => {
        return record.recordId!.toString();
      }),
    });

    expect((await readImported()).size).toBe(2500);
    expect(
      reads.subscribers.map(
        (read: { ids: Set<string> | null; limit: unknown }): unknown => {
          return [read.ids?.size, read.limit];
        },
      ),
    ).toEqual([
      [1000, 1000],
      [1000, 1000],
      [500, 500],
    ]);
  });

  test("with nothing brought over before, no subscriber is read", async () => {
    const reads: Reads = serve({ records: [], subscriberIds: [] });

    expect(await readImported()).toEqual(new Set<string>());
    expect(reads.subscribers).toEqual([]);
  });
});
