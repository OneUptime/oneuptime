import {
  getAiAccessClusterWideCommandNote,
  getAiAccessHelmCommands,
  getAiAccessScopedCommandNote,
} from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the round-four review found in the OneUptime AI cluster-access
 * copy, and what every page, the chart and the cluster AI page must now
 * say.
 *
 * - Resetting aiAccess.remediation.namespaces. Every copy named
 *   `--set aiAccess.remediation.namespaces=null` as the way back to the
 *   cluster-wide binding, next to the --reuse-values upgrades it shows.
 *   Under --reuse-values Helm coalesces the new overrides into the
 *   release's stored values and deletes a null override whose key those
 *   values hold, so a stored list survives; on a release installed from a
 *   chart without aiAccess (every install before this chart) nothing
 *   swallows the null, it reaches the values schema (namespaces is an
 *   array) and the whole upgrade fails. Both were reproduced with the real
 *   helm binary against a stored release (HELM_DRIVER=memory); helm-unittest
 *   renders from values files and cannot model --reuse-values. The reset
 *   that works is an empty JSON list, `--set-json
 *   'aiAccess.remediation.namespaces=[]'`; `=null` works only without
 *   --reuse-values, e.g. with --reset-then-reuse-values (Helm 3.14+).
 * - Deleting the in-cluster Runner. The server's refusal and gap texts
 *   offer "delete the Runner, and the agent registers a fresh one". The
 *   delete nulls the cluster's binding while aiAccessRunnerBoundAt stays
 *   set, and registration never re-binds such a cluster
 *   (left_unbound_by_operator), so the operator must select the new
 *   Runner on the cluster's AI page afterwards. Every copy that explains
 *   a refused registration says so.
 * - The policy changes of round four: a `patch` of a node always needs a
 *   human, like a drain and a taint (a NoExecute taint written as a node
 *   patch is the same change); `expose --overrides` is refused (the
 *   override decides what kind of object kubectl creates); pod-template
 *   patches of host ports, hostUsers and runtimeClassName are refused
 *   with the other security settings; and an ordinary Runner reports the
 *   write limits it was started with, so a fix outside them is refused
 *   before it reaches it.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");
const CHART_DIR: string = path.join(
  REPOSITORY_ROOT,
  "HelmChart/Public/kubernetes-agent",
);
const DOCS_CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content/en",
);

const AI_SRE_PAGE: string = path.join(DOCS_CONTENT_DIR, "ai/ai-sre.md");
const KUBERNETES_AGENT_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "telemetry/kubernetes-agent.md",
);
const CHART_README: string = path.join(CHART_DIR, "README.md");
const CHART_NOTES: string = path.join(CHART_DIR, "templates/NOTES.txt");
const CHART_VALUES: string = path.join(CHART_DIR, "values.yaml");
const CHART_SCHEMA: string = path.join(CHART_DIR, "values.schema.json");

// How the cluster AI page is named in an expectation.
const AI_PAGE: string = "Pages/Kubernetes/View/AI.tsx";

// The reset of the namespace list that works under --reuse-values.
const EMPTY_LIST_RESET_FLAG: string =
  "--set-json 'aiAccess.remediation.namespaces=[]'";
const NULL_RESET_TEXT: string = "aiAccess.remediation.namespaces=null";

// Line breaks, and the `#` of a YAML comment, read as one space.
const LINE_BREAK_PATTERN: RegExp = /\s*\n\s*#?\s*/g;
// A blank line (or a bare `#` line in a YAML comment) between paragraphs.
const PARAGRAPH_BREAK_PATTERN: RegExp = /\n\s*#?\s*\n/;
// A sentence ends at a full stop or a semicolon followed by a space.
const SENTENCE_END_PATTERN: RegExp = /[.;]\s/g;
/*
 * A mention of `=null` that says it does NOT reset a stored list under
 * --reuse-values, or confines it to an upgrade without --reuse-values.
 */
const NULL_RESET_QUALIFIER_PATTERN: RegExp =
  /does not reset|only works with `?--reset-then-reuse-values|only without `?--reuse-values|without `?--reuse-values`?[^.]{0,40}only/;
// The plain statement that `=null` does not reset a stored list.
const NULL_DOES_NOT_RESET_PATTERN: RegExp =
  /namespaces=null`? does not reset a stored list under `?--reuse-values/;
// Where `=null` does work: --reset-then-reuse-values in place of --reuse-values.
const RESET_THEN_REUSE_PATTERN: RegExp =
  /only works with `?--reset-then-reuse-values`? \(Helm 3\.14\+\) in place of `?--reuse-values/;
// A fenced bash block of a markdown page.
const BASH_BLOCK_PATTERN: RegExp = /```bash\n([\s\S]*?)```/g;
// A backslash-newline line continuation.
const LINE_CONTINUATION_PATTERN: RegExp = /\\\n/g;
// The indented command lines NOTES.txt prints, one command per line.
const NOTES_COMMAND_LINE_PATTERN: RegExp = /^ {2}(helm|kubectl|--set)\b.*$/gm;

// Deleting the agent's Runner row, as the server's texts suggest it.
const DELETE_RUNNER_PATTERN: RegExp = /\bdelete the Runner\b/gi;
// The step after the delete: selecting the fresh Runner on the AI page.
const SELECT_NEW_RUNNER_PATTERN: RegExp =
  /select the new( `kubernetes-agent\/<[a-zA-Z]+>`)? Runner on the cluster's AI page/;
const NEVER_RE_BINDS_PATTERN: RegExp =
  /a registration never re-binds a cluster that had a Runner bound/;

/*
 * A patch of a node named as always needing a human, in the forms the
 * copies use: "a `patch` of a node always needs a human", "... always
 * needs a human; so do a `drain`, a `taint` and a `patch` of a node", "a
 * drain, a taint or a patch of a node without a human", "... and a
 * `patch` of a node are never auto-approved".
 */
const NODE_PATCH_NEEDS_HUMAN_PATTERN: RegExp =
  /\bpatch`? of a node\b[^.;]{0,40}\b(always (needs?|waits? for|wait for) a human|without a human|are never auto-approved|still (waits for|asks) a human)|\bso do a `?drain`?, a `?taint`? and a `?patch`? of a node\b/;
// `kubectl expose --overrides`, which the policy refuses.
const EXPOSE_OVERRIDES_PATTERN: RegExp = /`?expose --overrides`?/;

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function readFlat(filePath: string): string {
  return read(filePath).replace(LINE_BREAK_PATTERN, " ");
}

function relative(filePath: string): string {
  return path.relative(REPOSITORY_ROOT, filePath);
}

// A copy an operator reads, by name, with line breaks read as one space.
interface CopySource {
  label: string;
  text: string;
}

function fileSource(filePath: string): CopySource {
  return { label: relative(filePath), text: readFlat(filePath) };
}

/*
 * The sentence around a position: from the end of the previous sentence
 * to the end of this one.
 */
function getSentenceAt(text: string, index: number): string {
  let start: number = 0;
  let end: number = text.length;
  for (const match of text.matchAll(SENTENCE_END_PATTERN)) {
    const boundary: number = match.index! + 1;
    if (boundary <= index) {
      start = boundary;
    } else {
      end = boundary;
      break;
    }
  }
  return text.slice(start, end).trim();
}

/*
 * Each sentence that offers `=null` as the reset: one that names it
 * without saying it does not reset a stored list under --reuse-values.
 */
function getNullResetAdvice(text: string): Array<string> {
  const advice: Array<string> = [];
  let index: number = text.indexOf(NULL_RESET_TEXT);
  while (index !== -1) {
    const sentence: string = getSentenceAt(text, index);
    if (!NULL_RESET_QUALIFIER_PATTERN.test(sentence)) {
      advice.push(sentence);
    }
    index = text.indexOf(NULL_RESET_TEXT, index + NULL_RESET_TEXT.length);
  }
  return advice;
}

/*
 * Each mention of deleting the Runner whose paragraph does not go on to
 * say that the new Runner must be selected on the cluster's AI page.
 */
function getDeleteWithoutReselect(paragraphs: Array<string>): Array<string> {
  const missing: Array<string> = [];
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(DELETE_RUNNER_PATTERN)) {
      const rest: string = paragraph.slice(match.index!);
      if (!SELECT_NEW_RUNNER_PATTERN.test(rest)) {
        missing.push(rest.slice(0, 200));
      }
    }
  }
  return missing;
}

// A file's paragraphs (blank-line separated), each read as one line.
function getParagraphs(filePath: string): Array<string> {
  return read(filePath)
    .split(PARAGRAPH_BREAK_PATTERN)
    .map((paragraph: string): string => {
      return paragraph.replace(LINE_BREAK_PATTERN, " ");
    });
}

// Every copy-paste command a markdown page shows, continuations joined.
function getMarkdownCommands(filePath: string): Array<string> {
  return Array.from(read(filePath).matchAll(BASH_BLOCK_PATTERN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!.replace(LINE_CONTINUATION_PATTERN, " ");
    },
  );
}

// Every command line NOTES.txt prints.
function getNotesCommands(): Array<string> {
  return Array.from(read(CHART_NOTES).matchAll(NOTES_COMMAND_LINE_PATTERN)).map(
    (match: RegExpMatchArray): string => {
      return match[0];
    },
  );
}

// Everything that tells an operator how to reset the namespace list.
function getResetCopies(): Array<CopySource> {
  return [
    ...[
      AI_SRE_PAGE,
      KUBERNETES_AGENT_PAGE,
      CHART_README,
      CHART_NOTES,
      CHART_VALUES,
      CHART_SCHEMA,
    ].map(fileSource),
    {
      label: `${AI_PAGE} (scoped command note)`,
      text: getAiAccessScopedCommandNote(),
    },
    {
      label: `${AI_PAGE} (cluster-wide command note)`,
      text: getAiAccessClusterWideCommandNote(),
    },
  ];
}

describe("resetting aiAccess.remediation.namespaces under --reuse-values", () => {
  it("names the empty-list --set-json reset in every copy", () => {
    for (const copy of getResetCopies()) {
      expect({
        file: copy.label,
        emptyListReset: copy.text.includes(EMPTY_LIST_RESET_FLAG),
      }).toEqual({ file: copy.label, emptyListReset: true });
    }
  });

  it("never offers `--set aiAccess.remediation.namespaces=null` as the reset", () => {
    for (const copy of getResetCopies()) {
      expect({
        file: copy.label,
        nullResetAdvice: getNullResetAdvice(copy.text),
      }).toEqual({ file: copy.label, nullResetAdvice: [] });
    }
  });

  /*
   * Where a copy still names `=null`, it says plainly that it does not
   * reset a stored list under --reuse-values — so an operator who reaches
   * for it knows why it did nothing.
   */
  it("says plainly that `=null` does not reset a stored list, wherever it names it", () => {
    for (const copy of getResetCopies()) {
      if (!copy.text.includes(NULL_RESET_TEXT)) {
        continue;
      }
      expect({
        file: copy.label,
        saysItDoesNotReset: NULL_DOES_NOT_RESET_PATTERN.test(copy.text),
      }).toEqual({ file: copy.label, saysItDoesNotReset: true });
    }
  });

  it("names --reset-then-reuse-values (Helm 3.14+) as where `=null` does work", () => {
    for (const copy of [
      ...[
        AI_SRE_PAGE,
        KUBERNETES_AGENT_PAGE,
        CHART_README,
        CHART_VALUES,
        CHART_SCHEMA,
      ].map(fileSource),
      {
        label: `${AI_PAGE} (scoped command note)`,
        text: getAiAccessScopedCommandNote(),
      },
      {
        label: `${AI_PAGE} (cluster-wide command note)`,
        text: getAiAccessClusterWideCommandNote(),
      },
    ]) {
      expect({
        file: copy.label,
        alternative: RESET_THEN_REUSE_PATTERN.test(copy.text),
      }).toEqual({ file: copy.label, alternative: true });
    }
  });

  it("pairs no copy-paste command's --reuse-values with a null namespace list", () => {
    const commands: Array<{ label: string; command: string }> = [
      ...[AI_SRE_PAGE, KUBERNETES_AGENT_PAGE, CHART_README].flatMap(
        (page: string): Array<{ label: string; command: string }> => {
          return getMarkdownCommands(page).map(
            (command: string): { label: string; command: string } => {
              return { label: relative(page), command };
            },
          );
        },
      ),
      ...getNotesCommands().map(
        (command: string): { label: string; command: string } => {
          return { label: relative(CHART_NOTES), command };
        },
      ),
      ...Object.values(getAiAccessHelmCommands()).map(
        (command: string): { label: string; command: string } => {
          return { label: AI_PAGE, command };
        },
      ),
    ];

    // Harness guard: the commands the upgrades are read from were found.
    expect(
      commands.filter((entry: { label: string; command: string }): boolean => {
        return entry.command.includes("--reuse-values");
      }).length,
    ).toBeGreaterThan(6);

    for (const entry of commands) {
      expect({
        file: entry.label,
        command: entry.command,
        reuseWithNull:
          entry.command.includes("--reuse-values") &&
          entry.command.includes(NULL_RESET_TEXT),
      }).toEqual({
        file: entry.label,
        command: entry.command,
        reuseWithNull: false,
      });
    }
  });

  /*
   * The troubleshooting recovery for an upgrade stuck on a deleted listed
   * namespace. Under --reuse-values the `=null` recovery kept the stale
   * list, so it failed with the same `namespaces "<name>" not found`.
   */
  it("gives the stuck-upgrade recovery the reset that works, and says why `=null` fails there", () => {
    for (const file of [CHART_README, KUBERNETES_AGENT_PAGE]) {
      const text: string = readFlat(file);
      const start: number = text.indexOf('namespaces "<name>" not found');
      const recovery: string = text.slice(start, start + 900);

      expect({
        file: relative(file),
        found: start !== -1,
        listMinusNamespace: recovery.includes(
          '`--set "aiAccess.remediation.namespaces={web}"`',
        ),
        emptyListReset: recovery.includes(EMPTY_LIST_RESET_FLAG),
        nullFailsTheSame:
          recovery.includes(
            "`--set aiAccess.remediation.namespaces=null` does not reset a stored list under `--reuse-values`",
          ) && recovery.includes("the same error"),
      }).toEqual({
        file: relative(file),
        found: true,
        listMinusNamespace: true,
        emptyListReset: true,
        nullFailsTheSame: true,
      });
    }
  });

  it("no longer calls `=null` the reset in the values tables", () => {
    for (const file of [CHART_README, KUBERNETES_AGENT_PAGE]) {
      const row: string | undefined = read(file)
        .split("\n")
        .find((line: string): boolean => {
          return line.includes("remediation.namespaces` | `[]`");
        });

      expect({
        file: relative(file),
        found: row !== undefined,
        nullReset: (row || "").includes("`=null` resets"),
        emptyListReset: (row || "").includes(
          `\`${EMPTY_LIST_RESET_FLAG}\` resets a stored list`,
        ),
      }).toEqual({
        file: relative(file),
        found: true,
        nullReset: false,
        emptyListReset: true,
      });
    }
  });

  // Negative controls: the round-three wording is flagged, the new one is not.
  it("flags the round-three `=null` advice and passes the qualified mention", () => {
    for (const roundThree of [
      "With `--reuse-values`, leaving the flag out keeps the list stored on the release. To go back to the cluster-wide binding, pass `--set aiAccess.remediation.namespaces=null` (or `--set-json 'aiAccess.remediation.namespaces=[]'`) — not `={}`. Next.",
      "Take a namespace off the list before you delete it; --set aiAccess.remediation.namespaces=null goes back to cluster-wide. A fix outside these namespaces is refused.",
      "--set aiAccess.remediation.namespaces=null resets a namespace list stored on the release, so the write role is bound cluster-wide.",
      "| `remediation.namespaces` | `[]` | Empty binds it cluster-wide; `--set aiAccess.remediation.namespaces=null` resets a stored list. |",
    ]) {
      expect({
        roundThree,
        flagged: getNullResetAdvice(roundThree).length,
      }).toEqual({ roundThree, flagged: 1 });
    }

    for (const qualified of [
      "`--set aiAccess.remediation.namespaces=null` does not reset a stored list under `--reuse-values`: Helm keeps the stored list. Next.",
      "Before; `--set-json 'aiAccess.remediation.namespaces=[]'` goes back to cluster-wide (--set aiAccess.remediation.namespaces=null does not reset a stored list under --reuse-values). After.",
    ]) {
      expect({
        qualified,
        flagged: getNullResetAdvice(qualified).length,
      }).toEqual({ qualified, flagged: 0 });
    }
  });
});

describe("deleting the in-cluster Runner so the agent registers a fresh one", () => {
  // Every copy that explains a refused registration and what to change.
  const REGISTRATION_COPIES: Array<string> = [
    AI_SRE_PAGE,
    KUBERNETES_AGENT_PAGE,
    CHART_README,
    CHART_NOTES,
    CHART_VALUES,
  ];

  it("says to select the new Runner on the cluster's AI page afterwards, and why", () => {
    for (const file of REGISTRATION_COPIES) {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        selectNewRunner: SELECT_NEW_RUNNER_PATTERN.test(text),
        neverReBinds: NEVER_RE_BINDS_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        selectNewRunner: true,
        neverReBinds: true,
      });
    }
  });

  it("never suggests deleting the Runner without that second step", () => {
    for (const file of REGISTRATION_COPIES) {
      expect({
        file: relative(file),
        deleteWithoutReselect: getDeleteWithoutReselect(getParagraphs(file)),
      }).toEqual({ file: relative(file), deleteWithoutReselect: [] });
    }
  });

  it("names who may select the Runner on the pages that explain it", () => {
    for (const file of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE, CHART_README]) {
      const text: string = readFlat(file);
      const start: number = text.search(SELECT_NEW_RUNNER_PATTERN);
      const step: string = text.slice(start, start + 300);

      expect({
        file: relative(file),
        found: start !== -1,
        permission: step.includes(
          "a Project Owner, a Project Admin or **Edit Auto Remediation Rule**",
        ),
      }).toEqual({ file: relative(file), found: true, permission: true });
    }
  });

  // Negative control: the server's round-three advice alone is flagged.
  it("flags a delete suggestion that stops at the fresh registration", () => {
    expect(
      getDeleteWithoutReselect([
        "Remove what it holds — or delete the Runner, and the agent registers a fresh one on its next retry.",
      ]),
    ).toHaveLength(1);
    expect(
      getDeleteWithoutReselect([
        "If you delete the Runner instead, the agent registers a fresh one on its next retry: select the new Runner on the cluster's AI page afterwards.",
      ]),
    ).toHaveLength(0);
  });
});

describe("the round-four policy changes, in the docs", () => {
  // Every copy that lists what always needs a human, in every mode.
  const EVERY_MODE_COPIES: Array<string> = [
    AI_SRE_PAGE,
    KUBERNETES_AGENT_PAGE,
    CHART_README,
    CHART_NOTES,
    CHART_VALUES,
    CHART_SCHEMA,
  ];

  it("names a patch of a node with the drain and the taint as always needing a human", () => {
    for (const file of EVERY_MODE_COPIES) {
      expect({
        file: relative(file),
        nodePatchNeedsHuman: NODE_PATCH_NEEDS_HUMAN_PATTERN.test(
          readFlat(file),
        ),
      }).toEqual({ file: relative(file), nodePatchNeedsHuman: true });
    }

    // The AI page's scoped command note, where node operations are offered.
    expect(getAiAccessScopedCommandNote()).toContain(
      "(a drain, a taint or a patch of a node still waits for a human)",
    );
  });

  it("lists the node patch on the AI SRE page's every-mode lines", () => {
    expect(read(AI_SRE_PAGE)).toContain(
      "- A `drain`, a `taint` or a `patch` of a node always needs a human. Draining a node evicts pods in every namespace — the three above and the agent's own included — and a `NoExecute` taint evicts them too, whether `kubectl taint` sets it or a `patch` of the node does.",
    );
  });

  // Negative control: a node patch named as a riskier change is not "needs a human".
  it("does not read a node patch named as a riskier change as always needing a human", () => {
    for (const riskierOnly of [
      "A `patch` of a node is a riskier change a human approves unless the cluster bypasses approvals.",
      "With `remediation.nodeOperations` a third role adds patch on nodes and create on `pods/eviction`.",
      "a drain and a taint always need a human; a patch of a node runs on its own in Bypass approval.",
    ]) {
      expect({
        riskierOnly,
        nodePatchNeedsHuman: NODE_PATCH_NEEDS_HUMAN_PATTERN.test(riskierOnly),
      }).toEqual({ riskierOnly, nodePatchNeedsHuman: false });
    }
  });

  it("lists `expose --overrides` among the refused commands", () => {
    for (const file of [
      AI_SRE_PAGE,
      KUBERNETES_AGENT_PAGE,
      CHART_README,
      CHART_NOTES,
      CHART_VALUES,
      CHART_SCHEMA,
    ]) {
      expect({
        file: relative(file),
        exposeOverrides: EXPOSE_OVERRIDES_PATTERN.test(readFlat(file)),
      }).toEqual({ file: relative(file), exposeOverrides: true });
    }

    // The deny lists that spell out flags name --override-type too.
    for (const file of [AI_SRE_PAGE, CHART_README]) {
      expect({
        file: relative(file),
        overrideType: read(file).includes("`--override-type`"),
      }).toEqual({ file: relative(file), overrideType: true });
    }
  });

  it("names the host and isolation fields a pod-template patch may not set", () => {
    for (const file of [AI_SRE_PAGE, CHART_README, CHART_VALUES]) {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        hostPorts: text.includes("host ports"),
        hostUsers: text.includes("hostUsers"),
        runtimeClassName: text.includes("runtimeClassName"),
      }).toEqual({
        file: relative(file),
        hostPorts: true,
        hostUsers: true,
        runtimeClassName: true,
      });
    }
  });

  it("says an ordinary Runner reports its write limits, so a fix outside them is refused before it reaches it", () => {
    const page: string = readFlat(AI_SRE_PAGE);

    expect(page).toContain(
      "To limit where such a Runner may write, start it with `ONEUPTIME_KUBECTL_WRITE_NAMESPACES` (and `ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS=false` to keep fixes off nodes): the Runner reports those limits, so OneUptime refuses a fix outside them when it is proposed or approved, before it reaches the Runner, and the Runner refuses it again.",
    );
  });
});
