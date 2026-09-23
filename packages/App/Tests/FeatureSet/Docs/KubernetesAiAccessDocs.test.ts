import { getKubernetesInstallationMarkdown } from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  getAiAccessHelmCommands,
  getAiAccessScopedCommandNote,
  getAiAccessWriteDisclosure,
} from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";
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
 * - The cluster AI page (Pages/Kubernetes/View/AI.tsx) is held to the same
 *   rules as the pages: every helm upgrade it offers
 *   (getAiAccessHelmCommands) refreshes the chart index first and targets
 *   the dashboard's release, and its write-access disclosure
 *   (getAiAccessWriteDisclosure) says what patch access to workloads
 *   amounts to. Both are read from Pages/Kubernetes/Utils/
 *   KubernetesAiAccessSetup.ts, which AI.tsx shows and re-exports, because
 *   AI.tsx itself reads `window` at load and this suite has no browser.
 * - What changed in round three is described as the code does it: what the
 *   bound Runner would refuse (outside aiAccess.remediation.namespaces, its
 *   own namespace, node operations with nodeOperations=false) is refused
 *   when a fix is proposed or approved; parent-replacement patches,
 *   unnamed Namespace-object writes and one-word allowlist entries are
 *   refused; a custom resource named like a built-in kind is judged by its
 *   namespace; and the agent's own Runner is never an auto-remediation
 *   rule's command Runner.
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
const RUNNER_README: string = path.join(PACKAGES_ROOT, "Runner/README.md");
const ROADMAP: string = path.join(
  REPOSITORY_ROOT,
  "Docs/Internal/Roadmap/AiClusterAccess.md",
);

// How the cluster AI page is named in an expectation.
const AI_PAGE: string = "Pages/Kubernetes/View/AI.tsx";

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
/*
 * A write the bound Runner would refuse, refused before it reaches the
 * Runner: when the fix is proposed or approved.
 */
const REFUSED_UP_FRONT_PATTERN: RegExp =
  /(when|before)[^.]{0,40}\bproposed or approved\b|proposes it and again when someone approves it/;
const AGENT_NEVER_RULE_RUNNER_PATTERN: RegExp =
  /never accepted as an auto-remediation rule's command Runner/;
// A custom resource named like a built-in kind is judged by its namespace.
const CUSTOM_RESOURCE_BY_NAMESPACE_PATTERN: RegExp =
  /custom resource is judged by (the namespace it is written in|its namespace|`-n`)/;

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function relative(filePath: string): string {
  return path.relative(REPOSITORY_ROOT, filePath);
}

// A copy an operator reads, by name, with line breaks read as one space.
interface CopySource {
  label: string;
  text: string;
}

// Line breaks, and the `#` of a YAML comment, read as one space.
const LINE_BREAK_PATTERN: RegExp = /\s*\n\s*#?\s*/g;

function fileSource(filePath: string): CopySource {
  return {
    label: relative(filePath),
    text: read(filePath).replace(LINE_BREAK_PATTERN, " "),
  };
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

// The aiAccess upgrades one place offers, in the order it offers them.
interface SetupCommandSource {
  label: string;
  blocks: Array<string>;
}

/*
 * Every place with copy-paste aiAccess upgrades: the three setup pages,
 * and the cluster AI page — every value of getAiAccessHelmCommands(), in
 * the order the page shows them (read-only first).
 */
function getSetupCommandSources(): Array<SetupCommandSource> {
  return [
    ...SETUP_PAGES.map((page: string): SetupCommandSource => {
      return {
        label: relative(page),
        blocks: getAiAccessUpgradeBlocks(read(page)),
      };
    }),
    {
      label: AI_PAGE,
      blocks: Object.values(getAiAccessHelmCommands()),
    },
  ];
}

describe("OneUptime AI cluster-access setup commands", () => {
  const target: HelmTarget = getDashboardInstallTarget();

  it("reads the dashboard's install target it compares against", () => {
    expect(target).toEqual({
      release: "kubernetes-agent",
      namespace: "oneuptime-agent",
    });
  });

  it("checks every command the cluster AI page offers, each an aiAccess upgrade", () => {
    // Harness guard: all three of the page's commands reach the loop below.
    const commands: Array<string> = Object.values(getAiAccessHelmCommands());

    expect(commands).toHaveLength(3);
    for (const command of commands) {
      expect({
        command,
        isAiAccessUpgrade:
          command.includes("helm upgrade") &&
          command.includes("--set aiAccess"),
      }).toEqual({ command, isAiAccessUpgrade: true });
    }
  });

  for (const source of getSetupCommandSources()) {
    describe(source.label, () => {
      const blocks: Array<string> = source.blocks;

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

    for (const command of Object.values(getAiAccessHelmCommands())) {
      expect({
        command,
        namesChart070: CHART_070_PATTERN.test(command),
      }).toEqual({ command, namesChart070: false });
    }
  });
});

/*
 * Everything an operator reads where write access is offered: the docs
 * files, and the cluster AI page's write-access disclosure.
 */
function getWriteAccessOffers(): Array<CopySource> {
  return [
    ...[
      AI_SRE_PAGE,
      KUBERNETES_AGENT_PAGE,
      CHART_README,
      CHART_NOTES,
      CHART_VALUES,
      CHART_SCHEMA,
      CHART_TEMPLATE,
    ].map(fileSource),
    { label: AI_PAGE, text: getAiAccessWriteDisclosure() },
  ];
}

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
    const offers: Array<CopySource> = getWriteAccessOffers();

    // Harness guard: the AI page's disclosure is one of the offers checked.
    expect(
      offers.some((offer: CopySource): boolean => {
        return offer.label === AI_PAGE && offer.text.length > 0;
      }),
    ).toBe(true);

    for (const offer of offers) {
      expect({
        file: offer.label,
        equivalence: WORKLOAD_PATCH_EQUIVALENCE_PATTERN.test(offer.text),
      }).toEqual({ file: offer.label, equivalence: true });
    }
  });

  it("names every protected namespace and aiAccess.remediation.namespaces on each setup page and the AI page", () => {
    for (const source of [
      ...SETUP_PAGES.map((file: string): CopySource => {
        return { label: relative(file), text: read(file) };
      }),
      { label: AI_PAGE, text: getAiAccessWriteDisclosure() },
    ]) {
      for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
        expect({
          file: source.label,
          namespace,
          named: source.text.includes(namespace),
        }).toEqual({
          file: source.label,
          namespace,
          named: true,
        });
      }

      expect({
        file: source.label,
        scoped: source.text.includes("aiAccess.remediation.namespaces"),
        ownNamespace: OWN_NAMESPACE_PATTERN.test(source.text),
      }).toEqual({ file: source.label, scoped: true, ownNamespace: true });
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

describe("what the bound Runner would refuse, in the docs and on the AI page", () => {
  /*
   * RemediationCommandToolkit.getRunnerScopeRefusal (compose, proposal),
   * the approval route and RunnerJobService.getRunnerWriteScopeRefusal (the
   * enqueue chokepoint) read the Runner's reported scope, so a write outside
   * aiAccess.remediation.namespaces, in the Runner's own namespace, or a
   * node operation with nodeOperations=false never reaches the Runner as a
   * failed fix. Every copy that describes the Runner's scope says so.
   */
  function getScopeCopies(): Array<CopySource> {
    return [
      ...[
        AI_SRE_PAGE,
        KUBERNETES_AGENT_PAGE,
        CHART_README,
        CHART_NOTES,
        CHART_VALUES,
        RUNNER_README,
        ROADMAP,
      ].map(fileSource),
      {
        label: `${AI_PAGE} (scoped command)`,
        text: getAiAccessScopedCommandNote(),
      },
      { label: `${AI_PAGE} (disclosure)`, text: getAiAccessWriteDisclosure() },
    ];
  }

  it("says such a fix is refused when it is proposed or approved, not only on the Runner", () => {
    for (const copy of getScopeCopies()) {
      expect({
        file: copy.label,
        refusedUpFront: REFUSED_UP_FRONT_PATTERN.test(copy.text),
      }).toEqual({ file: copy.label, refusedUpFront: true });
    }
  });

  it("names the Runner's whole scope in the every-mode lines of the AI SRE page", () => {
    const section: string = getClusterAccessSection();

    expect(section).toContain(
      "- The Runner never changes anything in its own namespace — a fix there could scale the agent, or the Runner itself, away — nor anything outside the namespaces its chart lets it write (`aiAccess.remediation.namespaces`), nor a node when its chart turned node operations off (`aiAccess.remediation.nodeOperations=false`).",
    );
    expect(section).toContain(
      "refuses such a fix when OneUptime AI proposes it and again when someone approves it, so it never reaches the Runner as a failed fix",
    );
    // The earlier copy left the refusal to the Runner alone.
    expect(section).not.toContain(
      "and the Runner refuses a write anywhere else before it spawns kubectl.",
    );
  });

  it("no longer leaves the refusal to the Runner alone on the Kubernetes agent page", () => {
    expect(read(KUBERNETES_AGENT_PAGE)).not.toContain(
      "and the Runner refuses a write anywhere else.",
    );
  });

  // Negative control: the pattern does not read Runner-only wording as up front.
  it("does not read a Runner-only refusal as an up-front one", () => {
    for (const runnerOnly of [
      "List namespaces and the chart binds it in those alone, and the Runner refuses a write anywhere else.",
      "the Runner is told the list and refuses a write outside it before spawning kubectl.",
      "Node operations (cordon, uncordon, taint, drain) are off: the chart grants no node RBAC, and the Runner refuses them before it runs kubectl.",
    ]) {
      expect({
        runnerOnly,
        refusedUpFront: REFUSED_UP_FRONT_PATTERN.test(runnerOnly),
      }).toEqual({ runnerOnly, refusedUpFront: false });
    }
  });
});

describe("the AI page's write-access commands", () => {
  const commands: ReturnType<typeof getAiAccessHelmCommands> =
    getAiAccessHelmCommands();
  const note: string = getAiAccessScopedCommandNote();

  it("says every listed namespace must already exist, and how to reset the list", () => {
    expect(note).toContain("Every namespace you list must already exist");
    expect(note).toContain('namespaces "<name>" not found');
    expect(note).toContain("--set aiAccess.remediation.namespaces=null");
  });

  /*
   * Under --reuse-values a stored value is kept when its flag is left out:
   * the cluster-wide command resets a stored namespace list, and turning
   * node operations back on takes =true, not dropping the line.
   */
  it("makes the cluster-wide command cluster-wide on a release that stored a list", () => {
    expect(commands.enableRemediation).toContain(
      "--set aiAccess.remediation.namespaces=null",
    );
    expect(commands.enableRemediationScoped).not.toContain("=null");
    expect(note).not.toContain("leave that line out");
    expect(note).toContain("set it to true to let AI cordon");
  });
});

describe("what the policy refuses, added in round three", () => {
  const PARENT_REPLACEMENT_PHRASES: Array<string> = [
    "a strategic-merge `$patch: replace`",
    "a merge patch that sets a whole `containers` list",
    "a JSON patch that replaces or removes the pod spec",
  ];
  const UNNAMED_NAMESPACE_WRITE: string =
    "a label or annotation on Namespace objects picked by `--all` or a selector instead of by name";

  for (const file of [AI_SRE_PAGE, CHART_README]) {
    it(`lists parent-replacement patches and unnamed Namespace-object writes, in ${relative(file)}`, () => {
      const text: string = read(file);

      for (const phrase of [
        ...PARENT_REPLACEMENT_PHRASES,
        UNNAMED_NAMESPACE_WRITE,
      ]) {
        expect({
          file: relative(file),
          phrase,
          listed: text.includes(phrase),
        }).toEqual({
          file: relative(file),
          phrase,
          listed: true,
        });
      }
    });

    it(`says a one-word allowlist entry is refused, in ${relative(file)}`, () => {
      expect(fileSource(file).text).toMatch(
        /more than one word after the optional leading `kubectl`/,
      );
    });
  }

  it("names parent-replacement patches wherever the policy's refusals are summed up", () => {
    for (const file of [
      KUBERNETES_AGENT_PAGE,
      CHART_NOTES,
      CHART_VALUES,
      ROADMAP,
    ]) {
      const text: string = fileSource(file).text;

      expect({
        file: relative(file),
        named:
          text.includes("replace the pod spec or a whole") ||
          text.includes("`$patch: replace`"),
      }).toEqual({ file: relative(file), named: true });
    }
  });
});

describe("custom resources named like built-in kinds", () => {
  it("are judged by their namespace, in every copy of the protected-namespace line", () => {
    for (const file of [
      AI_SRE_PAGE,
      KUBERNETES_AGENT_PAGE,
      CHART_README,
      CHART_VALUES,
      RUNNER_README,
    ]) {
      const copy: CopySource = fileSource(file);

      expect({
        file: copy.label,
        byNamespace: CUSTOM_RESOURCE_BY_NAMESPACE_PATTERN.test(copy.text),
      }).toEqual({ file: copy.label, byNamespace: true });
    }
  });
});

describe("the agent's own Runner and auto-remediation rules", () => {
  it("is never accepted as a rule's command Runner", () => {
    for (const file of [
      AI_SRE_PAGE,
      KUBERNETES_AGENT_PAGE,
      CHART_README,
      RUNNER_README,
      ROADMAP,
    ]) {
      const copy: CopySource = fileSource(file);

      expect({
        file: copy.label,
        neverRuleRunner: AGENT_NEVER_RULE_RUNNER_PATTERN.test(copy.text),
      }).toEqual({ file: copy.label, neverRuleRunner: true });
    }
  });
});
