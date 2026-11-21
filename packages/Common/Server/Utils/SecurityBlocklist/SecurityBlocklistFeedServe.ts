import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlocklistFeed from "../../../Models/DatabaseModels/SecurityBlocklistFeed";
import SecurityBlockService from "../../Services/SecurityBlockService";
import SecurityBlocklistFeedFetchService from "../../Services/SecurityBlocklistFeedFetchService";
import SecurityBlocklistFeedService, {
  SecurityBlocklistFeedSecretMatch,
} from "../../Services/SecurityBlocklistFeedService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityBlocklistFeedProtection, {
  SecurityBlocklistFeedProtectionCheck,
} from "./SecurityBlocklistFeedProtection";
import SecurityBlocklistJobs from "./SecurityBlocklistJobs";
import {
  SECURITY_BLOCKLIST_MAX_ACTIVE_BLOCKS,
  getSecurityBlockEntryComment,
} from "./SecurityBlocklistReconciler";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";
import { SecurityBlockState } from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlocklistFeedEntry,
  isSecurityBlocklistFeedSecretShape,
  isSecurityBlocklistFeedSourceAllowed,
  readSecurityBlocklistFeedAllowlist,
  selectSecurityBlocklistFeedEntries,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import {
  SECURITY_BLOCKLIST_FEED_COMMENTS_QUERY,
  SECURITY_BLOCKLIST_FEED_FILE_NAMES,
  SECURITY_BLOCKLIST_FEED_MD5_SUFFIX,
  SecurityBlocklistFeedFile,
  readSecurityBlocklistFeedComments,
  readSecurityBlocklistFeedFile,
  renderSecurityBlocklistFeed,
  renderSecurityBlocklistFeedMd5,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeedFormat";
import crypto from "crypto";

/*
 * ANSWERING A FIREWALL THAT FETCHES A BLOCKLIST FEED (#10345).
 *
 * In order, and the answer each step gives:
 *
 *   1. the URL names a file a feed serves and a feed ID, and a path secret
 *      shaped like one ................................ else 404, "Not found."
 *   2. the request carries a secret: in the path, or in Authorization as a
 *      bearer token or a basic password ........ else 401 with a Basic challenge
 *   3. the feed exists ................................ else 404
 *   4. the secret is its current one, or the one a rotation replaced while
 *      its day lasts ............ else 401 (404 for a secret in the path: that
 *      URL does not exist)
 *   5. the request comes from an address its allowlist holds, when it has one
 *      ................................................ else 403
 *   6. what the project blocks now: every block in force that blocks, of a
 *      family the feed serves, and none that touches a protected address -
 *      an expired or lifted block, or an address protected since it was
 *      blocked, is gone from this very fetch ........... else 503, Retry-After:
 *      what protects an address could not be read, so nothing new is served
 *      unchecked, and the firewall keeps the list it has
 *   7. the file, with its ETag (the MD5 of the list, in quotes): 304 when
 *      If-None-Match names it, 200 with the file otherwise. The MD5 file
 *      (blocklist.txt.md5) is the MD5 of the list as 32 hex digits.
 *
 * Then, once the answer is on its way, the fetch is recorded
 * (recordFetch): what the firewall now holds, when, from where, with what,
 * and whether the list had changed. That record is the evidence a block is
 * enforced at the feed, so it says the firewall holds a list only when it
 * does: after a 200 or a 304 of the list; after an MD5 fetch only when the
 * MD5 is that of the list it last fetched in full (Cisco then keeps its
 * copy). A HEAD is answered and not recorded: it loads nothing.
 *
 * The secret is never logged, never in an error, and never a cache key.
 */

export enum SecurityBlocklistFeedAuthMethod {
  Basic = "Basic",
  Bearer = "Bearer",
  Path = "Path",
}

// The secret a request carries, and how.
export interface SecurityBlocklistFeedCredentials {
  secret: string;
  method: SecurityBlocklistFeedAuthMethod;
}

// What answers a fetch that cannot be read, any time: the same constant, whatever was asked.
export const SECURITY_BLOCKLIST_FEED_NOT_FOUND_MESSAGE: string = "Not found.";

// How long a firewall told the list cannot be read now waits before it asks again.
export const SECURITY_BLOCKLIST_FEED_RETRY_AFTER_SECONDS: number = 60;

// The realm a 401 challenges for.
export const SECURITY_BLOCKLIST_FEED_REALM: string = "OneUptime blocklist feed";

// The longest user agent a fetch keeps.
const USER_AGENT_MAX_LENGTH: number = 500;

// Base64, as basic auth's credentials are written.
const BASE64_PATTERN: RegExp = /^[A-Za-z0-9+/]+={0,2}$/;

export interface SecurityBlocklistFeedFetchRequest {
  // As the URL gives them, unchecked.
  feedId: string | null | undefined;
  // The secret in the path; null on the route that takes it in a header.
  pathSecret: string | null;
  fileName: string | null | undefined;
  comments: unknown;
  authorization: string | Array<string> | undefined;
  ifNoneMatch: string | Array<string> | undefined;
  userAgent: string | Array<string> | undefined;
  clientIp: string | null;
  isHead: boolean;
  now: Date;
}

// Records a fetch once its answer is on its way: never throws.
export type SecurityBlocklistFeedBookkeeping = () => Promise<void>;

export type SecurityBlocklistFeedFetchAnswer =
  | { status: 404 }
  | { status: 401 }
  | { status: 403 }
  | { status: 503; retryAfterSeconds: number }
  | {
      status: 304;
      etag: string;
      bookkeeping: SecurityBlocklistFeedBookkeeping | null;
    }
  | {
      status: 200;
      body: string;
      etag: string;
      bookkeeping: SecurityBlocklistFeedBookkeeping | null;
    };

function firstHeader(value: string | Array<string> | undefined): string {
  return (Array.isArray(value) ? value[0] : value) || "";
}

/*
 * The secret a request carries: in its path (on the route that takes one
 * there), else in its Authorization header - a bearer token, or the
 * password of basic auth, whatever its username. Null when it carries
 * none.
 */
export function readSecurityBlocklistFeedCredentials(data: {
  pathSecret: string | null;
  authorization: string | Array<string> | undefined;
}): SecurityBlocklistFeedCredentials | null {
  if (data.pathSecret !== null) {
    return {
      secret: data.pathSecret.trim(),
      method: SecurityBlocklistFeedAuthMethod.Path,
    };
  }

  const header: string = firstHeader(data.authorization).trim();
  const space: number = header.indexOf(" ");

  if (space <= 0) {
    return null;
  }

  const scheme: string = header.slice(0, space).toLowerCase();
  const value: string = header.slice(space + 1).trim();

  if (!value) {
    return null;
  }

  if (scheme === "bearer") {
    return { secret: value, method: SecurityBlocklistFeedAuthMethod.Bearer };
  }

  if (scheme !== "basic") {
    return null;
  }

  // RFC 7617: base64 of "username:password"; the password is all after the first colon.
  if (!BASE64_PATTERN.test(value)) {
    return null;
  }

  const decoded: string = Buffer.from(value, "base64").toString("utf8");
  const colon: number = decoded.indexOf(":");

  if (colon === -1) {
    return null;
  }

  return {
    secret: decoded.slice(colon + 1),
    method: SecurityBlocklistFeedAuthMethod.Basic,
  };
}

// The MD5 of a file's bytes, as 32 lower-case hex digits.
export function getSecurityBlocklistFeedMd5(body: string): string {
  return crypto.createHash("md5").update(body, "utf8").digest("hex");
}

/*
 * Whether If-None-Match names this ETag, or any (*): the firewall holds the
 * file already. Compared weakly (RFC 9110), so a W/ before a tag matches.
 */
export function isSecurityBlocklistFeedNotModified(
  ifNoneMatch: string | Array<string> | undefined,
  etag: string,
): boolean {
  const header: string = (
    Array.isArray(ifNoneMatch) ? ifNoneMatch.join(",") : ifNoneMatch || ""
  ).trim();

  if (!header) {
    return false;
  }

  if (header === "*") {
    return true;
  }

  return header.split(",").some((tag: string): boolean => {
    return tag.trim().replace(/^W\//, "") === etag;
  });
}

// What a fetch asked for, as its log line names it: "blocklist.txt?comments=1".
export function describeSecurityBlocklistFeedFile(data: {
  file: SecurityBlocklistFeedFile;
  withComments: boolean;
}): string {
  const name: string = `${SECURITY_BLOCKLIST_FEED_FILE_NAMES[data.file.format]}${
    data.file.isMd5 ? SECURITY_BLOCKLIST_FEED_MD5_SUFFIX : ""
  }`;

  return data.withComments
    ? `${name}?${SECURITY_BLOCKLIST_FEED_COMMENTS_QUERY}`
    : name;
}

function sameValues(
  first: ReadonlyArray<string>,
  second: ReadonlyArray<string>,
): boolean {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((value: string, index: number): boolean => {
    return value === second[index];
  });
}

export default class SecurityBlocklistFeedServe {
  // A fetch's bookkeeping still running, for tests that wait for it.
  private static pending: Set<Promise<void>> = new Set();

  public static async waitForPendingBookkeeping(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(Array.from(this.pending));
    }
  }

  // Runs a fetch's bookkeeping, keeping it in sight until it is done.
  public static runBookkeeping(
    bookkeeping: SecurityBlocklistFeedBookkeeping,
  ): Promise<void> {
    const running: Promise<void> = bookkeeping().finally(() => {
      this.pending.delete(running);
    });

    this.pending.add(running);

    return running;
  }

  @CaptureSpan()
  public static async answer(
    request: SecurityBlocklistFeedFetchRequest,
  ): Promise<SecurityBlocklistFeedFetchAnswer> {
    const file: SecurityBlocklistFeedFile | null =
      readSecurityBlocklistFeedFile(request.fileName);
    const feedIdText: string = (request.feedId || "").trim();
    const isPathRoute: boolean = request.pathSecret !== null;

    if (!file || !ObjectID.isValidUUID(feedIdText)) {
      return { status: 404 };
    }

    if (
      isPathRoute &&
      !isSecurityBlocklistFeedSecretShape((request.pathSecret || "").trim())
    ) {
      return { status: 404 };
    }

    const credentials: SecurityBlocklistFeedCredentials | null =
      readSecurityBlocklistFeedCredentials({
        pathSecret: request.pathSecret,
        authorization: request.authorization,
      });

    // Nothing to check a feed against: asked for credentials before anything is read.
    if (!credentials) {
      return { status: 401 };
    }

    const feed: SecurityBlocklistFeed | null =
      await SecurityBlocklistFeedService.findForServe(new ObjectID(feedIdText));

    if (!feed || !feed.id || !feed.projectId) {
      return { status: 404 };
    }

    const match: SecurityBlocklistFeedSecretMatch | null =
      SecurityBlocklistFeedService.matchSecret({
        feed,
        presented: credentials.secret,
        now: request.now,
      });

    if (!match) {
      return isPathRoute ? { status: 404 } : { status: 401 };
    }

    if (
      !isSecurityBlocklistFeedSourceAllowed({
        allowlist: readSecurityBlocklistFeedAllowlist(
          feed.allowedSourceAddresses,
        ).blocks,
        clientIp: request.clientIp,
      })
    ) {
      return { status: 403 };
    }

    const withComments: boolean = readSecurityBlocklistFeedComments(
      request.comments,
    );

    const entries: Array<SecurityBlocklistFeedEntry> | null =
      await this.readEntries({ feed, now: request.now });

    if (!entries) {
      return {
        status: 503,
        retryAfterSeconds: SECURITY_BLOCKLIST_FEED_RETRY_AFTER_SECONDS,
      };
    }

    const list: string = renderSecurityBlocklistFeed({
      format: file.format,
      entries,
      withComments,
      family: feed.family,
    });
    const listMd5: string = getSecurityBlocklistFeedMd5(list);
    const body: string = file.isMd5
      ? renderSecurityBlocklistFeedMd5(listMd5)
      : list;
    const etag: string = `"${file.isMd5 ? getSecurityBlocklistFeedMd5(body) : listMd5}"`;
    const isNotModified: boolean = isSecurityBlocklistFeedNotModified(
      request.ifNoneMatch,
      etag,
    );

    const bookkeeping: SecurityBlocklistFeedBookkeeping | null = request.isHead
      ? null
      : (): Promise<void> => {
          return this.recordFetch({
            feed,
            request,
            match,
            method: credentials.method,
            file,
            withComments,
            entries,
            listMd5,
            statusCode: isNotModified ? 304 : 200,
          });
        };

    return isNotModified
      ? { status: 304, etag, bookkeeping }
      : { status: 200, body, etag, bookkeeping };
  }

  /*
   * The entries the feed serves now, or null when what would protect one
   * could not be read: every active block of the project, the oldest first
   * (as many as the reconciler keeps), held to the feed's rules and to what
   * the project protects.
   */
  @CaptureSpan()
  public static async readEntries(data: {
    feed: SecurityBlocklistFeed;
    now: Date;
  }): Promise<Array<SecurityBlocklistFeedEntry> | null> {
    const blocks: Array<SecurityBlock> = await SecurityBlockService.findBy({
      query: {
        projectId: data.feed.projectId!,
        state: SecurityBlockState.Active,
      },
      select: {
        _id: true,
        value: true,
        action: true,
        state: true,
        expiresAt: true,
        createdAt: true,
        securityCaseId: true,
        securityCase: { caseNumberWithPrefix: true },
      },
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: SECURITY_BLOCKLIST_MAX_ACTIVE_BLOCKS,
      props: { isRoot: true },
    });

    const selected: Array<SecurityBlocklistFeedEntry> =
      selectSecurityBlocklistFeedEntries({
        blocks: blocks.map((block: SecurityBlock) => {
          return {
            value: block.value,
            action: block.action,
            state: block.state,
            expiresAt: block.expiresAt,
            comment: getSecurityBlockEntryComment(block),
          };
        }),
        family: data.feed.family,
        now: data.now,
      });

    const protection: SecurityBlocklistFeedProtectionCheck =
      await SecurityBlocklistFeedProtection.check({
        projectId: data.feed.projectId!,
        entries: selected,
        now: data.now,
      });

    return protection.isReadable ? protection.served : null;
  }

  /*
   * Records a fetch: what the firewall now holds (when it holds a list),
   * when it last fetched, from where and with what, and a line of the fetch
   * log. A list it holds that differs from the last one reconciles the
   * project at once, so the blocks it now holds read as enforced there
   * within seconds, not at the next pass. Never throws: the answer stands.
   */
  @CaptureSpan()
  public static async recordFetch(data: {
    feed: SecurityBlocklistFeed;
    request: SecurityBlocklistFeedFetchRequest;
    match: SecurityBlocklistFeedSecretMatch;
    method: SecurityBlocklistFeedAuthMethod;
    file: SecurityBlocklistFeedFile;
    withComments: boolean;
    entries: ReadonlyArray<SecurityBlocklistFeedEntry>;
    listMd5: string;
    statusCode: number;
  }): Promise<void> {
    const { feed, request } = data;
    const now: Date = request.now;

    try {
      const servedValues: Array<string> = data.entries.map(
        (entry: SecurityBlocklistFeedEntry): string => {
          return entry.value;
        },
      );
      const heldValues: Array<string> = Array.isArray(feed.servedValues)
        ? feed.servedValues.map((value: unknown): string => {
            return String(value);
          })
        : [];

      /*
       * Whether the firewall now holds this list: it was handed it, or told
       * it holds it (304), or, asking for the MD5, it is the list it last
       * fetched in full.
       */
      const holdsList: boolean =
        !data.file.isMd5 || data.listMd5 === feed.servedBodyMd5;
      const isHeldSetChanged: boolean =
        holdsList &&
        (!feed.servedConfirmedAt || !sameValues(servedValues, heldValues));
      const isListChanged: boolean = data.listMd5 !== feed.servedBodyMd5;

      if (holdsList) {
        await this.writeHeld({
          feed,
          now,
          servedValues,
          isHeldSetChanged,
          listMd5: data.file.isMd5 ? null : data.listMd5,
        });
      }

      const userAgent: string = firstHeader(request.userAgent)
        .trim()
        .slice(0, USER_AGENT_MAX_LENGTH);

      await SecurityBlocklistFeedService.updateColumnsByIdWithoutHooks({
        id: feed.id!,
        data: {
          lastFetchedAt: now,
          lastFetchSourceIp: (request.clientIp || "").slice(0, 100) || null,
          lastFetchUserAgent: userAgent || null,
          // It reads the feed again: told again if it stops again.
          ...(feed.stoppedReadingToldAt ? { stoppedReadingToldAt: null } : {}),
        } as unknown as PartialEntity<SecurityBlocklistFeed>,
      });

      await SecurityBlocklistFeedFetchService.record({
        projectId: feed.projectId!,
        feedId: feed.id!,
        fetchedAt: now,
        sourceIp: request.clientIp,
        userAgent: userAgent || null,
        file: describeSecurityBlocklistFeedFile({
          file: data.file,
          withComments: data.withComments,
        }),
        authMethod: data.method,
        usedPreviousSecret:
          data.match === SecurityBlocklistFeedSecretMatch.Previous,
        statusCode: data.statusCode,
        isChanged: isListChanged,
        entryCount: servedValues.length,
      });

      if (isHeldSetChanged) {
        await SecurityBlocklistJobs.queueReconcile(feed.projectId!);
      }
    } catch (error) {
      logger.error(
        `SecurityBlocklistFeedServe: could not record a fetch of feed ${feed.id?.toString() || ""}; the next fetch records it again.`,
      );
      logger.error(error);
    }
  }

  /*
   * What the firewall holds, confirmed now: a compare-and-set on when it
   * was last confirmed, so a slower fetch never puts back an older list
   * over a newer one. Tried twice: once against what the fetch read, and
   * once against what another fetch has written since, while that is
   * older.
   */
  private static async writeHeld(data: {
    feed: SecurityBlocklistFeed;
    now: Date;
    servedValues: Array<string>;
    isHeldSetChanged: boolean;
    // The MD5 of the list served in full; null for an MD5 fetch, which changes no list.
    listMd5: string | null;
  }): Promise<void> {
    let expected: Date | null = data.feed.servedConfirmedAt
      ? new Date(data.feed.servedConfirmedAt)
      : null;

    for (let attempt: number = 0; attempt < 2; attempt++) {
      /*
       * The held set is written when it changed - and always on the second
       * try, since another fetch wrote a set of its own in between.
       */
      const write: Record<string, unknown> = {
        servedConfirmedAt: data.now,
        ...(data.isHeldSetChanged || attempt > 0
          ? {
              servedValues: data.servedValues,
              servedCount: data.servedValues.length,
            }
          : {}),
        ...(data.listMd5 ? { servedBodyMd5: data.listMd5 } : {}),
      };

      const isWritten: boolean =
        await SecurityBlocklistFeedService.compareAndSetColumnsByIdWithoutHooks(
          {
            id: data.feed.id!,
            data: write as unknown as PartialEntity<SecurityBlocklistFeed>,
            expectedData: {
              servedConfirmedAt: expected,
            } as unknown as PartialEntity<SecurityBlocklistFeed>,
          },
        );

      if (isWritten) {
        return;
      }

      const current: SecurityBlocklistFeed | null =
        await SecurityBlocklistFeedService.findOneById({
          id: data.feed.id!,
          select: { _id: true, servedConfirmedAt: true },
          props: { isRoot: true },
        });

      if (!current?.servedConfirmedAt) {
        return;
      }

      expected = new Date(current.servedConfirmedAt);

      // Another fetch confirmed a list at least as recent: its record stands.
      if (expected.getTime() >= data.now.getTime()) {
        return;
      }
    }
  }
}
