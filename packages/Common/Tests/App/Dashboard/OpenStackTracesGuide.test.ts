import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  INSTALL_SCRIPTS,
  InstallScriptEntry,
  InstallScriptName,
} from "../../../Types/InstallScripts/InstallScripts";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  OPENSTACK_DEPLOYMENT_TOOLS,
  OpenStackDeploymentTool,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackDeploymentGuides";
import {
  OPENSTACK_PLACEMENT_PATCH,
  OPENSTACK_TRACES_CONNECTION_STRING,
  OPENSTACK_TRACES_INSTALL_FILE,
  getOpenStackTracesGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackTracesGuide";

/*
 * The guide to turning OSProfiler on, for each deployment tool. What has really been run is
 * DevStack, so what matters most is that no tool's guide claims more than that, and that
 * each says the same few things a person would otherwise find out the hard way.
 */

const OPTIONS: {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  cloudName: string;
} = {
  oneuptimeUrl: "https://oneuptime.example.com",
  apiKey: "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11",
  hasApiKey: true,
  cloudName: "prod-east",
};

const TOOLS: Array<OpenStackDeploymentTool> = OPENSTACK_DEPLOYMENT_TOOLS.map(
  (option: SetupGuideOption<OpenStackDeploymentTool>) => {
    return option.key;
  },
);

function guideOf(tool: OpenStackDeploymentTool): SetupGuideContent {
  return getOpenStackTracesGuide({ ...OPTIONS, tool });
}

function textOf(tool: OpenStackDeploymentTool): string {
  return getSetupGuideMarkdown(guideOf(tool));
}

function topicTitled(
  tool: OpenStackDeploymentTool,
  title: string,
): SetupGuideTopic {
  const topic: SetupGuideTopic | undefined = (guideOf(tool).advanced || []).find(
    (candidate: SetupGuideTopic): boolean => {
      return candidate.title === title;
    },
  );

  if (!topic) {
    throw new Error(`No topic ${title} on ${tool}`);
  }

  return topic;
}

function stepTitled(
  tool: OpenStackDeploymentTool,
  title: string,
): SetupGuideStep {
  const step: SetupGuideStep | undefined = guideOf(tool).steps.find(
    (candidate: SetupGuideStep): boolean => {
      return candidate.title === title;
    },
  );

  if (!step) {
    throw new Error(`No step ${title} on ${tool}`);
  }

  return step;
}

describe.each(TOOLS)("the guide for %s", (tool: OpenStackDeploymentTool) => {
  test("it says how far it has been tested, and never that it was run on this tool", () => {
    const intro: string = guideOf(tool).intro || "";

    expect(intro).toContain("How far this guide has been tested");

    if (tool === "not-sure") {
      expect(intro).toContain("run on DevStack");
    } else {
      expect(intro).toContain("has not been followed");
    }
  });

  test("it never holds a real HMAC key, and never asks OneUptime to keep one", () => {
    const text: string = textOf(tool);

    expect(text).toContain("<your key>");
    expect(text).not.toContain("SECRET_KEY =");
    expect(text).not.toMatch(/hmac_keys[:=\s]+[0-9a-f]{16,}/);
  });

  test("it says what the default key is, because leaving it unset is a real mistake", () => {
    expect(stepTitled(tool, "Turn OSProfiler on").markdown).toContain(
      "SECRET_KEY",
    );
  });

  test("it asks for both libraries the driver names", () => {
    const step: SetupGuideStep = stepTitled(
      tool,
      "Give each service the libraries",
    );

    expect(step.markdown).toContain("opentelemetry-sdk");
    expect(step.markdown).toContain("opentelemetry-exporter-otlp");
  });

  test("it keeps SQL tracing off, which is the expensive part", () => {
    const config: string =
      stepTitled(tool, "Turn OSProfiler on").markdown || "";

    expect(config.toLowerCase()).toMatch(/trace_sqlalchemy[:= ]+\s*false/);
    expect(config).not.toMatch(/trace_sqlalchemy[:= ]+\s*true/i);
  });

  test("it names this cloud and this OneUptime", () => {
    const text: string = textOf(tool);

    expect(text).toContain("prod-east");
  });

  test("it ends by sending the person to sign a request", () => {
    const steps: Array<SetupGuideStep> = guideOf(tool).steps;

    expect(steps[steps.length - 1]!.title).toBe("Sign a request");
  });

  test("it is straight about what OSProfiler is, before anything else", () => {
    const intro: string = guideOf(tool).intro || "";

    expect(intro).toContain("signed with your key");
    expect(intro).toContain("never an always-on feed");
    expect(intro).toContain("experimental");
    expect(intro).toContain("plain HTTP");
    expect(intro).toContain("libraries");
  });

  test("it says what a trace shows, and names everything that sends nothing", () => {
    const intro: string = guideOf(tool).intro || "";
    const cannotShow: string = topicTitled(
      tool,
      "What a trace cannot show",
    ).markdown;

    for (const service of [
      "nova-api",
      "nova-compute",
      "neutron-server",
      "keystone",
      "glance-api",
      "cinder-api",
      "cinder-scheduler",
    ]) {
      expect(intro).toContain(service);
    }

    for (const service of [
      "Placement",
      "nova-conductor",
      "nova-scheduler",
      "cinder-volume",
    ]) {
      expect(intro).toContain(service);
      expect(cannotShow).toContain(service);
    }
  });

  test("it gives Placement's one line, and says what it means to keep it", () => {
    const placement: string = topicTitled(tool, "Placement").markdown;

    expect(placement).toContain(OPENSTACK_PLACEMENT_PATCH);
    expect(placement).toContain("placement.wsgi");
  });

  test("it says what one worker each costs, and how, on this tool", () => {
    const oneWorker: string = topicTitled(
      tool,
      "Nova's conductor and scheduler",
    ).markdown;

    expect(oneWorker).toContain("test cloud");
    expect(oneWorker).toContain("capacity");
    expect(oneWorker.toLowerCase()).toContain("workers");
  });

  test("no step's description holds what only Markdown can draw", () => {
    for (const step of guideOf(tool).steps) {
      expect(step.description || "").not.toContain("`");
    }
  });

  test("it says how to tell a service started the driver, in the words the service logs", () => {
    const step: SetupGuideStep = stepTitled(
      tool,
      "Check each service started it",
    );

    expect(step.markdown).toContain(
      "osprofiler is enabled with connection string",
    );
    expect(step.markdown).toContain("Could not initialize driver");
  });

  test("it says what a working trace looks like", () => {
    const sign: string = stepTitled(tool, "Sign a request").markdown || "";

    for (const service of [
      "nova-api",
      "keystone",
      "neutron-server",
      "glance-api",
      "nova-compute",
    ]) {
      expect(sign).toContain(service);
    }
  });

  test("it gives no figure for what tracing slows a cloud by", () => {
    const costs: string = topicTitled(tool, "What it costs").markdown;

    expect(costs).toContain("no overhead figure");
    expect(costs).not.toMatch(/\d+\s?%/);
  });

  test("it says what it costs, what a span holds, and what goes wrong", () => {
    const content: SetupGuideContent = guideOf(tool);
    const advanced: Array<string> = (content.advanced || []).map(
      (topic: SetupGuideTopic): string => {
        return topic.title;
      },
    );
    const troubleshooting: Array<string> = (content.troubleshooting || []).map(
      (topic: SetupGuideTopic): string => {
        return topic.title;
      },
    );

    expect(advanced).toContain("What it costs");
    expect(advanced).toContain("What a span can hold");
    expect(troubleshooting).toContain("The client prints no Trace ID");
    expect(troubleshooting).toContain(
      "It prints a Trace ID, and no trace arrives",
    );
  });
});

describe("what is true of each tool", () => {
  test("Kolla-Ansible: global.conf, and not its own switch, which turns on SQL tracing", () => {
    const config: string =
      stepTitled("kolla-ansible", "Turn OSProfiler on").markdown || "";

    expect(config).toContain("/etc/kolla/config/global.conf");
    expect(config).toContain("Leave `enable_osprofiler` off");
    expect(config).toContain("kolla-ansible reconfigure");
    expect(
      stepTitled("kolla-ansible", "Give each service the libraries").markdown,
    ).toContain("template-override");
  });

  test("OpenStack-Ansible: each role's overrides, without Docker, and a container's own loopback", () => {
    const config: string =
      stepTitled("openstack-ansible", "Turn OSProfiler on").markdown || "";

    expect(config).toContain("nova_nova_conf_overrides");
    expect(config).toContain("neutron_neutron_conf_overrides");
    expect(config).toContain("br-mgmt");
    // Only with the line it needs, which its own topic gives.
    expect(config).not.toContain("placement_placement_conf_overrides");
    expect(topicTitled("openstack-ansible", "Placement").markdown).toContain(
      "placement_placement_conf_overrides",
    );

    const collector: SetupGuideStep = stepTitled(
      "openstack-ansible",
      "Run the collector on each machine",
    );

    expect(collector.markdown).toContain("install-traces.sh native");
    expect(collector.note).toContain("OPENSTACK_TRACES_LISTEN_ADDRESS");
    expect(
      stepTitled("openstack-ansible", "Give each service the libraries")
        .markdown,
    ).toContain("no such variable");
  });

  test.each(["openstack-helm", "atmosphere", "rhoso", "mosk"] as const)(
    "%s: a pod's loopback is its own, so a collector in the cluster",
    (tool: OpenStackDeploymentTool) => {
      const collector: SetupGuideStep = stepTitled(
        tool,
        "Run a collector in the cluster",
      );

      expect(collector.markdown).toContain("otel-collector-traces.yaml");
      expect(collector.markdown).toContain(
        "OPENSTACK_TRACES_LISTEN_ADDRESS=0.0.0.0:4318",
      );
      expect(stepTitled(tool, "Turn OSProfiler on").markdown).toContain(
        ".svc.cluster.local:4318",
      );
      expect(stepTitled(tool, "Turn OSProfiler on").markdown).not.toContain(
        OPENSTACK_TRACES_CONNECTION_STRING,
      );
    },
  );

  test("Sunbeam says first that we found no way, and that the steps are not a promise", () => {
    expect(guideOf("sunbeam").intro).toContain("found no way");
  });

  test("a tool that lets a span cross a network says so", () => {
    for (const tool of ["openstack-helm", "atmosphere", "rhoso"] as const) {
      expect(stepTitled(tool, "Run a collector in the cluster").note).toContain(
        "plain HTTP",
      );
    }
    expect(
      stepTitled("openstack-ansible", "Run the collector on each machine").note,
    ).toContain("plain HTTP");
  });
});

describe("the one line Placement needs", () => {
  test("is exactly what the rig applied to a real Placement before a span of its arrived", () => {
    const script: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../../Tests/Ops/openstack-e2e/traces-record.sh",
      ),
      "utf8",
    );

    expect(script).toContain(`sudo ${OPENSTACK_PLACEMENT_PATCH} `);
  });

  test("adds the group the driver reads, and nothing else", () => {
    expect(OPENSTACK_PLACEMENT_PATCH).toContain(
      'config.register_opts(profiler._OTLP_OPTS, group="profiler_otlp")',
    );
  });
});

describe("the collector's command", () => {
  test("with a key picked, it holds the key", () => {
    expect(
      stepTitled("kolla-ansible", "Run the collector on each machine").markdown,
    ).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY=${OPTIONS.apiKey}`);
  });

  test("with none, it asks when it runs, rather than writing a placeholder into a cloud", () => {
    const content: SetupGuideContent = getOpenStackTracesGuide({
      ...OPTIONS,
      apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      hasApiKey: false,
      tool: "kolla-ansible",
    });

    expect(getSetupGuideMarkdown(content)).not.toContain(
      "ONEUPTIME_TELEMETRY_INGESTION_KEY=",
    );
  });

  test("a cloud's name a shell would read differently is quoted", () => {
    const content: SetupGuideContent = getOpenStackTracesGuide({
      ...OPTIONS,
      cloudName: "prod east",
      tool: "kolla-ansible",
    });

    expect(getSetupGuideMarkdown(content)).toContain(
      "OPENSTACK_CLOUD_NAME='prod east'",
    );
  });

  test("everything it downloads is served, for the release the reader runs", () => {
    const entry: InstallScriptEntry | undefined = INSTALL_SCRIPTS.find(
      (script: InstallScriptEntry): boolean => {
        return script.name === InstallScriptName.OpenStackAgent;
      },
    );

    expect(entry?.files).toContain(OPENSTACK_TRACES_INSTALL_FILE);
    expect(entry?.files).toContain("otel-collector-traces.yaml");
  });

  test("the file it names is the one in the agent's folder", () => {
    expect(
      fs.existsSync(
        path.join(
          __dirname,
          "../../../../../agents/OpenStackAgent",
          OPENSTACK_TRACES_INSTALL_FILE,
        ),
      ),
    ).toBe(true);
  });
});
