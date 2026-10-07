/*
 * Whether a status page shows an incident or an incident episode. One rule,
 * read by everything that puts one in front of status page visitors or their
 * subscribers - the status page's own reads (overview, incident and episode
 * lists and details, the RSS feed, attachments, report counts), the
 * subscriber notification jobs, the images a record makes public - and kept
 * by every write:
 *
 *   shown = Visible on Status Page on (isVisibleOnStatusPage), and not
 *           private (isPrivate).
 *
 * A private incident or episode is visible only to its owners and the
 * project's admins and owners, so it is hidden from every status page,
 * whatever its Visible on Status Page switch says.
 *
 * Writes keep the two switches in step (normalizeWrite): a write that makes a
 * record private switches Visible on Status Page off with it, and a record
 * that stays private keeps it off - turning the switch on for a private
 * record leaves it hidden. That is what the incident's Settings form has
 * always done (it sends both switches with every save), and it holds for the
 * API, Terraform, workflows and OneUptime's own writes alike. Whether a
 * record that stays private is private is decided by the database in the
 * write itself (StatusPageVisibilityQuery.getRowWriteSql), so no write that
 * lands at the same moment can leave both switches on. A record is shown
 * again only when someone turns Private off and Visible on Status Page on.
 *
 * Server queries apply the same rule in SQL (StatusPageVisibilityQuery), so
 * a list is cut to its limit after a private record is left out, never
 * before.
 */

// What decides whether a status page shows a record: its two switches.
export interface StatusPageVisibilitySwitches {
  isVisibleOnStatusPage?: unknown;
  isPrivate?: unknown;
}

export type StatusPageVisibilityColumn = "isVisibleOnStatusPage" | "isPrivate";

export const VISIBLE_ON_STATUS_PAGE_COLUMN: StatusPageVisibilityColumn =
  "isVisibleOnStatusPage";

export const PRIVATE_COLUMN: StatusPageVisibilityColumn = "isPrivate";

// Postgres reads these as true in a boolean column, and their prefixes (boolin).
const TRUE_WORDS: ReadonlyArray<string> = ["true", "yes"];
const FALSE_WORDS: ReadonlyArray<string> = ["false", "no"];

export default class StatusPageVisibility {
  public static readonly columns: ReadonlyArray<StatusPageVisibilityColumn> = [
    VISIBLE_ON_STATUS_PAGE_COLUMN,
    PRIVATE_COLUMN,
  ];

  /*
   * A value written to a boolean column as Postgres stores it: true and
   * false as they are, and a literal it reads as one of them - "true",
   * "yes", "on", "1" and their unique prefixes ("t", "y"), "false", "no",
   * "off", "0" ("f", "n"), in any case and with whitespace around it - or
   * the numbers 1 and 0, which the driver sends as such literals. The API
   * passes a value through as it is sent, so a hand-written request's "yes"
   * stores true. Anything else is returned as it is: null, or a value the
   * database refuses.
   */
  public static toStoredBoolean(value: unknown): unknown {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      if (value === 1) {
        return true;
      }

      if (value === 0) {
        return false;
      }

      return value;
    }

    if (typeof value !== "string") {
      return value;
    }

    const text: string = value.trim().toLowerCase();

    if (text.length === 0) {
      return value;
    }

    if (text === "1" || text === "on") {
      return true;
    }

    if (text === "0" || text === "off" || text === "of") {
      return false;
    }

    // "o" alone could be on or off: Postgres refuses it.
    if (
      TRUE_WORDS.some((word: string): boolean => {
        return word.startsWith(text);
      })
    ) {
      return true;
    }

    if (
      FALSE_WORDS.some((word: string): boolean => {
        return word.startsWith(text);
      })
    ) {
      return false;
    }

    return value;
  }

  /*
   * Whether a record is private: Private switched on. A value that is not
   * false or unset (null, or not read) counts as private, so an odd value
   * hides the record rather than showing it.
   */
  public static isPrivate(
    record: StatusPageVisibilitySwitches | undefined | null,
  ): boolean {
    if (!record) {
      return false;
    }

    const value: unknown = record.isPrivate;

    if (value === undefined || value === null) {
      return false;
    }

    return this.toStoredBoolean(value) !== false;
  }

  /*
   * Whether its Visible on Status Page switch is on. A switch never set
   * (null) reads as off, as the database queries read it.
   */
  public static isVisibilitySwitchedOn(
    record: StatusPageVisibilitySwitches | undefined | null,
  ): boolean {
    if (!record) {
      return false;
    }

    return this.toStoredBoolean(record.isVisibleOnStatusPage) === true;
  }

  // The rule: Visible on Status Page on, and not private.
  public static isShown(
    record: StatusPageVisibilitySwitches | undefined | null,
  ): boolean {
    return this.isVisibilitySwitchedOn(record) && !this.isPrivate(record);
  }

  // Whether a write writes a switch: one left out, or sent as undefined, is not.
  public static isWrittenBy(
    data: Record<string, unknown> | undefined | null,
    column: StatusPageVisibilityColumn,
  ): boolean {
    return Boolean(data) && data![column] !== undefined;
  }

  /*
   * Whether a write leaves the record private: it makes it private, or it
   * leaves Private as stored and the record is private now (`stored`, read
   * before the write; a record the read did not see counts as not private).
   */
  public static isPrivateAfterWrite(data: {
    written: Record<string, unknown>;
    stored?: StatusPageVisibilitySwitches | undefined | null;
  }): boolean {
    if (this.isWrittenBy(data.written, PRIVATE_COLUMN)) {
      return this.isPrivate({ isPrivate: data.written[PRIVATE_COLUMN] });
    }

    return this.isPrivate(data.stored);
  }

  /*
   * Whether a write turns Visible on Status Page on and leaves Private as
   * stored: whether it may show the record depends on whether the record is
   * private when the write reaches it, which the database tells in the write
   * itself (StatusPageVisibilityQuery.getRowWriteSql).
   */
  public static needsStoredPrivacy(
    data: Record<string, unknown> | undefined | null,
  ): boolean {
    if (!data) {
      return false;
    }

    return (
      this.isVisibilitySwitchedOn({
        isVisibleOnStatusPage: data[VISIBLE_ON_STATUS_PAGE_COLUMN],
      }) && !this.isWrittenBy(data, PRIVATE_COLUMN)
    );
  }

  /*
   * A write as it is stored: each switch it writes as the boolean the
   * database stores (toStoredBoolean), and Visible on Status Page off when
   * the write makes the record private. Called before anything reads the
   * write, so what it reads is what is stored. A write that turns Visible on
   * Status Page on for a record that is private already stores it off on
   * that record: the database decides it in the write itself, on the record
   * as it is then (needsStoredPrivacy, StatusPageVisibilityQuery.getRowWriteSql).
   */
  public static normalizeWrite(
    data: Record<string, unknown> | undefined | null,
  ): void {
    if (!data) {
      return;
    }

    for (const column of this.columns) {
      if (this.isWrittenBy(data, column)) {
        data[column] = this.toStoredBoolean(data[column]);
      }
    }

    if (this.isPrivateAfterWrite({ written: data })) {
      data[VISIBLE_ON_STATUS_PAGE_COLUMN] = false;
    }
  }
}
