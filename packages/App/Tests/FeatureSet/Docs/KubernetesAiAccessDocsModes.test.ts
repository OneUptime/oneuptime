import {
  AI_SRE_PAGE,
  CHART_NOTES,
  CHART_README,
  CHART_SCHEMA,
  CHART_TEMPLATE,
  CHART_VALUES,
  KUBERNETES_AGENT_PAGE,
  PACKAGES_ROOT,
  getClusterAccessSection,
  getSection,
  read,
  readFlat,
  relative,
} from "./KubernetesAiAgentDocsSupport";
import { describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * What the docs promise about the cluster AI fix modes, against what the
 * server does.
 *
 * The canonical description of each mode is the doc comment on
 * KubernetesAiRemediationMode (Common/Types/Kubernetes/
 * KubernetesClusterAiAccess.ts); every copy an operator reads must say the
 * same thing:
 *
 * - Automatic never runs a riskier change. It proposes one for one-click
 *   approval only when the round could find nothing safe; when a safe fix
 *   also ran, a riskier fix is proposed only by the follow-up round after a
 *   failed verification.
 * - Bypass approval does not ask, but it is not "nobody is asked" with "the
 *   only exception" of the breaker: a round also asks when another
 *   unattended round is still changing or verifying the same cluster, and
 *   the follow-up after a rollback that did not complete asks too.
 * - Some lines hold in every mode, Bypass approval included: protected
 *   namespaces, a drain, a taint and a patch of a node always need a human
 *   (a drain evicts pods in every namespace, kube-system and the agent's
 *   own included, and so does a NoExecute taint, whichever command writes
 *   it), and the Kubernetes AI agent never changes its own namespace. A copy
 *   that promises the protected-namespace line without the drain line
 *   overclaims. KubernetesAiAccessDocsRoundFour.test.ts checks the node
 *   patch in each copy.
 */

const CANONICAL_MODES: string = path.join(
  PACKAGES_ROOT,
  "Common/Types/Kubernetes/KubernetesClusterAiAccess.ts",
);

// The copies that describe the Automatic and Bypass approval modes.
const MODE_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
];

// Every copy that states the every-mode lines.
const EVERY_MODE_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
  CHART_NOTES,
  CHART_VALUES,
  CHART_SCHEMA,
  CHART_TEMPLATE,
];

// Line breaks, and the `*` of a block comment, read as one space.
const DOC_COMMENT_LINE_BREAK_PATTERN: RegExp = /\s*\n\s*\*?\s*/g;

/*
 * The phrases each mode copy shares with the canonical doc comment. They
 * are checked in the canonical comment too, so rewording it flags every
 * copy for review.
 */
const AUTOMATIC_CANONICAL_PHRASES: Array<string> = [
  "could only find riskier fixes",
  "proposing exactly those for one-click approval",
  "follow-up round",
];
const BYPASS_CANONICAL_PHRASES: Array<string> = ["AI does not ask"];

// The unconditional claims the earlier copy made.
const UNCONDITIONAL_AUTOMATIC_PROPOSAL_PATTERN: RegExp =
  /a riskier change is proposed for one-click approval/i;
const NOBODY_IS_ASKED_PATTERN: RegExp = /nobody is (ever )?asked/i;
const NOTHING_IS_EVER_ASKED_PATTERN: RegExp = /nothing is ever asked/i;
const ONLY_EXCEPTION_PATTERN: RegExp = /only exception/i;

// The cases in which a Bypass approval round still asks.
const IN_FLIGHT_ROUND_PATTERN: RegExp =
  /another unattended OneUptime AI round is still changing/;
const INCOMPLETE_ROLLBACK_PATTERN: RegExp = /rollback did not complete/;
const CIRCUIT_BREAKER_PATTERN: RegExp = /circuit breaker/;

/*
 * A drain named as needing a human, in either order: "a drain ... always
 * needs a human" or "... always needs a human; so do a drain".
 */
const DRAIN_NEEDS_HUMAN_PATTERN: RegExp =
  /\bdrain\b[^.]{0,120}\b(needs? a human|without a human|waits? for a human)|(needs? a human|without a human|waits? for a human)[^.]{0,40}\bdrain\b/i;
const TAINT_PATTERN: RegExp = /\btaint\b/;

// A lower-case mode bullet ("- **automatic** — ..."), and its title.
const MODE_LINE_PATTERN: RegExp = /^- \*\*[a-z]/;
const BULLET_TITLE_PATTERN: RegExp = /^- \*\*([^*]+)\*\*/;

// The doc comment right above `export enum KubernetesAiRemediationMode`.
function getCanonicalModeComment(): string {
  const source: string = read(CANONICAL_MODES);
  const enumStart: number = source.indexOf(
    "export enum KubernetesAiRemediationMode",
  );
  const commentStart: number = source.lastIndexOf("/*", enumStart);

  if (enumStart === -1 || commentStart === -1) {
    throw new Error(
      "KubernetesClusterAiAccess.ts has no doc comment on KubernetesAiRemediationMode",
    );
  }

  return source
    .slice(commentStart, enumStart)
    .replace(DOC_COMMENT_LINE_BREAK_PATTERN, " ");
}

describe("the canonical mode description the docs follow", () => {
  const canonical: string = getCanonicalModeComment();

  it("still carries every phrase the docs share with it", () => {
    for (const phrase of [
      ...AUTOMATIC_CANONICAL_PHRASES,
      ...BYPASS_CANONICAL_PHRASES,
    ]) {
      expect({ phrase, inCanonical: canonical.includes(phrase) }).toEqual({
        phrase,
        inCanonical: true,
      });
    }
  });

  it("still says drains, taints, node patches and protected namespaces always need a human", () => {
    expect(canonical).toContain(
      "a write in a protected namespace (kube-system, kube-public, kube-node-lease), a node drain, a node taint and a patch of a Node always need a human",
    );
  });
});

describe("the Automatic mode copy", () => {
  for (const file of MODE_COPY) {
    it(`qualifies when a riskier change is proposed, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      for (const phrase of AUTOMATIC_CANONICAL_PHRASES) {
        expect({
          file: relative(file),
          phrase,
          said: text.includes(phrase),
        }).toEqual({ file: relative(file), phrase, said: true });
      }

      expect({
        file: relative(file),
        unconditional: UNCONDITIONAL_AUTOMATIC_PROPOSAL_PATTERN.test(text),
      }).toEqual({ file: relative(file), unconditional: false });
    });
  }
});

describe("the Bypass approval mode copy", () => {
  for (const file of MODE_COPY) {
    it(`names every case in which a round still asks, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        doesNotAsk: text.includes("AI does not ask"),
        inFlightRound: IN_FLIGHT_ROUND_PATTERN.test(text),
        incompleteRollback: INCOMPLETE_ROLLBACK_PATTERN.test(text),
        breaker: CIRCUIT_BREAKER_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        doesNotAsk: true,
        inFlightRound: true,
        incompleteRollback: true,
        breaker: true,
      });
    });
  }

  it("never promises that nobody is asked, or that the breaker is the only exception", () => {
    for (const file of [...MODE_COPY, ...EVERY_MODE_COPY]) {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        nobodyIsAsked: NOBODY_IS_ASKED_PATTERN.test(text),
        nothingIsEverAsked: NOTHING_IS_EVER_ASKED_PATTERN.test(text),
        onlyException: ONLY_EXCEPTION_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        nobodyIsAsked: false,
        nothingIsEverAsked: false,
        onlyException: false,
      });
    }
  });

  // Negative controls: the old absolute claims are caught.
  it("reads the earlier absolute claims as such", () => {
    expect(
      NOBODY_IS_ASKED_PATTERN.test("Bypass approval: nobody is asked."),
    ).toBe(true);
    expect(
      ONLY_EXCEPTION_PATTERN.test(
        "The only exception is the hourly circuit breaker.",
      ),
    ).toBe(true);
    expect(
      UNCONDITIONAL_AUTOMATIC_PROPOSAL_PATTERN.test(
        "Automatic: a riskier change is proposed for one-click approval.",
      ),
    ).toBe(true);
  });
});

describe("the every-mode lines", () => {
  for (const file of EVERY_MODE_COPY) {
    it(`name a drain and a taint as always needing a human, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        drainNeedsHuman: DRAIN_NEEDS_HUMAN_PATTERN.test(text),
        taintNamed: TAINT_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        drainNeedsHuman: true,
        taintNamed: true,
      });
    });
  }

  // Negative control: a drain that is only "riskier" is not "needs a human".
  it("does not read a drain named only as riskier as needing a human", () => {
    expect(
      DRAIN_NEEDS_HUMAN_PATTERN.test(
        "A drain is a riskier change that Bypass approval runs on its own.",
      ),
    ).toBe(false);
  });

  it("list the drain line with the protected namespaces and the AI agent's own namespace on the AI SRE page", () => {
    const section: string = getClusterAccessSection();
    const start: number = section.indexOf("Some lines hold in **every** mode");
    const end: number = section.indexOf("The Automatic-mode allowlist", start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const lines: string = section.slice(start, end);

    expect(lines).toContain(
      "- A write in **kube-system**, **kube-public** or **kube-node-lease** always needs a human.",
    );
    /*
     * A NoExecute taint written as a node patch evicts pods like `kubectl
     * taint` does, and the policy holds it to the same rule.
     */
    expect(lines).toContain(
      "- A `drain`, a `taint` or a `patch` of a node always needs a human. Draining a node evicts pods in every namespace — the three above and the agent's own included",
    );
    expect(lines).toContain(
      "- The AI agent never changes anything in its own namespace",
    );
    expect(lines).toContain(
      "- Destructive commands (below) never run, even with a human approving them.",
    );
    expect(lines).toContain("no allowlist entry changes them");
  });

  it("say on the AI SRE page that Bypass approval keeps what needs a human in every mode", () => {
    const bypass: string | undefined = getSection(
      read(AI_SRE_PAGE),
      "### How fixes work",
    )
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- **Bypass approval**");
      });

    expect(bypass).toContain("AI does not ask.");
    expect(bypass).toContain(
      "What needs a human in every mode (below) still waits for one.",
    );
  });

  it("say on the Kubernetes agent page that the AI agent never changes its own namespace, whatever the mode", () => {
    const section: string = getSection(
      read(KUBERNETES_AGENT_PAGE),
      "### Let AI fix what it finds",
    ).replace(/\s*\n\s*/g, " ");

    expect(section).toContain(
      "Whatever the mode, a write in kube-system, kube-public or kube-node-lease always needs a human, and so do a `drain`, a `taint` and a `patch` of a node",
    );
    expect(section).toContain(
      "the AI agent never changes anything in its own namespace, outside `aiAgent.remediation.namespaces`, or on a node with `aiAgent.remediation.nodeOperations=false`",
    );
  });
});

describe("the fix modes on the Kubernetes agent page", () => {
  const section: string = getSection(
    read(KUBERNETES_AGENT_PAGE),
    "### Let AI fix what it finds",
  );

  it("lists ask-for-approval, automatic and bypass-approval, in that order, as aiAgent.fixes spells them", () => {
    const modes: Array<string> = section
      .split("\n")
      .filter((line: string): boolean => {
        return MODE_LINE_PATTERN.test(line);
      })
      .map((line: string): string => {
        return line.match(BULLET_TITLE_PATTERN)![1]!;
      });

    expect(modes).toEqual(["ask-for-approval", "automatic", "bypass-approval"]);
  });

  /*
   * The chart sets how fixes run (aiAgent.fixes), the cluster's AI agent
   * page only shows it, and turning fixes off is the same value set to off.
   */
  it("says aiAgent.fixes picks how fixes run, and how to turn them off again", () => {
    const flat: string = section.replace(/\s*\n\s*/g, " ");

    expect(flat).toContain(
      "Fixes are off until you turn them on with `aiAgent.fixes` — a separate, optional step that also grants the AI agent write access.",
    );
    expect(flat).toContain(
      "`aiAgent.fixes` picks how fixes run; to turn them off again, upgrade with `--set aiAgent.fixes=off`, which also removes the write access",
    );
    expect(flat).not.toContain("pick the mode under **What AI may do**");
  });

  /*
   * The agent's defaults never replace settings an operator chose on the
   * AI agent page; only a release that names the values does.
   */
  it("says the AI agent page shows the settings read-only, and that settings chosen there stay until the chart names them", () => {
    const whatAiMayDo: string = getSection(
      read(KUBERNETES_AGENT_PAGE),
      "### What AI may do",
    ).replace(/\s*\n\s*/g, " ");

    for (const expected of [
      "`aiAgent.investigation`",
      "`aiAgent.fixes`",
      "without a way to change them there",
      "refuses a change made anywhere else — the AI agent page, the API or Terraform",
      "OneUptime applies those only to a cluster whose settings nobody chose on its AI agent page",
      "settings someone chose there are kept as they are",
    ]) {
      expect({ expected, said: whatAiMayDo.includes(expected) }).toEqual({
        expected,
        said: true,
      });
    }
  });
});
