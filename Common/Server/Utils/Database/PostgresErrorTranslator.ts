import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";

/*
 * Postgres error codes we can turn into something the caller can act on.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const FOREIGN_KEY_VIOLATION: string = "23503";
const UNIQUE_VIOLATION: string = "23505";

/*
 * TypeORM reports driver failures as QueryFailedError, which does not extend
 * Exception. Those fall all the way through to the generic handler in
 * StartServer and reach the client as a bare 500 `{"error": "Server Error"}`
 * with nothing to act on — the user just sees "Server Error" in the UI.
 *
 * Translate the failures a user can actually do something about into a
 * BadDataException so the API answers with a 400 and a readable message.
 * Anything we do not recognise is returned untouched, so behaviour for the
 * rest of the error surface is unchanged.
 */

interface PostgresDriverError {
  code?: string | undefined;
  table?: string | undefined;
  detail?: string | undefined;
}

/*
 * The SQLSTATE that produced a translated exception, recorded on the exception
 * itself. `Exception.code` is the OneUptime ExceptionCode (a number), so the
 * driver code needs a field of its own — without it, translation is one-way and
 * a caller that recovers from one specific failure can no longer tell which
 * failure it got. RumSessionPinService is exactly that caller: it turns a
 * unique violation on (projectId, rumApplicationId, sessionId) into an
 * idempotent "already pinned" instead of an error the user has to interpret.
 */
export interface TranslatedPostgresException extends Exception {
  postgresErrorCode?: string | undefined;
}

export default class PostgresErrorTranslator {
  public static translate(error: unknown): unknown {
    const driverError: PostgresDriverError | null =
      this.getPostgresDriverError(error);

    if (!driverError) {
      return error;
    }

    if (driverError.code === FOREIGN_KEY_VIOLATION) {
      return this.translateForeignKeyViolation(error, driverError);
    }

    if (driverError.code === UNIQUE_VIOLATION) {
      return this.translateUniqueViolation(error, driverError);
    }

    return error;
  }

  /*
   * `throw`-friendly wrapper. Kept synchronous so callers can keep using
   * `throw translator(...)` on the synchronous throw path.
   */
  public static translateException(error: Exception): Exception {
    return this.translate(error) as Exception;
  }

  /*
   * True for a unique violation whether or not it has been through translate().
   * Callers that recover from a duplicate must use this rather than checking
   * `code === "23505"` themselves: by the time a service's own catch block sees
   * an error thrown out of DatabaseService, it has already been translated.
   */
  public static isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    if (
      (error as TranslatedPostgresException).postgresErrorCode ===
      UNIQUE_VIOLATION
    ) {
      return true;
    }

    const driverError: PostgresDriverError | null =
      this.getPostgresDriverError(error);

    return driverError?.code === UNIQUE_VIOLATION;
  }

  private static translateForeignKeyViolation(
    error: unknown,
    driverError: PostgresDriverError,
  ): unknown {
    const detail: string = driverError.detail || "";

    /*
     * DELETE blocked by a child row:
     *   Key (_id)=(...) is still referenced from table "MonitorStatusTimeline".
     */
    if (detail.includes("is still referenced from table")) {
      const referencingTable: string =
        this.getTableNameFromDetail(detail) || driverError.table || "";

      return this.tag(
        new BadDataException(
          referencingTable
            ? `This item cannot be deleted because ${this.humanizeTableName(
                referencingTable,
              )} records still reference it. Please delete those records first, and then try again.`
            : "This item cannot be deleted because other records still reference it. Please delete those records first, and then try again.",
        ),
        driverError,
      );
    }

    /*
     * INSERT/UPDATE pointing at a row that does not exist:
     *   Key (monitorStatusId)=(...) is not present in table "MonitorStatus".
     */
    if (detail.includes("is not present in table")) {
      const referencedTable: string = this.getTableNameFromDetail(detail) || "";

      return this.tag(
        new BadDataException(
          referencedTable
            ? `This request references ${this.humanizeTableName(
                referencedTable,
              )} that does not exist. Please check the request and try again.`
            : "This request references an item that does not exist. Please check the request and try again.",
        ),
        driverError,
      );
    }

    return error;
  }

  /*
   * INSERT/UPDATE colliding with an existing row:
   *   Key ("twilioAccountSID")=(AC123...) already exists.
   *
   * The column names go into the message because they tell the user which
   * field to change. The values do not: they are another row's data, and that
   * row may well belong to a different project (issue #3020 was reported
   * against exactly such a cross-tenant collision).
   */
  private static translateUniqueViolation(
    error: unknown,
    driverError: PostgresDriverError,
  ): unknown {
    const detail: string = driverError.detail || "";

    if (!detail.includes("already exists")) {
      return error;
    }

    const columns: Array<string> = this.getColumnNamesFromDetail(detail);
    const subject: string = driverError.table
      ? `A ${this.humanizeTableName(driverError.table)}`
      : "A record";

    if (columns.length === 0) {
      return this.tag(
        new BadDataException(
          `${subject} with these values already exists. Please use different values and try again.`,
        ),
        driverError,
      );
    }

    const fields: string = columns
      .map((column: string): string => {
        return this.humanizeColumnName(column);
      })
      .join(", ");

    return this.tag(
      new BadDataException(
        columns.length === 1
          ? `${subject} with this ${fields} already exists. Please use a different value and try again.`
          : `${subject} with the same ${fields} already exists. Please use different values and try again.`,
      ),
      driverError,
    );
  }

  /* Records the SQLSTATE on the translated exception. See the interface above. */
  private static tag(
    exception: BadDataException,
    driverError: PostgresDriverError,
  ): BadDataException {
    (exception as TranslatedPostgresException).postgresErrorCode =
      driverError.code;

    return exception;
  }

  private static getPostgresDriverError(
    error: unknown,
  ): PostgresDriverError | null {
    if (!error || typeof error !== "object") {
      return null;
    }

    /*
     * QueryFailedError hoists the pg fields onto itself and also keeps the
     * original under `driverError`. Prefer whichever one carries the code.
     */
    const candidate: PostgresDriverError = error as PostgresDriverError;

    if (typeof candidate.code === "string") {
      return candidate;
    }

    const driverError: unknown = (error as { driverError?: unknown })
      .driverError;

    if (
      driverError &&
      typeof driverError === "object" &&
      typeof (driverError as PostgresDriverError).code === "string"
    ) {
      return driverError as PostgresDriverError;
    }

    return null;
  }

  private static getTableNameFromDetail(detail: string): string | null {
    const match: RegExpMatchArray | null = detail.match(/table "([^"]+)"/);

    return match && match[1] ? match[1] : null;
  }

  /*
   * `Key ("twilioAccountSID")=(AC1)...` -> ["twilioAccountSID"]
   * `Key (slug)=(acme)...`              -> ["slug"]
   * `Key (a, "b")=(1, 2)...`            -> ["a", "b"]
   *
   * Postgres quotes an identifier only when it needs to, so both forms turn up
   * in the same database. Anchored on the leading `Key (` so the value list
   * that follows cannot be mistaken for the column list.
   */
  private static getColumnNamesFromDetail(detail: string): Array<string> {
    const match: RegExpMatchArray | null = detail.match(/^Key \(([^)]*)\)=/);

    if (!match || !match[1]) {
      return [];
    }

    return match[1]
      .split(",")
      .map((column: string): string => {
        return column.trim().replace(/^"(.*)"$/, "$1");
      })
      .filter((column: string): boolean => {
        return column.length > 0;
      });
  }

  /*
   * "MonitorStatusTimeline" -> "Monitor Status Timeline". Table names are the
   * PascalCase model names, so this reads well enough to put in front of a
   * user without maintaining a lookup table of display names.
   */
  private static humanizeTableName(tableName: string): string {
    return tableName
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .trim();
  }

  /*
   * "twilioAccountSID" -> "Twilio Account SID". Same split as table names, but
   * columns are camelCase so the first letter needs capitalising too.
   */
  private static humanizeColumnName(columnName: string): string {
    const humanized: string = this.humanizeTableName(columnName);

    return humanized.charAt(0).toUpperCase() + humanized.slice(1);
  }
}
