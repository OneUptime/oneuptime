import { KUBECTL_ALLOW_NODE_OPERATIONS_ENV } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about the kubernetes-agent chart's write scope and the
 * in-cluster Runner's identity, against what the chart and server do:
 *
 * - aiAccess.remediation.namespaces renders one RoleBinding per listed
 *   namespace and the chart never creates a namespace, so a missing one
 *   fails the whole install or upgrade (collector included). Every copy
 *   that offers the value says the namespaces must already exist, and how
 *   to go back to cluster-wide on a release that stores a list
 *   (`=null`, or `--set-json ...=[]`; `={}` is one empty name and fails the
 *   schema, and leaving the flag out under --reuse-values keeps the list).
 * - aiAccess.remediation.nodeOperations=false reaches the Runner
 *   (ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS), which then refuses node
 *   operations; the docs say so rather than "RBAC only".
 * - Patch access to workloads is as good as running any image: the policy
 *   refuses some ways to do that, but not `set image`, which is a riskier
 *   change a human approves (or that Bypass approval runs). No copy may
 *   claim the refused commands are all of them.
 * - The in-cluster Runner cannot be renamed or given the runbook / code-fix
 *   capabilities; an ingestion key with a Pinned Service Name cannot
 *   register it; a refused registration says whether it clears on its own;
 *   and settings an operator picked before installing the chart are kept.
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
const RUNNER_MODEL: string = path.join(
  PACKAGES_ROOT,
  "Common/Models/DatabaseModels/Runner.ts",
);
const INGESTION_KEY_MODEL: string = path.join(
  PACKAGES_ROOT,
  "Common/Models/DatabaseModels/TelemetryIngestionKey.ts",
);

// Every copy that offers aiAccess.remediation.namespaces.
const NAMESPACES_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
  CHART_NOTES,
  CHART_VALUES,
  CHART_SCHEMA,
];

// Everything an operator reads about what the write access amounts to.
const WRITE_ACCESS_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
  CHART_NOTES,
  CHART_VALUES,
  CHART_SCHEMA,
  CHART_TEMPLATE,
];

// Pages that explain the in-cluster Runner's registration.
const REGISTRATION_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
  CHART_NOTES,
  CHART_VALUES,
];

// Line breaks, and the `#` of a YAML comment, read as one space.
const LINE_BREAK_PATTERN: RegExp = /\s*\n\s*#?\s*/g;

const MUST_EXIST_PATTERN: RegExp = /must already exist/;
const NULL_RESET_PATTERN: RegExp = /aiAccess\.remediation\.namespaces=null/;
// A reset written the way Helm reads as one empty namespace name.
const EMPTY_BRACES_RESET_PATTERN: RegExp =
  /--set "?aiAccess\.remediation\.namespaces=\{\}/;
const WORKLOAD_PATCH_EQUIVALENCE_PATTERN: RegExp =
  /any image as any ServiceAccount/;
// `set image` named as a riskier, human-approved change.
const SET_IMAGE_IS_APPROVAL_GATED_PATTERN: RegExp =
  /set image\b[^.]{0,200}(riskier change|a human approves)/;
// The old NOTES claim that the refused commands are all of them.
const COMPLETE_REFUSAL_CLAIM_PATTERN: RegExp =
  /refuses the commands that would do that/;
const CLEARS_ON_ITS_OWN_PATTERN: RegExp = /clears on its own/;
const PINNED_SERVICE_NAME_PATTERN: RegExp = /Pinned Service Name/;
// Settings picked on the AI page before the install survive registration.
const PRE_INSTALL_SETTINGS_PATTERN: RegExp =
  /before the (install|chart was installed)[^.]{0,80}kept|kept (exactly )?as (chosen|they are)/;

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function readFlat(filePath: string): string {
  return read(filePath).replace(LINE_BREAK_PATTERN, " ");
}

function relative(filePath: string): string {
  return path.relative(REPOSITORY_ROOT, filePath);
}

// The `title: "..."` of every column a model declares.
function getColumnTitles(modelPath: string): Array<string> {
  return Array.from(read(modelPath).matchAll(/title: "([^"]+)"/g)).map(
    (match: RegExpMatchArray) => {
      return match[1]!;
    },
  );
}

describe("aiAccess.remediation.namespaces in the docs", () => {
  for (const file of NAMESPACES_COPY) {
    it(`says every listed namespace must already exist and how to reset the list, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        mustExist: MUST_EXIST_PATTERN.test(text),
        nullReset: NULL_RESET_PATTERN.test(text),
        emptyBracesReset: EMPTY_BRACES_RESET_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        mustExist: true,
        nullReset: true,
        emptyBracesReset: false,
      });
    });
  }

  it("names the error a missing namespace fails the upgrade with on every docs page", () => {
    for (const file of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE, CHART_README]) {
      expect({
        file: relative(file),
        named: read(file).includes('namespaces "'),
        notFound: read(file).includes('" not found`'),
      }).toEqual({ file: relative(file), named: true, notFound: true });
    }
  });

  it("no longer says that leaving the namespaces flag out grants cluster-wide on the AI SRE page", () => {
    const page: string = read(AI_SRE_PAGE);

    // True only the first time: --reuse-values keeps a stored list.
    expect(page).not.toContain(
      "Leave out the last line to grant it cluster-wide. ",
    );
    expect(page).toContain(
      "With `--reuse-values`, leaving the flag out keeps the list stored on the release",
    );
  });

  it("tells an operator whose upgrade failed on a missing namespace what to change, in both Upgrading sections", () => {
    for (const [file, heading] of [
      [CHART_README, "## Upgrading"],
      [KUBERNETES_AGENT_PAGE, "## Upgrading the Agent"],
    ] as Array<[string, string]>) {
      const text: string = read(file);
      const start: number = text.indexOf(heading);
      const end: number = text.indexOf("\n## ", start + 1);
      const section: string = text.slice(start, end);

      expect({
        file: relative(file),
        found: start !== -1,
        notFound: section.includes('namespaces "<name>" not found'),
        reset: NULL_RESET_PATTERN.test(section),
      }).toEqual({
        file: relative(file),
        found: true,
        notFound: true,
        reset: true,
      });
    }
  });
});

describe("aiAccess.remediation.nodeOperations in the docs", () => {
  it("says the switch reaches the Runner, not only RBAC", () => {
    for (const file of [
      AI_SRE_PAGE,
      KUBERNETES_AGENT_PAGE,
      CHART_README,
      CHART_VALUES,
      CHART_SCHEMA,
      CHART_TEMPLATE,
    ]) {
      expect({
        file: relative(file),
        env: read(file).includes(KUBECTL_ALLOW_NODE_OPERATIONS_ENV),
      }).toEqual({ file: relative(file), env: true });
    }

    expect(readFlat(CHART_NOTES)).toContain(
      "the chart grants no node RBAC, and the Runner refuses them before it runs kubectl.",
    );
  });
});

describe("what the write access amounts to, in the docs", () => {
  for (const file of WRITE_ACCESS_COPY) {
    it(`names set image as a riskier change wherever patch access is called running any image, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        equivalence: WORKLOAD_PATCH_EQUIVALENCE_PATTERN.test(text),
        setImageGated: SET_IMAGE_IS_APPROVAL_GATED_PATTERN.test(text),
        completeRefusalClaim: COMPLETE_REFUSAL_CLAIM_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        equivalence: true,
        setImageGated: true,
        completeRefusalClaim: false,
      });
    });
  }
});

describe("the in-cluster Runner's identity and registration, in the docs", () => {
  it("uses the capability titles the Runner model shows", () => {
    const titles: Array<string> = getColumnTitles(RUNNER_MODEL);

    expect(titles).toContain("Runs Runbooks");
    expect(titles).toContain("Runs AI Code Fixes");
    expect(getColumnTitles(INGESTION_KEY_MODEL)).toContain(
      "Pinned Service Name",
    );
  });

  for (const file of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE, CHART_README]) {
    it(`says the agent Runner cannot be renamed or given runbook or code-fix capabilities, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        cannotBeRenamed: text.includes("cannot be renamed"),
        runbooks: text.includes("**Runs Runbooks**"),
        codeFixes: text.includes("**Runs AI Code Fixes**"),
      }).toEqual({
        file: relative(file),
        cannotBeRenamed: true,
        runbooks: true,
        codeFixes: true,
      });
    });
  }

  for (const file of REGISTRATION_COPY) {
    it(`says a pinned key cannot register the Runner, a refusal says whether it clears on its own, and settings picked before the install are kept, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        pinnedServiceName: PINNED_SERVICE_NAME_PATTERN.test(text),
        clearsOnItsOwn: CLEARS_ON_ITS_OWN_PATTERN.test(text),
        preInstallSettingsKept: PRE_INSTALL_SETTINGS_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        pinnedServiceName: true,
        clearsOnItsOwn: true,
        preInstallSettingsKept: true,
      });
    });
  }
});
