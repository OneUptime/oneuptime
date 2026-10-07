import { toStoredBoolean } from "../Database/BooleanColumnValue";

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

export default class StatusPageVisibility {
  public static readonly columns: ReadonlyArray<StatusPageVisibilityColumn> = [
    VISIBLE_ON_STATUS_PAGE_COLUMN,
    PRIVATE_COLUMN,
  ];

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

    return toStoredBoolean(value) !== false;
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

    return toStoredBoolean(record.isVisibleOnStatusPage) === true;
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
   * A write as it is stored: Visible on Status Page off when the write makes
   * the record private. Each switch already holds the boolean the database
   * stores - DatabaseService turns every Boolean column of a write into it
   * before any hook runs (Types/Database/BooleanColumnValue) - so called from
   * a service's hook, before anything else reads the write, what it reads is
   * what is stored. A write that turns Visible on Status Page on for a
   * record that is private already stores it off on that record: the
   * database decides it in the write itself, on the record as it is then
   * (needsStoredPrivacy, StatusPageVisibilityQuery.getRowWriteSql).
   */
  public static normalizeWrite(
    data: Record<string, unknown> | undefined | null,
  ): void {
    if (!data) {
      return;
    }

    if (this.isPrivateAfterWrite({ written: data })) {
      data[VISIBLE_ON_STATUS_PAGE_COLUMN] = false;
    }
  }
}
