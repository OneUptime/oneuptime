import fs from "fs";
import path from "path";

/*
 * What the KubernetesAiAccessDocs*.test.ts suites share: where every copy an
 * operator reads about the Kubernetes AI agent lives, how a copy is read, and
 * the helm commands every copy must print verbatim.
 *
 * The copies are the docs pages (AI SRE, the Kubernetes agent page, the
 * upgrade notes), the kubernetes-agent chart (README, NOTES.txt,
 * values.yaml, values.schema.json and the ai-agent template) and the Runner
 * README, which describes the in-cluster Runner the agent replaced. The
 * dashboard's own copy is read from Pages/Kubernetes/Utils/
 * KubernetesAiAccessSetup.ts by the suites themselves.
 */

export const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
export const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");
export const CHART_DIR: string = path.join(
  REPOSITORY_ROOT,
  "HelmChart/Public/kubernetes-agent",
);
export const DOCS_CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content/en",
);

export const AI_SRE_PAGE: string = path.join(DOCS_CONTENT_DIR, "ai/ai-sre.md");
export const KUBERNETES_AGENT_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "telemetry/kubernetes-agent.md",
);
export const UPGRADING_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "installation/upgrading.md",
);
export const CHART_README: string = path.join(CHART_DIR, "README.md");
export const CHART_NOTES: string = path.join(CHART_DIR, "templates/NOTES.txt");
export const CHART_VALUES: string = path.join(CHART_DIR, "values.yaml");
export const CHART_SCHEMA: string = path.join(CHART_DIR, "values.schema.json");
// The agent's template; it replaced templates/ai-runner.yaml.
export const CHART_TEMPLATE: string = path.join(
  CHART_DIR,
  "templates/ai-agent.yaml",
);
export const RUNNER_README: string = path.join(
  PACKAGES_ROOT,
  "Runner/README.md",
);
export const RUNNER_DOCKERFILE: string = path.join(
  PACKAGES_ROOT,
  "Runner/Dockerfile.tpl",
);
export const AI_AGENT_DIR: string = path.join(
  REPOSITORY_ROOT,
  "agents/KubernetesAIAgent",
);
export const AI_AGENT_DOCKERFILE: string = path.join(
  AI_AGENT_DIR,
  "Dockerfile.tpl",
);

// How the dashboard's copy (KubernetesAiAccessSetup.ts) is named in a failure.
export const AI_AGENT_PAGE: string = "Pages/Kubernetes/View/AI/Agent.tsx";

/*
 * The three helm upgrades every copy prints, exactly as the dashboard's
 * getAiAgentHelmCommands() returns them and the server's
 * ai_agent_not_connected next step names the first. The release name and
 * namespace are the ones the dashboard's own install instructions use
 * (DocumentationMarkdown's KUBERNETES_AGENT_HELM_RELEASE / _NAMESPACE).
 *
 * `helm repo update` comes first in every one: an install from before
 * aiAgent existed keeps a cached chart index, `helm upgrade` then resolves
 * the old chart, and its values schema refuses the flag with "Additional
 * property aiAgent is not allowed". Each is complete on its own, so an
 * operator who runs a write-access command directly is covered too.
 */
export const AI_AGENT_INSTALL_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reset-then-reuse-values \\
  --set aiAgent.enabled=true`;

/*
 * Fixes on, recommended: only in the listed namespaces, no node operations.
 * aiAgent.fixes grants the write RBAC itself, and investigation is named
 * beside it so the release never leaves it to a default.
 */
export const AI_AGENT_SCOPED_WRITE_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reset-then-reuse-values \\
  --set aiAgent.enabled=true \\
  --set aiAgent.investigation=true \\
  --set aiAgent.fixes=ask-for-approval \\
  --set "aiAgent.remediation.namespaces={web,api}" \\
  --set aiAgent.remediation.nodeOperations=false`;

/*
 * What AI may do and nothing else (the "Change what AI may do" dialog's
 * command when no write access has to be granted), at the defaults the
 * static copies use.
 */
export const AI_AGENT_APPLY_SETTINGS_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reset-then-reuse-values \\
  --set aiAgent.enabled=true \\
  --set aiAgent.investigation=true \\
  --set aiAgent.fixes=ask-for-approval`;

/*
 * Write access, cluster-wide. It resets a namespace list stored on the
 * release: a stored list is kept when the flag is left out, so without the
 * reset this command would leave the role bound only where that list says.
 */
export const AI_AGENT_CLUSTER_WIDE_WRITE_COMMAND: string = `helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent --reset-then-reuse-values \\
  --set aiAgent.enabled=true \\
  --set aiAgent.investigation=true \\
  --set aiAgent.fixes=ask-for-approval \\
  --set-json 'aiAgent.remediation.namespaces=[]'`;

/*
 * The reset of aiAgent.remediation.namespaces that works whichever way the
 * release keeps its values. `={}` is one empty name (the schema refuses it),
 * and `=null` is dropped by Helm when the release stores the key, so under
 * --reuse-values it resets nothing.
 */
export const EMPTY_LIST_RESET_FLAG: string =
  "--set-json 'aiAgent.remediation.namespaces=[]'";
export const NULL_RESET_TEXT: string = "aiAgent.remediation.namespaces=null";

// A copy an operator reads, by name, with line breaks read as one space.
export interface CopySource {
  label: string;
  text: string;
}

// Line breaks, and the `#` of a YAML comment, read as one space.
export const LINE_BREAK_PATTERN: RegExp = /\s*\n\s*#?\s*/g;
// A fenced bash block of a markdown page.
const BASH_BLOCK_PATTERN: RegExp = /```bash\n([\s\S]*?)```/g;

export function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function readFlat(filePath: string): string {
  return read(filePath).replace(LINE_BREAK_PATTERN, " ");
}

export function relative(filePath: string): string {
  return path.relative(REPOSITORY_ROOT, filePath);
}

export function fileSource(filePath: string): CopySource {
  return { label: relative(filePath), text: readFlat(filePath) };
}

// The body of every ```bash block, in page order.
export function getBashBlocks(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(BASH_BLOCK_PATTERN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!.replace(/\n$/, "");
    },
  );
}

// Every bash block that runs a `helm upgrade` touching aiAgent.* values.
export function getAiAgentUpgradeBlocks(markdown: string): Array<string> {
  return getBashBlocks(markdown).filter((block: string): boolean => {
    return (
      block.includes("helm upgrade") &&
      (block.includes("--set aiAgent.") ||
        block.includes('--set "aiAgent.') ||
        block.includes("--set-json 'aiAgent."))
    );
  });
}

/*
 * The setup commands among them: the upgrades that turn the agent on or
 * grant it write access. An opt-out (`--set aiAgent.enabled=false`) is an
 * upgrade too, but not a setup step.
 */
export function getAiAgentSetupBlocks(markdown: string): Array<string> {
  return getAiAgentUpgradeBlocks(markdown).filter((block: string): boolean => {
    return (
      !block.includes("aiAgent.enabled=false") &&
      (block.includes("aiAgent.enabled=true") ||
        block.includes("aiAgent.remediation."))
    );
  });
}

const FENCE_PATTERN: RegExp = /^\s*```/;
const HEADING_LEVEL_PATTERN: RegExp = /^(#{1,6}) /;

/*
 * From a heading line to the next heading of the same or a higher level
 * (`## X` runs to the next `## `; `### X` to the next `### ` or `## `).
 * Lines inside code fences are content, never headings: a YAML example's
 * `# values.yaml` comment does not end a section.
 */
export function getSection(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  if (start === -1) {
    throw new Error(`No heading "${heading}"`);
  }

  const level: number = heading.match(HEADING_LEVEL_PATTERN)![1]!.length;
  let inFence: boolean = false;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index]!;

    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      continue;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(HEADING_LEVEL_PATTERN);

    if (match && match[1]!.length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// Every heading of a markdown page outside code fences, as written.
export function getHeadings(markdown: string): Array<string> {
  const headings: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && HEADING_LEVEL_PATTERN.test(line)) {
      headings.push(line);
    }
  }

  return headings;
}

// The AI SRE page's cluster-access section, where the agent is explained.
export function getClusterAccessSection(): string {
  return getSection(
    read(AI_SRE_PAGE),
    "## Cluster access — let OneUptime AI run kubectl",
  );
}
