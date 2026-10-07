import {
  KUBERNETES_PLATFORMS,
  KubernetesPlatform,
  getKubernetesSetupGuide,
} from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  SetupGuideOption,
  getSetupGuideMarkdown,
} from "../../../FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";

import {
  AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG,
  AI_AGENT_EXAMPLE_WRITE_NAMESPACES,
  getAiAgentClusterWideCommandNote,
  getAiAgentHelmCommands,
  getAiAgentScopedCommandNote,
  getAiAgentWriteDisclosure,
} from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";
import { REMEDIATION_MODE_SHORT_NAMES } from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSettings";
import {
  AI_AGENT_APPLY_SETTINGS_COMMAND,
  AI_AGENT_CLUSTER_WIDE_WRITE_COMMAND,
  AI_AGENT_INSTALL_COMMAND,
  AI_AGENT_PAGE,
  AI_AGENT_SCOPED_WRITE_COMMAND,
  AI_SRE_PAGE,
  CHART_NOTES,
  CHART_README,
  CHART_SCHEMA,
  CHART_TEMPLATE,
  CHART_VALUES,
  CopySource,
  EMPTY_LIST_RESET_FLAG,
  KUBERNETES_AGENT_PAGE,
  PACKAGES_ROOT,
  RUNNER_README,
  UPGRADING_PAGE,
  fileSource,
  getAiAgentSetupBlocks,
  getAiAgentUpgradeBlocks,
  getBashBlocks,
  getClusterAccessSection,
  getSection,
  read,
  relative,
} from "./KubernetesAiAgentDocsSupport";
import {
  KUBERNETES_AI_AGENT_COMPONENT,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  KUBERNETES_AI_AGENT_IMAGE_REPOSITORY,
  KubernetesAiRemediationMode,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * The dashboard's install guide for every platform the reader can pick,
 * Advanced and Troubleshooting included, as one document.
 */
function getKubernetesInstallationMarkdown(data: {
  clusterName: string;
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return KUBERNETES_PLATFORMS.map(
    (option: SetupGuideOption<KubernetesPlatform>): string => {
      return getSetupGuideMarkdown(
        getKubernetesSetupGuide({ ...data, platform: option.key }),
      );
    },
  ).join("\n");
}

/*
 * The Kubernetes AI agent docs against the chart and the product.
 *
 * The kubernetes-agent chart runs the Kubernetes AI agent (image
 * oneuptime/kubernetes-ai-agent, pod label component=ai-agent) by default,
 * read-only; one chart flag grants it write access, and the cluster's AI
 * agent page (AI → Agent) picks how fixes run. Three pages tell an operator
 * how — the AI SRE page, the Kubernetes agent page and the chart README —
 * and the upgrade notes, NOTES.txt and values.yaml repeat the essentials.
 * These tests pin what they must get right:
 *
 * - The setup commands are the three the dashboard prints
 *   (getAiAgentHelmCommands), verbatim: `helm repo update` first (an old
 *   local index serves a chart whose schema rejects aiAgent.* with
 *   "Additional property aiAgent is not allowed"), the release name and
 *   namespace the dashboard's install instructions create,
 *   --reset-then-reuse-values (never --reuse-values, which keeps the old
 *   chart's defaults),
 *   the install first and read-only, write access a separate step, and the
 *   cluster-wide command resetting a stored namespace list.
 * - No chart version is named: published charts carry the OneUptime
 *   version, so "chart 0.7.0" matches no customer's install.
 * - The RBAC is described honestly: never as an "outer bound", and always
 *   with what patch access to workloads amounts to (running any image as any
 *   ServiceAccount in the namespace and reading its Secrets), the protected
 *   namespaces that always need a human, the agent's own namespace, and
 *   aiAgent.remediation.namespaces.
 * - The AI SRE page describes the model as the product builds it: on by
 *   default and read-only, the AI → Agent, AI → Insights and AI → Logs pages, Test
 *   connection and Reset agent, every fix mode and every-mode protection the
 *   server enforces, who may turn fixes on (the permission titles come from
 *   the permission catalog), the deny list, and that the agent is not a
 *   Runner (never a credential, never a Bash/SSH host, never a rule's
 *   command Runner). The advanced Runner + credential route stays documented.
 * - What the agent would refuse (outside aiAgent.remediation.namespaces, its
 *   own namespace, node operations with nodeOperations=false) is described
 *   as refused when a fix is proposed or approved, not only in the agent.
 */

const RBAC_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
  CHART_NOTES,
  CHART_VALUES,
  CHART_SCHEMA,
  CHART_TEMPLATE,
];

// The pages with copy-paste setup commands.
const SETUP_PAGES: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
];

// The docs pages this repository's docs site serves, which B6 owns.
const DOCS_PAGES: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  UPGRADING_PAGE,
];

// A line continuation left dangling at the end of a command.
const TRAILING_CONTINUATION_PATTERN: RegExp = /\\\s*$/;
// The chart version the docs once named; no customer's install carries it.
const CHART_070_PATTERN: RegExp = /\b0\.7\.0\b/;
// The --reuse-values flag itself, not --reset-then-reuse-values.
const REUSE_VALUES_FLAG_PATTERN: RegExp = /(^|\s)--reuse-values(\s|$)/;
const OUTER_BOUND_PATTERN: RegExp = /outer bound/i;
// What patch access to workloads amounts to.
const WORKLOAD_PATCH_EQUIVALENCE_PATTERN: RegExp =
  /any image as any ServiceAccount/;
const OWN_NAMESPACE_PATTERN: RegExp = /own namespace/;
/*
 * A write the agent would refuse, refused before it reaches the agent: when
 * the fix is proposed or approved.
 */
const REFUSED_UP_FRONT_PATTERN: RegExp =
  /(when|before)[^.]{0,40}\bproposed or approved\b|proposes it and again when someone approves it/;
const NEVER_RULE_RUNNER_PATTERN: RegExp =
  /never accepted as an auto-remediation rule's command Runner/;
// A custom resource named like a built-in kind is judged by its namespace.
const CUSTOM_RESOURCE_BY_NAMESPACE_PATTERN: RegExp =
  /custom resource is judged by (the namespace it is written in|its namespace|`-n`)/;
// A bullet naming a fix setting ("- **Ask for approval** — ..."), and its title.
const FIX_SETTING_LINE_PATTERN: RegExp = /^- \*\*[A-Z]/;
const BULLET_TITLE_PATTERN: RegExp = /^- \*\*([^*]+)\*\*/;
// A helm command that still sets the key the agent replaced.
const OLD_KEY_SET_PATTERN: RegExp = /--set(-json)? ['"]?aiAccess\./;
/*
 * The cluster page the AI section replaced ("the cluster's AI page",
 * Kubernetes → cluster → AI). Its settings live on the AI agent page now.
 */
const OLD_AI_PAGE_PATTERN: RegExp = /cluster's (\*\*)?AI(\*\*)? page/;

// What the dashboard's own "add a cluster" instructions install.
function getDashboardInstallTarget(): { release: string; namespace: string } {
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

// The aiAgent setup commands one place offers, in the order it offers them.
interface SetupCommandSource {
  label: string;
  blocks: Array<string>;
}

/*
 * Every place with copy-paste aiAgent setup commands: the three setup pages
 * and the cluster's AI agent page — every value of getAiAgentHelmCommands(),
 * in the order the page shows them (the install first).
 */
function getSetupCommandSources(): Array<SetupCommandSource> {
  const commands: ReturnType<typeof getAiAgentHelmCommands> =
    getAiAgentHelmCommands();

  return [
    ...SETUP_PAGES.map((page: string): SetupCommandSource => {
      return {
        label: relative(page),
        blocks: getAiAgentSetupBlocks(read(page)),
      };
    }),
    {
      label: AI_AGENT_PAGE,
      blocks: [
        commands.install,
        commands.enableRemediationScoped,
        commands.enableRemediation,
      ],
    },
  ];
}

describe("Kubernetes AI agent setup commands", () => {
  it("reads the dashboard's install target it compares against", () => {
    expect(getDashboardInstallTarget()).toEqual({
      release: "kubernetes-agent",
      namespace: "oneuptime-agent",
    });
  });

  it("builds the shared commands from the dashboard's release and namespace", () => {
    const target: { release: string; namespace: string } =
      getDashboardInstallTarget();

    for (const command of [
      AI_AGENT_INSTALL_COMMAND,
      AI_AGENT_SCOPED_WRITE_COMMAND,
      AI_AGENT_CLUSTER_WIDE_WRITE_COMMAND,
    ]) {
      expect(command).toContain(
        `helm upgrade ${target.release} oneuptime/kubernetes-agent \\\n  --namespace ${target.namespace} --reset-then-reuse-values`,
      );
    }
  });

  it("offers exactly the shared commands on the cluster's AI agent page", () => {
    expect(getAiAgentHelmCommands()).toEqual({
      install: AI_AGENT_INSTALL_COMMAND,
      applySettings: AI_AGENT_APPLY_SETTINGS_COMMAND,
      enableRemediationScoped: AI_AGENT_SCOPED_WRITE_COMMAND,
      enableRemediation: AI_AGENT_CLUSTER_WIDE_WRITE_COMMAND,
    });
  });

  it("names the example namespaces and the cluster-wide reset the commands use", () => {
    expect(AI_AGENT_EXAMPLE_WRITE_NAMESPACES).toBe("{web,api}");
    expect(AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG).toBe(EMPTY_LIST_RESET_FLAG);
    expect(AI_AGENT_SCOPED_WRITE_COMMAND).toContain(
      `"aiAgent.remediation.namespaces=${AI_AGENT_EXAMPLE_WRITE_NAMESPACES}"`,
    );
    expect(AI_AGENT_CLUSTER_WIDE_WRITE_COMMAND).toContain(
      AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG,
    );
  });

  for (const page of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE]) {
    it(`prints the install and both write-access commands verbatim, in ${relative(page)}`, () => {
      const blocks: Array<string> = getBashBlocks(read(page));

      for (const command of [
        AI_AGENT_INSTALL_COMMAND,
        AI_AGENT_SCOPED_WRITE_COMMAND,
        AI_AGENT_CLUSTER_WIDE_WRITE_COMMAND,
      ]) {
        expect({
          file: relative(page),
          command,
          printed: blocks.includes(command),
        }).toEqual({ file: relative(page), command, printed: true });
      }
    });
  }

  it("prints the install command verbatim in the upgrade notes", () => {
    expect(getBashBlocks(read(UPGRADING_PAGE))).toContain(
      AI_AGENT_INSTALL_COMMAND,
    );
  });

  for (const source of getSetupCommandSources()) {
    describe(source.label, () => {
      const blocks: Array<string> = source.blocks;

      it("has at least an install and a write-access command", () => {
        expect(blocks.length).toBeGreaterThanOrEqual(2);
      });

      it("refreshes the chart index before every aiAgent upgrade", () => {
        for (const block of blocks) {
          const repoUpdate: number = block.indexOf("helm repo update");
          const upgrade: number = block.indexOf("helm upgrade");

          expect({
            block,
            repoUpdateFirst: repoUpdate !== -1 && repoUpdate < upgrade,
          }).toEqual({ block, repoUpdateFirst: true });
        }
      });

      it("upgrades the release and namespace the dashboard installs, keeping its values", () => {
        for (const block of blocks) {
          expect({
            block,
            release: block.includes(
              "helm upgrade kubernetes-agent oneuptime/kubernetes-agent",
            ),
            namespace: block.includes("--namespace oneuptime-agent "),
            keepsReleaseValues: block.includes("--reset-then-reuse-values"),
            reuseValues: REUSE_VALUES_FLAG_PATTERN.test(block),
          }).toEqual({
            block,
            release: true,
            namespace: true,
            keepsReleaseValues: true,
            reuseValues: false,
          });
        }
      });

      it("makes the first command the read-only install and write access a separate step", () => {
        expect(blocks[0]).toContain("--set aiAgent.enabled=true");
        expect(blocks[0]).not.toContain("aiAgent.remediation");
        expect(
          blocks.slice(1).some((block: string): boolean => {
            return block.includes("--set aiAgent.fixes=ask-for-approval");
          }),
        ).toBe(true);
        // aiAgent.fixes replaces the deprecated write switch everywhere.
        for (const block of blocks) {
          expect({
            block,
            deprecated: block.includes("aiAgent.remediation.enabled"),
          }).toEqual({ block, deprecated: false });
        }
      });

      it("offers a cluster-wide command that resets a stored namespace list", () => {
        expect(
          blocks.some((block: string): boolean => {
            return (
              block.includes("--set aiAgent.fixes=ask-for-approval") &&
              block.includes(EMPTY_LIST_RESET_FLAG)
            );
          }),
        ).toBe(true);
      });

      it("never leaves a trailing line continuation", () => {
        for (const block of blocks) {
          expect({
            block,
            dangling: TRAILING_CONTINUATION_PATTERN.test(block),
          }).toEqual({ block, dangling: false });
        }
      });
    });
  }

  it("refreshes the chart index before every aiAgent upgrade on every page, opt-outs included", () => {
    // An opt-out against an old index fails the old schema just the same.
    for (const page of [...SETUP_PAGES, UPGRADING_PAGE]) {
      for (const block of getAiAgentUpgradeBlocks(read(page))) {
        const repoUpdate: number = block.indexOf("helm repo update");

        expect({
          file: relative(page),
          block,
          repoUpdateFirst:
            repoUpdate !== -1 && repoUpdate < block.indexOf("helm upgrade"),
        }).toEqual({ file: relative(page), block, repoUpdateFirst: true });
      }
    }
  });

  it("never sets the replaced aiAccess key in a copy-paste command", () => {
    const commands: Array<CopySource> = [
      ...[...SETUP_PAGES, UPGRADING_PAGE].flatMap(
        (page: string): Array<CopySource> => {
          return getBashBlocks(read(page)).map((block: string): CopySource => {
            return { label: relative(page), text: block };
          });
        },
      ),
      ...Object.values(getAiAgentHelmCommands()).map(
        (command: string): CopySource => {
          return { label: AI_AGENT_PAGE, text: command };
        },
      ),
    ];

    // Harness guard: the commands were found.
    expect(commands.length).toBeGreaterThan(10);

    for (const command of commands) {
      expect({
        file: command.label,
        command: command.text,
        setsAiAccess: OLD_KEY_SET_PATTERN.test(command.text),
      }).toEqual({
        file: command.label,
        command: command.text,
        setsAiAccess: false,
      });
    }
  });

  // Negative control: the old key's commands are flagged, the new ones are not.
  it("flags a command that still sets aiAccess.*", () => {
    for (const oldCommand of [
      "--set aiAccess.enabled=true",
      '--set "aiAccess.remediation.namespaces={web,api}"',
      "--set-json 'aiAccess.remediation.namespaces=[]'",
    ]) {
      expect(OLD_KEY_SET_PATTERN.test(oldCommand)).toBe(true);
    }

    expect(OLD_KEY_SET_PATTERN.test(AI_AGENT_SCOPED_WRITE_COMMAND)).toBe(false);
  });

  it("never names a chart version customers cannot see", () => {
    for (const file of [
      ...SETUP_PAGES,
      UPGRADING_PAGE,
      CHART_NOTES,
      CHART_VALUES,
    ]) {
      /*
       * Except values.yaml's chartDefaultsVersion, Chart.yaml's version in
       * the repository: the release pipeline stamps the published one with
       * the version it publishes the chart as, which is what customers see.
       */
      const text: string =
        file === CHART_VALUES
          ? read(file).replace(/^chartDefaultsVersion: .*$/m, "")
          : read(file);
      expect({
        file: relative(file),
        namesChart070: CHART_070_PATTERN.test(text),
      }).toEqual({ file: relative(file), namesChart070: false });
    }

    for (const command of Object.values(getAiAgentHelmCommands())) {
      expect({
        command,
        namesChart070: CHART_070_PATTERN.test(command),
      }).toEqual({ command, namesChart070: false });
    }
  });
});

describe("the in-app install page and the docs agree on the Kubernetes AI agent", () => {
  const markdown: string = getKubernetesInstallationMarkdown({
    clusterName: "prod-us",
    oneuptimeUrl: "https://oneuptime.example.com",
    apiKey: "key-123",
  });

  it("names the agent, its pod and how to opt out, as the docs do", () => {
    expect(markdown).toContain(KUBERNETES_AI_AGENT_DISPLAY_NAME);
    expect(markdown).toContain(KUBERNETES_AI_AGENT_COMPONENT);
    expect(markdown).toContain("--set aiAgent.enabled=false");

    for (const page of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE]) {
      expect({
        file: relative(page),
        optOut: read(page).includes("`--set aiAgent.enabled=false`"),
      }).toEqual({ file: relative(page), optOut: true });
    }
  });
});

/*
 * Everything an operator reads where write access is offered: the docs
 * files, the chart, and the AI agent page's write-access disclosure.
 */
function getWriteAccessOffers(): Array<CopySource> {
  return [
    ...RBAC_COPY.map(fileSource),
    { label: AI_AGENT_PAGE, text: getAiAgentWriteDisclosure() },
  ];
}

describe("Kubernetes AI agent RBAC copy", () => {
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

    // Harness guard: the AI agent page's disclosure is one of the offers.
    expect(
      offers.some((offer: CopySource): boolean => {
        return offer.label === AI_AGENT_PAGE && offer.text.length > 0;
      }),
    ).toBe(true);

    for (const offer of offers) {
      expect({
        file: offer.label,
        equivalence: WORKLOAD_PATCH_EQUIVALENCE_PATTERN.test(offer.text),
      }).toEqual({ file: offer.label, equivalence: true });
    }
  });

  it("keeps the whole equivalence sentence in the AI agent page's disclosure", () => {
    expect(getAiAgentWriteDisclosure()).toContain(
      "equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets",
    );
  });

  it("names every protected namespace, the agent's own namespace and aiAgent.remediation.namespaces on each setup page and the AI agent page", () => {
    for (const source of [
      ...SETUP_PAGES.map((file: string): CopySource => {
        return { label: relative(file), text: read(file) };
      }),
      { label: AI_AGENT_PAGE, text: getAiAgentWriteDisclosure() },
    ]) {
      for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
        expect({
          file: source.label,
          namespace,
          named: source.text.includes(namespace),
        }).toEqual({ file: source.label, namespace, named: true });
      }

      expect({
        file: source.label,
        scoped: source.text.includes("aiAgent.remediation.namespaces"),
        ownNamespace: OWN_NAMESPACE_PATTERN.test(source.text),
      }).toEqual({ file: source.label, scoped: true, ownNamespace: true });
    }

    expect(getAiAgentWriteDisclosure()).toContain("the agent's own namespace");
  });
});

describe("the AI SRE page's cluster-access section", () => {
  const section: string = getClusterAccessSection();

  it("says the Kubernetes AI agent is on by default and read-only, and names its pod and image", () => {
    const agent: string = getSection(
      section,
      "### The Kubernetes AI agent — on by default, read-only",
    );

    expect(agent).toContain("runs the Kubernetes AI agent by default");
    expect(agent).toContain("**read-only** ServiceAccount");
    expect(agent).toContain(`\`component=${KUBERNETES_AI_AGENT_COMPONENT}\``);
    expect(agent).toContain(`\`${KUBERNETES_AI_AGENT_IMAGE_REPOSITORY}\``);
    expect(agent).toContain("nothing to set up in the dashboard");
  });

  it("names the cluster's AI section: the AI agent, AI Insights and AI Logs pages", () => {
    expect(section).toContain("Kubernetes → cluster → AI");
    expect(section).toContain("- **Agent** — the cluster's **AI agent** page");
    expect(section).toContain(
      "- **Insights** — the cluster's **AI Insights** page: what OneUptime AI has learned about the cluster from its own work there, and what deserves your attention (see [What AI learned on a cluster](#what-ai-learned-on-a-cluster)).",
    );
    expect(section).toContain(
      "- **Logs** — the cluster's **AI Logs** page: everything OneUptime AI did on the cluster, newest first (see [Everything AI did on a cluster](#everything-ai-did-on-a-cluster)).",
    );
  });

  it("never sends the reader to the cluster page the AI section replaced", () => {
    for (const file of [...DOCS_PAGES, RUNNER_README]) {
      expect({
        file: relative(file),
        oldAiPage: OLD_AI_PAGE_PATTERN.test(read(file)),
      }).toEqual({ file: relative(file), oldAiPage: false });
    }
  });

  // Negative control for the pattern above.
  it("reads the old page name, and not the new ones, as the old page", () => {
    expect(
      OLD_AI_PAGE_PATTERN.test("pick the mode on the cluster's AI page"),
    ).toBe(true);
    expect(
      OLD_AI_PAGE_PATTERN.test("the cluster's **AI** page (Kubernetes → AI)"),
    ).toBe(true);
    expect(OLD_AI_PAGE_PATTERN.test("the cluster's **AI agent** page")).toBe(
      false,
    );
    expect(OLD_AI_PAGE_PATTERN.test("the cluster's AI Insights page")).toBe(
      false,
    );
    expect(OLD_AI_PAGE_PATTERN.test("the cluster's **AI Logs** page")).toBe(
      false,
    );
  });

  it("describes Test connection and Reset agent, in the ⋯ next to the agent's status", () => {
    expect(section).toContain(
      "**Test connection**, in the **⋯** menu next to the agent's status on the AI agent page, runs `kubectl version` and `kubectl auth can-i --list` through the agent",
    );
    expect(section).toContain(
      "**Reset agent**, in the same menu, makes the server forget the agent's key once you confirm it; the pod reconnects on its own",
    );
  });

  it("describes the command history as what the AI Logs page shows, not as command output", () => {
    const logs: string = getSection(
      section,
      "### Everything AI did on a cluster",
    );

    expect(section).not.toMatch(/with its output/);
    expect(logs).toContain("**AI Logs** page (AI → Logs)");
    expect(logs).toContain("the command, its status and when it ran");
    // The page was renamed: an old bookmark still lands somewhere useful.
    expect(logs).toContain(
      "This page used to be called AI Insights; a bookmark of its old address now opens the AI Insights page, which links here.",
    );
    // A summary is never "not recorded" when the report has one.
    expect(logs).toContain(
      "An investigation's summary is its TL;DR or, when no TL;DR could be written, the summary its report opens with.",
    );
  });

  it("describes the AI Insights page as derived from what OneUptime recorded, not as a list", () => {
    const insights: string = getSection(
      section,
      "### What AI learned on a cluster",
    );

    expect(insights).toContain("**AI Insights** page (AI → Insights)");
    for (const card of [
      "- **Needs attention**",
      "- **Last 30 days**",
      "- **Problems OneUptime AI investigated**",
      "- **Hotspots**",
      "- **Fixes**",
      "- **Preventive insights**",
    ]) {
      expect(insights).toContain(card);
    }
    expect(insights).toContain("no model is called to build it");
    expect(insights).toContain(
      "it only names incidents and alerts they may read",
    );
    // The chronological list is the AI Logs page's, not this one's.
    expect(insights).not.toContain("every kubectl command");
  });

  it("says when Automatic proposes a riskier change for one-click approval", () => {
    const automatic: string | undefined = section
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- **Automatic**");
      });

    expect(automatic).toContain(
      "safe changes run on their own; a riskier change never does.",
    );
    /*
     * A cluster round proposes its refused riskier changes only when it ran
     * nothing else; after a safe fix, only the follow-up round (after a
     * failed verification) proposes the next plan.
     */
    expect(automatic).toContain(
      "When the round could only find riskier fixes, it ends by proposing exactly those for one-click approval.",
    );
    expect(automatic).toContain(
      "When it also ran a safe fix, the riskier one stays in the analysis and is proposed only if verification shows the safe fix did not recover the monitors — by the follow-up round, which asks for approval.",
    );
    expect(automatic).toContain(
      "Allowlist a riskier command's shape on the AI agent page and it runs on its own too.",
    );
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

    expect(bypass).not.toContain("nobody is asked");
    expect(bypass).not.toContain(
      "The only exception is the hourly circuit breaker",
    );
  });

  it("describes ask for approval as one-click approval of exactly the planned commands", () => {
    const requireApproval: string | undefined = section
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- **Ask for approval**");
      });

    expect(requireApproval).toContain(
      "a human approves it with one click, and OneUptime runs exactly those commands",
    );
  });

  it("names every fix setting on the AI agent page, Off first", () => {
    const fixes: string = getSection(section, "### How fixes work");
    const settings: Array<string> = fixes
      .split("\n")
      .filter((line: string): boolean => {
        return FIX_SETTING_LINE_PATTERN.test(line);
      })
      .map((line: string): string => {
        return line.match(BULLET_TITLE_PATTERN)![1]!;
      });

    expect(fixes).toContain(
      "**Fixes** on the AI agent page have four settings",
    );
    expect(settings).toEqual([
      "Off",
      "Ask for approval",
      "Automatic",
      "Bypass approval",
    ]);
  });

  // The names the AI agent page's Fixes row and its Change modal show.
  it("names the fix settings as the AI agent page does, one for each mode", () => {
    const settings: Array<string> = getSection(section, "### How fixes work")
      .split("\n")
      .filter((line: string): boolean => {
        return FIX_SETTING_LINE_PATTERN.test(line);
      })
      .map((line: string): string => {
        return line.match(BULLET_TITLE_PATTERN)![1]!;
      });

    expect(settings).toEqual(
      Object.values(KubernetesAiRemediationMode).map(
        (mode: KubernetesAiRemediationMode): string => {
          return REMEDIATION_MODE_SHORT_NAMES[mode];
        },
      ),
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

  it("says protected namespaces always need a human and the AI agent never changes its own namespace", () => {
    expect(section).toContain(
      "A write in **kube-system**, **kube-public** or **kube-node-lease** always needs a human.",
    );
    expect(section).toContain(
      "The AI agent never changes anything in its own namespace",
    );
  });

  it("describes the allowlist as word by word", () => {
    expect(section).toContain("`*` stands for exactly one word");
    expect(section).toContain(
      "every flag the command uses must be written out in the entry",
    );
  });

  it("names who may turn fixes on or loosen them, from the permission catalog", () => {
    const whoMay: string = getSection(section, "### Who may change it");

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
        (permission: Permission): boolean => {
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

  /*
   * Moving a cluster from Off to any fix mode is a loosening
   * (KubernetesClusterService.getAiAccessLoosening), and so is clearing a
   * Runner binding on a cluster that has an AI agent (it moves the cluster
   * onto the agent). Earlier copy listed only the unattended modes.
   */
  it("says turning fixes on and clearing a Runner binding on an agent cluster need the same people", () => {
    const whoMay: string = getSection(section, "### Who may change it");

    expect(whoMay).toContain(
      "Turning fixes on — any move from **Off** to another mode",
    );
    expect(whoMay).toContain(
      "removing that binding from a cluster that has a Kubernetes AI agent",
    );
    expect(whoMay).toContain("**Reset agent** takes the same people");
    // Tightening no longer includes clearing the binding.
    expect(whoMay).not.toContain("clearing the allowlist or the binding");
  });

  it("says the Kubernetes AI agent is not a Runner: no credential, no Bash/SSH, no rule command Runner", () => {
    expect(section).toContain(
      "The Kubernetes AI agent is not a Runner and never appears under Runbooks → Runners.",
    );
    expect(section).toContain("OneUptime never hands it a credential");
    expect(section).toContain("never used as a Bash/SSH host");
    expect(section).toMatch(NEVER_RULE_RUNNER_PATTERN);
  });

  /*
   * "Enable AI Command Execution" used to be a second project switch for
   * fixes through a Runner; it was folded into Enable AI, so neither route
   * may send anyone looking for it. What fixes need now is Enable AI and the
   * signal kind's own "Fix new incidents automatically" (or alerts), the
   * same through the AI agent or a Runner.
   */
  it("says fixes need Enable AI and the fixing switch, through the AI agent or a Runner", () => {
    const fixes: string = getSection(
      section,
      "### Letting AI fix what it finds",
    );
    const runner: string = getSection(
      section,
      "### Through a Runner instead (advanced)",
    );

    expect(fixes).toContain(
      "**Fix new incidents automatically** (on **Incidents > AI > Settings**) and **Fix new alerts automatically** (on **Alerts > AI > Settings**) start off",
    );
    expect(fixes).toContain(
      "**Enable AI** (Project Settings > AI > AI Features) is on unless someone turned it off",
    );
    expect(runner).toContain(
      "Fixes through a Runner need the same project switches as fixes through the AI agent: **Enable AI**, and **Fix new incidents automatically** (or alerts).",
    );

    for (const copy of [fixes, runner]) {
      expect(copy).not.toMatch(/AI command execution/i);
      expect(copy).not.toMatch(/enable auto[- ]?remediation/i);
    }
  });

  it("keeps the advanced Runner + credential route, with its write limits and the switch back to the agent", () => {
    const runner: string = getSection(
      section,
      "### Through a Runner instead (advanced)",
    );

    for (const expected of [
      "Runner Credentials",
      "**Runs AI Remediation Commands**",
      "**AI Access Runner** and **AI Access Credential**",
      "**Switch to the AI agent**",
      "`ONEUPTIME_KUBECTL_WRITE_NAMESPACES`",
    ]) {
      expect({ expected, named: runner.includes(expected) }).toEqual({
        expected,
        named: true,
      });
    }
  });

  it("sends clusters still on the previous in-cluster Runner to the upgrade notes", () => {
    const runner: string = getSection(
      section,
      "### Through a Runner instead (advanced)",
    );

    expect(runner).toContain("`aiAccess.enabled=true`");
    expect(runner).toContain(
      "(/docs/telemetry/kubernetes-agent#upgrading-the-agent)",
    );
  });

  it("lists the commands the policy refuses in every mode, including the hardening additions", () => {
    for (const denied of [
      "`set serviceaccount`",
      "`set subject`",
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

    expect(section).toContain(
      "by the server's tool, by the server's enqueue chokepoint, and by the AI agent before it spawns `kubectl`",
    );
  });

  it("says the AI agent turns kuberc off and never copies its ServiceAccount token", () => {
    expect(section).toContain("turns kuberc off");
    expect(section).toContain(
      "points at the mounted token file, never a copy of the token",
    );
  });
});

describe("enabling AI investigations and postmortems, on the AI SRE page", () => {
  const page: string = read(AI_SRE_PAGE);
  const enabling: string = getSection(page, "## Enabling AI investigations");
  const postmortem: string = getSection(page, "## Auto-postmortem");

  it("says investigations are on by default for new projects, and how an older project turns them on", () => {
    expect(enabling).toContain(
      "Autonomous investigations are **on by default for new projects**.",
    );
    expect(enabling).toContain(
      "A project created before this default keeps its setting",
    );
    expect(enabling).toContain(
      "**Turn on** on any Kubernetes cluster's **AI agent** page",
    );
    expect(enabling).not.toContain("**off by default**. To enable them");
  });

  it("says the other AI features on the page are on for new projects too", () => {
    expect(enabling).toContain(
      "So is every other AI feature on this page: postmortem drafts, automatic code fixes and AI Insights.",
    );
  });

  /*
   * The docs claim is the server's: ProjectService turns every per-feature
   * AI switch on for a new project unless the create request set it, and
   * never touches an existing project.
   */
  it("matches what ProjectService does for a new project", () => {
    const service: string = read(
      path.join(PACKAGES_ROOT, "Common/Server/Services/ProjectService.ts"),
    );
    const listStart: number = service.indexOf(
      "export const NEW_PROJECT_AI_DEFAULT_COLUMNS",
    );
    const list: string = service.slice(
      listStart,
      service.indexOf("];", listStart),
    );
    const start: number = service.indexOf("public applyNewProjectAiDefaults(");
    const body: string = service.slice(
      start,
      service.indexOf("\n  }\n", start),
    );

    expect(listStart).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(-1);

    for (const column of [
      "enableAutomaticIncidentInvestigation",
      "enableAutomaticAlertInvestigation",
      "enableAutomaticPostmortemDraft",
      "enableAutomaticIncidentCodeFixes",
      "enableAutomaticAlertCodeFixes",
      "enableAiInsights",
      "enableInsightFixTasks",
    ]) {
      expect(list).toContain(`"${column}"`);
    }

    expect(body).toContain("of NEW_PROJECT_AI_DEFAULT_COLUMNS");
    expect(body).toContain("data[column] = true;");
  });

  it("sends the Enable AI switch to Project Settings > AI > AI Features", () => {
    expect(enabling).toContain(
      "Project Settings > AI > AI Features > Enable AI",
    );
    expect(page).not.toContain("AI Credits > Enable AI");
  });

  /*
   * Auto Recharge only tops up credits that have not run out, so it is not
   * a way to start; and only an owner or Manage Billing may add them.
   */
  it("says the Cloud global provider needs AI credits, and who adds them", () => {
    expect(enabling).toContain("the project needs AI credits");
    expect(enabling).toContain(
      "a project owner or someone with **Manage Billing** adds them on **Project Settings > AI > AI Credits**",
    );
    expect(enabling).not.toContain("or auto-recharge");
  });

  /*
   * Drafting a postmortem used to ride on the incident investigation flag.
   * It is its own switch now, on for new projects like investigations.
   */
  it("says the postmortem draft is its own switch, on for new projects", () => {
    expect(postmortem).toContain(
      "**Draft a postmortem when an incident resolves**",
    );
    expect(postmortem).toContain("It is **on by default for new projects**");
    expect(postmortem).toContain(
      "a project created before this default keeps its setting",
    );
    expect(postmortem).not.toMatch(/off by default/i);
  });

  it("says automatic code fixes and AI Insights are on for new projects", () => {
    const codeFixes: string = getSection(page, "## Automatic code fixes");
    const insights: string = getSection(
      page,
      "## Insights — proactive detection",
    );

    expect(codeFixes).toContain("**on by default for new projects**");
    expect(insights).toContain(
      "All three settings are **on by default for new projects**",
    );
    expect(codeFixes).not.toMatch(/off by default/i);
    expect(insights).not.toMatch(/off by default/i);
  });

  /*
   * On for new projects comes from ProjectService, not from the column: the
   * column default stays off so an upgrade switches no existing project on.
   */
  it("matches the project's postmortem column: its own flag, column default off", () => {
    const model: string = read(
      path.join(PACKAGES_ROOT, "Common/Models/DatabaseModels/Project.ts"),
    );
    const column: string = model.slice(
      model.indexOf('title: "Enable Automatic Postmortem Draft"'),
      model.indexOf("public enableAutomaticPostmortemDraft?"),
    );

    expect(column.length).toBeGreaterThan(0);
    expect(column).toContain("defaultValue: false");
    expect(column).toContain("default: false");
  });
});

describe("what the AI agent would refuse, in the docs", () => {
  /*
   * RemediationCommandToolkit.getRunnerScopeRefusal (compose, proposal),
   * the approval route and RunnerJobService (the enqueue chokepoint) read
   * the scope the agent reports, so a write outside
   * aiAgent.remediation.namespaces, in the agent's own namespace, or a node
   * operation with nodeOperations=false never reaches the agent as a failed
   * fix. Every docs copy that describes the agent's scope says so; the AI
   * agent page's short notes are held to their own rules below.
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
      ].map(fileSource),
    ];
  }

  it("says such a fix is refused when it is proposed or approved, not only in the agent", () => {
    for (const copy of getScopeCopies()) {
      expect({
        file: copy.label,
        refusedUpFront: REFUSED_UP_FRONT_PATTERN.test(copy.text),
      }).toEqual({ file: copy.label, refusedUpFront: true });
    }
  });

  it("names the agent's whole scope in the every-mode lines of the AI SRE page", () => {
    const section: string = getClusterAccessSection();

    expect(section).toContain(
      "- The AI agent never changes anything in its own namespace — a fix there could scale the Kubernetes agent, or the AI agent itself, away — nor anything outside the namespaces its chart lets it write (`aiAgent.remediation.namespaces`), nor a node when its chart turned node operations off (`aiAgent.remediation.nodeOperations=false`).",
    );
    expect(section).toContain(
      "refuses such a fix when OneUptime AI proposes it and again when someone approves it, so it never reaches the AI agent as a failed fix",
    );
    expect(section).not.toContain(
      "and the Runner refuses a write anywhere else before it spawns kubectl.",
    );
  });

  it("no longer leaves the refusal to the agent alone on the Kubernetes agent page", () => {
    expect(read(KUBERNETES_AGENT_PAGE)).not.toMatch(
      /and the (Runner|AI agent) refuses a write anywhere else\./,
    );
  });

  // Negative control: the pattern does not read agent-only wording as up front.
  it("does not read an agent-only refusal as an up-front one", () => {
    for (const agentOnly of [
      "List namespaces and the chart binds it in those alone, and the AI agent refuses a write anywhere else.",
      "the AI agent is told the list and refuses a write outside it before spawning kubectl.",
      "Node operations (cordon, uncordon, taint, drain) are off: the chart grants no node RBAC, and the AI agent refuses them before it runs kubectl.",
    ]) {
      expect({
        agentOnly,
        refusedUpFront: REFUSED_UP_FRONT_PATTERN.test(agentOnly),
      }).toEqual({ agentOnly, refusedUpFront: false });
    }
  });
});

describe("the AI agent page's scoped write-access note", () => {
  const note: string = getAiAgentScopedCommandNote();

  /*
   * The page keeps its notes short (the docs pages carry the error text and
   * the proposal-time refusal), but never drops what an operator needs to
   * run the command safely: the namespaces must exist, a fix elsewhere is
   * refused, and the reset back to cluster-wide.
   */
  it("says every listed namespace must already exist, a fix elsewhere is refused, and how to reset the list", () => {
    expect(note).toContain("must already exist");
    expect(note).toMatch(/anywhere else[^.]{0,40}refused/);
    expect(note).toContain(AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG);
  });

  it("never names the replaced aiAccess key", () => {
    expect(note).not.toMatch(/aiAccess\./);
    expect(getAiAgentClusterWideCommandNote()).not.toMatch(/aiAccess\./);
    expect(getAiAgentWriteDisclosure()).not.toMatch(/aiAccess\./);
  });

  it("says the cluster-wide command resets a stored namespace list", () => {
    expect(getAiAgentClusterWideCommandNote()).toContain(
      AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG,
    );
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
        }).toEqual({ file: relative(file), phrase, listed: true });
      }
    });

    it(`says a one-word allowlist entry is refused, in ${relative(file)}`, () => {
      expect(fileSource(file).text).toMatch(
        /more than one word after the optional leading `kubectl`/,
      );
    });
  }

  it("names parent-replacement patches wherever the policy's refusals are summed up", () => {
    for (const file of [KUBERNETES_AGENT_PAGE, CHART_NOTES, CHART_VALUES]) {
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

describe("the Kubernetes AI agent and auto-remediation rules", () => {
  /*
   * A rule's command Runners are Runner rows; the agent is not one. The
   * legacy in-cluster Runner is a Runner row, and the server refuses it
   * there too, so the Runner README says so for the installs that still
   * run it.
   */
  it("is never accepted as a rule's command Runner", () => {
    for (const file of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE, RUNNER_README]) {
      const copy: CopySource = fileSource(file);

      expect({
        file: copy.label,
        neverRuleRunner: NEVER_RULE_RUNNER_PATTERN.test(copy.text),
      }).toEqual({ file: copy.label, neverRuleRunner: true });
    }
  });
});

/*
 * The cluster's AI section has three pages since AI Insights was split:
 * AI Logs lists everything AI did (the commands included), AI Insights
 * sums up what AI learned. The Kubernetes agent page names each for what
 * it holds.
 */
describe("the Kubernetes agent page's pointers to the AI pages", () => {
  it("sends what AI did to AI Logs and what it learned to AI Insights", () => {
    const page: string = read(KUBERNETES_AGENT_PAGE);

    expect(page).toContain(
      "Everything AI did with it is on the cluster's **AI Logs** page (AI → Logs), and what AI learned there — the problems it keeps investigating, what it found, how its fixes turned out — on the **AI Insights** page (AI → Insights).",
    );
    expect(page).not.toContain(
      "What AI did with it is on the cluster's **AI Insights** page",
    );
  });
});
