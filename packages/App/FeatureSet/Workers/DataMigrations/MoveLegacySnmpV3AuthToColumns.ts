import DataMigrationBase from "./DataMigrationBase";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import {
  getLegacySnmpV3Username,
  isNonEmptyCredential,
} from "Common/Utils/NetworkDevice/SnmpCredentialUtil";
import EncryptColumnInPlace, {
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

type StoredRow = Record<string, unknown>;

/*
 * The snmpV3* columns a device's legacy object moves into, each with the
 * field of the object it is read from.
 */
export const LEGACY_SNMP_V3_AUTH_FIELDS: ReadonlyArray<{
  column: string;
  field: string;
}> = [
  { column: "snmpV3Username", field: "username" },
  { column: "snmpV3SecurityLevel", field: "securityLevel" },
  { column: "snmpV3AuthProtocol", field: "authProtocol" },
  { column: "snmpV3AuthKey", field: "authKey" },
  { column: "snmpV3PrivProtocol", field: "privProtocol" },
  { column: "snmpV3PrivKey", field: "privKey" },
];

// What one device's row is to be written as.
export interface LegacySnmpV3AuthMove {
  id: string;
  // Each column to write, with its value; snmpV3Auth is always cleared.
  set: Record<string, string | null>;
  // Whether the object's credentials move into the columns, or it is only cleared.
  movesCredentials: boolean;
}

/*
 * A NETWORK DEVICE'S LEGACY SNMP V3 OBJECT, MOVED INTO ITS COLUMNS (#9268).
 *
 * Before the snmpV3* columns existed, a device kept its v3 credentials in
 * one JSON object, snmpV3Auth. The walk still reads it where the columns
 * hold no username (NetworkDeviceHydrationUtil.buildSnmpV3Auth), but the
 * poll decided between a walk and a ping on the columns alone
 * (hasUsableCredentials), so such a device was pinged and never walked, and
 * its Settings showed no v3 credentials of its own. A device written by an
 * API client that set only the deprecated object is the same.
 *
 * For each device that keeps an object, this:
 *
 *   - where its columns hold no username and the object does, writes the
 *     object's username, security level, protocols and keys into the
 *     snmpV3* columns - all six, as the walk read them all from the object
 *     - and clears the object: the device's Settings show its credentials,
 *     its poll walks it with them, and Ping only clears them;
 *   - where its columns hold a username already, or the object holds none,
 *     only clears the object: nothing reads it there, and kept it would be
 *     read the moment Ping only cleared the columns.
 *
 * Each value is copied as it is stored: a key the upgrade left as written
 * stays as written - so a server of the release before, still running
 * while the upgrade rolls out, walks the device with it too - until the
 * CredentialsAtRest:EncryptInPlace job encrypts the columns with the other
 * SNMP credentials, a day later; a key encrypted already (an install that
 * ran EncryptSnmpCredentials when it still encrypted at once) moves as the
 * same ciphertext, never encrypted twice.
 *
 * In raw SQL, a page at a time, soft-deleted devices included. Each write
 * lands only while the row still holds the object and the username read,
 * so a device saved meanwhile is left as its save left it, and a second
 * runner at the same time writes nothing. Idempotent: a moved device has no
 * object to read again. No value is in any log line.
 *
 * The poll keeps reading an object where the columns hold no username, so
 * one an API client writes after this is walked too.
 */
export default class MoveLegacySnmpV3AuthToColumns extends DataMigrationBase {
  // Rows read per query.
  public static readonly PAGE_SIZE: number = 100;

  public constructor() {
    super("MoveLegacySnmpV3AuthToColumns");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository =
      NetworkDeviceService.getRepository() as unknown as ModelRepository;
    const tableName: string = repository.metadata.tableName;

    let afterId: string | null = null;

    for (;;) {
      let rows: Array<StoredRow> = [];

      try {
        rows = (await repository.manager.query(
          `SELECT "_id", "snmpV3Auth", "snmpV3Username" FROM "${tableName}" WHERE "snmpV3Auth" IS NOT NULL${
            afterId === null ? "" : ` AND "_id" > $1`
          } ORDER BY "_id" ASC LIMIT ${MoveLegacySnmpV3AuthToColumns.PAGE_SIZE}`,
          afterId === null ? [] : [afterId],
        )) as Array<StoredRow>;
      } catch (err) {
        logger.error(
          `${this.name}: failed to read the network devices' legacy SNMP v3 credentials: ${EncryptColumnInPlace.describeError(err)}`,
        );
        return;
      }

      for (const row of rows) {
        await this.moveRow({
          repository: repository,
          tableName: tableName,
          row: row,
        });
      }

      if (rows.length < MoveLegacySnmpV3AuthToColumns.PAGE_SIZE) {
        return;
      }

      const lastId: string = String(rows[rows.length - 1]!["_id"]);

      // A page that does not move on would be read again for ever.
      if (lastId === afterId) {
        return;
      }

      afterId = lastId;
    }
  }

  /*
   * What a device's row is to be written as: see the top of the class. Null
   * for a row with no object.
   */
  public static getMove(row: StoredRow): LegacySnmpV3AuthMove | null {
    const legacy: unknown = row["snmpV3Auth"];

    if (legacy === null || legacy === undefined) {
      return null;
    }

    const id: string = String(row["_id"]);
    const object: JSONObject | null =
      typeof legacy === "object" && !Array.isArray(legacy)
        ? (legacy as JSONObject)
        : null;

    if (
      isNonEmptyCredential(row["snmpV3Username"]) ||
      getLegacySnmpV3Username(object) === undefined
    ) {
      return { id: id, set: { snmpV3Auth: null }, movesCredentials: false };
    }

    const set: Record<string, string | null> = {};

    for (const { column, field } of LEGACY_SNMP_V3_AUTH_FIELDS) {
      const value: unknown = object![field];

      set[column] = typeof value === "string" && value ? value : null;
    }

    set["snmpV3Auth"] = null;

    return { id: id, set: set, movesCredentials: true };
  }

  private async moveRow(data: {
    repository: ModelRepository;
    tableName: string;
    row: StoredRow;
  }): Promise<void> {
    const move: LegacySnmpV3AuthMove | null =
      MoveLegacySnmpV3AuthToColumns.getMove(data.row);

    if (!move) {
      return;
    }

    const columns: Array<string> = Object.keys(move.set);
    const assignments: string = columns
      .map((column: string, index: number): string => {
        return `"${column}" = $${index + 1}`;
      })
      .join(", ");
    const parameters: Array<unknown> = columns.map(
      (column: string): unknown => {
        return move.set[column];
      },
    );

    parameters.push(
      move.id,
      JSON.stringify(data.row["snmpV3Auth"]),
      typeof data.row["snmpV3Username"] === "string"
        ? data.row["snmpV3Username"]
        : null,
    );

    const count: number = columns.length;

    try {
      await data.repository.manager.query(
        `UPDATE "${data.tableName}" SET ${assignments} WHERE "_id" = $${count + 1} AND "snmpV3Auth" = $${count + 2}::jsonb AND "snmpV3Username" IS NOT DISTINCT FROM $${count + 3}`,
        parameters,
      );
    } catch (err) {
      /*
       * One device that cannot be written costs the others nothing, nor
       * halts the migrations queued behind this one: its poll still reads
       * its object.
       */
      logger.error(
        `${this.name}: failed to move the legacy SNMP v3 credentials of network device ${move.id}: ${EncryptColumnInPlace.describeError(
          err,
          Object.values(move.set).filter(
            (value: string | null): value is string => {
              return Boolean(value);
            },
          ),
        )}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
