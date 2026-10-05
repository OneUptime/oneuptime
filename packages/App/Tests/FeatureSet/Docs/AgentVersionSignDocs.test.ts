import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { getKubernetesAgentChartUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getDockerAgentUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import { getPodmanAgentUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import { getDockerSwarmAgentInstallScriptCommand } from "../../../FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import { getRunnerUpgradeCommand } from "../../../FeatureSet/Dashboard/src/Components/Runner/RunnerImage";
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
