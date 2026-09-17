import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  FaasCloudPlatform,
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
} from "Common/Types/Cloud/CloudPlatform";
import { CLOUD_INSTANCE_IDENTITY_ATTRIBUTES } from "Common/Utils/Telemetry/CloudInstanceIdentity";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Cloud Environments docs against the product they describe.
 *
 * Markdown is not compiled, so nothing else notices when the platform
 * registry gains a value the hub's table never lists, a nav link points at a
 * page that was renamed, or the troubleshooting page stops naming an
 * attribute ingest actually falls back to. Each test reads the source of
 * truth — the registry, the identity chain, the nav — and checks the shipped
 * pages still tell the same story, so the page a customer reads with the
 * cloud console open in the next tab cannot drift from what ingest does.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en",
);

const HUB_PAGE: string = "telemetry/cloud-environments";
const TROUBLESHOOTING_PAGE: string = "telemetry/cloud-troubleshooting";

/* Pages with a per-platform walkthrough; each must be self-sufficient. */
const PLATFORM_PAGES: ReadonlyArray<string> = [
  "telemetry/cloud-aws-ecs",
  "telemetry/cloud-gcp-cloud-run",
  "telemetry/cloud-azure-container-apps",
  "telemetry/cloud-other-platforms",
];

/* Every page this change owns; the link and fence checks walk all of them. */
const OWNED_PAGES: ReadonlyArray<string> = [
  HUB_PAGE,
  ...PLATFORM_PAGES,
  TROUBLESHOOTING_PAGE,
];

/* The nav entries in the order the hub page lists them. */
const EXPECTED_NAV_URLS: ReadonlyArray<string> = [
  "/docs/telemetry/cloud-environments",
  "/docs/telemetry/cloud-aws-ecs",
  "/docs/telemetry/cloud-gcp-cloud-run",
  "/docs/telemetry/cloud-azure-container-apps",
  "/docs/telemetry/cloud-other-platforms",
  "/docs/telemetry/cloud-troubleshooting",
];

const FENCE_LINE: RegExp = /^\s*```/;
/* A table row whose second cell is a backticked cloud.platform value. */
const PLATFORM_ROW: RegExp = /^\|[^|]+\|\s*`[a-z_]+`\s*\|/;
/* "1. **AWS Console → ...**" — a numbered step, not a bullet. */
const NUMBERED_STEP: RegExp = /^\d+\. \S/m;

function pageFile(relative: string): string {
  return path.join(CONTENT_DIR, `${relative}.md`);
}

function readPage(relative: string): string {
  return fs.readFileSync(pageFile(relative), "utf8");
}

/* The body of one "## Heading" section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/* Table rows whose second cell is a backticked cloud.platform value. */
function platformTableRows(markdown: string): Array<string> {
  return markdown.split("\n").filter((line: string): boolean => {
    return PLATFORM_ROW.test(line);
  });
}

function telemetryGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === "Telemetry";
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
}

describe("Cloud Environments docs", (): void => {
  describe("pages", (): void => {
    it("ship every page the nav and the registry point at", (): void => {
      for (const page of OWNED_PAGES) {
        expect(fs.existsSync(pageFile(page))).toBe(true);
      }

      for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
        expect(
          fs.existsSync(pageFile(descriptor.docsUrl.replace("/docs/", ""))),
        ).toBe(true);
      }
    });

    it("open with an H1 the renderer strips", (): void => {
      for (const page of OWNED_PAGES) {
        expect(readPage(page).split("\n")[0]).toMatch(/^# \S/);
      }
    });

    it("keep every code fence closed", (): void => {
      for (const page of OWNED_PAGES) {
        const fences: number = readPage(page)
          .split("\n")
          .filter((line: string): boolean => {
            return FENCE_LINE.test(line);
          }).length;

        expect({ page, fences: fences % 2 }).toEqual({ page, fences: 0 });
      }
    });

    /*
     * Anchors are dropped before the lookup: the file is what has to exist,
     * and the heading check belongs to Scripts/Docs/CheckAnchors.ts.
     */
    it("only link to /docs/ pages that exist", (): void => {
      for (const page of OWNED_PAGES) {
        const targets: Array<string> = Array.from(
          readPage(page).matchAll(/\]\((\/docs\/[^)#]+)(?:#[^)]*)?\)/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1] as string;
        });

        expect(targets.length).toBeGreaterThan(0);

        for (const target of targets) {
          expect({
            page,
            target,
            exists: fs.existsSync(pageFile(target.replace("/docs/", ""))),
          }).toEqual({ page, target, exists: true });
        }
      }
    });
  });

  describe("navigation", (): void => {
    it("lists the hub, the platform pages and troubleshooting in order, in the Telemetry group", (): void => {
      const urls: Array<string> = telemetryGroup().links.map(
        (link: NavLink): string => {
          return link.url;
        },
      );

      const start: number = urls.indexOf(EXPECTED_NAV_URLS[0] as string);

      expect(start).toBeGreaterThanOrEqual(0);
      expect(urls.slice(start, start + EXPECTED_NAV_URLS.length)).toEqual(
        EXPECTED_NAV_URLS,
      );
    });

    it("uses titles that match the platform names the registry uses", (): void => {
      const titles: Array<string> = telemetryGroup().links.map(
        (link: NavLink): string => {
          return link.title;
        },
      );

      expect(titles).toEqual(
        expect.arrayContaining([
          "Cloud Environments",
          "AWS ECS / Fargate",
          "Google Cloud Run",
          "Azure Container Apps",
          "Other Cloud Platforms",
          "Cloud Troubleshooting",
        ]),
      );
    });

    it("resolves every Telemetry-group URL to an English page on disk", (): void => {
      for (const link of telemetryGroup().links) {
        expect({
          url: link.url,
          exists: fs.existsSync(pageFile(link.url.replace("/docs/", ""))),
        }).toEqual({ url: link.url, exists: true });
      }
    });
  });

  describe("hub page", (): void => {
    it("lists every managed platform in the supported-platforms table, and nothing else", (): void => {
      const rows: Array<string> = platformTableRows(
        section(readPage(HUB_PAGE), "## Supported platforms"),
      );

      expect(rows.length).toBe(MANAGED_CLOUD_PLATFORMS.length);

      for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
        const row: string | undefined = rows.find((line: string): boolean => {
          return line.includes(`\`${descriptor.platform}\``);
        });

        expect({ platform: descriptor.platform, row }).toBeDefined();
        expect(row).toContain(descriptor.productName);
        expect(row).toContain(`\`${descriptor.instanceAttribute}\``);
        expect(row).toContain(`](${descriptor.docsUrl})`);
        expect(row).toContain(
          descriptor.detection === "detector"
            ? "resource detector"
            : "set by hand",
        );
      }

      /* Every ManagedCloudPlatform enum value has a descriptor, and so a row. */
      for (const platform of Object.values(ManagedCloudPlatform)) {
        expect(
          rows.some((line: string): boolean => {
            return line.includes(`\`${platform}\``);
          }),
        ).toBe(true);
      }
    });

    it("explains the environment key and where the non-cloud platforms go", (): void => {
      const hub: string = readPage(HUB_PAGE);

      expect(hub).toContain("`platform|account|region`");
      expect(hub).toContain("aws_ecs|123456789012|us-east-1");
      expect(hub).toContain("aws_ecs||us-east-1");

      const elsewhere: string = section(
        hub,
        "## What is not a cloud environment",
      );

      expect(elsewhere).toContain("**Hosts**");
      expect(elsewhere).toContain("**Kubernetes**");
      expect(elsewhere).toContain("**Serverless Functions**");
      expect(elsewhere).toContain("`aws_ec2`");
      expect(elsewhere).toContain(`\`${FaasCloudPlatform.AwsLambda}\``);
    });

    it("names the instance identity chain in ingest's order", (): void => {
      const identity: string = section(
        readPage(HUB_PAGE),
        "### Instance identity",
      );
      let cursor: number = -1;

      for (const attribute of CLOUD_INSTANCE_IDENTITY_ATTRIBUTES) {
        const position: number = identity.indexOf(`\`${attribute}\``);

        expect({ attribute, position }).not.toEqual({
          attribute,
          position: -1,
        });
        expect(position).toBeGreaterThan(cursor);
        cursor = position;
      }
    });
  });

  describe("platform pages", (): void => {
    it("name their cloud.platform value in a code span", (): void => {
      for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
        const page: string = readPage(descriptor.docsUrl.replace("/docs/", ""));

        expect({
          platform: descriptor.platform,
          named: page.includes(`\`${descriptor.platform}\``),
        }).toEqual({ platform: descriptor.platform, named: true });
      }
    });

    it("carry the token header, the OTLP path, numbered console steps and a way to troubleshooting", (): void => {
      for (const page of PLATFORM_PAGES) {
        const markdown: string = readPage(page);

        expect(markdown).toContain("x-oneuptime-token");
        expect(markdown).toContain("/otlp");
        expect(markdown).toContain("YOUR_TELEMETRY_INGESTION_TOKEN");
        expect(markdown).toContain("YOUR-ONEUPTIME-HOST/otlp");
        expect(markdown).toContain("/otlp/v1/validate");
        expect(markdown).toMatch(NUMBERED_STEP);
        expect(
          markdown.includes("## Troubleshooting") ||
            markdown.includes(`](/docs/${TROUBLESHOOTING_PAGE})`),
        ).toBe(true);
      }
    });

    it("describe both deployment shapes and the secret store for the token", (): void => {
      for (const page of PLATFORM_PAGES) {
        const markdown: string = readPage(page);

        expect(markdown).toMatch(/secret/i);
        expect(markdown).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
        expect(markdown).toContain("resourcedetection");
      }
    });

    it("AWS ECS: sidecar with container metrics, Secrets Manager IAM, the detector, and the task definition", (): void => {
      const ecs: string = readPage("telemetry/cloud-aws-ecs");

      expect(ecs).toContain("awsecscontainermetrics");
      expect(ecs).toContain("secretsmanager:GetSecretValue");
      expect(ecs).toContain("resourcedetection");
      expect(ecs).toContain("detectors: [env, ecs]");
      expect(ecs).toContain("--config=env:OTEL_COLLECTOR_CONFIG");
      expect(ecs).toContain("${env:ONEUPTIME_TOKEN}");
      expect(ecs).toContain('"secrets"');
      expect(ecs).toContain('"valueFrom"');
      expect(ecs).toContain("http://localhost:4318");
      expect(ecs).toContain("assignPublicIp");
      expect(ecs).toContain("NAT gateway");
      expect(ecs).toContain("OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws");
      expect(ecs).toContain("OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=aws_ecs");
    });

    it("Cloud Run: sidecar ordering, Secret Manager IAM, the gcp detector and the Serverless overlap", (): void => {
      const run: string = readPage("telemetry/cloud-gcp-cloud-run");

      expect(run).toContain("container-dependencies");
      expect(run).toContain("secretAccessor");
      expect(run).toContain("detectors: [env, gcp]");
      expect(run).toContain("faas.name");
      expect(run).toContain("Serverless Functions");
      expect(run).toContain("OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp");
      expect(run).toContain("gcp_resource_detector");
    });

    it("Container Apps: explicit attributes, the replica name, the az CLI and the managed agent", (): void => {
      const aca: string = readPage("telemetry/cloud-azure-container-apps");

      expect(aca).toContain("azure_container_apps");
      expect(aca).toContain("CONTAINER_APP_REPLICA_NAME");
      expect(aca).toContain("az containerapp secret set");
      expect(aca).toContain("--set-env-vars");
      expect(aca).toContain("--yaml");
      expect(aca).toContain("detectors: [env, azurecontainerapps]");
      expect(aca).toContain("override: false");
      expect(aca).toContain("`azure.container_app.instance.id`");
      /* The managed agent is gRPC-only, so it targets the host on 443, not /otlp. */
      expect(aca).toContain("--endpoint oneuptime.com:443");
      expect(aca).toContain("azure.container_apps");
      expect(aca).toContain("az containerapp env telemetry otlp add");
      expect(aca).toContain(
        "cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=",
      );
    });

    it("Other platforms: one section per remaining platform with its detector story", (): void => {
      const other: string = readPage("telemetry/cloud-other-platforms");

      for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
        if (descriptor.docsUrl !== "/docs/telemetry/cloud-other-platforms") {
          continue;
        }

        expect(other).toContain(`## ${descriptor.productName}`);
      }

      expect(other).toContain("elastic_beanstalk");
      expect(other).toContain("gcp_app_engine");
      expect(other).toContain("azure_app_service");
      expect(other).toContain("aws_app_runner");
      expect(other).toContain("azure_container_instances");
    });
  });

  describe("troubleshooting page", (): void => {
    it("names every attribute in the instance identity chain", (): void => {
      const markdown: string = readPage(TROUBLESHOOTING_PAGE);

      for (const attribute of CLOUD_INSTANCE_IDENTITY_ATTRIBUTES) {
        expect({
          attribute,
          named: markdown.includes(`\`${attribute}\``),
        }).toEqual({ attribute, named: true });
      }
    });

    it("names every managed cloud.platform value ingest accepts", (): void => {
      const markdown: string = readPage(TROUBLESHOOTING_PAGE);

      for (const platform of Object.values(ManagedCloudPlatform)) {
        expect(markdown).toContain(`\`${platform}\``);
      }
    });

    it("covers each failure the product can produce", (): void => {
      const markdown: string = readPage(TROUBLESHOOTING_PAGE);

      expect(markdown).toContain("/otlp/v1/validate");
      expect(markdown).toContain("401");
      expect(markdown).toContain("**Hosts**");
      expect(markdown).toContain("Serverless Functions");
      expect(markdown).toContain("container.cpu.utilization");
      expect(markdown).toContain("container.memory.usage");
      expect(markdown).toContain("15 minutes");
      expect(markdown).toContain("Disconnected");
      expect(markdown).toContain("aws_ecs||us-east-1");
      expect(markdown).toContain("`platform|account|region`");
    });
  });
});
