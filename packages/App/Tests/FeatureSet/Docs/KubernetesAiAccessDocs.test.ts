import { getKubernetesInstallationMarkdown } from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { PROTECTED_KUBERNETES_NAMESPACES } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The OneUptime AI cluster-access docs against the chart and the product.
 *
 * Three pages tell an operator how to give OneUptime AI kubectl access: the
 * AI SRE page, the Kubernetes agent page and the chart README (NOTES.txt and
 * values.yaml repeat the essentials). These tests pin what they must get
 * right:
 *
 * - The setup commands work on an existing install: every `helm upgrade`
 *   that sets aiAccess.* runs `helm repo update` first (an old local index
 *   serves a chart whose schema rejects aiAccess.* with "Additional property
 *   aiAccess is not allowed"), keeps the release's values, and targets the
 *   release name and namespace the dashboard's own install instructions
 *   create. The first command is read-only; write access is its own step.
 * - No chart version is named: published charts carry the OneUptime version
 *   (release.yml packages the chart with --version set to it), so "chart
 *   0.7.0" matches no customer's install.
 * - The RBAC is described honestly: never as an "outer bound", and always
 *   with what patch access to workloads amounts to (running any image as any
 *   ServiceAccount in the namespace and reading its Secrets), the protected
 *   namespaces that always need a human, and aiAccess.remediation.namespaces.
 * - The behaviour the policy and the server enforce is described as it is:
 *   what a safe change is, when Automatic proposes a riskier change for
 *   approval, every case in which Bypass approval still asks, the
 *   word-by-word allowlist, who may loosen a cluster's AI access (the
 *   permission titles are read from the permission catalog), the deny list,
 *   and that the agent's own Runner never gets a credential and never runs
 *   Bash/SSH steps.
 * - The AI page's command history is described as what it shows — the
 *   command, its status and when it ran — not as command output.
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

// The pages with copy-paste setup commands.
const SETUP_PAGES: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
];

// Everything an operator reads about the Runner's RBAC.
const RBAC_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
  CHART_NOTES,
  CHART_VALUES,
  CHART_SCHEMA,
  CHART_TEMPLATE,
];

// A line continuation left dangling at the end of a command.
const TRAILING_CONTINUATION_PATTERN: RegExp = /\\\s*$/;
// The chart version the docs once named; no customer's install carries it.
const CHART_070_PATTERN: RegExp = /\b0\.7\.0\b/;
const OUTER_BOUND_PATTERN: RegExp = /outer bound/i;
// What patch access to workloads amounts to.
const WORKLOAD_PATCH_EQUIVALENCE_PATTERN: RegExp =
  /any image as any ServiceAccount/;
const OWN_NAMESPACE_PATTERN: RegExp = /own namespace/;

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function relative(filePath: string): string {
  return path.relative(REPOSITORY_ROOT, filePath);
}

function getBashBlocks(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/```bash\n([\s\S]*?)```/g)).map(
    (match: RegExpMatchArray) => {
      return match[1]!;
    },
  );
}

function getAiAccessUpgradeBlocks(markdown: string): Array<string> {
  return getBashBlocks(markdown).filter((block: string) => {
    return block.includes("helm upgrade") && block.includes("--set aiAccess");
  });
}

// The section of the AI SRE page about cluster access.
function getClusterAccessSection(): string {
  const page: string = read(AI_SRE_PAGE);
  const start: number = page.indexOf("## Cluster access");
  const end: number = page.indexOf("\n## ", start + 1);

  if (start === -1 || end === -1) {
    throw new Error("ai-sre.md has no '## Cluster access' section");
  }

  return page.slice(start, end);
}

interface HelmTarget {
  release: string;
  namespace: string;
}

// What the dashboard's own "add a cluster" instructions install.
function getDashboardInstallTarget(): HelmTarget {
  const markdown: string = getKubernetesInstallationMarkdown({
    clusterName: "prod-us",
    oneuptimeUrl: "https://oneuptime.example.com",
    apiKey: "key-123",
  });
  const match: RegExpMatchArray | null = markdown.match(
    /helm install (\S+) oneuptime\/kubernetes-agent \\\n\s+--namespace (\S+)/,
  );

  if (!match) {
    throw new Error(
      "The dashboard's install markdown has no `helm install <release> oneuptime/kubernetes-agent --namespace <ns>`",
    );
  }

  return { release: match[1]!, namespace: match[2]! };
}

describe("OneUptime AI cluster-access setup commands", () => {
  const target: HelmTarget = getDashboardInstallTarget();

  it("reads the dashboard's install target it compares against", () => {
    expect(target).toEqual({
      release: "kubernetes-agent",
      namespace: "oneuptime-agent",
    });
  });

  for (const page of SETUP_PAGES) {
    describe(relative(page), () => {
      const blocks: Array<string> = getAiAccessUpgradeBlocks(read(page));

      it("has at least a read-only and a write-access command", () => {
        expect(blocks.length).toBeGreaterThanOrEqual(2);
      });

      it("refreshes the chart index before every aiAccess upgrade", () => {
        for (const block of blocks) {
          const repoUpdate: number = block.indexOf("helm repo update");
          const upgrade: number = block.indexOf("helm upgrade");

          expect({
            block,
            repoUpdateFirst: repoUpdate !== -1 && repoUpdate < upgrade,
          }).toEqual({
            block,
            repoUpdateFirst: true,
          });
        }
      });

      it("upgrades the release and namespace the dashboard installs, keeping its values", () => {
        for (const block of blocks) {
          expect({
            block,
            release: block.includes(
              `helm upgrade ${target.release} oneuptime/kubernetes-agent`,
            ),
            namespace: block.includes(`--namespace ${target.namespace} `),
            reuseValues: block.includes("--reuse-values"),
          }).toEqual({
            block,
            release: true,
            namespace: true,
            reuseValues: true,
          });
        }
      });

      it("makes the first command read-only and write access a separate step", () => {
        expect(blocks[0]).toContain("--set aiAccess.enabled=true");
        expect(blocks[0]).not.toContain("aiAccess.remediation");
        expect(
          blocks.slice(1).some((block: string) => {
            return block.includes("--set aiAccess.remediation.enabled=true");
          }),
        ).toBe(true);
      });

      it("never leaves a trailing line continuation", () => {
        for (const block of blocks) {
          expect({
            block,
            dangling: TRAILING_CONTINUATION_PATTERN.test(block),
          }).toEqual({
            block,
            dangling: false,
          });
        }
      });
    });
  }

  it("never names a chart version customers cannot see", () => {
    for (const file of [...SETUP_PAGES, CHART_NOTES, CHART_VALUES]) {
      expect({
        file: relative(file),
        namesChart070: CHART_070_PATTERN.test(read(file)),
      }).toEqual({ file: relative(file), namesChart070: false });
    }
  });
});

describe("OneUptime AI cluster-access RBAC copy", () => {
  it("never calls the chart's RBAC an outer bound", () => {
    for (const file of RBAC_COPY) {
      expect({
        file: relative(file),
        outerBound: OUTER_BOUND_PATTERN.test(read(file)),
      }).toEqual({ file: relative(file), outerBound: false });
    }
  });

  it("says what patch access to workloads amounts to wherever write access is offered", () => {
    for (const file of [
      AI_SRE_PAGE,
      KUBERNETES_AGENT_PAGE,
      CHART_README,
      CHART_NOTES,
      CHART_VALUES,
      CHART_SCHEMA,
      CHART_TEMPLATE,
    ]) {
      const text: string = read(file).replace(/\s*\n\s*#?\s*/g, " ");
      expect({
        file: relative(file),
        equivalence: WORKLOAD_PATCH_EQUIVALENCE_PATTERN.test(text),
      }).toEqual({ file: relative(file), equivalence: true });
    }
  });

  it("names every protected namespace and aiAccess.remediation.namespaces on each setup page", () => {
    for (const file of SETUP_PAGES) {
      const text: string = read(file);

      for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
        expect({
          file: relative(file),
          namespace,
          named: text.includes(namespace),
        }).toEqual({
          file: relative(file),
          namespace,
          named: true,
        });
      }

      expect({
        file: relative(file),
        scoped: text.includes("aiAccess.remediation.namespaces"),
        ownNamespace: OWN_NAMESPACE_PATTERN.test(text),
      }).toEqual({ file: relative(file), scoped: true, ownNamespace: true });
    }
  });
});

describe("the AI SRE page's cluster-access section", () => {
  const section: string = getClusterAccessSection();

  it("describes the command history as what the AI page shows, not as command output", () => {
    expect(section).not.toMatch(/with its output/);
    expect(section).toContain("the command, its status and when it ran");
  });

  it("says when Automatic proposes a riskier change for one-click approval", () => {
    const automatic: string | undefined = section
      .split("\n")
      .find((line: string) => {
        return line.startsWith("- **Automatic**");
      });

    expect(automatic).toContain(
      "safe changes run on their own; a riskier change never does.",
    );
    /*
     * A cluster round proposes its refused riskier changes only when it ran
     * nothing else; after a safe fix, only the follow-up round (after a
     * failed verification) proposes the next plan. The previous copy, "a
     * riskier change is proposed for one-click approval", dropped both
     * conditions (KubernetesAiAccessDocsModes.test.ts checks every copy).
     */
    expect(automatic).toContain(
      "When the round could only find riskier fixes, it ends by proposing exactly those for one-click approval.",
    );
    expect(automatic).toContain(
      "When it also ran a safe fix, the riskier one stays in the analysis and is proposed only if verification shows the safe fix did not recover the monitors — by the follow-up round, which asks for approval.",
    );
    // The earlier copy: a riskier change was neither run nor proposed.
    expect(automatic).not.toMatch(
      /refuses them inline|neither run nor proposed/,
    );
  });

  it("lists every case in which a Bypass approval round still asks", () => {
    const start: number = section.indexOf("- **Bypass approval**");
    const end: number = section.indexOf("A **safe** change", start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const bypass: string = section.slice(start, end);

    for (const askCase of [
      "the hourly circuit breaker (three unattended fixes per cluster per hour) has tripped, or cannot be checked;",
      "another unattended OneUptime AI round is still changing, or still verifying a fix on, the same cluster",
      "it is the follow-up round after a fix whose rollback did not complete.",
    ]) {
      expect({ askCase, listed: bypass.includes(askCase) }).toEqual({
        askCase,
        listed: true,
      });
    }

    // The previous copy's absolute claims.
    expect(bypass).not.toContain("nobody is asked");
    expect(bypass).not.toContain(
      "The only exception is the hourly circuit breaker",
    );
  });

  it("leaves the ask-for-approval description as it was", () => {
    // Negative control for the two mode rewrites above.
    const requireApproval: string | undefined = section
      .split("\n")
      .find((line: string) => {
        return line.startsWith("- **Ask for approval**");
      });

    expect(requireApproval).toContain(
      "a human approves it with one click, and OneUptime runs exactly those commands",
    );
  });

  it("defines a safe change as one named object and names what is riskier", () => {
    expect(section).toContain(
      "A **safe** change touches exactly one named object",
    );
    expect(section).toContain("`scale` (to anything but 0)");
    for (const riskier of [
      "`scale` to 0",
      "deleting a job",
      "`taint`",
      "on a bare kind",
    ]) {
      expect({ riskier, named: section.includes(riskier) }).toEqual({
        riskier,
        named: true,
      });
    }
  });

  it("says protected namespaces always need a human and the Runner never changes its own namespace", () => {
    expect(section).toContain(
      "A write in **kube-system**, **kube-public** or **kube-node-lease** always needs a human.",
    );
    expect(section).toContain(
      "The Runner never changes anything in its own namespace",
    );
  });

  it("describes the allowlist as word by word", () => {
    expect(section).toContain("`*` stands for exactly one word");
    expect(section).toContain(
      "every flag the command uses must be written out in the entry",
    );
  });

  it("names who may loosen a cluster's AI access, from the permission catalog", () => {
    const whoMay: string = section.slice(
      section.indexOf("### Who may change it"),
    );

    for (const permission of KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS) {
      const title: string = PermissionHelper.getTitle(permission);
      expect({ title, named: whoMay.includes(title) }).toEqual({
        title,
        named: true,
      });
    }

    // The permission only credential binding adds.
    const credentialOnly: Array<Permission> =
      KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS.filter(
        (permission: Permission) => {
          return !KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS.includes(permission);
        },
      );

    expect(credentialOnly.length).toBeGreaterThan(0);

    for (const permission of credentialOnly) {
      const title: string = PermissionHelper.getTitle(permission);
      expect({ title, named: whoMay.includes(title) }).toEqual({
        title,
        named: true,
      });
    }

    expect(whoMay).toContain("open to anyone who may edit the cluster");
  });

  it("says the agent's own Runner is never handed a credential and never runs Bash/SSH steps", () => {
    expect(section).toContain("OneUptime never hands it a credential");
    expect(section).toContain("never used as a Bash/SSH host");
  });

  it("lists the commands the policy refuses in every mode, including the hardening additions", () => {
    for (const denied of [
      "`set serviceaccount`",
      "`set subject`",
      /*
       * `create job --image` became one of three: every create subcommand
       * that makes a pod template is refused with an image, and a patch
       * body must be JSON.
       */
      "`create deployment`, `create cronjob` or `create job` with `--image` (`create job --from=cronjob/…` stays a riskier change)",
      "a `patch` body that is not JSON",
      "any write — `patch`, `label`, `annotate`, `set` — to RBAC objects, CustomResourceDefinitions, APIServices, admission webhook configurations or admission policies",
      "`certificate approve`",
      "`create clusterrolebinding`",
      "`--kuberc`",
      "`--as-user-extra`",
      "kubectl plugins",
      "patches that change a pod template's ServiceAccount, volumes or security settings",
    ]) {
      expect({ denied, listed: section.includes(denied) }).toEqual({
        denied,
        listed: true,
      });
    }
  });

  it("says the Runner turns kuberc off", () => {
    expect(section).toContain("turns kuberc off");
  });
});
