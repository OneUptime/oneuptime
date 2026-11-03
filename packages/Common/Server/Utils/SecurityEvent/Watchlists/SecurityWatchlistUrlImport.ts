import SecurityWatchlist from "../../../../Models/DatabaseModels/SecurityWatchlist";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import QueryDeepPartialEntity from "../../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS,
  SECURITY_WATCHLIST_MESSAGES,
  SecurityWatchlistImportMode,
  SecurityWatchlistImportResult,
  SecurityWatchlistSource,
  getNextSecurityWatchlistImportAt,
  getSecurityWatchlistImportRetryAt,
  getSecurityWatchlistImportUrlProblem,
  parseSecurityWatchlistImport,
} from "../../../../Types/SecurityEvent/SecurityWatchlist";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import SecurityWatchlistItemService, {
  SecurityWatchlistImportSummary,
} from "../../../Services/SecurityWatchlistItemService";
import SecurityWatchlistService from "../../../Services/SecurityWatchlistService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import SecurityProjectWork, {
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
} from "../SecurityProjectWork";
import { looksLikeWebPage } from "../ThreatIntel/ThreatIntelListSource";

/*
 * WATCHLISTS READ FROM AN ADDRESS (SecurityWatchlistSource.Url).
 *
 * A list can be what a file at an https address holds - a CSV an HR or a
 * CMDB system publishes, a team's own list in a repository - read again on
 * its schedule (every hour, 6 hours or day). Each read:
 *
 *   1. downloads the file through DataSourceHttpFetch, as a threat intel
 *      list feed's poll does: the egress guard checks and pins the address,
 *      no redirect is followed, and the answer is capped in size and time;
 *   2. reads it as Import Values reads a file (parseSecurityWatchlistImport):
 *      one value a line, a note after a comma, and - under a header that
 *      names it - when each value leaves the list;
 *   3. makes the list the file: values it no longer holds leave, new ones
 *      join, and those it keeps take the file's note and moment to leave
 *      (SecurityWatchlistItemService.importValues);
 *   4. records what it did on the list (lastImport*), and when it reads
 *      next.
 *
 * A read that fails changes no value: a web page where a file was, a file
 * with no value the list takes, one past 4 MB or past the list's limits, an
 * address that does not answer. The list keeps the values of its last good
 * read, says why on its page, and is tried again within the hour.
 *
 * Reads are spread by project as every security pipeline's are
 * (SecurityProjectWork), and one list is read by one reader at a time: the
 * scheduled read and Read Now never write the same list at once.
 */

export const SECURITY_WATCHLIST_URL_READ_PROJECT_WORK: SecurityProjectWorkDefinition =
  {
    jobName: "SecurityWatchlists:ReadProjectLists",
    key: "security-watchlist-url-read",
    maxConcurrentProjects: 8,
  };

// How long one download may take: a list file, not a feed.
export const SECURITY_WATCHLIST_URL_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;

// How long one list's read may hold it: the download, then up to 5,000 values written.
const READ_LOCK_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

export type WatchlistUrlFetchLike = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

// What one read of a list did, as its page and Read Now say it.
export interface SecurityWatchlistUrlReadOutcome {
  // When the read worked: what it did to the list.
  summary: SecurityWatchlistImportSummary | null;
  // When it did not: why, in the shared words, and what the address said.
  error: string | null;
  errorDetail: string | null;
  // False when another read of the list was running: this one read nothing.
  isRead: boolean;
}

// A read that cannot be made, with the words its list shows and what the address said.
export class SecurityWatchlistUrlReadError extends Error {
  public constructor(
    message: string,
    public readonly detail: string | null = null,
  ) {
    super(message);
  }
}

// What a read reads of a list.
export const URL_READ_SELECT: Select<SecurityWatchlist> = {
  _id: true,
  projectId: true,
  name: true,
  entityType: true,
  source: true,
  importUrl: true,
  importSchedule: true,
  nextImportAt: true,
};

export default class SecurityWatchlistUrlImport {
  /*
   * The cron's half: every list read from an address that is due, and one
   * turn queued for each project with one. Returns how many were queued.
   */
  @CaptureSpan()
  public static async enqueueProjectsWithDueLists(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    const watchlists: Array<SecurityWatchlist> =
      await SecurityWatchlistService.findAllBy({
        query: {
          source: SecurityWatchlistSource.Url,
          nextImportAt: QueryHelper.lessThanEqualTo(now),
        },
        select: {
          _id: true,
          projectId: true,
        },
        sort: {
          nextImportAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    return SecurityProjectWork.enqueueProjects(
      SECURITY_WATCHLIST_URL_READ_PROJECT_WORK,
      watchlists.map((watchlist: SecurityWatchlist): ObjectID | undefined => {
        return watchlist.projectId;
      }),
      now,
    );
  }

  /*
   * One project's turn: its due lists, the longest overdue first, for as
   * long as the turn has time and keeps its lease. A list left over is
   * still due next minute.
   */
  @CaptureSpan()
  public static async runDueListsForProject(
    projectId: ObjectID,
    lease: SecurityProjectWorkLease = UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
  ): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const watchlists: Array<SecurityWatchlist> =
      await SecurityWatchlistService.findAllBy({
        query: {
          projectId,
          source: SecurityWatchlistSource.Url,
          nextImportAt: QueryHelper.lessThanEqualTo(now),
        },
        select: URL_READ_SELECT,
        sort: {
          nextImportAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    for (const watchlist of watchlists) {
      if (!lease.hasTimeLeft()) {
        return;
      }

      await this.readList(watchlist);

      if (!(await lease.keep())) {
        return;
      }
    }
  }

  // The file at a list's address, as text.
  public static async download(
    url: string,
    fetchImplementation?: WatchlistUrlFetchLike | undefined,
  ): Promise<string> {
    const fetch: WatchlistUrlFetchLike =
      fetchImplementation ||
      ((request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        return DataSourceHttpFetch.fetch(request);
      });

    let response: DataSourceHttpResponse;

    try {
      response = await fetch({
        method: "GET",
        url,
        headers: {
          Accept: "text/csv, text/plain;q=0.9, */*;q=0.5",
        },
        timeoutInMs: SECURITY_WATCHLIST_URL_REQUEST_TIMEOUT_IN_MS,
        egressOptions: {
          targetLabel: "Watchlist file",
        },
      });
    } catch (error) {
      throw new SecurityWatchlistUrlReadError(
        SECURITY_WATCHLIST_MESSAGES.urlNotRead.message,
        ConnectorErrorMessage.toMessage(error),
      );
    }

    return response.bodyText || "";
  }

  /*
   * What a file's text is as a list of this kind, or why it is not one:
   * no larger than an import, not a web page, and with at least one value
   * the list takes.
   */
  public static readFile(data: {
    text: string;
    entityType: unknown;
    now: Date;
  }): SecurityWatchlistImportResult {
    if (data.text.length > SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS) {
      throw new SecurityWatchlistUrlReadError(
        SECURITY_WATCHLIST_MESSAGES.urlFileTooLarge.message,
      );
    }

    if (looksLikeWebPage(data.text)) {
      throw new SecurityWatchlistUrlReadError(
        SECURITY_WATCHLIST_MESSAGES.urlFileIsWebPage.message,
      );
    }

    const parsed: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: data.text,
      entityType: data.entityType,
      now: data.now,
    });

    if (parsed.values.length === 0) {
      const firstProblem: string | undefined = parsed.problems[0]
        ? `Line ${parsed.problems[0].line}: ${parsed.problems[0].message}`
        : undefined;

      throw new SecurityWatchlistUrlReadError(
        SECURITY_WATCHLIST_MESSAGES.urlFileHasNoValues.message,
        firstProblem || null,
      );
    }

    return parsed;
  }

  /*
   * One read of one list (see the top of this file), as OneUptime: the
   * list is made the file, or keeps its values and says why. Recorded on
   * the list either way, with when it is read next. Never throws.
   */
  @CaptureSpan()
  public static async readList(
    watchlist: SecurityWatchlist,
    options: {
      fetchImplementation?: WatchlistUrlFetchLike | undefined;
      now?: Date | undefined;
    } = {},
  ): Promise<SecurityWatchlistUrlReadOutcome> {
    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const outcome: SecurityWatchlistUrlReadOutcome = {
      summary: null,
      error: null,
      errorDetail: null,
      isRead: false,
    };

    if (!watchlist.id || !watchlist.projectId) {
      return outcome;
    }

    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        namespace: "security-watchlist-url-read",
        key: watchlist.id.toString(),
        lockTimeout: READ_LOCK_TIMEOUT_IN_MS,
        acquireAttemptsLimit: 1,
        refreshInterval: 0,
      });
    } catch {
      // Another read of this list is running: its record is the one that counts.
      return outcome;
    }

    try {
      outcome.isRead = true;

      try {
        if (watchlist.source !== SecurityWatchlistSource.Url) {
          throw new SecurityWatchlistUrlReadError(
            SECURITY_WATCHLIST_MESSAGES.enterUrl.message,
          );
        }

        const urlProblem: string | null = getSecurityWatchlistImportUrlProblem(
          watchlist.importUrl,
        );

        if (urlProblem) {
          throw new SecurityWatchlistUrlReadError(urlProblem);
        }

        const text: string = await this.download(
          watchlist.importUrl!,
          options.fetchImplementation,
        );

        const parsed: SecurityWatchlistImportResult = this.readFile({
          text,
          entityType: watchlist.entityType,
          now,
        });

        outcome.summary = await SecurityWatchlistItemService.importValues({
          watchlistId: watchlist.id,
          text,
          parsed,
          mode: SecurityWatchlistImportMode.Replace,
          props: {
            isRoot: true,
          },
          fromUrl: true,
          now,
        });
      } catch (error) {
        if (error instanceof SecurityWatchlistUrlReadError) {
          outcome.error = error.message;
          outcome.errorDetail = error.detail;
        } else if (error instanceof BadDataException) {
          // Past the list's limits: the shared words say which.
          outcome.error = error.message;
        } else {
          logger.error(
            `SecurityWatchlistUrlImport: watchlist ${watchlist.id.toString()} could not be read:`,
          );
          logger.error(error);
          outcome.error = SECURITY_WATCHLIST_MESSAGES.urlNotRead.message;
          outcome.errorDetail = ConnectorErrorMessage.toMessage(error);
        }
      }

      await this.record(watchlist.id, outcome, {
        schedule: watchlist.importSchedule,
        now,
      });

      return outcome;
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        logger.debug(
          `SecurityWatchlistUrlImport: the read lock of watchlist ${watchlist.id.toString()} could not be given back.`,
        );
        logger.debug(error);
      }
    }
  }

  /*
   * What a read did, on its list: when it read, whether it worked and why
   * not, how many lines it left out, and when the list is read next - one
   * interval on, or within the hour after a failure. A failure never takes
   * a value away. Recording never fails the read.
   */
  public static async record(
    watchlistId: ObjectID,
    outcome: SecurityWatchlistUrlReadOutcome,
    data: { schedule: unknown; now: Date },
  ): Promise<void> {
    try {
      await SecurityWatchlistService.updateOneById({
        id: watchlistId,
        data: (outcome.error
          ? {
              lastImportAt: data.now,
              lastImportError: outcome.error,
              lastImportErrorDetail: outcome.errorDetail
                ? ConnectorErrorMessage.toMessage(outcome.errorDetail)
                : null,
              nextImportAt: getSecurityWatchlistImportRetryAt({
                schedule: data.schedule,
                now: data.now,
              }),
            }
          : {
              lastImportAt: data.now,
              lastImportSucceededAt: data.now,
              lastImportError: null,
              lastImportErrorDetail: null,
              lastImportLinesLeftOut: outcome.summary?.problemCount || 0,
              nextImportAt: getNextSecurityWatchlistImportAt({
                schedule: data.schedule,
                now: data.now,
              }),
            }) as unknown as QueryDeepPartialEntity<SecurityWatchlist>,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(
        `SecurityWatchlistUrlImport: what the read of watchlist ${watchlistId.toString()} did could not be recorded:`,
      );
      logger.error(error);
    }
  }

  /*
   * Read Now: a list read from an address, read at once rather than at its
   * next turn - after its address changes, or to see a fix take. The list
   * is read as the caller may read it; the read itself is OneUptime's, as
   * a scheduled one is.
   */
  @CaptureSpan()
  public static async readNow(data: {
    watchlistId: ObjectID;
    props: DatabaseCommonInteractionProps;
    fetchImplementation?: WatchlistUrlFetchLike | undefined;
  }): Promise<SecurityWatchlistUrlReadOutcome> {
    const watchlist: SecurityWatchlist | null =
      await SecurityWatchlistService.findOneById({
        id: data.watchlistId,
        select: URL_READ_SELECT,
        props: data.props,
      });

    if (!watchlist) {
      throw new BadDataException("Watchlist not found.");
    }

    if (watchlist.source !== SecurityWatchlistSource.Url) {
      throw new BadDataException(
        "Only a watchlist read from an address is read from one.",
      );
    }

    const outcome: SecurityWatchlistUrlReadOutcome = await this.readList(
      watchlist,
      { fetchImplementation: data.fetchImplementation },
    );

    if (!outcome.isRead) {
      throw new BadDataException(
        "This list is being read right now. Its page shows what the read did when it ends.",
      );
    }

    return outcome;
  }
}
