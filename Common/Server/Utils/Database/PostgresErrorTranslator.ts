import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";

/*
 * Postgres error codes we can turn into something the caller can act on.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const FOREIGN_KEY_VIOLATION: string = "23503";

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

export default class PostgresErrorTranslator {
  public static translate(error: unknown): unknown {
    const driverError: PostgresDriverError | null =
      this.getPostgresDriverError(error);

    if (!driverError || driverError.code !== FOREIGN_KEY_VIOLATION) {
      return error;
    }

    const detail: string = driverError.detail || "";

    /*
     * DELETE blocked by a child row:
     *   Key (_id)=(...) is still referenced from table "MonitorStatusTimeline".
     */
    if (detail.includes("is still referenced from table")) {
      const referencingTable: string =
        this.getTableNameFromDetail(detail) || driverError.table || "";

      return new BadDataException(
        referencingTable
          ? `This item cannot be deleted because ${this.humanizeTableName(
              referencingTable,
            )} records still reference it. Please delete those records first, and then try again.`
          : "This item cannot be deleted because other records still reference it. Please delete those records first, and then try again.",
      );
    }

    /*
     * INSERT/UPDATE pointing at a row that does not exist:
     *   Key (monitorStatusId)=(...) is not present in table "MonitorStatus".
     */
    if (detail.includes("is not present in table")) {
      const referencedTable: string = this.getTableNameFromDetail(detail) || "";

      return new BadDataException(
        referencedTable
          ? `This request references ${this.humanizeTableName(
              referencedTable,
            )} that does not exist. Please check the request and try again.`
          : "This request references an item that does not exist. Please check the request and try again.",
      );
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
}
