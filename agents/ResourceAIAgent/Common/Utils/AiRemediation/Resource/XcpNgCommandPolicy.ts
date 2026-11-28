/*
 * The xo-cli command policy: what OneUptime AI may ask the XCP-ng AI agent
 * to do on an XCP-ng pool, through the Xen Orchestra that manages it.
 *
 * There is no xo-cli binary in the agent. A command is written in the
 * grammar of xo-cli's REST mode, because that is Xen Orchestra's own
 * documented CLI and what models know -
 *
 *   xo-cli rest get <path> [name=value]...
 *   xo-cli rest post <path>/actions/<action> [name=value]...
 *
 * - and the agent turns it into ONE call to Xen Orchestra's REST API
 * (https://<Xen Orchestra>/rest/v0<path>): get is a GET with its
 * parameters as the query string, post is a POST with them as a JSON body,
 * as xo-cli 0.32 sends them. parseXcpNgCommand, exported below, is that
 * translation, and it is the SAME analysis this policy tiers: it only ever
 * returns a request for a command evaluateArgv does not deny, so there is
 * no second parser (and no real xo-cli) whose reading of the words could
 * differ from the one that was judged.
 *
 * Read from vatesfr/xen-orchestra on 26 November 2026 (master 750c74beb1e,
 * @xen-orchestra/rest-api 0.42.0, xo-server 5.214.0, xo-cli 0.32.5): the
 * REST controllers' routes, the complex-matcher grammar of `filter`, the
 * role templates (Read only, VMs power state manager) and xo-cli's own
 * argument handling.
 *
 * ---- Grammar ---------------------------------------------------------------
 *
 * A strict subset of what xo-cli accepts, so a command copied from Xen
 * Orchestra's documentation either works as written or is refused with a
 * reason that says what to write instead:
 *   - "rest" comes right after "xo-cli", then get or post. xo-cli's other
 *     commands (register, list-objects, watch, the JSON-RPC methods such as
 *     vm.start) and rest's patch, put and del are refused; so are its global
 *     flags (--url, --allowUnauthorized, --json) and --output / --input.
 *   - Exactly one path, written as xo-cli takes it: "vms",
 *     "vms/<uuid>/alarms", with or without a leading "/" or "/rest/v0/".
 *     It has no query string (?a=b), fragment, percent-encoding,
 *     whitespace, or empty, "." or ".." segment; a single trailing "/" is
 *     dropped. Every UUID is written in lower case, as Xen Orchestra shows
 *     it (two spellings of one object would compare as two targets).
 *   - Every parameter is one name=value word: a name of letters, digits
 *     and "_" (no dotted name, which xo-cli would turn into a nested
 *     object), a value that is not empty and does not start with "json:"
 *     (which xo-cli would parse as JSON). A word without "=" is refused, and
 *     so is a parameter given twice.
 *   - Parameters are checked per path against a closed list, and every
 *     value against its own rule. fields is a comma-separated list of
 *     property names (or *), limit a whole number, granularity one of
 *     seconds, minutes, hours, days, and filter Xen Orchestra's own filter
 *     syntax, parsed here with its grammar (complex-matcher) and refused
 *     when it would match on anything but named, harmless properties: a
 *     filter is evaluated on whole objects, so `filter=hunter2` or
 *     `filter=device_config:(password:/^h/)` would tell, object by object,
 *     whether a secret holds a value without ever printing it.
 *
 * ---- Tiers -----------------------------------------------------------------
 *
 * Read (get) is an ALLOWLIST of path shapes over the pool's own objects -
 * pools, hosts, VMs, control domains, snapshots, templates, storage
 * repositories, PBDs, virtual disks, VBDs, VIFs, PIFs, networks, alarms and
 * messages - and Xen Orchestra's records of the pool's work: tasks, backup
 * jobs, backup logs, restore logs and schedules. Xen Orchestra's own users,
 * groups, roles, privileges, tokens, servers, plugins, proxies and backup
 * repositories are Denied (their records hold the pool's XAPI root user,
 * every token a user has and storage credentials), as are downloads
 * (exports, a host's logs and audit log) and the event stream.
 *
 * post is Denied except:
 *   SafeWrite   vms/<uuid>/actions/{start|resume|unpause} - one named VM,
 *               and shutting, suspending or pausing it again undoes it;
 *               pbds/<uuid>/actions/plug - re-attach a storage repository on
 *               one host, which unplugging undoes; schedules/<uuid>/
 *               actions/run - a backup job's run, as its schedule makes it.
 *   RiskyWrite  vms/<uuid>/actions/{clean_reboot|hard_reboot|clean_shutdown|
 *               hard_shutdown|suspend|pause|snapshot}, hosts/<uuid>/actions/
 *               enable.
 *   RiskyWrite + requiresHuman
 *               vms/<uuid>/actions/migrate hostId=<uuid> (within the pool:
 *               no storage, network or cross-pool mapping, no CPU check
 *               bypass) and hosts/<uuid>/actions/restart_toolstack - never
 *               unattended, whatever the mode.
 * Everything else is Denied with its reason: deleting, patching or putting
 * anything (VMs, disks, snapshots, storage repositories, configuration,
 * tags, HA), cloning or reverting a VM, unplugging storage, a host's
 * shutdown, reboot, evacuation, detach or forget, pool-wide actions,
 * imports and exports.
 *
 * Targets (what ONEUPTIME_AI_WRITE_TARGETS and the agent's protected
 * targets are compared with): "<kind>/<uuid>" - vm/<uuid>, pbd/<uuid>,
 * host/<uuid>, schedule/<uuid> - so an operator can allow vm/* and protect
 * the VM the agent runs in by its UUID alone.
 *
 * Pool scope: one agent serves one pool. A read of a collection of the
 * pool's objects carries scope "collection", and the agent adds
 * `$pool:<its pool>` to the filter (as Xen Orchestra's own per-object
 * routes add `$object:<uuid>`); a read of one object, or of what belongs to
 * it, carries the object, and the agent refuses to print one of another
 * pool. A change carries what it changes, and the agent refuses one to an
 * object of another pool.
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only,
 * nothing from Node. Total: evaluateArgv and parseXcpNgCommand never
 * throw, whatever they are handed.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { MAX_COMMAND_LENGTH_CHARS } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import {
  MAX_RESOURCE_COMMAND_TOKENS,
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
  globMatchesTarget,
  renderResourceDisplayCommand,
} from "./ResourceCommandPolicyCore";

export const XO_CLI_PROGRAM: string = "xo-cli";

// xo-cli's subcommand for Xen Orchestra's REST API.
export const XO_CLI_REST_COMMAND: string = "rest";

// Where Xen Orchestra serves its REST API.
export const XO_REST_API_BASE_PATH: string = "/rest/v0";

export type XenOrchestraApiMethod = "GET" | "POST";

// The longest path this policy reads.
export const MAX_XO_API_PATH_CHARS: number = 300;

// The longest filter, and how deeply its groups may nest.
export const MAX_XO_FILTER_CHARS: number = 500;
export const MAX_XO_FILTER_DEPTH: number = 12;

// The longest regular expression a filter may hold.
export const MAX_XO_FILTER_REGEX_CHARS: number = 128;

// The most fields one read names, and how long each may be.
export const MAX_XO_FIELDS: number = 40;
export const MAX_XO_FIELD_CHARS: number = 64;

// The most objects one read lists.
export const MAX_XO_LIMIT: number = 5000;

// The longest snapshot name.
export const MAX_XO_SNAPSHOT_NAME_CHARS: number = 128;

/*
 * The collections of a pool's own objects (XAPI's), which carry `$pool`:
 * a read of one is kept to the agent's pool.
 */
export const XO_POOL_COLLECTIONS: ReadonlyArray<string> = [
  "pools",
  "hosts",
  "vms",
  "vm-controllers",
  "vm-snapshots",
  "vm-templates",
  "srs",
  "pbds",
  "vdis",
  "vdi-snapshots",
  "vbds",
  "vifs",
  "pifs",
  "networks",
  "alarms",
  "messages",
];

/*
 * Xen Orchestra's own records of the pool's work. They belong to Xen
 * Orchestra, not to a pool: a backup job may back up VMs of several pools.
 */
export const XO_OWN_COLLECTIONS: ReadonlyArray<string> = [
  "tasks",
  "backup-jobs",
  "backup-logs",
  "restore-logs",
  "schedules",
];

// The kinds of object a change targets, as "<kind>/<uuid>".
export type XcpNgTargetKind = "vm" | "pbd" | "host" | "schedule";

export const XCP_NG_TARGET_KINDS: ReadonlyArray<XcpNgTargetKind> = [
  "vm",
  "pbd",
  "host",
  "schedule",
];

const TARGET_KIND_BY_COLLECTION: Readonly<Record<string, XcpNgTargetKind>> = {
  vms: "vm",
  pbds: "pbd",
  hosts: "host",
  schedules: "schedule",
};

/*
 * How the agent keeps a read to its own pool:
 *   collection  a list of the pool's objects: `$pool:<pool>` is added to
 *               the filter;
 *   object      one object of the pool's (or what belongs to one: its
 *               alarms, stats, ...): it must be the agent's pool's, which
 *               the agent reads before it prints;
 *   none        Xen Orchestra's own records (tasks, backup jobs and logs,
 *               schedules).
 */
export type XenOrchestraPoolScope =
  | { kind: "collection" }
  | { kind: "object"; collection: string; id: string }
  | { kind: "none" };

/*
 * The state an object is in when a change has nothing left to do (a VM
 * already running), or must be in for the change to make sense (a VM to
 * resume must be suspended), read before the change.
 */
export interface XenOrchestraStateCheck {
  property: string;
  values: ReadonlyArray<string | boolean>;
}

// What a change acts on, for the agent's checks before it sends it.
export interface XenOrchestraChange {
  collection: "vms" | "pbds" | "hosts" | "schedules";
  id: string;
  action: string;
  // The object must be in the agent's pool (a schedule is Xen Orchestra's).
  mustBeInPool: boolean;
  // Another host the change involves: a migration's destination.
  destinationHostId: string | null;
  // The change has nothing to do when the object is already so.
  alreadyWhen: XenOrchestraStateCheck | null;
  // The change makes sense only when the object is so.
  requires: XenOrchestraStateCheck | null;
  // The privileges the fix token's user needs (Xen Orchestra's RBAC).
  privileges: ReadonlyArray<string>;
}

/*
 * The HTTPS call an xo-cli command becomes. Built only for a command the
 * policy does not deny.
 */
export interface XenOrchestraApiRequest {
  method: XenOrchestraApiMethod;
  /*
   * The canonical path under /rest/v0: starts with "/", no trailing "/",
   * every segment validated (letters, digits, "-", "_" and ".", so nothing
   * in it needs encoding).
   */
  path: string;
  // A GET's parameters, the query string, exactly as validated.
  query: Record<string, string>;
  // A POST's parameters, its JSON body (strings, as xo-cli sends them).
  body: Record<string, string> | null;
  scope: XenOrchestraPoolScope;
  // What a POST changes; null for a read.
  change: XenOrchestraChange | null;
}

export interface XcpNgCommandParseResult {
  // Set when the command may run.
  request?: XenOrchestraApiRequest | undefined;
  // Why it may not (the policy's Denied reason); set when it may not.
  errorMessage?: string | undefined;
}

// A word shown inside a refusal, cut so a huge argument cannot flood it.
function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

// ---- Values ------------------------------------------------------------------

interface XoValueRule {
  // What a valid value looks like, for refusals: "a whole number from 1 to 5000".
  expected: string;
  /*
   * Null when the value is valid, else why not: what it must be ("a whole
   * number from 1 to 5000"), or - for a rule that explains itself - a
   * sentence of its own.
   */
  check: (value: string) => string | null;
  // The problem check() returns is a sentence, not what the value must be.
  explainsItself?: boolean | undefined;
}

const UUID_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const UUID_ANY_CASE_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A task id, as Xen Orchestra makes them: "0mdd1basu".
const TASK_ID_REGEX: RegExp = /^[0-9a-z]{6,24}$/;

// A backup or restore log id: the time it started, in milliseconds.
const LOG_ID_REGEX: RegExp = /^[0-9]{10,16}$/;

const DECIMAL_REGEX: RegExp = /^(?:0|[1-9][0-9]{0,9})$/;

function integerRule(min: number, max: number): XoValueRule {
  const expected: string = `a whole number from ${min} to ${max}`;

  return {
    expected,
    check: (value: string): string | null => {
      if (!DECIMAL_REGEX.test(value)) {
        return expected;
      }

      const parsed: number = Number(value);

      return parsed >= min && parsed <= max ? null : expected;
    },
  };
}

function enumRule(values: ReadonlyArray<string>): XoValueRule {
  const expected: string = `one of ${values.join(", ")}`;

  return {
    expected,
    check: (value: string): string | null => {
      return values.includes(value) ? null : expected;
    },
  };
}

const UUID_RULE: XoValueRule = {
  expected: "a UUID in lower case, as Xen Orchestra shows it",
  check: (value: string): string | null => {
    if (UUID_REGEX.test(value)) {
      return null;
    }

    return UUID_ANY_CASE_REGEX.test(value)
      ? "a UUID in lower case, as Xen Orchestra shows it (write it in lower case)"
      : "a UUID in lower case, as Xen Orchestra shows it";
  },
};

const LIMIT_RULE: XoValueRule = integerRule(1, MAX_XO_LIMIT);

const GRANULARITY_RULE: XoValueRule = enumRule([
  "seconds",
  "minutes",
  "hours",
  "days",
]);

// A property name, or a path into one (memory.size), as lodash's pick reads it.
const FIELD_REGEX: RegExp = /^[$A-Za-z_][$A-Za-z0-9_-]*(?:\.[$A-Za-z0-9_-]+)*$/;

const FORBIDDEN_FIELD_SEGMENTS: ReadonlyArray<string> = [
  "__proto__",
  "prototype",
  "constructor",
];

const FIELDS_RULE: XoValueRule = {
  expected:
    "a comma-separated list of property names (fields=name_label,power_state), or * for whole objects",
  check: (value: string): string | null => {
    if (value === "*") {
      return null;
    }

    const fields: Array<string> = value.split(",");

    if (fields.length > MAX_XO_FIELDS) {
      return `at most ${MAX_XO_FIELDS} property names`;
    }

    for (const field of fields) {
      if (!field) {
        return "a comma-separated list of property names with no empty one (fields=name_label,power_state)";
      }

      if (field.length > MAX_XO_FIELD_CHARS) {
        return `property names of at most ${MAX_XO_FIELD_CHARS} characters`;
      }

      if (!FIELD_REGEX.test(field)) {
        return `property names of letters, digits, "_", "-" and "$", dotted for a property inside another (memory.size); "${shorten(field)}" is not one`;
      }

      if (
        field.split(".").some((segment: string): boolean => {
          return FORBIDDEN_FIELD_SEGMENTS.includes(segment);
        })
      ) {
        return `property names of the objects themselves; "${shorten(field)}" is not one`;
      }
    }

    return null;
  },
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_REGEX: RegExp = /[\u0000-\u001f\u007f]/;

const SNAPSHOT_NAME_RULE: XoValueRule = {
  expected: `a name of 1 to ${MAX_XO_SNAPSHOT_NAME_CHARS} characters`,
  check: (value: string): string | null => {
    if (
      value.length === 0 ||
      value.length > MAX_XO_SNAPSHOT_NAME_CHARS ||
      CONTROL_CHARACTER_REGEX.test(value)
    ) {
      return `a name of 1 to ${MAX_XO_SNAPSHOT_NAME_CHARS} characters with no control character`;
    }

    return null;
  },
};

// ---- Filters ------------------------------------------------------------------

/*
 * A filter as Xen Orchestra's complex-matcher parses it
 * (packages/complex-matcher/index.js): terms side by side are all required
 * (and), |( ... ) is any of them (or), ! negates, name:term matches a
 * property, name? tests that it is set, <N >N <=N >=N compare a number, and
 * a bare value - a word (with * as a wildcard), a "quoted string" or a
 * /regular expression/ - matches any string under where it stands: the
 * whole object at the top, a property's value under name:.
 */
export type XenOrchestraFilterNode =
  | { type: "and"; terms: Array<XenOrchestraFilterNode> }
  | { type: "or"; terms: Array<XenOrchestraFilterNode> }
  | { type: "not"; child: XenOrchestraFilterNode }
  | { type: "comparison"; operator: string; value: number }
  | { type: "property"; name: string; child: XenOrchestraFilterNode }
  | { type: "truthy"; name: string }
  | { type: "string"; value: string }
  | { type: "regex"; pattern: string; flags: string }
  | { type: "word"; value: string };

class FilterSyntaxError extends Error {}

interface FilterCursor {
  input: string;
  pos: number;
  depth: number;
}

// complex-matcher's raw string characters: digits, _ - . $ and cased letters.
function isRawStringCharacter(ch: string): boolean {
  return (
    (ch >= "0" && ch <= "9") ||
    ch === "_" ||
    ch === "-" ||
    ch === "." ||
    ch === "$" ||
    !(ch === ch.toUpperCase() && ch === ch.toLowerCase())
  );
}

const WHITESPACE_REGEX: RegExp = /\s/;

function skipWhitespace(cursor: FilterCursor): void {
  while (
    cursor.pos < cursor.input.length &&
    WHITESPACE_REGEX.test(cursor.input.charAt(cursor.pos))
  ) {
    cursor.pos++;
  }
}

function readRawString(cursor: FilterCursor, allowStar: boolean): string {
  let value: string = "";

  while (cursor.pos < cursor.input.length) {
    const ch: string = cursor.input.charAt(cursor.pos);

    if (!(isRawStringCharacter(ch) || (allowStar && ch === "*"))) {
      break;
    }

    value += ch;
    cursor.pos++;
  }

  return value;
}

/*
 * A "quoted string", null when there is none here. Stricter than
 * complex-matcher, which takes an unclosed quote to run to the end: that is
 * refused, never guessed at.
 */
function readQuotedString(cursor: FilterCursor): string | null {
  if (cursor.input.charAt(cursor.pos) !== '"') {
    return null;
  }

  let index: number = cursor.pos + 1;
  let value: string = "";

  while (index < cursor.input.length) {
    let ch: string = cursor.input.charAt(index++);

    if (ch === '"') {
      cursor.pos = index;
      return value;
    }

    if (ch === "\\") {
      if (index >= cursor.input.length) {
        break;
      }

      ch = cursor.input.charAt(index++);
    }

    value += ch;
  }

  throw new FilterSyntaxError("a quoted string is not closed");
}

// A back-reference (\1, \k<name>).
const BACK_REFERENCE_REGEX: RegExp = /\\[1-9]|\\k</;

// The last character of a quantifier, before a lazy "?".
const QUANTIFIER_END_REGEX: RegExp = /[*+?}]/;

// The first character of a quantifier, after a group.
const QUANTIFIER_START_REGEX: RegExp = /[*+{?]/;

/*
 * A regular expression that could take Xen Orchestra's server unbounded
 * time on a long string: a quantified group that itself holds a quantifier
 * ("(a+)+", "(\\w*\\s?)*"), or a back-reference.
 */
function describeUnsafeRegex(pattern: string): string | null {
  if (pattern.length > MAX_XO_FILTER_REGEX_CHARS) {
    return `a regular expression of at most ${MAX_XO_FILTER_REGEX_CHARS} characters`;
  }

  if (BACK_REFERENCE_REGEX.test(pattern)) {
    return "a regular expression without back-references";
  }

  const openings: Array<{ quantified: boolean }> = [];
  let escaped: boolean = false;
  let inClass: boolean = false;

  for (let i: number = 0; i < pattern.length; i++) {
    const ch: string = pattern.charAt(i);

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (inClass) {
      if (ch === "]") {
        inClass = false;
      }
      continue;
    }

    if (ch === "[") {
      inClass = true;
      continue;
    }

    if (ch === "(") {
      openings.push({ quantified: false });
      continue;
    }

    if (ch === "*" || ch === "+" || ch === "{" || ch === "?") {
      const previous: string = i > 0 ? pattern.charAt(i - 1) : "";

      // "(?:", "(?=", ... and a lazy "*?" are not quantifiers of their own.
      if (
        ch === "?" &&
        (previous === "(" || QUANTIFIER_END_REGEX.test(previous))
      ) {
        continue;
      }

      for (const opening of openings) {
        opening.quantified = true;
      }

      continue;
    }

    if (ch === ")") {
      const opening: { quantified: boolean } | undefined = openings.pop();
      const next: string = pattern.charAt(i + 1);

      if (opening && opening.quantified && QUANTIFIER_START_REGEX.test(next)) {
        return "a regular expression without a repeated group that repeats itself, such as (a+)+";
      }

      if (opening && opening.quantified) {
        // The group's quantifiers belong to the group around it too.
        for (const outer of openings) {
          outer.quantified = true;
        }
      }
    }
  }

  return null;
}

// A /regular expression/, null when there is none here.
function readRegex(cursor: FilterCursor): XenOrchestraFilterNode | null {
  if (cursor.input.charAt(cursor.pos) !== "/") {
    return null;
  }

  let index: number = cursor.pos + 1;
  let pattern: string = "";
  let escaped: boolean = false;
  let closed: boolean = false;

  // complex-matcher's own loop: a "/" after a backslash belongs to the pattern.
  while (index < cursor.input.length) {
    const ch: string = cursor.input.charAt(index++);

    if (ch === "/" && !escaped) {
      closed = true;
      break;
    }

    escaped = ch === "\\";
    pattern += ch;
  }

  if (!closed) {
    throw new FilterSyntaxError("a regular expression is not closed with /");
  }

  let flags: string = "";

  if (cursor.input.charAt(index) === "i") {
    flags = "i";
    index++;
  }

  const unsafe: string | null = describeUnsafeRegex(pattern);

  if (unsafe) {
    throw new FilterSyntaxError(`a filter may hold ${unsafe}`);
  }

  try {
    // Only to know Xen Orchestra will take it: it builds the same RegExp.
    new RegExp(pattern, flags);
  } catch {
    throw new FilterSyntaxError(
      `/${shorten(pattern)}/ is not a regular expression`,
    );
  }

  cursor.pos = index;

  return { type: "regex", pattern, flags };
}

// A property name: a "quoted string" or a raw string; null when there is none.
function readPropertyName(cursor: FilterCursor): string | null {
  const quoted: string | null = readQuotedString(cursor);

  if (quoted !== null) {
    return quoted;
  }

  const raw: string = readRawString(cursor, false);

  return raw ? raw : null;
}

// One or more terms, up to what is not a term; null when there is not one.
function readTerms(cursor: FilterCursor): Array<XenOrchestraFilterNode> | null {
  const terms: Array<XenOrchestraFilterNode> = [];

  for (;;) {
    const term: XenOrchestraFilterNode | null = readTerm(cursor);

    if (!term) {
      break;
    }

    terms.push(term);
  }

  return terms.length > 0 ? terms : null;
}

/*
 * One term, trying complex-matcher's alternatives in its order, each from
 * the same place; the whitespace after a term is consumed with it.
 */
function readTerm(cursor: FilterCursor): XenOrchestraFilterNode | null {
  if (cursor.depth >= MAX_XO_FILTER_DEPTH) {
    throw new FilterSyntaxError(
      `a filter nests at most ${MAX_XO_FILTER_DEPTH} levels deep`,
    );
  }

  cursor.depth++;

  try {
    return readTermAlternatives(cursor);
  } finally {
    cursor.depth--;
  }
}

function readTermAlternatives(
  cursor: FilterCursor,
): XenOrchestraFilterNode | null {
  const start: number = cursor.pos;
  const ch: string = cursor.input.charAt(start);

  // ( term+ )
  if (ch === "(") {
    cursor.pos++;
    skipWhitespace(cursor);

    const terms: Array<XenOrchestraFilterNode> | null = readTerms(cursor);

    if (terms && cursor.input.charAt(cursor.pos) === ")") {
      cursor.pos++;
      skipWhitespace(cursor);
      return { type: "and", terms };
    }

    cursor.pos = start;
  }

  // |( term+ )
  if (ch === "|") {
    cursor.pos++;
    skipWhitespace(cursor);

    if (cursor.input.charAt(cursor.pos) === "(") {
      cursor.pos++;
      skipWhitespace(cursor);

      const terms: Array<XenOrchestraFilterNode> | null = readTerms(cursor);

      if (terms && cursor.input.charAt(cursor.pos) === ")") {
        cursor.pos++;
        skipWhitespace(cursor);
        return { type: "or", terms };
      }
    }

    cursor.pos = start;
  }

  // ! term
  if (ch === "!") {
    cursor.pos++;
    skipWhitespace(cursor);

    const child: XenOrchestraFilterNode | null = readTerm(cursor);

    if (child) {
      return { type: "not", child };
    }

    cursor.pos = start;
  }

  // <N >N <=N >=N
  if (ch === "<" || ch === ">") {
    let operator: string = ch;
    cursor.pos++;

    if (cursor.input.charAt(cursor.pos) === "=") {
      operator += "=";
      cursor.pos++;
    }

    const raw: string = readRawString(cursor, false);

    if (raw) {
      const value: number = Number(raw);

      // complex-matcher throws on it: the whole filter is refused.
      if (Number.isNaN(value)) {
        throw new FilterSyntaxError(
          `"${operator}${shorten(raw)}" compares with something that is not a number`,
        );
      }

      skipWhitespace(cursor);
      return { type: "comparison", operator, value };
    }

    cursor.pos = start;
  }

  // name : term
  const name: string | null = readPropertyName(cursor);

  if (name !== null) {
    skipWhitespace(cursor);

    if (cursor.input.charAt(cursor.pos) === ":") {
      cursor.pos++;
      skipWhitespace(cursor);

      const child: XenOrchestraFilterNode | null = readTerm(cursor);

      if (child) {
        return { type: "property", name, child };
      }
    }
  }

  cursor.pos = start;

  // name ?
  const truthyName: string | null = readPropertyName(cursor);

  if (truthyName !== null && cursor.input.charAt(cursor.pos) === "?") {
    cursor.pos++;
    skipWhitespace(cursor);
    return { type: "truthy", name: truthyName };
  }

  cursor.pos = start;

  // a value
  const quoted: string | null = readQuotedString(cursor);

  if (quoted !== null) {
    skipWhitespace(cursor);
    return { type: "string", value: quoted };
  }

  const regex: XenOrchestraFilterNode | null = readRegex(cursor);

  if (regex) {
    skipWhitespace(cursor);
    return regex;
  }

  const word: string = readRawString(cursor, true);

  if (word) {
    skipWhitespace(cursor);
    return { type: "word", value: word };
  }

  cursor.pos = start;
  return null;
}

export type XenOrchestraFilterParseResult =
  | { node: XenOrchestraFilterNode; problem: null }
  | { node: null; problem: string };

/*
 * A filter as Xen Orchestra parses it, or what is wrong with it. Total: an
 * input it cannot read is a problem, never a throw.
 */
export function parseXenOrchestraFilter(
  input: unknown,
): XenOrchestraFilterParseResult {
  if (typeof input !== "string") {
    return { node: null, problem: "the filter is not text" };
  }

  if (input.length > MAX_XO_FILTER_CHARS) {
    return {
      node: null,
      problem: `a filter is at most ${MAX_XO_FILTER_CHARS} characters`,
    };
  }

  const cursor: FilterCursor = { input, pos: 0, depth: 0 };

  try {
    skipWhitespace(cursor);

    const terms: Array<XenOrchestraFilterNode> = [];

    while (cursor.pos < input.length) {
      const term: XenOrchestraFilterNode | null = readTerm(cursor);

      if (!term) {
        return {
          node: null,
          problem: `the filter cannot be read from "${shorten(
            input.slice(cursor.pos),
          )}" on (Xen Orchestra's syntax: name:value, name?, !term, |(a b), (a b), "quoted", /regex/)`,
        };
      }

      terms.push(term);
    }

    if (terms.length === 0) {
      return { node: null, problem: "the filter is empty" };
    }

    return { node: { type: "and", terms }, problem: null };
  } catch (err: unknown) {
    return {
      node: null,
      problem:
        err instanceof FilterSyntaxError
          ? err.message
          : "the filter cannot be read",
    };
  }
}

/*
 * Property names a filter may never name: credentials, by their names, and
 * the free-form bags where passwords, keys and tokens live (a PBD's
 * device_config holds a CIFS password or an iSCSI CHAP secret, a VM's
 * xenStoreData and other_config what its owner put there, a task's
 * properties and result the arguments and answers of API calls).
 */
const SECRET_PROPERTY_NAME_REGEX: RegExp =
  /pass|pwd|secret|token|cred|auth|cert|cookie|private|key|salt|otp|signature|licen[cs]e/i;

const FREE_FORM_PROPERTY_NAMES: ReadonlyArray<string> = [
  "device_config",
  "deviceconfig",
  "xenstoredata",
  "xenstore_data",
  "other",
  "other_config",
  "otherconfig",
  "sm_config",
  "smconfig",
  "pv_args",
  "pv_bootloader",
  "pv_bootloader_args",
  "pv_kernel",
  "pv_ramdisk",
  "pv_legacy_args",
  "bios_strings",
  "biosstrings",
  "platform",
  "notes",
  "params",
  "properties",
  "result",
  "tasks",
  "settings",
  "data",
  "infos",
  "warnings",
  "args",
  "logging",
  "config",
  "configuration",
  "metadata",
  "user_data",
  "userdata",
  "vendor_data",
  "cloud_config",
  "cloudconfig",
  "network_config",
  "networkconfig",
  "environment",
  "env",
];

function describeFilterPropertyProblem(name: string): string | null {
  const folded: string = name.trim().toLowerCase().replace(/-/g, "_");

  if (SECRET_PROPERTY_NAME_REGEX.test(name)) {
    return `"${shorten(name)}" names a credential, and a filter on it would test a secret's value without printing it: filter on another property`;
  }

  if (FREE_FORM_PROPERTY_NAMES.includes(folded)) {
    return `"${shorten(name)}" holds free-form configuration, where passwords and keys live, and a filter on it would test their values without printing them: filter on a named property such as name_label, power_state or tags`;
  }

  return null;
}

/*
 * Why a parsed filter could tell whether a secret holds a value, or null
 * when it only matches named, harmless properties. A bare value at the top
 * matches every string of the object, its credentials included; under a
 * property it matches only inside that property.
 */
export function describeXenOrchestraFilterProblem(
  node: XenOrchestraFilterNode,
  underProperty: string | null = null,
): string | null {
  switch (node.type) {
    case "and":
    case "or": {
      for (const term of node.terms) {
        const problem: string | null = describeXenOrchestraFilterProblem(
          term,
          underProperty,
        );

        if (problem) {
          return problem;
        }
      }

      return null;
    }

    case "not":
      return describeXenOrchestraFilterProblem(node.child, underProperty);

    case "property": {
      const problem: string | null = describeFilterPropertyProblem(node.name);

      return (
        problem || describeXenOrchestraFilterProblem(node.child, node.name)
      );
    }

    case "truthy":
      return describeFilterPropertyProblem(node.name);

    case "comparison":
    case "string":
    case "regex":
    case "word": {
      if (underProperty !== null) {
        return null;
      }

      const shown: string =
        node.type === "comparison"
          ? `${node.operator}${node.value}`
          : node.type === "regex"
            ? `/${node.pattern}/`
            : node.value;

      return `the filter term "${shorten(shown)}" names no property, and a term with none matches every field of an object, passwords and keys included: name the property (name_label:${
        node.type === "word" ? shorten(node.value) : "web"
      })`;
    }

    default:
      return "the filter cannot be checked";
  }
}

const FILTER_RULE: XoValueRule = {
  expected:
    "a filter in Xen Orchestra's syntax on named properties, such as power_state:Halted, !attached? or |(status:failure status:interrupted)",
  explainsItself: true,
  check: (value: string): string | null => {
    const parsed: XenOrchestraFilterParseResult =
      parseXenOrchestraFilter(value);

    if (!parsed.node) {
      return parsed.problem;
    }

    return describeXenOrchestraFilterProblem(parsed.node);
  },
};

// What every list of objects takes.
const COLLECTION_PARAMS: Readonly<Record<string, XoValueRule>> = {
  fields: FIELDS_RULE,
  filter: FILTER_RULE,
  limit: LIMIT_RULE,
};

const NO_PARAMS: Readonly<Record<string, XoValueRule>> = {};

const STATS_PARAMS: Readonly<Record<string, XoValueRule>> = {
  granularity: GRANULARITY_RULE,
};

// ---- Reads -------------------------------------------------------------------

// What may be read of one object, at <collection>/<uuid>/<this>.
interface XoSubRead {
  params: Readonly<Record<string, XoValueRule>>;
  // The collections whose objects have it.
  collections: ReadonlyArray<string>;
}

const OBJECT_ACTIVITY_COLLECTIONS: ReadonlyArray<string> = [
  "pools",
  "hosts",
  "vms",
  "vm-controllers",
  "vm-snapshots",
  "vm-templates",
  "srs",
  "vdis",
  "networks",
  "pifs",
  "vbds",
  "vifs",
];

const SUB_READS: Readonly<Record<string, XoSubRead>> = {
  alarms: {
    params: COLLECTION_PARAMS,
    collections: OBJECT_ACTIVITY_COLLECTIONS,
  },
  messages: {
    params: COLLECTION_PARAMS,
    collections: OBJECT_ACTIVITY_COLLECTIONS,
  },
  tasks: {
    params: COLLECTION_PARAMS,
    collections: OBJECT_ACTIVITY_COLLECTIONS,
  },
  vdis: {
    params: COLLECTION_PARAMS,
    collections: ["vms", "vm-controllers", "vm-snapshots", "vm-templates"],
  },
  "backup-jobs": { params: COLLECTION_PARAMS, collections: ["vms"] },
  stats: { params: STATS_PARAMS, collections: ["pools", "hosts", "vms"] },
  dashboard: { params: NO_PARAMS, collections: ["pools", "vms"] },
  missing_patches: { params: NO_PARAMS, collections: ["pools", "hosts"] },
};

// How each collection's ids are written, for one of its objects.
interface XoIdRule {
  regex: RegExp;
  expected: string;
}

const UUID_ID_RULE: XoIdRule = {
  regex: UUID_REGEX,
  expected: "a UUID in lower case, as Xen Orchestra shows it",
};

const ID_RULES: Readonly<Record<string, XoIdRule>> = {
  tasks: {
    regex: TASK_ID_REGEX,
    expected: "a task id as Xen Orchestra lists it, such as 0mdd1basu",
  },
  "backup-logs": {
    regex: LOG_ID_REGEX,
    expected:
      "a backup log id as Xen Orchestra lists it, such as 1753776067468",
  },
  "restore-logs": {
    regex: LOG_ID_REGEX,
    expected:
      "a restore log id as Xen Orchestra lists it, such as 1753776067468",
  },
};

function idRuleOf(collection: string): XoIdRule {
  return ID_RULES[collection] || UUID_ID_RULE;
}

// What get may read, for refusals (the read guide has the parameters).
export const XCP_NG_READABLE_PATHS_SUMMARY: string = `Readable: this pool's ${XO_POOL_COLLECTIONS.join(
  ", ",
)} and Xen Orchestra's ${XO_OWN_COLLECTIONS.join(
  ", ",
)} (each as <collection> or <collection>/<id>); per object <collection>/<uuid>/alarms, messages or tasks; vms (and vm-controllers, vm-snapshots, vm-templates)/<uuid>/vdis; vms/<uuid>/backup-jobs; pools, hosts or vms/<uuid>/stats; pools or vms/<uuid>/dashboard; pools or hosts/<uuid>/missing_patches`;

// ---- Writes ------------------------------------------------------------------

interface XoWriteAction {
  tier: ResourceCommandTier;
  requiresHuman: boolean;
  params: Readonly<Record<string, XoValueRule>>;
  required: ReadonlyArray<string>;
  // What it does, completed with the object: "starts VM <uuid>".
  describe: (id: string, params: Record<string, string>) => string;
  // Why it has its tier.
  because: string;
  alreadyWhen: XenOrchestraStateCheck | null;
  requires: XenOrchestraStateCheck | null;
  privileges: (params: Record<string, string>) => ReadonlyArray<string>;
}

function fixed(privileges: ReadonlyArray<string>): () => ReadonlyArray<string> {
  return (): ReadonlyArray<string> => {
    return privileges;
  };
}

const VM_ACTIONS: Readonly<Record<string, XoWriteAction>> = {
  start: {
    tier: ResourceCommandTier.SafeWrite,
    requiresHuman: false,
    params: { hostId: UUID_RULE },
    required: [],
    describe: (id: string, params: Record<string, string>): string => {
      return `starts VM ${id}${params["hostId"] ? ` on host ${params["hostId"]}` : ""}`;
    },
    because: "one named VM, and shutting it down again undoes it",
    alreadyWhen: { property: "power_state", values: ["Running"] },
    requires: { property: "power_state", values: ["Halted"] },
    privileges: (params: Record<string, string>): ReadonlyArray<string> => {
      return params["hostId"] ? ["vm:start", "host:allow-vm"] : ["vm:start"];
    },
  },
  resume: {
    tier: ResourceCommandTier.SafeWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `resumes suspended VM ${id}`;
    },
    because: "one named VM, and suspending it again undoes it",
    alreadyWhen: { property: "power_state", values: ["Running"] },
    requires: { property: "power_state", values: ["Suspended"] },
    privileges: fixed(["vm:resume"]),
  },
  unpause: {
    tier: ResourceCommandTier.SafeWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `unpauses VM ${id}`;
    },
    because: "one named VM, and pausing it again undoes it",
    alreadyWhen: { property: "power_state", values: ["Running"] },
    requires: { property: "power_state", values: ["Paused"] },
    privileges: fixed(["vm:unpause"]),
  },
  clean_reboot: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `cleanly reboots VM ${id} (through its guest tools)`;
    },
    because: "the VM serves nothing while it restarts",
    alreadyWhen: null,
    requires: null,
    privileges: fixed(["vm:reboot:clean"]),
  },
  hard_reboot: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `hard-reboots VM ${id}`;
    },
    because:
      "it is pressing the reset button: what the VM had not written is lost",
    alreadyWhen: null,
    requires: null,
    privileges: fixed(["vm:reboot:hard"]),
  },
  clean_shutdown: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `cleanly shuts down VM ${id} (through its guest tools)`;
    },
    because: "the VM stays down, serving nothing, until someone starts it",
    alreadyWhen: { property: "power_state", values: ["Halted"] },
    requires: null,
    privileges: fixed(["vm:shutdown:clean"]),
  },
  hard_shutdown: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `hard-stops VM ${id}`;
    },
    because:
      "it is pulling the plug: what the VM had not written is lost, and it stays down until someone starts it",
    alreadyWhen: { property: "power_state", values: ["Halted"] },
    requires: null,
    privileges: fixed(["vm:shutdown:hard"]),
  },
  suspend: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `suspends VM ${id} to disk`;
    },
    because: "the VM serves nothing until someone resumes it",
    alreadyWhen: { property: "power_state", values: ["Suspended"] },
    requires: { property: "power_state", values: ["Running"] },
    privileges: fixed(["vm:suspend"]),
  },
  pause: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `pauses VM ${id}`;
    },
    because: "the VM serves nothing until someone unpauses it",
    alreadyWhen: { property: "power_state", values: ["Paused"] },
    requires: { property: "power_state", values: ["Running"] },
    privileges: fixed(["vm:pause"]),
  },
  snapshot: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: false,
    params: { name_label: SNAPSHOT_NAME_RULE },
    required: [],
    describe: (id: string, params: Record<string, string>): string => {
      return `takes a snapshot of VM ${id}${
        params["name_label"] ? ` named "${shorten(params["name_label"])}"` : ""
      }`;
    },
    because:
      "it takes space on the VM's storage until someone deletes it, which OneUptime AI never does",
    alreadyWhen: null,
    requires: null,
    privileges: fixed(["vm:snapshot"]),
  },
  migrate: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: true,
    params: { hostId: UUID_RULE },
    required: ["hostId"],
    describe: (id: string, params: Record<string, string>): string => {
      return `moves VM ${id} to host ${params["hostId"] || "(none)"} within the pool`;
    },
    because:
      "it loads another host and moves the VM's memory while it runs, so a human always decides",
    alreadyWhen: null,
    requires: null,
    privileges: fixed(["vm:migrate-send", "host:migrate-receive"]),
  },
};

const PBD_ACTIONS: Readonly<Record<string, XoWriteAction>> = {
  plug: {
    tier: ResourceCommandTier.SafeWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `plugs PBD ${id}, attaching its storage repository on its host again`;
    },
    because: "one storage repository on one host, and unplugging it undoes it",
    alreadyWhen: { property: "attached", values: [true] },
    requires: null,
    privileges: fixed(["pbd:plug"]),
  },
};

const SCHEDULE_ACTIONS: Readonly<Record<string, XoWriteAction>> = {
  run: {
    tier: ResourceCommandTier.SafeWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `runs backup schedule ${id} now, as its next scheduled run would`;
    },
    because:
      "it is one more run of a job someone scheduled: it snapshots and exports the job's VMs, which loads the pool and its storage, and keeps the backups its retention says",
    alreadyWhen: null,
    requires: null,
    privileges: fixed(["schedule:run"]),
  },
};

const HOST_ACTIONS: Readonly<Record<string, XoWriteAction>> = {
  enable: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: false,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `enables host ${id}`;
    },
    because:
      "VMs may start and HA may place VMs on it again, perhaps while someone works on it; disabling it again undoes it",
    alreadyWhen: { property: "enabled", values: [true] },
    requires: null,
    privileges: fixed(["host:enable"]),
  },
  restart_toolstack: {
    tier: ResourceCommandTier.RiskyWrite,
    requiresHuman: true,
    params: NO_PARAMS,
    required: [],
    describe: (id: string): string => {
      return `restarts the toolstack (XAPI) of host ${id}`;
    },
    because:
      "its VMs keep running, but the host - and on the pool master, the whole pool - cannot be managed until it is back, so a human always decides",
    alreadyWhen: null,
    requires: null,
    privileges: fixed(["host:restart-toolstack"]),
  },
};

const WRITE_ACTIONS: Readonly<
  Record<string, Readonly<Record<string, XoWriteAction>>>
> = {
  vms: VM_ACTIONS,
  pbds: PBD_ACTIONS,
  schedules: SCHEDULE_ACTIONS,
  hosts: HOST_ACTIONS,
};

// What post may do, for refusals.
export const XCP_NG_ACTIONS_SUMMARY: string =
  "xo-cli rest post may only start, resume, unpause, reboot (clean_reboot, hard_reboot), shut down (clean_shutdown, hard_shutdown), suspend, pause, snapshot or migrate (hostId=<host uuid>, within the pool) one VM (vms/<uuid>/actions/<action>), plug one PBD (pbds/<uuid>/actions/plug), run one backup schedule (schedules/<uuid>/actions/run), or enable or restart the toolstack of one host (hosts/<uuid>/actions/enable, restart_toolstack)";

// ---- Never -------------------------------------------------------------------

const XO_ACCOUNTS_REASON: string =
  "Xen Orchestra's own users, groups, roles, privileges and tokens are off-limits to OneUptime AI, to read or to change: a user's tokens are listed in full";

/*
 * Top-level paths no command may read or change, and why: what they hold
 * is Xen Orchestra's, not the pool's, and some of it is a credential.
 */
const FORBIDDEN_ROOTS: Readonly<Record<string, string>> = {
  users: XO_ACCOUNTS_REASON,
  groups: XO_ACCOUNTS_REASON,
  "acl-roles": XO_ACCOUNTS_REASON,
  "acl-privileges": XO_ACCOUNTS_REASON,
  servers:
    "Xen Orchestra's servers are its connections to the pools' masters (their address and XAPI user), off-limits to OneUptime AI; the pools themselves are readable at pools",
  plugins:
    "Xen Orchestra's plugins hold their configuration, secrets included, so they are off-limits to OneUptime AI",
  proxies:
    "Xen Orchestra's proxies are off-limits to OneUptime AI; a backup's outcome is readable at backup-logs",
  "backup-repositories":
    "a backup repository's address carries the credentials of its storage, so backup repositories are off-limits to OneUptime AI; a backup's outcome is readable at backup-logs",
  remotes:
    "a backup repository's address carries the credentials of its storage, so backup repositories are off-limits to OneUptime AI; a backup's outcome is readable at backup-logs",
  events:
    "the event stream never ends, so it is not something a command can read; read the collection itself",
  "browser-media":
    "inserting media from a browser is never allowed, so there is nothing to read there",
  v2v: "importing VMs from another hypervisor is never allowed, so there is nothing to read there",
  mcp: "Xen Orchestra's MCP server is not something the agent calls: it calls the REST API itself",
  docs: "the REST API's own documentation is not something the agent reads",
  "gui-routes":
    "Xen Orchestra's interface routes are not something the agent reads",
  dashboard:
    "Xen Orchestra's own dashboard is for administrators; read this pool's at pools/<uuid>/dashboard",
  ping: "the agent checks Xen Orchestra itself; there is nothing to read at ping",
  sms: "storage managers say nothing about this pool's health; read srs and pbds instead",
  pcis: "a host's PCI devices are not something an investigation needs; read hosts/<uuid> instead",
  pgpus:
    "a host's GPUs are not something an investigation needs; read hosts/<uuid> instead",
  "backup-archives":
    "the backups a repository holds are read through Xen Orchestra's backup repositories, which are off-limits; a backup's outcome is readable at backup-logs",
};

const DEPRECATED_BACKUP_REASON: string =
  'Xen Orchestra deprecated the "backup" paths (they go away in 2026): read backup-jobs and backup-logs instead';

// A download: a VM, snapshot, template or disk export, or a host's logs.
const EXPORT_SEGMENT_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]+$/i;

const DOWNLOAD_REASON: string =
  "exports and downloads (a VM, a snapshot, a template or a disk as a file, a host's logs or audit log) are never allowed: they copy the pool's data out";

// Actions of a VM that are never allowed, and why.
const NEVER_VM_ACTIONS: Readonly<Record<string, string>> = {
  revert_snapshot:
    "reverting a VM to a snapshot is never allowed: it discards everything written since the snapshot",
  clone: "cloning a VM is never allowed: it creates a VM",
  insert_browser_iso:
    "inserting media into a VM is never allowed: it changes what the VM boots and reads",
};

// Actions of a host that are never allowed, and why.
const NEVER_HOST_ACTIONS: Readonly<Record<string, string>> = {
  disable:
    "disabling a host is never allowed: HA and new VMs stop using it until someone enables it again",
  evacuate:
    "evacuating a host is never allowed: it moves every VM on it at once; migrate one VM at a time, which a human approves",
  clean_shutdown:
    "shutting a host down is never allowed: every VM on it goes down or moves",
  emergency_shutdown:
    "shutting a host down is never allowed: every VM on it goes down",
  clean_reboot:
    "rebooting a host is never allowed: every VM on it goes down or moves",
  smart_reboot:
    "rebooting a host is never allowed: every VM on it goes down or moves",
  start:
    "powering a host on is never allowed: it is a human's call, and it changes how the pool's VMs are placed",
  detach:
    "ejecting a host from its pool is never allowed: it changes what the pool is",
  forget: "forgetting a host is never allowed: it changes what the pool is",
  management_reconfigure:
    "changing a host's management interface is never allowed: it is the host's configuration, and a mistake cuts the host off",
  move_management_ip:
    "changing a host's management interface is never allowed: it is the host's configuration, and a mistake cuts the host off",
  scan_pifs:
    "rescanning a host's network interfaces is never allowed: it changes the pool's network configuration",
};

/*
 * Why a path is never allowed, whatever xo-cli rest does with it, or null.
 * Checked before anything else about the command, so the model hears the
 * real reason rather than a complaint about a parameter.
 */
function describeForbiddenPath(segments: Array<string>): string | null {
  const root: string = segments[0] || "";

  if (Object.prototype.hasOwnProperty.call(FORBIDDEN_ROOTS, root)) {
    return FORBIDDEN_ROOTS[root] || XO_ACCOUNTS_REASON;
  }

  if (root === "backup") {
    return DEPRECATED_BACKUP_REASON;
  }

  if (segments.length === 2 && EXPORT_SEGMENT_REGEX.test(segments[1] || "")) {
    return DOWNLOAD_REASON;
  }

  if (
    root === "hosts" &&
    segments.length === 3 &&
    (segments[2] === "logs.tgz" || segments[2] === "audit.txt")
  ) {
    return DOWNLOAD_REASON;
  }

  return null;
}

/*
 * Why a post on this path is refused, when it is a well-known action with a
 * better answer than the generic list, or null.
 */
function describeRefusedPost(segments: Array<string>): string | null {
  const root: string = segments[0] || "";
  const action: string = segments[3] || "";
  const isAction: boolean = segments.length === 4 && segments[2] === "actions";

  if (segments.length === 1) {
    return `creating ${root} is never allowed: OneUptime AI acts on what exists, one object at a time`;
  }

  if (root === "pools") {
    if (segments.length === 3 && segments[2] === "vms") {
      return "creating a VM is never allowed";
    }

    return "actions on a whole pool (rolling reboots and updates, emergency shutdown, creating networks or VMs, adding hosts) are never allowed: OneUptime AI acts on one VM, PBD, schedule or host at a time";
  }

  if (root === "vms" && isAction) {
    return Object.prototype.hasOwnProperty.call(NEVER_VM_ACTIONS, action)
      ? NEVER_VM_ACTIONS[action] || null
      : null;
  }

  if (root === "hosts" && isAction) {
    if (action.startsWith("probe_")) {
      return "probing storage from a host is never allowed: it makes the host connect wherever it is told";
    }

    return Object.prototype.hasOwnProperty.call(NEVER_HOST_ACTIONS, action)
      ? NEVER_HOST_ACTIONS[action] || null
      : null;
  }

  if (root === "pbds" && isAction && action === "unplug") {
    return "unplugging storage is never allowed: the VMs on that host lose their disks there; a human detaches storage";
  }

  if (root === "srs") {
    return "actions on a storage repository (creating, scanning, forgetting, reclaiming space, importing disks) are never allowed; to attach one on a host again, plug its PBD (pbds/<uuid>/actions/plug)";
  }

  if (root === "vdis" || root === "vdi-snapshots") {
    return "changing a virtual disk (migrating, importing, exporting) is never allowed";
  }

  if (root === "vbds" || root === "vifs") {
    return "connecting or disconnecting a VM's disks or network interfaces is never allowed";
  }

  if (root === "networks" || root === "pifs") {
    return "changing the pool's networks is never allowed";
  }

  if (root === "tasks") {
    return "aborting or deleting Xen Orchestra's tasks is never allowed";
  }

  if (root === "backup-jobs") {
    return "creating or changing backup jobs is never allowed; to run one again, run its schedule (schedules/<uuid>/actions/run)";
  }

  if (
    root === "vm-snapshots" ||
    root === "vm-templates" ||
    root === "vm-controllers"
  ) {
    return "changing snapshots, templates and control domains is never allowed";
  }

  return null;
}

// Why each rest command word OneUptime AI may not use is refused.
const REFUSED_REST_COMMANDS: Readonly<Record<string, string>> = {
  patch: `xo-cli rest patch changes an object's configuration (an HTTP PATCH), which OneUptime AI never does; ${XCP_NG_ACTIONS_SUMMARY}`,
  put: `xo-cli rest put adds to an object (a tag, an object to a collection: an HTTP PUT), which OneUptime AI never does; ${XCP_NG_ACTIONS_SUMMARY}`,
  del: `xo-cli rest del deletes (a VM, a disk, a snapshot, a storage repository, a tag: an HTTP DELETE), which OneUptime AI never does; ${XCP_NG_ACTIONS_SUMMARY}`,
  delete: `deleting anything (an HTTP DELETE) is never allowed; ${XCP_NG_ACTIONS_SUMMARY}`,
};

const WHAT_IS_ALLOWED: string =
  "read with xo-cli rest get <path> and act with xo-cli rest post <path>/actions/<action>";

// xo-cli's own commands other than rest, refused with their reason.
const OTHER_XO_CLI_COMMANDS: ReadonlyArray<string> = [
  "register",
  "unregister",
  "create-token",
  "list-commands",
  "list-objects",
  "watch",
  "help",
];

// Global flags of xo-cli, and why each is refused.
const REFUSED_GLOBAL_FLAGS: Readonly<Record<string, string>> = {
  "--allowUnauthorized":
    "the agent always checks Xen Orchestra's certificate, so --allowUnauthorized is never used",
  "--au":
    "the agent always checks Xen Orchestra's certificate, so --au is never used",
  "--url":
    "the agent only talks to its own Xen Orchestra, so --url is never used",
  "-u": "the agent only talks to its own Xen Orchestra, so -u is never used",
  "--json":
    "the agent always prints Xen Orchestra's answer as JSON: drop --json",
};

// ---- Analysis ----------------------------------------------------------------

interface XoParam {
  name: string;
  value: string;
}

interface XoWords {
  positionals: Array<string>;
  params: Array<XoParam>;
  // The first problem with how the words are written, or null.
  problem: string | null;
}

const PARAM_NAME_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9_]*$/;

/*
 * Split the words after the rest command word into the path and the
 * name=value parameters (see the Grammar section). Never stops early: it
 * records the first problem and keeps going, so the path is still found for
 * a better refusal.
 */
function splitWords(words: Array<string>): XoWords {
  const positionals: Array<string> = [];
  const params: Array<XoParam> = [];
  const seen: Array<string> = [];
  let problem: string | null = null;

  const note: (text: string) => void = (text: string): void => {
    if (problem === null) {
      problem = text;
    }
  };

  for (const word of words) {
    if (word.startsWith("-")) {
      const flag: string = word.split("=")[0] || word;

      note(
        flag === "--output" || flag === "-o"
          ? "--output is not available: the agent prints Xen Orchestra's answer, and never writes it to a file"
          : flag === "--input" || flag === "-i"
            ? "--input is not available: an action's parameters are name=value words after its path"
            : Object.prototype.hasOwnProperty.call(REFUSED_GLOBAL_FLAGS, flag)
              ? REFUSED_GLOBAL_FLAGS[flag] || WHAT_IS_ALLOWED
              : `"${shorten(word)}" is not available: after the path, every parameter is one name=value word (fields=name_label,power_state)`,
      );
      continue;
    }

    const equals: number = word.indexOf("=");
    // "vms?fields=x" or "vms/x=y" is a path, whose own problem readPath says.
    const isPathShaped: boolean =
      equals >= 0 &&
      (word.slice(0, equals).includes("/") ||
        word.slice(0, equals).includes("?"));

    if (equals < 0 || isPathShaped) {
      // The path, and anything else that is not a parameter.
      if (positionals.length > 0) {
        note(
          `"${shorten(word)}" is not a parameter: write each one as name=value (limit=20)${
            word === "wait"
              ? "; the agent itself waits for an action's task to end"
              : ""
          }`,
        );
      }

      positionals.push(word);
      continue;
    }

    if (positionals.length === 0) {
      note(
        `"${shorten(word)}" comes before the path: write the path first, then its parameters (xo-cli rest get vms fields=name_label)`,
      );
      continue;
    }

    const name: string = word.slice(0, equals);
    const value: string = word.slice(equals + 1);

    if (!PARAM_NAME_REGEX.test(name)) {
      note(
        name.includes(".")
          ? `"${shorten(name)}" is a dotted name, which xo-cli would send as a nested object: no parameter OneUptime AI may pass is one`
          : `"${shorten(word)}" is not a parameter OneUptime AI may pass: names are letters, digits and "_" (fields=name_label)`,
      );
      continue;
    }

    if (value === "") {
      note(`${name}= has no value: write ${name}=<value>`);
      continue;
    }

    if (value.startsWith("json:")) {
      note(
        `${name}=json:... would be read as JSON: every value OneUptime AI may pass is plain text`,
      );
      continue;
    }

    if (seen.includes(name)) {
      note(`${name} is given more than once: give each parameter once`);
      continue;
    }

    seen.push(name);
    params.push({ name, value });
  }

  return { positionals, params, problem };
}

interface XoPath {
  // Canonical: "/vms/<uuid>/alarms".
  path: string;
  segments: Array<string>;
}

// The characters a path OneUptime AI may use holds.
const PATH_CHARACTERS_REGEX: RegExp = /^[A-Za-z0-9._/-]+$/;

const REST_PREFIX_REGEX: RegExp = /^\/?rest\/v0(?:\/|$)/;

// The path, canonical, or why it cannot be one.
function readPath(raw: string): XoPath | string {
  if (!raw) {
    return "the path is empty: name one, such as vms";
  }

  if (raw.length > MAX_XO_API_PATH_CHARS) {
    return `the path is longer than ${MAX_XO_API_PATH_CHARS} characters`;
  }

  if (raw.includes("?") || raw.includes("&") || raw.includes("#")) {
    return `"${shorten(raw)}" carries a query string: write each parameter as name=value after the path instead (xo-cli rest get vms fields=name_label,power_state filter=power_state:Halted)`;
  }

  if (raw.includes("%")) {
    return `"${shorten(raw)}" is percent-encoded: write the path plainly`;
  }

  if (!PATH_CHARACTERS_REGEX.test(raw)) {
    return `"${shorten(raw)}" holds a character no path OneUptime AI may use has (paths use letters, digits and . _ -)`;
  }

  let value: string = raw;

  if (REST_PREFIX_REGEX.test(value)) {
    value = value.replace(REST_PREFIX_REGEX, "");
  } else if (value.startsWith("/")) {
    value = value.slice(1);
  }

  if (value.endsWith("/")) {
    value = value.slice(0, -1);
  }

  if (!value) {
    return `"${shorten(raw)}" is the root of the REST API, not a path OneUptime AI may use. ${XCP_NG_READABLE_PATHS_SUMMARY}`;
  }

  const segments: Array<string> = value.split("/");

  if (
    segments.some((segment: string): boolean => {
      return segment === "" || segment === "." || segment === "..";
    })
  ) {
    return `"${shorten(raw)}" has an empty, "." or ".." segment: write the path out plainly`;
  }

  return { path: `/${segments.join("/")}`, segments };
}

interface XoCheckedParams {
  values: Record<string, string>;
}

function listParams(allowed: Readonly<Record<string, XoValueRule>>): string {
  const names: Array<string> = Object.keys(allowed);

  return names.length === 0
    ? "it takes no parameters"
    : `its parameters are ${names.join(", ")}`;
}

/*
 * Check every parameter against the ones `where` takes, and the required
 * ones against those given: the values, or why not.
 */
function checkParams(
  params: Array<XoParam>,
  allowed: Readonly<Record<string, XoValueRule>>,
  required: ReadonlyArray<string>,
  where: string,
): XoCheckedParams | string {
  const values: Record<string, string> = {};

  for (const param of params) {
    const rule: XoValueRule | undefined = Object.prototype.hasOwnProperty.call(
      allowed,
      param.name,
    )
      ? allowed[param.name]
      : undefined;

    if (!rule) {
      if (param.name === "ndjson" || param.name === "markdown") {
        return `${param.name} is not available: the agent always prints Xen Orchestra's answer as JSON`;
      }

      if (param.name === "sync") {
        return "sync is not available: the agent runs every action as Xen Orchestra's task and waits for it itself";
      }

      if (param.name === "wait" || param.name === "watch") {
        return `${param.name} is not available: a read answers at once (the agent itself waits for an action's task)`;
      }

      return `${param.name} is not a parameter OneUptime AI may pass to ${where}: ${listParams(allowed)}`;
    }

    const problem: string | null = rule.check(param.value);

    if (problem) {
      return rule.explainsItself
        ? `${param.name}="${shorten(param.value)}" on ${where} is refused: ${problem}`
        : `${param.name} on ${where} must be ${problem} (got "${shorten(param.value)}")`;
    }

    values[param.name] = param.value;
  }

  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      const rule: XoValueRule | undefined = allowed[name];

      return `${where} needs ${name}=${rule ? `<${rule.expected}>` : "<value>"}`;
    }
  }

  return { values };
}

interface XoDenial {
  allowed: false;
  reason: string;
}

interface XoAllowance {
  allowed: true;
  tier: ResourceCommandTier;
  reason: string;
  verb: string;
  targets: Array<string>;
  requiresHuman: boolean;
  request: XenOrchestraApiRequest;
}

type XoAnalysis = XoDenial | XoAllowance;

function deny(reason: string): XoDenial {
  return { allowed: false, reason };
}

const KNOWN_COLLECTIONS: ReadonlyArray<string> = [
  ...XO_POOL_COLLECTIONS,
  ...XO_OWN_COLLECTIONS,
];

/*
 * The whole judgement of one argv (program included): what it may do, or
 * why it may not. Both evaluateArgv and parseXcpNgCommand are views of this,
 * so the request the agent sends is exactly what was tiered.
 */
function analyzeXcpNgArgv(rawArgv: unknown): XoAnalysis {
  if (!Array.isArray(rawArgv) || rawArgv.length === 0) {
    return deny("Empty command.");
  }

  if (
    rawArgv.some((word: unknown): boolean => {
      return typeof word !== "string";
    })
  ) {
    return deny("Every word of the command must be a string.");
  }

  const argv: Array<string> = rawArgv as Array<string>;

  if (argv.length > MAX_RESOURCE_COMMAND_TOKENS) {
    return deny(
      `A command may have at most ${MAX_RESOURCE_COMMAND_TOKENS} words.`,
    );
  }

  const totalLength: number = argv.reduce(
    (sum: number, word: string): number => {
      return sum + word.length;
    },
    0,
  );

  if (totalLength > MAX_COMMAND_LENGTH_CHARS) {
    return deny(
      `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
    );
  }

  if (
    argv.some((word: string): boolean => {
      return word.includes("\n") || word.includes("\r") || word.includes("\0");
    })
  ) {
    return deny(
      "A command must be a single line: no word may hold a newline or a NUL character.",
    );
  }

  if (argv[0] !== XO_CLI_PROGRAM) {
    return deny(
      `an XCP-ng command starts with "${XO_CLI_PROGRAM}": ${WHAT_IS_ALLOWED}`,
    );
  }

  const subcommand: string = argv[1] || "";

  if (!subcommand) {
    return deny(
      `name what xo-cli should do: ${WHAT_IS_ALLOWED}, such as xo-cli rest get vms fields=name_label,power_state`,
    );
  }

  if (subcommand.startsWith("-")) {
    const flag: string = subcommand.split("=")[0] || subcommand;

    return deny(
      Object.prototype.hasOwnProperty.call(REFUSED_GLOBAL_FLAGS, flag)
        ? REFUSED_GLOBAL_FLAGS[flag] || WHAT_IS_ALLOWED
        : `"${shorten(subcommand)}" is not available: ${WHAT_IS_ALLOWED}`,
    );
  }

  if (subcommand !== XO_CLI_REST_COMMAND) {
    if (OTHER_XO_CLI_COMMANDS.includes(subcommand)) {
      return deny(
        `xo-cli ${subcommand} is not available: the agent calls Xen Orchestra's REST API only, with its own token; ${WHAT_IS_ALLOWED}`,
      );
    }

    return deny(
      subcommand.includes(".")
        ? `Xen Orchestra's JSON-RPC API (xo-cli ${shorten(subcommand)} ...) is not available: the agent calls its REST API only; ${WHAT_IS_ALLOWED}`
        : `"${shorten(subcommand)}" is not an xo-cli command OneUptime AI may run: ${WHAT_IS_ALLOWED}`,
    );
  }

  const command: string = argv[2] || "";

  if (!command) {
    return deny(
      `name what xo-cli rest should do: ${WHAT_IS_ALLOWED}, such as xo-cli rest get vms fields=name_label,power_state`,
    );
  }

  if (command.startsWith("-")) {
    const flag: string = command.split("=")[0] || command;

    return deny(
      Object.prototype.hasOwnProperty.call(REFUSED_GLOBAL_FLAGS, flag)
        ? REFUSED_GLOBAL_FLAGS[flag] || WHAT_IS_ALLOWED
        : `the rest command (get or post) comes right after xo-cli rest, before anything else: ${WHAT_IS_ALLOWED}`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(REFUSED_REST_COMMANDS, command)) {
    return deny(REFUSED_REST_COMMANDS[command] || WHAT_IS_ALLOWED);
  }

  if (command !== "get" && command !== "post") {
    return deny(
      `"${shorten(command)}" is not an xo-cli rest command OneUptime AI may run: ${WHAT_IS_ALLOWED}`,
    );
  }

  const isRead: boolean = command === "get";
  const words: XoWords = splitWords(argv.slice(3));
  const rawPath: string | undefined = words.positionals[0];

  if (rawPath === undefined) {
    return deny(
      words.problem ||
        `name the path after xo-cli rest ${command}, such as xo-cli rest ${command} ${
          isRead
            ? "vms fields=name_label,power_state"
            : "vms/<uuid>/actions/start"
        }`,
    );
  }

  const path: XoPath | string = readPath(rawPath);

  if (typeof path === "string") {
    return deny(words.problem || path);
  }

  const forbidden: string | null = describeForbiddenPath(path.segments);

  if (forbidden) {
    return deny(forbidden);
  }

  if (words.problem) {
    return deny(words.problem);
  }

  if (words.positionals.length > 1) {
    return deny(
      `xo-cli rest ${command} takes exactly one path, but "${shorten(
        words.positionals[1] || "",
      )}" follows it: write each parameter as name=value`,
    );
  }

  return isRead
    ? analyzeRead(path, words.params)
    : analyzePost(path, words.params);
}

function analyzeRead(path: XoPath, params: Array<XoParam>): XoAnalysis {
  const segments: Array<string> = path.segments;
  const collection: string = segments[0] || "";

  if (!KNOWN_COLLECTIONS.includes(collection)) {
    return deny(
      `${path.path} is not a path OneUptime AI may read. ${XCP_NG_READABLE_PATHS_SUMMARY}`,
    );
  }

  const isPoolCollection: boolean = XO_POOL_COLLECTIONS.includes(collection);
  const where: string = `xo-cli rest get ${path.path.slice(1)}`;

  const readOf: (
    allowed: Readonly<Record<string, XoValueRule>>,
    scope: XenOrchestraPoolScope,
  ) => XoAnalysis = (
    allowed: Readonly<Record<string, XoValueRule>>,
    scope: XenOrchestraPoolScope,
  ): XoAnalysis => {
    const checked: XoCheckedParams | string = checkParams(
      params,
      allowed,
      [],
      where,
    );

    if (typeof checked === "string") {
      return deny(checked);
    }

    return {
      allowed: true,
      tier: ResourceCommandTier.Read,
      reason: `reads ${path.path.slice(1)} from Xen Orchestra's REST API and changes nothing; passwords, keys and tokens in it are redacted before anyone sees the output`,
      verb: "get",
      targets: [],
      requiresHuman: false,
      request: {
        method: "GET",
        path: path.path,
        query: checked.values,
        body: null,
        scope,
        change: null,
      },
    };
  };

  if (segments.length === 1) {
    return readOf(
      COLLECTION_PARAMS,
      isPoolCollection ? { kind: "collection" } : { kind: "none" },
    );
  }

  const id: string = segments[1] || "";
  const idRule: XoIdRule = idRuleOf(collection);

  if (!idRule.regex.test(id)) {
    if (
      segments.length === 2 &&
      Object.prototype.hasOwnProperty.call(SUB_READS, id)
    ) {
      return deny(
        `${path.path} names no object: ${id} is read per object, at ${collection}/<uuid>/${id}`,
      );
    }

    return deny(
      `"${shorten(id)}" in ${collection}/<id> must be ${
        UUID_ANY_CASE_REGEX.test(id) && idRule === UUID_ID_RULE
          ? "a UUID in lower case, as Xen Orchestra shows it (write it in lower case)"
          : idRule.expected
      }`,
    );
  }

  const objectScope: XenOrchestraPoolScope = isPoolCollection
    ? { kind: "object", collection, id }
    : { kind: "none" };

  if (segments.length === 2) {
    return readOf(NO_PARAMS, objectScope);
  }

  const sub: string = segments[2] || "";
  const subRead: XoSubRead | undefined = Object.prototype.hasOwnProperty.call(
    SUB_READS,
    sub,
  )
    ? SUB_READS[sub]
    : undefined;

  if (
    segments.length === 3 &&
    subRead &&
    subRead.collections.includes(collection)
  ) {
    return readOf(subRead.params, objectScope);
  }

  if (segments[2] === "actions") {
    return deny(
      `${path.path} is an action for xo-cli rest post, not something to read; ${XCP_NG_ACTIONS_SUMMARY}`,
    );
  }

  return deny(
    `${path.path} is not a path OneUptime AI may read. ${XCP_NG_READABLE_PATHS_SUMMARY}`,
  );
}

function analyzePost(path: XoPath, params: Array<XoParam>): XoAnalysis {
  const segments: Array<string> = path.segments;
  const collection: string = segments[0] || "";
  const id: string = segments[1] || "";
  const actions: Readonly<Record<string, XoWriteAction>> | undefined =
    Object.prototype.hasOwnProperty.call(WRITE_ACTIONS, collection)
      ? WRITE_ACTIONS[collection]
      : undefined;

  const refused: string | null = describeRefusedPost(segments);

  if (refused) {
    return deny(refused);
  }

  if (
    !actions ||
    segments.length !== 4 ||
    segments[2] !== "actions" ||
    !KNOWN_COLLECTIONS.includes(collection)
  ) {
    if (
      KNOWN_COLLECTIONS.includes(collection) &&
      analyzeRead(path, []).allowed
    ) {
      return deny(
        `${path.path} is a path to read (xo-cli rest get ${path.path.slice(1)}), not an action; ${XCP_NG_ACTIONS_SUMMARY}`,
      );
    }

    return deny(
      `xo-cli rest post ${path.path.slice(1)} is not allowed; ${XCP_NG_ACTIONS_SUMMARY}`,
    );
  }

  const idProblem: string | null = UUID_RULE.check(id);

  if (idProblem) {
    return deny(
      `"${shorten(id)}" in ${collection}/<uuid>/actions/${segments[3] || "<action>"} must be ${idProblem}`,
    );
  }

  const actionName: string = segments[3] || "";
  const action: XoWriteAction | undefined =
    Object.prototype.hasOwnProperty.call(actions, actionName)
      ? actions[actionName]
      : undefined;

  if (!action) {
    return deny(
      `"${shorten(actionName)}" is not an action OneUptime AI may take on ${collection}: it may ${Object.keys(
        actions,
      ).join(
        ", ",
      )} (${collection}/<uuid>/actions/<action>). ${XCP_NG_ACTIONS_SUMMARY}`,
    );
  }

  const where: string = `xo-cli rest post ${collection}/<uuid>/actions/${actionName}`;

  if (collection === "vms" && actionName === "migrate") {
    for (const param of params) {
      if (
        param.name === "srId" ||
        param.name === "migrationNetworkId" ||
        param.name.startsWith("srIdByVdiId") ||
        param.name.startsWith("networkIdByVifId")
      ) {
        return deny(
          "only a move within the pool is allowed (hostId=<host uuid> alone): moving a VM's disks or networks, or to another pool, is never allowed",
        );
      }

      if (param.name === "bypassCpuCheck") {
        return deny(
          "bypassCpuCheck is never allowed: Xen Orchestra warns that the VM may crash after such a migration",
        );
      }
    }
  }

  if (
    collection === "hosts" &&
    actionName === "restart_toolstack" &&
    params.some((param: XoParam): boolean => {
      return param.name === "bypassBackupCheck";
    })
  ) {
    return deny(
      "bypassBackupCheck is never allowed: a toolstack restart waits for running backups, and skipping that check breaks them",
    );
  }

  const checked: XoCheckedParams | string = checkParams(
    params,
    action.params,
    action.required,
    where,
  );

  if (typeof checked === "string") {
    return deny(checked);
  }

  const kind: XcpNgTargetKind = TARGET_KIND_BY_COLLECTION[collection] || "vm";
  const destinationHostId: string | null =
    collection === "vms" && actionName === "migrate"
      ? checked.values["hostId"] || null
      : null;

  return {
    allowed: true,
    tier: action.tier,
    reason: `${action.describe(id, checked.values)}: ${action.because}`,
    verb: `${kind} ${actionName}`,
    targets: [`${kind}/${id}`],
    requiresHuman: action.requiresHuman,
    request: {
      method: "POST",
      path: path.path,
      query: {},
      body: checked.values,
      scope:
        collection === "schedules"
          ? { kind: "none" }
          : { kind: "object", collection, id },
      change: {
        collection: collection as XenOrchestraChange["collection"],
        id,
        action: actionName,
        mustBeInPool: collection !== "schedules",
        destinationHostId,
        alreadyWhen: action.alreadyWhen,
        requires: action.requires,
        privileges: action.privileges(checked.values),
      },
    },
  };
}

function copyRequest(request: XenOrchestraApiRequest): XenOrchestraApiRequest {
  return {
    method: request.method,
    path: request.path,
    query: { ...request.query },
    body: request.body ? { ...request.body } : null,
    scope: { ...request.scope },
    change: request.change
      ? {
          ...request.change,
          alreadyWhen: request.change.alreadyWhen
            ? {
                property: request.change.alreadyWhen.property,
                values: [...request.change.alreadyWhen.values],
              }
            : null,
          requires: request.change.requires
            ? {
                property: request.change.requires.property,
                values: [...request.change.requires.values],
              }
            : null,
          privileges: [...request.change.privileges],
        }
      : null,
  };
}

/*
 * The Xen Orchestra REST request an xo-cli command becomes (program
 * included in argv), or the policy's reason it may not run. The agent's
 * executor calls this on the argv it received after the policy has passed
 * it, and sends exactly the request it returns.
 */
export function parseXcpNgCommand(
  argv: Array<string>,
): XcpNgCommandParseResult {
  let analysis: XoAnalysis;

  try {
    analysis = analyzeXcpNgArgv(argv);
  } catch {
    return {
      errorMessage: "the xo-cli command policy could not evaluate this command",
    };
  }

  if (!analysis.allowed) {
    return { errorMessage: analysis.reason };
  }

  return { request: copyRequest(analysis.request) };
}

// ---- Targets -------------------------------------------------------------------

// "<kind>/<uuid glob>", or a UUID glob alone.
const TARGET_ENTRY_REGEX: RegExp =
  /^(?:(vm|pbd|host|schedule|\*)\/)?([0-9a-f*-]+)$/i;

function splitTarget(target: string): { kind: string; id: string } | null {
  const slash: number = target.indexOf("/");

  if (slash < 0) {
    return null;
  }

  return { kind: target.slice(0, slash), id: target.slice(slash + 1) };
}

/*
 * An entry with no kind names an object by its UUID alone, whatever it is:
 * a protected or allowed bare UUID is compared with the target's UUID.
 */
function matchesBareUuidEntry(target: string, entry: string): boolean {
  const parts: { kind: string; id: string } | null = splitTarget(
    target.trim().toLowerCase(),
  );
  const pattern: string = entry.trim().toLowerCase();

  if (!parts || !pattern || pattern.includes("/")) {
    return false;
  }

  return globMatchesTarget(pattern, parts.id);
}

/*
 * Why an entry of ONEUPTIME_AI_WRITE_TARGETS or ONEUPTIME_AI_PROTECTED_TARGETS
 * means nothing to this agent, or null. A VM's name would never match a
 * target, which is always a kind and a UUID, so the agent stays read-only
 * until the entry is fixed rather than leave that VM unprotected.
 */
function describeTargetEntryProblem(entry: string): string | null {
  const value: string = typeof entry === "string" ? entry.trim() : "";

  if (!value || value === "*") {
    return null;
  }

  const match: RegExpMatchArray | null = value.match(TARGET_ENTRY_REGEX);

  if (!match) {
    return `"${shorten(value)}" names nothing the XCP-ng AI agent changes: its targets are vm/<uuid>, pbd/<uuid>, host/<uuid> and schedule/<uuid> (or a UUID alone), never a name; * matches any run of characters`;
  }

  const id: string = match[2] || "";

  if (id !== "*" && !id.includes("*") && !UUID_ANY_CASE_REGEX.test(id)) {
    return `"${shorten(value)}" is not a UUID: write the object's UUID as Xen Orchestra shows it (vm/e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c), or a glob of one`;
  }

  return null;
}

// ---- Guides ------------------------------------------------------------------

const READ_COMMAND_GUIDE: string = [
  "- `xo-cli rest get <path> [name=value]...` reads Xen Orchestra's REST API for this XCP-ng pool. Name the fields you need (`fields=name_label,power_state`): without fields a list holds only paths; `fields=*` returns whole objects. `filter=` takes Xen Orchestra's syntax on named properties - quote it when it has spaces or `!` (`filter='power_state:Halted tags:prod'`); `limit=N` caps a list. No query strings (`?a=b`); one path per command.",
  "- This pool's objects, listed for this pool only: `pools`, `hosts`, `vms`, `vm-controllers` (control domains), `vm-snapshots`, `vm-templates`, `srs`, `pbds` (a storage repository on one host: `attached`, `host`, `SR`), `vdis`, `vdi-snapshots`, `vbds`, `vifs`, `pifs`, `networks`, `alarms`, `messages`. Xen Orchestra's records: `tasks`, `backup-jobs`, `backup-logs`, `restore-logs`, `schedules`.",
  "- One object: `xo-cli rest get vms/<uuid>`; what belongs to it: `<collection>/<uuid>/alarms`, `/messages`, `/tasks`, `vms/<uuid>/vdis`, `vms/<uuid>/backup-jobs`, `pools|hosts|vms/<uuid>/stats [granularity=seconds|minutes|hours|days]`, `pools|vms/<uuid>/dashboard`, `pools|hosts/<uuid>/missing_patches`.",
  "- Examples: halted VMs `xo-cli rest get vms fields=name_label,power_state,$container filter=power_state:Halted`; which host a storage repository is unplugged from `xo-cli rest get pbds fields=attached,host,SR filter='!attached?'`; failed backups `xo-cli rest get backup-logs fields=jobName,status,start,result filter=status:failure limit=10`; recent failed tasks `xo-cli rest get tasks fields=name_label,status,properties,result filter=status:failure limit=20`.",
  "- Never: Xen Orchestra's users, groups, roles, tokens, servers, plugins, proxies and backup repositories, downloads (exports, a host's logs), the event stream, `xo-cli rest patch|put|del`, a filter term with no property name or one on passwords, keys or config bags (device_config, xenStoreData, other_config).",
].join("\n");

const WRITE_COMMAND_GUIDE: string = [
  "- `xo-cli rest post <collection>/<uuid>/actions/<action> [name=value]...` runs one action of Xen Orchestra's REST API on one object of this pool, and the agent waits for its task.",
  "- Safe (runs unattended in Automatic mode): `xo-cli rest post vms/<uuid>/actions/start [hostId=<host uuid>]` (a halted VM), `vms/<uuid>/actions/resume` (suspended), `vms/<uuid>/actions/unpause` (paused), `pbds/<uuid>/actions/plug` (attach a storage repository on one host again; find the PBD with `xo-cli rest get pbds fields=attached,host,SR filter='!attached?'`), `schedules/<uuid>/actions/run` (run a backup job again: its backup log's scheduleId).",
  "- Riskier (needs approval unless allowlisted or approvals are bypassed): `vms/<uuid>/actions/clean_reboot`, `hard_reboot`, `clean_shutdown`, `hard_shutdown`, `suspend`, `pause`, `snapshot [name_label=<name>]`; `hosts/<uuid>/actions/enable`.",
  "- Always asks a human: `vms/<uuid>/actions/migrate hostId=<host uuid>` (to another host of this pool), `hosts/<uuid>/actions/restart_toolstack`.",
  "- Never: deleting anything (`xo-cli rest del`), configuration, tags or HA (`rest patch`, `rest put`), cloning or reverting a VM, unplugging storage, a host's shutdown, reboot, evacuation, detach or forget, pool-wide actions, imports and exports.",
].join("\n");

const XcpNgCommandPolicy: ResourceToolPolicy = {
  name: "xo-cli",
  programs: [XO_CLI_PROGRAM],
  readCommandGuide: READ_COMMAND_GUIDE,
  writeCommandGuide: WRITE_COMMAND_GUIDE,
  /*
   * An entry for a change that always asks a person (a migration, a
   * toolstack restart) would read as pre-approving it: refused when saved.
   */
  refusesAlwaysAskingAllowlistEntries: true,
  isProtectedTarget(target: string, protectedTarget: string): boolean {
    return matchesBareUuidEntry(target, protectedTarget);
  },
  protectedTargetNote:
    "The XCP-ng AI agent protects what ONEUPTIME_AI_PROTECTED_TARGETS names: put the UUIDs of the VM it runs in and of Xen Orchestra's own VM there.",
  isTargetInWriteScope(
    target: string,
    writeTargets: ReadonlyArray<string>,
  ): boolean {
    return writeTargets.some((entry: string): boolean => {
      return matchesBareUuidEntry(target, entry);
    });
  },
  describeTargetEntryProblem(entry: string): string | null {
    try {
      return describeTargetEntryProblem(entry);
    } catch {
      return "this entry cannot be read, so the agent stays read-only until it is fixed";
    }
  },
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    let analysis: XoAnalysis;

    try {
      analysis = analyzeXcpNgArgv(argv);
    } catch {
      return deniedResult(
        argv,
        "the xo-cli command policy could not evaluate this command",
      );
    }

    if (!analysis.allowed) {
      return deniedResult(argv, analysis.reason);
    }

    const words: Array<string> = argv.slice();
    const result: ResourceCommandPolicyResult = {
      tier: analysis.tier,
      reason: analysis.reason,
      program: XO_CLI_PROGRAM,
      args: words.slice(1),
      verb: analysis.verb,
      displayCommand: renderResourceDisplayCommand(words),
      targets: analysis.targets.slice(),
    };

    if (analysis.requiresHuman) {
      result.requiresHuman = true;
    }

    return result;
  },
};

export default XcpNgCommandPolicy;
