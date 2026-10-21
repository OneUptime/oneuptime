import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  CLOUD_PLATFORM_OPTIONS,
  DEFAULT_CLOUD_DOC_PLATFORM,
  getCloudSetupGuide,
  resolveCloudPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudSetupGuide";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideOptionGroup,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
  groupSetupGuideOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
  buildCloudEnvironmentName,
} from "../../../Types/Cloud/CloudPlatform";
import { CLOUD_INSTANCE_IDENTITY_ATTRIBUTES } from "../../../Utils/Telemetry/CloudInstanceIdentity";

/*
 * The managed cloud guide asks where the app runs, then shows only that
 * platform's steps. These tests pin, for every platform in the registry:
 *
 *   - the picker is the registry, grouped by provider, opening on ECS for
 *     anything it does not know;
 *   - the token goes into the platform's secret store first, as the bare
 *     token for a collector and as the whole header for an SDK;
 *   - the reader's endpoint and key reach every command, and a placeholder
 *     never reaches a shell unquoted;
 *   - the sidecar and SDK-direct tabs exist exactly where the platform has
 *     both shapes, and each platform shows only its own instructions;
 *   - every collector configuration is valid YAML that only uses what it
 *     defines, and every detector switch, hand-set attribute and console
 *     path matches the platform's docs page;
 *   - the Instances line agrees with the order ingest reads identities in.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DOCS_CONTENT: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en",
);

const ONEUPTIME_URL: string = "https://oneuptime.example.com";
const ONEUPTIME_HOST: string = "oneuptime.example.com";
const KEY: string = "tik_secret_123";
const CLOUD_TROUBLESHOOTING_URL: string =
  "/docs/telemetry/cloud-troubleshooting";

const SIDECAR: string = "Sidecar collector";
const SDK: string = "SDK direct";
const VERIFY: string = "Verify the connection";

const PICK_KEY_NOTE: string = `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`;

// The example account and region each provider's guide uses.
const EXAMPLE_REGIONS: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: "us-east-1",
  [CloudProvider.GCP]: "us-central1",
  [CloudProvider.Azure]: "eastus",
};

const EXAMPLE_ACCOUNTS: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: "123456789012",
  [CloudProvider.GCP]: "my-project",
  [CloudProvider.Azure]: "00000000-0000-0000-0000-000000000000",
};

// Markdown a plain-text summary or description must not carry.
const MARKDOWN_CHARACTERS: RegExp = /[`*[\]]/;

interface PlatformExpectation {
  steps: Array<string>;
  // Tab labels, in order, of every step that has tabs; empty for none.
  shapes: Array<string>;
  // The command or setting that stores the token, on the first step.
  secretStore: string;
  // Text only this platform's guide may contain.
  exclusive: Array<string>;
  advanced: Array<string>;
  troubleshooting: Array<string>;
}

const EXPECTED: Readonly<Record<ManagedCloudPlatform, PlatformExpectation>> = {
  [ManagedCloudPlatform.AwsEcs]: {
    steps: [
      "Store the token in Secrets Manager",
      "Update the task definition",
      VERIFY,
    ],
    shapes: [SIDECAR, SDK],
    secretStore: "aws secretsmanager create-secret",
    exclusive: [
      "awsecscontainermetrics",
      "detectors: [env, ecs]",
      "assignPublicIp=ENABLED",
      "Amazon Elastic Container Service",
      "aws.ecs.task.arn",
    ],
    advanced: [
      "Networking and permissions",
      "How the environment is identified",
      "What the environment shows",
    ],
    troubleshooting: [
      'Task stuck in PENDING with "unable to pull secrets"',
      "Exports are refused with 401",
      "CPU and Memory tiles stay empty",
      "The environment does not appear",
    ],
  },
  [ManagedCloudPlatform.AwsElasticBeanstalk]: {
    steps: [
      "Store the token in Secrets Manager",
      "Set the environment properties",
      "Run a collector on each instance",
      VERIFY,
    ],
    shapes: [],
    secretStore: "aws secretsmanager create-secret",
    exclusive: [
      "detectors: [env, elastic_beanstalk, ec2]",
      ".platform/hooks/postdeploy/",
      "Elastic Beanstalk",
      "/var/elasticbeanstalk/xray/environment.conf",
    ],
    advanced: [
      "Networking and permissions",
      "Skip the collector (Node.js)",
      "How the environment is identified",
      "What the environment shows",
    ],
    troubleshooting: [
      "Instances show up under Hosts instead",
      "Every instance shares one row under Instances",
      "The environment does not appear",
    ],
  },
  [ManagedCloudPlatform.AwsAppRunner]: {
    steps: [
      "Store the token in Secrets Manager",
      "Configure the App Runner service",
      VERIFY,
    ],
    shapes: [],
    secretStore: "aws secretsmanager create-secret",
    exclusive: [
      "App Runner",
      "cloud.platform=aws_app_runner",
      "--name oneuptime/otlp-headers",
    ],
    advanced: [
      "Networking and permissions",
      "How the environment is identified",
      "What the environment shows",
    ],
    troubleshooting: [
      "Exports are refused with 401",
      "The environment does not appear",
    ],
  },
  [ManagedCloudPlatform.GcpCloudRun]: {
    steps: [
      "Store the token in Secret Manager",
      "Configure the Cloud Run service",
      VERIFY,
    ],
    shapes: [SDK, SIDECAR],
    secretStore: "gcloud secrets create",
    exclusive: [
      "gcloud run services update",
      "detectors: [env, gcp]",
      "run.googleapis.com/container-dependencies",
      "health_check",
      "oneuptime-ingestion-token",
    ],
    advanced: [
      "Networking and permissions",
      "How the environment is identified",
      "What the environment shows",
    ],
    troubleshooting: [
      'Revision fails with "Permission denied on secret"',
      "Exports are refused with 401",
      "The environment does not appear",
    ],
  },
  [ManagedCloudPlatform.GcpAppEngine]: {
    steps: [
      "Store the token in Secret Manager",
      "Set the variables in app.yaml",
      VERIFY,
    ],
    shapes: [],
    secretStore: "gcloud secrets create",
    exclusive: [
      "app.yaml",
      "gcloud app deploy",
      "GAE_SERVICE",
      "@appspot.gserviceaccount.com",
    ],
    advanced: [
      "Networking and permissions",
      "How the environment is identified",
      "What the environment shows",
    ],
    troubleshooting: ["The environment does not appear"],
  },
  [ManagedCloudPlatform.AzureContainerApps]: {
    steps: [
      "Store the token as a Container Apps secret",
      "Configure the container app",
      VERIFY,
    ],
    shapes: [SDK, SIDECAR],
    secretStore: "az containerapp secret set",
    exclusive: [
      "az containerapp update",
      "detectors: [env, azurecontainerapps]",
      "CONTAINER_APP_REPLICA_NAME",
      "az containerapp env telemetry otlp add",
      "secretref:oneuptime-otlp-headers",
    ],
    advanced: [
      "Networking and permissions",
      "Use the environment's managed OpenTelemetry agent",
      "How the environment is identified",
      "What the environment shows",
    ],
    troubleshooting: [
      "Exports are refused with 401",
      "The environment does not appear",
    ],
  },
  [ManagedCloudPlatform.AzureContainerInstances]: {
    steps: ["Create the container group", VERIFY],
    shapes: [],
    secretStore: "--secure-environment-variables",
    exclusive: [
      "az container create",
      "Mark as secure: Yes",
      "Container Instances",
    ],
    advanced: [
      "Networking and permissions",
      "Run a sidecar collector",
      "How the environment is identified",
      "What the environment shows",
    ],
    troubleshooting: [
      "A changed variable has no effect",
      "The environment does not appear",
    ],
  },
  [ManagedCloudPlatform.AzureAppService]: {
    steps: [
      "Store the token in Key Vault",
      "Set the application settings",
      VERIFY,
    ],
    shapes: [],
    secretStore: "Key Vault Secrets User",
    exclusive: [
      "@Microsoft.KeyVault(",
      "WEBSITE_INSTANCE_ID",
      "deployment slot setting",
      "App Services",
    ],
    advanced: [
      "Networking and permissions",
      "How the environment is identified",
      "What the environment shows",
    ],
    troubleshooting: [
      "Exports are refused with 401",
      "The environment key has an empty account segment",
      "The environment does not appear",
    ],
  },
};

const PLATFORMS: Array<ManagedCloudPlatform> = MANAGED_CLOUD_PLATFORMS.map(
  (descriptor: ManagedCloudPlatformDescriptor): ManagedCloudPlatform => {
    return descriptor.platform;
  },
);

const descriptorOf: (
  platform: ManagedCloudPlatform,
) => ManagedCloudPlatformDescriptor = (
  platform: ManagedCloudPlatform,
): ManagedCloudPlatformDescriptor => {
  return MANAGED_CLOUD_PLATFORMS.find(
    (descriptor: ManagedCloudPlatformDescriptor): boolean => {
      return descriptor.platform === platform;
    },
  )!;
};

const guideFor: (
  platform: ManagedCloudPlatform,
  overrides?: { oneuptimeUrl?: string; apiKey?: string },
) => SetupGuideContent = (
  platform: ManagedCloudPlatform,
  overrides?: { oneuptimeUrl?: string; apiKey?: string },
): SetupGuideContent => {
  return getCloudSetupGuide({
    oneuptimeUrl: overrides?.oneuptimeUrl ?? ONEUPTIME_URL,
    apiKey: overrides?.apiKey ?? KEY,
    platform: platform,
  });
};

// Everything a step shows: its own markdown and every tab.
const stepText: (step: SetupGuideStep) => string = (
  step: SetupGuideStep,
): string => {
  return [
    step.markdown || "",
    ...(step.variants || []).map((variant: SetupGuideStepVariant): string => {
      return variant.markdown;
    }),
  ].join("\n\n");
};

const variantOf: (step: SetupGuideStep, label: string) => string = (
  step: SetupGuideStep,
  label: string,
): string => {
  const variant: SetupGuideStepVariant | undefined = (step.variants || []).find(
    (candidate: SetupGuideStepVariant): boolean => {
      return candidate.label === label;
    },
  );
  if (!variant) {
    throw new Error(`Step "${step.title}" has no "${label}" tab`);
  }
  return variant.markdown;
};

const titlesOf: (
  topics: Array<SetupGuideTopic> | undefined,
) => Array<string> = (
  topics: Array<SetupGuideTopic> | undefined,
): Array<string> => {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
};

const topicOf: (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
) => SetupGuideTopic = (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
): SetupGuideTopic => {
  const topic: SetupGuideTopic | undefined = (topics || []).find(
    (candidate: SetupGuideTopic): boolean => {
      return candidate.title === title;
    },
  );
  if (!topic) {
    throw new Error(`No topic titled "${title}"`);
  }
  return topic;
};

interface FencedBlock {
  language: string;
  body: string;
}

const fencedBlocks: (markdown: string) => Array<FencedBlock> = (
  markdown: string,
): Array<FencedBlock> => {
  return Array.from(markdown.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)).map(
    (match: RegExpMatchArray): FencedBlock => {
      return { language: match[1] || "", body: match[2] || "" };
    },
  );
};

// The collector configurations: YAML blocks that export to OneUptime.
const collectorConfigsOf: (markdown: string) => Array<string> = (
  markdown: string,
): Array<string> => {
  return fencedBlocks(markdown)
    .filter((block: FencedBlock): boolean => {
      return (
        block.language === "yaml" && block.body.includes("otlphttp/oneuptime")
      );
    })
    .map((block: FencedBlock): string => {
      return block.body;
    });
};

// Shell blocks that run a command, as opposed to lists of variables to set.
const COMMAND_START: RegExp = /^(aws|az|curl|gcloud|printf)\b/;

const commandBlocksOf: (markdown: string) => Array<string> = (
  markdown: string,
): Array<string> => {
  return fencedBlocks(markdown)
    .filter((block: FencedBlock): boolean => {
      return (
        block.language === "bash" && COMMAND_START.test(block.body.trimStart())
      );
    })
    .map((block: FencedBlock): string => {
      return block.body;
    });
};

// What the shell sees outside quotes, with comment lines dropped.
const unquotedShellText: (command: string) => string = (
  command: string,
): string => {
  return command
    .split("\n")
    .filter((line: string): boolean => {
      return !line.trimStart().startsWith("#");
    })
    .join("\n")
    .replace(/'[^']*'/g, "")
    .replace(/"[^"]*"/g, "");
};

const docsFileFor: (url: string) => string = (url: string): string => {
  return path.join(DOCS_CONTENT, `${url.replace(/^\/docs\//, "")}.md`);
};

const docsPageOf: (platform: ManagedCloudPlatform) => string = (
  platform: ManagedCloudPlatform,
): string => {
  return fs.readFileSync(docsFileFor(descriptorOf(platform).docsUrl), "utf8");
};

type YamlMap = Record<string, unknown>;

const asMap: (value: unknown) => YamlMap = (value: unknown): YamlMap => {
  expect(typeof value === "object" && value !== null).toBe(true);
  return value as YamlMap;
};

describe("the platform picker", () => {
  test("offers exactly the registry's platforms, in registry order", () => {
    expect(
      CLOUD_PLATFORM_OPTIONS.map(
        (option: SetupGuideOption<ManagedCloudPlatform>): string => {
          return option.key;
        },
      ),
    ).toEqual(PLATFORMS);
    expect(new Set(PLATFORMS)).toEqual(
      new Set(Object.values(ManagedCloudPlatform)),
    );
  });

  test("labels each platform with its product name, one-line description and provider", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      const option: SetupGuideOption<ManagedCloudPlatform> | undefined =
        CLOUD_PLATFORM_OPTIONS.find(
          (candidate: SetupGuideOption<ManagedCloudPlatform>): boolean => {
            return candidate.key === descriptor.platform;
          },
        );
      expect(option).toEqual({
        key: descriptor.platform,
        label: descriptor.productName,
        description: descriptor.description,
        group: CLOUD_PROVIDER_LABELS[descriptor.provider],
      });
      expect(option?.description).not.toContain("\n");
      expect(option?.badge).toBeUndefined();
    }
  });

  test("groups the platforms by provider: AWS, Google Cloud, Azure", () => {
    const groups: Array<SetupGuideOptionGroup<ManagedCloudPlatform>> =
      groupSetupGuideOptions(CLOUD_PLATFORM_OPTIONS);

    expect(
      groups.map(
        (group: SetupGuideOptionGroup<ManagedCloudPlatform>): unknown => {
          return group.label;
        },
      ),
    ).toEqual([
      CLOUD_PROVIDER_LABELS[CloudProvider.AWS],
      CLOUD_PROVIDER_LABELS[CloudProvider.GCP],
      CLOUD_PROVIDER_LABELS[CloudProvider.Azure],
    ]);

    for (const group of groups) {
      const provider: CloudProvider = (
        Object.keys(CLOUD_PROVIDER_LABELS) as Array<CloudProvider>
      ).find((candidate: CloudProvider): boolean => {
        return CLOUD_PROVIDER_LABELS[candidate] === group.label;
      })!;
      expect(
        group.options.map(
          (option: SetupGuideOption<ManagedCloudPlatform>): string => {
            return option.key;
          },
        ),
      ).toEqual(
        MANAGED_CLOUD_PLATFORMS.filter(
          (descriptor: ManagedCloudPlatformDescriptor): boolean => {
            return descriptor.provider === provider;
          },
        ).map((descriptor: ManagedCloudPlatformDescriptor): string => {
          return descriptor.platform;
        }),
      );
    }
  });

  test("opens on AWS ECS, which is also the first option the card falls back to", () => {
    expect(DEFAULT_CLOUD_DOC_PLATFORM).toBe(ManagedCloudPlatform.AwsEcs);
    expect(CLOUD_PLATFORM_OPTIONS[0]?.key).toBe(DEFAULT_CLOUD_DOC_PLATFORM);
  });

  test("resolves every registry platform to itself", () => {
    for (const platform of PLATFORMS) {
      expect(resolveCloudPlatform(platform)).toBe(platform);
    }
  });

  test("resolves an unknown, virtual-machine or missing platform to ECS", () => {
    for (const value of [
      undefined,
      null,
      "",
      "aws_ec2",
      "gcp_compute_engine",
      "aws_lambda",
      "kubernetes",
      "AWS_ECS",
      "constructor",
    ]) {
      expect(resolveCloudPlatform(value)).toBe(DEFAULT_CLOUD_DOC_PLATFORM);
    }
  });

  test("an unknown platform gets the ECS guide rather than an error", () => {
    expect(
      getCloudSetupGuide({
        oneuptimeUrl: ONEUPTIME_URL,
        apiKey: KEY,
        platform: "aws_ec2" as ManagedCloudPlatform,
      }),
    ).toEqual(guideFor(ManagedCloudPlatform.AwsEcs));
  });

  test("every platform has a guide of its own", () => {
    const guides: Set<string> = new Set<string>(
      PLATFORMS.map((platform: ManagedCloudPlatform): string => {
        return getSetupGuideMarkdown(guideFor(platform));
      }),
    );
    expect(guides.size).toBe(PLATFORMS.length);
  });
});

describe.each(PLATFORMS)("the %s guide", (platform: ManagedCloudPlatform) => {
  const descriptor: ManagedCloudPlatformDescriptor = descriptorOf(platform);
  const expected: PlatformExpectation = EXPECTED[platform];
  const guide: SetupGuideContent = guideFor(platform);
  const markdown: string = getSetupGuideMarkdown(guide);
  const code: string = getSetupGuideCodeBlocks(guide).join("\n");

  test("stores the token, configures the platform, then verifies", () => {
    expect(
      guide.steps.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual(expected.steps);
    expect(guide.steps.length).toBeGreaterThanOrEqual(2);
    expect(guide.steps.length).toBeLessThanOrEqual(4);
  });

  test("every step has a one-line plain-text description", () => {
    for (const step of guide.steps) {
      expect(step.description).toBeTruthy();
      expect(step.description).not.toContain("\n");
      expect(step.description).not.toMatch(MARKDOWN_CHARACTERS);
    }
  });

  test("step 1 shows the OTLP endpoint and asks for a Server key kept as a secret", () => {
    expect(guide.keyStep?.endpointLabel).toBe("OTLP Endpoint");
    expect(guide.keyStep?.endpointValue).toBe(`${ONEUPTIME_URL}/otlp`);
    expect(guide.keyStep?.description).toContain("Server key");
    expect(guide.keyStep?.description).toContain("secret");
    expect(guide.keyStep?.description).toContain("plain environment variable");
    // Rendered as plain text under the step title.
    expect(guide.keyStep?.description).not.toMatch(MARKDOWN_CHARACTERS);
  });

  test("names the exact cloud.platform value and the environment it creates", () => {
    const example: string = buildCloudEnvironmentName({
      platform: platform,
      region: EXAMPLE_REGIONS[descriptor.provider],
      accountId: EXAMPLE_ACCOUNTS[descriptor.provider],
    });
    expect(guide.intro).toContain(`\`cloud.platform=${platform}\``);
    expect(guide.intro).toContain(`_${example}_`);
  });

  test("lists what to have ready, one line each", () => {
    expect((guide.prerequisites || []).length).toBeGreaterThanOrEqual(2);
    expect((guide.prerequisites || []).length).toBeLessThanOrEqual(4);
    for (const line of guide.prerequisites || []) {
      expect(line).not.toContain("\n");
    }
    expect((guide.prerequisites || []).join("\n")).toContain(
      "OpenTelemetry SDK that exports OTLP",
    );
  });

  test("carries the reader's endpoint and key into the snippets", () => {
    expect(code).toContain(`${ONEUPTIME_URL}/otlp`);
    expect(code).toContain(KEY);
    expect(code).toContain("x-oneuptime-token");
    expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    expect(markdown).not.toContain(SETUP_GUIDE_URL_PLACEHOLDER);
    expect(markdown).not.toContain("YOUR_TELEMETRY_INGESTION_TOKEN");
    expect(markdown).not.toContain(PICK_KEY_NOTE);
  });

  test("stores the token in the platform's secret store in the first step", () => {
    const first: string = stepText(guide.steps[0]!);
    expect(first).toContain(expected.secretStore);
    expect(first).toContain(KEY);
  });

  test("verifies the token with /otlp/v1/validate, then points at the environment list", () => {
    const verify: SetupGuideStep = guide.steps[guide.steps.length - 1]!;
    expect(verify.title).toBe(VERIFY);
    expect(verify.markdown).toContain(
      `curl -i ${ONEUPTIME_URL}/otlp/v1/validate \\\n  -H "x-oneuptime-token: ${KEY}"`,
    );
    expect(verify.markdown).toContain('`"valid": true`');
    expect(verify.markdown).toContain("`401`");
    expect(verify.markdown).toContain("**Cloud → All Environments**");
  });

  test("has the sidecar and SDK-direct tabs exactly where the platform has both shapes", () => {
    const tabbed: Array<SetupGuideStep> = guide.steps.filter(
      (step: SetupGuideStep): boolean => {
        return (step.variants || []).length > 0;
      },
    );

    if (expected.shapes.length === 0) {
      expect(tabbed).toEqual([]);
      return;
    }

    // The secret and the configuration both depend on the shape.
    expect(
      tabbed.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual(expected.steps.slice(0, 2));

    for (const step of tabbed) {
      expect(
        (step.variants || []).map((variant: SetupGuideStepVariant): string => {
          return variant.label;
        }),
      ).toEqual(expected.shapes);
    }

    // The intro explains the tabs in the order they appear.
    const intro: string = guide.intro || "";
    expect(intro).toContain("picking one switches every step");
    expect(intro.indexOf(`**${expected.shapes[0]}**`)).toBeGreaterThan(-1);
    expect(intro.indexOf(`**${expected.shapes[0]}**`)).toBeLessThan(
      intro.indexOf(`**${expected.shapes[1]}**`),
    );
  });

  test("shows only this platform's instructions", () => {
    for (const text of expected.exclusive) {
      expect({ platform, text, present: markdown.includes(text) }).toEqual({
        platform,
        text,
        present: true,
      });
    }

    for (const other of PLATFORMS) {
      if (other === platform) {
        continue;
      }
      for (const text of EXPECTED[other].exclusive) {
        expect({
          platform,
          from: other,
          text,
          present: markdown.includes(text),
        }).toEqual({ platform, from: other, text, present: false });
      }
    }
  });

  test("folds networking, identification and what the environment shows under Advanced", () => {
    expect(titlesOf(guide.advanced)).toEqual(expected.advanced);

    const networking: SetupGuideTopic = topicOf(
      guide.advanced,
      "Networking and permissions",
    );
    expect(networking.markdown).toContain(`\`${ONEUPTIME_HOST}\``);
    expect(networking.markdown).toContain("443");

    // Networking is reference, not a first-run step.
    for (const step of guide.steps) {
      expect(step.title).not.toMatch(/network/i);
    }
  });

  test("every Advanced topic has a plain one-line summary", () => {
    for (const topic of guide.advanced || []) {
      expect(topic.summary).toBeTruthy();
      expect(topic.summary).not.toContain("\n");
      expect(topic.summary).not.toMatch(MARKDOWN_CHARACTERS);
      expect(topic.markdown.trim().length).toBeGreaterThan(0);
    }
  });

  test("says which attribute names an instance, in the order ingest reads them", () => {
    const shows: string = topicOf(
      guide.advanced,
      "What the environment shows",
    ).markdown;
    const instances: string =
      shows.split("\n").find((line: string): boolean => {
        return line.startsWith("- **Instances**");
      }) || "";
    const attribute: string = `\`${descriptor.instanceAttribute}\``;
    const serviceInstanceId: string = "`service.instance.id`";

    expect(instances).toContain(attribute);

    const platformFirst: boolean =
      CLOUD_INSTANCE_IDENTITY_ATTRIBUTES.indexOf(descriptor.instanceAttribute) <
      CLOUD_INSTANCE_IDENTITY_ATTRIBUTES.indexOf("service.instance.id");

    if (platformFirst) {
      expect(instances.indexOf(attribute)).toBeLessThan(
        instances.indexOf(serviceInstanceId),
      );
    } else {
      /*
       * service.instance.id is read first on these platforms, so it is
       * never "only when the platform sets none" — the line either puts it
       * first or says the collector drops it.
       */
      expect(instances).not.toContain("when the platform sets none");
      expect(
        instances.indexOf(serviceInstanceId) < instances.indexOf(attribute) ||
          instances.includes("dropped"),
      ).toBe(true);
    }
  });

  test("troubleshooting is titled by symptom and ends at the shared troubleshooting page", () => {
    expect(titlesOf(guide.troubleshooting)).toEqual(expected.troubleshooting);

    const last: SetupGuideTopic = (guide.troubleshooting || [])[
      (guide.troubleshooting || []).length - 1
    ]!;
    expect(last.markdown).toContain(`](${CLOUD_TROUBLESHOOTING_URL})`);
    expect(last.markdown).toContain(`\`cloud.platform=${platform}\``);
  });

  test("links to the platform's docs page and the troubleshooting page", () => {
    expect(guide.links).toEqual([
      {
        title: `${descriptor.productName} documentation`,
        url: descriptor.docsUrl,
      },
      { title: "Cloud troubleshooting", url: CLOUD_TROUBLESHOOTING_URL },
    ]);
  });

  test("every /docs link it makes is a page on disk", () => {
    const targets: Array<string> = [
      ...(guide.links || []).map((link: { url: string }): string => {
        return link.url;
      }),
      ...Array.from(
        markdown.matchAll(/\]\((\/docs\/[^)#]+)(?:#[^)]*)?\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      }),
    ];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect({ target, exists: fs.existsSync(docsFileFor(target)) }).toEqual({
        target,
        exists: true,
      });
    }
  });

  test("closes every code fence", () => {
    const fences: number = markdown
      .split("\n")
      .filter((line: string): boolean => {
        return line.trimStart().startsWith("```");
      }).length;
    expect(fences % 2).toBe(0);
    expect(fences).toBeGreaterThan(0);
  });
});

describe("the two shapes", () => {
  const SHAPED: Array<ManagedCloudPlatform> = PLATFORMS.filter(
    (platform: ManagedCloudPlatform): boolean => {
      return EXPECTED[platform].shapes.length > 0;
    },
  );

  test("are offered on ECS, Cloud Run and Container Apps", () => {
    expect(SHAPED).toEqual([
      ManagedCloudPlatform.AwsEcs,
      ManagedCloudPlatform.GcpCloudRun,
      ManagedCloudPlatform.AzureContainerApps,
    ]);
  });

  test.each(SHAPED)(
    "%s: the collector's secret is the bare token, the SDK's the whole header",
    (platform: ManagedCloudPlatform) => {
      const secret: SetupGuideStep = guideFor(platform).steps[0]!;
      const sidecar: string = variantOf(secret, SIDECAR);
      const sdk: string = variantOf(secret, SDK);

      expect(sidecar).toContain(KEY);
      expect(sidecar).not.toContain(`x-oneuptime-token=${KEY}`);
      expect(sdk).toContain(`x-oneuptime-token=${KEY}`);
    },
  );

  test.each(SHAPED)(
    "%s: the sidecar tab points the app at localhost and carries the collector configuration",
    (platform: ManagedCloudPlatform) => {
      const configure: SetupGuideStep = guideFor(platform).steps[1]!;
      const sidecar: string = variantOf(configure, SIDECAR);

      expect(sidecar).toContain(
        "OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318",
      );
      expect(sidecar).toContain("--config=env:OTEL_COLLECTOR_CONFIG");
      expect(sidecar).toContain("otel/opentelemetry-collector-contrib:latest");
      expect(sidecar).toContain("ONEUPTIME_TOKEN");
      expect(collectorConfigsOf(sidecar)).toHaveLength(1);
      // The app never sees the token: only the collector holds it.
      expect(sidecar).not.toContain(`x-oneuptime-token=${KEY}`);
    },
  );

  test.each(SHAPED)(
    "%s: the SDK-direct tab exports straight to OneUptime with the header from the secret",
    (platform: ManagedCloudPlatform) => {
      const configure: SetupGuideStep = guideFor(platform).steps[1]!;
      const sdk: string = variantOf(configure, SDK);

      expect(sdk).toContain(
        `OTEL_EXPORTER_OTLP_ENDPOINT=${ONEUPTIME_URL}/otlp`,
      );
      expect(sdk).toContain("OTEL_EXPORTER_OTLP_HEADERS");
      expect(sdk).toContain("OTEL_NODE_RESOURCE_DETECTORS=");
      expect(collectorConfigsOf(sdk)).toEqual([]);
      expect(sdk).not.toContain("localhost:4318");
    },
  );

  test("ECS: the sidecar ships per-task CPU / memory, which SDK direct cannot", () => {
    const guide: SetupGuideContent = guideFor(ManagedCloudPlatform.AwsEcs);
    const configure: SetupGuideStep = guide.steps[1]!;

    expect(variantOf(configure, SIDECAR)).toContain("awsecscontainermetrics");
    expect(variantOf(configure, SDK)).not.toContain("awsecscontainermetrics");
    expect(
      topicOf(guide.advanced, "What the environment shows").markdown,
    ).toContain("SDK direct ships no container metrics");
    expect(guide.intro).toContain("Most teams end up here.");
  });

  test("ECS: both tabs remind the execution role to read the secret", () => {
    const secret: SetupGuideStep = guideFor(ManagedCloudPlatform.AwsEcs)
      .steps[0]!;
    for (const label of [SIDECAR, SDK]) {
      const tab: string = variantOf(secret, label);
      expect(tab).toContain("secretsmanager:GetSecretValue");
      expect(tab).toContain("`kms:Decrypt`");
      expect(tab).toContain("`unable to pull secrets`");
    }
  });

  test("the SDK-direct tabs turn on the platform's detector in every language", () => {
    const ecs: string = variantOf(
      guideFor(ManagedCloudPlatform.AwsEcs).steps[1]!,
      SDK,
    );
    for (const text of [
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws",
      "OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=aws_ecs",
      "opentelemetry-sdk-extension-aws",
      "-Dotel.resource.providers.aws.enabled=true",
      "go.opentelemetry.io/contrib/detectors/aws/ecs",
      "AddAWSECSDetector()",
    ]) {
      expect(ecs).toContain(text);
    }

    const run: string = variantOf(
      guideFor(ManagedCloudPlatform.GcpCloudRun).steps[1]!,
      SDK,
    );
    for (const text of [
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp",
      "OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=gcp_resource_detector",
      "opentelemetry-resourcedetector-gcp",
      "-Dotel.resource.providers.gcp.enabled=true",
      "go.opentelemetry.io/contrib/detectors/gcp",
      "AddGcpDetector()",
    ]) {
      expect(run).toContain(text);
    }

    const aca: string = variantOf(
      guideFor(ManagedCloudPlatform.AzureContainerApps).steps[1]!,
      SDK,
    );
    for (const text of [
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os",
      "AddAzureContainerAppsDetector()",
      "CONTAINER_APP_REPLICA_NAME",
    ]) {
      expect(aca).toContain(text);
    }
  });

  test("Cloud Run: the CLI keeps the detector list whole with the ^@^ separator", () => {
    const sdk: string = variantOf(
      guideFor(ManagedCloudPlatform.GcpCloudRun).steps[1]!,
      SDK,
    );
    expect(sdk).toContain(
      `--set-env-vars "^@^OTEL_SERVICE_NAME=checkout-api@OTEL_EXPORTER_OTLP_ENDPOINT=${ONEUPTIME_URL}/otlp@OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf@OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp"`,
    );
    expect(sdk).toContain(
      '--set-secrets "OTEL_EXPORTER_OTLP_HEADERS=oneuptime-otlp-headers:latest"',
    );
  });

  test("Container Apps: the sidecar sets region and subscription for the collector's env detector", () => {
    const sidecar: string = variantOf(
      guideFor(ManagedCloudPlatform.AzureContainerApps).steps[1]!,
      SIDECAR,
    );
    expect(sidecar).toContain(
      "OTEL_RESOURCE_ATTRIBUTES=cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000",
    );
    expect(sidecar).toContain("secretRef");
    expect(sidecar).toContain("--yaml checkout-api.yaml");
  });
});

describe("the collector configurations", () => {
  const configs: Array<{ platform: ManagedCloudPlatform; body: string }> =
    PLATFORMS.flatMap(
      (
        platform: ManagedCloudPlatform,
      ): Array<{ platform: ManagedCloudPlatform; body: string }> => {
        return collectorConfigsOf(
          getSetupGuideMarkdown(guideFor(platform)),
        ).map(
          (body: string): { platform: ManagedCloudPlatform; body: string } => {
            return { platform, body };
          },
        );
      },
    );

  test("are found on the platforms that run a collector (harness guard)", () => {
    expect(
      Array.from(
        new Set(
          configs.map(
            (config: {
              platform: ManagedCloudPlatform;
              body: string;
            }): string => {
              return config.platform;
            },
          ),
        ),
      ),
    ).toEqual([
      ManagedCloudPlatform.AwsEcs,
      ManagedCloudPlatform.AwsElasticBeanstalk,
      ManagedCloudPlatform.GcpCloudRun,
      ManagedCloudPlatform.AzureContainerApps,
    ]);
  });

  test.each(configs)(
    "$platform: valid YAML whose pipelines only use what it defines",
    (config: { platform: ManagedCloudPlatform; body: string }) => {
      const parsed: YamlMap = asMap(yaml.load(config.body));
      const receivers: YamlMap = asMap(parsed["receivers"]);
      const processors: YamlMap = asMap(parsed["processors"]);
      const exporters: YamlMap = asMap(parsed["exporters"]);
      const service: YamlMap = asMap(parsed["service"]);
      const pipelines: YamlMap = asMap(service["pipelines"]);

      expect(Object.keys(pipelines).sort()).toEqual([
        "logs",
        "metrics",
        "traces",
      ]);
      // The one exporter every pipeline names is the one the config defines.
      expect(Object.keys(exporters)).toEqual(["otlphttp/oneuptime"]);

      for (const [name, value] of Object.entries(pipelines)) {
        const pipeline: YamlMap = asMap(value);
        const pipelineProcessors: Array<string> = pipeline[
          "processors"
        ] as Array<string>;

        for (const receiver of pipeline["receivers"] as Array<string>) {
          expect({ name, receiver, defined: receiver in receivers }).toEqual({
            name,
            receiver,
            defined: true,
          });
        }
        for (const processor of pipelineProcessors) {
          expect({ name, processor, defined: processor in processors }).toEqual(
            { name, processor, defined: true },
          );
        }
        expect(pipeline["exporters"]).toEqual(["otlphttp/oneuptime"]);

        // cloud.* is stamped first and batching happens last, everywhere.
        expect(pipelineProcessors[0]).toBe("resourcedetection");
        expect(pipelineProcessors[pipelineProcessors.length - 1]).toBe("batch");
      }

      for (const extension of (service["extensions"] as Array<string>) || []) {
        expect(asMap(parsed["extensions"])).toHaveProperty(extension);
      }

      expect(asMap(receivers["otlp"])).toEqual({
        protocols: {
          http: { endpoint: "0.0.0.0:4318" },
          grpc: { endpoint: "0.0.0.0:4317" },
        },
      });
    },
  );

  test.each(configs)(
    "$platform: exports to the reader's OTLP endpoint with the token from the environment",
    (config: { platform: ManagedCloudPlatform; body: string }) => {
      const parsed: YamlMap = asMap(yaml.load(config.body));
      const exporter: YamlMap = asMap(
        asMap(parsed["exporters"])["otlphttp/oneuptime"],
      );

      expect(exporter).toEqual({
        endpoint: `${ONEUPTIME_URL}/otlp`,
        headers: { "x-oneuptime-token": "${env:ONEUPTIME_TOKEN}" },
      });
      // The default protobuf encoding: no JSON encoder, no JSON Content-Type.
      expect(config.body).not.toMatch(/encoding\s*:/);
      expect(config.body).not.toMatch(/content-type/i);
      // The token is never written into the configuration itself.
      expect(config.body).not.toContain(KEY);
    },
  );

  const configOf: (platform: ManagedCloudPlatform) => YamlMap = (
    platform: ManagedCloudPlatform,
  ): YamlMap => {
    const config: { platform: ManagedCloudPlatform; body: string } | undefined =
      configs.find(
        (candidate: {
          platform: ManagedCloudPlatform;
          body: string;
        }): boolean => {
          return candidate.platform === platform;
        },
      );
    return asMap(yaml.load(config!.body));
  };

  const resourcedetectionOf: (platform: ManagedCloudPlatform) => YamlMap = (
    platform: ManagedCloudPlatform,
  ): YamlMap => {
    return asMap(asMap(configOf(platform)["processors"])["resourcedetection"]);
  };

  test("ECS: the ecs detector, and the container-metrics receiver in the metrics pipeline", () => {
    const config: YamlMap = configOf(ManagedCloudPlatform.AwsEcs);
    expect(
      resourcedetectionOf(ManagedCloudPlatform.AwsEcs)["detectors"],
    ).toEqual(["env", "ecs"]);
    expect(asMap(config["receivers"])["awsecscontainermetrics"]).toEqual({
      collection_interval: "20s",
    });
    const pipelines: YamlMap = asMap(asMap(config["service"])["pipelines"]);
    expect(asMap(pipelines["metrics"])["receivers"]).toEqual([
      "otlp",
      "awsecscontainermetrics",
    ]);
  });

  test("Cloud Run: the gcp detector, and a health check for the startup probe on 13133", () => {
    const config: YamlMap = configOf(ManagedCloudPlatform.GcpCloudRun);
    expect(
      resourcedetectionOf(ManagedCloudPlatform.GcpCloudRun)["detectors"],
    ).toEqual(["env", "gcp"]);
    expect(asMap(config["extensions"])["health_check"]).toEqual({
      endpoint: "0.0.0.0:13133",
    });
    expect(asMap(config["service"])["extensions"]).toEqual(["health_check"]);

    const sidecar: string = variantOf(
      guideFor(ManagedCloudPlatform.GcpCloudRun).steps[1]!,
      SIDECAR,
    );
    expect(sidecar).toContain("startup probe HTTP `/` port `13133`");
  });

  test("Container Apps: env plus azurecontainerapps, keeping the application's service.name", () => {
    const detection: YamlMap = resourcedetectionOf(
      ManagedCloudPlatform.AzureContainerApps,
    );
    expect(detection["detectors"]).toEqual(["env", "azurecontainerapps"]);
    expect(detection["override"]).toBe(false);
  });

  test("Beanstalk: elastic_beanstalk ahead of ec2, and the deployment-level service.instance.id dropped", () => {
    const config: YamlMap = configOf(ManagedCloudPlatform.AwsElasticBeanstalk);
    expect(
      resourcedetectionOf(ManagedCloudPlatform.AwsElasticBeanstalk)[
        "detectors"
      ],
    ).toEqual(["env", "elastic_beanstalk", "ec2"]);
    expect(asMap(config["processors"])["resource"]).toEqual({
      attributes: [{ key: "service.instance.id", action: "delete" }],
    });

    const pipelines: YamlMap = asMap(asMap(config["service"])["pipelines"]);
    for (const pipeline of Object.values(pipelines)) {
      expect(asMap(pipeline)["processors"]).toEqual([
        "resourcedetection",
        "resource",
        "batch",
      ]);
    }
  });
});

describe("against the platform's docs page", () => {
  /*
   * The in-app guide is the condensed version of the docs page it links
   * to. Where the two name the same switch, attribute line or console path,
   * they must say the same thing, or one of them is wrong.
   */
  const DETECTOR_SETTINGS: Array<RegExp> = [
    /detectors: \[[^\]]*\]/g,
    /OTEL_NODE_RESOURCE_DETECTORS(?:=|: )[a-z,]+/g,
    /OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=[a-z_]+/g,
    /-Dotel\.resource\.providers\.[a-z]+\.enabled=true/g,
    /go\.opentelemetry\.io\/contrib\/detectors\/[a-z/]+/g,
    /OpenTelemetry\.Resources\.[A-Za-z]+/g,
    /opentelemetry-(?:sdk-extension|resourcedetector)-[a-z]+/g,
    /Add[A-Za-z]+Detector\(\)/g,
  ];

  test.each(PLATFORMS)(
    "%s: every resource detector setting the guide names is on the docs page",
    (platform: ManagedCloudPlatform) => {
      const markdown: string = getSetupGuideMarkdown(guideFor(platform));
      const page: string = docsPageOf(platform);
      const found: Array<string> = DETECTOR_SETTINGS.flatMap(
        (pattern: RegExp): Array<string> => {
          return Array.from(markdown.matchAll(pattern)).map(
            (match: RegExpMatchArray): string => {
              return match[0];
            },
          );
        },
      );

      expect(found.length).toBeGreaterThan(0);
      for (const setting of found) {
        expect({ platform, setting, onPage: page.includes(setting) }).toEqual({
          platform,
          setting,
          onPage: true,
        });
      }
    },
  );

  test.each(PLATFORMS)(
    "%s: attributes set by hand are the docs page's, and name only this platform",
    (platform: ManagedCloudPlatform) => {
      const page: string = docsPageOf(platform);
      const values: Array<string> = getSetupGuideCodeBlocks(
        guideFor(platform),
      ).flatMap((block: string): Array<string> => {
        return Array.from(
          block.matchAll(/OTEL_RESOURCE_ATTRIBUTES=([^"\s]+)/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1]!;
        });
      });

      for (const value of values) {
        expect({ platform, value, onPage: page.includes(value) }).toEqual({
          platform,
          value,
          onPage: true,
        });
        for (const [, named] of value.matchAll(/cloud\.platform=([a-z_]+)/g)) {
          expect(named).toBe(platform);
        }
      }
    },
  );

  test("the platforms with no detector set their attributes by hand (harness guard)", () => {
    for (const platform of [
      ManagedCloudPlatform.AwsAppRunner,
      ManagedCloudPlatform.AzureContainerInstances,
      ManagedCloudPlatform.AzureContainerApps,
      ManagedCloudPlatform.AzureAppService,
    ]) {
      expect(getSetupGuideCodeBlocks(guideFor(platform)).join("\n")).toContain(
        "OTEL_RESOURCE_ATTRIBUTES=",
      );
    }
  });

  const CONSOLE_PATH: RegExp =
    /\*\*(?:AWS Console|Google Cloud console|Azure portal) → [^*]+\*\*/g;

  const consolePathsOf: (platform: ManagedCloudPlatform) => Array<string> = (
    platform: ManagedCloudPlatform,
  ): Array<string> => {
    return Array.from(
      getSetupGuideMarkdown(guideFor(platform)).matchAll(CONSOLE_PATH),
    ).map((match: RegExpMatchArray): string => {
      return match[0];
    });
  };

  test.each(PLATFORMS)(
    "%s: the console paths are the docs page's",
    (platform: ManagedCloudPlatform) => {
      const page: string = docsPageOf(platform);
      for (const consolePath of consolePathsOf(platform)) {
        expect({
          platform,
          consolePath,
          onPage: page.includes(consolePath),
        }).toEqual({ platform, consolePath, onPage: true });
      }
    },
  );

  test("every platform with a console walks it from the console's home (harness guard)", () => {
    const withoutConsole: Array<ManagedCloudPlatform> = PLATFORMS.filter(
      (platform: ManagedCloudPlatform): boolean => {
        return consolePathsOf(platform).length === 0;
      },
    );
    // App Engine's settings live in app.yaml, not in a console form.
    expect(withoutConsole).toEqual([ManagedCloudPlatform.GcpAppEngine]);
  });
});

describe("before a key is picked", () => {
  test.each(PLATFORMS)(
    "%s: the first step shows the placeholder and says where to pick a key",
    (platform: ManagedCloudPlatform) => {
      const guide: SetupGuideContent = guideFor(platform, {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      });
      const first: string = stepText(guide.steps[0]!);

      expect(first).toContain(PICK_KEY_NOTE);
      expect(first).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
      // Once, on the step that stores the token.
      expect(getSetupGuideMarkdown(guide).split(PICK_KEY_NOTE).length - 1).toBe(
        1,
      );
    },
  );

  test.each(PLATFORMS)(
    "%s: no command hands a placeholder to the shell unquoted",
    (platform: ManagedCloudPlatform) => {
      const guide: SetupGuideContent = guideFor(platform, {
        oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      });
      const commands: Array<string> = commandBlocksOf(
        getSetupGuideMarkdown(guide),
      );

      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect({
          platform,
          command,
          unquoted: unquotedShellText(command),
        }).toEqual({
          platform,
          command,
          unquoted: expect.not.stringContaining("<YOUR_"),
        });
      }
    },
  );

  test("the placeholder URL keeps the /otlp path and the host-only snippets", () => {
    const aca: string = getSetupGuideMarkdown(
      guideFor(ManagedCloudPlatform.AzureContainerApps, {
        oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
      }),
    );
    expect(aca).toContain(`${SETUP_GUIDE_URL_PLACEHOLDER}/otlp`);
    expect(aca).toContain(`--endpoint '${SETUP_GUIDE_URL_PLACEHOLDER}:443'`);
    expect(aca).toContain(`\`${SETUP_GUIDE_URL_PLACEHOLDER}\``);
  });
});

/*
 * Facts the guide carried before it moved to the picker layout, pinned by
 * the old CloudDocumentationMarkdown.test.ts, kept where they now live.
 */
describe("the platform facts the guide has always carried", () => {
  test("ECS: Secrets Manager, the sidecar's command and token, the detector and egress", () => {
    const ecs: string = getSetupGuideMarkdown(
      guideFor(ManagedCloudPlatform.AwsEcs),
    );
    expect(ecs).toContain("secretsmanager:GetSecretValue");
    expect(ecs).toContain("--config=env:OTEL_COLLECTOR_CONFIG");
    expect(ecs).toContain("${env:ONEUPTIME_TOKEN}");
    expect(ecs).toContain("http://localhost:4318");
    expect(ecs).toContain("assignPublicIp=ENABLED");
    expect(ecs).toContain(`TCP 443 to \`${ONEUPTIME_HOST}\``);
    expect(ecs).toContain("OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws");
  });

  test("Cloud Run: secretAccessor, container dependencies, Cloud NAT and the Serverless overlap", () => {
    const run: string = getSetupGuideMarkdown(
      guideFor(ManagedCloudPlatform.GcpCloudRun),
    );
    expect(run).toContain("roles/secretmanager.secretAccessor");
    expect(run).toContain("`Permission denied on secret`");
    expect(run).toContain("run.googleapis.com/container-dependencies");
    expect(run).toContain("**Cloud NAT**");
    expect(run).toContain("**Serverless Functions**");
    expect(run).toContain("`faas.name`");
  });

  test("Container Apps: secrets, secretref, the replica name, hand-set attributes and the gRPC agent", () => {
    const aca: string = getSetupGuideMarkdown(
      guideFor(ManagedCloudPlatform.AzureContainerApps),
    );
    expect(aca).toContain("az containerapp secret set");
    expect(aca).toContain("--set-env-vars");
    expect(aca).toContain("secretref:");
    expect(aca).toContain("CONTAINER_APP_REPLICA_NAME");
    expect(aca).toContain("override: false");
    expect(aca).toContain("`azure.container_app.instance.id`");
    expect(aca).toContain(
      "cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=",
    );
    // The managed agent is gRPC-only, so it targets the host on 443, not /otlp.
    expect(aca).toContain(`--endpoint ${ONEUPTIME_HOST}:443`);
    expect(aca).toContain("`azure.container_apps`");
  });

  test("Beanstalk, App Runner, App Engine, App Service and Container Instances keep their platform notes", () => {
    const beanstalk: string = getSetupGuideMarkdown(
      guideFor(ManagedCloudPlatform.AwsElasticBeanstalk),
    );
    expect(beanstalk).toContain("keep `elastic_beanstalk` ahead of `ec2`");
    expect(beanstalk).toContain("`docker_stats` receiver");

    const appRunner: string = getSetupGuideMarkdown(
      guideFor(ManagedCloudPlatform.AwsAppRunner),
    );
    expect(appRunner).toContain("not the access role that pulls the image");
    expect(appRunner).toContain("**Outgoing network traffic: Custom VPC**");

    const appEngine: string = getSetupGuideMarkdown(
      guideFor(ManagedCloudPlatform.GcpAppEngine),
    );
    expect(appEngine).toContain("runtime: nodejs22");
    expect(appEngine).toContain("do not commit the real value");
    expect(appEngine).toContain("Flexible environment instances");

    const appService: string = getSetupGuideMarkdown(
      guideFor(ManagedCloudPlatform.AzureAppService),
    );
    expect(appService).toContain("**system-assigned managed identity**");
    expect(appService).toContain("`azure.app_service`");
    expect(appService).toContain("**Route All**");

    const aci: string = getSetupGuideMarkdown(
      guideFor(ManagedCloudPlatform.AzureContainerInstances),
    );
    expect(aci).toContain("fixed at creation");
    expect(aci).toContain("`detectors: [env]`");
  });
});

describe("the host in the networking and managed-agent snippets", () => {
  test("is the OneUptime host without its scheme", () => {
    const ecs: SetupGuideContent = guideFor(ManagedCloudPlatform.AwsEcs);
    expect(
      topicOf(ecs.advanced, "Networking and permissions").markdown,
    ).toContain(`TCP 443 to \`${ONEUPTIME_HOST}\``);

    const agent: string = topicOf(
      guideFor(ManagedCloudPlatform.AzureContainerApps).advanced,
      "Use the environment's managed OpenTelemetry agent",
    ).markdown;
    expect(agent).toContain(`--endpoint ${ONEUPTIME_HOST}:443`);
    expect(agent).toContain(`--headers "x-oneuptime-token=${KEY}"`);
    expect(agent).toContain("**gRPC only**");
  });
});
