import {
  AI_AGENT_DOCKERFILE,
  AI_SRE_PAGE,
  CHART_README,
  KUBERNETES_AGENT_PAGE,
  RUNNER_DOCKERFILE,
  read,
  relative,
} from "./KubernetesAiAgentDocsSupport";
import { describe, expect, it } from "@jest/globals";

/*
 * The docs name the kubectl version the Kubernetes AI agent ships (so an
 * operator can check it against the cluster's version-skew policy). It is
 * pinned in the agent's Dockerfile together with its checksums, and the
 * legacy Runner image, which clusters on an older chart still run, pins the
 * same binary: the two images must never disagree about which kubectl the
 * policy was checked against. A bump in one Dockerfile must bump the other
 * and the docs, or the docs promise a kubectl the agent does not have.
 */

const PAGES_NAMING_THE_PIN: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
];

// What a Dockerfile pins: the version and the sha256 of each architecture.
interface KubectlPin {
  version: string;
  sha256Amd64: string;
  sha256Arm64: string;
}

function getArg(dockerfile: string, name: string, pattern: string): string {
  const match: RegExpMatchArray | null = read(dockerfile).match(
    new RegExp(`^ARG ${name}=(${pattern})$`, "m"),
  );

  if (!match) {
    throw new Error(`${relative(dockerfile)} pins no ${name}`);
  }

  return match[1]!;
}

function getKubectlPin(dockerfile: string): KubectlPin {
  return {
    version: getArg(dockerfile, "KUBECTL_VERSION", "v\\d+\\.\\d+\\.\\d+"),
    sha256Amd64: getArg(dockerfile, "KUBECTL_SHA256_AMD64", "[0-9a-f]{64}"),
    sha256Arm64: getArg(dockerfile, "KUBECTL_SHA256_ARM64", "[0-9a-f]{64}"),
  };
}

// Every "pinned kubectl (vX.Y.Z)" a page names.
function getNamedVersions(page: string): Array<string> {
  return Array.from(
    read(page).matchAll(/pinned kubectl \((v\d+\.\d+\.\d+)\)/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
}

describe("the kubectl the Kubernetes AI agent and the Runner pin", () => {
  it("is the same version and the same binaries in both images", () => {
    expect(getKubectlPin(AI_AGENT_DOCKERFILE)).toEqual(
      getKubectlPin(RUNNER_DOCKERFILE),
    );
  });

  it("verifies each download against its pinned checksum in the agent's image", () => {
    const dockerfile: string = read(AI_AGENT_DOCKERFILE);

    // The official download of the pinned version, then a checksum check.
    expect(dockerfile).toMatch(
      /https:\/\/dl\.k8s\.io\/release\/\$\{?KUBECTL_VERSION\}?\//,
    );
    expect(dockerfile).toMatch(/sha256sum -c/);
  });
});

/*
 * Read from the Runner's Dockerfile, which the test above holds equal to the
 * agent's, so a missing or unpinned agent Dockerfile fails that test alone
 * rather than every docs page's.
 */
describe("the kubectl version the docs name", () => {
  const pinned: string = getKubectlPin(RUNNER_DOCKERFILE).version;

  for (const page of PAGES_NAMING_THE_PIN) {
    it(`is the one the images pin, in ${relative(page)}`, () => {
      const named: Array<string> = getNamedVersions(page);

      expect(named.length).toBeGreaterThan(0);
      expect(Array.from(new Set(named))).toEqual([pinned]);
    });
  }

  it("names the agent, not the Runner, as the image that ships it on the AI SRE page", () => {
    expect(read(AI_SRE_PAGE)).toContain(
      `The AI agent ships its own pinned kubectl (${pinned})`,
    );
    expect(read(AI_SRE_PAGE)).not.toContain(
      "The Runner ships its own pinned kubectl",
    );
  });
});
