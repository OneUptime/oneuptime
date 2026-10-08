import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AZURE_RESOURCE_TYPES,
  AwsCloudWatchResourceRule,
  CLOUD_SERVICE_MODEL_LABELS,
  CloudResourceTypeDescriptor,
  GCP_MONITORED_RESOURCE_RULES,
  GcpMonitoredResourceRule,
  getCloudResourceTypeDescriptor,
} from "Common/Types/Cloud/CloudResourceCatalog";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import CloudResourceService, {
  CLOUD_RESOURCE_DISCONNECTED_MINUTES,
} from "Common/Server/Services/CloudResourceService";
import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Cloud Resources docs page against the product it describes.
 *
 * Markdown is not compiled, so nothing else notices when the catalog
 * learns a resource type the page's tables never list, a nav link points
 * at a page that was renamed, or a default the page quotes changes in the
 * service. Each test reads the source of truth - the catalog, the nav, the
 * service - and checks the page still tells the same story. (The collector
 * configurations on the page are checked against the dashboard's guide in
 * Common's CloudMonitoringSetupGuide.test.)
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en",
);
const PAGE: string = "telemetry/cloud-resources";
const PAGE_URL: string = `/docs/${PAGE}`;

const FENCE_LINE: RegExp = /^\s*```/;
const HEADING_LINE: RegExp = /^#{2,6} /;

function pageFile(relative: string): string {
  return path.join(CONTENT_DIR, `${relative}.md`);
}

function readPage(relative: string = PAGE): string {
  return fs.readFileSync(pageFile(relative), "utf8");
}

/* The body of one heading's section, up to the next heading of the same or a higher level. */
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

/* A table's body rows: every `|` line after the header and its divider. */
function tableRows(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|");
    })
    .slice(2);
}

function code(value: string): string {
  return `\`${value}\``;
}

function modelOf(descriptor: CloudResourceTypeDescriptor): string {
  return CLOUD_SERVICE_MODEL_LABELS[descriptor.serviceModel];
}

// The Cloud pages have a sidebar group of their own, in Observability.
function cloudGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === "Cloud";
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
}

/* GitHub-style heading anchors, as the docs renderer writes them. */
function headingAnchors(markdown: string): Set<string> {
  return new Set(
    markdown
      .split("\n")
      .filter((line: string): boolean => {
        return HEADING_LINE.test(line);
      })
      .map((line: string): string => {
        return line
          .replace(/^#+ /, "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, "")
          .replace(/ /g, "-");
      }),
  );
}

describe("Cloud Resources docs", (): void => {
  describe("the page", (): void => {
    it("opens with an H1 the renderer strips", (): void => {
      expect(readPage().split("\n")[0]).toBe("# Cloud Resources (IaaS & PaaS)");
    });

    it("keeps every code fence closed", (): void => {
      const fences: number = readPage()
        .split("\n")
        .filter((line: string): boolean => {
          return FENCE_LINE.test(line);
        }).length;

      expect(fences % 2).toBe(0);
    });

    it("only links to /docs/ pages that exist", (): void => {
      const targets: Array<string> = Array.from(
        readPage().matchAll(/\]\((\/docs\/[^)#]+)(?:#[^)]*)?\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect({
          target,
          exists: fs.existsSync(pageFile(target.replace("/docs/", ""))),
        }).toEqual({ target, exists: true });
      }
    });

    it("only links to headings the page has", (): void => {
      const anchors: Set<string> = headingAnchors(readPage());
      const links: Array<string> = Array.from(
        readPage().matchAll(/\]\(#([^)]+)\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(links.length).toBeGreaterThan(0);
      for (const anchor of links) {
        expect({ anchor, exists: anchors.has(anchor) }).toEqual({
          anchor,
          exists: true,
        });
      }
    });

    it("covers every provider, identity, status, alerting and troubleshooting", (): void => {
      const headings: Array<string> = readPage()
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("## ");
        });

      expect(headings).toEqual([
        "## Overview",
        "## Before you start",
        "## Azure",
        "## AWS",
        "## Google Cloud",
        "## Keep the pipeline free of resource detection",
        "## How a resource is identified",
        "## Status, archiving and limits",
        "## Alerting on a resource",
        "## Inventory and rules",
        "## Troubleshooting",
        "## Limitations",
      ]);
    });
  });

  describe("navigation", (): void => {
    it("follows the Cloud Environments pages in the Cloud group", (): void => {
      const links: Array<NavLink> = cloudGroup().links;
      const urls: Array<string> = links.map((link: NavLink): string => {
        return link.url;
      });
      const index: number = urls.indexOf(PAGE_URL);

      expect(index).toBeGreaterThan(0);
      expect(urls[index - 1]).toBe("/docs/telemetry/cloud-troubleshooting");
      expect(links[index]!.title).toBe("Cloud Resources (IaaS & PaaS)");
    });

    it("is linked once, and no other link's URL contains it", (): void => {
      const urls: Array<string> = DocsNav.flatMap(
        (group: NavGroup): Array<string> => {
          return group.links.map((link: NavLink): string => {
            return link.url;
          });
        },
      );

      expect(
        urls.filter((url: string): boolean => {
          return url.includes(PAGE_URL) || PAGE_URL.includes(url);
        }),
      ).toEqual([PAGE_URL]);
    });

    it("the Cloud Environments hub points readers here for everything that is not an environment", (): void => {
      const hub: string = readPage("telemetry/cloud-environments");

      expect(hub).toContain(`](${PAGE_URL})`);
    });
  });

  describe("how a resource is identified", (): void => {
    const identified: string = section(
      readPage(),
      "## How a resource is identified",
    );

    it("Azure: one row per catalog type, with its label and model", (): void => {
      const rows: Array<string> = tableRows(section(identified, "### Azure"));

      expect(rows).toHaveLength(AZURE_RESOURCE_TYPES.length);
      AZURE_RESOURCE_TYPES.forEach(
        (descriptor: CloudResourceTypeDescriptor, index: number): void => {
          expect(rows[index]).toBe(
            `| ${code(descriptor.type)} | ${descriptor.label} | ${modelOf(descriptor)} |`,
          );
        },
      );
    });

    it("AWS: one row per discovery rule, in the order rules are tried", (): void => {
      const rows: Array<string> = tableRows(section(identified, "### AWS"));

      expect(rows).toHaveLength(AWS_CLOUDWATCH_RESOURCE_RULES.length);
      AWS_CLOUDWATCH_RESOURCE_RULES.forEach(
        (rule: AwsCloudWatchResourceRule, index: number): void => {
          const descriptor: CloudResourceTypeDescriptor | null =
            getCloudResourceTypeDescriptor(CloudProvider.AWS, rule.type);
          expect(descriptor).not.toBeNull();

          const identity: string = rule.identityDimensions
            .map(code)
            .join(" + ");
          const without: string =
            rule.excludedDimensions && rule.excludedDimensions.length > 0
              ? ` (without ${rule.excludedDimensions.map(code).join(", ")})`
              : "";

          expect(rows[index]).toBe(
            `| ${code(rule.namespace)} | ${identity}${without} | ${descriptor!.label} | ${code(rule.type)} | ${modelOf(descriptor!)} |`,
          );
        },
      );
    });

    it("Google Cloud: one row per monitored resource type, with the labels that identify it", (): void => {
      const rows: Array<string> = tableRows(
        section(identified, "### Google Cloud"),
      );

      expect(rows).toHaveLength(GCP_MONITORED_RESOURCE_RULES.length);
      GCP_MONITORED_RESOURCE_RULES.forEach(
        (rule: GcpMonitoredResourceRule, index: number): void => {
          expect(rows[index]).toBe(
            `| ${code(rule.type)} | ${rule.identityLabels.map(code).join(", ")} | ${rule.label} | ${modelOf(rule)} |`,
          );
        },
      );
    });
  });

  describe("status, archiving and limits", (): void => {
    const savedEnv: NodeJS.ProcessEnv = { ...process.env };

    afterEach((): void => {
      process.env = { ...savedEnv };
    });

    const limits: string = section(
      readPage(),
      "## Status, archiving and limits",
    );

    it("quotes the window after which a resource reads Not reporting", (): void => {
      expect(CLOUD_RESOURCE_DISCONNECTED_MINUTES).toBe(60);
      expect(limits).toContain("within the last hour");
      expect(limits).toContain("after an hour without one");
    });

    it("quotes the service's own defaults for the environment variables", (): void => {
      delete process.env["CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS"];
      delete process.env["CLOUD_RESOURCE_AUTO_CREATE_BUDGET"];

      const days: number =
        CloudResourceService.getMonitoredResourceAutoArchiveDays();
      const budget: number =
        CloudResourceService.getMonitoredResourceAutoCreateBudget();

      expect(limits).toContain(
        `| \`CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS\` | \`${days}\` |`,
      );
      expect(limits).toContain(
        `| \`CLOUD_RESOURCE_AUTO_CREATE_BUDGET\` | \`${budget}\` |`,
      );
      expect(limits).toContain(`**no metric for ${days} days**`);
      expect(limits).toContain(`**${budget.toLocaleString("en-US")}**`);
    });

    it("documents the minimums the service enforces", (): void => {
      process.env["CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS"] = "0";
      process.env["CLOUD_RESOURCE_AUTO_CREATE_BUDGET"] = "0";

      expect(CloudResourceService.getMonitoredResourceAutoArchiveDays()).toBe(
        1,
      );
      expect(CloudResourceService.getMonitoredResourceAutoCreateBudget()).toBe(
        0,
      );
      expect(limits).toContain("(at least 1)");
      expect(limits).toContain("(`0` turns discovery off)");
    });
  });

  describe("troubleshooting", (): void => {
    it("is titled by symptom", (): void => {
      const titles: Array<string> = section(readPage(), "## Troubleshooting")
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("### ");
        });

      expect(titles).toEqual([
        "### No resources appear",
        "### A resource is missing",
        "### The same resource appears twice",
        "### My cloud's metrics appear under a host",
      ]);
    });
  });
});
