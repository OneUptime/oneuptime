import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ResourceConnectionGuide,
  ResourceConnectionGuideStep,
  encodeResourceAttributeValue,
  formatEnvFileLine,
  getCephClusterConnectionGuide,
  getCloudResourceConnectionGuide,
  getDockerHostConnectionGuide,
  getDockerSwarmClusterConnectionGuide,
  getHostConnectionGuide,
  getIoTFleetConnectionGuide,
  getKubernetesClusterConnectionGuide,
  getPodmanHostConnectionGuide,
  getProxmoxClusterConnectionGuide,
  getRumApplicationConnectionGuide,
  getServerlessFunctionConnectionGuide,
  getStorageArrayConnectionGuide,
  getVMwareVCenterConnectionGuide,
  quoteForShell,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import {
  SetupGuideContent,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  getKubernetesSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getDockerSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import { getPodmanSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import { getDockerSwarmSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import { getProxmoxSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import { getCephSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import { getVMwareSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import {
  DEFAULT_STORAGE_ARRAY_PLATFORM,
  getStorageArraySetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import {
  getHostCollectorConfig,
  getHostSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import { getIoTSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationMarkdown";
import { getRumSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import { getServerlessSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Components/Serverless/ServerlessSetupGuide";

/*
 * The steps the "how do I connect this?" card shows on each resource's
 * overview (ResourceConnectionGuideCard).
 *
 * Two things matter most and are pinned here:
 *
 * - The name. Ingest adopts a resource someone created by hand only when
 *   the agent reports the same name (clusterName, DOCKER_HOST_NAME,
 *   iot.fleet.name, ...). The setup steps must spell out this resource's
 *   own value, quoted so it survives the shell or .env file it is pasted
 *   into - a mismatch registers a second resource and leaves this one
 *   "Disconnected" forever.
 * - Agreement with the full guide. Every command and setting the card
 *   names must be one the resource's Documentation tab (and the agent it
 *   installs) actually uses, so the short version never contradicts the
 *   long one. The tab is a SetupGuideCard over the resource's
 *   SetupGuideContent, read here as one document with getSetupGuideMarkdown,
 *   filled in for the same resource where the guide takes its name.
 */

const VARS: { oneuptimeUrl: string; apiKey: string } = {
  oneuptimeUrl: "https://oneuptime.example.com",
  apiKey: "key-123",
};

const AGENTS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "agents",
);

function readAgentFile(agent: string, file: string): string {
  return fs.readFileSync(path.join(AGENTS_DIRECTORY, agent, file), "utf8");
}

// A Documentation tab's whole guide, in the order it reads on screen.
function fullGuide(content: SetupGuideContent): string {
  return getSetupGuideMarkdown(content);
}

function allText(guide: ResourceConnectionGuide): string {
  return JSON.stringify(guide);
}

function codesOf(steps: Array<ResourceConnectionGuideStep>): Array<string> {
  return steps
    .map((step: ResourceConnectionGuideStep): string | undefined => {
      return step.code;
    })
    .filter((code: string | undefined): code is string => {
      return Boolean(code);
    });
}

function stepText(step: ResourceConnectionGuideStep): string {
  return `${step.title} ${step.description} ${step.code || ""}`;
}

/*
 * The values a shell or a Compose .env file reads out of a snippet: each
 * double-quoted word with its backslash escapes undone, and each
 * single-quoted one taken literally.
 */
function quotedValuesIn(code: string): Array<string> {
  const values: Array<string> = [];

  for (const match of code.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
    values.push(
      match[1] !== undefined
        ? match[1].replace(/\\(.)/g, "$1")
        : (match[2] as string),
    );
  }

  return values;
}

interface GuideCase {
  build: (identifier: string) => ResourceConnectionGuide;
  resourceNoun: string;
  agentName: string;
}

/*
 * Every per-resource guide, built from one identifier. Cloud is keyed by
 * its cloud attributes rather than a single name; the identifier stands in
 * for its account id here so the shared checks still apply.
 */
const GUIDES: Array<[string, GuideCase]> = [
  [
    "Kubernetes cluster",
    {
      build: getKubernetesClusterConnectionGuide,
      resourceNoun: "cluster",
      agentName: "OneUptime Kubernetes Agent",
    },
  ],
  [
    "Docker host",
    {
      build: getDockerHostConnectionGuide,
      resourceNoun: "Docker host",
      agentName: "OneUptime Docker Agent",
    },
  ],
  [
    "Podman host",
    {
      build: getPodmanHostConnectionGuide,
      resourceNoun: "Podman host",
      agentName: "OneUptime Podman Agent",
    },
  ],
  [
    "Docker Swarm cluster",
    {
      build: getDockerSwarmClusterConnectionGuide,
      resourceNoun: "cluster",
      agentName: "OneUptime Docker Swarm Agent",
    },
  ],
  [
    "Proxmox cluster",
    {
      build: getProxmoxClusterConnectionGuide,
      resourceNoun: "cluster",
      agentName: "OneUptime Proxmox Agent",
    },
  ],
  [
    "Ceph cluster",
    {
      build: getCephClusterConnectionGuide,
      resourceNoun: "cluster",
      agentName: "OneUptime Ceph Agent",
    },
  ],
  [
    "VMware vCenter",
    {
      build: getVMwareVCenterConnectionGuide,
      resourceNoun: "vCenter",
      agentName: "OneUptime VMware Agent",
    },
  ],
  [
    "Storage array",
    {
      build: getStorageArrayConnectionGuide,
      resourceNoun: "storage array",
      agentName: "OneUptime Storage Array Agent",
    },
  ],
  [
    "Host",
    {
      build: getHostConnectionGuide,
      resourceNoun: "host",
      agentName: "OpenTelemetry Collector",
    },
  ],
  [
    "IoT fleet",
    {
      build: getIoTFleetConnectionGuide,
      resourceNoun: "fleet",
      agentName: "OpenTelemetry exporter on your devices or gateway",
    },
  ],
  [
    "Cloud environment",
    {
      build: (identifier: string): ResourceConnectionGuide => {
        return getCloudResourceConnectionGuide({
          cloudPlatform: "aws_ecs",
          cloudAccountId: identifier,
          cloudRegion: "us-east-1",
        });
      },
      resourceNoun: "environment",
      agentName: "OpenTelemetry SDK or collector",
    },
  ],
  [
    "RUM application",
    {
      build: getRumApplicationConnectionGuide,
      resourceNoun: "application",
      agentName: "OpenTelemetry browser or mobile SDK",
    },
  ],
  [
    "Serverless function",
    {
      build: getServerlessFunctionConnectionGuide,
      resourceNoun: "function",
      agentName: "OpenTelemetry SDK",
    },
  ],
  [
    "Azure Functions function",
    {
      build: (identifier: string): ResourceConnectionGuide => {
        return getServerlessFunctionConnectionGuide(
          identifier,
          "azure_functions",
        );
      },
      resourceNoun: "function",
      agentName: "OpenTelemetry SDK",
    },
  ],
];

describe("quoteForShell", () => {
  test("wraps a plain value in double quotes", () => {
    expect(quoteForShell("prod-us-east-1")).toBe('"prod-us-east-1"');
  });

  test("keeps spaces inside the one shell word", () => {
    expect(quoteForShell("my cluster")).toBe('"my cluster"');
  });

  test("escapes what the shell still interprets inside double quotes", () => {
    expect(quoteForShell('a"b')).toBe('"a\\"b"');
    expect(quoteForShell("a$HOME")).toBe('"a\\$HOME"');
    expect(quoteForShell("a`id`")).toBe('"a\\`id\\`"');
    expect(quoteForShell("a\\b")).toBe('"a\\\\b"');
  });

  test("an empty value is still a (empty) quoted word", () => {
    expect(quoteForShell("")).toBe('""');
  });
});

describe("formatEnvFileLine", () => {
  test("a plain value is written as the setup guides write it, unquoted", () => {
    expect(formatEnvFileLine("PROXMOX_CLUSTER_NAME", "pve-prod")).toBe(
      "PROXMOX_CLUSTER_NAME=pve-prod",
    );
    expect(formatEnvFileLine("X", "a.b_c-d/e:f@g")).toBe("X=a.b_c-d/e:f@g");
  });

  test("a value with spaces or $ is single-quoted, which Compose reads literally", () => {
    expect(formatEnvFileLine("CEPH_CLUSTER_NAME", "Ceph Prod")).toBe(
      "CEPH_CLUSTER_NAME='Ceph Prod'",
    );
    expect(formatEnvFileLine("VMWARE_VCENTER_NAME", "vc$1")).toBe(
      "VMWARE_VCENTER_NAME='vc$1'",
    );
    expect(formatEnvFileLine("X", "a#b")).toBe("X='a#b'");
  });

  test("a value with a single quote falls back to escaped double quotes", () => {
    expect(formatEnvFileLine("X", "bob's swarm")).toBe('X="bob\'s swarm"');
    expect(formatEnvFileLine("X", `it's "big"`)).toBe('X="it\'s \\"big\\""');
  });
});

describe("encodeResourceAttributeValue", () => {
  test("leaves ordinary names alone, including the / of iot/<fleet>", () => {
    expect(encodeResourceAttributeValue("building-a_sensors.v2")).toBe(
      "building-a_sensors.v2",
    );
    expect(encodeResourceAttributeValue("iot/fleet")).toBe("iot/fleet");
  });

  test("percent-encodes the characters that would split OTEL_RESOURCE_ATTRIBUTES", () => {
    expect(encodeResourceAttributeValue("a,b")).toBe("a%2Cb");
    expect(encodeResourceAttributeValue("a=b")).toBe("a%3Db");
    expect(encodeResourceAttributeValue("a b")).toBe("a%20b");
    expect(encodeResourceAttributeValue("100%")).toBe("100%25");
  });

  test("encodes non-ASCII characters as UTF-8, which the SDKs decode", () => {
    expect(encodeResourceAttributeValue("café")).toBe("caf%C3%A9");
    expect(decodeURIComponent(encodeResourceAttributeValue("Zürich ☁"))).toBe(
      "Zürich ☁",
    );
  });
});

describe.each(GUIDES)("the %s guide", (_name: string, guideCase: GuideCase) => {
  const IDENTIFIER: string = "prod-east-7";
  const guide: ResourceConnectionGuide = guideCase.build(IDENTIFIER);

  test("names the resource and what sends its data", () => {
    expect(guide.resourceNoun).toBe(guideCase.resourceNoun);
    expect(guide.agentName).toBe(guideCase.agentName);
  });

  test("has three setup steps and three troubleshooting steps", () => {
    expect(guide.setupSteps).toHaveLength(3);
    expect(guide.troubleshootingSteps).toHaveLength(3);
  });

  test("every step has a title and a description, and no two steps in a list share a title", () => {
    for (const steps of [guide.setupSteps, guide.troubleshootingSteps]) {
      for (const step of steps) {
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(step.description.trim().length).toBeGreaterThan(0);
      }

      expect(
        new Set(
          steps.map((step: ResourceConnectionGuideStep): string => {
            return step.title;
          }),
        ).size,
      ).toBe(steps.length);
    }
  });

  test("the setup steps name this resource's own identifier", () => {
    expect(guide.setupSteps.map(stepText).join(" ")).toContain(IDENTIFIER);
  });

  test("the troubleshooting steps name it too, so a renamed agent is caught", () => {
    expect(guide.troubleshootingSteps.map(stepText).join(" ")).toContain(
      IDENTIFIER,
    );
  });

  test("every command or setting is one line, ready to paste", () => {
    for (const code of [
      ...codesOf(guide.setupSteps),
      ...codesOf(guide.troubleshootingSteps),
    ]) {
      expect(code).not.toMatch(/\n/);
      expect(code.trim()).toBe(code);
    }
  });

  test("nothing reads 'undefined' or 'null'", () => {
    expect(allText(guide)).not.toMatch(/undefined|null/);
  });

  test("points at the setup guide for the rest", () => {
    expect(allText(guide)).toMatch(/setup guide/);
  });

  test("an awkward name (spaces, quotes, commas) survives as one value in every snippet", () => {
    const awkwardName: string = 'Prod "East", Zone 1';
    const encoded: string = encodeResourceAttributeValue(awkwardName);
    const awkward: ResourceConnectionGuide = guideCase.build(awkwardName);

    for (const code of codesOf(awkward.setupSteps)) {
      if (!code.includes("Prod")) {
        continue; // e.g. the Host guide's `hostname`
      }

      // Either percent-encoded in place, or one quoted value that reads back whole.
      expect({
        code,
        survives:
          code.includes(encoded) || quotedValuesIn(code).includes(awkwardName),
      }).toEqual({ code, survives: true });
    }
  });
});

describe("Kubernetes cluster guide", () => {
  const guide: ResourceConnectionGuide =
    getKubernetesClusterConnectionGuide("prod-us-east-1");

  test("the clusterName setting is exactly the one the install command uses", () => {
    const setting: string = guide.setupSteps[1]!.code!;

    expect(setting).toBe('--set clusterName="prod-us-east-1"');
    expect(
      fullGuide(
        getKubernetesSetupGuide({
          ...VARS,
          platform: "standard",
          clusterName: "prod-us-east-1",
        }),
      ),
    ).toContain(setting);
  });

  test("the pod check is the one the install guide's Verify step uses", () => {
    const podsCommand: string = `kubectl get pods -n ${KUBERNETES_AGENT_HELM_NAMESPACE}`;

    expect(guide.setupSteps[2]!.code).toBe(podsCommand);
    expect(guide.troubleshootingSteps[0]!.code).toBe(podsCommand);
    expect(
      fullGuide(
        getKubernetesSetupGuide({
          ...VARS,
          platform: "standard",
          clusterName: "c",
        }),
      ),
    ).toContain(podsCommand);
  });

  test("the logs command targets the chart's metrics collector Deployment", () => {
    /*
     * The chart names its collector Deployment after the release when the
     * release name contains the chart name ("kubernetes-agent"), which the
     * documented release does.
     */
    expect(KUBERNETES_AGENT_HELM_RELEASE).toContain("kubernetes-agent");
    expect(guide.troubleshootingSteps[1]!.code).toBe(
      `kubectl logs -n ${KUBERNETES_AGENT_HELM_NAMESPACE} deploy/${KUBERNETES_AGENT_HELM_RELEASE} --tail=50`,
    );
  });

  test("a name with a space is quoted for the shell", () => {
    expect(
      getKubernetesClusterConnectionGuide("my cluster").setupSteps[1]!.code,
    ).toBe('--set clusterName="my cluster"');
  });
});

interface ContainerHostCase {
  build: (identifier: string) => ResourceConnectionGuide;
  // The host's guide with the run command picked, which the card names.
  setupGuide: (hostName: string) => SetupGuideContent;
  agentDirectory: string;
  cli: string;
  containerName: string;
  variable: string;
}

describe.each([
  [
    "Docker",
    {
      build: getDockerHostConnectionGuide,
      setupGuide: (hostName: string): SetupGuideContent => {
        return getDockerSetupGuide({
          ...VARS,
          method: "docker-cli",
          hostName: hostName,
        });
      },
      agentDirectory: "DockerAgent",
      cli: "docker",
      containerName: "oneuptime-docker-agent",
      variable: "DOCKER_HOST_NAME",
    },
  ],
  [
    "Podman",
    {
      build: getPodmanHostConnectionGuide,
      setupGuide: (hostName: string): SetupGuideContent => {
        return getPodmanSetupGuide({
          ...VARS,
          method: "podman-cli",
          hostName: hostName,
        });
      },
      agentDirectory: "PodmanAgent",
      cli: "podman",
      containerName: "oneuptime-podman-agent",
      variable: "PODMAN_HOST_NAME",
    },
  ],
] as Array<[string, ContainerHostCase]>)(
  "%s host guide",
  (_name: string, hostCase: ContainerHostCase) => {
    const guide: ResourceConnectionGuide = hostCase.build("web-01");
    const markdown: string = fullGuide(hostCase.setupGuide("web-01"));

    test("tells the agent this host's name through the variable the run command sets", () => {
      expect(guide.setupSteps[1]!.code).toBe(
        `-e ${hostCase.variable}="web-01"`,
      );
      // The run command on this host's Documentation tab, word for word.
      expect(markdown).toContain(guide.setupSteps[1]!.code!);
      expect(
        readAgentFile(hostCase.agentDirectory, "docker-compose.yml"),
      ).toContain(hostCase.variable);
    });

    test("checks and reads the container the setup guide starts", () => {
      const psCommand: string = `${hostCase.cli} ps --filter name=${hostCase.containerName}`;

      expect(guide.setupSteps[2]!.code).toBe(psCommand);
      expect(guide.troubleshootingSteps[0]!.code).toBe(psCommand);
      expect(guide.troubleshootingSteps[1]!.code).toBe(
        `${hostCase.cli} logs ${hostCase.containerName} --tail 50`,
      );
      expect(markdown).toContain(psCommand);
      expect(markdown).toContain(`--name ${hostCase.containerName}`);
      expect(
        readAgentFile(hostCase.agentDirectory, "docker-compose.yml"),
      ).toContain(`container_name: ${hostCase.containerName}`);
    });
  },
);

// The two installs the card's "Install the agent" step offers.
type ComposeInstallMethod = "install-script" | "docker-compose";

const COMPOSE_INSTALL_METHODS: Array<ComposeInstallMethod> = [
  "install-script",
  "docker-compose",
];

interface ComposeCase {
  build: (identifier: string) => ResourceConnectionGuide;
  // The resource's guide with one install method picked.
  setupGuide: (method: ComposeInstallMethod, name: string) => SetupGuideContent;
  agentDirectory: string;
  containerName: string;
  variable: string;
}

describe.each([
  [
    "Docker Swarm",
    {
      build: getDockerSwarmClusterConnectionGuide,
      setupGuide: (
        method: ComposeInstallMethod,
        name: string,
      ): SetupGuideContent => {
        return getDockerSwarmSetupGuide({
          ...VARS,
          method: method,
          clusterName: name,
        });
      },
      agentDirectory: "DockerSwarmAgent",
      containerName: "oneuptime-docker-swarm-agent",
      variable: "DOCKER_SWARM_CLUSTER_NAME",
    },
  ],
  [
    "Proxmox",
    {
      build: getProxmoxClusterConnectionGuide,
      setupGuide: (
        method: ComposeInstallMethod,
        name: string,
      ): SetupGuideContent => {
        return getProxmoxSetupGuide({
          ...VARS,
          hasApiKey: true,
          method: method,
          clusterName: name,
        });
      },
      agentDirectory: "ProxmoxAgent",
      containerName: "oneuptime-proxmox-agent",
      variable: "PROXMOX_CLUSTER_NAME",
    },
  ],
  [
    "Ceph",
    {
      build: getCephClusterConnectionGuide,
      setupGuide: (
        method: ComposeInstallMethod,
        name: string,
      ): SetupGuideContent => {
        return getCephSetupGuide({
          ...VARS,
          hasApiKey: true,
          method: method,
          clusterName: name,
        });
      },
      agentDirectory: "CephAgent",
      containerName: "oneuptime-ceph-agent",
      variable: "CEPH_CLUSTER_NAME",
    },
  ],
  [
    "VMware",
    {
      build: getVMwareVCenterConnectionGuide,
      setupGuide: (
        method: ComposeInstallMethod,
        name: string,
      ): SetupGuideContent => {
        return getVMwareSetupGuide({
          ...VARS,
          hasApiKey: true,
          method: method,
          vcenterName: name,
        });
      },
      agentDirectory: "VMwareAgent",
      containerName: "oneuptime-vmware-agent",
      variable: "VMWARE_VCENTER_NAME",
    },
  ],
  [
    "Storage Array",
    {
      build: getStorageArrayConnectionGuide,
      /*
       * One guide covers the install script and Docker Compose for the
       * picked platform, so both methods read the same document.
       */
      setupGuide: (
        _method: ComposeInstallMethod,
        name: string,
      ): SetupGuideContent => {
        return getStorageArraySetupGuide({
          ...VARS,
          hasApiKey: true,
          platform: DEFAULT_STORAGE_ARRAY_PLATFORM,
          arrayName: name,
        });
      },
      agentDirectory: "StorageArrayAgent",
      containerName: "oneuptime-storage-array-agent",
      variable: "STORAGE_ARRAY_NAME",
    },
  ],
] as Array<[string, ComposeCase]>)(
  "%s guide",
  (_name: string, composeCase: ComposeCase) => {
    const guide: ResourceConnectionGuide = composeCase.build("site-a");
    const markdownFor: (method: ComposeInstallMethod) => string = (
      method: ComposeInstallMethod,
    ): string => {
      return fullGuide(composeCase.setupGuide(method, "site-a"));
    };

    test("gives the .env line that names this resource, with the variable the guide and agent use", () => {
      expect(guide.setupSteps[1]!.code).toBe(`${composeCase.variable}=site-a`);
      expect(guide.setupSteps[1]!.description).toContain('"site-a"');
      // The line the Docker Compose install writes into .env for this resource.
      expect(markdownFor("docker-compose")).toContain(
        guide.setupSteps[1]!.code!,
      );
      expect(
        readAgentFile(composeCase.agentDirectory, "docker-compose.yml") +
          readAgentFile(
            composeCase.agentDirectory,
            "otel-collector-config.yaml",
          ),
      ).toContain(composeCase.variable);
    });

    test("the install script it points to asks for that name", () => {
      expect(readAgentFile(composeCase.agentDirectory, "install.sh")).toMatch(
        new RegExp(`read -r[a-z]* .*${composeCase.variable}`),
      );
    });

    test("a name with spaces is single-quoted for Compose", () => {
      expect(composeCase.build("Site A").setupSteps[1]!.code).toBe(
        `${composeCase.variable}='Site A'`,
      );
    });

    test("checks the container the agent's compose file starts, by its fixed name", () => {
      const psCommand: string = `docker ps --filter name=${composeCase.containerName}`;

      expect(guide.setupSteps[2]!.code).toBe(psCommand);
      expect(guide.troubleshootingSteps[0]!.code).toBe(psCommand);
      expect(
        readAgentFile(composeCase.agentDirectory, "docker-compose.yml"),
      ).toContain(`container_name: ${composeCase.containerName}`);
      for (const method of COMPOSE_INSTALL_METHODS) {
        expect(markdownFor(method)).toContain(composeCase.containerName);
      }
    });

    test("the second check is the diagnostic script where the guide documents one, else the logs", () => {
      const second: ResourceConnectionGuideStep =
        guide.troubleshootingSteps[1]!;
      const url: string = `https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/${composeCase.agentDirectory}/troubleshoot.sh`;
      const documented: Array<boolean> = COMPOSE_INSTALL_METHODS.map(
        (method: ComposeInstallMethod): boolean => {
          return markdownFor(method).includes(url);
        },
      );

      // Both installs agree, so the card can give one answer for either.
      expect(documented[1]).toBe(documented[0]);

      if (documented[0]) {
        expect(second.title).toBe("Run the diagnostic script");
        expect(second.code).toBe(
          `curl -sSL ${url} -o troubleshoot.sh && bash troubleshoot.sh`,
        );
        expect(
          fs.existsSync(
            path.join(
              AGENTS_DIRECTORY,
              composeCase.agentDirectory,
              "troubleshoot.sh",
            ),
          ),
        ).toBe(true);
      } else {
        expect(second.title).toBe("Read the agent's logs");
        expect(second.code).toBe(
          `docker logs ${composeCase.containerName} --tail 50`,
        );
      }
    });
  },
);

describe("Host guide", () => {
  const guide: ResourceConnectionGuide = getHostConnectionGuide("db-01");

  test("explains that the match is on host.name, read from the machine's hostname", () => {
    const step: ResourceConnectionGuideStep = guide.setupSteps[2]!;

    expect(step.description).toContain("host.name");
    expect(step.description).toContain('"db-01"');
    expect(step.code).toBe("hostname");
    // The collector config every install saves takes host.name from the OS.
    expect(getHostCollectorConfig(VARS)).toMatch(
      /hostname_sources: \[os\]\s+resource_attributes:\s+host\.name:\s+enabled: true/,
    );
  });

  test("the service checks are the ones the Linux install uses", () => {
    const linux: string = fullGuide(
      getHostSetupGuide({ ...VARS, method: "linux-deb" }),
    );

    expect(guide.troubleshootingSteps[0]!.code).toBe(
      "sudo systemctl status otelcol-contrib",
    );
    expect(linux).toContain("sudo systemctl status otelcol-contrib");
    expect(guide.troubleshootingSteps[1]!.code).toBe(
      "sudo journalctl -u otelcol-contrib -n 50",
    );
    expect(linux).toContain("journalctl -u otelcol-contrib");
  });

  test("the Docker container it mentions is the one the Docker install starts", () => {
    expect(guide.troubleshootingSteps[0]!.description).toContain(
      "otel-collector",
    );
    expect(
      fullGuide(getHostSetupGuide({ ...VARS, method: "docker" })),
    ).toContain("--name otel-collector");
  });
});

describe("IoT fleet guide", () => {
  test("stamps the fleet name and the matching iot/<fleet> service, as the SDK quick start does", () => {
    const guide: ResourceConnectionGuide =
      getIoTFleetConnectionGuide("building-a-sensors");

    expect(guide.setupSteps[1]!.code).toBe(
      "OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,service.name=iot/building-a-sensors",
    );
    // The SDK quick start, which stamps its example fleet the same way.
    const sdkGuide: string = fullGuide(
      getIoTSetupGuide({ ...VARS, method: "opentelemetry-sdk" }),
    );

    expect(sdkGuide).toContain(
      "OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,",
    );
    expect(sdkGuide).toContain("service.name=iot/building-a-sensors");
    expect(sdkGuide).toContain("service.name=iot/<fleet>");
  });

  test("a fleet name with spaces or commas is percent-encoded", () => {
    expect(
      getIoTFleetConnectionGuide("Building A, North").setupSteps[1]!.code,
    ).toBe(
      "OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=Building%20A%2C%20North,service.name=iot/Building%20A%2C%20North",
    );
  });
});

describe("Cloud environment guide", () => {
  test("lists the environment's cloud attributes, the ones ingest matches on", () => {
    const guide: ResourceConnectionGuide = getCloudResourceConnectionGuide({
      cloudPlatform: "aws_ecs",
      cloudAccountId: "123456789012",
      cloudRegion: "us-east-1",
    });

    expect(guide.setupSteps[1]!.code).toBe(
      "cloud.platform=aws_ecs,cloud.account.id=123456789012,cloud.region=us-east-1",
    );
    expect(guide.troubleshootingSteps[2]!.code).toBe(guide.setupSteps[1]!.code);
  });

  test("only the parts that are set", () => {
    expect(
      getCloudResourceConnectionGuide({
        cloudPlatform: "gcp_cloud_run",
        cloudRegion: " europe-west1 ",
      }).setupSteps[1]!.code,
    ).toBe("cloud.platform=gcp_cloud_run,cloud.region=europe-west1");
  });

  test("no attributes at all means no empty snippet", () => {
    const guide: ResourceConnectionGuide = getCloudResourceConnectionGuide({});

    expect(guide.setupSteps[1]!.code).toBeUndefined();
    expect(guide.troubleshootingSteps[2]!.code).toBeUndefined();
  });
});

describe("RUM application guide", () => {
  test("names service.name, with the client attributes that make it RUM", () => {
    const guide: ResourceConnectionGuide =
      getRumApplicationConnectionGuide("storefront-web");

    expect(guide.setupSteps[1]!.code).toBe("service.name=storefront-web");
    expect(guide.troubleshootingSteps[2]!.description).toMatch(
      /browser\.\* or device\.\*/,
    );
    expect(
      fullGuide(
        getRumSetupGuide({
          ...VARS,
          client: "browser",
          appName: "storefront-web",
        }),
      ),
    ).toContain("service.name");
  });

  test("asks for a Browser ingestion key, as the RUM guide does", () => {
    const guide: ResourceConnectionGuide =
      getRumApplicationConnectionGuide("storefront-web");

    expect(guide.setupSteps[0]!.title).toBe("Create a Browser ingestion key");
    expect(
      fullGuide(getRumSetupGuide({ ...VARS, client: "browser" })),
    ).toContain("Browser ingestion key");
  });
});

describe("Serverless function guide", () => {
  test("sets faas.name the way the serverless guide's environment variables do", () => {
    const guide: ResourceConnectionGuide =
      getServerlessFunctionConnectionGuide("checkout-handler");

    expect(guide.setupSteps[1]!.code).toBe(
      'OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler"',
    );
    /*
     * The guide's variable list writes the same variable and value without
     * the shell quotes (an encoded value never needs them). On AWS Lambda
     * the layer sets faas.name itself, so "Other runtimes" is the guide
     * that sets it by hand.
     */
    expect(
      fullGuide(
        getServerlessSetupGuide({
          ...VARS,
          platform: "other",
          functionName: "checkout-handler",
        }),
      ),
    ).toContain("OTEL_RESOURCE_ATTRIBUTES=faas.name=checkout-handler,");
  });

  test("a function that only runs on demand is told so, not alarmed", () => {
    const guide: ResourceConnectionGuide =
      getServerlessFunctionConnectionGuide("nightly-report");

    expect(guide.troubleshootingSteps[0]!.description).toMatch(
      /only sends data while it runs/,
    );
  });

  /*
   * On Azure Functions the function app's service.name names the function:
   * the serverless guide sets OTEL_SERVICE_NAME there and leaves faas.name
   * out, because app settings reach every function in the app and ingest
   * writes the service.name onto the telemetry as faas.name.
   */
  test("on Azure Functions, sets OTEL_SERVICE_NAME the way the serverless guide's settings do, and never faas.name", () => {
    const guide: ResourceConnectionGuide = getServerlessFunctionConnectionGuide(
      "orders-func-app",
      "azure_functions",
    );

    expect(guide.setupSteps[1]!.code).toBe(
      'OTEL_SERVICE_NAME="orders-func-app"',
    );
    expect(guide.setupSteps[1]!.description).toContain(
      "The function app's service.name must match this function",
    );
    expect(guide.troubleshootingSteps[2]!.title).toBe("Check service.name");
    expect(guide.troubleshootingSteps[2]!.code).toBe(
      'OTEL_SERVICE_NAME="orders-func-app"',
    );
    expect(allText(guide)).not.toContain("faas.name");

    // The guide writes the same setting and value, without the shell quotes.
    const azureGuide: string = fullGuide(
      getServerlessSetupGuide({
        ...VARS,
        platform: "azure-functions",
        functionName: "orders-func-app",
      }),
    );
    expect(azureGuide).toContain("OTEL_SERVICE_NAME=orders-func-app");
    expect(azureGuide).toContain("Set the application settings");
    expect(azureGuide).not.toContain("faas.name=");
  });

  test("reads the Node.js and .NET detectors' azure.functions as Azure Functions too", () => {
    expect(
      getServerlessFunctionConnectionGuide("orders-func-app", "azure.functions")
        .setupSteps[1]!.code,
    ).toBe('OTEL_SERVICE_NAME="orders-func-app"');
  });

  test("OTEL_SERVICE_NAME takes the name as written: it is not percent-decoded", () => {
    expect(
      getServerlessFunctionConnectionGuide("billing jobs,v2", "azure_functions")
        .setupSteps[1]!.code,
    ).toBe('OTEL_SERVICE_NAME="billing jobs,v2"');
  });

  test("every other platform, and a function that reported none, keeps faas.name", () => {
    for (const cloudPlatform of [
      undefined,
      null,
      "",
      "aws_lambda",
      "gcp_cloud_functions",
      "tencent_cloud_scf",
      "alibaba_cloud_fc",
    ]) {
      const guide: ResourceConnectionGuide =
        getServerlessFunctionConnectionGuide("checkout-handler", cloudPlatform);
      expect({
        cloudPlatform,
        code: guide.setupSteps[1]!.code,
        check: guide.troubleshootingSteps[2]!.title,
      }).toEqual({
        cloudPlatform,
        code: 'OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler"',
        check: "Check faas.name",
      });
    }
  });

  test("the function's Overview hands the card the cloud.platform it reported", () => {
    const overview: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Overview.tsx",
      ),
      "utf8",
    );
    const call: string = overview.slice(
      overview.indexOf("getServerlessFunctionConnectionGuide("),
      overview.indexOf(
        "documentationRoute=",
        overview.indexOf("getServerlessFunctionConnectionGuide("),
      ),
    );

    expect(call).toContain("fn.cloudPlatform as string | undefined");
    // And the page loads it.
    expect(overview).toContain("cloudPlatform: true");
  });
});
