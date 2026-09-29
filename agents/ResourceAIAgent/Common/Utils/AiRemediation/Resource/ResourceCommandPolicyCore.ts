/*
 * The tool-agnostic half of the resource command policy: the tokenizer,
 * the result shape every tool policy returns, display rendering, glob and
 * allowlist matching, and the auto-execution ladder.
 *
 * Every command OneUptime AI composes for an infrastructure resource is an
 * argv — never a shell line. The agent spawns argv[0] with argv[1..] and no
 * shell, so shell syntax could never do what the model meant by it; it is
 * refused here with a message that says so, rather than being passed to the
 * program as literal words it would misread.
 *
 * Pure and import-closed on purpose: this directory (with
 * Types/ResourceAiAgent and Types/AutoRemediation/
 * AiRemediationCommandPolicyVerdict) is copied byte-identically into the
 * resource AI agent (agents/ResourceAIAgent), which enforces the same policy
 * before it spawns anything. It may import only those files, by relative
 * path, and nothing from Node.
 */

import {
  AiRemediationCommandPolicyVerdict,
  MAX_COMMAND_LENGTH_CHARS,
} from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";

// The most words (program included) one command may have.
export const MAX_RESOURCE_COMMAND_TOKENS: number = 64;

export interface ResourceTokenizeResult {
  // The words, the program included as argv[0]; set when the command parsed.
  argv?: Array<string> | undefined;
  // Why the command could not be read as one argv; set when it did not.
  errorMessage?: string | undefined;
}

/*
 * The one-line phrase every shell-syntax refusal carries, so the model (and
 * a person reading an approval card) learns the rule, not just the symptom.
 */
export const RESOURCE_SHELL_SYNTAX_RULE: string =
  "pipes and redirects are not supported; run one command";

/*
 * Words a model writes out of shell habit that would change who runs the
 * command. The agent runs everything with its own permissions only.
 */
const PRIVILEGE_ESCALATION_PROGRAMS: ReadonlyArray<string> = [
  "sudo",
  "doas",
  "su",
  "pkexec",
];

function describeShellSyntax(character: string): string {
  switch (character) {
    case "|":
      return "a pipe (|)";
    case ";":
      return "a command separator (;)";
    case "&":
      return "a background or chaining operator (&)";
    case ">":
      return "an output redirect (>)";
    case "<":
      return "an input redirect (<)";
    case "`":
      return "command substitution (`...`)";
    default:
      return "command substitution ($(...))";
  }
}

function shellSyntaxError(character: string, quoted: boolean): string {
  return `The command contains ${describeShellSyntax(character)}${
    quoted ? " inside double quotes" : ""
  }: ${RESOURCE_SHELL_SYNTAX_RULE}. Commands never run through a shell, so chaining, redirection and substitution are unavailable${
    quoted
      ? ""
      : " — quote the character (or put a backslash before it) if it is part of an argument"
  }.`;
}

/*
 * Split a command line into an argv the way a POSIX shell would split it
 * for quoting purposes ONLY: single quotes, double quotes and backslash
 * escapes. Nothing is expanded.
 *
 * Refused, because a shell would have given them a meaning the agent never
 * will: an unquoted | ; & > < or backtick, an unquoted "$(", and — since a
 * shell expands them even there — a backtick or "$(" inside double quotes.
 * Inside single quotes (or after a backslash) every character is literal.
 * The command must fit on one line (no newline, carriage return or NUL
 * anywhere), be at most MAX_COMMAND_LENGTH_CHARS long and have at most
 * MAX_RESOURCE_COMMAND_TOKENS words. A leading sudo (or doas, su, pkexec) is
 * refused outright rather than stripped: the agent never runs anything with
 * more than its own permissions.
 */
export function tokenizeResourceCommand(
  command: string,
): ResourceTokenizeResult {
  const text: string = typeof command === "string" ? command.trim() : "";

  if (!text) {
    return { errorMessage: "Empty command." };
  }

  if (text.length > MAX_COMMAND_LENGTH_CHARS) {
    return {
      errorMessage: `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
    };
  }

  if (text.includes("\n") || text.includes("\r") || text.includes("\0")) {
    return {
      errorMessage: `A command must be a single line: ${RESOURCE_SHELL_SYNTAX_RULE}.`,
    };
  }

  const argv: Array<string> = [];
  let current: string = "";
  let inSingle: boolean = false;
  let inDouble: boolean = false;
  let hasToken: boolean = false;

  for (let i: number = 0; i < text.length; i++) {
    const ch: string = text.charAt(i);
    const next: string = i + 1 < text.length ? text.charAt(i + 1) : "";

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === "\\" && next !== "") {
        // POSIX: inside double quotes a backslash escapes only these.
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          current += next;
          i++;
        } else {
          current += ch;
        }
      } else if (ch === "`") {
        return { errorMessage: shellSyntaxError("`", true) };
      } else if (ch === "$" && next === "(") {
        return { errorMessage: shellSyntaxError("$(", true) };
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      continue;
    }

    if (ch === "\\" && next !== "") {
      current += next;
      hasToken = true;
      i++;
      continue;
    }

    if (ch === " " || ch === "\t") {
      if (hasToken) {
        argv.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }

    if (
      ch === "|" ||
      ch === ";" ||
      ch === "&" ||
      ch === ">" ||
      ch === "<" ||
      ch === "`"
    ) {
      return { errorMessage: shellSyntaxError(ch, false) };
    }

    if (ch === "$" && next === "(") {
      return { errorMessage: shellSyntaxError("$(", false) };
    }

    current += ch;
    hasToken = true;
  }

  if (inSingle || inDouble) {
    return { errorMessage: "Unbalanced quotes in the command." };
  }

  if (hasToken) {
    argv.push(current);
  }

  if (argv.length === 0) {
    return { errorMessage: "Empty command." };
  }

  if (argv.length > MAX_RESOURCE_COMMAND_TOKENS) {
    return {
      errorMessage: `A command may have at most ${MAX_RESOURCE_COMMAND_TOKENS} words.`,
    };
  }

  const privilegeRefusal: string | null = getPrivilegeEscalationRefusal(
    argv[0] || "",
  );

  if (privilegeRefusal) {
    return { errorMessage: privilegeRefusal };
  }

  return { argv };
}

/*
 * Why argv[0] asks for more privilege than the agent has, or null. Shared by
 * the tokenizer and the dispatcher so a string and an argv are refused with
 * the same words.
 */
export function getPrivilegeEscalationRefusal(program: string): string | null {
  const folded: string = program.trim().toLowerCase();
  const base: string = folded.slice(folded.lastIndexOf("/") + 1);

  if (!PRIVILEGE_ESCALATION_PROGRAMS.includes(base)) {
    return null;
  }

  return `"${program}" is not supported: the AI agent runs every command with its own permissions only, so drop ${base} and run the command itself.`;
}

/*
 * What a tool policy says about one command. Every caller — the server
 * tools, the enqueue chokepoint and the agent — acts on this and nothing
 * else.
 */
export interface ResourceCommandPolicyResult {
  tier: ResourceCommandTier;
  // Why this tier; shown to the model and on approval cards.
  reason: string;
  // argv[0]: "docker", "pvesh", "govc", "ceph", "db", "systemctl", ...
  program: string;
  // argv WITHOUT the program, as the tool policy normalized it.
  args: Array<string>;
  /*
   * An audit label for what the command does: "ps", "restart",
   * "service update", "get", "vm.power", "osd out", "cancel_query".
   */
  verb: string;
  // The command rendered for humans; round-trips through tokenizeResourceCommand.
  displayCommand: string;
  /*
   * The named objects a WRITE touches, in the canonical form the agent's
   * protectedTargets and ONEUPTIME_AI_WRITE_TARGETS globs are compared with
   * (container names/ids, service names, "node/vmid", VM paths, osd ids,
   * pids, full unit names). [] for reads, and for a write that names no
   * object (a cluster-wide flag).
   */
  targets: Array<string>;
  /*
   * A write nothing an operator configures may run unattended — a node
   * drain, host maintenance, killing a pid. Always asks a human, in every
   * mode, Bypass approval and the allowlist included.
   */
  requiresHuman?: boolean | undefined;
}

/*
 * One tool's policy: docker (engine or swarm), pvesh, govc, ceph, the db
 * catalog, the host CLIs. Implemented once per tool module; the dispatcher
 * (ResourceCommandPolicy) picks the module from the resource type and has
 * already checked argv[0] against the type's programs.
 */
export interface ResourceToolPolicy {
  // "docker-engine", "docker-swarm", "pvesh", "govc", "ceph", "db", "host".
  readonly name: string;
  readonly programs: ReadonlyArray<string>;
  /*
   * Compact markdown bullets naming the read commands this tool allows, for
   * the investigation tool's description (what the model may run to look).
   */
  readonly readCommandGuide: string;
  /*
   * Compact markdown bullets naming the changes this tool allows and their
   * tiers, for the remediation tools' descriptions.
   */
  readonly writeCommandGuide: string;
  /*
   * Words this tool's grammar accepts where an allowlist entry has a `*`
   * (an OSD id, a daemon name, a VMID, a weight, ...), tried besides the
   * generic stand-ins when deciding whether an entry could ever pre-approve
   * a change. Give at least two values of each kind, so a `*` that names
   * the target can be seen to change it. Optional: a tool whose arguments
   * the generic stand-ins already satisfy needs none.
   */
  readonly allowlistStandIns?: ReadonlyArray<string> | undefined;
  /*
   * Optional: whether a protected entry names this target in a way the
   * dispatcher's own comparison (the whole word, a glob, a hex id prefix)
   * cannot see — for a tool whose objects go by several spellings (govc:
   * "vcsa" and "/DC/vm/infra/vcsa" are the same VM). Asked on top of that
   * comparison, never instead of it, so it can only protect more. MUST
   * NOT throw (a throw is read as "protected").
   */
  readonly isProtectedTarget?:
    | ((target: string, protectedTarget: string) => boolean)
    | undefined;
  /*
   * argv includes the program. MUST be total — never throw, whatever the
   * argv holds — and fail closed: anything the tool does not recognise is
   * Denied.
   */
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult;
}

// Only the string words of an argv; anything else is not a word.
function stringWords(argv: unknown): Array<string> {
  if (!Array.isArray(argv)) {
    return [];
  }

  return argv.filter((word: unknown): word is string => {
    return typeof word === "string";
  });
}

// A Denied result for this argv, with the reason shown to the model.
export function deniedResult(
  argv: Array<string>,
  reason: string,
): ResourceCommandPolicyResult {
  const words: Array<string> = stringWords(argv);

  return {
    tier: ResourceCommandTier.Denied,
    reason,
    program: words[0] || "",
    args: words.slice(1),
    verb: "",
    displayCommand: renderResourceDisplayCommand(words),
    targets: [],
  };
}

// Words a shell would read back unchanged, so they need no quotes.
const SHELL_SAFE_TOKEN: RegExp = /^[A-Za-z0-9_@%+=:,./-]+$/;

/*
 * Render an argv back to the one-line form humans read on approval cards
 * and in the activity feed. Words that would not survive a shell split are
 * single-quoted, so the rendering round-trips through
 * tokenizeResourceCommand.
 */
export function renderResourceDisplayCommand(argv: Array<string>): string {
  return stringWords(argv)
    .map((word: string): string => {
      if (word === "") {
        return "''";
      }

      if (SHELL_SAFE_TOKEN.test(word)) {
        return word;
      }

      return `'${word.replace(/'/g, `'\\''`)}'`;
    })
    .join(" ");
}

/*
 * Does a target glob name this target? `*` matches any run of characters
 * (none included) within the one target; everything else is compared
 * exactly, case-sensitively, and the pattern is anchored at both ends.
 *
 * A linear two-pointer scan, deliberately NOT a compiled regex: a pattern
 * like "*a*a*a*a*b" against a long non-matching target would backtrack
 * catastrophically in a regex (see CommandPolicy.globMatches, which this
 * mirrors — copied, not imported, because this directory is import-closed).
 */
export function globMatchesTarget(pattern: string, target: string): boolean {
  if (typeof pattern !== "string" || typeof target !== "string") {
    return false;
  }

  let patternIndex: number = 0;
  let targetIndex: number = 0;
  let lastWildcardIndex: number = -1;
  let matchAfterWildcard: number = 0;

  while (targetIndex < target.length) {
    // The wildcard branch first: a target may hold a literal "*" too.
    if (patternIndex < pattern.length && pattern.charAt(patternIndex) === "*") {
      lastWildcardIndex = patternIndex;
      matchAfterWildcard = targetIndex;
      patternIndex++;
      continue;
    }

    if (
      patternIndex < pattern.length &&
      pattern.charAt(patternIndex) === target.charAt(targetIndex)
    ) {
      patternIndex++;
      targetIndex++;
      continue;
    }

    if (lastWildcardIndex >= 0) {
      // Give the last wildcard one more character and retry from there.
      patternIndex = lastWildcardIndex + 1;
      matchAfterWildcard++;
      targetIndex = matchAfterWildcard;
      continue;
    }

    return false;
  }

  // Trailing wildcards may absorb the empty remainder.
  while (
    patternIndex < pattern.length &&
    pattern.charAt(patternIndex) === "*"
  ) {
    patternIndex++;
  }

  return patternIndex === pattern.length;
}

// A pattern word that stands for exactly one word of the command.
export const ALLOWLIST_WILDCARD_TOKEN: string = "*";

/*
 * Does an allowlist entry (tokenized, program included) name this argv
 * (program included)? Token by token: both must have the same number of
 * words, a pattern word that is exactly "*" matches any one word, and every
 * other word must be equal — case-sensitively, with no globbing inside a
 * word. Tier-blind on purpose: the ladder decides which tiers the allowlist
 * may promote.
 */
export function allowlistPatternMatches(
  patternArgv: Array<string>,
  argv: Array<string>,
): boolean {
  if (!Array.isArray(patternArgv) || !Array.isArray(argv)) {
    return false;
  }

  if (patternArgv.length === 0 || patternArgv.length !== argv.length) {
    return false;
  }

  for (let i: number = 0; i < patternArgv.length; i++) {
    const patternWord: unknown = patternArgv[i];
    const word: unknown = argv[i];

    if (typeof patternWord !== "string" || typeof word !== "string") {
      return false;
    }

    if (patternWord === ALLOWLIST_WILDCARD_TOKEN) {
      continue;
    }

    if (patternWord !== word) {
      return false;
    }
  }

  return true;
}

// The remediation verdict for one command under a resource's settings.
export interface ResourceAutoExecutionVerdict {
  verdict: AiRemediationCommandPolicyVerdict;
  tier: ResourceCommandTier;
  reason: string;
  requiresHuman?: boolean | undefined;
}

/*
 * The auto-execution ladder, identical in spirit to
 * KubectlPolicy.evaluateForAutoExecution:
 *
 *   Denied            -> Denied (never runs, whoever approves it)
 *   Read              -> AutoApproved (it changes nothing; callers route
 *                        reads to the read tool)
 *   requiresHuman     -> RequiresApproval, requiresHuman (beats Bypass
 *                        approval and the allowlist)
 *   SafeWrite         -> AutoApproved
 *   bypassApproval    -> AutoApproved
 *   allowlistMatched  -> AutoApproved
 *   otherwise         -> RequiresApproval
 *
 * Callers apply the mode gate first: Disabled and RequireApproval never
 * reach this. `allowlistMatched` is computed by the caller (the dispatcher
 * matches the resource's allowlist), so this stays a pure function of its
 * inputs.
 */
export function applyAutoExecutionLadder(
  result: ResourceCommandPolicyResult,
  options: { allowlistMatched: boolean; bypassApproval: boolean },
): ResourceAutoExecutionVerdict {
  if (!result || typeof result !== "object") {
    return {
      verdict: AiRemediationCommandPolicyVerdict.Denied,
      tier: ResourceCommandTier.Denied,
      reason:
        "Denied by the resource command policy: the command could not be evaluated. This command cannot run even with human approval.",
    };
  }

  const reason: string = result.reason || "no reason given";

  switch (result.tier) {
    case ResourceCommandTier.Read:
      return {
        verdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        tier: result.tier,
        reason,
      };

    case ResourceCommandTier.SafeWrite:
    case ResourceCommandTier.RiskyWrite:
      break;

    default:
      return {
        verdict: AiRemediationCommandPolicyVerdict.Denied,
        tier: ResourceCommandTier.Denied,
        reason: `Denied by the resource command policy: ${reason}. This command cannot run even with human approval.`,
      };
  }

  // Before SafeWrite, bypass and the allowlist: nothing an operator sets applies.
  if (result.requiresHuman === true) {
    return {
      verdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      tier: result.tier,
      reason: `Requires human approval: ${reason}. Neither bypassing approvals nor the resource's allowlist applies to this command.`,
      requiresHuman: true,
    };
  }

  if (result.tier === ResourceCommandTier.SafeWrite) {
    return {
      verdict: AiRemediationCommandPolicyVerdict.AutoApproved,
      tier: result.tier,
      reason,
    };
  }

  if (options && options.bypassApproval === true) {
    return {
      verdict: AiRemediationCommandPolicyVerdict.AutoApproved,
      tier: result.tier,
      reason: `Riskier change (${reason}) allowed without approval: the resource bypasses approvals.`,
    };
  }

  if (options && options.allowlistMatched === true) {
    return {
      verdict: AiRemediationCommandPolicyVerdict.AutoApproved,
      tier: result.tier,
      reason: "Matched the resource's command allowlist.",
    };
  }

  return {
    verdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    tier: result.tier,
    reason: `Requires human approval: ${reason}.`,
  };
}
