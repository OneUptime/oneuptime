import { describe, expect, test } from "@jest/globals";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  KUBERNETES_PLATFORMS,
  KubernetesPlatform,
  getKubernetesSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getAiAgentLogsCommand } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";
import {
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";

/*
 * The in-app install guide is a new user's first contact with the
 * Kubernetes agent, and the chart ships the Kubernetes AI agent on by
 * default. Whatever platform the reader picks, the guide says so — what it
 * is, that it is read-only, the pod the verify step lists, how to opt out,
 * and where to see it (AI → Agent) — so the pods the user sees match the
 * pods the guide promised.
 */

const PLATFORMS: Array<KubernetesPlatform> = KUBERNETES_PLATFORMS.map(
  (option: SetupGuideOption<KubernetesPlatform>): KubernetesPlatform => {
    return option.key;
  },
);

const guideFor: (platform: KubernetesPlatform) => SetupGuideContent = (
  platform: KubernetesPlatform,
): SetupGuideContent => {
  return getKubernetesSetupGuide({
    clusterName: "prod-east",
    oneuptimeUrl: "https://oneuptime.example.com",
    apiKey: "key",
    platform: platform,
  });
};

const verifyStep: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  const step: SetupGuideStep | undefined = guide.steps.find(
    (candidate: SetupGuideStep): boolean => {
      return candidate.title === "Verify the installation";
    },
  );
  expect(step).toBeDefined();
  return step!.markdown || "";
};

const aiAgentNote: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  const verify: string = verifyStep(guide);
  const start: number = verify.indexOf("**Kubernetes AI agent");
  expect(start).toBeGreaterThan(-1);
  return verify.slice(start);
};

describe.each(PLATFORMS)(
  "the %s guide's Kubernetes AI agent",
  (platform: KubernetesPlatform) => {
    const guide: SetupGuideContent = guideFor(platform);

    test("has a short note saying it is on by default and read-only", () => {
      const note: string = aiAgentNote(guide);
      expect(note).toContain(
        "**Kubernetes AI agent (on by default, read-only).**",
      );
      expect(note).toContain("read-only kubectl");
      expect(note).toContain("can change nothing");
      // Short: a paragraph, not a manual.
      expect(note.length).toBeLessThan(800);
    });

    test("comes right after the pods the reader is checking", () => {
      const verify: string = verifyStep(guide);
      expect(verify.indexOf("```output")).toBeGreaterThan(-1);
      expect(verify.indexOf("**Kubernetes AI agent")).toBeGreaterThan(
        verify.indexOf("```output"),
      );
    });

    test("its pod is in the verify listing, and named in the note", () => {
      const listing: RegExpMatchArray | null = verifyStep(guide).match(
        /```output\n([\s\S]*?)```/,
      );
      expect(listing).not.toBeNull();
      expect(listing![1]).toContain(
        `${KUBERNETES_AGENT_HELM_RELEASE}-ai-agent-`,
      );
      expect(aiAgentNote(guide)).toContain(
        `\`${KUBERNETES_AGENT_HELM_RELEASE}-ai-agent\``,
      );
    });

    test("says how to opt out", () => {
      expect(aiAgentNote(guide)).toContain("`--set aiAgent.enabled=false`");
    });

    test("points to AI → Agent to see it", () => {
      expect(aiAgentNote(guide)).toContain("**AI → Agent**");
    });

    test("troubleshooting reads the agent's logs with the page's own command", () => {
      const topic: SetupGuideTopic | undefined = guide.troubleshooting?.find(
        (candidate: SetupGuideTopic): boolean => {
          return (
            candidate.title === 'AI → Agent shows "Offline" or "Not installed"'
          );
        },
      );
      expect(topic).toBeDefined();
      expect(topic!.markdown).toContain(getAiAgentLogsCommand());
      expect(topic!.markdown).toContain(
        `kubectl get pods -n ${KUBERNETES_AGENT_HELM_NAMESPACE} -l component=ai-agent`,
      );
      expect(topic!.markdown).toContain("--set aiAgent.enabled=true");
    });

    test("never names the deprecated aiAccess values", () => {
      expect(getSetupGuideMarkdown(guide)).not.toContain("aiAccess");
    });
  },
);
