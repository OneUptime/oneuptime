import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import EncryptedColumnValue from "Common/Server/Utils/Database/EncryptedColumnValue";
import Encryption from "Common/Server/Utils/Encryption";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import TableColumnType from "Common/Types/Database/TableColumnType";

// Taken from Common's service so App does not resolve its own typeorm copy.
export type ModelRepository = ReturnType<
  DatabaseService<BaseModel>["getRepository"]
>;

/*
 * One column of one table whose stored values are encrypted in place: by
 * the CredentialsAtRest:EncryptInPlace job, a day after the upgrade's data
 * migration that names it ran (CredentialsAtRest).
 */
export interface ColumnToEncrypt {
  // What a row is, for the log: "status page domain".
  kind: string;
  repository: ModelRepository;
  // The column, as the table names it: "customCertificateKey".
  column: string;
  /*
   * For a JSON column: the fields kept encrypted in its object, or in each
   * object of its list - the column's `encryptedFields`
   * (EncryptedColumnValue). Unset for a text column, whose whole value is
   * encrypted.
   */
  jsonFields?: ReadonlyArray<string> | undefined;
}

type StoredRow = Record<string, unknown>;

// What one pass over one column did.
export interface EncryptColumnPass {
  // Rows that held a value, or a JSON field, stored as written.
  read: number;
  // Rows written back encrypted, each held to the value read.
  written: number;
  // Rows that could not be written, or pages that could not be read.
  failed: number;
  // Whether the pass stopped at its deadline, with rows left to read.
  isCutShort: boolean;
}

// What one row came to.
enum RowOutcome {
  // Nothing as written: empty, or encrypted already.
  Skipped = "skipped",
  Written = "written",
  Failed = "failed",
}

/*
 * ENCRYPTS, IN PLACE, THE VALUES A COLUMN HELD BEFORE IT WAS KEPT ENCRYPTED
 * AT REST.
 *
 * A column made `encrypted: true` is encrypted on every write through its
 * service from then on, but the rows written before still hold their
 * values as they were written. This reads them a page at a time, and
 * encrypts each value that is set and not already our ciphertext
 * (Encryption.looksEncrypted), writing it back in raw SQL, so
 * DatabaseService's own encrypt and decrypt never touch it and the value is
 * encrypted exactly once. A null or empty value is left as it is, and so are
 * soft-deleted rows' values: they are encrypted too, since a key a row kept
 * is a key whether the row is deleted or not.
 *
 * Each value is written only while the row still holds the value read (the
 * UPDATE's WHERE names it), so a value replaced meanwhile - through the
 * service, already encrypted - is left as its write stored it, and a second
 * runner at the same time writes nothing. Run twice, it rewrites nothing:
 * the second run finds no plaintext.
 *
 * Every reader of this release reads the same value before and after:
 * DatabaseService.decrypt hands back a value that is not our ciphertext as
 * it is, and decrypts the rest to the value that was encrypted. A server
 * of the release before reads the ciphertext as the value, so this runs
 * only once none can still be running (CredentialsAtRest).
 *
 * One page that cannot be read ends this column's run, and one row that
 * cannot be written costs the others nothing; each says so in the log, with
 * the row's id. A log line never carries the value: it names the error by
 * its class, its code and its message, with the value taken out of the
 * message, and never logs the error itself, whose driver fields (a failed
 * query's parameters) hold the value it was writing.
 *
 * A JSON column (`jsonFields`) keeps its shape: in its object, or in each
 * object of its list, the fields named are encrypted as DatabaseService
 * encrypts them (EncryptedColumnValue), each a field that is set and not our
 * ciphertext, and the rest stay as written - a discovery scan's SNMP
 * credential sets keep their names and versions readable. Every row that
 * holds a value is read, as no query can say which hold a plaintext field,
 * and only a row with one is written: held to the JSON read, which jsonb
 * compares by its content.
 */
export default class EncryptColumnInPlace {
  // Rows read per query: a private key is a few kilobytes.
  public static readonly PAGE_SIZE: number = 100;

  /*
   * One pass over one column: every value stored as written, encrypted in
   * place. What it read, wrote and could not write comes back
   * (EncryptColumnPass). Handed a deadline, it stops between pages once the
   * deadline has passed, and says so: what is left is read by the next pass,
   * as an encrypted value is never read again.
   */
  public static async encrypt(data: {
    // Who is encrypting, for the log: the data migration's name, or the job's.
    migrationName: string;
    target: ColumnToEncrypt;
    pageSize?: number | undefined;
    deadline?: JobDeadline | undefined;
  }): Promise<EncryptColumnPass> {
    if (data.target.jsonFields) {
      return await EncryptColumnInPlace.encryptJsonFields({
        ...data,
        jsonFields: data.target.jsonFields,
      });
    }

    const pass: EncryptColumnPass = EncryptColumnInPlace.newPass();
    const pageSize: number = data.pageSize || EncryptColumnInPlace.PAGE_SIZE;
    const { kind, repository, column } = data.target;
    const tableName: string = repository.metadata.tableName;

    // Our ciphertext, which needs no reading: it is never encrypted again.
    const ciphertextPattern: string = `${Encryption.CIPHERTEXT_PREFIX}%`;

    let afterId: string | null = null;

    for (;;) {
      if (data.deadline?.hasPassed()) {
        pass.isCutShort = true;
        return pass;
      }

      let rows: Array<StoredRow> = [];

      try {
        rows = (await repository.manager.query(
          `SELECT "_id", "${column}" FROM "${tableName}" WHERE "${column}" IS NOT NULL AND "${column}" <> '' AND "${column}" NOT LIKE $1${
            afterId === null ? "" : ` AND "_id" > $2`
          } ORDER BY "_id" ASC LIMIT ${pageSize}`,
          afterId === null ? [ciphertextPattern] : [ciphertextPattern, afterId],
        )) as Array<StoredRow>;
      } catch (err) {
        pass.failed++;
        logger.error(
          `${data.migrationName}: failed to read the ${kind} rows' ${column} to encrypt: ${EncryptColumnInPlace.describeError(err)}`,
        );
        return pass;
      }

      for (const row of rows) {
        EncryptColumnInPlace.count(
          pass,
          await EncryptColumnInPlace.encryptRow({
            migrationName: data.migrationName,
            target: data.target,
            tableName: tableName,
            row: row,
          }),
        );
      }

      if (rows.length < pageSize) {
        return pass;
      }

      const lastId: string = String(rows[rows.length - 1]!["_id"]);

      // A page that does not move on would be read again for ever.
      if (lastId === afterId) {
        return pass;
      }

      afterId = lastId;
    }
  }

  private static newPass(): EncryptColumnPass {
    return { read: 0, written: 0, failed: 0, isCutShort: false };
  }

  private static count(pass: EncryptColumnPass, outcome: RowOutcome): void {
    if (outcome === RowOutcome.Skipped) {
      return;
    }

    pass.read++;

    if (outcome === RowOutcome.Written) {
      pass.written++;
    } else {
      pass.failed++;
    }
  }

  private static async encryptRow(data: {
    migrationName: string;
    target: ColumnToEncrypt;
    tableName: string;
    row: StoredRow;
  }): Promise<RowOutcome> {
    const { kind, repository, column } = data.target;
    const id: string = String(data.row["_id"]);
    const plaintext: unknown = data.row[column];

    if (
      typeof plaintext !== "string" ||
      !plaintext ||
      Encryption.looksEncrypted(plaintext)
    ) {
      // Empty, or already encrypted by an earlier run: nothing to do.
      return RowOutcome.Skipped;
    }

    try {
      const encrypted: string = await Encryption.encrypt(plaintext);

      await repository.manager.query(
        `UPDATE "${data.tableName}" SET "${column}" = $1 WHERE "_id" = $2 AND "${column}" = $3`,
        [encrypted, id, plaintext],
      );

      return RowOutcome.Written;
    } catch (err) {
      /*
       * One row whose value cannot be encrypted must not cost the others
       * their encryption, nor halt every migration queued behind this one.
       * It still reads as itself.
       */
      logger.error(
        `${data.migrationName}: failed to encrypt the ${column} of ${kind} ${id}: ${EncryptColumnInPlace.describeError(err, plaintext)}`,
      );

      return RowOutcome.Failed;
    }
  }

  // The fields of a JSON column, encrypted in place: see the top of the class.
  private static async encryptJsonFields(data: {
    migrationName: string;
    target: ColumnToEncrypt;
    jsonFields: ReadonlyArray<string>;
    pageSize?: number | undefined;
    deadline?: JobDeadline | undefined;
  }): Promise<EncryptColumnPass> {
    const pass: EncryptColumnPass = EncryptColumnInPlace.newPass();
    const pageSize: number = data.pageSize || EncryptColumnInPlace.PAGE_SIZE;
    const { kind, repository, column } = data.target;
    const tableName: string = repository.metadata.tableName;

    let afterId: string | null = null;

    for (;;) {
      if (data.deadline?.hasPassed()) {
        pass.isCutShort = true;
        return pass;
      }

      let rows: Array<StoredRow> = [];

      try {
        rows = (await repository.manager.query(
          `SELECT "_id", "${column}" FROM "${tableName}" WHERE "${column}" IS NOT NULL${
            afterId === null ? "" : ` AND "_id" > $1`
          } ORDER BY "_id" ASC LIMIT ${pageSize}`,
          afterId === null ? [] : [afterId],
        )) as Array<StoredRow>;
      } catch (err) {
        pass.failed++;
        logger.error(
          `${data.migrationName}: failed to read the ${kind} rows' ${column} to encrypt: ${EncryptColumnInPlace.describeError(err)}`,
        );
        return pass;
      }

      for (const row of rows) {
        EncryptColumnInPlace.count(
          pass,
          await EncryptColumnInPlace.encryptJsonRow({
            migrationName: data.migrationName,
            target: data.target,
            jsonFields: data.jsonFields,
            tableName: tableName,
            row: row,
          }),
        );
      }

      if (rows.length < pageSize) {
        return pass;
      }

      const lastId: string = String(rows[rows.length - 1]!["_id"]);

      // A page that does not move on would be read again for ever.
      if (lastId === afterId) {
        return pass;
      }

      afterId = lastId;
    }
  }

  private static async encryptJsonRow(data: {
    migrationName: string;
    target: ColumnToEncrypt;
    jsonFields: ReadonlyArray<string>;
    tableName: string;
    row: StoredRow;
  }): Promise<RowOutcome> {
    const { kind, column } = data.target;
    const id: string = String(data.row["_id"]);
    const stored: unknown = data.row[column];

    const plaintexts: Array<string> = EncryptColumnInPlace.getPlaintextFields(
      stored,
      data.jsonFields,
    );

    // Nothing as written: encrypted by an earlier run, or never set.
    if (plaintexts.length === 0) {
      return RowOutcome.Skipped;
    }

    try {
      const encrypted: unknown = await EncryptedColumnValue.encrypt(
        {
          type: TableColumnType.JSON,
          encrypted: true,
          encryptedFields: [...data.jsonFields],
        },
        stored,
      );

      await data.target.repository.manager.query(
        `UPDATE "${data.tableName}" SET "${column}" = $1::jsonb WHERE "_id" = $2 AND "${column}" = $3::jsonb`,
        [JSON.stringify(encrypted), id, JSON.stringify(stored)],
      );

      return RowOutcome.Written;
    } catch (err) {
      // As a text column's: this row reads as itself, and the others go on.
      logger.error(
        `${data.migrationName}: failed to encrypt the ${column} of ${kind} ${id}: ${EncryptColumnInPlace.describeError(err, plaintexts)}`,
      );

      return RowOutcome.Failed;
    }
  }

  /*
   * The values of `fields`, in a JSON value's object or in each object of
   * its list, that are set and not our ciphertext: what is still to be
   * encrypted. Text where an object belongs is encrypted whole, as
   * EncryptedColumnValue stores it, so it is one of them too.
   */
  public static getPlaintextFields(
    value: unknown,
    fields: ReadonlyArray<string>,
  ): Array<string> {
    const entries: Array<unknown> = Array.isArray(value) ? value : [value];
    const plaintexts: Array<string> = [];

    for (const entry of entries) {
      if (typeof entry === "string") {
        if (entry && !Encryption.looksEncrypted(entry)) {
          plaintexts.push(entry);
        }

        continue;
      }

      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      for (const field of fields) {
        const fieldValue: unknown = (entry as Record<string, unknown>)[field];

        if (
          typeof fieldValue === "string" &&
          fieldValue &&
          !Encryption.looksEncrypted(fieldValue)
        ) {
          plaintexts.push(fieldValue);
        }
      }
    }

    return plaintexts;
  }

  /*
   * What went wrong, for a log line: the error's class, its code (a
   * database's SQLSTATE) and its message, with each value it failed on taken
   * out wherever the message quotes it. Never the error itself: a driver's
   * error carries the query's parameters, the value among them.
   */
  public static describeError(
    err: unknown,
    value?: string | ReadonlyArray<string>,
  ): string {
    const name: string = err instanceof Error && err.name ? err.name : "Error";

    const code: unknown = (err as { code?: unknown } | null)?.code;

    let message: string =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "unknown error";

    const values: ReadonlyArray<string> =
      typeof value === "string" ? [value] : value || [];

    for (const secret of values) {
      if (secret) {
        message = message.split(secret).join("[REDACTED]");
      }
    }

    const codeText: string =
      typeof code === "string" || typeof code === "number" ? ` (${code})` : "";

    return `${name}${codeText}: ${message}`;
  }
}
