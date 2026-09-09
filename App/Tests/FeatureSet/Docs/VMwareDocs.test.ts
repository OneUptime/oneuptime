import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  VMwareAlertTemplate,
  getAllVMwareAlertTemplates,
} from "Common/Types/Monitor/VMwareAlertTemplates";
import {
  VMwareMetricDefinition,
  getAllVMwareMetricCategories,
  getAllVMwareMetrics,
} from "Common/Types/Monitor/VMwareMetricCatalog";
import { VMwareVCenterNameLabelKeys } from "Common/Server/Utils/Monitor/SeriesResourceLabels";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The VMware docs against the product they describe.
 *
 * Markdown is not compiled, so nothing else notices when the metric catalog
 * gains a series the monitor page never lists, an alert template is renamed
 * without the docs following (the E2E spec asserts the template names by
 * exact text, so the two must agree), the agent's docker-compose.yml gains an
 * environment variable the install guide does not explain, or a nav link
 * points at a page that was renamed. Each test reads the source of truth —
 * the catalog, the template registry, the compose file, the nav — and checks
 * the shipped pages still tell the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const AGENT_DIR: string = path.join(REPO_ROOT, "VMwareAgent");
// Screenshots the pages embed live here, not under Content/<language>.
const STATIC_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Static");
const STATIC_PREFIX: string = "/docs/static/";

const TELEMETRY_PAGE: string = "telemetry/vmware";
const MONITOR_PAGE: string = "monitor/vmware-monitor";

const OWNED_PAGES: ReadonlyArray<string> = [TELEMETRY_PAGE, MONITOR_PAGE];

/*
 * Every language directory that ships the VMware pages. `fa` is the only
 * translated corpus (every other language falls back to English per page at
 * request time), so a new translation only has to be added here.
 */
const TRANSLATED_LANGUAGES: ReadonlyArray<string> = ["fa"];

const FENCE_LINE: RegExp = /^\s*```/;
/* A table row whose first cell is a backticked vcenter.* metric name. */
const METRIC_ROW: RegExp = /^\|\s*`(vcenter\.[a-z_.]+)`\s*\|/;
/* Bare environment variable names in the compose file's environment block. */
const COMPOSE_ENV_LINE: RegExp = /^\s*-\s*([A-Z][A-Z0-9_]+)=/;

function pageFile(language: string, relative: string): string {
  return path.join(CONTENT_DIR, language, `${relative}.md`);
}

function readPage(relative: string, language: string = "en"): string {
  return fs.readFileSync(pageFile(language, relative), "utf8");
}

/* The body of one "## Heading" section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

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

/* Metric names in the first cell of every table row of the given markdown. */
function metricTableRows(markdown: string): Map<string, string> {
  const rows: Map<string, string> = new Map<string, string>();

  for (const line of markdown.split("\n")) {
    const match: RegExpMatchArray | null = line.match(METRIC_ROW);

    if (match) {
      rows.set(match[1] as string, line);
    }
  }

  return rows;
}

/* Every backticked identifier in a page, in order, duplicates kept. */
function backtickedIdentifiers(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/`([^`\n]+)`/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/* Fenced code blocks of a page, each as its full text between the fences. */
function codeBlocks(markdown: string): Array<string> {
  const blocks: Array<string> = [];
  let current: Array<string> | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        blocks.push(current.join("\n"));
        current = null;
      } else {
        current = [];
      }
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  return blocks;
}

/* Environment variables the agent's docker-compose.yml passes to the collector. */
function composeEnvironmentVariables(): Array<string> {
  const compose: string = fs.readFileSync(
    path.join(AGENT_DIR, "docker-compose.yml"),
    "utf8",
  );

  const names: Array<string> = [];

  for (const line of compose.split("\n")) {
    const match: RegExpMatchArray | null = line.match(COMPOSE_ENV_LINE);

    if (match) {
      names.push(match[1] as string);
    }
  }

  expect(names.length).toBeGreaterThan(0);

  return names;
}

function navGroup(title: string): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === title;
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
}

describe("VMware docs", (): void => {
  describe("pages", (): void => {
    it("ship both English pages", (): void => {
      for (const page of OWNED_PAGES) {
        expect({
          page,
          exists: fs.existsSync(pageFile("en", page)),
        }).toEqual({ page, exists: true });
      }
    });

    it("open with the titles the nav uses", (): void => {
      expect(readPage(TELEMETRY_PAGE).split("\n")[0]).toBe(
        "# OneUptime VMware Agent",
      );
      expect(readPage(MONITOR_PAGE).split("\n")[0]).toBe("# VMware Monitor");
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
     *
     * `/docs/static/...` is an asset served out of Docs/Static, not a page
     * under Content/<language>, so those links resolve against that
     * directory instead — the screenshots the pages embed are covered by
     * their own assertion below.
     */
    it("only link to /docs/ pages that exist", (): void => {
      for (const page of OWNED_PAGES) {
        const targets: Array<string> = Array.from(
          readPage(page).matchAll(/\]\((\/docs\/[^)#]+)(?:#[^)]*)?\)/g),
        )
          .map((match: RegExpMatchArray): string => {
            return match[1] as string;
          })
          .filter((target: string): boolean => {
            return !target.startsWith(STATIC_PREFIX);
          });

        expect(targets.length).toBeGreaterThan(0);

        for (const target of targets) {
          expect({
            page,
            target,
            exists: fs.existsSync(pageFile("en", target.replace("/docs/", ""))),
          }).toEqual({ page, target, exists: true });
        }
      }
    });

    /*
     * Every screenshot a page embeds must be a real file, in both languages:
     * the Persian pages reuse the English assets, so a rename that misses
     * one of them shows the reader a broken image rather than failing here.
     */
    it("embed screenshots that exist on disk, in every language", (): void => {
      for (const language of ["en", "fa"]) {
        for (const page of OWNED_PAGES) {
          const images: Array<string> = Array.from(
            readPage(page, language).matchAll(
              /!\[[^\]]*\]\((\/docs\/static\/[^)]+)\)/g,
            ),
          ).map((match: RegExpMatchArray): string => {
            return match[1] as string;
          });

          for (const image of images) {
            expect({
              language,
              page,
              image,
              exists: fs.existsSync(
                path.join(STATIC_DIR, image.replace(STATIC_PREFIX, "")),
              ),
            }).toEqual({ language, page, image, exists: true });
          }
        }
      }
    });

    it("cross-link each other", (): void => {
      expect(readPage(TELEMETRY_PAGE)).toContain(`](/docs/${MONITOR_PAGE})`);
      expect(readPage(MONITOR_PAGE)).toContain(`](/docs/${TELEMETRY_PAGE})`);
    });

    it("carry no Proxmox-only concepts", (): void => {
      for (const page of OWNED_PAGES) {
        const markdown: string = readPage(page);

        for (const stray of [
          "pve_",
          "PVE_",
          "PROXMOX_CLUSTER_NAME",
          "proxmox.cluster.name",
          "pve-exporter",
          "QEMU guest agent",
          "quorum",
          "backup coverage",
          "replication",
        ]) {
          expect({ page, stray, present: markdown.includes(stray) }).toEqual({
            page,
            stray,
            present: false,
          });
        }
      }
    });
  });

  describe("navigation", (): void => {
    it("lists the VMware monitor page in the Monitor group, right after the other infrastructure monitors", (): void => {
      const urls: Array<string> = navGroup("Monitor").links.map(
        (link: NavLink): string => {
          return link.url;
        },
      );

      const index: number = urls.indexOf(`/docs/${MONITOR_PAGE}`);

      expect(index).toBeGreaterThan(0);
      expect(urls[index - 1]).toBe("/docs/monitor/iot-device-monitor");
      expect(urls.indexOf("/docs/monitor/proxmox-monitor")).toBeLessThan(index);
    });

    it("lists the VMware agent page in the Telemetry group, next to the other agents", (): void => {
      const urls: Array<string> = navGroup("Telemetry").links.map(
        (link: NavLink): string => {
          return link.url;
        },
      );

      const index: number = urls.indexOf(`/docs/${TELEMETRY_PAGE}`);

      expect(index).toBeGreaterThan(0);
      expect(urls[index - 1]).toBe("/docs/telemetry/docker-swarm");
      expect(urls.indexOf("/docs/telemetry/proxmox")).toBeLessThan(index);
    });

    it("uses the product's titles", (): void => {
      const titles: Array<string> = [
        ...navGroup("Monitor").links,
        ...navGroup("Telemetry").links,
      ].map((link: NavLink): string => {
        return link.title;
      });

      expect(titles).toEqual(
        expect.arrayContaining(["VMware Monitor", "VMware Agent"]),
      );
    });

    it("resolves every Monitor- and Telemetry-group URL to an English page on disk", (): void => {
      for (const link of [
        ...navGroup("Monitor").links,
        ...navGroup("Telemetry").links,
      ]) {
        expect({
          url: link.url,
          exists: fs.existsSync(pageFile("en", link.url.replace("/docs/", ""))),
        }).toEqual({ url: link.url, exists: true });
      }
    });
  });

  describe("monitor page", (): void => {
    it("lists every metric in the catalog in its category's table, with the catalog's unit", (): void => {
      const markdown: string = readPage(MONITOR_PAGE);
      const catalog: string = section(markdown, "## Collected Metrics");
      const rows: Map<string, string> = metricTableRows(catalog);
      const metrics: Array<VMwareMetricDefinition> = getAllVMwareMetrics();

      expect(metrics.length).toBeGreaterThan(0);

      for (const metric of metrics) {
        const row: string | undefined = rows.get(metric.metricName);

        expect({ metric: metric.metricName, listed: Boolean(row) }).toEqual({
          metric: metric.metricName,
          listed: true,
        });
        expect(row).toContain(`\`${metric.unit}\``);
      }
    });

    it("lists nothing the catalog does not ship", (): void => {
      const catalog: string = section(
        readPage(MONITOR_PAGE),
        "## Collected Metrics",
      );
      const shipped: Set<string> = new Set<string>(
        getAllVMwareMetrics().map((metric: VMwareMetricDefinition): string => {
          return metric.metricName;
        }),
      );

      for (const name of metricTableRows(catalog).keys()) {
        expect({ name, shipped: shipped.has(name) }).toEqual({
          name,
          shipped: true,
        });
      }
    });

    it("has one metric table per catalog category, in catalog order", (): void => {
      const catalog: string = section(
        readPage(MONITOR_PAGE),
        "## Collected Metrics",
      );
      const headings: Array<string> = catalog
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("### ");
        })
        .map((line: string): string => {
          return line.replace(/^### /, "");
        });

      /* "Host (ESXi)" carries a qualifier; the rest are the category names. */
      const normalized: Array<string> = headings.map(
        (heading: string): string => {
          return heading.replace(/\s*\(.*\)$/, "");
        },
      );

      expect(normalized).toEqual(getAllVMwareMetricCategories());
    });

    it("groups each metric under its catalog category", (): void => {
      const catalog: string = section(
        readPage(MONITOR_PAGE),
        "## Collected Metrics",
      );

      for (const category of getAllVMwareMetricCategories()) {
        const heading: string | undefined = catalog
          .split("\n")
          .find((line: string): boolean => {
            return line.startsWith(`### ${category}`);
          });

        expect({ category, heading }).toBeDefined();

        const rows: Map<string, string> = metricTableRows(
          section(catalog, heading as string),
        );

        for (const metric of getAllVMwareMetrics()) {
          expect({
            metric: metric.metricName,
            category,
            listedHere: rows.has(metric.metricName),
          }).toEqual({
            metric: metric.metricName,
            category,
            listedHere: metric.category === category,
          });
        }
      }
    });

    it("lists every alert template by its exact name, with its severity, and states the count", (): void => {
      const markdown: string = readPage(MONITOR_PAGE);
      const templates: Array<VMwareAlertTemplate> =
        getAllVMwareAlertTemplates();
      const table: string = section(markdown, "## Pre-built Alert Templates");

      expect(table).toContain(`OneUptime ships ${templates.length} templates`);

      for (const template of templates) {
        const row: string | undefined = table
          .split("\n")
          .find((line: string): boolean => {
            return line.startsWith(`| ${template.name} `);
          });

        expect({ template: template.name, row }).toBeDefined();
        expect({ template: template.name, listed: Boolean(row) }).toEqual({
          template: template.name,
          listed: true,
        });
        expect(row).toContain(`| ${template.severity} `);
        expect(row).toContain(`| ${template.category} `);
      }
    });

    it("lists no template the registry does not ship", (): void => {
      const table: string = section(
        readPage(MONITOR_PAGE),
        "## Pre-built Alert Templates",
      );
      const shipped: Set<string> = new Set<string>(
        getAllVMwareAlertTemplates().map(
          (template: VMwareAlertTemplate): string => {
            return template.name;
          },
        ),
      );

      const rows: Array<string> = table
        .split("\n")
        .filter((line: string): boolean => {
          return (
            line.startsWith("| ") &&
            !line.startsWith("| Template ") &&
            !line.startsWith("| -")
          );
        })
        .map((line: string): string => {
          return (line.split("|")[1] as string).trim();
        });

      expect(rows.length).toBe(shipped.size);

      for (const name of rows) {
        expect({ name, shipped: shipped.has(name) }).toEqual({
          name,
          shipped: true,
        });
      }
    });

    it("names the metric each template watches", (): void => {
      const table: string = section(
        readPage(MONITOR_PAGE),
        "## Pre-built Alert Templates",
      );

      for (const template of getAllVMwareAlertTemplates()) {
        const row: string = table.split("\n").find((line: string): boolean => {
          return line.startsWith(`| ${template.name} `);
        }) as string;

        /*
         * The template's own description names the metric it is built on
         * (e.g. "(vcenter.host.cpu.utilization, one incident per host)").
         */
        const metric: string = (
          template.description.match(/vcenter\.[a-z_.]+/) as RegExpMatchArray
        )[0];

        expect({ template: template.name, metric, row }).toBeDefined();
        expect(row).toContain(`\`${metric}\``);
      }
    });

    it("documents the identity attributes, the vCenter scope and the Terraform escape hatch", (): void => {
      const markdown: string = readPage(MONITOR_PAGE);

      for (const key of VMwareVCenterNameLabelKeys) {
        expect(markdown).toContain(`\`${key}\``);
      }

      for (const attribute of [
        "resource.vcenter.datacenter.name",
        "resource.vcenter.cluster.name",
        "resource.vcenter.host.name",
        "resource.vcenter.vm.name",
        "resource.vcenter.datastore.name",
        "resource.vcenter.resource_pool.inventory_path",
      ]) {
        expect(markdown).toContain(`\`${attribute}\``);
      }

      expect(markdown).toContain("`vmware_monitor`");
      expect(markdown).toContain("`vmwareMonitor`");
      expect(markdown).toContain("`vcenterIdentifier`");
      expect(markdown).toContain("](/docs/terraform/monitor-steps)");
    });
  });

  describe("telemetry page", (): void => {
    it("documents every environment variable the agent's docker-compose.yml passes, and nothing else", (): void => {
      const table: string = section(
        readPage(TELEMETRY_PAGE),
        "## Environment Variables",
      );
      const documented: Array<string> = table
        .split("\n")
        .map((line: string): string | null => {
          const match: RegExpMatchArray | null = line.match(
            /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/,
          );
          return match ? (match[1] as string) : null;
        })
        .filter((name: string | null): name is string => {
          return name !== null;
        });

      expect(documented.sort()).toEqual(composeEnvironmentVariables().sort());
    });

    it("uses the same .env example the compose quick start and the E2E spec expect", (): void => {
      const quickStart: string = section(
        readPage(TELEMETRY_PAGE),
        "## Alternative — Docker Compose",
      );

      for (const name of composeEnvironmentVariables()) {
        expect(quickStart).toContain(`${name}=`);
      }

      expect(quickStart).toContain("VMWARE_VCENTER_NAME=my-vcenter");
      expect(quickStart).toContain("docker compose up -d");
    });

    it("names the discovery attribute, the agent paths and the read-only role", (): void => {
      const markdown: string = readPage(TELEMETRY_PAGE);

      expect(markdown).toContain("`vmware.vcenter.name`");
      expect(markdown).toContain("`/opt/oneuptime-vmware-agent`");
      expect(markdown).toContain("oneuptime-vmware-agent");
      expect(markdown).toContain(
        "https://raw.githubusercontent.com/OneUptime/oneuptime/master/VMwareAgent/install.sh",
      );
      expect(markdown).toContain(
        "https://raw.githubusercontent.com/OneUptime/oneuptime/master/VMwareAgent/troubleshoot.sh",
      );
      expect(markdown).toContain("**Read-Only**");
      expect(markdown).toContain("Propagate to children");
      expect(markdown).toContain("/otlp/v1/validate");
      expect(markdown).toContain("Telemetry & APM → Ingestion Keys");
    });

    it("lists the identity resource attributes and the collected metric families", (): void => {
      const collected: string = section(
        readPage(TELEMETRY_PAGE),
        "## What Gets Collected",
      );

      for (const attribute of [
        "vcenter.datacenter.name",
        "vcenter.cluster.name",
        "vcenter.host.name",
        "vcenter.vm.name",
        "vcenter.vm.id",
        "vcenter.datastore.name",
        "vcenter.resource_pool.inventory_path",
        "vcenter.vm_template.name",
      ]) {
        expect(collected).toContain(`\`${attribute}\``);
      }

      /*
       * Every catalog metric family (the `vcenter.<object>.<signal>` head)
       * must be named on the install guide's what-gets-collected table.
       */
      const heads: Set<string> = new Set<string>(
        getAllVMwareMetrics().map((metric: VMwareMetricDefinition): string => {
          return metric.metricName.split(".").slice(0, 3).join(".");
        }),
      );

      for (const head of heads) {
        expect({ head, named: collected.includes(head) }).toEqual({
          head,
          named: true,
        });
      }
    });

    it("explains the VM power-state inference and the syslog option", (): void => {
      const markdown: string = readPage(TELEMETRY_PAGE);

      expect(markdown).toContain("### VM Power State");
      expect(markdown).toContain("send_batch_max_size");
      expect(markdown).toContain("## Optional — Ship ESXi Syslog");
      expect(markdown).toContain("Syslog.global.logHost");
      expect(markdown).toContain("5514");
    });

    it("gives the real Docker Compose .env quoting rule and only promises what install.sh does", (): void => {
      const markdown: string = readPage(TELEMETRY_PAGE);
      const readme: string = fs.readFileSync(
        path.join(AGENT_DIR, "README.md"),
        "utf8",
      );
      const installScript: string = fs.readFileSync(
        path.join(AGENT_DIR, "install.sh"),
        "utf8",
      );
      const doctorScript: string = fs.readFileSync(
        path.join(AGENT_DIR, "troubleshoot.sh"),
        "utf8",
      );

      for (const text of [markdown, readme]) {
        /*
         * Compose v2 strips quotes, interpolates $VAR in unquoted and
         * double-quoted values and treats " #" as a comment: single quotes
         * are the only literal form. Telling users to drop them steers
         * them away from the one fix for a password containing $ or #.
         */
        expect(text).not.toContain("without quotes");
        expect(text).not.toContain("quotes included");
        expect(text).toContain("`VCENTER_PASSWORD='p@ss$word'`");
        expect(text).toContain("single-quoted");

        /* The Upgrading section may only promise what install.sh does. */
        expect(text).not.toContain("keeps your `.env`");
        expect(text).toContain("reuses every value in your existing `.env`");
      }

      expect(doctorScript).not.toContain("(no quotes)");

      /* install.sh quotes every user-supplied value for Compose ... */
      expect(installScript).toContain("compose_env_quote() {");
      for (const name of [
        "ONEUPTIME_URL",
        "ONEUPTIME_TELEMETRY_INGESTION_KEY",
        "VMWARE_VCENTER_NAME",
        "VCENTER_ENDPOINT",
        "VCENTER_USERNAME",
        "VCENTER_PASSWORD",
      ]) {
        expect(installScript).toContain(
          `${name}=$(compose_env_quote "$${name}")`,
        );
      }
      expect(installScript).not.toMatch(
        /^VCENTER_PASSWORD=\$VCENTER_PASSWORD$/m,
      );

      /* ... and reuses an existing .env on a re-run instead of re-prompting. */
      expect(installScript).toContain('if [ -f "$ENV_FILE" ]; then');
      expect(installScript).toContain("dotenv_get() {");
      expect(installScript).toContain(
        'printf -v "$name" \'%s\' "$(dotenv_get "$name" "$ENV_FILE")"',
      );
    });

    it("matches the agent config it documents", (): void => {
      const config: string = fs.readFileSync(
        path.join(AGENT_DIR, "otel-collector-config.yaml"),
        "utf8",
      );
      const markdown: string = readPage(TELEMETRY_PAGE);

      /* The metrics the guide says are off by default must really be optional in the config. */
      for (const optional of [
        "vcenter.vm.cpu.time",
        "vcenter.vm.memory.granted",
        "vcenter.host.memory.active",
        "vcenter.host.memory.ballooned",
        "vcenter.host.memory.granted",
        "vcenter.vm.network.broadcast.packet.rate",
        "vcenter.vm.network.multicast.packet.rate",
      ]) {
        expect(config).toContain(optional);
        expect(markdown).toContain(optional);
      }

      expect(config).toContain("vcenter.host.memory.capacity:");
      expect(markdown).toContain("`vcenter.host.memory.capacity`");
      expect(config).toContain("vmware.vcenter.name");
      expect(config).toContain("5514");
    });
  });

  describe("translations", (): void => {
    it("ship both pages in every translated language", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const page of OWNED_PAGES) {
          expect({
            language,
            page,
            exists: fs.existsSync(pageFile(language, page)),
          }).toEqual({ language, page, exists: true });
        }
      }
    });

    it("keep every backticked identifier, in order", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const page of OWNED_PAGES) {
          expect({
            language,
            page,
            identifiers: backtickedIdentifiers(readPage(page, language)),
          }).toEqual({
            language,
            page,
            identifiers: backtickedIdentifiers(readPage(page)),
          });
        }
      }
    });

    it("keep every code block byte-identical", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const page of OWNED_PAGES) {
          expect({
            language,
            page,
            blocks: codeBlocks(readPage(page, language)),
          }).toEqual({ language, page, blocks: codeBlocks(readPage(page)) });
        }
      }
    });

    it("keep the same heading structure, table row counts and line count", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const page of OWNED_PAGES) {
          const english: Array<string> = readPage(page).split("\n");
          const translated: Array<string> = readPage(page, language).split(
            "\n",
          );

          expect({ language, page, lines: translated.length }).toEqual({
            language,
            page,
            lines: english.length,
          });

          const shape: (lines: Array<string>) => Array<string> = (
            lines: Array<string>,
          ): Array<string> => {
            return lines.map((line: string): string => {
              const heading: RegExpMatchArray | null =
                line.match(/^(#{1,6})\s/);
              if (heading) {
                return heading[1] as string;
              }
              if (line.startsWith("|")) {
                return "|";
              }
              if (FENCE_LINE.test(line)) {
                return "```";
              }
              return "";
            });
          };

          expect(shape(translated)).toEqual(shape(english));
        }
      }
    });

    it("keep every alert template name untranslated so the picker and the docs agree", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        const markdown: string = readPage(MONITOR_PAGE, language);

        for (const template of getAllVMwareAlertTemplates()) {
          expect({
            language,
            template: template.name,
            present: markdown.includes(`| ${template.name} `),
          }).toEqual({ language, template: template.name, present: true });
        }
      }
    });

    it("mention the reserved vCenter attribute and the Terraform escape hatch where English does", (): void => {
      for (const language of ["en", ...TRANSLATED_LANGUAGES]) {
        expect(readPage("monitor/custom-code-monitor", language)).toContain(
          "`vmware.vcenter.name`",
        );
        expect(readPage("terraform/monitor-steps", language)).toContain(
          "`vmware_monitor`",
        );
      }
    });
  });

  describe("terraform provider", (): void => {
    it("registers the vmware_monitor escape hatch on the MonitorStep key the Common layer defines", (): void => {
      const source: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "Scripts/TerraformProvider/StaticFiles/monitorsteps.go",
        ),
        "utf8",
      );

      expect(source).toContain('{"vmware_monitor", "vmwareMonitor"},');
      expect(source).toMatch(/"vmware_monitor":\s+"Raw JSON escape hatch/);
    });
  });
});
