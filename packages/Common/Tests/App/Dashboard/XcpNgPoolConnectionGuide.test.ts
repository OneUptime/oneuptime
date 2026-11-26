import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ResourceConnectionGuide,
  ResourceConnectionGuideStep,
  getXcpNgPoolConnectionGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import { XCP_NG_AGENT_CONTAINER } from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/Utils/DocumentationMarkdown";

/*
 * The card under an XCP-ng pool's hero, while the pool is not connected.
 * A pool is not named on its agent: one XCP-ng Agent beside a Xen
 * Orchestra reports every pool that Xen Orchestra manages, each by its UUID
 * (xcp_ng.pool.id), so the card's setup is Xen Orchestra's - its
 * OpenMetrics plugin, then the agent - and its checks name the pool by its
 * UUID. Xen Orchestra stops reporting a pool it lost while it keeps
 * reporting the others, so while the agent runs the card says it is Xen
 * Orchestra's connection to the pool to look at, not the agent.
 *
 * Every command and setting the card shows is checked against the agent's
 * own files (agents/XcpNgAgent): its container, the .env values its
 * collector reads, the script that diagnoses it.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(REPOSITORY_ROOT, "agents", "XcpNgAgent");

const POOL_UUID: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const ONEUPTIME_URL: string = "https://oneuptime.example.com";

const guide: ResourceConnectionGuide = getXcpNgPoolConnectionGuide(
  POOL_UUID,
  ONEUPTIME_URL,
);

function titles(steps: Array<ResourceConnectionGuideStep>): Array<string> {
  return steps.map((step: ResourceConnectionGuideStep): string => {
    return step.title;
  });
}

function stepTitled(
  steps: Array<ResourceConnectionGuideStep>,
  title: string,
): ResourceConnectionGuideStep {
  const step: ResourceConnectionGuideStep | undefined = steps.find(
    (candidate: ResourceConnectionGuideStep): boolean => {
      return candidate.title === title;
    },
  );
  if (!step) {
    throw new Error(`No step "${title}": ${titles(steps).join(", ")}`);
  }
  return step;
}

describe("what the card says about a pool", () => {
  test("it names the agent by its product name", () => {
    expect(guide.agentName).toBe("OneUptime XCP-ng Agent");
  });

  test("its sentences are whole sentences about this pool, with the agent as {{agentName}}", () => {
    expect(guide.setupCopy.title).toBe("Connect this pool");
    expect(guide.setupCopy.description).toContain("{{agentName}}");
    expect(guide.setupCopy.description).toContain("Xen Orchestra");
    expect(guide.stoppedCopy.title).toBe("This pool stopped sending data");
    expect(guide.stoppedCopy.description).toContain("{{lastHeard}}");
    expect(guide.stoppedCopy.description).toContain("{{agentName}}");
    // A whole sentence for the kind, never a noun put into a shared one.
    expect(guide.setupCopy.title).not.toContain("{{");
    expect(guide.stoppedCopy.title).not.toContain("{{");
  });
});

describe("connecting a pool for the first time", () => {
  test("pick a key, turn on Xen Orchestra's plugin, install the agent, wait for the pool", () => {
    expect(titles(guide.setupSteps)).toEqual([
      "Pick an ingestion key",
      "Turn on Xen Orchestra's OpenMetrics plugin",
      "Install the agent",
      "Wait for the first data",
    ]);
  });

  test("the plugin step says where it is and which Xen Orchestra has it", () => {
    const step: ResourceConnectionGuideStep = stepTitled(
      guide.setupSteps,
      "Turn on Xen Orchestra's OpenMetrics plugin",
    );
    expect(step.description).toContain("Settings → Plugins");
    expect(step.description).toContain("openmetrics");
    expect(step.description).toContain("6.9");
    expect(step.code).toBeUndefined();
  });

  test("a hand-written .env names exactly what the agent's collector reads", () => {
    const step: ResourceConnectionGuideStep = stepTitled(
      guide.setupSteps,
      "Install the agent",
    );
    expect(step.code).toBe(
      "XO_ADDRESS=xo.example.com\nXO_OPENMETRICS_SECRET='<plugin secret>'",
    );

    // The compose file hands both to the collector, which reads them.
    const compose: string = fs.readFileSync(
      path.join(AGENT_DIR, "docker-compose.yml"),
      "utf8",
    );
    const config: string = fs.readFileSync(
      path.join(AGENT_DIR, "otel-collector-config.yaml"),
      "utf8",
    );
    for (const variable of ["XO_ADDRESS", "XO_OPENMETRICS_SECRET"]) {
      expect(compose).toContain(`${variable}=\${${variable}}`);
      expect(config).toContain(`\${env:${variable}}`);
    }
    // XO_URL is install.sh's question, never the collector's setting.
    expect(step.code).not.toContain("XO_URL");
  });

  test("the install step asks for Xen Orchestra's address and the secret, never a pool name", () => {
    const step: ResourceConnectionGuideStep = stepTitled(
      guide.setupSteps,
      "Install the agent",
    );
    expect(step.description).toContain("Xen Orchestra's address");
    expect(step.description).toContain("secret");
    expect(step.description).not.toContain("{{name}}");
    expect(step.description).not.toContain("pool name");
  });

  test("the wait step checks the agent's own container", () => {
    const step: ResourceConnectionGuideStep = stepTitled(
      guide.setupSteps,
      "Wait for the first data",
    );
    expect(step.code).toBe(`docker ps --filter name=${XCP_NG_AGENT_CONTAINER}`);
    expect(step.description).toContain("Connected");
  });

  test("the container the card names is the one the agent's compose file runs", () => {
    const compose: string = fs.readFileSync(
      path.join(AGENT_DIR, "docker-compose.yml"),
      "utf8",
    );
    expect(XCP_NG_AGENT_CONTAINER).toBe("oneuptime-xcp-ng-agent");
    expect(compose).toContain(`container_name: ${XCP_NG_AGENT_CONTAINER}`);
  });
});

describe("a pool that stopped sending data", () => {
  test("check the agent, run its diagnostic script, then check the pool in Xen Orchestra", () => {
    expect(titles(guide.troubleshootingSteps)).toEqual([
      "Check the agent is running",
      "Run the diagnostic script",
      "Check the pool in Xen Orchestra",
    ]);
  });

  test("the agent check names its container and how to start it again", () => {
    const step: ResourceConnectionGuideStep = stepTitled(
      guide.troubleshootingSteps,
      "Check the agent is running",
    );
    expect(step.code).toBe(`docker ps --filter name=${XCP_NG_AGENT_CONTAINER}`);
    expect(step.description).toContain(XCP_NG_AGENT_CONTAINER);
    expect(step.description).toContain("docker compose up -d");
  });

  test("the diagnostic script is the agent's own, served by this OneUptime", () => {
    const step: ResourceConnectionGuideStep = stepTitled(
      guide.troubleshootingSteps,
      "Run the diagnostic script",
    );
    expect(step.code).toBe(
      `curl -fsSL ${ONEUPTIME_URL}/install/xcp-ng-agent/troubleshoot.sh -o troubleshoot.sh && bash troubleshoot.sh`,
    );
    expect(fs.existsSync(path.join(AGENT_DIR, "troubleshoot.sh"))).toBe(true);
  });

  test("the Xen Orchestra check names the pool by its UUID, the way Xen Orchestra knows it", () => {
    const step: ResourceConnectionGuideStep = stepTitled(
      guide.troubleshootingSteps,
      "Check the pool in Xen Orchestra",
    );
    expect(step.code).toBe(POOL_UUID);
    expect(step.description).toContain("Settings → Servers");
  });
});

describe("the agent runs, but Xen Orchestra does not report the pool", () => {
  test("the card says it is Xen Orchestra's connection to the pool, not the agent", () => {
    expect(guide.unreadableCopy).toBeDefined();
    expect(guide.unreadableCopy!.stopped.title).toBe(
      "Xen Orchestra no longer reports this pool",
    );
    expect(guide.unreadableCopy!.stopped.description).toContain("{{lastRead}}");
    expect(guide.unreadableCopy!.stopped.description).toContain(
      "{{agentName}}",
    );
    expect(guide.unreadableCopy!.notYet.title).toBe(
      "Xen Orchestra has not reported this pool yet",
    );
    expect(guide.unreadableCopy!.notYet.description).toContain("{{agentName}}");
  });

  test("its checks are the diagnostic script and the pool in Xen Orchestra, not the container", () => {
    expect(titles(guide.unreadableCopy!.steps)).toEqual([
      "Run the diagnostic script",
      "Check the pool in Xen Orchestra",
    ]);
  });
});

describe("one pool's card is about that pool", () => {
  test("another pool's card names its own UUID", () => {
    const other: ResourceConnectionGuide = getXcpNgPoolConnectionGuide(
      "0f0e0d0c-0b0a-4909-8807-060504030201",
      ONEUPTIME_URL,
    );
    expect(
      stepTitled(other.troubleshootingSteps, "Check the pool in Xen Orchestra")
        .code,
    ).toBe("0f0e0d0c-0b0a-4909-8807-060504030201");
    // The setup itself is the Xen Orchestra's, the same for every pool.
    expect(other.setupSteps).toEqual(guide.setupSteps);
  });

  test("a OneUptime with an address that needs quoting gets a working command", () => {
    const quoted: ResourceConnectionGuide = getXcpNgPoolConnectionGuide(
      POOL_UUID,
      "<YOUR_ONEUPTIME_URL>",
    );
    expect(
      stepTitled(quoted.troubleshootingSteps, "Run the diagnostic script").code,
    ).toBe(
      "curl -fsSL '<YOUR_ONEUPTIME_URL>/install/xcp-ng-agent/troubleshoot.sh' -o troubleshoot.sh && bash troubleshoot.sh",
    );
  });
});
