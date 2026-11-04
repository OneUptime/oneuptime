import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  InstallScriptEntry,
  InstallScriptName,
  getInstallFileUrl,
  getInstallScriptEntry,
} from "Common/Types/InstallScripts/InstallScripts";
import { getOpenStackSetupGuide } from "../../FeatureSet/Dashboard/src/Pages/OpenStack/Utils/DocumentationMarkdown";
import {
  DEFAULT_OPENSTACK_DEPLOYMENT_TOOL,
  OPENSTACK_CONTROL_PLANE_TARGETS_SCRIPT,
  OPENSTACK_DEPLOYMENT_TOOLS,
  OPENSTACK_EXPORTER_170_LOSSES,
  OPENSTACK_KOLLA_EXPORTERS,
  OPENSTACK_KOLLA_EXPORTER_PORT,
  OPENSTACK_LOGS_INSTALLER,
  OpenStackDeploymentGuide,
  OpenStackDeploymentTool,
  OpenStackKollaExporter,
  doesOpenStackToolUseAgent,
  getOpenStackDeploymentGuide,
  resolveOpenStackDeploymentTool,
} from "../../FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackDeploymentGuides";
import {
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";

/*
 * ONE QUESTION, AND EACH ANSWER TRUE FOR THAT TOOL.
 *
 * A path a tool does not have is the worst thing a guide can say: it reads as authority and
 * fails on someone's production cloud. Each was read from the tool's own source (the guide's
 * comments say where) and is pinned here, so a change has to be made on purpose, and the
 * docs, the agent's files and the guide are held to each other. This is what can be proved
 * without those deployments. What cannot is said on screen, and pinned too.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "OpenStackAgent");
const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const DOCS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Docs",
);

const URL: string = "https://oneuptime.com";
const KEY: string = "tik_secret_123";
const CLOUD: string = "prod-eu";
const NOW: Date = new Date("2026-11-04T00:00:00.000Z");

function agentFile(...parts: Array<string>): string {
  return fs.readFileSync(path.join(AGENT_DIR, ...parts), "utf8");
}

const DOCS_PAGE: string = fs.readFileSync(
  path.join(DOCS_DIR, "Content", "en", "telemetry", "openstack-deployment-tools.md"),
  "utf8",
);

const NAMED_TOOLS: Array<OpenStackDeploymentTool> =
  OPENSTACK_DEPLOYMENT_TOOLS.map(
    (option: SetupGuideOption<OpenStackDeploymentTool>) => {
      return option.key;
    },
  ).filter((tool: OpenStackDeploymentTool): boolean => {
    return tool !== "not-sure";
  });

const WITH_ALERTMANAGER: Array<OpenStackDeploymentTool> = [
  "kolla-ansible",
  "openstack-helm",
  "atmosphere",
  "sunbeam",
  "rhoso",
  "mosk",
];

function guideOf(tool: OpenStackDeploymentTool): OpenStackDeploymentGuide {
  return getOpenStackDeploymentGuide({
    tool,
    context: { oneuptimeUrl: URL, apiKey: KEY, cloudName: CLOUD },
  });
}

function setupGuideOf(
  tool: OpenStackDeploymentTool | undefined,
  method: "install-script" | "docker-compose" = "install-script",
): SetupGuideContent {
  return getOpenStackSetupGuide({
    oneuptimeUrl: URL,
    apiKey: KEY,
    hasApiKey: true,
    method,
    cloudName: CLOUD,
    now: NOW,
    tool,
  });
}

function blocksIn(markdown: string | undefined): Array<string> {
  return Array.from((markdown || "").matchAll(/```[^\n]*\n([\s\S]*?)```/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
}

// Everything a tool's own guide says, with no general step around it.
function ownMarkdownOf(tool: OpenStackDeploymentTool): string {
  const guide: OpenStackDeploymentGuide = guideOf(tool);

  return [
    ...[...guide.firstSteps, ...guide.lastSteps].map(
      (step: SetupGuideStep): string => {
        return step.markdown || "";
      },
    ),
    ...guide.credentialVariants.map((variant: { markdown: string }): string => {
      return variant.markdown;
    }),
    ...guide.topics.map((topic: SetupGuideTopic): string => {
      return topic.markdown;
    }),
  ].join("\n\n");
}

// Docs are prose: a table's cell and a code block read the same with spaces squashed.
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("How do you deploy OpenStack?", () => {
  test("asks about each tool, and opens on the general steps", () => {
    expect(
      OPENSTACK_DEPLOYMENT_TOOLS.map(
        (option: SetupGuideOption<OpenStackDeploymentTool>) => {
          return option.key;
        },
      ),
    ).toEqual([
      "kolla-ansible",
      "openstack-ansible",
      "openstack-helm",
      "atmosphere",
      "sunbeam",
      "rhoso",
      "mosk",
      "not-sure",
    ]);
    expect(DEFAULT_OPENSTACK_DEPLOYMENT_TOOL).toBe("not-sure");

    for (const option of OPENSTACK_DEPLOYMENT_TOOLS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description?.length).toBeGreaterThan(0);
      expect(resolveOpenStackDeploymentTool(option.key)).toBe(option.key);
    }
  });

  test("an answer it does not know is the general steps", () => {
    expect(resolveOpenStackDeploymentTool("devstack")).toBe("not-sure");
    expect(resolveOpenStackDeploymentTool(undefined)).toBe("not-sure");
    expect(resolveOpenStackDeploymentTool(null)).toBe("not-sure");
  });

  test("the card asks it, and gives the guide the answer", () => {
    const card: string = squash(
      fs.readFileSync(
        path.join(DASHBOARD_SRC, "Components", "OpenStack", "DocumentationCard.tsx"),
        "utf8",
      ),
    );

    expect(card).toContain('optionsLabel="How do you deploy OpenStack?"');
    expect(card).toContain("options={OPENSTACK_DEPLOYMENT_TOOLS}");
    expect(card).toContain("initialOption={DEFAULT_OPENSTACK_DEPLOYMENT_TOOL}");
    expect(card).toContain("tool: resolveOpenStackDeploymentTool(context.option)");
    // The install question is only asked where there is an agent to install.
    expect(card).toContain("doesOpenStackToolUseAgent(tool) ?");
  });

  test("not sure is what the guide says with no answer at all", () => {
    expect(setupGuideOf("not-sure")).toEqual(setupGuideOf(undefined));
    expect(setupGuideOf("not-sure").intro).toBeUndefined();
    expect(setupGuideOf("not-sure").steps[0]!.title).toBe(
      "Create the agent's credential",
    );
  });

  test("no install question on a tool a probe reads, and no agent in its steps", () => {
    expect(
      NAMED_TOOLS.filter((tool: OpenStackDeploymentTool): boolean => {
        return !doesOpenStackToolUseAgent(tool);
      }),
    ).toEqual(["openstack-helm", "atmosphere", "rhoso", "mosk"]);

    for (const tool of ["openstack-helm", "atmosphere", "rhoso", "mosk"] as const) {
      const content: SetupGuideContent = setupGuideOf(tool);

      expect(content.prerequisites).toBeUndefined();
      expect(content.troubleshooting).toBeUndefined();
      for (const block of getSetupGuideCodeBlocks(content)) {
        expect(block).not.toContain("install.sh");
        expect(block).not.toContain("docker compose");
      }
      expect(getSetupGuideMarkdown(content)).toContain("**Connect Cloud**");
      expect(getSetupGuideMarkdown(content)).toContain("only speaks HTTPS");
    }
  });

  test("a tool the agent reads keeps the agent's own steps, whichever way it installs", () => {
    for (const tool of ["kolla-ansible", "openstack-ansible", "sunbeam"] as const) {
      for (const method of ["install-script", "docker-compose"] as const) {
        const titles: Array<string> = setupGuideOf(tool, method).steps.map(
          (step: SetupGuideStep): string => {
            return step.title;
          },
        );

        expect(titles).toContain("Create the agent's credential");
        expect(titles).toContain("Install the agent");
      }
    }
  });
});

describe("each guide says plainly how far it has been tested", () => {
  test.each(NAMED_TOOLS)("%s, on screen, and never claims more", (tool) => {
    const intro: string = setupGuideOf(tool).intro as string;

    expect(intro).toContain("How far this guide has been tested:");
    expect(intro).toContain("not been followed end to end");
    expect(intro.toLowerCase()).not.toMatch(
      /\b(fully|thoroughly|completely) tested\b|\bverified on\b|\bproduction[- ]ready\b/,
    );
  });

  test("the docs say so too, and first, for every tool", () => {
    const heading: number = DOCS_PAGE.indexOf(
      "## How far each guide has been tested",
    );

    expect(heading).toBeGreaterThan(-1);
    expect(DOCS_PAGE.indexOf("## Kolla-Ansible")).toBeGreaterThan(heading);
    expect(DOCS_PAGE).toContain(
      "no guide here has been followed end to end on a real deployment of its tool",
    );

    for (const option of OPENSTACK_DEPLOYMENT_TOOLS) {
      if (option.key !== "not-sure") {
        expect(DOCS_PAGE).toContain(`| ${option.label} |`);
        expect(DOCS_PAGE).toContain(`## ${option.label}`);
      }
    }
  });

  test("what was never run on a tool is said to be so", () => {
    expect(guideOf("sunbeam").howFarTested).toContain(
      "Nothing here has been run on Sunbeam",
    );
    expect(guideOf("sunbeam").howFarTested).toContain(
      "own docs do not mention the exporter charm",
    );
    expect(guideOf("mosk").howFarTested).toContain(
      "whose examples show other receivers rather than a webhook",
    );
    expect(DOCS_PAGE).toContain("Nothing on Sunbeam.");
    expect(DOCS_PAGE).toContain("Nothing on MOSK");
  });
});

describe("what is already firing, with no agent", () => {
  /*
   * Where each tool's Alertmanager reads its receivers from, so what a guide shows parses as
   * that tool reads it, and really holds the receiver: indentation is the whole risk here.
   */
  function receiversOf(
    tool: OpenStackDeploymentTool,
    config: any,
  ): Array<any> {
    switch (tool) {
      case "openstack-helm":
        return (yaml.load(config.conf.alertmanager) as any).receivers;
      case "atmosphere":
        return config.kube_prometheus_stack_helm_values.alertmanager.config
          .receivers;
      case "rhoso":
        return config.spec.receivers;
      case "mosk":
        return config.alertmanagerSimpleConfig.genericReceivers;
      default:
        return config.receivers;
    }
  }

  test.each(WITH_ALERTMANAGER)("%s gets a first step for it", (tool) => {
    const first: SetupGuideStep = setupGuideOf(tool).steps[0]!;

    expect(first.title).toBe("Forward what is already firing");
    // An Incoming Request monitor's own settings name no cloud: this is what does.
    expect(first.markdown).toContain("**Overview → Linked Resources**");
    expect(first.markdown).toContain(`\`${CLOUD}\``);
    expect(first.markdown).toContain("Incoming Request monitor");
    expect(first.markdown).toContain(
      "/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor",
    );
  });

  test.each(WITH_ALERTMANAGER)(
    "%s shows a receiver that parses as it reads it, and posts to the monitor's URL",
    (tool) => {
      const first: SetupGuideStep = setupGuideOf(tool).steps[0]!;
      const config: unknown = yaml.load(blocksIn(first.markdown)[0] as string);
      const receivers: Array<any> = receiversOf(tool, config);

      expect(receivers).toHaveLength(1);
      expect(receivers[0].name).toBe("oneuptime");

      // The operator's CRD spells them its own way.
      const webhook: any =
        tool === "rhoso"
          ? receivers[0].webhookConfigs[0]
          : receivers[0].webhook_configs[0];

      expect(webhook.url).toBe(`${URL}/heartbeat/<secret key>`);
      expect(tool === "rhoso" ? webhook.sendResolved : webhook.send_resolved).toBe(
        true,
      );
    },
  );

  test("the URL is the one the Alertmanager page tells a person to copy", () => {
    const page: string = fs.readFileSync(
      path.join(DOCS_DIR, "Content", "en", "integrations", "prometheus-alertmanager.md"),
      "utf8",
    );

    expect(page).toContain("https://oneuptime.com/heartbeat/<secret key>");
    expect(page).toContain("## On an OpenStack cloud");
    expect(page).toContain("**Overview → Linked Resources**");
    expect(page).toContain("/docs/telemetry/openstack-deployment-tools");
  });

  test("Kolla-Ansible's replaces its whole file, so it keeps what its own template sets", () => {
    const config: any = yaml.load(
      blocksIn(setupGuideOf("kolla-ansible").steps[0]!.markdown)[0] as string,
    );

    /*
     * Its file is read in place of Kolla-Ansible's, so what that template sets has to
     * survive (ansible/roles/prometheus/templates/prometheus-alertmanager.yml.j2).
     */
    expect(config.global.resolve_timeout).toBe("5m");
    expect(config.route).toMatchObject({
      group_wait: "10s",
      group_interval: "5m",
      repeat_interval: "3h",
    });
    expect(config.templates).toEqual(["/etc/prometheus/*.tmpl"]);
  });

  test("OpenStack-Ansible runs no Alertmanager, so it is not offered one", () => {
    expect(guideOf("openstack-ansible").firstSteps).toEqual([]);
    expect(ownMarkdownOf("openstack-ansible")).not.toContain("webhook");
  });

  test("Kolla-Ansible's says it ships no rules, because nothing fires until there are some", () => {
    expect(setupGuideOf("kolla-ansible").steps[0]!.description).toContain(
      "Kolla-Ansible ships none",
    );
    expect(setupGuideOf("kolla-ansible").steps[0]!.description).toContain(
      "/etc/kolla/config/prometheus/*.rules",
    );
  });
});

describe("the paths and commands each tool's own source has", () => {
  test.each([
    [
      "kolla-ansible",
      [
        "/etc/kolla/config/prometheus/prometheus-alertmanager.yml",
        "kolla-ansible reconfigure -i <inventory> --tags prometheus",
        "/etc/kolla/prometheus-server/prometheus.yml",
        "/etc/kolla/config/fluentd/output/*.conf",
        "sudo bash install-logs.sh files",
      ],
    ],
    [
      "openstack-ansible",
      [
        "/etc/openstack_deploy/user_variables.yml",
        "rabbitmq_management,rabbitmq_prometheus",
        "openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config",
        "haproxy_stats_prometheus_enabled: true",
        "haproxy_stats_bind_address",
        "haproxy_stats_ssl: false",
        "openstack-ansible openstack.osa.haproxy",
        "/var/log/journal/",
        "sudo bash install-logs.sh journald",
      ],
    ],
    ["openstack-helm", ["conf:\n  alertmanager: |"]],
    [
      "atmosphere",
      ["kube_prometheus_stack_helm_values:\n  alertmanager:\n    config:"],
    ],
    [
      "sunbeam",
      [
        "juju config --model observability alertmanager config_file=@alertmanager.yaml",
        "juju status openstack-exporter",
        "OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180",
      ],
    ],
    [
      "rhoso",
      [
        "apiVersion: monitoring.rhobs/v1alpha1",
        "kind: AlertmanagerConfig",
        "service: metricStorage",
        "OPENSTACK_CEILOMETER_EXPORTER_TARGETS",
        "preset=openshift",
      ],
    ],
    [
      "mosk",
      [
        "alertmanagerSimpleConfig:",
        "genericReceivers:",
        "genericRoutes:",
        'severity=~"warning|critical"',
      ],
    ],
  ] as Array<[OpenStackDeploymentTool, Array<string>]>)(
    "%s",
    (tool: OpenStackDeploymentTool, pinned: Array<string>) => {
      const text: string = ownMarkdownOf(tool);

      for (const words of pinned) {
        expect(text).toContain(words);
      }
    },
  );

  test("each credential's notes are that tool's", () => {
    const kolla: string = guideOf("kolla-ansible").credentialNotes.join("\n");

    expect(kolla).toContain("source /etc/kolla/admin-openrc.sh");
    expect(kolla).toContain("kolla-ansible post-deploy");
    expect(kolla).toContain("/etc/kolla/config/nova/policy.yaml");
    expect(kolla).toContain(
      "kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement",
    );

    const osa: string = guideOf("openstack-ansible").credentialNotes.join("\n");

    expect(osa).toContain("lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)");
    expect(osa).toContain(". ~/openrc");
    expect(osa).toContain("nova_policy_overrides");
    expect(osa).toContain(
      "openstack-ansible openstack.osa.nova --tags nova-policy-override",
    );
  });

  test("OpenStack-Ansible's Cinder says volumev3, and the access rules do carry it", () => {
    expect(guideOf("openstack-ansible").credentialNotes.join("\n")).toContain(
      "`volumev3`",
    );
    expect(
      agentFile("access", "application-credential-access-rules.json"),
    ).toContain('"service": "volumev3"');
  });

  test("every file a guide downloads is one OneUptime serves", () => {
    const entry: InstallScriptEntry | undefined = getInstallScriptEntry(
      InstallScriptName.OpenStackAgent,
    );

    for (const file of [
      OPENSTACK_CONTROL_PLANE_TARGETS_SCRIPT,
      OPENSTACK_LOGS_INSTALLER,
    ]) {
      expect(entry!.files).toContain(file);
      expect(fs.existsSync(path.join(AGENT_DIR, file))).toBe(true);
    }

    expect(ownMarkdownOf("kolla-ansible")).toContain(
      getInstallFileUrl(
        URL,
        InstallScriptName.OpenStackAgent,
        OPENSTACK_CONTROL_PLANE_TARGETS_SCRIPT,
      ),
    );
  });

  test.each(NAMED_TOOLS)(
    "%s only names settings the agent really reads",
    (tool) => {
      const compose: string = agentFile("docker-compose.yml");

      for (const match of ownMarkdownOf(tool).matchAll(
        /\b(OPENSTACK_[A-Z_]+)\b/g,
      )) {
        expect(compose).toContain(`\${${match[1]}`);
      }
    },
  );
});

describe("reading the exporters Kolla-Ansible already runs", () => {
  test("its ports, its job names and the agent's settings are one table", () => {
    /*
     * Kolla-Ansible's ports (ansible/group_vars/all/prometheus.yml and rabbitmq.yml) and job
     * names (ansible/roles/prometheus/templates/prometheus.yml.j2).
     */
    expect(OPENSTACK_KOLLA_EXPORTERS).toEqual([
      expect.objectContaining({
        job: "rabbitmq",
        port: 15692,
        variable: "OPENSTACK_RABBITMQ_TARGETS",
      }),
      expect.objectContaining({
        job: "mysqld",
        port: 9104,
        variable: "OPENSTACK_MARIADB_TARGETS",
      }),
      expect.objectContaining({
        job: "memcached",
        port: 9150,
        variable: "OPENSTACK_MEMCACHED_TARGETS",
      }),
      expect.objectContaining({
        job: "haproxy",
        port: 9101,
        variable: "OPENSTACK_HAPROXY_TARGETS",
      }),
      expect.objectContaining({
        job: "network_exporter",
        port: 1981,
        variable: "OPENSTACK_NETWORK_EXPORTER_TARGETS",
      }),
      expect.objectContaining({
        job: "libvirt_exporter",
        port: 9177,
        variable: "OPENSTACK_LIBVIRT_HEALTH_TARGETS",
      }),
    ]);
    expect(OPENSTACK_KOLLA_EXPORTER_PORT).toBe(9198);
  });

  test("the helper reads the same jobs into the same settings", () => {
    const helper: string = agentFile(OPENSTACK_CONTROL_PLANE_TARGETS_SCRIPT);

    for (const exporter of OPENSTACK_KOLLA_EXPORTERS) {
      expect(helper).toContain(`"${exporter.job}": "${exporter.variable}"`);
    }
  });

  test("the collector reads each setting, with nothing named by default", () => {
    const collector: string = agentFile("otel-collector-config.yaml");
    const compose: string = agentFile("docker-compose.yml");
    const native: string = agentFile(
      "systemd",
      "oneuptime-openstack-agent-native.service",
    );

    for (const exporter of OPENSTACK_KOLLA_EXPORTERS) {
      expect(collector).toContain(`\${env:${exporter.variable}}`);
      expect(compose).toContain(`\${${exporter.variable}:-[]}`);
      expect(native).toContain(`${exporter.variable}=[]`);
    }
  });

  test("the guide and the docs list every one, with its port and setting", () => {
    const guide: string = ownMarkdownOf("kolla-ansible");

    for (const exporter of OPENSTACK_KOLLA_EXPORTERS) {
      for (const text of [guide, DOCS_PAGE]) {
        expect(text).toContain(
          `| ${exporter.what} | \`${exporter.port}\` | \`${exporter.variable}\` |`,
        );
      }
    }
  });

  test("says when an exporter is not there, rather than leaving it to look healthy", () => {
    const guide: string = ownMarkdownOf("kolla-ansible");

    expect(guide).toContain("Before 2026.1");
    expect(guide).toContain("[prometheus-openstack-network-exporter:children]");
    expect(guide).toContain("read as not watched");
  });
});

describe("Kolla-Ansible's own exporter, and what the pages lose on it", () => {
  const OTHER_TEXTS: ReadonlyArray<[string, string]> = [
    ["the docs", DOCS_PAGE],
    ["the README", agentFile("README.md")],
  ];

  test("is one of the ways to read the APIs, on the credential step", () => {
    const step: SetupGuideStep = setupGuideOf("kolla-ansible").steps.find(
      (candidate: SetupGuideStep): boolean => {
        return candidate.title === "Create the agent's credential";
      },
    )!;
    const labels: Array<string> = (step.variants || []).map(
      (variant: { label: string }): string => {
        return variant.label;
      },
    );

    expect(labels).toEqual([
      "Full view",
      "Infrastructure only",
      "Project view",
      "Kolla's exporter",
    ]);
  });

  test("the guide's words for it name its setting, its port and its cost", () => {
    const variant: string = guideOf("kolla-ansible").credentialVariants[0]!
      .markdown;

    expect(variant).toContain(
      `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:${OPENSTACK_KOLLA_EXPORTER_PORT}`,
    );
    expect(variant).toContain("without `--multi-cloud`");
    expect(variant).toContain("every 2 minutes");
    expect(variant).toContain(OPENSTACK_EXPORTER_170_LOSSES);
  });

  test.each(OTHER_TEXTS)("%s has the same table, word for word", (_name, text) => {
    expect(squash(text)).toContain(squash(OPENSTACK_EXPORTER_170_LOSSES));
  });
});

describe("the docs page is the guide, written down", () => {
  /*
   * Everything a person can copy from a tool's guide is on the page as it stands, so a
   * command changed in one fails here until the other follows.
   */
  test.each(NAMED_TOOLS)("every block %s shows", (tool) => {
    const page: string = squash(DOCS_PAGE);
    const blocks: Array<string> = blocksIn(ownMarkdownOf(tool));

    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      // A first line naming the file is the block's title on the page.
      expect(page).toContain(squash(block.replace(/^# [^\n]*\n/, "")));
    }
  });

  test("it is in the docs' navigation, in English", () => {
    const nav: string = fs.readFileSync(
      path.join(DOCS_DIR, "Utils", "Nav.ts"),
      "utf8",
    );
    const locale: string = fs.readFileSync(
      path.join(DOCS_DIR, "Locales", "en.json"),
      "utf8",
    );

    expect(nav).toContain('url: "/docs/telemetry/openstack-deployment-tools"');
    expect(locale).toContain(
      '"OpenStack by Deployment Tool": "OpenStack by Deployment Tool"',
    );
  });

  test("the agent's page and the Alertmanager page lead to it", () => {
    const agentPage: string = fs.readFileSync(
      path.join(DOCS_DIR, "Content", "en", "telemetry", "openstack.md"),
      "utf8",
    );

    expect(agentPage).toContain("/docs/telemetry/openstack-deployment-tools");
    expect(agentPage).toContain(
      "/docs/telemetry/openstack-deployment-tools#use-the-exporter-you-already-run",
    );
    expect(DOCS_PAGE).toContain("## Use the exporter you already run");
  });

  test.each([
    "OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS",
    "OPENSTACK_RABBITMQ_TARGETS",
    "OPENSTACK_MARIADB_TARGETS",
    "OPENSTACK_MEMCACHED_TARGETS",
    "OPENSTACK_HAPROXY_TARGETS",
    "OPENSTACK_NETWORK_EXPORTER_TARGETS",
    "OPENSTACK_LIBVIRT_HEALTH_TARGETS",
    "OPENSTACK_CONTROL_PLANE_REGION",
  ])("the agent's page and README document %s", (variable: string) => {
    const agentPage: string = fs.readFileSync(
      path.join(DOCS_DIR, "Content", "en", "telemetry", "openstack.md"),
      "utf8",
    );

    expect(agentPage).toContain(`| \`${variable}\` |`);
    expect(agentFile("README.md")).toContain(`\`${variable}\``);
  });
});
