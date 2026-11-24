/*
 * THE FIELDS A CREATE LEFT OUT BECAUSE ONLY ONEUPTIME WRITES THEM (#10136).
 *
 * A create through the API (POST /api/<resource>) goes through without the
 * fields only OneUptime writes - a status page's sendNextReportBy, a network
 * site's lastRollupAt, who created the record, a number OneUptime gives it -
 * when OneUptime itself or a server admin does not send them
 * (ColumnsOnlyOneUptimeWrites, #10053). A create often carries them as a
 * copy of a record read before: `oneuptime <resource> get` then `create`,
 * the MCP server, a status page imported from JSON. Refusing those would
 * break callers that only pass values along; saying nothing left a caller
 * that expected one of those values kept to find out by reading the record
 * back.
 *
 * So the create's answer names them, in a header beside the record it
 * answers, which no client that reads the record has to know about:
 *
 *   X-OneUptime-Fields-Left-Out: sendNextReportBy, lastRollupAt
 *
 * each field by the name the request sent it under, once, in the order they
 * were left out. A create that left nothing out sends no such header. The
 * CLI and the MCP server say so in a note (getNote), and the Terraform and
 * Crossplane providers in a warning.
 *
 * Read by the server, the Dashboard, the CLI and the MCP server, so it
 * imports nothing that needs a server or React.
 */

export const FIELDS_LEFT_OUT_HEADER: string = "X-OneUptime-Fields-Left-Out";

export default class FieldsLeftOut {
  // The header's value: each field once, in order, joined by ", ".
  public static toHeaderValue(fields: ReadonlyArray<string>): string {
    return FieldsLeftOut.unique(fields).join(", ");
  }

  // The fields a value of the header names, each once; none for no value.
  public static fromHeaderValue(value: unknown): Array<string> {
    const values: Array<unknown> = Array.isArray(value) ? value : [value];
    const fields: Array<string> = [];

    for (const item of values) {
      if (typeof item !== "string") {
        continue;
      }

      fields.push(
        ...item
          .split(",")
          .map((field: string): string => {
            return field.trim();
          })
          .filter((field: string): boolean => {
            return field.length > 0;
          }),
      );
    }

    return FieldsLeftOut.unique(fields);
  }

  /*
   * The fields an answer's headers name, whatever the case of the header's
   * name (Node lower-cases them; a browser's Headers too).
   */
  public static fromHeaders(
    headers: Record<string, unknown> | null | undefined,
  ): Array<string> {
    if (!headers || typeof headers !== "object") {
      return [];
    }

    const name: string = FIELDS_LEFT_OUT_HEADER.toLowerCase();

    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name) {
        return FieldsLeftOut.fromHeaderValue(value);
      }
    }

    return [];
  }

  /*
   * What a client tells the person who made the create, or null when
   * nothing was left out: "OneUptime left out lastRollupAt: only OneUptime
   * writes it, so the new record has OneUptime's value."
   */
  public static getNote(fields: ReadonlyArray<string>): string | null {
    const named: Array<string> = FieldsLeftOut.unique(fields);

    if (named.length === 0) {
      return null;
    }

    if (named.length === 1) {
      return `OneUptime left out ${named[0]}: only OneUptime writes it, so the new record has OneUptime's value.`;
    }

    const list: string = `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;

    return `OneUptime left out ${list}: only OneUptime writes them, so the new record has OneUptime's values.`;
  }

  private static unique(fields: ReadonlyArray<string>): Array<string> {
    const unique: Array<string> = [];

    for (const field of fields) {
      if (field && !unique.includes(field)) {
        unique.push(field);
      }
    }

    return unique;
  }
}
