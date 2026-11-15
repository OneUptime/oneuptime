import { fillTemplate, translationKey } from "../Translator";

/*
 * WHAT A DATA ALERT'S LIKELY CAUSE SAYS, IN THE READER'S LANGUAGE (#8343).
 *
 * The server reads the facts around a data alert and titles each likely
 * cause in English - "orders_nightly failed", "orders-api: 3 of 120 writes
 * failed" - and the Why This Happened card drew that English on every page.
 * A title the server words itself now carries its sentence as a code, with
 * the names and counts that go into it as values: the Dashboard words the
 * sentence in the reader's language and puts the names in as they are.
 * The cause's `title` is the same sentence in English, exactly as it always
 * read: what the API, an older Dashboard and OneUptime AI read.
 *
 * A title that is a record's own words carries no code and is drawn as
 * written: an upstream alert's number and title, a deploy's service and
 * change, a schema change's line from its table's feed.
 *
 * Every sentence is a key of the Dashboard's locales: this file is a "keys"
 * root of its string extractor. React-free and server-safe: the server
 * words its causes with it, the Dashboard reads them.
 */
export enum DataAlertCauseTitleCode {
  PrivateUpstreamAlert = "PrivateUpstreamAlert",
  PipelineFailed = "PipelineFailed",
  UnnamedPipelineFailed = "UnnamedPipelineFailed",
  ServiceRaisesError = "ServiceRaisesError",
  ServiceRaisesAnError = "ServiceRaisesAnError",
  UnnamedServiceRaisesError = "UnnamedServiceRaisesError",
  UnnamedServiceRaisesAnError = "UnnamedServiceRaisesAnError",
  WritesFailed = "WritesFailed",
  UnnamedServiceWritesFailed = "UnnamedServiceWritesFailed",
  ColumnChanged = "ColumnChanged",
  DatabaseUnreadable = "DatabaseUnreadable",
  UnnamedDatabaseUnreadable = "UnnamedDatabaseUnreadable",
  ServerDegraded = "ServerDegraded",
  UnnamedServerDegraded = "UnnamedServerDegraded",
  ServerUnhealthy = "ServerUnhealthy",
  UnnamedServerUnhealthy = "UnnamedServerUnhealthy",
}

/*
 * Each code's sentence, in English. A name (a pipeline's, a service's, an
 * error's type, a database's) goes in as it is; a count is a number, which
 * the Dashboard writes in the sentence's digits. "Unnamed" sentences are
 * the ones the server writes when the record has no name to give.
 */
export const DATA_ALERT_CAUSE_TITLES: Readonly<
  Record<DataAlertCauseTitleCode, string>
> = {
  [DataAlertCauseTitleCode.PrivateUpstreamAlert]: translationKey(
    "A private alert upstream",
  ),
  [DataAlertCauseTitleCode.PipelineFailed]: translationKey(
    "{{pipeline}} failed",
  ),
  [DataAlertCauseTitleCode.UnnamedPipelineFailed]:
    translationKey("A pipeline failed"),
  [DataAlertCauseTitleCode.ServiceRaisesError]: translationKey(
    "{{service}} keeps raising {{error}} naming this table",
  ),
  [DataAlertCauseTitleCode.ServiceRaisesAnError]: translationKey(
    "{{service}} keeps raising an error naming this table",
  ),
  [DataAlertCauseTitleCode.UnnamedServiceRaisesError]: translationKey(
    "A service keeps raising {{error}} naming this table",
  ),
  [DataAlertCauseTitleCode.UnnamedServiceRaisesAnError]: translationKey(
    "A service keeps raising an error naming this table",
  ),
  [DataAlertCauseTitleCode.WritesFailed]: translationKey(
    "{{service}}: {{failed}} of {{total}} writes failed",
  ),
  [DataAlertCauseTitleCode.UnnamedServiceWritesFailed]: translationKey(
    "A service: {{failed}} of {{total}} writes failed",
  ),
  [DataAlertCauseTitleCode.ColumnChanged]: translationKey("A column changed"),
  [DataAlertCauseTitleCode.DatabaseUnreadable]: translationKey(
    "{{database}} could not be read",
  ),
  [DataAlertCauseTitleCode.UnnamedDatabaseUnreadable]: translationKey(
    "The database could not be read",
  ),
  [DataAlertCauseTitleCode.ServerDegraded]: translationKey(
    "{{server}} is degraded",
  ),
  [DataAlertCauseTitleCode.UnnamedServerDegraded]: translationKey(
    "The database server is degraded",
  ),
  [DataAlertCauseTitleCode.ServerUnhealthy]: translationKey(
    "{{server}} is unhealthy",
  ),
  [DataAlertCauseTitleCode.UnnamedServerUnhealthy]: translationKey(
    "The database server is unhealthy",
  ),
};

// A title's sentence, and the names and counts that go into it.
export interface DataAlertCauseTitleWords {
  code: DataAlertCauseTitleCode;
  values: Record<string, string | number>;
}

// A cause's title: in English, and, where the server words it, as its sentence.
export interface DataAlertCauseTitle {
  title: string;
  titleWords?: DataAlertCauseTitleWords | undefined;
}

// A title worded from its sentence: the English, and the code with its values.
export function wordDataAlertCauseTitle(
  code: DataAlertCauseTitleCode,
  values: Record<string, string | number> = {},
): Required<DataAlertCauseTitle> {
  return {
    title: fillTemplate(DATA_ALERT_CAUSE_TITLES[code], values),
    titleWords: { code: code, values: { ...values } },
  };
}

// A title that is a record's own words: drawn as written, in every language.
export function titleAsWritten(title: string): DataAlertCauseTitle {
  return { title: title };
}

// Whether a code is one of the sentences above: an older or newer server's may not be.
export function isDataAlertCauseTitleCode(
  code: unknown,
): code is DataAlertCauseTitleCode {
  return (
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(DATA_ALERT_CAUSE_TITLES, code)
  );
}

function hasName(name: string | null | undefined): name is string {
  return typeof name === "string" && name.trim().length > 0;
}

// An alert upstream of this one: its number and title, or that it is private.
export function getUpstreamAlertCauseTitle(alert: {
  isPrivate?: boolean | undefined;
  alertNumberWithPrefix?: string | undefined;
  title?: string | undefined;
}): DataAlertCauseTitle {
  if (alert.isPrivate) {
    return wordDataAlertCauseTitle(
      DataAlertCauseTitleCode.PrivateUpstreamAlert,
    );
  }

  return titleAsWritten(
    [alert.alertNumberWithPrefix, alert.title].filter(Boolean).join(" "),
  );
}

// A run of a pipeline that writes the table failed.
export function getFailedRunCauseTitle(
  pipelineName: string | null | undefined,
): DataAlertCauseTitle {
  return hasName(pipelineName)
    ? wordDataAlertCauseTitle(DataAlertCauseTitleCode.PipelineFailed, {
        pipeline: pipelineName,
      })
    : wordDataAlertCauseTitle(DataAlertCauseTitleCode.UnnamedPipelineFailed);
}

// A service that writes the table keeps raising an exception that names it.
export function getRaisedErrorCauseTitle(data: {
  serviceName?: string | null | undefined;
  errorType?: string | null | undefined;
}): DataAlertCauseTitle {
  const service: string | null = hasName(data.serviceName)
    ? data.serviceName
    : null;
  const error: string | null = hasName(data.errorType) ? data.errorType : null;

  if (service && error) {
    return wordDataAlertCauseTitle(DataAlertCauseTitleCode.ServiceRaisesError, {
      service: service,
      error: error,
    });
  }

  if (service) {
    return wordDataAlertCauseTitle(
      DataAlertCauseTitleCode.ServiceRaisesAnError,
      { service: service },
    );
  }

  if (error) {
    return wordDataAlertCauseTitle(
      DataAlertCauseTitleCode.UnnamedServiceRaisesError,
      { error: error },
    );
  }

  return wordDataAlertCauseTitle(
    DataAlertCauseTitleCode.UnnamedServiceRaisesAnError,
  );
}

// Some of a service's writes to the table failed: how many, of how many.
export function getFailedWritesCauseTitle(data: {
  serviceName?: string | null | undefined;
  failed: number;
  total?: number | null | undefined;
}): DataAlertCauseTitle {
  const counts: Record<string, number> = {
    failed: data.failed,
    total: data.total || 0,
  };

  return hasName(data.serviceName)
    ? wordDataAlertCauseTitle(DataAlertCauseTitleCode.WritesFailed, {
        service: data.serviceName,
        ...counts,
      })
    : wordDataAlertCauseTitle(
        DataAlertCauseTitleCode.UnnamedServiceWritesFailed,
        counts,
      );
}

// A column of the table changed: its feed's line, as written, or that one did.
export function getSchemaChangeCauseTitle(
  feedLine: string | null | undefined,
): DataAlertCauseTitle {
  return hasName(feedLine)
    ? titleAsWritten(feedLine)
    : wordDataAlertCauseTitle(DataAlertCauseTitleCode.ColumnChanged);
}

// The database the table is in could not be read.
export function getUnreadableDatabaseCauseTitle(
  databaseName: string | null | undefined,
): DataAlertCauseTitle {
  return hasName(databaseName)
    ? wordDataAlertCauseTitle(DataAlertCauseTitleCode.DatabaseUnreadable, {
        database: databaseName,
      })
    : wordDataAlertCauseTitle(
        DataAlertCauseTitleCode.UnnamedDatabaseUnreadable,
      );
}

/*
 * The database server under the table is unwell: degraded or unhealthy, as
 * its engine's readings say (DatabaseEngineHealthVerdict). A health this
 * file has no sentence for is said in English, as it always was.
 */
export function getUnwellServerCauseTitle(data: {
  serverName?: string | null | undefined;
  health: string;
}): DataAlertCauseTitle {
  const name: string | null = hasName(data.serverName) ? data.serverName : null;

  if (data.health === "degraded") {
    return name
      ? wordDataAlertCauseTitle(DataAlertCauseTitleCode.ServerDegraded, {
          server: name,
        })
      : wordDataAlertCauseTitle(DataAlertCauseTitleCode.UnnamedServerDegraded);
  }

  if (data.health === "unhealthy") {
    return name
      ? wordDataAlertCauseTitle(DataAlertCauseTitleCode.ServerUnhealthy, {
          server: name,
        })
      : wordDataAlertCauseTitle(DataAlertCauseTitleCode.UnnamedServerUnhealthy);
  }

  return titleAsWritten(`${name || "The database server"} is ${data.health}`);
}
