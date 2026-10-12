import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  getKubernetesAgentChartUpgradeCommand,
  getKubernetesAgentChartUpgradeFallbackCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getDockerAgentUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import { getPodmanAgentUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import { getDockerSwarmAgentInstallScriptCommand } from "../../../FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import { getRunnerUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Components/Runner/RunnerImage";
import { HOST_COLLECTOR_VERSION } from "../../../FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import {
  PROXMOX_AGENT_COLLECTOR_IMAGE,
  PROXMOX_AGENT_RECREATE_COMMAND,
  getProxmoxAgentDownloadCommand,
  getProxmoxAgentUpgradeCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  CEPH_AGENT_RECREATE_COMMAND,
  getCephAgentDownloadCommand,
  getCephAgentUpgradeCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  VMWARE_AGENT_RECREATE_COMMAND,
  getVMwareAgentDownloadCommand,
  getVMwareAgentUpgradeCommand,
  getVMwareNativeUpgradeCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import {
  STORAGE_ARRAY_AGENT_INSTALL_DIR,
  STORAGE_ARRAY_AGENT_RECREATE_COMMAND,
  getStorageArrayAgentDownloadCommand,
  getStorageArrayAgentUpgradeCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { sectionInLanguage } from "./NetworkDocsLabels";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An outdated agent version shows a warning sign on its resource, and the
 * sign opens how to upgrade it. The agents' guides say so where they show
 * the upgrade - in every language that has the guide - naming the field the
 * sign sits beside as the reader's dashboard labels it (each language's own
 * translation from the Dashboard's locale file), and their commands are the
 * ones the dialog shows. Markdown is not compiled, so this reads the guides.
 *
 * The infrastructure agent guides of docs task 21 (Kubernetes, Docker,
 * Podman, the host collector, Proxmox) name the Dashboard as each language's
 * Dashboard draws it, Persian included (drawnLabelIn). The other guides here
 * still keep the English labels in Persian (labelIn).
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

// The task 21 guides: each language's drawn labels, Persian's included.
function drawnLabelIn(language: string, english: string): string {
  return drawnDashboardLabel(language, english);
}

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

// A line that opens a component (":::tabs", "@tab Docker CLI") or closes one.
const COMPONENT_LINE: RegExp = /^(?::::[a-z]*|@tab\s.*)$/;

/*
 * The paragraph right before the code block that starts with `command`:
 * where each guide puts the note, at the top of its upgrade section. When
 * the commands sit in tabs (one per install method), the paragraph is the
 * one before the tabs.
 */
function paragraphBefore(markdown: string, command: string): string {
  const block: number = markdown.indexOf("```bash\n" + command);
  expect(block).toBeGreaterThan(-1);
  const lines: Array<string> = markdown.slice(0, block).trimEnd().split("\n");
  while (
    lines.length > 0 &&
    COMPONENT_LINE.test((lines[lines.length - 1] as string).trim())
  ) {
    lines.pop();
  }
  const before: string = lines.join("\n").trimEnd();
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
      expect(note).toContain(`**${drawnLabelIn(language, "Agent Version")}**`);
      expect(note).toContain(
        `**${drawnLabelIn(language, "Cluster Details")}**`,
      );
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
      expect(note).toContain(`**${drawnLabelIn(language, "Agent Version")}**`);
      expect(note).toContain(`**${drawnLabelIn(language, "Overview")}**`);
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
      expect(note).toContain(`**${drawnLabelIn(language, "Agent Version")}**`);
      expect(note).toContain(`**${drawnLabelIn(language, "Overview")}**`);
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
      /*
       * The Runner guide was translated again with the other runbook pages,
       * and names the Dashboard as each language's Dashboard draws it,
       * Persian included (RunbookDocsTranslations).
       */
      const runnerVersion: string =
        language === "fa"
          ? (
              JSON.parse(
                fs.readFileSync(path.join(LOCALES_DIR, "fa.json"), "utf8"),
              ) as Record<string, string>
            )["Runner Version"] || "Runner Version"
          : labelIn(language, "Runner Version");
      expect(note).toContain(`**${runnerVersion}**`);
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
});

/*
 * The dialog's second tab is the same upgrade on Helm before 3.14, which has
 * no --reset-then-reuse-values. Every language's guide shows it under the
 * chart upgrade, and says not to use --reuse-values, which keeps the old
 * chart's defaults too (so a newer eBPF image never applies).
 */
describe("the Kubernetes guide's upgrade for older Helm, in every language", () => {
  test.each(LANGUAGES)(
    "%s: shows the dialog's older-Helm upgrade right after the chart upgrade",
    (language: string) => {
      const guide: string = readGuide(
        language,
        "telemetry/kubernetes-agent.md",
      ) as string;
      const upgrade: number = guide.indexOf(
        "```bash\n" + getKubernetesAgentChartUpgradeCommand() + "\n```",
      );
      const fallback: number = guide.indexOf(
        "```bash\n" + getKubernetesAgentChartUpgradeFallbackCommand() + "\n```",
      );
      expect(upgrade).toBeGreaterThan(-1);
      expect(fallback).toBeGreaterThan(upgrade);
      // Nothing but the paragraph leading into it sits between the two.
      expect(guide.slice(upgrade, fallback).split("```").length).toBe(3);
      expect(guide.slice(fallback)).toContain("`--reuse-values`");
    },
  );
});

describe("the English guides' other commands are the ones the upgrade dialog shows", () => {
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
 * Hosts, Proxmox, Ceph, VMware and storage arrays: their agents now report
 * the collector release their files pin, so their guides say where the sign
 * shows and how to upgrade - with the commands the dialog shows (the setup
 * guides' exports) - and every config the host guide hands out stamps the
 * pin.
 */
describe("the host collector guide stamps the pin and says how to upgrade, in every language", () => {
  /*
   * "Upgrading the collector", in each language where the English page has
   * it: the translations lie line for line beside the English page
   * (InfrastructureAgentDocsTranslations holds them to it).
   */
  function upgradeSection(language: string): string {
    return sectionInLanguage(
      language,
      "telemetry/host-otel-collector",
      "## Upgrading the collector",
    );
  }

  test.each(LANGUAGES)(
    "%s: the upgrade section names the Agent Version on the Overview and the stamp",
    (language: string) => {
      const section: string = upgradeSection(language);
      expect(section.split("\n")[0]).toMatch(/^## /);
      expect(section).toContain(
        `**${drawnLabelIn(language, "Agent Version")}**`,
      );
      expect(section).toContain(`**${drawnLabelIn(language, "Overview")}**`);
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
          /- key: oneuptime\.agent\.version\n\s+value: "([^"]+)"\n\s+action: upsert/g,
        ),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });
      // The Linux, macOS and Windows configs of the install, and the lean one.
      expect(stamps).toEqual(Array(4).fill(HOST_COLLECTOR_VERSION));
      /*
       * Like the dashboard's config, they set no service.name: the host's
       * telemetry belongs to the host, filed as host/<hostname>.
       */
      expect(guide).not.toMatch(/- key: service\.name\n/);
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
      // Debian, RHEL, macOS, Windows and the release tarball.
      expect(pins).toEqual(Array(5).fill(HOST_COLLECTOR_VERSION));
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
      // The page's configs are the dashboard's: the filter goes into that pipeline.
      expect(guide).toContain(
        "      processors: [filter/drop-metrics, resourcedetection, resource, batch]",
      );
      expect(guide).toContain("      exporters: [otlphttp/oneuptime]");
      expect(guide).not.toContain(
        'references processor "resource" which is not configured',
      );
    },
  );
});

describe("the Proxmox, Ceph, VMware and Storage Array guides say the sign follows the pinned collector, with the dialog's commands", () => {
  // The upgrade section: from its heading to the next.
  function upgradeSection(guide: string, heading: string): string {
    const start: number = guide.indexOf(heading);
    expect(start).toBeGreaterThan(-1);
    const end: number = guide.indexOf("\n## ", start + heading.length);
    return guide.slice(start, end);
  }

  // The Ceph, VMware and Storage Array guides' upgrade headings.
  const HEADINGS: Record<string, string> = {
    en: "## Upgrading the Agent",
    fa: "## ارتقای عامل",
  };

  /*
   * The Proxmox guide is in every language, line for line with the English
   * one (docs task 21), and names the Dashboard as each language draws it.
   */
  const PROXMOX: string = "telemetry/proxmox.md";

  function upgradeSectionOf(language: string, page: string): string {
    if (page === PROXMOX) {
      return sectionInLanguage(
        language,
        "telemetry/proxmox",
        "## Upgrading the agent",
      );
    }

    return upgradeSection(
      readGuide(language, page) as string,
      HEADINGS[language] as string,
    );
  }

  function labelFor(language: string, page: string, english: string): string {
    return page === PROXMOX
      ? drawnLabelIn(language, english)
      : labelIn(language, english);
  }

  test.each([
    ...LANGUAGES.map((language: string): [string, string] => {
      return [language, PROXMOX];
    }),
    ["en", "telemetry/ceph.md"],
    ["fa", "telemetry/ceph.md"],
    ["en", "telemetry/vmware.md"],
    ["fa", "telemetry/vmware.md"],
    ["en", "telemetry/storage-arrays.md"],
    ["fa", "telemetry/storage-arrays.md"],
  ])(
    "%s %s: names the Agent Version on the Overview, and pulling alone is gone",
    (language: string, page: string) => {
      const section: string = upgradeSectionOf(language, page);
      expect(section).toContain(
        `**${labelFor(language, page, "Agent Version")}**`,
      );
      expect(section).toContain(`**${labelFor(language, page, "Overview")}**`);
      expect(section).toContain("docker compose up -d --force-recreate");
      expect(section).not.toMatch(
        /docker compose pull\ndocker compose up -d\n/,
      );
    },
  );

  /*
   * The Proxmox and Ceph install scripts reuse the .env they find, so the
   * upgrade is the script again, first; a Docker Compose install takes both
   * files and a recreate in its own folder. Never the script's folder by
   * hand any more: the script finds it.
   */
  test.each([
    ...LANGUAGES.map((language: string): [string, string, string] => {
      return [language, PROXMOX, "proxmox"];
    }),
    ["en", "telemetry/ceph.md", "ceph"],
    ["fa", "telemetry/ceph.md", "ceph"],
  ])(
    "%s %s: the install script again, or the files and the recreate, as the dialog shows them",
    (language: string, page: string, agent: string) => {
      const section: string = upgradeSectionOf(language, page);
      const upgrade: string =
        agent === "proxmox"
          ? getProxmoxAgentUpgradeCommand()
          : getCephAgentUpgradeCommand();
      const compose: string =
        agent === "proxmox"
          ? getProxmoxAgentDownloadCommand() +
            "\n" +
            PROXMOX_AGENT_RECREATE_COMMAND
          : getCephAgentDownloadCommand() + "\n" + CEPH_AGENT_RECREATE_COMMAND;

      expect(section).toContain("```bash\n" + upgrade + "\n```");
      expect(section).toContain("```bash\n" + compose + "\n```");
      expect(section.indexOf(upgrade)).toBeLessThan(section.indexOf(compose));
      expect(section).toContain("`<file>.bak.<timestamp>`");
      expect(section).not.toContain("cd /opt/");
    },
  );

  test.each(["en", "fa"])(
    "%s Storage Arrays: the install script again (INSTALL_DIR for another folder), or every file and the recreate",
    (language: string) => {
      const section: string = upgradeSection(
        readGuide(language, "telemetry/storage-arrays.md") as string,
        HEADINGS[language] as string,
      );
      expect(section).toContain(
        "```bash\n" + getStorageArrayAgentUpgradeCommand() + "\n```",
      );
      expect(section).toContain("`INSTALL_DIR=<folder> bash install.sh`");
      expect(section).toContain(`\`${STORAGE_ARRAY_AGENT_INSTALL_DIR}\``);
      expect(section).toContain(
        "```bash\n" +
          getStorageArrayAgentDownloadCommand() +
          "\n" +
          STORAGE_ARRAY_AGENT_RECREATE_COMMAND +
          "\n```",
      );
    },
  );

  test.each(["en", "fa"])(
    "%s VMware: the install script again, the files and the recreate, or the release without Docker",
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
      // The dialog's Without Docker tab: the release the agent pins, again.
      expect(section).toContain(
        "```bash\n" + getVMwareNativeUpgradeCommand() + "\n```",
      );
    },
  );

  test.each(LANGUAGES)(
    "%s Proxmox: the journald wrapper image is built on the pinned collector",
    (language: string) => {
      const guide: string = readGuide(
        language,
        "telemetry/proxmox.md",
      ) as string;
      expect(guide).toContain(
        `FROM ${PROXMOX_AGENT_COLLECTOR_IMAGE} AS otelcol`,
      );
      expect(guide).not.toContain("opentelemetry-collector-contrib:latest");
    },
  );
});
