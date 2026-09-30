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
  getVMwareVCenterConnectionGuide,
  quoteForShell,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  getKubernetesInstallationMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getDockerInstallationMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import { getPodmanInstallationMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import { getDockerSwarmInstallationMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import { getProxmoxInstallationMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import { getCephInstallationMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import { getVMwareInstallationMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import {
  getHostIntroMarkdown,
  getHostMethodMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import {
  getIoTIntroMarkdown,
  getIoTMethodMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationMarkdown";
import {
  getRumDocMarkdown,
  getServerlessDocMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/documentationMarkdown";

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
 *   long one.
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
      getKubernetesInstallationMarkdown({
        clusterName: "prod-us-east-1",
        ...VARS,
      }),
    ).toContain(setting);
  });

  test("the pod check is the one the install guide's Verify step uses", () => {
    const podsCommand: string = `kubectl get pods -n ${KUBERNETES_AGENT_HELM_NAMESPACE}`;

    expect(guide.setupSteps[2]!.code).toBe(podsCommand);
    expect(guide.troubleshootingSteps[0]!.code).toBe(podsCommand);
    expect(
      getKubernetesInstallationMarkdown({ clusterName: "c", ...VARS }),
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
  markdown: string;
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
      markdown: getDockerInstallationMarkdown(VARS),
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
      markdown: getPodmanInstallationMarkdown(VARS),
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

    test("tells the agent this host's name through the variable the run command sets", () => {
      expect(guide.setupSteps[1]!.code).toBe(
        `-e ${hostCase.variable}="web-01"`,
      );
      expect(hostCase.markdown).toContain(`-e ${hostCase.variable}=`);
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
      expect(hostCase.markdown).toContain(psCommand);
      expect(hostCase.markdown).toContain(`--name ${hostCase.containerName}`);
      expect(
        readAgentFile(hostCase.agentDirectory, "docker-compose.yml"),
      ).toContain(`container_name: ${hostCase.containerName}`);
    });
  },
);

interface ComposeCase {
  build: (identifier: string) => ResourceConnectionGuide;
  markdown: string;
  agentDirectory: string;
  containerName: string;
  variable: string;
  hasDiagnosticScript: boolean;
}

describe.each([
  [
    "Docker Swarm",
    {
      build: getDockerSwarmClusterConnectionGuide,
      markdown: getDockerSwarmInstallationMarkdown(VARS),
      agentDirectory: "DockerSwarmAgent",
      containerName: "oneuptime-docker-swarm-agent",
      variable: "DOCKER_SWARM_CLUSTER_NAME",
      hasDiagnosticScript: false,
    },
  ],
  [
    "Proxmox",
    {
      build: getProxmoxClusterConnectionGuide,
      markdown: getProxmoxInstallationMarkdown(VARS),
      agentDirectory: "ProxmoxAgent",
      containerName: "oneuptime-proxmox-agent",
      variable: "PROXMOX_CLUSTER_NAME",
      hasDiagnosticScript: true,
    },
  ],
  [
    "Ceph",
    {
      build: getCephClusterConnectionGuide,
      markdown: getCephInstallationMarkdown(VARS),
      agentDirectory: "CephAgent",
      containerName: "oneuptime-ceph-agent",
      variable: "CEPH_CLUSTER_NAME",
      hasDiagnosticScript: true,
    },
  ],
  [
    "VMware",
    {
      build: getVMwareVCenterConnectionGuide,
      markdown: getVMwareInstallationMarkdown(VARS),
      agentDirectory: "VMwareAgent",
      containerName: "oneuptime-vmware-agent",
      variable: "VMWARE_VCENTER_NAME",
      hasDiagnosticScript: true,
    },
  ],
] as Array<[string, ComposeCase]>)(
  "%s guide",
  (_name: string, composeCase: ComposeCase) => {
    const guide: ResourceConnectionGuide = composeCase.build("site-a");

    test("gives the .env line that names this resource, with the variable the guide and agent use", () => {
      expect(guide.setupSteps[1]!.code).toBe(`${composeCase.variable}=site-a`);
      expect(guide.setupSteps[1]!.description).toContain('"site-a"');
      expect(composeCase.markdown).toContain(`${composeCase.variable}=`);
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
      expect(composeCase.markdown).toContain(composeCase.containerName);
    });

    test("the second check is the diagnostic script where the guide documents one, else the logs", () => {
      const second: ResourceConnectionGuideStep =
        guide.troubleshootingSteps[1]!;

      if (composeCase.hasDiagnosticScript) {
        const url: string = `https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/${composeCase.agentDirectory}/troubleshoot.sh`;

        expect(second.title).toBe("Run the diagnostic script");
        expect(second.code).toBe(
          `curl -sSL ${url} -o troubleshoot.sh && bash troubleshoot.sh`,
        );
        expect(composeCase.markdown).toContain(url);
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
    expect(getHostIntroMarkdown(VARS)).toContain("host.name");
  });

  test("the service checks are the ones the Linux install uses", () => {
    const linux: string = getHostMethodMarkdown(VARS, "linux-deb");

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
    expect(getHostMethodMarkdown(VARS, "docker")).toContain(
      "--name otel-collector",
    );
  });
});

describe("IoT fleet guide", () => {
  test("stamps the fleet name and the matching iot/<fleet> service, as the SDK quick start does", () => {
    const guide: ResourceConnectionGuide =
      getIoTFleetConnectionGuide("building-a-sensors");

    expect(guide.setupSteps[1]!.code).toBe(
      "OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,service.name=iot/building-a-sensors",
    );
    expect(getIoTMethodMarkdown(VARS, "opentelemetry")).toContain(
      "OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors",
    );
    expect(getIoTIntroMarkdown()).toContain("service.name=iot/<fleet>");
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
    expect(getRumDocMarkdown(VARS)).toContain("service.name");
  });

  test("asks for a Browser ingestion key, as the RUM guide does", () => {
    const guide: ResourceConnectionGuide =
      getRumApplicationConnectionGuide("storefront-web");

    expect(guide.setupSteps[0]!.title).toBe("Create a Browser ingestion key");
    expect(getRumDocMarkdown(VARS)).toContain("Browser ingestion key");
  });
});

describe("Serverless function guide", () => {
  test("sets faas.name the way the serverless guide's environment variables do", () => {
    const guide: ResourceConnectionGuide =
      getServerlessFunctionConnectionGuide("checkout-handler");

    expect(guide.setupSteps[1]!.code).toBe(
      'OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler"',
    );
    expect(getServerlessDocMarkdown(VARS)).toContain(
      'OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler',
    );
  });

  test("a function that only runs on demand is told so, not alarmed", () => {
    const guide: ResourceConnectionGuide =
      getServerlessFunctionConnectionGuide("nightly-report");

    expect(guide.troubleshootingSteps[0]!.description).toMatch(
      /only sends data while it runs/,
    );
  });
});
