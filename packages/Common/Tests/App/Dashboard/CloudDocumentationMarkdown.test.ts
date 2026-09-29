import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_DOC_OTHER_PLATFORMS_POINTER,
  DEFAULT_CLOUD_DOC_PLATFORM,
  DocVars,
  getCloudDocMarkdown,
  getCloudDocMarkdownForPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/documentationMarkdown";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
  getManagedCloudPlatformDescriptor,
} from "../../../Types/Cloud/CloudPlatform";

/*
 * The in-app "Connect a managed cloud environment" guide, per platform.
 *
 * These are pure string builders, so the whole contract is checkable: every
 * managed platform gets a guide that carries the project's own endpoint and
 * token (copy-paste ready), names its exact cloud.platform value (the one
 * string ingest gates on), walks the console in numbered steps, says where
 * the secret goes, and links to the registry's docs page for the platform.
 * The platform-less entry point stays the ECS guide so its existing callers
 * keep rendering what they rendered before, plus a pointer to the picker.
 */

const VARS: DocVars = {
  oneuptimeUrl: "https://oneuptime.example.test",
  apiKey: "tok-0123456789abcdef",
};

const FENCE_LINE: RegExp = /^\s*```/;
const NUMBERED_STEP: RegExp = /^\d+\. \S/m;

function fenceCount(markdown: string): number {
  return markdown.split("\n").filter((line: string): boolean => {
    return FENCE_LINE.test(line);
  }).length;
}

describe("getCloudDocMarkdownForPlatform", () => {
  test.each(
    MANAGED_CLOUD_PLATFORMS.map(
      (
        descriptor: ManagedCloudPlatformDescriptor,
      ): [string, ManagedCloudPlatformDescriptor] => {
        return [descriptor.platform, descriptor];
      },
    ),
  )(
    "%s: endpoint, token, platform value, console steps, secret, docs link",
    (_platform: string, descriptor: ManagedCloudPlatformDescriptor) => {
      const markdown: string = getCloudDocMarkdownForPlatform(
        VARS,
        descriptor.platform,
      );

      expect(markdown.startsWith(`## Connect ${descriptor.productName}`)).toBe(
        true,
      );

      // Copy-paste ready: the project's own endpoint and token, not placeholders.
      expect(markdown).toContain(`${VARS.oneuptimeUrl}/otlp`);
      expect(markdown).toContain(VARS.apiKey);
      expect(markdown).toContain(`x-oneuptime-token`);
      expect(markdown).not.toContain("YOUR_TELEMETRY_INGESTION_TOKEN");

      // The exact string ingest gates on.
      expect(markdown).toContain(`cloud.platform=${descriptor.platform}`);

      // Console navigation as numbered steps, not just YAML.
      expect(markdown).toMatch(NUMBERED_STEP);

      // Where the token lives on this platform.
      expect(markdown).toMatch(/secret/i);

      // IAM / networking and verification are always present.
      expect(markdown).toContain("networking checklist");
      expect(markdown).toContain(`${VARS.oneuptimeUrl}/otlp/v1/validate`);
      expect(markdown).toContain("Cloud → All Environments");

      // What identifies an instance on this platform.
      expect(markdown).toContain(`\`${descriptor.instanceAttribute}\``);

      // The registry's docs page for the platform, and troubleshooting.
      expect(markdown).toContain(`](${descriptor.docsUrl})`);
      expect(markdown).toContain("/docs/telemetry/cloud-troubleshooting");

      expect(fenceCount(markdown) % 2).toBe(0);
    },
  );

  test("covers every ManagedCloudPlatform value with a distinct guide", () => {
    const guides: Set<string> = new Set<string>();

    for (const platform of Object.values(ManagedCloudPlatform)) {
      guides.add(getCloudDocMarkdownForPlatform(VARS, platform));
    }

    expect(guides.size).toBe(Object.values(ManagedCloudPlatform).length);
  });

  test("falls back to the default platform for an unknown or empty value", () => {
    const fallback: string = getCloudDocMarkdownForPlatform(
      VARS,
      DEFAULT_CLOUD_DOC_PLATFORM,
    );

    expect(getCloudDocMarkdownForPlatform(VARS, "")).toBe(fallback);
    expect(getCloudDocMarkdownForPlatform(VARS, "aws_ec2")).toBe(fallback);
    expect(getCloudDocMarkdownForPlatform(VARS, "kubernetes")).toBe(fallback);
  });

  test("survives the placeholder URL the card uses when HOST is unset", () => {
    const markdown: string = getCloudDocMarkdownForPlatform(
      { oneuptimeUrl: "<YOUR_ONEUPTIME_URL>", apiKey: "<YOUR_API_KEY>" },
      ManagedCloudPlatform.AwsEcs,
    );

    expect(markdown).toContain("<YOUR_ONEUPTIME_URL>/otlp");
    expect(markdown).toContain("<YOUR_API_KEY>");
  });

  test("AWS ECS: sidecar with container metrics, Secrets Manager, detector and egress", () => {
    const ecs: string = getCloudDocMarkdownForPlatform(
      VARS,
      ManagedCloudPlatform.AwsEcs,
    );

    expect(ecs).toContain("awsecscontainermetrics");
    expect(ecs).toContain("detectors: [env, ecs]");
    expect(ecs).toContain("secretsmanager:GetSecretValue");
    expect(ecs).toContain("--config=env:OTEL_COLLECTOR_CONFIG");
    expect(ecs).toContain("${env:ONEUPTIME_TOKEN}");
    expect(ecs).toContain("http://localhost:4318");
    expect(ecs).toContain("assignPublicIp=ENABLED");
    expect(ecs).toContain("TCP 443 to `oneuptime.example.test`");
    expect(ecs).toContain("OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws");
  });

  test("Cloud Run: secretAccessor, the gcp detector, container dependencies and the Serverless overlap", () => {
    const run: string = getCloudDocMarkdownForPlatform(
      VARS,
      ManagedCloudPlatform.GcpCloudRun,
    );

    expect(run).toContain("roles/secretmanager.secretAccessor");
    expect(run).toContain("detectors: [env, gcp]");
    expect(run).toContain("container-dependencies");
    expect(run).toContain("Serverless");
    expect(run).toContain("Cloud NAT");
  });

  test("Container Apps: explicit attributes, replica name, az CLI and the managed agent", () => {
    const aca: string = getCloudDocMarkdownForPlatform(
      VARS,
      ManagedCloudPlatform.AzureContainerApps,
    );

    expect(aca).toContain("az containerapp secret set");
    expect(aca).toContain("--set-env-vars");
    expect(aca).toContain("secretref:");
    expect(aca).toContain("CONTAINER_APP_REPLICA_NAME");
    expect(aca).toContain("detectors: [env, azurecontainerapps]");
    expect(aca).toContain("override: false");
    expect(aca).toContain("`azure.container_app.instance.id`");
    /* The managed agent is gRPC-only, so it targets the host on 443, not /otlp. */
    expect(aca).toContain(":443");
    expect(aca).toContain(
      "cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=",
    );
    expect(aca).toContain("az containerapp env telemetry otlp add");
  });
});

describe("getCloudDocMarkdown", () => {
  test("is the AWS ECS guide plus a one-line pointer to the other platforms", () => {
    const legacy: string = getCloudDocMarkdown(VARS);
    const ecs: string = getCloudDocMarkdownForPlatform(
      VARS,
      ManagedCloudPlatform.AwsEcs,
    );

    expect(DEFAULT_CLOUD_DOC_PLATFORM).toBe(ManagedCloudPlatform.AwsEcs);
    expect(legacy.startsWith(ecs)).toBe(true);
    expect(legacy.slice(ecs.length)).toBe(
      `\n\n${CLOUD_DOC_OTHER_PLATFORMS_POINTER}`,
    );
    expect(CLOUD_DOC_OTHER_PLATFORMS_POINTER).not.toContain("\n");
    expect(CLOUD_DOC_OTHER_PLATFORMS_POINTER).toContain(
      "/docs/telemetry/cloud-environments",
    );
  });

  test("the pointer names every platform that is not the default", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      if (descriptor.platform === DEFAULT_CLOUD_DOC_PLATFORM) {
        continue;
      }

      const shortName: string = descriptor.productName
        .replace(/^(AWS|Google|Azure) /, "")
        .replace(/^GCP /, "");

      expect(CLOUD_DOC_OTHER_PLATFORMS_POINTER).toContain(shortName);
    }
  });

  test("the default platform has a registry descriptor", () => {
    expect(
      getManagedCloudPlatformDescriptor(DEFAULT_CLOUD_DOC_PLATFORM),
    ).not.toBeNull();
  });
});
