import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  DEFAULT_HOST_INSTALL_METHOD,
  HOST_COLLECTOR_METHODS,
  HOST_COLLECTOR_UPGRADE_TOPIC_TITLE,
  HOST_INSTALL_METHODS,
  HostCollectorMethod,
  HostInstallMethod,
  NATIVE_LINUX_INSTALL_METHODS,
  getHostCollectorCommandLanguage,
  getHostCollectorConfig,
  getHostCollectorUpgradeCommand,
  getHostSetupGuide,
  resolveHostInstallMethod,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import { HOST_COLLECTOR_VERSION } from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import { MIN_OTELCOL_CONTRIB_VERSION } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnits";
import {
  KUBERNETES_AGENT_HELM_RELEASE,
  getKubernetesSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";

/*
 * The host guide asks how the OpenTelemetry Collector gets onto the host,
 * then shows only that method's steps: save the shared config.yaml, install
 * and start the collector, check the host appears. These tests pin, for
 * every method:
 *
 *   - that the config and every command carry the reader's URL and key;
 *   - that a method shows its own commands and none of another method's —
 *     the systemd receiver only on native Linux installs (a containerised
 *     collector cannot reach the host's D-Bus), PowerShell only on Windows;
 *   - that the setup options stay out of the first-run steps;
 *   - that what the guide says about host discovery, key refusals and the
 *     receivers' versions is what ingest and the docs site actually say.
 */

type YamlMap = Record<string, any>;

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const readRepoFile: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
};

const squash: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ");
};

const HOST_DOCS_PAGE: string =
  "packages/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md";

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const METHOD_KEYS: Array<HostInstallMethod> = HOST_INSTALL_METHODS.map(
  (option: SetupGuideOption<HostInstallMethod>): HostInstallMethod => {
    return option.key;
  },
);

const NATIVE_LINUX: Array<HostInstallMethod> = [
  "linux-deb",
  "linux-rpm",
  "linux-tarball",
];

/*
 * Every method except Kubernetes puts a collector on the host, running the
 * shared config.yaml. Kubernetes installs the Kubernetes agent instead (see
 * "the Kubernetes option" below).
 */
type HostCollectorMethod = Exclude<HostInstallMethod, "kubernetes">;

const CONFIG_FILE_METHODS: Array<HostCollectorMethod> = METHOD_KEYS.filter(
  (method: HostInstallMethod): method is HostCollectorMethod => {
    return method !== "kubernetes";
  },
);

const WINDOWS_INSTALL_DIR: string = "C:\\Program Files\\otelcol-contrib";

const guideFor: (
  method: HostInstallMethod,
  overrides?: { apiKey?: string; oneuptimeUrl?: string },
) => SetupGuideContent = (
  method: HostInstallMethod,
  overrides?: { apiKey?: string; oneuptimeUrl?: string },
): SetupGuideContent => {
  return getHostSetupGuide({
    oneuptimeUrl: overrides?.oneuptimeUrl ?? URL,
    apiKey: overrides?.apiKey ?? KEY,
    method: method,
  });
};

const markdownOf: (method: HostInstallMethod) => string = (
  method: HostInstallMethod,
): string => {
  return getSetupGuideMarkdown(guideFor(method));
};

const stepTitled: (
  guide: SetupGuideContent,
  title: string,
) => SetupGuideStep = (
  guide: SetupGuideContent,
  title: string,
): SetupGuideStep => {
  const step: SetupGuideStep | undefined = guide.steps.find(
    (candidate: SetupGuideStep): boolean => {
      return candidate.title === title;
    },
  );
  if (!step) {
    throw new Error(`No step titled "${title}"`);
  }
  return step;
};

const topicTitles: (
  topics: Array<SetupGuideTopic> | undefined,
) => Array<string> = (
  topics: Array<SetupGuideTopic> | undefined,
): Array<string> => {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
};

const topicTitled: (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
) => SetupGuideTopic | undefined = (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
): SetupGuideTopic | undefined => {
  return (topics || []).find((topic: SetupGuideTopic): boolean => {
    return topic.title === title;
  });
};

// The bodies of every fenced block of one language, in reading order.
const codeBlocksOf: (markdown: string, language: string) => Array<string> = (
  markdown: string,
  language: string,
): Array<string> => {
  return Array.from(
    markdown.matchAll(
      new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, "g"),
    ),
  ).map((match: RegExpMatchArray): string => {
    return match[1] || "";
  });
};

// The config the guide asks the reader to save, parsed.
const savedConfigOf: (guide: SetupGuideContent) => YamlMap = (
  guide: SetupGuideContent,
): YamlMap => {
  const step: SetupGuideStep = stepTitled(guide, "Save the collector config");
  const blocks: Array<string> = codeBlocksOf(step.markdown || "", "yaml");
  expect(blocks).toHaveLength(1);
  return yaml.load(blocks[0]!) as YamlMap;
};

/*
 * Commands only one method runs. A method's guide must carry its own and
 * none of the others' — that is what the picker is for.
 */
const METHOD_SIGNATURES: Record<HostCollectorMethod, Array<string>> = {
  docker: ["docker run -d", "--pid host", "HOST_PROC=/hostfs/proc"],
  "linux-deb": [
    "dpkg --print-architecture",
    "sudo dpkg -i /tmp/otelcol-contrib.deb",
  ],
  "linux-rpm": ["sudo rpm -Uvh /tmp/otelcol-contrib.rpm"],
  "linux-tarball": [
    "sudo tar -xzf /tmp/otelcol.tar.gz -C /opt/otelcol-contrib",
    "/etc/systemd/system/otelcol-contrib.service",
  ],
  macos: [
    "_darwin_",
    "sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist",
  ],
  windows: ["sc.exe --% create", "Invoke-WebRequest", "Get-CimInstance"],
};

describe("the install method picker", () => {
  test("offers the seven install methods, Docker first", () => {
    expect(METHOD_KEYS).toEqual([
      "docker",
      "linux-deb",
      "linux-rpm",
      "linux-tarball",
      "macos",
      "windows",
      "kubernetes",
    ]);
    expect(DEFAULT_HOST_INSTALL_METHOD).toBe("docker");
  });

  test("labels each method the way people know it", () => {
    expect(
      HOST_INSTALL_METHODS.map(
        (option: SetupGuideOption<HostInstallMethod>): string => {
          return option.label;
        },
      ),
    ).toEqual([
      "Docker",
      "Debian / Ubuntu",
      "RHEL / Fedora",
      "Linux Tarball",
      "macOS",
      "Windows",
      "Kubernetes",
    ]);
  });

  test("every method has a one-line description", () => {
    for (const option of HOST_INSTALL_METHODS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
    }
  });

  test("the macOS option no longer promises Homebrew", () => {
    const macos: SetupGuideOption<HostInstallMethod> | undefined =
      HOST_INSTALL_METHODS.find(
        (option: SetupGuideOption<HostInstallMethod>): boolean => {
          return option.key === "macos";
        },
      );
    expect(macos?.description).toContain("launchd");
    expect(macos?.description).not.toMatch(/brew/i);
  });

  test("an unknown or missing method resolves to Docker", () => {
    for (const value of [undefined, null, "", "freebsd", "Windows"]) {
      expect(resolveHostInstallMethod(value)).toBe("docker");
    }
    for (const method of METHOD_KEYS) {
      expect(resolveHostInstallMethod(method)).toBe(method);
    }
  });

  test("the native Linux installs are the three systemd-managed ones", () => {
    expect([...NATIVE_LINUX_INSTALL_METHODS]).toEqual(NATIVE_LINUX);
  });
});

describe.each(CONFIG_FILE_METHODS)(
  "the %s guide",
  (method: HostCollectorMethod) => {
    const guide: SetupGuideContent = guideFor(method);
    const markdown: string = getSetupGuideMarkdown(guide);

    test("step 1 shows the OTLP endpoint the config exports to", () => {
      expect(guide.keyStep?.endpointLabel).toBe("OTLP Endpoint");
      expect(guide.keyStep?.endpointValue).toBe(`${URL}/otlp`);
      // Rendered as plain text next to the key picker.
      expect(guide.keyStep?.description).toBeTruthy();
      expect(guide.keyStep?.description).not.toMatch(/[`*[\]]/);
    });

    test("is a few short steps after the key: config, install, verify", () => {
      const titles: Array<string> = guide.steps.map(
        (step: SetupGuideStep): string => {
          return step.title;
        },
      );

      expect(titles).toHaveLength(3);
      expect(titles[0]).toBe("Save the collector config");
      expect(titles[1]).toMatch(/collector/);
      expect(titles[2]).toBe("Check the host appears");
    });

    test("every step has a one-sentence plain-text description", () => {
      for (const step of guide.steps) {
        expect(step.description).toBeTruthy();
        expect(step.description).not.toMatch(/[`*[\]]/);
        expect(step.description).not.toContain("\n");
        expect(step.description).toMatch(/\.$/);
      }
    });

    test("the prerequisites are two to four one-liners", () => {
      const prerequisites: Array<string> = guide.prerequisites || [];
      expect(prerequisites.length).toBeGreaterThanOrEqual(2);
      expect(prerequisites.length).toBeLessThanOrEqual(4);
      for (const line of prerequisites) {
        expect(line).not.toContain("\n");
      }
      expect(prerequisites.join("\n")).toMatch(/Network access/);
    });

    test("the URL and key reach the config the collector runs", () => {
      const config: YamlMap = savedConfigOf(guide);
      const exporter: YamlMap = config["exporters"]["otlphttp/oneuptime"];
      expect(exporter["endpoint"]).toBe(`${URL}/otlp`);
      expect(exporter["headers"]["x-oneuptime-token"]).toBe(KEY);
    });

    test("shows its own commands and none of another method's", () => {
      for (const signature of METHOD_SIGNATURES[method]) {
        expect(markdown).toContain(signature);
      }
      for (const other of CONFIG_FILE_METHODS) {
        if (other === method) {
          continue;
        }
        for (const signature of METHOD_SIGNATURES[other]) {
          expect({
            other,
            signature,
            present: markdown.includes(signature),
          }).toEqual({ other, signature, present: false });
        }
      }
    });

    test("keeps the optional setup out of the first-run steps", () => {
      const steps: string = guide.steps
        .map((step: SetupGuideStep): string => {
          return `${step.markdown || ""}${step.description || ""}`;
        })
        .join("\n");

      for (const advanced of [
        "resource/oneuptime-hardware",
        "resource/oneuptime-labels",
        "windows_service:",
        "systemd:",
        "include_services",
        "Win32_BIOS",
      ]) {
        expect(steps).not.toContain(advanced);
      }
    });

    test("the systemd receiver is offered on native Linux installs only", () => {
      const isNative: boolean = NATIVE_LINUX.includes(method);
      expect(
        topicTitles(guide.advanced).includes("Enable the Systemd Units tab"),
      ).toBe(isNative);
      expect(markdown.includes("receivers: [hostmetrics, systemd]")).toBe(
        isNative,
      );
      expect(markdown.includes("journalctl")).toBe(isNative);
    });

    test("Windows-only content stays on Windows", () => {
      const isWindows: boolean = method === "windows";
      expect(markdown.includes("```powershell")).toBe(isWindows);
      expect(markdown.includes("windows_service")).toBe(isWindows);
      expect(markdown.includes("Win32_BIOS")).toBe(isWindows);
      expect(
        topicTitles(guide.advanced).includes("Enable the Windows Services tab"),
      ).toBe(isWindows);
    });

    test("the config-editing topics are offered wherever there is a config file", () => {
      const titles: Array<string> = topicTitles(guide.advanced);
      for (const title of [
        "Record the serial number, make, model and firmware version",
        "Tag the host with project labels",
        "What gets reported",
        HOST_COLLECTOR_UPGRADE_TOPIC_TITLE,
      ]) {
        expect(titles.includes(title)).toBe(true);
      }
    });

    test("has three to eight Advanced topics", () => {
      const count: number = (guide.advanced || []).length;
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(8);
    });

    test("every Advanced topic has a plain one-line summary", () => {
      for (const topic of guide.advanced || []) {
        expect(topic.summary).toBeTruthy();
        // Summaries render as plain text, so no markdown.
        expect(topic.summary).not.toMatch(/[`*[\]]/);
        expect(topic.summary).not.toContain("\n");
      }
    });

    test("troubleshooting is titled by symptom and matches the method", () => {
      const titles: Array<string> = topicTitles(guide.troubleshooting);
      expect(titles.length).toBeGreaterThan(0);
      expect(titles[0]).toBe("The host does not appear in Hosts");
      expect(
        titles.includes("Metrics describe the container instead of the host"),
      ).toBe(method === "docker");
      expect(titles.includes("The Systemd Units tab stays empty")).toBe(
        NATIVE_LINUX.includes(method),
      );
      expect(titles.includes("The Windows service does not start")).toBe(
        method === "windows",
      );
      expect(
        titles.includes("The Services tab still lists every service"),
      ).toBe(method === "windows");
    });

    test("the troubleshooting explains key refusals and names the OTLP endpoint", () => {
      const trouble: string = (guide.troubleshooting || [])
        .map((topic: SetupGuideTopic): string => {
          return topic.markdown;
        })
        .join("\n");
      expect(trouble).toContain("`401`");
      expect(trouble).toContain("`422`");
      expect(trouble).toContain(`${URL}/otlp`);
    });

    test("links to documentation that exists", () => {
      const links: Array<string> = (guide.links || []).map(
        (link: { title: string; url: string }): string => {
          return link.url;
        },
      );
      expect(links[0]).toBe("/docs/telemetry/host-otel-collector");
      expect(links.includes("/docs/telemetry/kubernetes-agent")).toBe(false);
      expect(links.length).toBeLessThanOrEqual(2);
      for (const url of links) {
        expect(
          fs.existsSync(
            path.join(
              REPO_ROOT,
              "packages/App/FeatureSet/Docs/Content/en",
              `${url.replace(/^\/docs\//, "")}.md`,
            ),
          ),
        ).toBe(true);
      }
    });

    test("every code fence is closed", () => {
      expect((markdown.match(/```/g) || []).length % 2).toBe(0);
      expect(getSetupGuideCodeBlocks(guide).length).toBeGreaterThan(1);
    });

    test("never tells anyone the collector has to run as root", () => {
      /*
       * The same false claims SystemdUnitsPageWiring.test.ts keeps out of the
       * docs page: the systemd receiver only makes read-only D-Bus calls.
       */
      for (const claim of [
        /runs as root/i,
        /(has to|must|needs to|need to) run as root/i,
        /root, which is what lets/i,
      ]) {
        expect(markdown).not.toMatch(claim);
      }
    });
  },
);

describe("the shared collector config", () => {
  const config: YamlMap = yaml.load(
    getHostCollectorConfig({ oneuptimeUrl: URL, apiKey: KEY }),
  ) as YamlMap;

  test("every method with a config file saves exactly this config", () => {
    const expected: string = getHostCollectorConfig({
      oneuptimeUrl: URL,
      apiKey: KEY,
    });
    for (const method of CONFIG_FILE_METHODS) {
      const step: SetupGuideStep = stepTitled(
        guideFor(method),
        "Save the collector config",
      );
      expect(codeBlocksOf(step.markdown || "", "yaml")).toEqual([
        `${expected}\n`,
      ]);
    }
  });

  test("scrapes host and per-process metrics every 30 seconds", () => {
    const hostmetrics: YamlMap = config["receivers"]["hostmetrics"];
    expect(hostmetrics["collection_interval"]).toBe("30s");
    expect(Object.keys(hostmetrics["scrapers"]).sort()).toEqual(
      [
        "cpu",
        "disk",
        "filesystem",
        "load",
        "memory",
        "network",
        "paging",
        "process",
        "processes",
      ].sort(),
    );
  });

  test("turns on the logical CPU count the Hosts list caches", () => {
    expect(
      config["receivers"]["hostmetrics"]["scrapers"]["cpu"]["metrics"][
        "system.cpu.logical.count"
      ]["enabled"],
    ).toBe(true);
  });

  test("detects every attribute the host record and Inventory item read", () => {
    const detection: YamlMap = config["processors"]["resourcedetection"];
    expect(detection["detectors"]).toEqual(["system", "env"]);
    expect(detection["system"]["hostname_sources"]).toEqual(["os"]);

    const attributes: YamlMap = detection["system"]["resource_attributes"];
    for (const key of [
      "host.name",
      "host.id",
      "host.arch",
      "host.ip",
      "host.mac",
      "os.type",
      "os.description",
      "os.version",
    ]) {
      expect({ key, enabled: attributes[key]?.["enabled"] }).toEqual({
        key,
        enabled: true,
      });
    }
  });

  test("runs one metrics pipeline through resourcedetection to OneUptime", () => {
    expect(config["service"]["pipelines"]).toEqual({
      metrics: {
        receivers: ["hostmetrics"],
        processors: ["resourcedetection", "resource", "batch"],
        exporters: ["otlphttp/oneuptime"],
      },
    });
  });

  /*
   * The host's agent version: the config stamps the collector release the
   * guide installs, which OneUptime shows as the host's Agent Version and
   * compares with the release it pins (AgentKind.HostCollector).
   */
  test("stamps the release the guide installs as oneuptime.agent.version, and nothing else", () => {
    expect(config["processors"]["resource"]).toEqual({
      attributes: [
        {
          key: "oneuptime.agent.version",
          value: HOST_COLLECTOR_VERSION,
          action: "upsert",
        },
      ],
    });
    // A string, so YAML can never read the version as a number.
    expect(
      getHostCollectorConfig({ oneuptimeUrl: URL, apiKey: KEY }),
    ).toContain(`value: "${HOST_COLLECTOR_VERSION}"`);
  });

  test("matches what the docs site tells people editing the generated config", () => {
    /*
     * host-otel-collector.md warns that the dashboard's config names its
     * processors and exporter differently from the page's own examples. If
     * the config changes, that warning becomes the wrong advice.
     */
    const doc: string = squash(readRepoFile(HOST_DOCS_PAGE));
    expect(doc).toContain(
      "its processors are `resourcedetection`, `resource` and `batch`, and its exporter is `otlphttp/oneuptime`",
    );
    // The block it tells them to merge keeps every processor the config has.
    expect(doc).toContain(
      "processors: [filter/drop-metrics, resourcedetection, resource, batch]",
    );
    expect(Object.keys(config["processors"]).sort()).toEqual([
      "batch",
      "resource",
      "resourcedetection",
    ]);
    expect(Object.keys(config["exporters"])).toEqual(["otlphttp/oneuptime"]);
    expect(Object.keys(config["service"]["pipelines"])).toEqual(["metrics"]);
  });
});

/*
 * The Advanced topics hand out config fragments to merge into config.yaml.
 * A fragment whose pipeline names a processor or receiver that exists
 * nowhere stops the collector at startup ("references processor ... which
 * is not configured"), so every name must be defined by the shared config,
 * by the fragment itself, or by the Windows script that prints it.
 */
describe("every config fragment names only components that exist", () => {
  const shared: YamlMap = yaml.load(
    getHostCollectorConfig({ oneuptimeUrl: URL, apiKey: KEY }),
  ) as YamlMap;

  test.each(CONFIG_FILE_METHODS)("%s", (method: HostInstallMethod) => {
    const guide: SetupGuideContent = guideFor(method);
    const fragments: Array<string> = (guide.advanced || []).flatMap(
      (topic: SetupGuideTopic): Array<string> => {
        return codeBlocksOf(topic.markdown, "yaml");
      },
    );
    expect(fragments.length).toBeGreaterThan(1);

    const printedByScript: Array<string> =
      method === "windows" ? ["resource/oneuptime-hardware"] : [];

    for (const fragment of fragments) {
      const parsed: YamlMap = yaml.load(fragment) as YamlMap;
      const metrics: YamlMap | undefined =
        parsed["service"]?.["pipelines"]?.["metrics"];
      expect(metrics).toBeDefined();

      for (const processor of metrics!["processors"] || []) {
        expect({
          fragment: fragment.split("\n")[0],
          processor,
          defined:
            processor in (shared["processors"] || {}) ||
            processor in (parsed["processors"] || {}) ||
            printedByScript.includes(processor),
        }).toEqual({
          fragment: fragment.split("\n")[0],
          processor,
          defined: true,
        });
      }

      for (const receiver of metrics!["receivers"] || []) {
        expect(
          receiver in shared["receivers"] ||
            receiver in (parsed["receivers"] || {}),
        ).toBe(true);
      }

      // resourcedetection stamps host.name, which is what attaches a host.
      if (metrics!["processors"]) {
        expect(metrics!["processors"][0]).toBe("resourcedetection");
        /*
         * A fragment's pipeline replaces the config's, so it keeps the
         * processor that reports the collector's version.
         */
        expect(metrics!["processors"]).toContain("resource");
      }
    }
  });
});

describe("the Linux package installs", () => {
  test.each(["linux-deb", "linux-rpm"] as Array<HostInstallMethod>)(
    "%s restarts the service after installing the config",
    (method: HostInstallMethod) => {
      /*
       * The package's postinstall script already enables and starts the
       * service with the package's own default config, so `enable --now`
       * afterwards is a no-op and the collector would keep running the
       * default config. Only a restart makes it read ours.
       */
      const install: string =
        stepTitled(guideFor(method), "Install the collector").markdown || "";
      const installConfig: number = install.indexOf(
        "sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml",
      );
      expect(installConfig).toBeGreaterThan(-1);
      expect(
        install.indexOf("sudo systemctl restart otelcol-contrib"),
      ).toBeGreaterThan(installConfig);
      expect(install).not.toContain("enable --now");
    },
  );

  test("the tarball unit runs the binary and config it installed", () => {
    const install: string =
      stepTitled(guideFor("linux-tarball"), "Install the collector").markdown ||
      "";
    expect(install).toContain(
      "sudo install -m 0644 config.yaml /opt/otelcol-contrib/config.yaml",
    );
    expect(install).toContain(
      "ExecStart=/opt/otelcol-contrib/otelcol-contrib --config /opt/otelcol-contrib/config.yaml",
    );
    expect(install.indexOf("sudo systemctl daemon-reload")).toBeLessThan(
      install.indexOf("sudo systemctl enable --now otelcol-contrib"),
    );
  });

  test("every Linux install downloads the contrib build for the host's architecture", () => {
    for (const method of NATIVE_LINUX) {
      const install: string =
        stepTitled(guideFor(method), "Install the collector").markdown || "";
      expect(install).toContain(
        "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}",
      );
      // The release the config reports, never whatever is newest that day.
      expect(install).toContain(`VERSION=${HOST_COLLECTOR_VERSION} `);
      expect(install).not.toContain("releases/latest");
    }
  });

  test("the tarball is not offered for distributions without systemd", () => {
    const tarball: string = markdownOf("linux-tarball");
    expect(tarball).not.toContain("Alpine");
    expect(tarball).not.toContain("NixOS");
    expect(
      (guideFor("linux-tarball").prerequisites || []).join("\n"),
    ).toContain("systemd");
  });
});

describe("the systemd receiver", () => {
  const topicOf: (method: HostInstallMethod) => SetupGuideTopic = (
    method: HostInstallMethod,
  ): SetupGuideTopic => {
    const topic: SetupGuideTopic | undefined = topicTitled(
      guideFor(method).advanced,
      "Enable the Systemd Units tab",
    );
    if (!topic) {
      throw new Error(`No systemd topic for ${method}`);
    }
    return topic;
  };

  test.each(NATIVE_LINUX)(
    "%s names the version the tab needs",
    (method: HostInstallMethod) => {
      const topic: SetupGuideTopic = topicOf(method);
      expect(topic.markdown).toContain(
        `**${MIN_OTELCOL_CONTRIB_VERSION} or newer**`,
      );
      expect(topic.markdown).toContain("**v0.142.0**");
    },
  );

  test.each(NATIVE_LINUX)(
    "%s adds the receiver next to hostmetrics and keeps resourcedetection",
    (method: HostInstallMethod) => {
      const fragment: YamlMap = yaml.load(
        codeBlocksOf(topicOf(method).markdown, "yaml")[0]!,
      ) as YamlMap;
      expect(fragment["receivers"]["systemd"]["units"]).toEqual(["*.service"]);
      expect(
        fragment["receivers"]["systemd"]["metrics"]["systemd.service.cpu.time"][
          "enabled"
        ],
      ).toBe(false);
      expect(fragment["service"]["pipelines"]["metrics"]).toEqual({
        receivers: ["hostmetrics", "systemd"],
        processors: ["resourcedetection", "resource", "batch"],
      });
    },
  );

  test("each install is told where its config lives and how to restart", () => {
    expect(topicOf("linux-deb").markdown).toContain(
      "`/etc/otelcol-contrib/config.yaml`",
    );
    expect(topicOf("linux-rpm").markdown).toContain(
      "`/etc/otelcol-contrib/config.yaml`",
    );
    expect(topicOf("linux-tarball").markdown).toContain(
      "`/opt/otelcol-contrib/config.yaml`",
    );
    for (const method of NATIVE_LINUX) {
      expect(topicOf(method).markdown).toContain(
        "sudo systemctl restart otelcol-contrib",
      );
    }
  });

  test("only the packaged installs are said to run as the otelcol-contrib user", () => {
    expect(topicOf("linux-deb").markdown).toContain(
      "which runs as the `otelcol-contrib` user",
    );
    // The tarball's own unit sets User=root.
    expect(topicOf("linux-tarball").markdown).not.toContain(
      "`otelcol-contrib` user",
    );
  });

  test("the volume note matches the docs site's ten datapoints per unit", () => {
    const doc: string = readRepoFile(HOST_DOCS_PAGE);
    expect(doc).toContain("eight datapoints per unit per scrape");
    expect(topicOf("linux-deb").markdown).toContain(
      "eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on",
    );
  });
});

describe("the Windows install", () => {
  const guide: SetupGuideContent = guideFor("windows");
  const install: string =
    stepTitled(guide, "Install and start the collector").markdown || "";
  const script: string = codeBlocksOf(install, "powershell")[0] || "";

  test("downloads the contrib archive, not the core one", () => {
    expect(script).toContain("otelcol-contrib_${version}_windows_amd64.tar.gz");
    expect(script).not.toMatch(/\/otelcol_\$\{?version/);
  });

  test("pins a release that has the windows_service receiver", () => {
    const pinned: RegExpMatchArray | null = script.match(
      /\$version = "(\d+)\.(\d+)\.(\d+)"/,
    );
    expect(pinned).not.toBeNull();
    expect(Number(pinned![1])).toBe(0);
    expect(Number(pinned![2])).toBeGreaterThanOrEqual(155);
    // The docs site names the same floor for the Services tab.
    expect(readRepoFile(HOST_DOCS_PAGE)).toContain("v0.155.0");
  });

  test("registers the service with sc.exe quoting that survives PowerShell", () => {
    /*
     * PowerShell's escape character is the backtick: in a double-quoted
     * PowerShell string, \" ends the string. --% hands the rest of the line
     * to sc.exe verbatim, so the cmd-style quoting reaches it intact — and
     * PowerShell variables are not expanded there, hence literal paths.
     */
    const line: string | undefined = script
      .split("\n")
      .find((candidate: string): boolean => {
        return candidate.startsWith("sc.exe --% create");
      });
    expect(line).toBe(
      `sc.exe --% create "otelcol-contrib" binPath= "\\"${WINDOWS_INSTALL_DIR}\\otelcol-contrib.exe\\" --config=\\"${WINDOWS_INSTALL_DIR}\\config.yaml\\"" start= auto DisplayName= "OpenTelemetry Collector (OneUptime)"`,
    );
    expect(line).not.toContain("$");
    expect(script).toContain(`$dest = "${WINDOWS_INSTALL_DIR}"`);
    expect(script).toContain('sc.exe start "otelcol-contrib"');
  });

  test("copies the saved config next to the binary", () => {
    expect(script).toContain(
      'Copy-Item config.yaml "$dest\\config.yaml" -Force',
    );
  });

  test("the Services tab topic uses the receiver the tab reads", () => {
    const topic: SetupGuideTopic | undefined = topicTitled(
      guide.advanced,
      "Enable the Windows Services tab",
    );
    const fragment: YamlMap = yaml.load(
      codeBlocksOf(topic?.markdown || "", "yaml")[0]!,
    ) as YamlMap;
    expect(
      fragment["receivers"]["windows_service"]["collection_interval"],
    ).toBe("30s");
    expect(fragment["service"]["pipelines"]["metrics"]["receivers"]).toEqual([
      "hostmetrics",
      "windows_service",
    ]);
    expect(topic?.markdown).toContain("Restart-Service otelcol-contrib");
  });

  test("the hardware script reads WMI through CIM and prints the firmware version", () => {
    const topic: SetupGuideTopic | undefined = topicTitled(
      guide.advanced,
      "Record the serial number, make, model and firmware version",
    );
    const hardware: string =
      codeBlocksOf(topic?.markdown || "", "powershell")[0] || "";
    expect(hardware).toContain("Get-CimInstance -ClassName Win32_BIOS");
    expect(hardware).toContain(
      "Get-CimInstance -ClassName Win32_ComputerSystem",
    );
    expect(hardware).toContain("$(Format-YamlValue $bios.SMBIOSBIOSVersion)");
    expect(hardware).not.toMatch(/Get-WmiObject\s+-/);
    expect(topic?.markdown).toMatch(/not the deprecated .{0,2}Get-WmiObject/);
  });

  test("the foreground run in troubleshooting uses the installed paths", () => {
    const trouble: string =
      topicTitled(guide.troubleshooting, "The Windows service does not start")
        ?.markdown || "";
    expect(trouble).toContain(
      `& "${WINDOWS_INSTALL_DIR}\\otelcol-contrib.exe" --config="${WINDOWS_INSTALL_DIR}\\config.yaml"`,
    );
    expect(trouble).toContain('sc.exe qc "otelcol-contrib"');
  });
});

describe("the macOS install", () => {
  const guide: SetupGuideContent = guideFor("macos");
  const install: string =
    stepTitled(guide, "Install and start the collector").markdown || "";
  const plist: string = codeBlocksOf(install, "xml")[0] || "";

  test("installs the contrib release for the Mac's architecture", () => {
    expect(install).toContain(
      "otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz",
    );
    expect(install).toContain("sed 's/x86_64/amd64/'");
    expect(install).toContain(
      "The core `otelcol` build has no `resourcedetection` processor",
    );
  });

  test("does not send anyone to Homebrew", () => {
    expect(getSetupGuideMarkdown(guide)).not.toMatch(/brew/i);
  });

  test("launchd runs the binary and config the install put in place", () => {
    expect(install).toContain(
      "sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib",
    );
    expect(install).toContain(
      "sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml",
    );
    expect(plist).toContain("<string>/usr/local/bin/otelcol-contrib</string>");
    expect(plist).toContain(
      "<string>--config=/etc/otelcol-contrib/config.yaml</string>",
    );
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(install).toContain(
      "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`",
    );
  });

  test("the verify step reads the log file the plist writes", () => {
    const verify: string =
      stepTitled(guide, "Check the host appears").markdown || "";
    expect(plist).toContain(
      "<key>StandardErrorPath</key><string>/var/log/otelcol-contrib.err.log</string>",
    );
    expect(verify).toContain("tail -f /var/log/otelcol-contrib.err.log");
  });

  test("uses the same paths as the docs site's macOS install", () => {
    const doc: string = readRepoFile(HOST_DOCS_PAGE);
    for (const shared of [
      "/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist",
      "/usr/local/bin/otelcol-contrib",
      "--config=/etc/otelcol-contrib/config.yaml",
      "/var/log/otelcol-contrib.err.log",
      "_darwin_${ARCH}.tar.gz",
    ]) {
      expect({ shared, inDocs: doc.includes(shared) }).toEqual({
        shared,
        inDocs: true,
      });
    }
  });

  test("the hardware topic reads the Mac's own identifiers", () => {
    const topic: string =
      topicTitled(
        guide.advanced,
        "Record the serial number, make, model and firmware version",
      )?.markdown || "";
    expect(topic).toContain("IOPlatformSerialNumber");
    expect(topic).toContain("sysctl -n hw.model");
    expect(topic).toContain("System Firmware Version");
    expect(topic).not.toContain("/sys/class/dmi");
  });
});

describe("the Docker install", () => {
  const guide: SetupGuideContent = guideFor("docker");

  test("mounts the saved config and the host filesystem", () => {
    const run: string =
      stepTitled(guide, "Run the collector with Docker").markdown || "";
    expect(run).toContain(
      "-v $(pwd)/config.yaml:/etc/otelcol-contrib/config.yaml:ro",
    );
    expect(run).toContain("--config /etc/otelcol-contrib/config.yaml");
    for (const variable of ["PROC", "SYS", "ETC", "VAR", "RUN", "DEV"]) {
      expect(run).toContain(
        `-e HOST_${variable}=/hostfs/${variable.toLowerCase()}`,
      );
    }
  });

  test("config edits recreate the container instead of restarting it", () => {
    const labels: string =
      topicTitled(guide.advanced, "Tag the host with project labels")
        ?.markdown || "";
    expect(labels).toContain("docker rm -f otel-collector");
    expect(labels).toContain("run the `docker run` command from step 3 again");
  });

  test("reads the hardware values from DMI on the Docker host", () => {
    const topic: string =
      topicTitled(
        guide.advanced,
        "Record the serial number, make, model and firmware version",
      )?.markdown || "";
    expect(topic).toContain("cat /sys/class/dmi/id/product_serial");
    expect(topic).not.toContain("ioreg");
  });
});

/*
 * Kubernetes nodes are filed under their cluster, never in Hosts: ingest
 * refuses to register a host from telemetry with a Kubernetes identity. So
 * the Kubernetes option installs what does show nodes — the OneUptime
 * Kubernetes agent, with the Kubernetes section's own guide for a standard
 * cluster — instead of a collector DaemonSet whose nodes would never appear.
 */
describe("the Kubernetes option", () => {
  const guide: SetupGuideContent = guideFor("kubernetes");
  const markdown: string = getSetupGuideMarkdown(guide);
  const agentGuide: SetupGuideContent = getKubernetesSetupGuide({
    oneuptimeUrl: URL,
    apiKey: KEY,
    platform: "standard",
  });

  test("the option says it installs the Kubernetes agent", () => {
    const option: SetupGuideOption<HostInstallMethod> | undefined =
      HOST_INSTALL_METHODS.find(
        (candidate: SetupGuideOption<HostInstallMethod>): boolean => {
          return candidate.key === "kubernetes";
        },
      );
    expect(option?.description).toContain("Kubernetes agent");
    expect(option?.description).not.toMatch(/DaemonSet/);
  });

  test("says nodes appear under Kubernetes, not in Hosts", () => {
    expect(guide.intro).toContain("**OneUptime Kubernetes agent**");
    expect(guide.intro).toContain("**Nodes**");
    expect(guide.intro).toContain("not in the **Hosts** list");
  });

  test("points to the Kubernetes section for every other platform", () => {
    for (const platform of [
      "Amazon EKS",
      "Google GKE",
      "Azure AKS",
      "GKE Autopilot",
      "EKS Fargate",
    ]) {
      expect(guide.intro).toContain(platform);
    }
  });

  test("installs the agent with the Kubernetes guide's own steps", () => {
    expect(guide.steps).toEqual(agentGuide.steps);
    expect(markdown).toContain(
      `helm install ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent`,
    );
    expect(markdown).toContain(`--set oneuptime.url="${URL}"`);
    expect(markdown).toContain(`--set oneuptime.apiKey="${KEY}"`);
  });

  test("keeps the Kubernetes guide's Advanced, Troubleshooting and links", () => {
    expect(guide.prerequisites).toEqual(agentGuide.prerequisites);
    expect(guide.advanced).toEqual(agentGuide.advanced);
    expect(guide.troubleshooting).toEqual(agentGuide.troubleshooting);
    expect(guide.links).toEqual(agentGuide.links);
  });

  test("no longer deploys a collector DaemonSet that never registers hosts", () => {
    for (const gone of [
      "open-telemetry/opentelemetry-collector",
      "mode: daemonset",
      "Save the collector config",
      "hostname_sources",
    ]) {
      expect(markdown).not.toContain(gone);
    }
  });

  test("step 1 describes the agent's key and shows the base URL", () => {
    expect(guide.keyStep?.description).toContain("Kubernetes agent");
    expect(guide.keyStep?.description).not.toMatch(/[`*[\]]/);
    expect(guide.keyStep?.endpointValue).toBeUndefined();
  });

  test("shows the placeholder until a key is picked", () => {
    const placeholder: string = getSetupGuideMarkdown(
      guideFor("kubernetes", { apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER }),
    );
    expect(placeholder).toContain(
      `--set oneuptime.apiKey="${SETUP_GUIDE_API_KEY_PLACEHOLDER}"`,
    );
    expect(placeholder).toContain("Pick an ingestion key in step 1");
  });
});

describe("before a key is picked", () => {
  test.each(CONFIG_FILE_METHODS)(
    "%s shows the placeholder and says where to pick a key",
    (method: HostCollectorMethod) => {
      const guide: SetupGuideContent = guideFor(method, {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      });
      const markdown: string = getSetupGuideMarkdown(guide);
      expect(markdown).toContain(
        `x-oneuptime-token: ${SETUP_GUIDE_API_KEY_PLACEHOLDER}`,
      );
      expect(markdown).toContain("Pick an ingestion key in step 1");
    },
  );

  test.each(CONFIG_FILE_METHODS)(
    "%s drops the note once a key is picked",
    (method: HostCollectorMethod) => {
      const markdown: string = markdownOf(method);
      expect(markdown).not.toContain("Pick an ingestion key in step 1");
      expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    },
  );

  test("an unknown dashboard host leaves the URL placeholder in the config", () => {
    const guide: SetupGuideContent = guideFor("docker", {
      oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    });
    expect(guide.keyStep?.endpointValue).toBe(
      `${SETUP_GUIDE_URL_PLACEHOLDER}/otlp`,
    );
    expect(getSetupGuideMarkdown(guide)).toContain(
      `endpoint: ${SETUP_GUIDE_URL_PLACEHOLDER}/otlp`,
    );
  });
});

/*
 * What the guide says about how a host is discovered and why a key is
 * refused must be what ingest does. These read the ingest code the claims
 * come from, so changing either side fails here.
 */
describe("the guide's claims match ingest", () => {
  const reported: string =
    topicTitled(guideFor("linux-deb").advanced, "What gets reported")
      ?.markdown || "";
  const ingest: string = squash(
    readRepoFile(
      "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
    ),
  );

  test("a host needs host.name plus os.type, container.runtime or host metrics", () => {
    expect(reported).toContain("carries `host.name` also carries any of");
    expect(reported).toContain(
      "an `os.type` or `container.runtime` resource attribute",
    );
    expect(ingest).toContain(
      'const hostName: string | null = this.getStringAttribute( data.attributes, "host.name", ); if (!hostName) { return null; }',
    );
    expect(ingest).toContain(
      "const hasResourceSignal: boolean = Boolean(osType || containerRuntime); if (!hasResourceSignal && !data.hasInfraSignal) { return null; }",
    );
    expect(ingest).toContain(
      'if (name.startsWith("system.") || name.startsWith("process.")) { result.hasInfraSignal = true; }',
    );
  });

  test("Kubernetes identities never register a host", () => {
    expect(reported).toContain("is filed under its Kubernetes cluster instead");
    expect(ingest).toContain(
      "if (this.hasKubernetesIdentity(data.attributes)) { return null; }",
    );
    const entity: string = squash(
      readRepoFile("packages/Common/Server/Utils/Telemetry/TelemetryEntity.ts"),
    );
    for (const key of ["k8s.cluster.name", "k8s.node.name", "k8s.pod.name"]) {
      expect(reported).toContain(`\`${key}\``);
      expect(entity).toContain(`"${key}",`);
    }
  });

  test("401 is a missing, wrong or expired key and 422 a disabled one", () => {
    expect(ExceptionCode.NotAuthenticatedException).toBe(401);
    expect(ExceptionCode.NotAuthorizedException).toBe(422);

    const middleware: string = squash(
      readRepoFile("packages/Common/Server/Middleware/TelemetryIngest.ts"),
    );
    expect(middleware).toContain(
      'new NotAuthenticatedException( "Missing ingestion token.',
    );
    expect(middleware).toContain(
      'new NotAuthenticatedException( "Invalid ingestion token.',
    );
    expect(middleware).toContain(
      'new NotAuthenticatedException( "This telemetry ingestion key expired.", )',
    );
    expect(middleware).toContain(
      'new NotAuthorizedException( "This telemetry ingestion key has been disabled.", )',
    );

    const trouble: string =
      topicTitled(
        guideFor("docker").troubleshooting,
        "The host does not appear in Hosts",
      )?.markdown || "";
    expect(trouble).toContain(
      "An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled",
    );
  });

  test("the OTLP endpoint the config exports to is one ingest serves", () => {
    const routes: string = readRepoFile(
      "packages/App/FeatureSet/Telemetry/API/OTelIngest.ts",
    );
    // otlphttp appends /v1/metrics to the endpoint it is given.
    expect(routes).toContain('"/otlp/v1/metrics"');
  });
});

/*
 * The guide's "Upgrade the collector" topic: what the sign beside an
 * outdated host agent version opens (the dialog shows the same command,
 * AgentUpgradeGuides.test.ts). The config stamps the release it is for, so
 * the upgrade is the config saved again, then the pinned release installed
 * over the old one.
 */
describe("upgrading the collector", () => {
  test.each(
    HOST_COLLECTOR_METHODS.map((method: string) => {
      return [method];
    }),
  )(
    "%s: the topic saves the config again, then runs the method's own upgrade",
    (method: string) => {
      const topic: SetupGuideTopic | undefined = topicTitled(
        guideFor(method as HostInstallMethod).advanced,
        HOST_COLLECTOR_UPGRADE_TOPIC_TITLE,
      );
      expect(topic).toBeDefined();
      const markdown: string = topic!.markdown;
      const language: string = getHostCollectorCommandLanguage(
        method as HostCollectorMethod,
      );

      expect(codeBlocksOf(markdown, language)).toEqual([
        `${getHostCollectorUpgradeCommand(method as HostCollectorMethod)}\n`,
      ]);
      expect(markdown).toContain("Save the config from step 2 again");
      expect(markdown).toContain("**Agent Version**");
      expect(markdown).toContain("`oneuptime.agent.version`");
      // The config comes before the release that reads it.
      expect(markdown.indexOf("Save the config")).toBeLessThan(
        markdown.indexOf("```"),
      );
    },
  );

  test("it is the last Advanced topic, after the config-editing ones", () => {
    for (const method of HOST_COLLECTOR_METHODS) {
      const titles: Array<string> = topicTitles(
        guideFor(method as HostInstallMethod).advanced,
      );
      expect(titles[titles.length - 1]).toBe(
        HOST_COLLECTOR_UPGRADE_TOPIC_TITLE,
      );
    }
  });

  test("the Kubernetes option, which installs the Kubernetes agent, has no collector upgrade", () => {
    expect(topicTitles(guideFor("kubernetes").advanced)).not.toContain(
      HOST_COLLECTOR_UPGRADE_TOPIC_TITLE,
    );
  });

  test("the hardware fragment's note names every processor the config already has", () => {
    const topic: SetupGuideTopic | undefined = topicTitled(
      guideFor("windows").advanced,
      "Record the serial number, make, model and firmware version",
    );
    expect(topic!.markdown).toContain(
      "alongside `resourcedetection:`, `resource:` and `batch:`",
    );
  });
});
