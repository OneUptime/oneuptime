import { JSONObject } from "../JSON";

/*
 * THE SERVER'S EMAIL LOG, AS ITS MASTER ADMINS READ IT (#6878).
 *
 * "Did the password reset go out?" had no answer: an email that belongs to
 * no project - a sign-up's verification, a password reset, a sign-in link,
 * an invitation, an email to the server's admins - left no row anywhere,
 * and the banner only ever said the last thing the mail server answered.
 *
 * So the server keeps a row (Models/DatabaseModels/ServerEmailLog) for
 * every email it sends through its own email settings that belongs to no
 * project, and for every email of a project it failed to send through
 * them. Who it went to, what it was (its subject - with any link taken
 * out - or, for a project's, its template), when, whether it went, and
 * the mail service's answer: never the message, which in a password reset
 * or a verification carries a link that signs its holder in.
 *
 * Settings > Emails in the Admin Dashboard lists them, newest first, all of
 * them or the failed ones only, a page at a time:
 *
 *   GET /global-config/email-log?failedOnly=true&skip=25
 *       -> { entries, hasMore, retentionInDays }
 *
 * Master admins only: an address is personal data. Rows are deleted
 * getServerEmailLogRetentionInDays days after they were written.
 */

export const SERVER_EMAIL_LOG_ROUTE: string = "/global-config/email-log";

// The query the route reads: the failed emails only, and how many to skip.
export const SERVER_EMAIL_LOG_FAILED_ONLY_QUERY: string = "failedOnly";
export const SERVER_EMAIL_LOG_SKIP_QUERY: string = "skip";

// The rows one read returns, at most.
export const SERVER_EMAIL_LOG_PAGE_SIZE: number = 25;

// How far a read may skip: the log is a month of one server's emails.
export const MAX_SERVER_EMAIL_LOG_SKIP: number = 100000;

/*
 * How long a row is kept. On OneUptime Cloud a project's Email Logs keep
 * theirs 3 days, and so does this; a self-hosted server keeps them 30.
 */
export const SERVER_EMAIL_LOG_RETENTION_IN_DAYS: number = 30;
export const CLOUD_SERVER_EMAIL_LOG_RETENTION_IN_DAYS: number = 3;

export const getServerEmailLogRetentionInDays: (
  isBillingEnabled: boolean,
) => number = (isBillingEnabled: boolean): number => {
  return isBillingEnabled
    ? CLOUD_SERVER_EMAIL_LOG_RETENTION_IN_DAYS
    : SERVER_EMAIL_LOG_RETENTION_IN_DAYS;
};

export enum ServerEmailLogStatus {
  Sent = "sent",
  Failed = "failed",
}

export interface ServerEmailLogEntry {
  id: string;
  // When it was sent, or failed: an ISO 8601 time.
  at: string;
  toEmail: string;
  // OneUptime's own subject, links taken out; null for a project's email.
  subject: string | null;
  // The template it was written from, such as "ForgotPassword", if any.
  templateName: string | null;
  status: ServerEmailLogStatus;
  // The mail service's answer, or why nothing was sent.
  statusMessage: string | null;
  // The project it was sent for, if any, and its name while it exists.
  projectId: string | null;
  projectName: string | null;
}

export interface ServerEmailLogAnswer {
  entries: Array<ServerEmailLogEntry>;
  // Whether there are older rows than the last of these.
  hasMore: boolean;
  retentionInDays: number;
}

export interface ServerEmailLogQuery {
  failedOnly: boolean;
  skip: number;
}

const readText: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return typeof value === "string" && value ? value : null;
};

const readEntry: (value: unknown) => ServerEmailLogEntry | null = (
  value: unknown,
): ServerEmailLogEntry | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const id: string | null = readText(json["id"]);
  const at: string | null = readText(json["at"]);
  const toEmail: string | null = readText(json["toEmail"]);
  const status: unknown = json["status"];

  if (
    !id ||
    !at ||
    Number.isNaN(Date.parse(at)) ||
    !toEmail ||
    !Object.values(ServerEmailLogStatus).includes(
      status as ServerEmailLogStatus,
    )
  ) {
    return null;
  }

  return {
    id,
    at,
    toEmail,
    subject: readText(json["subject"]),
    templateName: readText(json["templateName"]),
    status: status as ServerEmailLogStatus,
    statusMessage: readText(json["statusMessage"]),
    projectId: readText(json["projectId"]),
    projectName: readText(json["projectName"]),
  };
};

export default class ServerEmailLogUtil {
  // The query that asks the route for one page.
  public static toQueryParams(query: ServerEmailLogQuery): {
    [name: string]: string;
  } {
    const params: { [name: string]: string } = {};

    if (query.failedOnly) {
      params[SERVER_EMAIL_LOG_FAILED_ONLY_QUERY] = "true";
    }

    if (query.skip > 0) {
      params[SERVER_EMAIL_LOG_SKIP_QUERY] = String(query.skip);
    }

    return params;
  }

  /*
   * The page a request asks for: anything but "true" asks for every email,
   * and anything but a whole number from 0 skips none.
   */
  public static readQuery(query: {
    [name: string]: unknown;
  }): ServerEmailLogQuery {
    const skip: number = Number(query[SERVER_EMAIL_LOG_SKIP_QUERY]);

    return {
      failedOnly: query[SERVER_EMAIL_LOG_FAILED_ONLY_QUERY] === "true",
      skip:
        Number.isInteger(skip) && skip > 0
          ? Math.min(skip, MAX_SERVER_EMAIL_LOG_SKIP)
          : 0,
    };
  }

  // The route's answer, or null for anything it would not answer.
  public static parseAnswer(value: unknown): ServerEmailLogAnswer | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;
    const entries: unknown = json["entries"];
    const retentionInDays: unknown = json["retentionInDays"];

    if (
      !Array.isArray(entries) ||
      typeof json["hasMore"] !== "boolean" ||
      typeof retentionInDays !== "number" ||
      !Number.isInteger(retentionInDays) ||
      retentionInDays <= 0
    ) {
      return null;
    }

    return {
      entries: entries
        .map(readEntry)
        .filter((entry: ServerEmailLogEntry | null): boolean => {
          return entry !== null;
        }) as Array<ServerEmailLogEntry>,
      hasMore: json["hasMore"] as boolean,
      retentionInDays: retentionInDays,
    };
  }
}
