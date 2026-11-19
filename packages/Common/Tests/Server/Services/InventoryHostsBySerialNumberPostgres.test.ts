import Entities from "../../../Models/DatabaseModels/Index";
import { FIND_HOSTS_BY_SERIAL_NUMBER_SQL } from "../../../Server/Services/InventoryItemService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import { DataSource } from "typeorm";

/*
 * The query an Esper connection finds a device's host by when telemetry
 * names the device another way (issue #9586), run against Postgres: the one
 * host whose host.serial_number is the device's serial number, or whose
 * host.name is - the Android agent told `device_name:
 * ${esper.serialNumber}`. Compared trimmed and lowercased, a project's hosts
 * only, deleted rows left out.
 *
 * Opt in with RUN_POSTGRES_INVENTORY_FACET_TESTS=true and config.env loaded,
 * like InventoryStatusPostgres.test.ts. Tables live in a unique temporary
 * schema; production rows are never read or changed.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INVENTORY_FACET_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("hosts by serial number against Postgres", () => {
  const schema: string = `inventory_serials_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const ids: Record<string, string> = {};
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["INVENTORY_FACET_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["INVENTORY_FACET_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(`CREATE TABLE "${schema}"."InventoryItem" (
      "_id" uuid PRIMARY KEY,
      "projectId" uuid NOT NULL,
      "entityType" varchar NOT NULL,
      "identifyingAttributes" jsonb,
      "descriptiveAttributes" jsonb,
      "deletedAt" timestamptz
    )`);

    // An app that sends the serial number, padded and in capitals.
    await seed("app-host", {
      identity: { "host.name": "kiosk-12" },
      attributes: { "host.serial_number": "  R9KT30ABC12 " },
    });
    // The Android agent named by the serial number, with its ANDROID_ID.
    await seed("agent-host", {
      identity: { "host.name": "r9kt30abc13" },
      attributes: { "host.id": "3f2a9c1b7d4e5a60" },
    });
    // Neither: another serial, and a host with no attributes at all.
    await seed("other-host", {
      identity: { "host.name": "lobby-tablet" },
      attributes: { "host.serial_number": "ZZ999" },
    });
    await seed("bare-host", { identity: null, attributes: null });
    // Out of scope: another type, another project, a deleted row.
    await seed("a-service", {
      entityType: EntityType.Service,
      identity: { "service.name": "r9kt30abc12" },
      attributes: { "host.serial_number": "R9KT30ABC12" },
    });
    await seed("foreign-host", {
      projectId: otherProjectId,
      identity: { "host.name": "r9kt30abc12" },
      attributes: {},
    });
    await seed("deleted-host", {
      identity: { "host.name": "r9kt30abc12" },
      attributes: {},
      deleted: true,
    });
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function seed(
    name: string,
    data: {
      identity: JSONObject | null;
      attributes: JSONObject | null;
      entityType?: EntityType;
      projectId?: ObjectID;
      deleted?: boolean;
    },
  ): Promise<void> {
    const id: string = ObjectID.generate().toString();
    ids[name] = id;
    await database.query(
      `INSERT INTO "${schema}"."InventoryItem" ("_id", "projectId", "entityType", "identifyingAttributes", "descriptiveAttributes", "deletedAt") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        (data.projectId || projectId).toString(),
        data.entityType || EntityType.Host,
        data.identity === null ? null : JSON.stringify(data.identity),
        data.attributes === null ? null : JSON.stringify(data.attributes),
        data.deleted ? new Date() : null,
      ],
    );
  }

  async function find(
    serials: Array<string>,
    limit: number = 10,
  ): Promise<Array<{ name: string; serialNumber: string; hostName: string }>> {
    const rows: Array<{
      _id: string;
      serialNumber: string | null;
      hostName: string | null;
    }> = await database.query(FIND_HOSTS_BY_SERIAL_NUMBER_SQL, [
      projectId.toString(),
      EntityType.Host,
      serials,
      limit,
    ]);

    return rows
      .map(
        (row: {
          _id: string;
          serialNumber: string | null;
          hostName: string | null;
        }) => {
          const name: string =
            Object.keys(ids).find((key: string): boolean => {
              return ids[key] === String(row._id);
            }) || String(row._id);

          return {
            name,
            serialNumber: row.serialNumber || "",
            hostName: row.hostName || "",
          };
        },
      )
      .sort((a: { name: string }, b: { name: string }): number => {
        return a.name.localeCompare(b.name);
      });
  }

  test("finds a host by its host.serial_number, trimmed and lowercased", async () => {
    expect(await find(["r9kt30abc12"])).toEqual([
      { name: "app-host", serialNumber: "r9kt30abc12", hostName: "kiosk-12" },
    ]);
  });

  test("finds the Android agent named by the serial number, whatever its host.id", async () => {
    expect(await find(["r9kt30abc13"])).toEqual([
      { name: "agent-host", serialNumber: "", hostName: "r9kt30abc13" },
    ]);
  });

  test("reads only this project's hosts that are not deleted", async () => {
    const names: Array<string> = (
      await find(["r9kt30abc12", "r9kt30abc13", "zz999"])
    ).map((row: { name: string }): string => {
      return row.name;
    });

    expect(names).toEqual(["agent-host", "app-host", "other-host"]);
  });

  test("a serial number no host carries finds nothing, and the limit holds", async () => {
    expect(await find(["nothing-here"])).toEqual([]);
    expect(await find(["r9kt30abc12", "r9kt30abc13", "zz999"], 1)).toHaveLength(
      1,
    );
  });
});
