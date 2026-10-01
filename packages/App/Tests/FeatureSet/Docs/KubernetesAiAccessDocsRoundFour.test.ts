import {
  getAiAgentClusterWideCommandNote,
  getAiAgentHelmCommands,
  getAiAgentScopedCommandNote,
} from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";
import {
  AI_AGENT_PAGE,
  AI_SRE_PAGE,
  CHART_NOTES,
  CHART_README,
  CHART_SCHEMA,
  CHART_VALUES,
  CopySource,
  EMPTY_LIST_RESET_FLAG,
  KUBERNETES_AGENT_PAGE,
  LINE_BREAK_PATTERN,
  NULL_RESET_TEXT,
  UPGRADING_PAGE,
  fileSource,
  getBashBlocks,
  getSection,
  read,
  readFlat,
  relative,
} from "./KubernetesAiAgentDocsSupport";
import { describe, expect, it } from "@jest/globals";

/*
 * The round-four findings in the cluster kubectl copy, carried over to the
 * Kubernetes AI agent's aiAgent.* values, and what every page, the chart
 * and the cluster's AI agent page must still say.
 *
 * - Resetting aiAgent.remediation.namespaces. Under --reuse-values Helm
 *   coalesces the new overrides into the release's stored values and
 *   deletes a null override whose key those values hold, so
 *   `--set aiAgent.remediation.namespaces=null` leaves a stored list in
 *   place (and, with the key unset, the chart falls back to a list stored
 *   under the old aiAccess key). The reset that works is an empty JSON
 *   list, `--set-json 'aiAgent.remediation.namespaces=[]'`: the chart reads
 *   an aiAgent list that is set, even empty, as the answer. Both were
 *   reproduced for aiAccess with the real helm binary against a stored
 *   release (HELM_DRIVER=memory); helm-unittest renders from values files
 *   and cannot model --reuse-values.
 * - The policy changes of round four: a `patch` of a node always needs a
 *   human, like a drain and a taint (a NoExecute taint written as a node
 *   patch is the same change); `expose --overrides` is refused (the
 *   override decides what kind of object kubectl creates); pod-template
 *   patches of host ports, hostUsers and runtimeClassName are refused with
 *   the other security settings; and an ordinary Runner reports the write
 *   limits it was started with, so a fix outside them is refused before it
 *   reaches it.
 */

// A sentence ends at a full stop or a semicolon followed by a space.
const SENTENCE_END_PATTERN: RegExp = /[.;]\s/g;
/*
 * A mention of `=null` that says it does NOT reset a stored list under
 * --reuse-values.
 */
const NULL_RESET_QUALIFIER_PATTERN: RegExp =
  /does not reset|only works with `?--reset-then-reuse-values|only without `?--reuse-values|without `?--reuse-values`?[^.]{0,40}only/;
// The plain statement that `=null` does not reset a stored list.
const NULL_DOES_NOT_RESET_PATTERN: RegExp =
  /namespaces=null`? does not reset a stored list under `?--reuse-values/;
// A backslash-newline line continuation.
const LINE_CONTINUATION_PATTERN: RegExp = /\\\n/g;
// The indented command lines NOTES.txt prints, one command per line.
const NOTES_COMMAND_LINE_PATTERN: RegExp = /^ {2}(helm|kubectl|--set)\b.*$/gm;

/*
 * A patch of a node named as always needing a human, in the forms the
 * copies use: "a `patch` of a node always needs a human", "... always
 * needs a human; so do a `drain`, a `taint` and a `patch` of a node", "a
 * drain, a taint or a patch of a node still waits for a human", "... and a
 * `patch` of a node are never auto-approved", and the dashboard's "a node
 * patch still waits for a person".
 */
const NODE_PATCH_NEEDS_HUMAN_PATTERN: RegExp =
  /\b(patch`? of a node|node patch)\b[^.;]{0,40}\b(always (needs?|waits? for|wait for) a (human|person)|without a (human|person)|are never auto-approved|still (waits for|asks) a (human|person))|\bso do a `?drain`?, a `?taint`? and a `?patch`? of a node\b/;
// `kubectl expose --overrides`, which the policy refuses.
const EXPOSE_OVERRIDES_PATTERN: RegExp = /`?expose --overrides`?/;

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

// Every copy-paste command a markdown page shows, continuations joined.
function getMarkdownCommands(filePath: string): Array<string> {
  return getBashBlocks(read(filePath)).map((block: string): string => {
    return block.replace(LINE_CONTINUATION_PATTERN, " ");
  });
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
      label: `${AI_AGENT_PAGE} (scoped command note)`,
      text: getAiAgentScopedCommandNote(),
    },
    {
      label: `${AI_AGENT_PAGE} (cluster-wide command note)`,
      text: getAiAgentClusterWideCommandNote(),
    },
  ];
}

describe("resetting aiAgent.remediation.namespaces under --reuse-values", () => {
  it("names the empty-list --set-json reset in every copy", () => {
    for (const copy of getResetCopies()) {
      expect({
        file: copy.label,
        emptyListReset: copy.text.includes(EMPTY_LIST_RESET_FLAG),
      }).toEqual({ file: copy.label, emptyListReset: true });
    }
  });

  it("never offers `--set aiAgent.remediation.namespaces=null` as the reset", () => {
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

  it("says so on the docs pages that name `=null`", () => {
    for (const file of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE]) {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        named: text.includes(NULL_RESET_TEXT),
        saysItDoesNotReset: NULL_DOES_NOT_RESET_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        named: true,
        saysItDoesNotReset: true,
      });
    }
  });

  it("pairs no copy-paste command's --reuse-values with a null namespace list", () => {
    const commands: Array<{ label: string; command: string }> = [
      ...[
        AI_SRE_PAGE,
        KUBERNETES_AGENT_PAGE,
        UPGRADING_PAGE,
        CHART_README,
      ].flatMap((page: string): Array<{ label: string; command: string }> => {
        return getMarkdownCommands(page).map(
          (command: string): { label: string; command: string } => {
            return { label: relative(page), command };
          },
        );
      }),
      ...getNotesCommands().map(
        (command: string): { label: string; command: string } => {
          return { label: relative(CHART_NOTES), command };
        },
      ),
      ...Object.values(getAiAgentHelmCommands()).map(
        (command: string): { label: string; command: string } => {
          return { label: AI_AGENT_PAGE, command };
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
   * namespace. Under --reuse-values the `=null` recovery keeps the stale
   * list, so it fails with the same `namespaces "<name>" not found`.
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
          '`--set "aiAgent.remediation.namespaces={web}"`',
        ),
        emptyListReset: recovery.includes(EMPTY_LIST_RESET_FLAG),
        nullFailsTheSame:
          recovery.includes(
            "`--set aiAgent.remediation.namespaces=null` does not reset a stored list under `--reuse-values`",
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

  /*
   * A list stored under the old key can be the one that fails: the chart
   * falls back to aiAccess.remediation.namespaces until the aiAgent list is
   * set, and the aiAgent recovery overrides it.
   */
  it("names the old key's list as a cause of the stuck upgrade on the Kubernetes agent page", () => {
    expect(
      getSection(read(KUBERNETES_AGENT_PAGE), "## Upgrading the Agent"),
    ).toContain(
      "`aiAgent.remediation.namespaces` (or the older `aiAccess.remediation.namespaces`) lists a namespace that does not exist",
    );
  });

  it("no longer calls `=null` the reset in the values tables", () => {
    for (const file of [CHART_README, KUBERNETES_AGENT_PAGE]) {
      const row: string | undefined = read(file)
        .split("\n")
        .find((line: string): boolean => {
          return line.includes("remediation.namespaces` |");
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

  // Negative controls: the unqualified `=null` advice is flagged, the qualified one is not.
  it("flags `=null` offered as the reset and passes the qualified mention", () => {
    for (const unqualified of [
      "With `--reuse-values`, leaving the flag out keeps the list stored on the release. To go back to the cluster-wide binding, pass `--set aiAgent.remediation.namespaces=null` (or `--set-json 'aiAgent.remediation.namespaces=[]'`) — not `={}`. Next.",
      "Take a namespace off the list before you delete it; --set aiAgent.remediation.namespaces=null goes back to cluster-wide. A fix outside these namespaces is refused.",
      "--set aiAgent.remediation.namespaces=null resets a namespace list stored on the release, so the write role is bound cluster-wide.",
      "| `remediation.namespaces` | `[]` | Empty binds it cluster-wide; `--set aiAgent.remediation.namespaces=null` resets a stored list. |",
    ]) {
      expect({
        unqualified,
        flagged: getNullResetAdvice(unqualified).length,
      }).toEqual({ unqualified, flagged: 1 });
    }

    for (const qualified of [
      "`--set aiAgent.remediation.namespaces=null` does not reset a stored list under `--reuse-values`: Helm keeps the stored list. Next.",
      "Before; `--set-json 'aiAgent.remediation.namespaces=[]'` goes back to cluster-wide (--set aiAgent.remediation.namespaces=null does not reset a stored list under --reuse-values). After.",
    ]) {
      expect({
        qualified,
        flagged: getNullResetAdvice(qualified).length,
      }).toEqual({ qualified, flagged: 0 });
    }
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

    // The AI agent page's scoped command note, where node operations are offered.
    expect(
      NODE_PATCH_NEEDS_HUMAN_PATTERN.test(getAiAgentScopedCommandNote()),
    ).toBe(true);
  });

  // Positive controls: every form the copies use is read as needing a human.
  it("reads each wording of the node-patch line as needing a human", () => {
    for (const needsHuman of [
      "a `drain`, a `taint` or a `patch` of a node always needs a human.",
      "a write in kube-system always needs a human; so do a `drain`, a `taint` and a `patch` of a node, because",
      "(a drain, a taint or a patch of a node still waits for a human)",
      "(a drain, a taint or a node patch still waits for a person)",
    ]) {
      expect({
        needsHuman,
        nodePatchNeedsHuman: NODE_PATCH_NEEDS_HUMAN_PATTERN.test(needsHuman),
      }).toEqual({ needsHuman, nodePatchNeedsHuman: true });
    }
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
      "A node patch is a riskier change a person approves unless the cluster bypasses approvals.",
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
    for (const file of EVERY_MODE_COPIES) {
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
    expect(readFlat(AI_SRE_PAGE)).toContain(
      "To limit where such a Runner may write, start it with `ONEUPTIME_KUBECTL_WRITE_NAMESPACES` (and `ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS=false` to keep fixes off nodes): the Runner reports those limits, so OneUptime refuses a fix outside them when it is proposed or approved, before it reaches the Runner, and the Runner refuses it again.",
    );
  });

  it("reads paragraphs of YAML comments as flowing text", () => {
    // Harness guard for readFlat: a `#` comment block reads as one line.
    expect(
      "# a drain, a taint or a patch of a node\n# still waits for a human.".replace(
        LINE_BREAK_PATTERN,
        " ",
      ),
    ).toBe("# a drain, a taint or a patch of a node still waits for a human.");
  });
});
