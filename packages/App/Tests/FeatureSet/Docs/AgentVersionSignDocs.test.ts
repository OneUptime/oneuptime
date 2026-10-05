import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { getKubernetesAgentChartUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getDockerAgentUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import { getPodmanAgentUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import { getDockerSwarmAgentInstallScriptCommand } from "../../../FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import { getRunnerUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Components/Runner/RunnerImage";
import { HOST_COLLECTOR_VERSION } from "../../../FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import {
  PROXMOX_AGENT_COLLECTOR_IMAGE,
  getProxmoxAgentDownloadCommand,
  getProxmoxAgentRecreateCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  getCephAgentDownloadCommand,
  getCephAgentRecreateCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  VMWARE_AGENT_RECREATE_COMMAND,
  getVMwareAgentDownloadCommand,
  getVMwareAgentUpgradeCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An outdated agent version shows a warning sign on its resource, and the
 * sign opens how to upgrade it. The agents' guides say so where they show
 * the upgrade - in every language that has the guide - naming the field the
 * sign sits beside as the reader's dashboard labels it (each language's own
 * translation from the Dashboard's locale file; English and Persian guides
 * keep the English labels), and their commands are the ones the dialog
 * shows. Markdown is not compiled, so this reads the guides.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);
const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

// The guides that keep the dashboard's English labels.
const ENGLISH_LABEL_LANGUAGES: Array<string> = ["en", "fa"];

/*
 * The Podman guide is still English outside English and Persian, so its
 * note is too, labels included.
 */
const PODMAN_TRANSLATED_LANGUAGES: Array<string> = ["en", "fa"];

function readGuide(language: string, guide: string): string | null {
  const file: string = path.join(CONTENT_DIR, language, guide);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

const locales: Map<string, Record<string, string>> = new Map();

function labelIn(language: string, english: string): string {
  if (ENGLISH_LABEL_LANGUAGES.includes(language)) {
    return english;
  }
  let locale: Record<string, string> | undefined = locales.get(language);
  if (!locale) {
    locale = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
    locales.set(language, locale);
  }
  expect(typeof locale[english]).toBe("string");
  return locale[english] as string;
}

/*
 * The paragraph right before the code block that starts with `command`:
 * where each guide puts the note, at the top of its upgrade section.
 */
function paragraphBefore(markdown: string, command: string): string {
  const block: number = markdown.indexOf("```bash\n" + command);
  expect(block).toBeGreaterThan(-1);
  const before: string = markdown.slice(0, block).trimEnd();
  return before.slice(before.lastIndexOf("\n\n") + 2);
}

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return fs.existsSync(path.join(CONTENT_DIR, language));
  },
);

describe("the agents' guides say an outdated version shows a sign, in every language", () => {
  test("every supported docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
  });

  test.each(LANGUAGES)(
    "%s: the Kubernetes agent's upgrade names Agent Version on Cluster Details",
    (language: string) => {
      const guide: string = readGuide(
        language,
        "telemetry/kubernetes-agent.md",
      ) as string;
      // The upgrade section's block: the whole chart upgrade, nothing more.
      const note: string = paragraphBefore(
        guide,
        getKubernetesAgentChartUpgradeCommand() + "\n```",
      );
      expect(note).toContain(`**${labelIn(language, "Agent Version")}**`);
      expect(note).toContain(`**${labelIn(language, "Cluster Details")}**`);
      expect(note).toContain("OneUptime");
    },
  );

  test.each(LANGUAGES)(
    "%s: the Docker agent's upgrade names Agent Version on the Overview",
    (language: string) => {
      const guide: string = readGuide(
        language,
        "telemetry/docker-host.md",
      ) as string;
      const note: string = paragraphBefore(
        guide,
        "docker pull oneuptime/docker-agent:release",
      );
      expect(note).toContain(`**${labelIn(language, "Agent Version")}**`);
      expect(note).toContain(`**${labelIn(language, "Overview")}**`);
    },
  );

  test.each(LANGUAGES)(
    "%s: the Podman agent's upgrade names Agent Version on the Overview",
    (language: string) => {
      const guide: string = readGuide(
        language,
        "telemetry/podman-host.md",
      ) as string;
      const note: string = paragraphBefore(
        guide,
        "podman pull oneuptime/podman-agent:release",
      );
      const labelLanguage: string = PODMAN_TRANSLATED_LANGUAGES.includes(
        language,
      )
        ? language
        : "en";
      expect(note).toContain(`**${labelIn(labelLanguage, "Agent Version")}**`);
      expect(note).toContain(`**${labelIn(labelLanguage, "Overview")}**`);
    },
  );

  test.each(LANGUAGES)(
    "%s: the Runner guide's new last install step names Runner Version and shows the upgrade",
    (language: string) => {
      const guide: string = readGuide(language, "runbooks/agents.md") as string;
      const note: string = paragraphBefore(
        guide,
        "docker pull oneuptime/runner:release",
      );
      expect(note).toContain(`**${labelIn(language, "Runner Version")}**`);
      expect(guide).toContain(
        "```bash\n" + getRunnerUpgradeCommand() + "\n```",
      );
      // A fifth install step, after the fourth.
      expect(
        guide.indexOf("### 5.") > guide.indexOf("### 4.") ||
          guide.indexOf("### ۵.") > guide.indexOf("### ۴."),
      ).toBe(true);
    },
  );
});

describe("the English guides' commands are the ones the upgrade dialog shows", () => {
  test("Kubernetes: the chart upgrade", () => {
    expect(readGuide("en", "telemetry/kubernetes-agent.md")).toContain(
      "```bash\n" + getKubernetesAgentChartUpgradeCommand() + "\n```",
    );
  });

  test("Docker and Podman: the image pull and removal, and Compose", () => {
    const docker: string = readGuide(
      "en",
      "telemetry/docker-host.md",
    ) as string;
    expect(docker).toContain(getDockerAgentUpgradeCommand("docker-cli"));
    expect(docker).toContain(getDockerAgentUpgradeCommand("docker-compose"));

    const podman: string = readGuide(
      "en",
      "telemetry/podman-host.md",
    ) as string;
    expect(podman).toContain(getPodmanAgentUpgradeCommand("podman-cli"));
    expect(podman).toContain(getPodmanAgentUpgradeCommand("podman-compose"));
  });

  test("Docker Swarm: a new upgrade section runs the install script again, and says the sign follows the pinned collector", () => {
    for (const language of ["en", "fa"]) {
      const guide: string = readGuide(
        language,
        "telemetry/docker-swarm.md",
      ) as string;
      expect(guide).toContain(
        "```bash\n" + getDockerSwarmAgentInstallScriptCommand() + "\n```",
      );
      expect(guide).toContain("`docker compose pull`");
      expect(guide).toContain(`**${labelIn(language, "Overview")}**`);
    }
    expect(readGuide("en", "telemetry/docker-swarm.md")).toContain(
      "## Upgrading the agent",
    );
  });

  test("Databases: the upgrade section says the sign follows the pinned collector, and every way to upgrade", () => {
    const guide: string = readGuide("en", "telemetry/databases.md") as string;
    const section: string = guide.slice(
      guide.indexOf("### Upgrading and uninstalling"),
      guide.indexOf("## AI agent"),
    );
    expect(section).toContain("**Agent version**");
    expect(section).toContain("**Overview**");
    expect(section).toContain("install script");
    expect(section).toContain("Docker Compose");
    expect(section).toContain("Kubernetes");
  });
});

/*
 * Hosts, Proxmox, Ceph and VMware: their agents now report the collector
 * release their files pin, so their guides say where the sign shows and how
 * to upgrade - with the commands the dialog shows (the setup guides'
 * exports) - and every config the host guide hands out stamps the pin.
 */
describe("the host collector guide stamps the pin and says how to upgrade, in every language", () => {
  // The section after "Step 4": the new "Upgrading the collector".
  function upgradeSection(guide: string): string {
    const lines: Array<string> = guide.split("\n");
    const headings: Array<number> = lines
      .map((line: string, index: number): number => {
        return line.startsWith("## ") ? index : -1;
      })
      .filter((index: number): boolean => {
        return index >= 0;
      });
    expect(lines[headings[5]!]).toMatch(/4|۴/);
    return lines.slice(headings[6]!, headings[7]!).join("\n");
  }

  test.each(LANGUAGES)(
    "%s: the upgrade section names the Agent Version on the Overview and the stamp",
    (language: string) => {
      const guide: string = readGuide(
        language,
        "telemetry/host-otel-collector.md",
      ) as string;
      const section: string = upgradeSection(guide);
      expect(section).toContain(`**${labelIn(language, "Agent Version")}**`);
      expect(section).toContain(`**${labelIn(language, "Overview")}**`);
      expect(section).toContain("`oneuptime.agent.version`");
      expect(section).toContain("`VERSION`");
    },
  );

  test.each(LANGUAGES)(
    "%s: every resource processor in the examples stamps the release the Dashboard pins",
    (language: string) => {
      const guide: string = readGuide(
        language,
        "telemetry/host-otel-collector.md",
      ) as string;
      const stamps: Array<string> = Array.from(
        guide.matchAll(
          /- key: service\.name\n\s+value: [^\n]+\n\s+action: upsert\n\s+- key: oneuptime\.agent\.version\n\s+value: "([^"]+)"\n\s+action: upsert/g,
        ),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });
      // Common pieces, the Linux, macOS and Windows examples, the lean one.
      expect(stamps).toEqual(Array(5).fill(HOST_COLLECTOR_VERSION));
    },
  );

  test.each(LANGUAGES)(
    "%s: every install downloads that release, never 'the latest'",
    (language: string) => {
      const guide: string = readGuide(
        language,
        "telemetry/host-otel-collector.md",
      ) as string;
      const pins: Array<string> = Array.from(
        guide.matchAll(/^\$?VERSION\s*=\s*"?(\d+\.\d+\.\d+)"?/gm),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });
      // Debian, RHEL, macOS and Windows.
      expect(pins).toEqual(Array(4).fill(HOST_COLLECTOR_VERSION));
      expect(guide).not.toContain("pick the latest release tag");
    },
  );

  test.each(LANGUAGES)(
    "%s: the generated config's pipeline the page tells people to merge keeps the version processor",
    (language: string) => {
      const guide: string = readGuide(
        language,
        "telemetry/host-otel-collector.md",
      ) as string;
      expect(guide).toContain(
        ">       processors: [filter/drop-metrics, resourcedetection, resource, batch]",
      );
      expect(guide).not.toContain(
        'references processor "resource" which is not configured',
      );
    },
  );
});

describe("the Proxmox, Ceph and VMware guides say the sign follows the pinned collector, with the dialog's commands", () => {
  // The upgrade section: from its heading to the next.
  function upgradeSection(guide: string, heading: string): string {
    const start: number = guide.indexOf(heading);
    expect(start).toBeGreaterThan(-1);
    const end: number = guide.indexOf("\n## ", start + heading.length);
    return guide.slice(start, end);
  }

  const HEADINGS: Record<string, string> = {
    en: "## Upgrading the Agent",
    fa: "## ارتقای عامل",
  };

  test.each([
    ["en", "telemetry/proxmox.md"],
    ["fa", "telemetry/proxmox.md"],
    ["en", "telemetry/ceph.md"],
    ["fa", "telemetry/ceph.md"],
    ["en", "telemetry/vmware.md"],
    ["fa", "telemetry/vmware.md"],
  ])(
    "%s %s: names the Agent Version on the Overview, and pulling alone is gone",
    (language: string, page: string) => {
      const section: string = upgradeSection(
        readGuide(language, page) as string,
        HEADINGS[language] as string,
      );
      expect(section).toContain(`**${labelIn(language, "Agent Version")}**`);
      expect(section).toContain(`**${labelIn(language, "Overview")}**`);
      expect(section).toContain("docker compose up -d --force-recreate");
      expect(section).not.toMatch(/docker compose pull\ndocker compose up -d\n/);
    },
  );

  test.each([
    ["en", "telemetry/proxmox.md"],
    ["fa", "telemetry/proxmox.md"],
  ])(
    "%s %s: the install script's folder, the files again and the recreate, as the dialog shows them",
    (language: string, page: string) => {
      const section: string = upgradeSection(
        readGuide(language, page) as string,
        HEADINGS[language] as string,
      );
      expect(section).toContain(
        "```bash\n" +
          getProxmoxAgentDownloadCommand("install-script") +
          "\n" +
          getProxmoxAgentRecreateCommand("docker-compose") +
          "\n```",
      );
    },
  );

  test.each([
    ["en", "telemetry/ceph.md"],
    ["fa", "telemetry/ceph.md"],
  ])(
    "%s %s: the install script's folder, the files again and the recreate, as the dialog shows them",
    (language: string, page: string) => {
      const section: string = upgradeSection(
        readGuide(language, page) as string,
        HEADINGS[language] as string,
      );
      expect(section).toContain(
        "```bash\n" +
          getCephAgentDownloadCommand("install-script") +
          "\n" +
          getCephAgentRecreateCommand("docker-compose") +
          "\n```",
      );
    },
  );

  test.each(["en", "fa"])(
    "%s VMware: the install script again, or the files and the recreate",
    (language: string) => {
      const section: string = upgradeSection(
        readGuide(language, "telemetry/vmware.md") as string,
        HEADINGS[language] as string,
      );
      expect(section).toContain(
        "```bash\n" + getVMwareAgentUpgradeCommand() + "\n```",
      );
      expect(section).toContain(
        "```bash\n" +
          getVMwareAgentDownloadCommand() +
          "\n" +
          VMWARE_AGENT_RECREATE_COMMAND +
          "\n```",
      );
    },
  );

  test.each(["en", "fa"])(
    "%s Proxmox: the journald wrapper image is built on the pinned collector",
    (language: string) => {
      const guide: string = readGuide(language, "telemetry/proxmox.md") as string;
      expect(guide).toContain(`FROM ${PROXMOX_AGENT_COLLECTOR_IMAGE} AS otelcol`);
      expect(guide).not.toContain("opentelemetry-collector-contrib:latest");
    },
  );
});
