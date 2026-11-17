/*
 * WHEN A FAILING AUDIT LOG EXPORT'S WAITING ENTRIES ARE DELETED (#7186).
 *
 * The entries a failing export has not sent wait in the audit log, and each
 * one is deleted once it passes the retention it was recorded with
 * (AuditLogService.findSoonestRetentionDateForExport reads the soonest of
 * those dates). The export's people are emailed about it
 * (ee/Server/AuditLogExport/AuditLogExportNotifications), and its page says
 * it too, in the View Error dialog: from when the entries waiting start to
 * be deleted, or, once that moment has passed, since when they are being
 * deleted.
 *
 * Both read the date against the moment it was read, by the same rule: at
 * or before that moment, to the millisecond, the export is losing entries
 * (#7185). The audit log drops a part of its entries only once every entry
 * in it has passed its date, so the date can have passed while entries
 * still wait: they are being deleted, not all gone.
 */

// What the export's page reads of a failing export: when its waiting entries start to be deleted.
export interface AuditLogExportEntriesLost {
  // When the first of the entries the export has not sent is deleted.
  entriesLostAt: Date;
  // When that was read: the moment the date is said against.
  readAt: Date;
}

// The answer's keys (POST /audit-log-export/entries-lost-at), as JSON carries them.
export const AUDIT_LOG_EXPORT_ENTRIES_LOST_AT_KEY: string = "entriesLostAt";
export const AUDIT_LOG_EXPORT_ENTRIES_LOST_READ_AT_KEY: string = "readAt";

/*
 * Whether the export is losing entries now: the first of the entries it has
 * not sent is deleted at or before `now`.
 */
export const isAuditLogExportLosingEntries: (data: {
  entriesLostAt: Date;
  now: Date;
}) => boolean = (data: { entriesLostAt: Date; now: Date }): boolean => {
  return new Date(data.entriesLostAt).getTime() <= new Date(data.now).getTime();
};

/*
 * What the page's read answered, or null for an answer that does not say:
 * nothing waits, the export is not failing, or the answer holds no date
 * that can be read. The page then says nothing of a date, rather than a
 * wrong one.
 */
export const readAuditLogExportEntriesLost: (
  answer: unknown,
) => AuditLogExportEntriesLost | null = (
  answer: unknown,
): AuditLogExportEntriesLost | null => {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return null;
  }

  const readDate: (value: unknown) => Date | null = (
    value: unknown,
  ): Date | null => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }

    const date: Date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  };

  const entriesLostAt: Date | null = readDate(
    (answer as Record<string, unknown>)[AUDIT_LOG_EXPORT_ENTRIES_LOST_AT_KEY],
  );
  const readAt: Date | null = readDate(
    (answer as Record<string, unknown>)[
      AUDIT_LOG_EXPORT_ENTRIES_LOST_READ_AT_KEY
    ],
  );

  if (!entriesLostAt || !readAt) {
    return null;
  }

  return { entriesLostAt, readAt };
};
