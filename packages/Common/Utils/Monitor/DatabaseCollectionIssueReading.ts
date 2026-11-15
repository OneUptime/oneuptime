import {
  DatabaseMetricGroupStatus,
  DatabaseMetricGroupUnavailableReason,
} from "../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import { getDatabaseMetricGroupLabel } from "../../Types/Monitor/DatabaseMetricCatalog";
import { translationKey, Translator } from "../../Types/Translator";

/*
 * A DATABASE HEALTH CHECK'S COLLECTION ISSUES, READ IN THE READER'S LANGUAGE
 * (#8609).
 *
 * For each metric group a check could not read, the probe stores the group,
 * why (DatabaseMetricGroupUnavailableReason) and a message: either a
 * sentence of OneUptime's own, or the database's own error, sanitized
 * (permission denied for view pg_stat_activity, VIEW SERVER STATE permission
 * was denied ...). The server's Database Collection Error text and a
 * criteria's Contains filter read the stored English, so it is stored as it
 * always was.
 *
 * The monitor's summary reads it back here:
 *
 *   - the group by its name, the monitor form's Metric Groups switch's
 *     (getDatabaseMetricGroupLabel), in the reader's words;
 *   - a sentence of OneUptime's own in the reader's words;
 *   - a database's own error as the database wrote it, after a sentence in
 *     the reader's words that says what kind of failure it is.
 *
 * The words are translation keys: the Dashboard's npm run i18n:extract reads
 * this directory.
 */

/*
 * The probe's own sentence for a PostgreSQL login without pg_monitor: the
 * statistics views answer it with its own session alone, and no error, so
 * the probe skips the groups that read them. The probe writes this English
 * (Probe/Utils/Monitors/MonitorTypes/DatabaseMonitor.ts), word for word;
 * DatabaseCollectionIssuesInReadersLanguage holds the two the same.
 */
export const DATABASE_STATS_ACCESS_MESSAGE: string = translationKey(
  "The monitoring role cannot read other sessions' statistics. PostgreSQL does not report this as an error - it silently returns only this connection's own rows - so these metrics are skipped rather than recorded as wrong values.",
);

// Every sentence of OneUptime's own a probe stores as a group's message.
export const DATABASE_OWN_GROUP_MESSAGES: ReadonlyArray<string> = [
  DATABASE_STATS_ACCESS_MESSAGE,
];

// What kind of failure a database's own error is, before its words.
export const DATABASE_GROUP_UNAVAILABLE_REASON_SENTENCES: Readonly<
  Record<DatabaseMetricGroupUnavailableReason, string>
> = {
  [DatabaseMetricGroupUnavailableReason.MissingPermission]: translationKey(
    "The monitoring login is missing a grant.",
  ),
  [DatabaseMetricGroupUnavailableReason.NotSupportedByEngine]: translationKey(
    "The connected engine does not report this group.",
  ),
  [DatabaseMetricGroupUnavailableReason.Timeout]: translationKey(
    "The group's query timed out.",
  ),
  [DatabaseMetricGroupUnavailableReason.Error]: translationKey(
    "The group could not be collected.",
  ),
};

export interface DatabaseCollectionIssueText {
  // The group's name, in the reader's words.
  group: string;
  // OneUptime's words about it, in the reader's words.
  words: string;
  // The database's own error, as written; "" when the words say it all.
  asWritten: string;
}

export const getDatabaseCollectionIssueText: (data: {
  translator: Translator;
  status: DatabaseMetricGroupStatus;
}) => DatabaseCollectionIssueText = (data: {
  translator: Translator;
  status: DatabaseMetricGroupStatus;
}): DatabaseCollectionIssueText => {
  const groupName: string = getDatabaseMetricGroupLabel(data.status.group);
  const message: string =
    typeof data.status.message === "string" ? data.status.message.trim() : "";

  if (DATABASE_OWN_GROUP_MESSAGES.includes(message)) {
    return {
      group: data.translator.translateText(groupName) || groupName,
      words: data.translator.translateText(message) || message,
      asWritten: "",
    };
  }

  const reason: string =
    DATABASE_GROUP_UNAVAILABLE_REASON_SENTENCES[data.status.reason] ||
    DATABASE_GROUP_UNAVAILABLE_REASON_SENTENCES[
      DatabaseMetricGroupUnavailableReason.Error
    ];

  return {
    group: data.translator.translateText(groupName) || groupName,
    words: data.translator.translateText(reason) || reason,
    asWritten: message,
  };
};
