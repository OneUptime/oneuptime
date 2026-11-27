import { JSONObject } from "../../JSON";

/*
 * WHETHER A TOOL OF AN EXTERNAL MCP SERVER COUNTS AS ONE THAT ONLY READS,
 * when its server does not say (issue #11081).
 *
 * OneUptime AI calls a tool without asking anyone - in an investigation, in
 * a fix's planning, in Slack and Microsoft Teams, at once in Ask AI - only
 * when it only reads. A server says so with `annotations.readOnlyHint:
 * true`. kAgent's tool server says nothing about any of its tools
 * (kagent-dev/tools 0.3, on the official Go SDK, registers each with a name
 * and a description only), so even `k8s_get_resources` waited for a card in
 * Ask AI and never helped an investigation.
 *
 * So a Project Owner or Project Admin may mark such a tool read-only, one
 * tool at a time, on the server's page (ExternalMcpToolReadOnlyMark). Safety
 * comes first - a tool marked read-only that changes something lets
 * OneUptime AI change it with nobody asking:
 *
 *   - only a tool its server says nothing about can be marked. A server
 *     that marks a tool as one that may change something (readOnlyHint
 *     false, or destructiveHint true) is taken at its word. That includes
 *     every tool of a server built on mcp-go that its author did not
 *     annotate: mcp-go writes those defaults out (kagent-dev/tools 0.2, as
 *     recorded), and OneUptime cannot tell a library's default from an
 *     author's word;
 *   - a tool whose name or arguments say it changes something - "delete",
 *     "apply", a command to run, a switch that installs - can never be
 *     marked (getExternalMcpToolMarkRefusal). The list is a backstop for
 *     the plain cases, not a judge of the rest: whoever marks a tool still
 *     reads what it does;
 *   - a mark holds the tool's definition as OneUptime read it - its name,
 *     its description and its input schema, as a fingerprint
 *     (Server/Utils/AI/Mcp/McpToolFingerprint). A server that changes the
 *     tool changes its fingerprint, and the mark stops holding until
 *     someone marks it again. Every run reads the tools anew and holds the
 *     mark to what it read, never to what the page last showed.
 *
 * Shared by the server and the Dashboard: it imports nothing but types.
 */

export enum ExternalMcpToolReadOnlyStatus {
  // The server marks it read-only (readOnlyHint: true).
  ServerMarksReadOnly = "ServerMarksReadOnly",
  // A Project Admin marked it read-only, and the tool is as it was then.
  MarkedReadOnly = "MarkedReadOnly",
  /*
   * A Project Admin marked it read-only, and the server has changed it
   * since: it may change something until someone marks it again.
   */
  MarkLapsed = "MarkLapsed",
  // The server does not say, and nobody marked it: it may change something.
  NotMarked = "NotMarked",
  /*
   * The server marks it as one that may change something (readOnlyHint
   * false, or destructiveHint true). It cannot be marked read-only.
   */
  ServerMarksChange = "ServerMarksChange",
  // Its name or its arguments say it changes something: it cannot be marked.
  CannotBeMarked = "CannotBeMarked",
}

// The statuses with which OneUptime AI calls a tool without asking anyone.
export function isExternalMcpToolReadOnly(
  status: ExternalMcpToolReadOnlyStatus,
): boolean {
  return (
    status === ExternalMcpToolReadOnlyStatus.ServerMarksReadOnly ||
    status === ExternalMcpToolReadOnlyStatus.MarkedReadOnly
  );
}

// Why OneUptime never lets a tool be marked read-only.
export enum ExternalMcpToolMarkRefusalKind {
  // A word of its name says it changes something: "delete", "apply".
  NameSaysItChanges = "NameSaysItChanges",
  // It runs what it is given: an argument named command, script or sql.
  RunsWhatItIsGiven = "RunsWhatItIsGiven",
  /*
   * An argument can make it change something: should_install, dry_run, or
   * an action that can be "delete" (or any action at all).
   */
  ArgumentCanChange = "ArgumentCanChange",
}

export interface ExternalMcpToolMarkRefusal {
  kind: ExternalMcpToolMarkRefusalKind;
  // The word that says so, as the tool spells it: "delete", "command".
  word: string;
  // For an argument's value: the argument it is a value of ("action").
  argument?: string | undefined;
}

/*
 * The verbs that say a tool changes something, when they are the first verb
 * of its name (k8s_delete_resource, deleteIssue, pods.delete) or joined to
 * it with "or" or "and" (get_or_create_branch), when they are a word of an
 * argument's name that switches a change on (should_install), and when they
 * are a value an argument that picks what the tool does can take (action:
 * "delete"). Words that are as often a noun in a tool's name ("label" in
 * prometheus_label_names_tool, "rollout" in rollout_status, "tag",
 * "schedule", "open") are left out.
 */
const CHANGE_VERBS: ReadonlySet<string> = new Set<string>([
  "add",
  "annotate",
  "apply",
  "approve",
  "archive",
  "assign",
  "attach",
  "ban",
  "call",
  "cancel",
  "close",
  "commit",
  "connect",
  "cordon",
  "create",
  "deactivate",
  "delete",
  "deploy",
  "destroy",
  "detach",
  "disable",
  "disconnect",
  "dismiss",
  "downgrade",
  "drain",
  "drop",
  "edit",
  "enable",
  "erase",
  "evict",
  "exec",
  "execute",
  "flush",
  "fork",
  "grant",
  "import",
  "insert",
  "install",
  "invite",
  "invoke",
  "kill",
  "lock",
  "manage",
  "mark",
  "merge",
  "migrate",
  "modify",
  "mount",
  "move",
  "mute",
  "overwrite",
  "patch",
  "pause",
  "post",
  "promote",
  "publish",
  "purge",
  "push",
  "put",
  "reboot",
  "reject",
  "remove",
  "rename",
  "reopen",
  "replace",
  "rerun",
  "reset",
  "restart",
  "restore",
  "resume",
  "retry",
  "revert",
  "revoke",
  "rollback",
  "run",
  "scale",
  "send",
  "set",
  "shell",
  "shutdown",
  "start",
  "stop",
  "submit",
  "subscribe",
  "suspend",
  "taint",
  "terminate",
  "toggle",
  "transfer",
  "trigger",
  "truncate",
  "unarchive",
  "unassign",
  "unban",
  "uncordon",
  "uninstall",
  "unlock",
  "unmount",
  "unmute",
  "unset",
  "unsubscribe",
  "unsuspend",
  "update",
  "upgrade",
  "upload",
  "upsert",
  "wipe",
  "write",
]);

/*
 * The verbs that say a tool reads, when they come first in its name: a
 * change verb after one is what it reads about
 * (argo_verify_argo_rollouts_controller_install), not what it does - unless
 * "or" or "and" joins the two (get_or_create_branch).
 */
const READ_VERBS: ReadonlySet<string> = new Set<string>([
  "analyse",
  "analyze",
  "browse",
  "check",
  "compare",
  "count",
  "describe",
  "diff",
  "display",
  "echo",
  "estimate",
  "explain",
  "fetch",
  "find",
  "get",
  "health",
  "inspect",
  "list",
  "lookup",
  "peek",
  "ping",
  "preview",
  "query",
  "read",
  "retrieve",
  "search",
  "show",
  "stat",
  "status",
  "summarize",
  "tail",
  "validate",
  "verify",
  "version",
  "view",
  "wait",
  "watch",
]);

// The words that join two verbs of a name: get_or_create, list_and_delete.
const JOINING_WORDS: ReadonlySet<string> = new Set<string>(["or", "and"]);

/*
 * A word of an argument's name that says the tool runs what it is given: a
 * command, a script, a statement. Whatever else the tool does, it does what
 * the call asks.
 */
const RUNS_WHAT_IT_IS_GIVEN_WORDS: ReadonlySet<string> = new Set<string>([
  "cmd",
  "command",
  "commands",
  "script",
  "shell",
  "sql",
]);

/*
 * A word of an argument's name that switches a change on: should_install,
 * force_delete, restart_after. A read tool's switches are about what it
 * reads (all_namespaces, enable_k8s), so only these few count.
 */
const ARGUMENT_CHANGE_WORDS: ReadonlySet<string> = new Set<string>([
  "apply",
  "delete",
  "destroy",
  "drop",
  "install",
  "kill",
  "overwrite",
  "purge",
  "reboot",
  "remove",
  "restart",
  "terminate",
  "uninstall",
  "wipe",
]);

/*
 * An argument named for a preview of a change (dry_run): the tool makes the
 * change when it is false.
 */
const DRY_RUN_NAMES: ReadonlySet<string> = new Set<string>([
  "dry_run",
  "dryrun",
  "dry-run",
]);

/*
 * An argument that picks what the tool does: free text, it can be anything;
 * a list of choices, it changes something when one of them is a change verb
 * or a method that writes.
 */
const SELECTOR_ARGUMENT_NAMES: ReadonlySet<string> = new Set<string>([
  "action",
  "method",
  "op",
  "operation",
  "subcommand",
  "verb",
]);

// The HTTP methods that write, as a selector's choice.
const WRITING_HTTP_METHODS: ReadonlySet<string> = new Set<string>([
  "delete",
  "patch",
  "post",
  "put",
]);

// The most arguments, and the most choices of one, read: a schema is the server's text.
const MAX_ARGUMENTS_READ: number = 200;
const MAX_CHOICES_READ: number = 200;

// A word boundary inside a camelCase or PascalCase name: deleteIssue, HTTPGet.
const CAMEL_CASE_BOUNDARY: RegExp = /([a-z0-9])([A-Z])|([A-Z])([A-Z][a-z])/g;

// Anything that is not a letter or a digit separates words: _ - . / space.
const WORD_SEPARATOR: RegExp = /[^A-Za-z0-9]+/;

/*
 * The words of a name, in lower case: k8s_get_resources -> k8s, get,
 * resources; deleteIssue -> delete, issue; "events.list/recent pods" ->
 * events, list, recent, pods.
 */
export function splitExternalMcpToolWords(name: string): Array<string> {
  return name
    .slice(0, 256)
    .replace(CAMEL_CASE_BOUNDARY, (...groups: Array<unknown>): string => {
      // ([a-z0-9])([A-Z]) or ([A-Z])([A-Z][a-z]): a space between each pair.
      const [, lower, upper, capital, word] = groups as Array<
        string | undefined
      >;

      return lower !== undefined ? `${lower} ${upper}` : `${capital} ${word}`;
    })
    .split(WORD_SEPARATOR)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .map((word: string): string => {
      return word.toLowerCase();
    });
}

/*
 * The change verb a name does, or null: its first verb, when that is a
 * change verb, or a change verb joined to it with "or" or "and".
 */
function findChangeVerbOfName(name: string): string | null {
  const words: Array<string> = splitExternalMcpToolWords(name);

  for (let index: number = 0; index < words.length; index++) {
    const word: string = words[index]!;

    if (CHANGE_VERBS.has(word)) {
      return word;
    }

    if (!READ_VERBS.has(word)) {
      continue;
    }

    // A read verb comes first: only a verb joined to it can still change.
    let next: number = index + 1;

    while (
      next + 1 < words.length &&
      JOINING_WORDS.has(words[next]!) &&
      (CHANGE_VERBS.has(words[next + 1]!) || READ_VERBS.has(words[next + 1]!))
    ) {
      if (CHANGE_VERBS.has(words[next + 1]!)) {
        return words[next + 1]!;
      }

      next += 2;
    }

    return null;
  }

  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The choices an argument may take, when its schema lists them (enum, or oneOf / anyOf of consts).
function readChoices(schema: Record<string, unknown>): Array<string> | null {
  const choices: Array<string> = [];
  let isListed: boolean = false;

  const take: (value: unknown) => void = (value: unknown): void => {
    if (typeof value === "string" && choices.length < MAX_CHOICES_READ) {
      choices.push(value);
    }
  };

  if (Array.isArray(schema["enum"])) {
    isListed = true;
    (schema["enum"] as Array<unknown>).forEach(take);
  }

  if (schema["const"] !== undefined) {
    isListed = true;
    take(schema["const"]);
  }

  for (const key of ["oneOf", "anyOf"]) {
    const options: unknown = schema[key];

    if (!Array.isArray(options)) {
      continue;
    }

    for (const option of options as Array<unknown>) {
      if (isObject(option) && option["const"] !== undefined) {
        isListed = true;
        take(option["const"]);
      } else if (isObject(option) && Array.isArray(option["enum"])) {
        isListed = true;
        (option["enum"] as Array<unknown>).forEach(take);
      }
    }
  }

  return isListed ? choices : null;
}

// Why an argument means the tool may change something, or null.
function findArgumentRefusal(
  argument: string,
  schema: unknown,
): ExternalMcpToolMarkRefusal | null {
  const words: Array<string> = splitExternalMcpToolWords(argument);

  for (const word of words) {
    if (RUNS_WHAT_IT_IS_GIVEN_WORDS.has(word)) {
      return {
        kind: ExternalMcpToolMarkRefusalKind.RunsWhatItIsGiven,
        word: argument,
      };
    }
  }

  if (DRY_RUN_NAMES.has(argument.toLowerCase())) {
    return {
      kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
      word: argument,
    };
  }

  for (const word of words) {
    if (ARGUMENT_CHANGE_WORDS.has(word)) {
      return {
        kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
        word: argument,
      };
    }
  }

  if (!SELECTOR_ARGUMENT_NAMES.has(argument.toLowerCase())) {
    return null;
  }

  const choices: Array<string> | null = isObject(schema)
    ? readChoices(schema)
    : null;

  // Free text picks anything the tool can do.
  if (choices === null) {
    return {
      kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
      word: argument,
    };
  }

  for (const choice of choices) {
    const value: string = choice.trim().toLowerCase();

    if (
      CHANGE_VERBS.has(value) ||
      WRITING_HTTP_METHODS.has(value) ||
      findChangeVerbOfName(choice) !== null
    ) {
      return {
        kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
        word: choice,
        argument,
      };
    }
  }

  return null;
}

/*
 * Why OneUptime never lets this tool be marked read-only, or null: its name
 * says it changes something, or one of its arguments does - it runs a
 * command it is given, switches a change on, or picks among choices one of
 * which is a change. Read from the tool's name and its input schema as the
 * server sent them; the top-level arguments only, as a call sends them.
 */
export function getExternalMcpToolMarkRefusal(tool: {
  name: string;
  inputSchema?: JSONObject | undefined;
}): ExternalMcpToolMarkRefusal | null {
  const verb: string | null = findChangeVerbOfName(tool.name);

  if (verb) {
    return {
      kind: ExternalMcpToolMarkRefusalKind.NameSaysItChanges,
      word: verb,
    };
  }

  const properties: unknown = tool.inputSchema?.["properties"];

  if (!isObject(properties)) {
    return null;
  }

  for (const argument of Object.keys(properties).slice(0, MAX_ARGUMENTS_READ)) {
    const refusal: ExternalMcpToolMarkRefusal | null = findArgumentRefusal(
      argument,
      properties[argument],
    );

    if (refusal) {
      return refusal;
    }
  }

  return null;
}

// A tool's mark, as the run or the page reads it: the definition it holds.
export interface ExternalMcpToolMarkFingerprint {
  toolFingerprint?: string | undefined | null;
}

// What deciding a tool's status reads of the tool, as stored or as just read.
export interface ExternalMcpToolForStatus {
  // The server marks it read-only (readOnlyHint true).
  readsOnly: boolean;
  /*
   * The server marks it as one that may change something: readOnlyHint
   * false, or destructiveHint true.
   */
  serverMarksAsChange?: boolean | undefined;
  /*
   * Its definition's fingerprint, as OneUptime read it. A tool stored
   * before marks existed has none, and cannot be marked until it is read
   * again.
   */
  fingerprint?: string | undefined;
  // Why it can never be marked, read with the tool (getExternalMcpToolMarkRefusal).
  markRefusal?: ExternalMcpToolMarkRefusal | undefined;
}

/*
 * Whether a tool counts as one that only reads, and why: the server's own
 * word first - read-only, or a change - then OneUptime's refusal of a tool
 * that plainly changes something, then a Project Admin's mark, held only
 * while the tool is as it was when marked.
 */
export function getExternalMcpToolReadOnlyStatus(data: {
  tool: ExternalMcpToolForStatus;
  // The tool's marks (none, one, or one per admin who marked it at once).
  marks?: Array<ExternalMcpToolMarkFingerprint> | undefined;
}): ExternalMcpToolReadOnlyStatus {
  const tool: ExternalMcpToolForStatus = data.tool;

  if (tool.readsOnly) {
    return ExternalMcpToolReadOnlyStatus.ServerMarksReadOnly;
  }

  if (tool.serverMarksAsChange) {
    return ExternalMcpToolReadOnlyStatus.ServerMarksChange;
  }

  if (tool.markRefusal) {
    return ExternalMcpToolReadOnlyStatus.CannotBeMarked;
  }

  const marks: Array<ExternalMcpToolMarkFingerprint> = data.marks || [];

  if (marks.length === 0) {
    return ExternalMcpToolReadOnlyStatus.NotMarked;
  }

  const holds: boolean = Boolean(
    tool.fingerprint &&
      marks.some((mark: ExternalMcpToolMarkFingerprint): boolean => {
        return mark.toolFingerprint === tool.fingerprint;
      }),
  );

  return holds
    ? ExternalMcpToolReadOnlyStatus.MarkedReadOnly
    : ExternalMcpToolReadOnlyStatus.MarkLapsed;
}

/*
 * Whether a Project Admin may mark the tool read-only now: the server says
 * nothing about it, nothing about it says it changes something, OneUptime
 * has read its definition (its fingerprint), and it is not marked as it is.
 */
export function canExternalMcpToolBeMarked(data: {
  tool: ExternalMcpToolForStatus;
  marks?: Array<ExternalMcpToolMarkFingerprint> | undefined;
}): boolean {
  if (!data.tool.fingerprint) {
    return false;
  }

  const status: ExternalMcpToolReadOnlyStatus =
    getExternalMcpToolReadOnlyStatus(data);

  return (
    status === ExternalMcpToolReadOnlyStatus.NotMarked ||
    status === ExternalMcpToolReadOnlyStatus.MarkLapsed
  );
}

// A fingerprint as stored: 64 lower-case hex digits (SHA-256).
const FINGERPRINT_PATTERN: RegExp = /^[0-9a-f]{64}$/;

export function isExternalMcpToolFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

// A refusal as stored with a tool, read back defensively, or undefined.
export function readExternalMcpToolMarkRefusal(
  value: unknown,
): ExternalMcpToolMarkRefusal | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const kind: unknown = value["kind"];
  const word: unknown = value["word"];
  const argument: unknown = value["argument"];

  if (
    !Object.values(ExternalMcpToolMarkRefusalKind).includes(
      kind as ExternalMcpToolMarkRefusalKind,
    ) ||
    typeof word !== "string" ||
    !word.trim()
  ) {
    return undefined;
  }

  const refusal: ExternalMcpToolMarkRefusal = {
    kind: kind as ExternalMcpToolMarkRefusalKind,
    word: word.trim().slice(0, 128),
  };

  if (typeof argument === "string" && argument.trim()) {
    refusal.argument = argument.trim().slice(0, 128);
  }

  return refusal;
}
