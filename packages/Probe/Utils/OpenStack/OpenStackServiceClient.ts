import {
  MAX_ATTEMPTS_PER_REQUEST,
  computeRetryDelayInMs,
} from "./OpenStackBackoff";
import {
  OpenStackApiError,
  OpenStackBudgetExceededError,
  readErrorMessage,
} from "./OpenStackCollectionErrors";
import { OpenStackHttpResponse, OpenStackTransport } from "./OpenStackHttp";
import { OpenStackKeystoneSession } from "./OpenStackKeystone";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OPENSTACK_SERVICE_TITLES,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";

/*
 * One service in one region, asked gently.
 *
 *   - One request at a time unless a caller says otherwise, so the load on a service
 *     is the length of its lists, never a burst.
 *   - Every list is paged with limit and marker. The next page's marker is this
 *     page's last id, and the URL an answer offers as `next` is never followed: it
 *     can name a host behind a load balancer, and the token would go with it.
 *   - A 429 or a server error is tried again later, as backoff says. What that does
 *     not fix, the caller stops asking this collection and asks less often after.
 *   - A slow answer slows the next request by as much, so a service that is falling
 *     behind gets room instead of the same pressure. Slow means this service's own: far
 *     past what it usually takes, or past a line no API should reach. Several reads at once
 *     take turns while it lasts, so a pause does not end in a burst.
 *   - Nothing runs past the collection's deadline: each request's own timeout is
 *     shortened to it, and a wait that would cross it is not waited.
 */

export interface OpenStackClock {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
}

export const DEFAULT_OPENSTACK_CLOCK: OpenStackClock = {
  now: (): number => {
    return Date.now();
  },
  sleep: (milliseconds: number): Promise<void> => {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, milliseconds);
    });
  },
  random: (): number => {
    return Math.random();
  },
};

export const DEFAULT_OPENSTACK_PAGE_SIZE: number = 1000;
export const OPENSTACK_REQUEST_TIMEOUT_IN_MS: number = 60_000;

// An answer this slow, or slower, earns the service a pause as long as the answer took.
export const SLOW_ANSWER_THRESHOLD_IN_MS: number = 5000;
export const MAX_PACE_IN_MS: number = 30_000;

/*
 * Latency climbing before it gets that far: this many times what the service usually answers
 * in, once it is at least this slow. Below the floor a multiple means nothing: an API that
 * goes from 40 ms to 200 ms is not in trouble.
 */
export const LATENCY_CLIMB_FACTOR: number = 3;
export const LATENCY_CLIMB_FLOOR_IN_MS: number = 1000;

/*
 * More pages than this and something is wrong: at a thousand a page it is a million
 * things in one list.
 */
export const MAX_PAGES_PER_LIST: number = 1000;

export type OpenStackQueryValue =
  | string
  | number
  | Array<string>
  | null
  | undefined;
export type OpenStackQuery = Record<string, OpenStackQueryValue>;

export type OpenStackPaging =
  // <key>_links holds a rel "next": Nova, Neutron and Cinder.
  | "links"
  // The answer's own `next`: Glance.
  | "next"
  // No paging at all: Keystone and Placement, and a few of Nova's and Neutron's.
  | "none";

export interface OpenStackJsonAnswer {
  body: JSONObject;
  // The service's own clock, from the answer's Date header.
  date: string | null;
}

export interface OpenStackListAnswer {
  items: Array<JSONObject>;
  // The first page's Date header: where a later incremental read picks up from.
  date: string | null;
  // Keystone cut the list at its list_limit, and said so.
  isTruncated: boolean;
  pageCount: number;
}

export function buildOpenStackQueryString(query?: OpenStackQuery): string {
  if (!query) {
    return "";
  }

  const parts: Array<string> = [];

  for (const key of Object.keys(query)) {
    const value: OpenStackQueryValue = query[key];

    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
      }
      continue;
    }

    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function headerOf(
  response: OpenStackHttpResponse,
  name: string,
): string | Array<string> | undefined {
  for (const key of Object.keys(response.headers)) {
    if (key.toLowerCase() === name) {
      return response.headers[key];
    }
  }

  return undefined;
}

function isConnectionReset(error: unknown): boolean {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  return code === "ECONNRESET" || code === "EPIPE";
}

export interface OpenStackServiceClientOptions {
  service: OpenStackServiceType;
  regionName: string;
  baseUrl: string;
  transport: OpenStackTransport;
  clock: OpenStackClock;
  // When the collection must be over by, in milliseconds.
  deadlineAt: number;
  session: OpenStackKeystoneSession;
  userAgent: string;
  requestTimeoutInMs?: number | undefined;
  headers?: Record<string, string> | undefined;
  pageSize?: number | undefined;
  // What this service usually answers in, from the collections before. Unknown at first.
  usualAnswerInMs?: number | null | undefined;
}

export default class OpenStackServiceClient {
  public readonly service: OpenStackServiceType;
  public readonly regionName: string;
  public readonly baseUrl: string;
  public readonly pageSize: number;
  public requestCount: number = 0;
  public headers: Record<string, string>;
  // What the Data Collection card says of a service that was asked more gently.
  public slowestAnswerInMs: number = 0;
  public pausedForInMs: number = 0;

  private readonly transport: OpenStackTransport;
  private readonly clock: OpenStackClock;
  private readonly deadlineAt: number;
  private readonly session: OpenStackKeystoneSession;
  private readonly userAgent: string;
  private readonly requestTimeoutInMs: number;
  private readonly usualAnswerInMs: number | null;
  private paceUntil: number = 0;
  private lastPaceInMs: number = 0;
  private waitingForPace: number = 0;
  private answerCount: number = 0;
  private answerTimeInMs: number = 0;

  public constructor(options: OpenStackServiceClientOptions) {
    this.service = options.service;
    this.regionName = options.regionName;
    this.baseUrl = options.baseUrl;
    this.transport = options.transport;
    this.clock = options.clock;
    this.deadlineAt = options.deadlineAt;
    this.session = options.session;
    this.userAgent = options.userAgent;
    this.requestTimeoutInMs =
      options.requestTimeoutInMs ?? OPENSTACK_REQUEST_TIMEOUT_IN_MS;
    this.headers = options.headers || {};
    this.pageSize = options.pageSize ?? DEFAULT_OPENSTACK_PAGE_SIZE;
    this.usualAnswerInMs = options.usualAnswerInMs ?? null;
  }

  // What its answers took on average, for the next collection to measure against.
  public getAverageAnswerInMs(): number | null {
    return this.answerCount > 0
      ? this.answerTimeInMs / this.answerCount
      : null;
  }

  public getDeadlineAt(): number {
    return this.deadlineAt;
  }

  public now(): number {
    return this.clock.now();
  }

  // The words every sentence about this service starts with.
  public describe(): string {
    return `${OPENSTACK_SERVICE_TITLES[this.service]} in ${this.regionName}`;
  }

  /*
   * One GET under this service's URL. `read` names what this is for, in sentences
   * and in the session's memory of what was refused. A caller that knows the service
   * answers without a token, as Nova's root does, says so, and sends none.
   */
  public async get(data: {
    read: string;
    path?: string | undefined;
    url?: string | undefined;
    query?: OpenStackQuery | undefined;
    withoutToken?: boolean | undefined;
    // A version document can come with 300 Multiple Choices, and is still the answer.
    acceptsMultipleChoices?: boolean | undefined;
  }): Promise<OpenStackJsonAnswer> {
    const url: string = `${data.url || `${this.baseUrl}${data.path || ""}`}${buildOpenStackQueryString(
      data.query,
    )}`;

    let hasRenewed: boolean = false;
    let attempt: number = 0;

    for (;;) {
      attempt++;

      await this.waitForPace(data.read);

      const remaining: number = this.deadlineAt - this.clock.now();

      if (remaining <= 0) {
        throw new OpenStackBudgetExceededError(
          `The collection ran out of time before ${this.describe()} answered ${data.read}.`,
        );
      }

      const tokenId: string = this.session.getToken().id;
      const startedAt: number = this.clock.now();
      let response: OpenStackHttpResponse;

      try {
        this.requestCount++;

        response = await this.transport({
          method: "GET",
          url: url,
          headers: {
            ...this.headers,
            Accept: "application/json",
            "User-Agent": this.userAgent,
            ...(data.withoutToken ? {} : { "X-Auth-Token": tokenId }),
          },
          timeoutInMs: Math.min(this.requestTimeoutInMs, remaining),
        });
      } catch (error) {
        // An idle keep-alive socket the server closed: nothing was asked yet.
        if (attempt === 1 && isConnectionReset(error)) {
          continue;
        }

        throw error;
      }

      this.pace(this.clock.now() - startedAt);

      if (
        (response.status >= 200 && response.status < 300) ||
        (response.status === 300 && data.acceptsMultipleChoices)
      ) {
        return {
          body: this.parseBody(response, data.read, url),
          date: this.readDate(response),
        };
      }

      if (response.status === 401 && !data.withoutToken) {
        if (
          !hasRenewed &&
          !this.session.isKnownRefused(this.readKey(data.read))
        ) {
          hasRenewed = true;

          if (await this.session.renew(tokenId)) {
            attempt = 0;
            continue;
          }
        }

        this.session.markRefused(this.readKey(data.read));

        throw new OpenStackApiError({
          kind: "refused",
          status: 401,
          url: url,
          message: `${this.describe()} refused ${data.read} (HTTP 401). With access rules, this path is not listed, or this service's keystonemiddleware has no service_type set.`,
        });
      }

      /*
       * A 409 on a read is Neutron on a project with no quota for security groups: it
       * tries to make the project's default one on the way, and cannot. That is just the
       * project a monitoring credential is told to live on, so it is this credential's
       * lot, and the API is fine.
       */
      if (response.status === 403 || response.status === 409) {
        throw new OpenStackApiError({
          kind: "refused",
          status: response.status,
          url: url,
          message: `${this.describe()} refused ${data.read} (HTTP ${response.status})${this.quoteError(response)}`,
        });
      }

      if (response.status === 404) {
        throw new OpenStackApiError({
          kind: "absent",
          status: 404,
          url: url,
          message: `${this.describe()} has no ${data.read} (HTTP 404).`,
        });
      }

      const isOverloaded: boolean =
        response.status === 429 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;

      if (isOverloaded || response.status >= 500) {
        if (attempt < MAX_ATTEMPTS_PER_REQUEST) {
          const delay: number = computeRetryDelayInMs({
            attempt: attempt,
            retryAfter: headerOf(response, "retry-after"),
            now: this.clock.now(),
            random: this.clock.random(),
          });

          // A wait that would cross the deadline only delays saying so.
          if (this.clock.now() + delay < this.deadlineAt) {
            await this.clock.sleep(delay);
            continue;
          }
        }
      }

      throw new OpenStackApiError({
        kind: isOverloaded ? "overloaded" : "failing",
        status: response.status,
        url: url,
        message: `${this.describe()} answered ${data.read} with HTTP ${response.status}${this.quoteError(response)}`,
      });
    }
  }

  /*
   * Every page of a list. A service that ignores `limit` answers everything at once
   * with no next link, which reads as one page.
   */
  public async list(data: {
    read: string;
    path: string;
    key: string;
    paging: OpenStackPaging;
    query?: OpenStackQuery | undefined;
    idField?: string | undefined;
  }): Promise<OpenStackListAnswer> {
    const items: Array<JSONObject> = [];
    const idField: string = data.idField || "id";
    let marker: string | undefined;
    let date: string | null = null;
    let isTruncated: boolean = false;
    let pageCount: number = 0;

    for (;;) {
      const answer: OpenStackJsonAnswer = await this.get({
        read: data.read,
        path: data.path,
        query: {
          ...data.query,
          ...(data.paging === "none" ? {} : { limit: this.pageSize }),
          ...(marker === undefined ? {} : { marker: marker }),
        },
      });

      pageCount++;

      if (pageCount === 1) {
        date = answer.date;
      }

      const page: JSONValue | undefined = answer.body[data.key];

      if (!Array.isArray(page)) {
        throw new OpenStackApiError({
          kind: "malformed",
          status: 200,
          url: `${this.baseUrl}${data.path}`,
          message: `${this.describe()} answered ${data.read} without a list of ${data.key}.`,
        });
      }

      // One by one: a route that ignores `limit` can answer more than a spread takes.
      for (const item of page as Array<JSONObject>) {
        items.push(item);
      }

      if (answer.body["truncated"] === true) {
        isTruncated = true;
      }

      if (
        page.length === 0 ||
        !this.hasNextPage(answer.body, data.key, data.paging)
      ) {
        return {
          items: items,
          date: date,
          isTruncated: isTruncated,
          pageCount: pageCount,
        };
      }

      const last: JSONObject = page[page.length - 1] as JSONObject;
      const nextMarker: JSONValue | undefined = last?.[idField];

      if (
        (typeof nextMarker !== "string" && typeof nextMarker !== "number") ||
        String(nextMarker) === marker ||
        pageCount >= MAX_PAGES_PER_LIST
      ) {
        throw new OpenStackApiError({
          kind: "malformed",
          status: 200,
          url: `${this.baseUrl}${data.path}`,
          message: `${this.describe()} kept offering another page of ${data.read}, so the probe stopped reading it after ${pageCount}.`,
        });
      }

      marker = String(nextMarker);
    }
  }

  private hasNextPage(
    body: JSONObject,
    key: string,
    paging: OpenStackPaging,
  ): boolean {
    if (paging === "next") {
      return typeof body["next"] === "string" && Boolean(body["next"]);
    }

    if (paging === "links") {
      const links: JSONValue | undefined = body[`${key}_links`];

      if (!Array.isArray(links)) {
        return false;
      }

      return (links as Array<JSONObject>).some((link: JSONObject): boolean => {
        return link?.["rel"] === "next";
      });
    }

    return false;
  }

  private readKey(read: string): string {
    return `${this.service}:${read}`;
  }

  private parseBody(
    response: OpenStackHttpResponse,
    read: string,
    url: string,
  ): JSONObject {
    let parsed: unknown;

    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new OpenStackApiError({
        kind: "malformed",
        status: response.status,
        url: url,
        message: `${this.describe()} answered ${read} with something other than JSON. Is the catalog's URL for it right?`,
      });
    }

    return parsed as JSONObject;
  }

  private readDate(response: OpenStackHttpResponse): string | null {
    const date: string | Array<string> | undefined = headerOf(response, "date");
    const text: string | undefined = Array.isArray(date) ? date[0] : date;
    return text || null;
  }

  private quoteError(response: OpenStackHttpResponse): string {
    const message: string | null = readErrorMessage(response.body);
    return message ? `: ${message}` : ".";
  }

  private getSlowAnswerLine(): number {
    if (this.usualAnswerInMs === null) {
      return SLOW_ANSWER_THRESHOLD_IN_MS;
    }

    return Math.min(
      SLOW_ANSWER_THRESHOLD_IN_MS,
      Math.max(
        LATENCY_CLIMB_FLOOR_IN_MS,
        this.usualAnswerInMs * LATENCY_CLIMB_FACTOR,
      ),
    );
  }

  private pace(latency: number): void {
    this.answerCount++;
    this.answerTimeInMs += latency;
    this.slowestAnswerInMs = Math.max(this.slowestAnswerInMs, latency);

    if (latency >= this.getSlowAnswerLine()) {
      this.lastPaceInMs = Math.min(latency, MAX_PACE_IN_MS);
      this.paceUntil = this.clock.now() + this.lastPaceInMs;
    }
  }

  private async waitForPace(read: string): Promise<void> {
    const remaining: number = this.paceUntil - this.clock.now();

    if (remaining <= 0) {
      return;
    }

    // Reads waiting at once go one after another, each a pause behind the one before it.
    const wait: number = remaining + this.waitingForPace * this.lastPaceInMs;

    if (this.clock.now() + wait >= this.deadlineAt) {
      throw new OpenStackBudgetExceededError(
        `The collection ran out of time before ${this.describe()} could be asked for ${read}.`,
      );
    }

    this.waitingForPace++;
    this.pausedForInMs += wait;

    try {
      await this.clock.sleep(wait);
    } finally {
      this.waitingForPace--;
    }
  }
}

// How many things to do at once with a list of them, in order of the list.
export async function mapWithLimit<T>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next: number = 0;

  const worker: () => Promise<void> = async (): Promise<void> => {
    while (next < items.length) {
      const item: T = items[next++] as T;
      await run(item);
    }
  };

  const workers: Array<Promise<void>> = [];

  for (let i: number = 0; i < Math.min(limit, items.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
}
