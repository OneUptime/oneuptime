import fs from "fs";
import path from "path";

/*
 * ------------------------------------------------------------------
 * A stand-in Xen Orchestra REST API (/rest/v0), for tests
 * ------------------------------------------------------------------
 *
 * There is no Xen Orchestra on the machines OneUptime's tests run on. This
 * serves the recorded lab of #10995 and #10997 (Fixtures/XcpNg/
 * XenOrchestraRest: two pools, their hosts, VMs and storage repositories,
 * XAPI's messages, backup jobs, schedules, runs and missing patches) the
 * way Xen Orchestra's REST API does, from its source (@xen-orchestra/
 * rest-api, master on 26 November 2026):
 *
 *   - `fields=a,b` picks those keys and adds `href` (object-wrapper);
 *     without `fields`, a list is of hrefs;
 *   - `filter=` is complex-matcher: `a:b` (a substring, case-insensitive;
 *     a number also equal), `a:>=5` (a number compared), `|(x y)` OR,
 *     `(x y)` and spaces AND, `!x` NOT, `a?` truthy;
 *   - /messages leaves out ALARM, BOND_STATUS_CHANGED and
 *     MULTIPATH_PERIODIC_ALERT; /alarms lists only them, parsed as
 *     alarm.service does: body {value: value times 100 to one decimal,
 *     name: the perfmon variable or the plain body}, object {type, uuid},
 *     time in milliseconds - and is filtered after parsing;
 *   - the token is the `authenticationToken` cookie; a wrong one is 401;
 *   - a list the token's privileges do not cover is answered empty, not
 *     refused (sendObjects); one object it may not read is 403;
 *   - /hosts/:id/missing_patches is 403 where the licence does not cover
 *     it (checkFeatureAuthorization).
 *
 * The lab's clock moves only when a test moves it (`setNowSeconds`): a
 * message is listed from its own time on, and until a test dismisses it.
 * ------------------------------------------------------------------
 */

export const XO_REST_FIXTURES_DIR: string = path.resolve(
  __dirname,
  "../../Server/Utils/Telemetry/Fixtures/XcpNg/XenOrchestraRest",
);

export const LAB_POOL_PRODUCTION: string =
  "b7569d99-30f8-178a-7d94-801de3e29b5b";
export const LAB_POOL_UNNAMED: string = "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1";

// The lab's "now": the second #10995's first recorded scrape was served.
export const LAB_NOW_SECONDS: number = 1795000000;

export const FAKE_XO_TOKEN: string = "fake-xo-token-for-tests-only";

const ALARM_NAMES: ReadonlyArray<string> = [
  "ALARM",
  "BOND_STATUS_CHANGED",
  "MULTIPATH_PERIODIC_ALERT",
];

const ALARM_BODY_PATTERN: RegExp =
  /^value:\s*(Infinity|NaN|-Infinity|\d+(?:\.\d+)?)\s*config:\s*<variable>\s*<name value="(.*?)"/;

export type FakeXoRecord = Record<string, unknown>;

export interface FakeXoRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

export interface FakeXoResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type FakeXoPrivilege =
  | "pool"
  | "host"
  | "message"
  | "alarm"
  | "backup-log"
  | "backup-job"
  | "schedule";

function readFixture<T>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(XO_REST_FIXTURES_DIR, name), "utf8"),
  ) as T;
}

/*
 * ---------------------------------------------------------------
 * complex-matcher, the subset the REST API's filters use
 * ---------------------------------------------------------------
 */

type MatchNode = (value: unknown) => boolean;

/*
 * Named rather than written inline: two lint rules disagree about wrapping
 * a regex literal in parentheses, and --fix goes round between them.
 */
const WHITESPACE: RegExp = /\s/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function some(value: unknown, match: MatchNode): boolean {
  if (Array.isArray(value)) {
    return value.some(match);
  }
  if (isPlainObject(value)) {
    return Object.values(value).some(match);
  }
  return false;
}

function stringNode(text: string): MatchNode {
  const lower: string = text.toLowerCase();
  const self: MatchNode = (value: unknown): boolean => {
    if (typeof value === "string") {
      return value.toLowerCase().includes(lower);
    }
    return some(value, self);
  };
  return self;
}

function numberOrStringNode(text: string): MatchNode {
  const lower: string = text.toLowerCase();
  const number: number = Number(text);
  const self: MatchNode = (value: unknown): boolean => {
    if (value === number) {
      return true;
    }
    if (typeof value === "string") {
      return value.toLowerCase().includes(lower);
    }
    return some(value, self);
  };
  return self;
}

function isRawChar(character: string): boolean {
  return (
    (character >= "0" && character <= "9") ||
    character === "_" ||
    character === "-" ||
    character === "." ||
    character === "$" ||
    character.toUpperCase() !== character.toLowerCase()
  );
}

class FilterParser {
  private readonly input: string;
  private position: number = 0;

  public constructor(input: string) {
    this.input = input;
  }

  public parse(): MatchNode {
    const terms: Array<MatchNode> = this.terms(null);
    this.skipSpaces();
    if (this.position < this.input.length) {
      throw new Error(`unexpected ${this.input.substring(this.position)}`);
    }
    return (value: unknown): boolean => {
      return terms.every((term: MatchNode): boolean => {
        return term(value);
      });
    };
  }

  private skipSpaces(): void {
    while (
      this.position < this.input.length &&
      WHITESPACE.test(this.input[this.position] as string)
    ) {
      this.position++;
    }
  }

  private terms(closing: string | null): Array<MatchNode> {
    const terms: Array<MatchNode> = [];
    for (;;) {
      this.skipSpaces();
      if (this.position >= this.input.length) {
        if (closing) {
          throw new Error(`expected ${closing}`);
        }
        return terms;
      }
      if (closing && this.input[this.position] === closing) {
        this.position++;
        return terms;
      }
      terms.push(this.term());
    }
  }

  private rawString(): string {
    const start: number = this.position;
    while (
      this.position < this.input.length &&
      isRawChar(this.input[this.position] as string)
    ) {
      this.position++;
    }
    return this.input.substring(start, this.position);
  }

  private quotedString(): string | null {
    if (this.input[this.position] !== '"') {
      return null;
    }
    this.position++;
    let out: string = "";
    while (this.position < this.input.length) {
      const character: string = this.input[this.position++] as string;
      if (character === '"') {
        return out;
      }
      out +=
        character === "\\"
          ? (this.input[this.position++] as string)
          : character;
    }
    throw new Error("unterminated string");
  }

  private term(): MatchNode {
    const character: string = this.input[this.position] as string;

    if (character === "(") {
      this.position++;
      const terms: Array<MatchNode> = this.terms(")");
      return (value: unknown): boolean => {
        return terms.every((term: MatchNode): boolean => {
          return term(value);
        });
      };
    }

    if (character === "|") {
      this.position++;
      this.skipSpaces();
      if (this.input[this.position] !== "(") {
        throw new Error("expected ( after |");
      }
      this.position++;
      const terms: Array<MatchNode> = this.terms(")");
      return (value: unknown): boolean => {
        return terms.some((term: MatchNode): boolean => {
          return term(value);
        });
      };
    }

    if (character === "!") {
      this.position++;
      this.skipSpaces();
      const inner: MatchNode = this.term();
      return (value: unknown): boolean => {
        return !inner(value);
      };
    }

    if (character === ">" || character === "<") {
      let operator: string = character;
      this.position++;
      if (this.input[this.position] === "=") {
        operator += "=";
        this.position++;
      }
      const number: number = Number(this.rawString());
      if (!Number.isFinite(number)) {
        throw new Error("a comparison takes a number");
      }
      return (value: unknown): boolean => {
        if (typeof value !== "number") {
          return false;
        }
        switch (operator) {
          case ">":
            return value > number;
          case ">=":
            return value >= number;
          case "<":
            return value < number;
          default:
            return value <= number;
        }
      };
    }

    const quoted: string | null = this.quotedString();
    const word: string = quoted ?? this.rawString();
    if (!word && quoted === null) {
      throw new Error(`unexpected ${this.input.substring(this.position)}`);
    }

    this.skipSpaces();
    if (this.input[this.position] === ":") {
      this.position++;
      this.skipSpaces();
      const child: MatchNode = this.term();
      return (value: unknown): boolean => {
        return isPlainObject(value) && child(value[word]);
      };
    }

    if (this.input[this.position] === "?") {
      this.position++;
      return (value: unknown): boolean => {
        return isPlainObject(value) && Boolean(value[word]);
      };
    }

    if (quoted !== null) {
      return stringNode(quoted);
    }
    return Number.isNaN(Number(word))
      ? stringNode(word)
      : numberOrStringNode(word);
  }
}

export function parseXoFilter(filter: string): MatchNode {
  return new FilterParser(filter).parse();
}

/*
 * ---------------------------------------------------------------
 * The server
 * ---------------------------------------------------------------
 */

export interface FakeXoFault {
  // A path, or its start: /rest/v0/backup-logs
  pathPrefix: string;
  status?: number | undefined;
  // Throw as a transport does when the network fails.
  throwMessage?: string | undefined;
  // How many requests it answers so; absent: every one.
  times?: number | undefined;
}

export default class FakeXenOrchestraRest {
  public pools: Array<FakeXoRecord>;
  public hosts: Array<FakeXoRecord>;
  public objects: Array<FakeXoRecord>;
  public messages: Array<FakeXoRecord>;
  public backupLogs: Array<FakeXoRecord>;
  public backupJobs: Array<FakeXoRecord>;
  public schedules: Array<FakeXoRecord>;
  public missingPatches: Record<string, Array<FakeXoRecord>>;

  public token: string = FAKE_XO_TOKEN;
  public privileges: Set<FakeXoPrivilege> = new Set<FakeXoPrivilege>([
    "pool",
    "host",
    "message",
    "alarm",
    "backup-log",
    "backup-job",
    "schedule",
  ]);
  public patchesLicensed: boolean = true;
  public nowSeconds: number = LAB_NOW_SECONDS;
  public readonly dismissed: Set<string> = new Set<string>();
  public readonly requests: Array<FakeXoRequest> = [];
  private faults: Array<FakeXoFault> = [];

  public constructor() {
    this.pools = readFixture<Array<FakeXoRecord>>("pools.json");
    this.hosts = readFixture<Array<FakeXoRecord>>("hosts.json");
    this.objects = readFixture<Array<FakeXoRecord>>("objects.json");
    this.messages = readFixture<Array<FakeXoRecord>>("messages.json");
    this.backupLogs = readFixture<Array<FakeXoRecord>>("backup-logs.json");
    this.backupJobs = readFixture<Array<FakeXoRecord>>("backup-jobs.json");
    this.schedules = readFixture<Array<FakeXoRecord>>("schedules.json");
    this.missingPatches = readFixture<Record<string, Array<FakeXoRecord>>>(
      "missing-patches.json",
    );
  }

  public setNowSeconds(seconds: number): void {
    this.nowSeconds = seconds;
  }

  // Someone dismissed a message in Xen Orchestra: XAPI destroyed it.
  public dismiss(messageId: string): void {
    this.dismissed.add(messageId);
  }

  public addMessage(message: FakeXoRecord): void {
    this.messages.push(message);
  }

  public addBackupLog(log: FakeXoRecord): void {
    this.backupLogs.push(log);
  }

  public replaceBackupLog(log: FakeXoRecord): void {
    this.backupLogs = this.backupLogs.map(
      (existing: FakeXoRecord): FakeXoRecord => {
        return existing["id"] === log["id"] ? log : existing;
      },
    );
  }

  public setPool(poolId: string, changes: FakeXoRecord): void {
    this.pools = this.pools.map((pool: FakeXoRecord): FakeXoRecord => {
      return pool["id"] === poolId ? { ...pool, ...changes } : pool;
    });
  }

  public fail(fault: FakeXoFault): void {
    this.faults.push({ ...fault });
  }

  public clearFaults(): void {
    this.faults = [];
  }

  // The messages XAPI lists now: from their time on, until dismissed.
  public listedMessages(): Array<FakeXoRecord> {
    return this.messages.filter((message: FakeXoRecord): boolean => {
      return (
        Number(message["time"]) <= this.nowSeconds &&
        !this.dismissed.has(String(message["id"]))
      );
    });
  }

  // The backup runs Xen Orchestra has logged by now.
  public listedBackupLogs(): Array<FakeXoRecord> {
    return this.backupLogs.filter((log: FakeXoRecord): boolean => {
      return Number(log["start"]) <= this.nowSeconds * 1000;
    });
  }

  private findObject(uuid: string): FakeXoRecord | undefined {
    return [...this.pools, ...this.hosts, ...this.objects].find(
      (object: FakeXoRecord): boolean => {
        return object["uuid"] === uuid;
      },
    );
  }

  // alarm.service's parseAlarm.
  public parseAlarm(message: FakeXoRecord): FakeXoRecord {
    const { $object, body, time, ...rest } = message;
    const object: FakeXoRecord | undefined = this.findObject(String($object));
    const match: RegExpMatchArray | null =
      String(body).match(ALARM_BODY_PATTERN);
    const rawValue: string | undefined = match ? match[1] : undefined;
    const value: string | undefined =
      rawValue !== undefined && Number.isFinite(Number(rawValue))
        ? (Number(rawValue) * 100).toFixed(1)
        : rawValue;
    return {
      ...rest,
      body: {
        value: value,
        name: match ? match[2] : body,
      },
      object: object
        ? {
            type: object["type"],
            uuid: object["uuid"],
            href: `/rest/v0/${String(object["type"]).toLowerCase()}s/${String(object["uuid"])}`,
          }
        : { type: "unknown", uuid: $object },
      time: Number(time) * 1000,
    };
  }

  public async handle(request: FakeXoRequest): Promise<FakeXoResponse> {
    this.requests.push({
      method: request.method,
      path: request.path,
      headers: { ...request.headers },
    });

    const url: URL = new URL(request.path, "https://xo.example.test");

    for (const fault of this.faults) {
      if (
        url.pathname.startsWith(fault.pathPrefix) &&
        (fault.times === undefined || fault.times > 0)
      ) {
        if (fault.times !== undefined) {
          fault.times--;
        }
        if (fault.throwMessage) {
          throw new Error(fault.throwMessage);
        }
        return this.json(fault.status ?? 500, {
          error: "injected by the test",
        });
      }
    }

    if (request.method !== "GET") {
      return this.json(405, { error: "only reads here" });
    }

    const cookie: string = request.headers["Cookie"] || "";
    if (cookie !== `authenticationToken=${this.token}`) {
      return this.json(401, { error: "authentication required" });
    }

    const parts: Array<string> = url.pathname
      .replace(/^\/rest\/v0\/?/, "")
      .split("/")
      .filter(Boolean);
    const query: URLSearchParams = url.searchParams;

    switch (parts[0]) {
      case "pools":
        return this.list("pools", this.pools, query, "pool");
      case "hosts":
        if (parts.length === 3 && parts[2] === "missing_patches") {
          return this.missingPatchesOf(parts[1] as string);
        }
        return this.list("hosts", this.hosts, query, "host");
      case "messages":
        return this.list(
          "messages",
          this.listedMessages().filter((message: FakeXoRecord): boolean => {
            return !ALARM_NAMES.includes(String(message["name"]));
          }),
          query,
          "message",
        );
      case "alarms":
        return this.list(
          "alarms",
          this.listedMessages()
            .filter((message: FakeXoRecord): boolean => {
              return ALARM_NAMES.includes(String(message["name"]));
            })
            .map((message: FakeXoRecord): FakeXoRecord => {
              return this.parseAlarm(message);
            }),
          query,
          "alarm",
        );
      case "backup-logs": {
        if (parts.length === 2) {
          if (!this.privileges.has("backup-log")) {
            return this.json(403, { error: "forbidden operation" });
          }
          const log: FakeXoRecord | undefined = this.listedBackupLogs().find(
            (entry: FakeXoRecord): boolean => {
              return entry["id"] === parts[1];
            },
          );
          return log
            ? this.json(200, log)
            : this.json(404, { error: "no such backup-log" });
        }
        return this.list(
          "backup-logs",
          this.listedBackupLogs(),
          query,
          "backup-log",
        );
      }
      case "backup-jobs":
        return this.list("backup-jobs", this.backupJobs, query, "backup-job");
      case "schedules":
        return this.list("schedules", this.schedules, query, "schedule");
      default:
        return this.json(404, { error: `no route ${url.pathname}` });
    }
  }

  private missingPatchesOf(hostId: string): FakeXoResponse {
    if (!this.patchesLicensed) {
      return this.json(403, { error: "feature unauthorized" });
    }
    if (!this.privileges.has("host")) {
      return this.json(403, { error: "forbidden operation" });
    }
    const patches: Array<FakeXoRecord> | undefined =
      this.missingPatches[hostId];
    if (!patches) {
      return this.json(404, { error: "no such host" });
    }
    return this.json(200, patches);
  }

  private list(
    route: string,
    objects: Array<FakeXoRecord>,
    query: URLSearchParams,
    privilege: FakeXoPrivilege,
  ): FakeXoResponse {
    // A list the token may not read is answered empty, not refused.
    if (!this.privileges.has(privilege)) {
      return this.json(200, []);
    }

    let selected: Array<FakeXoRecord> = objects;
    const filter: string | null = query.get("filter");
    if (filter) {
      let match: MatchNode;
      try {
        match = parseXoFilter(filter);
      } catch (error) {
        return this.json(400, {
          error: `invalid filter: ${(error as Error).message}`,
        });
      }
      selected = selected.filter(match);
    }

    const limit: number = Number(query.get("limit"));
    if (Number.isFinite(limit) && limit > 0) {
      selected = selected.slice(0, limit);
    }

    const fields: string | null = query.get("fields");
    const href: (object: FakeXoRecord) => string = (
      object: FakeXoRecord,
    ): string => {
      return `/rest/v0/${route}/${String(object["id"])}`;
    };

    if (fields === "*") {
      return this.json(
        200,
        selected.map((object: FakeXoRecord): FakeXoRecord => {
          return { ...object, href: href(object) };
        }),
      );
    }

    if (fields) {
      const keys: Array<string> = fields.split(",");
      return this.json(
        200,
        selected.map((object: FakeXoRecord): FakeXoRecord => {
          const picked: FakeXoRecord = {};
          for (const key of keys) {
            if (key in object) {
              picked[key] = object[key];
            }
          }
          picked["href"] = href(object);
          return picked;
        }),
      );
    }

    return this.json(200, selected.map(href));
  }

  private json(status: number, body: unknown): FakeXoResponse {
    return {
      status: status,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    };
  }
}
