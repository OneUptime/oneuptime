import { describe, expect, test } from "@jest/globals";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  getKubernetesInstallationMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getAiAgentLogsCommand } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";

/*
 * The in-app install page is a new user's first contact with the
 * Kubernetes agent, and the chart now ships the Kubernetes AI agent on by
 * default. The page says so — what it is, that it is read-only, the pod
 * Step 4 lists, how to opt out, and where to see it (AI → Agent) — so the
 * pods the user sees match the pods the page promised.
 */

const MARKDOWN: string = getKubernetesInstallationMarkdown({
  clusterName: "prod-east",
  oneuptimeUrl: "https://oneuptime.example.com",
  apiKey: "key",
});

// The markdown between a heading and the next heading of the same level.
function section(heading: string): string {
  const start: number = MARKDOWN.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const next: number = MARKDOWN.indexOf("\n## ", start + heading.length);
  return MARKDOWN.slice(start, next === -1 ? undefined : next);
}

// Every fenced block in a piece of markdown.
function codeBlocks(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the install page's Kubernetes AI agent", () => {
  test("has a short section saying it is on by default and read-only", () => {
    const aiSection: string = section(
      "## Kubernetes AI agent (on by default, read-only)",
    );
    expect(aiSection).toContain("**Kubernetes AI agent**");
    expect(aiSection).toContain("read-only kubectl");
    expect(aiSection).toContain("can change nothing");
    // Short: a paragraph or three, not a manual.
    expect(aiSection.length).toBeLessThan(1200);
  });

  test("comes right after verifying the installation", () => {
    const verify: number = MARKDOWN.indexOf(
      "## Step 4: Verify the Installation",
    );
    const aiAgent: number = MARKDOWN.indexOf("## Kubernetes AI agent");
    const configuration: number = MARKDOWN.indexOf("## Configuration Options");
    expect(verify).toBeGreaterThan(-1);
    expect(aiAgent).toBeGreaterThan(verify);
    expect(configuration).toBeGreaterThan(aiAgent);
  });

  test("its pod is in every Step 4 listing", () => {
    const listings: Array<string> = codeBlocks(
      section("## Step 4: Verify the Installation"),
    ).filter((block: string): boolean => {
      return block.startsWith("NAME ");
    });

    expect(listings).toHaveLength(2);
    for (const listing of listings) {
      expect(listing).toContain(`${KUBERNETES_AGENT_HELM_RELEASE}-ai-agent-`);
    }
    expect(
      section("## Kubernetes AI agent (on by default, read-only)"),
    ).toContain(`\`${KUBERNETES_AGENT_HELM_RELEASE}-ai-agent\``);
  });

  test("says how to opt out", () => {
    expect(
      section("## Kubernetes AI agent (on by default, read-only)"),
    ).toContain("`--set aiAgent.enabled=false`");
  });

  test("points to AI → Agent to see it", () => {
    expect(
      section("## Kubernetes AI agent (on by default, read-only)"),
    ).toContain("**AI → Agent**");
    expect(MARKDOWN).toContain(
      '### AI → Agent shows "Offline" or "Not installed"',
    );
  });

  test("troubleshooting reads the agent's logs with the page's own command", () => {
    const troubleshooting: string = section("## Troubleshooting");
    expect(troubleshooting).toContain(getAiAgentLogsCommand());
    expect(troubleshooting).toContain(
      `kubectl get pods -n ${KUBERNETES_AGENT_HELM_NAMESPACE} -l component=ai-agent`,
    );
    expect(troubleshooting).toContain("--set aiAgent.enabled=true");
  });

  test("never names the deprecated aiAccess values", () => {
    expect(MARKDOWN).not.toContain("aiAccess");
  });
});
