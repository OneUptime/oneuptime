import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A CLOUDFLARE CONNECTION THAT BLOCKS IS NOT DELETED (#10343).
 *
 * Its blocking is turned off first, and turning it off asks whether to take
 * OneUptime's lists and rules away from Cloudflare - which takes the
 * connection's token, gone with the connection. So while blocking is on, or
 * OneUptime is still taking them away, a delete is refused with what to do;
 * once it is off and settled, the connection deletes as any other. Driven
 * through the service's real delete, with the table in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10343000-0000-4000-8000-0000000000aa",
);

function connection(data: {
  provider?: SecurityEventConnectorProvider | undefined;
  blockingSettings?: JSONObject | null | undefined;
  blockingStatus?: JSONObject | null | undefined;
}): StoredRow {
  return {
    _id: ObjectID.generate().toString(),
    projectId: PROJECT_ID.toString(),
    name: "Production Cloudflare",
    provider: data.provider || SecurityEventConnectorProvider.Cloudflare,
    config: {},
    secrets: "{}",
    isEnabled: true,
    blockingSettings: data.blockingSettings ?? null,
    blockingStatus: data.blockingStatus ?? null,
  };
}

function useTable(row: StoredRow): InMemoryTable {
  return useInMemoryTable(
    SecurityEventConnectionService as unknown as DatabaseService<BaseModel>,
    [row],
  );
}

async function deleteIt(row: StoredRow): Promise<void> {
  await SecurityEventConnectionService.deleteOneById({
    id: new ObjectID(String(row["_id"])),
    props: { isRoot: true },
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("deleting a Cloudflare connection", () => {
  test("is refused while it blocks addresses, saying to turn blocking off first", async () => {
    const row: StoredRow = connection({
      blockingSettings: { isEnabled: true, zoneIds: [] },
    });
    const table: InMemoryTable = useTable(row);

    await expect(deleteIt(row)).rejects.toThrow(
      "Production Cloudflare blocks addresses at Cloudflare. Turn blocking off first: OneUptime then asks whether to remove its lists and rules from Cloudflare.",
    );
    expect(table.deletes).toEqual([]);
  });

  test("is refused while OneUptime is still removing its lists and rules", async () => {
    const row: StoredRow = connection({
      blockingSettings: {
        isEnabled: false,
        zoneIds: [],
        removalRequestedAt: "2026-11-21T10:42:00.000Z",
      },
      blockingStatus: null,
    });
    useTable(row);

    await expect(deleteIt(row)).rejects.toThrow(
      "OneUptime is still removing its lists and rules from Cloudflare for Production Cloudflare. Delete it once that is done, in a few minutes.",
    );
  });

  test("deletes once blocking is off and the removal is done, or was never asked", async () => {
    for (const row of [
      connection({
        blockingSettings: {
          isEnabled: false,
          zoneIds: [],
          removalRequestedAt: "2026-11-21T10:42:00.000Z",
        },
        blockingStatus: {
          checkedAt: "2026-11-21T10:43:00.000Z",
          actions: [],
          zones: [],
          removalDoneFor: "2026-11-21T10:42:00.000Z",
        },
      }),
      connection({ blockingSettings: { isEnabled: false, zoneIds: [] } }),
      connection({ blockingSettings: null }),
    ]) {
      const table: InMemoryTable = useTable(row);

      await deleteIt(row);

      expect(table.rows).toEqual([]);
      jest.restoreAllMocks();
    }
  });

  test("a connection of another provider deletes as before", async () => {
    const row: StoredRow = connection({
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      blockingSettings: { isEnabled: true, zoneIds: [] },
    });
    const table: InMemoryTable = useTable(row);

    await deleteIt(row);

    expect(table.rows).toEqual([]);
  });
});
