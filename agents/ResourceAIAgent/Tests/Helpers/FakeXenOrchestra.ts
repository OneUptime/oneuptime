import http from "http";
import https from "https";
import net from "net";
import { XoHttpRequest, XoHttpResponse } from "../../Executors/XcpNgExecutor";
import {
  HOST_LAB_1,
  HOST_PROD_1,
  LAB_POOL,
  PROD_POOL,
  SCHEDULE_NIGHTLY,
  XoObject,
  labBackupJobs,
  labBackupLogs,
  labHosts,
  labMessages,
  labPbds,
  labPools,
  labSchedules,
  labSrs,
  labTasks,
  labVdis,
  labVmControllers,
  labVms,
} from "./XenOrchestraLab";

/*
 * A FAKE XEN ORCHESTRA, faithful to the parts of its REST API the XCP-ng AI
 * agent uses, as @xen-orchestra/rest-api 0.42.0 (xo-server 5.214.0) serves
 * them - read from vatesfr/xen-orchestra at 750c74beb1e:
 *
 *   - authentication (middlewares/authentication.middleware.mts): the
 *     authenticationToken (or token) cookie, or Basic credentials, never
 *     both (400); a token it does not know - wrong, or expired and
 *     forgotten - is 401 with WWW-Authenticate: Basic realm="xo";
 *   - RBAC (middlewares/acl.middleware.mts, @xen-orchestra/acl): an
 *     administrator may do anything; anyone else only what an allow
 *     privilege of theirs covers ("shutdown" covers "shutdown:clean", "*"
 *     every action) and no deny privilege takes away; a refused action is
 *     403 {"error": "not enough privileges", "data": {"missingPrivileges":
 *     [{objectId, action, resource}]}}; a list leaves out what the user may
 *     not read, without refusing; the role templates are xo-server's own
 *     (xo-mixins/acls-v2/template-roles.mjs);
 *   - lists (abstract-classes/base-controller.mts): filter in
 *     complex-matcher's syntax on the raw objects, then the privilege
 *     check, then limit; no fields lists paths, fields=* whole objects,
 *     fields=a,b those properties - each with its href;
 *   - /users/me is a 307 to /users/<id> (users/user.middleware.mts), and
 *     /users/<id>/acl-privileges the user's effective privileges;
 *   - an action (base-controller createAction) is a task: 202
 *     {"taskId"} with Location: /rest/v0/tasks/<id>; the task is pending,
 *     then success or failure (with XAPI's error as its result), and the
 *     action takes effect when it ends;
 *   - errors as generic-error-handler.middleware.mts writes them:
 *     {"error": message, "data": ...}, 404 for no such object.
 *
 * Its complex-matcher is written here from complex-matcher's own source,
 * independently of the policy's parser, so a filter the policy lets
 * through is evaluated as Xen Orchestra would evaluate it.
 *
 * The same handler answers the executor's injected transport (handle) and
 * a real HTTPS server (listen), so the real transport is tested against
 * it too.
 */

export interface FakeXoPrivilege {
  action: string;
  resource: string;
  effect: "allow" | "deny";
  selector?: string | undefined;
}

// xo-server's "Read only" template role (REAL_ONLY_ALL), privilege for privilege.
export const XO_READ_ONLY_ROLE: ReadonlyArray<FakeXoPrivilege> = [
  "sr",
  "vdi",
  "vdi-snapshot",
  "vdi-unmanaged",
  "vbd",
  "vgpu",
  "vgpuType",
  "vm",
  "vm-template",
  "vm-snapshot",
  "vm-controller",
  "vif",
  "vtpm",
  "network",
  "pif",
  "host",
  "pbd",
  "pool",
  "message",
  "pci",
  "pgpu",
  "sm",
  "acl-privilege",
  "acl-role",
  "alarm",
  "backup-archive",
  "backup-job",
  "backup-log",
  "backup-repository",
  "gpuGroup",
  "group",
  "proxy",
  "restore-log",
  "schedule",
  "server",
  "task",
  "user",
].map((resource: string): FakeXoPrivilege => {
  return { action: "read", resource, effect: "allow" };
});

// xo-server's "VMs power state manager" template role.
export const XO_VMS_POWER_STATE_MANAGER_ROLE: ReadonlyArray<FakeXoPrivilege> = [
  "start",
  "shutdown",
  "reboot",
  "pause",
  "suspend",
  "resume",
  "unpause",
].map((action: string): FakeXoPrivilege => {
  return { action, resource: "vm", effect: "allow" };
});

/*
 * The role the XCP-ng Agent's README has the fix token's user hold: the
 * power state manager's privileges, and the few others fixes use.
 */
export const XCP_NG_FIXES_ROLE: ReadonlyArray<FakeXoPrivilege> = [
  ...XO_VMS_POWER_STATE_MANAGER_ROLE,
  { action: "snapshot", resource: "vm", effect: "allow" },
  { action: "migrate-send", resource: "vm", effect: "allow" },
  { action: "migrate-receive", resource: "host", effect: "allow" },
  { action: "allow-vm", resource: "host", effect: "allow" },
  { action: "enable", resource: "host", effect: "allow" },
  { action: "restart-toolstack", resource: "host", effect: "allow" },
  { action: "plug", resource: "pbd", effect: "allow" },
  { action: "run", resource: "schedule", effect: "allow" },
];

export interface FakeXoUser {
  id: string;
  name: string;
  email?: string | undefined;
  permission: "admin" | "none";
  privileges: ReadonlyArray<FakeXoPrivilege>;
}

// The tokens of the lab's users: 43 characters of base64url, as Xen Orchestra makes them.
export const READ_TOKEN: string = "rD0nLy-Tok3nXo4AiAgentReadsWithThis_123456";
export const FIX_TOKEN: string = "fIx3s-Tok3nXo4AiAgentChangesWithThis_98765";
export const ADMIN_TOKEN: string = "aDm1n-Tok3nXoAdministratorCanDoAnythin_000";
export const POWER_TOKEN: string = "pOw3r-Tok3nXoPowerStateManagerOnlyHere_111";
export const MIXED_TOKEN: string = "m1Xed-Tok3nXoReadOnlyPlusVmStartRoles_2222";
export const SECOND_READ_TOKEN: string =
  "rEad2-Tok3nXoAnotherReadOnlyUsersToken_333";
export const PROD_ONLY_READ_TOKEN: string =
  "pR0dO-Tok3nXoReadsOnlyTheProductionPool_44";

export const READ_USER_ID: string = "722d17b9-699b-49d2-8193-be1ac573d3de";
export const FIX_USER_ID: string = "088124f3-41b6-4258-9653-6eedc7b46111";

export function labUsers(): Array<{ token: string; user: FakeXoUser }> {
  return [
    {
      token: READ_TOKEN,
      user: {
        id: READ_USER_ID,
        name: "oneuptime-ai-read",
        permission: "none",
        privileges: XO_READ_ONLY_ROLE,
      },
    },
    {
      token: FIX_TOKEN,
      user: {
        id: FIX_USER_ID,
        name: "oneuptime-ai-fixes",
        permission: "none",
        privileges: [...XO_READ_ONLY_ROLE, ...XCP_NG_FIXES_ROLE],
      },
    },
    {
      token: ADMIN_TOKEN,
      user: {
        id: "a8715f02-20e7-4881-8b02-28ce2260c39d",
        name: "admin@admin.net",
        email: "admin@admin.net",
        permission: "admin",
        privileges: [],
      },
    },
    {
      token: POWER_TOKEN,
      user: {
        id: "b8715f02-20e7-4881-8b02-28ce2260c39e",
        name: "power-operator",
        permission: "none",
        privileges: [...XO_READ_ONLY_ROLE, ...XO_VMS_POWER_STATE_MANAGER_ROLE],
      },
    },
    {
      token: MIXED_TOKEN,
      user: {
        id: "c8715f02-20e7-4881-8b02-28ce2260c39f",
        name: "read-and-start",
        permission: "none",
        privileges: [
          ...XO_READ_ONLY_ROLE,
          { action: "start", resource: "vm", effect: "allow" },
        ],
      },
    },
    {
      token: SECOND_READ_TOKEN,
      user: {
        id: "d8715f02-20e7-4881-8b02-28ce2260c3a0",
        name: "another-read-only-user",
        permission: "none",
        privileges: XO_READ_ONLY_ROLE,
      },
    },
    {
      token: PROD_ONLY_READ_TOKEN,
      user: {
        id: "e8715f02-20e7-4881-8b02-28ce2260c3a1",
        name: "production-reader",
        permission: "none",
        // Read only, kept to the Production pool by a selector.
        privileges: XO_READ_ONLY_ROLE.map(
          (privilege: FakeXoPrivilege): FakeXoPrivilege => {
            return { ...privilege, selector: `$pool:${PROD_POOL}` };
          },
        ),
      },
    },
  ];
}

// ---- complex-matcher, from its source ---------------------------------------

type CmNode = { match: (value: unknown) => boolean };

const CM_WHITESPACE: RegExp = /\s/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function some(value: unknown, match: (item: unknown) => boolean): boolean {
  if (Array.isArray(value)) {
    return value.some(match);
  }

  if (isPlainObject(value)) {
    return Object.values(value).some(match);
  }

  return false;
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function isRaw(ch: string): boolean {
  return (
    (ch >= "0" && ch <= "9") ||
    ch === "_" ||
    ch === "-" ||
    ch === "." ||
    ch === "$" ||
    !(ch === ch.toUpperCase() && ch === ch.toLowerCase())
  );
}

class CmParser {
  private pos: number = 0;

  public constructor(private readonly input: string) {}

  public parse(): CmNode {
    this.ws();
    const terms: Array<CmNode> = [];

    while (this.pos < this.input.length) {
      const term: CmNode | null = this.term();

      if (!term) {
        throw new Error(`parse error at position ${this.pos}`);
      }

      terms.push(term);
    }

    return {
      match: (value: unknown): boolean => {
        return terms.every((term: CmNode): boolean => {
          return term.match(value);
        });
      },
    };
  }

  private ws(): void {
    while (
      this.pos < this.input.length &&
      CM_WHITESPACE.test(this.input[this.pos]!)
    ) {
      this.pos++;
    }
  }

  private raw(allowStar: boolean): string {
    let value: string = "";

    while (
      this.pos < this.input.length &&
      (isRaw(this.input[this.pos]!) ||
        (allowStar && this.input[this.pos] === "*"))
    ) {
      value += this.input[this.pos++];
    }

    return value;
  }

  private quoted(): string | null {
    if (this.input[this.pos] !== '"') {
      return null;
    }

    this.pos++;
    let value: string = "";

    while (this.pos < this.input.length) {
      let ch: string = this.input[this.pos++]!;

      if (ch === '"') {
        return value;
      }

      if (ch === "\\") {
        ch = this.input[this.pos++] || "";
      }

      value += ch;
    }

    return value;
  }

  private terms(): Array<CmNode> | null {
    const terms: Array<CmNode> = [];

    for (;;) {
      const term: CmNode | null = this.term();

      if (!term) {
        break;
      }

      terms.push(term);
    }

    return terms.length > 0 ? terms : null;
  }

  private term(): CmNode | null {
    const start: number = this.pos;
    const ch: string = this.input[this.pos] || "";

    if (ch === "(") {
      this.pos++;
      this.ws();
      const terms: Array<CmNode> | null = this.terms();

      if (terms && this.input[this.pos] === ")") {
        this.pos++;
        this.ws();
        return {
          match: (value: unknown): boolean => {
            return terms.every((term: CmNode): boolean => {
              return term.match(value);
            });
          },
        };
      }

      this.pos = start;
    }

    if (ch === "|") {
      this.pos++;
      this.ws();

      if (this.input[this.pos] === "(") {
        this.pos++;
        this.ws();
        const terms: Array<CmNode> | null = this.terms();

        if (terms && this.input[this.pos] === ")") {
          this.pos++;
          this.ws();
          return {
            match: (value: unknown): boolean => {
              return terms.some((term: CmNode): boolean => {
                return term.match(value);
              });
            },
          };
        }
      }

      this.pos = start;
    }

    if (ch === "!") {
      this.pos++;
      this.ws();
      const child: CmNode | null = this.term();

      if (child) {
        return {
          match: (value: unknown): boolean => {
            return !child.match(value);
          },
        };
      }

      this.pos = start;
    }

    if (ch === "<" || ch === ">") {
      let operator: string = ch;
      this.pos++;

      if (this.input[this.pos] === "=") {
        operator += "=";
        this.pos++;
      }

      const raw: string = this.raw(false);

      if (raw) {
        const limit: number = Number(raw);
        this.ws();
        return {
          match: (value: unknown): boolean => {
            const n: number = value as number;
            return operator === ">"
              ? n > limit
              : operator === ">="
                ? n >= limit
                : operator === "<"
                  ? n < limit
                  : n <= limit;
          },
        };
      }

      this.pos = start;
    }

    const name: string | null = this.quoted() ?? (this.raw(false) || null);

    if (name !== null) {
      this.ws();

      if (this.input[this.pos] === ":") {
        this.pos++;
        this.ws();
        const child: CmNode | null = this.term();

        if (child) {
          return {
            match: (value: unknown): boolean => {
              return (
                value !== null &&
                value !== undefined &&
                child.match((value as Record<string, unknown>)[name])
              );
            },
          };
        }
      }
    }

    this.pos = start;

    const truthy: string | null = this.quoted() ?? (this.raw(false) || null);

    if (truthy !== null && this.input[this.pos] === "?") {
      this.pos++;
      this.ws();
      return {
        match: (value: unknown): boolean => {
          return (
            value !== null &&
            value !== undefined &&
            Boolean((value as Record<string, unknown>)[truthy])
          );
        },
      };
    }

    this.pos = start;

    const quoted: string | null = this.quoted();

    if (quoted !== null) {
      this.ws();
      return stringNode(quoted);
    }

    if (this.input[this.pos] === "/") {
      this.pos++;
      let pattern: string = "";
      let escaped: boolean = false;
      let c: string = "";

      while (this.pos < this.input.length) {
        c = this.input[this.pos++]!;

        if (c === "/" && !escaped) {
          break;
        }

        escaped = c === "\\";
        pattern += c;
      }

      let flags: string = "";

      if (this.input[this.pos] === "i") {
        flags = "i";
        this.pos++;
      }

      const re: RegExp = new RegExp(pattern, flags);
      this.ws();
      const match: (value: unknown) => boolean = (value: unknown): boolean => {
        return typeof value === "string" ? re.test(value) : some(value, match);
      };
      return { match };
    }

    const word: string = this.raw(true);

    if (word) {
      this.ws();

      if (word.includes("*")) {
        const re: RegExp = new RegExp(
          word.split("*").map(escapeRegExp).join(".*"),
          "i",
        );
        const match: (value: unknown) => boolean = (
          value: unknown,
        ): boolean => {
          return typeof value === "string"
            ? re.test(value)
            : some(value, match);
        };
        return { match };
      }

      const asNumber: number = Number(word);

      if (!Number.isNaN(asNumber)) {
        const lower: string = word.toLowerCase();
        const match: (value: unknown) => boolean = (
          value: unknown,
        ): boolean => {
          return (
            value === asNumber ||
            (typeof value === "string"
              ? value.toLowerCase().includes(lower)
              : some(value, match))
          );
        };
        return { match };
      }

      return stringNode(word);
    }

    this.pos = start;
    return null;
  }
}

function stringNode(text: string): CmNode {
  const lower: string = text.toLowerCase();
  const match: (value: unknown) => boolean = (value: unknown): boolean => {
    return typeof value === "string"
      ? value.toLowerCase().includes(lower)
      : some(value, match);
  };

  return { match };
}

export function complexMatcher(filter: string): (value: unknown) => boolean {
  const node: CmNode = new CmParser(filter).parse();

  return (value: unknown): boolean => {
    return node.match(value);
  };
}

// ---- RBAC, as @xen-orchestra/acl checks it ----------------------------------

function covers(privilegeAction: string, action: string): boolean {
  return (
    privilegeAction === "*" ||
    privilegeAction === action ||
    action.startsWith(`${privilegeAction}:`)
  );
}

export function hasPrivilegeOn(
  user: FakeXoUser,
  resource: string,
  action: string,
  object: unknown,
): boolean {
  if (user.permission === "admin") {
    return true;
  }

  const applies: (privilege: FakeXoPrivilege) => boolean = (
    privilege: FakeXoPrivilege,
  ): boolean => {
    return (
      privilege.resource === resource &&
      covers(privilege.action, action) &&
      (!privilege.selector || complexMatcher(privilege.selector)(object))
    );
  };

  const allowed: boolean = user.privileges.some(
    (privilege: FakeXoPrivilege): boolean => {
      return privilege.effect === "allow" && applies(privilege);
    },
  );
  const denied: boolean = user.privileges.some(
    (privilege: FakeXoPrivilege): boolean => {
      return privilege.effect === "deny" && applies(privilege);
    },
  );

  return allowed && !denied;
}

// ---- The fake --------------------------------------------------------------------

export interface FakeXoRequest {
  method: string;
  // Under /rest/v0, without the query string: "/vms".
  path: string;
  query: Record<string, string>;
  // Which lab token was sent, by name ("read", "fix", ...), "none" or "unknown".
  token: string;
  body: string | null;
  headers: Record<string, string>;
}

interface FakeXoAnswer {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// A privilege an action needs on one object.
interface NeededPrivilege {
  resource: string;
  action: string;
  objectId: string;
}

// An action and what it takes, keyed "<collection> <action>".
interface FakeXoAction {
  resource: string;
  privileges: (body: Record<string, unknown>) => Array<NeededPrivilege>;
  // XAPI's refusal for the object as it is, or null; and what it does.
  check: (
    object: XoObject,
    body: Record<string, unknown>,
    fake: FakeXenOrchestra,
  ) => string | null;
  apply: (
    object: XoObject,
    body: Record<string, unknown>,
    fake: FakeXenOrchestra,
  ) => unknown;
  name: string;
}

const COLLECTION_TYPES: Readonly<Record<string, string>> = {
  pools: "pool",
  hosts: "host",
  vms: "VM",
  "vm-controllers": "VM-controller",
  srs: "SR",
  pbds: "PBD",
  vdis: "VDI",
  alarms: "message",
  messages: "message",
  tasks: "task",
  "backup-jobs": "backup-job",
  "backup-logs": "backup-log",
  schedules: "schedule",
};

const ACL_RESOURCES: Readonly<Record<string, string>> = {
  pools: "pool",
  hosts: "host",
  vms: "vm",
  "vm-controllers": "vm-controller",
  srs: "sr",
  pbds: "pbd",
  vdis: "vdi",
  alarms: "alarm",
  messages: "message",
  tasks: "task",
  "backup-jobs": "backup-job",
  "backup-logs": "backup-log",
  schedules: "schedule",
};

function badPowerState(
  object: XoObject,
  expected: Array<string>,
): string | null {
  return expected.includes(String(object["power_state"]))
    ? null
    : `VM_BAD_POWER_STATE(OpaqueRef:${String(object["id"]).slice(0, 8)}, ${expected
        .join("|")
        .toLowerCase()}, ${String(object["power_state"]).toLowerCase()})`;
}

function vmAction(
  action: string,
  from: Array<string>,
  to: string | null,
): FakeXoAction {
  return {
    resource: "vm",
    name: `REST API: ${action.replace(/_/g, " ")} VM`,
    privileges: () => {
      return [];
    },
    check: (object: XoObject): string | null => {
      return badPowerState(object, from);
    },
    apply: (object: XoObject): unknown => {
      if (to) {
        object["power_state"] = to;
        object["$container"] =
          to === "Halted" || to === "Suspended"
            ? object["$pool"]
            : object["$container"] === object["$pool"]
              ? HOST_PROD_1
              : object["$container"];
      }

      return undefined;
    },
  };
}

export class FakeXenOrchestra {
  public readonly requests: Array<FakeXoRequest> = [];
  public readonly objects: Map<string, Array<XoObject>> = new Map<
    string,
    Array<XoObject>
  >();
  public readonly users: Map<string, FakeXoUser> = new Map<
    string,
    FakeXoUser
  >();
  public readonly tokens: Map<string, string> = new Map<string, string>();
  // GETs of a pending task before it ends.
  public pollsUntilDone: number = 1;
  // The next action's task fails with this XAPI error.
  public failNextTaskWith: { code: string; message: string } | null = null;
  // Called first with every request: an answer here replaces the fake's.
  public intercept:
    | ((request: FakeXoRequest) => FakeXoAnswer | null | undefined)
    | null = null;
  private taskCounter: number = 0;
  private readonly pendingTasks: Map<
    string,
    { polls: number; finish: () => void }
  > = new Map();

  public constructor() {
    this.objects.set("pools", labPools());
    this.objects.set("hosts", labHosts());
    this.objects.set("vms", labVms());
    this.objects.set("vm-controllers", labVmControllers());
    this.objects.set("srs", labSrs());
    this.objects.set("pbds", labPbds());
    this.objects.set("vdis", labVdis());
    this.objects.set("messages", labMessages());
    this.objects.set("tasks", labTasks());
    this.objects.set("backup-jobs", labBackupJobs());
    this.objects.set("backup-logs", labBackupLogs());
    this.objects.set("schedules", labSchedules());

    for (const { token, user } of labUsers()) {
      this.addUser(token, user);
    }
  }

  public addUser(token: string, user: FakeXoUser): void {
    this.users.set(user.id, user);
    this.tokens.set(token, user.id);
  }

  public find(collection: string, id: string): XoObject | undefined {
    return (this.list(collection) || []).find((object: XoObject): boolean => {
      return object["id"] === id;
    });
  }

  // A collection's objects (alarms are the messages named ALARM).
  public list(collection: string): Array<XoObject> | undefined {
    if (collection === "alarms") {
      return (this.objects.get("messages") || []).filter(
        (message: XoObject): boolean => {
          return message["name"] === "ALARM";
        },
      );
    }

    if (collection === "messages") {
      return (this.objects.get("messages") || []).filter(
        (message: XoObject): boolean => {
          return message["name"] !== "ALARM";
        },
      );
    }

    return this.objects.get(collection);
  }

  // The requests that reached the fake for this path (and method).
  public sent(method: string, path: string): Array<FakeXoRequest> {
    return this.requests.filter((request: FakeXoRequest): boolean => {
      return request.method === method && request.path === path;
    });
  }

  // The changes that reached it: every request but a GET.
  public changes(): Array<FakeXoRequest> {
    return this.requests.filter((request: FakeXoRequest): boolean => {
      return request.method !== "GET";
    });
  }

  private tokenName(token: string | null): string {
    if (token === null) {
      return "none";
    }

    const names: Record<string, string> = {
      [READ_TOKEN]: "read",
      [FIX_TOKEN]: "fix",
      [ADMIN_TOKEN]: "admin",
      [POWER_TOKEN]: "power",
      [MIXED_TOKEN]: "mixed",
      [SECOND_READ_TOKEN]: "second-read",
      [PROD_ONLY_READ_TOKEN]: "prod-only-read",
    };

    return names[token] || "unknown";
  }

  // The executor's transport, answered by this fake.
  public readonly transport: (
    request: XoHttpRequest,
  ) => Promise<XoHttpResponse> = async (
    request: XoHttpRequest,
  ): Promise<XoHttpResponse> => {
    const answer: FakeXoAnswer = this.handle({
      method: request.method,
      url: request.path,
      headers: request.headers,
      body: request.body,
    });

    return {
      statusCode: answer.statusCode,
      statusMessage: http.STATUS_CODES[answer.statusCode] || "",
      location: answer.headers["Location"] || null,
      contentType: answer.headers["Content-Type"] || null,
      body: answer.body,
      truncated: false,
    };
  };

  public handle(data: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string | null;
  }): FakeXoAnswer {
    const url: URL = new URL(data.url, "https://xo.lab.example");
    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(data.headers)) {
      if (typeof value === "string") {
        headers[name.toLowerCase()] = value;
      }
    }

    const cookie: string = headers["cookie"] || "";
    const cookieToken: RegExpMatchArray | null = cookie.match(
      /(?:^|;\s*)(?:authenticationToken|token)=([^;]*)/,
    );
    const token: string | null = cookieToken ? cookieToken[1] || "" : null;
    const query: Record<string, string> = {};

    url.searchParams.forEach((value: string, name: string): void => {
      query[name] = value;
    });

    const path: string = url.pathname.startsWith("/rest/v0")
      ? url.pathname.slice("/rest/v0".length) || "/"
      : url.pathname;
    const request: FakeXoRequest = {
      method: data.method,
      path,
      query,
      token: this.tokenName(token),
      body: data.body,
      headers,
    };

    this.requests.push(request);

    const intercepted: FakeXoAnswer | null | undefined = this.intercept
      ? this.intercept(request)
      : null;

    if (intercepted) {
      return intercepted;
    }

    if (!url.pathname.startsWith("/rest/v0")) {
      return html(404, `Cannot ${data.method} ${url.pathname}`);
    }

    if (token !== null && headers["authorization"]) {
      return json(400, {
        error:
          "Having multiple authentication methods is not supported, please choose one",
      });
    }

    const userId: string | undefined =
      token === null ? undefined : this.tokens.get(token);
    const user: FakeXoUser | undefined =
      userId === undefined ? undefined : this.users.get(userId);

    if (!user) {
      return {
        statusCode: 401,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "WWW-Authenticate": 'Basic realm="xo"',
        },
        body: JSON.stringify({ error: "invalid credentials" }),
      };
    }

    try {
      return this.route(request, user);
    } catch (err: unknown) {
      return json(500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private route(request: FakeXoRequest, user: FakeXoUser): FakeXoAnswer {
    const segments: Array<string> = request.path.split("/").filter(Boolean);
    const collection: string = segments[0] || "";

    if (collection === "users") {
      return this.routeUsers(request, user, segments);
    }

    if (request.method === "GET") {
      return this.routeGet(request, user, segments);
    }

    if (request.method === "POST" && segments[2] === "actions") {
      return this.routeAction(request, user, segments);
    }

    if (request.method === "DELETE" && segments.length === 2) {
      return this.routeChange(user, collection, segments[1] || "", "delete");
    }

    if (request.method === "PATCH" && segments.length === 2) {
      return this.routeChange(user, collection, segments[1] || "", "update");
    }

    if (request.method === "PUT" && segments[2] === "tags") {
      return this.routeChange(
        user,
        collection,
        segments[1] || "",
        "update:tags",
      );
    }

    return html(404, `Cannot ${request.method} /rest/v0${request.path}`);
  }

  private routeUsers(
    request: FakeXoRequest,
    user: FakeXoUser,
    segments: Array<string>,
  ): FakeXoAnswer {
    if (segments[1] === "me") {
      const rest: string = segments.slice(2).join("/");

      return {
        statusCode: 307,
        headers: {
          Location: `/rest/v0/users/${user.id}${rest ? `/${rest}` : ""}`,
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: `Temporary Redirect. Redirecting to /rest/v0/users/${user.id}`,
      };
    }

    const target: FakeXoUser | undefined = this.users.get(segments[1] || "");

    if (!target) {
      return json(404, { error: `no such user ${segments[1]}` });
    }

    if (
      target.id !== user.id &&
      !hasPrivilegeOn(user, "user", "read", target)
    ) {
      return forbidden([
        { objectId: target.id, action: "read", resource: "user" },
      ]);
    }

    if (request.method === "GET" && segments.length === 2) {
      return json(200, {
        id: target.id,
        name: target.name,
        email: target.email,
        permission: target.permission,
        pw_hash: "***obfuscated***",
        groups: [],
        preferences: {},
      });
    }

    if (request.method === "GET" && segments[2] === "acl-privileges") {
      const fields: Array<string> = (request.query["fields"] || "").split(",");

      return json(
        200,
        target.privileges.map((privilege: FakeXoPrivilege, index: number) => {
          const full: Record<string, unknown> = {
            id: `${target.id.slice(0, 8)}-privilege-${index}`,
            ...privilege,
            href: `/rest/v0/acl-privileges/${target.id.slice(0, 8)}-privilege-${index}`,
          };

          return request.query["fields"]
            ? Object.fromEntries(
                Object.entries(full).filter(([key]: [string, unknown]) => {
                  return fields.includes(key) || key === "href";
                }),
              )
            : full["href"];
        }),
      );
    }

    return html(404, `Cannot ${request.method} /rest/v0${request.path}`);
  }

  private sendObjects(
    request: FakeXoRequest,
    user: FakeXoUser,
    objects: Array<XoObject>,
    resource: string,
    hrefBase: string,
  ): FakeXoAnswer {
    let selected: Array<XoObject> = objects;
    const filter: string | undefined = request.query["filter"];

    if (filter !== undefined) {
      let predicate: (value: unknown) => boolean;

      try {
        predicate = complexMatcher(filter);
      } catch (err: unknown) {
        return json(400, {
          error: err instanceof Error ? err.message : String(err),
          data: { stringToParse: filter },
        });
      }

      selected = selected.filter(predicate);
    }

    selected = selected.filter((object: XoObject): boolean => {
      return hasPrivilegeOn(user, resource, "read", object);
    });

    const limit: number = request.query["limit"]
      ? Number(request.query["limit"])
      : Infinity;

    selected = selected.slice(0, limit);

    const fields: string | undefined = request.query["fields"];

    return json(
      200,
      selected.map((object: XoObject): unknown => {
        const href: string = `/rest/v0/${hrefBase}/${String(object["id"])}`;

        if (fields === "*") {
          return { ...object, href };
        }

        if (typeof fields === "string") {
          const picked: Record<string, unknown> = {};

          for (const field of fields.split(",")) {
            const value: unknown = field
              .split(".")
              .reduce((current: unknown, key: string): unknown => {
                return isPlainObject(current) ? current[key] : undefined;
              }, object);

            if (value !== undefined) {
              picked[field] = value;
            }
          }

          return { ...picked, href };
        }

        return href;
      }),
    );
  }

  private routeGet(
    request: FakeXoRequest,
    user: FakeXoUser,
    segments: Array<string>,
  ): FakeXoAnswer {
    const collection: string = segments[0] || "";
    const objects: Array<XoObject> | undefined = this.list(collection);
    const resource: string | undefined = ACL_RESOURCES[collection];

    if (!objects || !resource) {
      return html(404, `Cannot GET /rest/v0${request.path}`);
    }

    if (segments.length === 1) {
      return this.sendObjects(request, user, objects, resource, collection);
    }

    const id: string = segments[1] || "";

    // Reading a pending task moves it on: it ends after pollsUntilDone reads.
    if (collection === "tasks" && segments.length === 2) {
      this.advanceTask(id);
    }

    const object: XoObject | undefined = this.find(collection, id);

    if (!object) {
      return json(404, {
        error: `no such ${COLLECTION_TYPES[collection] || collection} ${id}`,
        data: { id, type: COLLECTION_TYPES[collection] || collection },
      });
    }

    if (!hasPrivilegeOn(user, resource, "read", object)) {
      return forbidden([{ objectId: id, action: "read", resource }]);
    }

    if (segments.length === 2) {
      return json(200, object);
    }

    const sub: string = segments[2] || "";
    const uuid: string = String(object["uuid"] || object["id"]);

    if (sub === "alarms" || sub === "messages") {
      return this.sendObjects(
        request,
        user,
        (this.list(sub) || []).filter((message: XoObject): boolean => {
          return message["$object"] === uuid;
        }),
        sub === "alarms" ? "alarm" : "message",
        sub,
      );
    }

    if (sub === "tasks") {
      return this.sendObjects(
        request,
        user,
        (this.list("tasks") || []).filter((task: XoObject): boolean => {
          const properties: unknown = task["properties"];

          return (
            isPlainObject(properties) && properties["objectId"] === object["id"]
          );
        }),
        "task",
        "tasks",
      );
    }

    if (sub === "vdis") {
      return this.sendObjects(
        request,
        user,
        (this.list("vdis") || []).filter((vdi: XoObject): boolean => {
          return String(vdi["name_label"]).startsWith(
            `${String(object["name_label"])} `,
          );
        }),
        "vdi",
        "vdis",
      );
    }

    if (sub === "stats") {
      return json(200, {
        endTimestamp: 1764111600,
        interval: request.query["granularity"] === "hours" ? 3600 : 5,
        stats: { cpus: { "0": [0.12, 0.31, 0.27] }, memory: [4294967296] },
      });
    }

    if (sub === "missing_patches") {
      return json(200, []);
    }

    if (sub === "dashboard") {
      return json(200, { hosts: { total: 3, running: 2 } });
    }

    if (sub === "backup-jobs") {
      return this.sendObjects(
        request,
        user,
        this.list("backup-jobs") || [],
        "backup-job",
        "backup-jobs",
      );
    }

    return html(404, `Cannot GET /rest/v0${request.path}`);
  }

  // A change the agent never makes: refused by RBAC first, as Xen Orchestra does.
  private routeChange(
    user: FakeXoUser,
    collection: string,
    id: string,
    action: string,
  ): FakeXoAnswer {
    const resource: string | undefined = ACL_RESOURCES[collection];
    const object: XoObject | undefined = this.find(collection, id);

    if (!resource || !object) {
      return json(404, { error: `no such ${collection} ${id}` });
    }

    if (!hasPrivilegeOn(user, resource, action, object)) {
      return forbidden([{ objectId: id, action, resource }]);
    }

    if (action === "delete") {
      this.objects.set(
        collection,
        (this.objects.get(collection) || []).filter((entry: XoObject) => {
          return entry !== object;
        }),
      );
    }

    return { statusCode: 204, headers: {}, body: "" };
  }

  private actions(): Readonly<Record<string, FakeXoAction>> {
    return {
      "vms start": vmAction("start", ["Halted"], "Running"),
      "vms resume": vmAction("resume", ["Suspended"], "Running"),
      "vms unpause": vmAction("unpause", ["Paused"], "Running"),
      "vms clean_reboot": vmAction("clean_reboot", ["Running"], null),
      "vms hard_reboot": vmAction("hard_reboot", ["Running", "Paused"], null),
      "vms clean_shutdown": vmAction("clean_shutdown", ["Running"], "Halted"),
      "vms hard_shutdown": vmAction(
        "hard_shutdown",
        ["Running", "Paused", "Suspended"],
        "Halted",
      ),
      "vms suspend": vmAction("suspend", ["Running"], "Suspended"),
      "vms pause": vmAction("pause", ["Running"], "Paused"),
      "vms snapshot": {
        resource: "vm",
        name: "REST API: snapshot VM",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (object: XoObject, body: Record<string, unknown>): unknown => {
          const snapshotId: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

          (object["snapshots"] as Array<string>).push(snapshotId);
          void body;
          return { id: snapshotId };
        },
      },
      "vms migrate": {
        resource: "vm",
        name: "REST API: Migrate VM",
        privileges: (body: Record<string, unknown>) => {
          return [
            {
              resource: "host",
              action: "migrate-receive",
              objectId: String(body["hostId"]),
            },
          ];
        },
        check: (
          object: XoObject,
          body: Record<string, unknown>,
          fake: FakeXenOrchestra,
        ): string | null => {
          const destination: XoObject | undefined = fake.find(
            "hosts",
            String(body["hostId"]),
          );

          if (!destination) {
            return `HANDLE_INVALID(host, ${String(body["hostId"])})`;
          }

          if (destination["power_state"] !== "Running") {
            return "HOST_OFFLINE";
          }

          return destination["$pool"] === object["$pool"]
            ? null
            : "VM_MIGRATE_FAILED(cross-pool migration needs a storage mapping)";
        },
        apply: (object: XoObject, body: Record<string, unknown>): unknown => {
          object["$container"] = String(body["hostId"]);
          return undefined;
        },
      },
      "vms clone": {
        resource: "vm",
        name: "REST API: clone VM",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (): unknown => {
          return { id: "cloned" };
        },
      },
      "vms revert_snapshot": {
        resource: "vm",
        name: "REST API: revert VM snapshot",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (): unknown => {
          return undefined;
        },
      },
      "pbds plug": {
        resource: "pbd",
        name: "REST API: plug pbd",
        privileges: () => {
          return [];
        },
        check: (
          object: XoObject,
          _body: Record<string, unknown>,
          fake: FakeXenOrchestra,
        ): string | null => {
          const hostObject: XoObject | undefined = fake.find(
            "hosts",
            String(object["host"]),
          );

          return hostObject && hostObject["power_state"] === "Running"
            ? null
            : "HOST_OFFLINE";
        },
        apply: (object: XoObject): unknown => {
          object["attached"] = true;
          return undefined;
        },
      },
      "pbds unplug": {
        resource: "pbd",
        name: "REST API: unplug pbd",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (object: XoObject): unknown => {
          object["attached"] = false;
          return undefined;
        },
      },
      "schedules run": {
        resource: "schedule",
        name: "REST API: run schedule",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (
          object: XoObject,
          _body: Record<string, unknown>,
          fake: FakeXenOrchestra,
        ): unknown => {
          (fake.objects.get("backup-logs") || []).push({
            id: "1764198000000",
            jobId: object["jobId"],
            jobName: "Nightly delta",
            scheduleId: object["id"],
            message: "backup",
            start: 1764198000000,
            end: 1764198300000,
            status: "success",
            data: { mode: "delta", reportWhen: "failure" },
          });
          return undefined;
        },
      },
      "hosts enable": {
        resource: "host",
        name: "REST API: enable host",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (object: XoObject): unknown => {
          object["enabled"] = true;
          return undefined;
        },
      },
      "hosts disable": {
        resource: "host",
        name: "REST API: disable host",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (object: XoObject): unknown => {
          object["enabled"] = false;
          return undefined;
        },
      },
      "hosts restart_toolstack": {
        resource: "host",
        name: "REST API: restart host's toolstack",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (): unknown => {
          return undefined;
        },
      },
      "hosts clean_shutdown": {
        resource: "host",
        name: "REST API: shutdown host",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (object: XoObject): unknown => {
          object["power_state"] = "Halted";
          return undefined;
        },
      },
      "pools rolling_reboot": {
        resource: "pool",
        name: "REST API: rolling reboot",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (): unknown => {
          return undefined;
        },
      },
      "pools emergency_shutdown": {
        resource: "pool",
        name: "REST API: emergency shutdown",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (): unknown => {
          return undefined;
        },
      },
      "srs forget": {
        resource: "sr",
        name: "REST API: forget SR",
        privileges: () => {
          return [];
        },
        check: (): string | null => {
          return null;
        },
        apply: (): unknown => {
          return undefined;
        },
      },
    };
  }

  // The RBAC action an action's route checks (acl middleware's privilege).
  private static aclAction(collection: string, action: string): string {
    const byRoute: Record<string, string> = {
      "vms start": "start",
      "vms resume": "resume",
      "vms unpause": "unpause",
      "vms clean_reboot": "reboot:clean",
      "vms hard_reboot": "reboot:hard",
      "vms clean_shutdown": "shutdown:clean",
      "vms hard_shutdown": "shutdown:hard",
      "vms suspend": "suspend",
      "vms pause": "pause",
      "vms snapshot": "snapshot",
      "vms migrate": "migrate-send",
      "vms clone": "clone",
      "vms revert_snapshot": "revert-snapshot",
      "pbds plug": "plug",
      "pbds unplug": "unplug",
      "schedules run": "run",
      "hosts enable": "enable",
      "hosts disable": "disable",
      "hosts restart_toolstack": "restart-toolstack",
      "hosts clean_shutdown": "shutdown:clean",
      "pools rolling_reboot": "rolling-reboot",
      "pools emergency_shutdown": "emergency-shutdown",
      "srs forget": "forget",
    };

    return byRoute[`${collection} ${action}`] || action;
  }

  private routeAction(
    request: FakeXoRequest,
    user: FakeXoUser,
    segments: Array<string>,
  ): FakeXoAnswer {
    const collection: string = segments[0] || "";
    const id: string = segments[1] || "";
    const actionName: string = segments[3] || "";
    const action: FakeXoAction | undefined =
      this.actions()[`${collection} ${actionName}`];

    if (!action || segments.length !== 4) {
      return html(404, `Cannot POST /rest/v0${request.path}`);
    }

    const object: XoObject | undefined = this.find(collection, id);

    if (!object) {
      return json(404, {
        error: `no such ${COLLECTION_TYPES[collection] || collection} ${id}`,
      });
    }

    let body: Record<string, unknown> = {};

    try {
      body = request.body
        ? (JSON.parse(request.body) as Record<string, unknown>)
        : {};
    } catch {
      return json(400, { error: "invalid JSON body" });
    }

    const needed: Array<NeededPrivilege> = [
      {
        resource: action.resource,
        action: FakeXenOrchestra.aclAction(collection, actionName),
        objectId: id,
      },
      ...action.privileges(body),
    ];
    const missing: Array<NeededPrivilege> = needed.filter(
      (privilege: NeededPrivilege): boolean => {
        const target: XoObject | undefined =
          privilege.objectId === id
            ? object
            : this.find(
                privilege.resource === "host" ? "hosts" : collection,
                privilege.objectId,
              );

        return !hasPrivilegeOn(
          user,
          privilege.resource,
          privilege.action,
          target,
        );
      },
    );

    if (missing.length > 0) {
      return forbidden(missing);
    }

    const taskId: string = `0mt${(++this.taskCounter).toString(36).padStart(6, "0")}`;
    const task: XoObject = {
      id: taskId,
      properties: {
        name: action.name,
        objectId: id,
        objectType: COLLECTION_TYPES[collection],
        type: "xo:rest-api:action",
        userId: user.id,
        args: body,
      },
      start: Date.parse("2026-11-26T10:00:00.000Z"),
      status: "pending",
    };

    (this.objects.get("tasks") || []).push(task);

    const forcedFailure: { code: string; message: string } | null =
      this.failNextTaskWith;
    this.failNextTaskWith = null;

    this.pendingTasks.set(taskId, {
      polls: 0,
      finish: (): void => {
        const refusal: string | null = forcedFailure
          ? forcedFailure.message
          : action.check(object, body, this);

        task["end"] = Date.parse("2026-11-26T10:00:05.000Z");
        task["updatedAt"] = task["end"];

        if (refusal) {
          task["status"] = "failure";
          task["result"] = {
            code: forcedFailure ? forcedFailure.code : refusal.split("(")[0],
            message: refusal,
            name: "XapiError",
          };
          return;
        }

        task["status"] = "success";
        task["result"] = action.apply(object, body, this);
      },
    });

    return {
      statusCode: 202,
      headers: {
        Location: `/rest/v0/tasks/${taskId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ taskId }),
    };
  }

  /*
   * A pending task ends after pollsUntilDone reads of it, as a XAPI call
   * does after a while.
   */
  public advanceTask(taskId: string): void {
    const pending: { polls: number; finish: () => void } | undefined =
      this.pendingTasks.get(taskId);

    if (!pending) {
      return;
    }

    pending.polls++;

    if (pending.polls >= this.pollsUntilDone) {
      this.pendingTasks.delete(taskId);
      pending.finish();
    }
  }

  // A real HTTPS server answering with this fake.
  public async listen(tlsOptions: {
    cert: string;
    key: string;
  }): Promise<{ port: number; close: () => Promise<void> }> {
    const sockets: Set<net.Socket> = new Set<net.Socket>();
    const server: https.Server = https.createServer(
      tlsOptions,
      (req: http.IncomingMessage, res: http.ServerResponse): void => {
        const chunks: Array<Buffer> = [];

        req.on("data", (chunk: Buffer): void => {
          chunks.push(chunk);
        });
        req.on("end", (): void => {
          const answer: FakeXoAnswer = this.handle({
            method: req.method || "GET",
            url: req.url || "/",
            headers: req.headers,
            body:
              chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : null,
          });

          res.writeHead(answer.statusCode, answer.headers);
          res.end(answer.body);
        });
      },
    );

    server.on("connection", (socket: net.Socket): void => {
      sockets.add(socket);
      socket.on("close", (): void => {
        sockets.delete(socket);
      });
    });

    const port: number = await new Promise<number>(
      (resolve: (port: number) => void): void => {
        server.listen(0, "127.0.0.1", (): void => {
          resolve((server.address() as net.AddressInfo).port);
        });
      },
    );

    return {
      port,
      close: (): Promise<void> => {
        for (const socket of sockets) {
          socket.destroy();
        }

        return new Promise<void>((resolve: () => void): void => {
          server.close((): void => {
            resolve();
          });
        });
      },
    };
  }
}

function json(statusCode: number, body: unknown): FakeXoAnswer {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function html(statusCode: number, text: string): FakeXoAnswer {
  return {
    statusCode,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Error</title></head>\n<body><pre>${text}</pre></body>\n</html>\n`,
  };
}

function forbidden(
  missing: Array<{ objectId: string; action: string; resource: string }>,
): FakeXoAnswer {
  return json(403, {
    error: "not enough privileges",
    data: { missingPrivileges: missing },
  });
}

// What the lab's pools and hosts are, for tests that name them.
export const LAB: Readonly<Record<string, string>> = {
  PROD_POOL,
  LAB_POOL,
  HOST_PROD_1,
  HOST_LAB_1,
  SCHEDULE_NIGHTLY,
};
