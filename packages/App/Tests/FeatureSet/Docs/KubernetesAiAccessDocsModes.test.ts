import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs promise about the cluster AI remediation modes, against
 * what the server does.
 *
 * The canonical description of each mode is the doc comment on
 * KubernetesAiRemediationMode (Common/Types/Kubernetes/
 * KubernetesClusterAiAccess.ts); every copy an operator reads must say the
 * same thing:
 *
 * - Automatic never runs a riskier change. It proposes one for one-click
 *   approval only when the round could find nothing safe; when a safe fix
 *   also ran, a riskier fix is proposed only by the follow-up round after a
 *   failed verification (RemediationExecutionRunner settles such a round
 *   AutoExecuted with no card). The old copy said a riskier change "is
 *   proposed for one-click approval" without the condition.
 * - Bypass approval does not ask, but it is not "nobody is asked" with "the
 *   only exception" of the breaker: a round also asks when another
 *   unattended round is still changing or verifying the same cluster, and
 *   the follow-up after a rollback that did not complete asks too.
 * - Some lines hold in every mode, Bypass approval included: protected
 *   namespaces, a drain, a taint and a patch of a node always need a human
 *   (a drain evicts pods in every namespace, kube-system and the agent's
 *   own included, and so does a NoExecute taint, whichever command writes
 *   it), and the Runner never changes its own namespace. A copy that
 *   promises the protected-namespace line without the drain line
 *   overclaims. KubernetesAiAccessDocsRoundFour.test.ts checks the node
 *   patch in each copy.
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
const CHART_TEMPLATE: string = path.join(CHART_DIR, "templates/ai-runner.yaml");
const ROADMAP: string = path.join(
  REPOSITORY_ROOT,
  "Docs/Internal/Roadmap/AiClusterAccess.md",
);
const CANONICAL_MODES: string = path.join(
  PACKAGES_ROOT,
  "Common/Types/Kubernetes/KubernetesClusterAiAccess.ts",
);

// The copies that describe the Automatic and Bypass approval modes.
const MODE_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
  CHART_VALUES,
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

// Line breaks, and the `#` of a YAML comment, read as one space.
const LINE_BREAK_PATTERN: RegExp = /\s*\n\s*#?\s*/g;
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

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function readFlat(filePath: string): string {
  return read(filePath).replace(LINE_BREAK_PATTERN, " ");
}

function relative(filePath: string): string {
  return path.relative(REPOSITORY_ROOT, filePath);
}

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
    for (const file of [...MODE_COPY, ...EVERY_MODE_COPY, ROADMAP]) {
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

  it("list the drain line with the protected namespaces and the Runner's own namespace on the AI SRE page", () => {
    const page: string = read(AI_SRE_PAGE);
    const start: number = page.indexOf("Some lines hold in **every** mode");
    const end: number = page.indexOf("The Automatic-mode allowlist", start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const lines: string = page.slice(start, end);

    expect(lines).toContain(
      "- A write in **kube-system**, **kube-public** or **kube-node-lease** always needs a human.",
    );
    /*
     * Round four adds a `patch` of a node to the drain and the taint: a
     * NoExecute taint written as a node patch evicts pods like `kubectl
     * taint` does, and the policy now holds it to the same rule.
     */
    expect(lines).toContain(
      "- A `drain`, a `taint` or a `patch` of a node always needs a human. Draining a node evicts pods in every namespace — the three above and the agent's own included",
    );
    expect(lines).toContain(
      "- The Runner never changes anything in its own namespace",
    );
    expect(lines).toContain("no allowlist entry changes them");
  });

  it("say on the AI SRE page that Bypass approval keeps what needs a human in every mode", () => {
    const bypass: string | undefined = read(AI_SRE_PAGE)
      .split("\n")
      .find((line: string) => {
        return line.startsWith("- **Bypass approval**");
      });

    expect(bypass).toContain("AI does not ask.");
    expect(bypass).toContain(
      "What needs a human in every mode (below) still waits for one.",
    );
  });
});
