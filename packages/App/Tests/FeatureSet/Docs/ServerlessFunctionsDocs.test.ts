import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  CLOUD_PLATFORM_ALIASES,
  FAAS_CLOUD_PLATFORM_VALUES,
  FaasCloudPlatform,
  normalizeCloudPlatform,
} from "Common/Types/Cloud/CloudPlatform";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Serverless Functions docs page against the product it describes.
 *
 * Ingest now keys a function on faas.name OR — on a FaaS cloud.platform —
 * on service.name, and writes that identity onto the rows as faas.name
 * (OtelIngestBaseService.stampServerlessFunctionNameAttribute), which is
 * what makes Azure Functions work: its resource detectors set service.name
 * and cloud.platform but never faas.name. The page used to call faas.name
 * required and said nothing about Azure. These tests pin the parts a
 * reader acts on — the identification rules, the Azure Functions setup
 * (host.json, the application settings, the per-language worker packages)
 * and its limits — and tie each claim that ingest could contradict back to
 * the code: the FaaS platform registry, the platform aliases and the OTLP
 * routes the exporter is told to post to.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Docs/Content/en",
);
const OTEL_INGEST_ROUTER_FILE: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Telemetry/API/OTelIngest.ts",
);

const PAGE: string = "telemetry/serverless-functions";
const PAGE_URL: string = `/docs/${PAGE}`;
const MICROSOFT_GUIDE_URL: string =
  "https://learn.microsoft.com/en-us/azure/azure-functions/opentelemetry-howto";

const FENCE_LINE: RegExp = /^\s*```/;
/* A table row whose first cell is a backticked attribute name. */
const ATTRIBUTE_ROW: RegExp = /^\|\s*`[^`]+`/;

function pageFile(relative: string): string {
  return path.join(CONTENT_DIR, `${relative}.md`);
}

function readPage(): string {
  return fs.readFileSync(pageFile(PAGE), "utf8");
}

/* The body of one heading's section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];
  let inFence: boolean = false;

  for (const line of lines.slice(start + 1)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/* Headings of one level, in page order, skipping fenced code. */
function headings(markdown: string, level: number): Array<string> {
  const found: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    const match: RegExpMatchArray | null = line.match(/^(#{1,6})\s+(.*)$/);
    if (!inFence && match && (match[1] as string).length === level) {
      found.push(line.trim());
    }
  }

  return found;
}

interface FencedBlock {
  info: string;
  body: string;
}

function fencedBlocks(markdown: string): Array<FencedBlock> {
  const blocks: Array<FencedBlock> = [];
  let open: { info: string; lines: Array<string> } | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (open) {
        blocks.push({ info: open.info, body: open.lines.join("\n") });
        open = null;
      } else {
        open = { info: line.trim().replace(/^```/, "").trim(), lines: [] };
      }
      continue;
    }
    if (open) {
      open.lines.push(line);
    }
  }

  expect(open).toBeNull();
  return blocks;
}

/* The table row whose first cell is exactly the backticked attribute. */
function tableRow(markdown: string, attribute: string): string {
  const row: string | undefined = markdown
    .split("\n")
    .find((line: string): boolean => {
      return new RegExp(
        `^\\|\\s*\`${attribute.replace(/\./g, "\\.")}\`\\s*\\|`,
      ).test(line);
    });

  expect({ attribute, found: row !== undefined }).toEqual({
    attribute,
    found: true,
  });

  return row as string;
}

function tableRows(markdown: string): Array<string> {
  return markdown.split("\n").filter((line: string): boolean => {
    return ATTRIBUTE_ROW.test(line);
  });
}

function cells(row: string): Array<string> {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

interface AzAppSettingsCommand {
  // The command on one line, continuations joined.
  command: string;
  // --name, --resource-group, ... and their values.
  options: Map<string, string>;
  // Each --settings entry, split on its first "=".
  settings: Map<string, string>;
}

/*
 * The one `az functionapp config appsettings set` block of a section: every
 * line but the last continues the command, and the words split the way a
 * shell splits them (double quotes group a word and are removed).
 */
function azAppSettingsCommand(text: string): AzAppSettingsCommand {
  const bash: Array<FencedBlock> = fencedBlocks(text).filter(
    (block: FencedBlock): boolean => {
      return block.info === "bash";
    },
  );

  expect(bash).toHaveLength(1);
  const lines: Array<string> = (bash[0] as FencedBlock).body.split("\n");

  expect(lines[0]).toBe("az functionapp config appsettings set \\");
  lines.slice(0, -1).forEach((line: string): void => {
    expect({ line, continues: line.endsWith(" \\") }).toEqual({
      line,
      continues: true,
    });
  });
  expect((lines[lines.length - 1] as string).endsWith("\\")).toBe(false);

  const command: string = lines
    .map((line: string): string => {
      return line.replace(/\\$/, "").trim();
    })
    .join(" ");
  const words: Array<string> = Array.from(
    command.matchAll(/"([^"]*)"|(\S+)/g),
  ).map((match: RegExpMatchArray): string => {
    return (match[1] ?? match[2]) as string;
  });

  expect(words.slice(0, 5)).toEqual([
    "az",
    "functionapp",
    "config",
    "appsettings",
    "set",
  ]);

  const options: Map<string, string> = new Map<string, string>();
  const settings: Map<string, string> = new Map<string, string>();
  let index: number = 5;
  while (index < words.length) {
    const word: string = words[index] as string;
    if (word === "--settings") {
      for (const setting of words.slice(index + 1)) {
        const equals: number = setting.indexOf("=");
        expect({ setting, named: equals > 0 }).toEqual({
          setting,
          named: true,
        });
        settings.set(setting.slice(0, equals), setting.slice(equals + 1));
      }
      break;
    }
    expect({ word, isOption: word.startsWith("--") }).toEqual({
      word,
      isOption: true,
    });
    options.set(word, words[index + 1] as string);
    index += 2;
  }

  return { command, options, settings };
}

/* `a=b,c=d` (the OTEL_RESOURCE_ATTRIBUTES format) as a map. */
function resourceAttributes(value: string): Map<string, string> {
  return new Map<string, string>(
    value.split(",").map((pair: string): [string, string] => {
      const equals: number = pair.indexOf("=");
      expect({ pair, named: equals > 0 }).toEqual({ pair, named: true });
      return [pair.slice(0, equals).trim(), pair.slice(equals + 1).trim()];
    }),
  );
}

describe("Serverless Functions docs", (): void => {
  describe("page", (): void => {
    it("opens with the H1 the renderer strips and keeps every fence closed", (): void => {
      const markdown: string = readPage();

      expect(markdown.split("\n")[0]).toBe("# Serverless Functions");

      const fences: number = markdown
        .split("\n")
        .filter((line: string): boolean => {
          return FENCE_LINE.test(line);
        }).length;
      expect(fences % 2).toBe(0);
    });

    it("keeps its sections in reading order, with Azure Functions after the Lambda layer", (): void => {
      expect(headings(readPage(), 2)).toEqual([
        "## Overview",
        "## Prerequisites",
        "## How OneUptime identifies a function",
        "## Step 1 — Set the OTLP exporter environment variables",
        "## Step 2 — (AWS Lambda) add the OpenTelemetry layer",
        "## Azure Functions",
        "## What you get",
      ]);

      expect(headings(section(readPage(), "## Azure Functions"), 3)).toEqual([
        "### How a Function App shows up",
        "### Step 1 — Turn on OpenTelemetry in the Functions host",
        "### Step 2 — Point the host at OneUptime",
        "### Step 3 — (Optional) instrument your function code",
        "### Limitations",
      ]);
    });

    /*
     * Same rule as Scripts/Docs/CheckAnchors.ts, through the renderer's own
     * slugify: an in-page link resolves only if a heading slugifies to it.
     */
    it("resolves every in-page anchor and every /docs link", (): void => {
      const markdown: string = readPage();
      const slugs: Set<string> = new Set<string>(
        [2, 3, 4].flatMap((level: number): Array<string> => {
          return headings(markdown, level).map((heading: string): string => {
            return slugify(heading.replace(/^#+\s+/, ""));
          });
        }),
      );

      const anchors: Array<string> = Array.from(
        markdown.matchAll(/\]\(#([^)]+)\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });
      expect(anchors).toContain("azure-functions");
      for (const anchor of anchors) {
        expect({ anchor, resolves: slugs.has(anchor) }).toEqual({
          anchor,
          resolves: true,
        });
      }

      for (const match of markdown.matchAll(
        /\]\((\/docs\/[^)#]+)(?:#[^)]*)?\)/g,
      )) {
        const target: string = match[1] as string;
        expect({
          target,
          exists: fs.existsSync(pageFile(target.replace("/docs/", ""))),
        }).toEqual({ target, exists: true });
      }
    });

    it("uses the house placeholders, never a real-looking token or host", (): void => {
      const markdown: string = readPage();

      expect(markdown).toContain("YOUR_TELEMETRY_INGESTION_TOKEN");
      expect(markdown).toContain("https://YOUR-ONEUPTIME-HOST/otlp");
      const tokens: Array<string> = Array.from(
        markdown.matchAll(/x-oneuptime-token=(\S+?)["`\s]/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });
      // Step 1, the Lambda layer and the Azure app settings.
      expect(tokens.length).toBeGreaterThanOrEqual(3);
      for (const token of tokens) {
        expect(token).toBe("YOUR_TELEMETRY_INGESTION_TOKEN");
      }
    });
  });

  describe("navigation", (): void => {
    /*
     * Docs/Index.ts serves a page only through a nav link, and resolves a
     * request to the FIRST link whose URL contains the requested path.
     */
    it("is the link the docs router resolves the page to", (): void => {
      const all: Array<NavLink> = DocsNav.flatMap(
        (group: NavGroup): Array<NavLink> => {
          return group.links;
        },
      );
      const resolved: NavLink | undefined = all.find(
        (link: NavLink): boolean => {
          return link.url.toLocaleLowerCase().includes(PAGE);
        },
      );

      expect(resolved).toEqual({
        title: "Serverless Functions",
        url: PAGE_URL,
      });

      const telemetry: NavGroup | undefined = DocsNav.find(
        (group: NavGroup): boolean => {
          return group.title === "Telemetry";
        },
      );
      expect(telemetry?.links).toContainEqual(resolved);
    });
  });

  describe("how a function is identified", (): void => {
    const identification: () => string = (): string => {
      return section(readPage(), "## How OneUptime identifies a function");
    };

    it("no longer calls faas.name unconditionally required", (): void => {
      const required: string = cells(
        tableRow(identification(), "faas.name"),
      )[1] as string;

      expect(required).not.toBe("**yes**");
      expect(required).toContain("unless");
    });

    it("lists every FaaS cloud.platform ingest falls back on, and nothing else", (): void => {
      const row: string = tableRow(identification(), "cloud.platform");
      const listed: Array<string> = Array.from(
        (cells(row)[2] as string).matchAll(/`([^`]+)`/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(listed.sort()).toEqual(
        Array.from(FAAS_CLOUD_PLATFORM_VALUES).sort(),
      );
      for (const platform of Object.values(FaasCloudPlatform)) {
        expect(row).toContain(`\`${platform}\``);
      }
    });

    it("documents the service.name fallback and the faas.name it writes", (): void => {
      const text: string = identification();
      const row: Array<string> = cells(tableRow(text, "service.name"));

      expect(row[1]).toContain("FaaS `cloud.platform`");
      expect(row[1]).toContain("without `faas.name`");
      expect(row[2]).toContain("written onto the telemetry as `faas.name`");

      expect(text).toContain(
        "uses its `service.name` as the function's identity",
      );
      expect(text).toContain("A `faas.name` you set is never replaced.");
      // The header is not an attribute, so it never names a function.
      expect(text).toContain("`x-oneuptime-service-name` header");
    });

    /*
     * The generic Step 1 example sets a function's faas.name on the
     * resource. On a Function App that names every function of the app
     * after one of them, so the step points Azure readers away from it.
     */
    it("keeps Azure readers from copying the generic faas.name example", (): void => {
      const step1: string = section(
        readPage(),
        "## Step 1 — Set the OTLP exporter environment variables",
      );
      const example: Array<FencedBlock> = fencedBlocks(step1);

      expect(example).toHaveLength(1);
      expect((example[0] as FencedBlock).body).toContain(
        'OTEL_RESOURCE_ATTRIBUTES="faas.name=',
      );
      expect(step1).toContain(
        "On Azure Functions, leave `faas.name` out of `OTEL_RESOURCE_ATTRIBUTES` — see [Azure Functions](#azure-functions).",
      );
    });

    it("says the dotted azure.functions spelling is accepted — and ingest does accept it", (): void => {
      expect(identification()).toContain("`azure.functions`");
      expect(CLOUD_PLATFORM_ALIASES["azure.functions"]).toBe(
        FaasCloudPlatform.AzureFunctions,
      );
      expect(
        FAAS_CLOUD_PLATFORM_VALUES.has(FaasCloudPlatform.AzureFunctions),
      ).toBe(true);
    });
  });

  describe("Azure Functions", (): void => {
    const azure: () => string = (): string => {
      return section(readPage(), "## Azure Functions");
    };

    it("links Microsoft's OpenTelemetry guide", (): void => {
      expect(azure()).toContain(`](${MICROSOFT_GUIDE_URL})`);
    });

    it("describes what Azure's detectors put on the resource, and that none sets faas.name", (): void => {
      const text: string = section(azure(), "### How a Function App shows up");

      expect(text).toContain(
        "`Microsoft.Azure.Functions.Worker.OpenTelemetry`",
      );
      expect(text).toContain("`@opentelemetry/resource-detector-azure`");
      expect(text).toContain("none of them sets `faas.name`");

      expect(
        tableRows(text).map((row: string): string => {
          return cells(row)[0] as string;
        }),
      ).toEqual([
        "`service.name`",
        "`cloud.provider`",
        "`cloud.platform`",
        "`cloud.region`",
        "`cloud.resource_id`",
        "`faas.instance`",
      ]);
      expect(tableRow(text, "service.name")).toContain("`WEBSITE_SITE_NAME`");
      expect(tableRow(text, "cloud.provider")).toContain("`azure`");
      expect(tableRow(text, "cloud.platform")).toContain(
        `\`${FaasCloudPlatform.AzureFunctions}\``,
      );
      expect(tableRow(text, "cloud.platform")).toContain("`azure.functions`");
      expect(tableRow(text, "cloud.region")).toContain("`REGION_NAME`");
      expect(tableRow(text, "cloud.resource_id")).toContain(
        "providers/Microsoft.Web/sites/",
      );
      expect(tableRow(text, "faas.instance")).toContain(
        "`WEBSITE_INSTANCE_ID`",
      );
      expect(tableRow(text, "faas.instance")).toContain(
        "Node.js detector only",
      );
    });

    it("explains one function per Function App, and where the individual functions are", (): void => {
      const text: string = section(azure(), "### How a Function App shows up");

      expect(text).toContain("**one Serverless Function per Function App**");
      expect(text).toContain(
        "fills in `faas.name` with the Function App's name",
      );
      expect(text).toContain("`faas.invoke_duration`, a histogram in seconds");
      expect(text).toContain("data-point attribute `faas.name`");
      expect(text).toContain("`OTEL_SERVICE_NAME`");
    });

    /*
     * The reason is that the resource describes the app — not that the app
     * is one process: on Flex Consumption the platform "scales all other
     * functions in the app individually in their own set of instances"
     * (Microsoft's Flex Consumption plan page), and the host tags a
     * function group only there (HostMetrics: "FunctionGroup is only used
     * in Flex Consumption").
     */
    it("grounds one function per app in the resource, not in one process", (): void => {
      const text: string = section(azure(), "### How a Function App shows up");

      expect(text).not.toContain("one process");
      expect(text).toContain(
        "The resource describes the app, not one of its functions",
      );
      expect(text).toContain(
        "every instance reports the same app-level attributes",
      );
      expect(text).toContain("Flex Consumption");
    });

    /*
     * App settings are environment variables of every process of the app,
     * and the host builds its resource from ResourceBuilder.CreateDefault(),
     * which reads OTEL_RESOURCE_ATTRIBUTES. A faas.name there is usable, so
     * ingest keys the whole app on it and never stamps over it.
     */
    it("warns against a faas.name on the Function App's resource", (): void => {
      const text: string = section(azure(), "### How a Function App shows up");

      expect(text).toContain(
        "Don't add `faas.name` to `OTEL_RESOURCE_ATTRIBUTES` on a Function App, as the generic [Step 1](#step-1-set-the-otlp-exporter-environment-variables) example does.",
      );
      expect(text).toContain(
        "OneUptime never replaces a `faas.name` it is given",
      );
      expect(text).toContain(
        "don't put function-specific values on the resource",
      );
      // The same promise the identification section makes.
      expect(
        section(readPage(), "## How OneUptime identifies a function"),
      ).toContain("A `faas.name` you set is never replaced.");
    });

    it("says a worker without a FaaS cloud.platform joins no function", (): void => {
      const text: string = section(azure(), "### How a Function App shows up");

      expect(text).toContain(
        "a worker that reports a second name makes a second Serverless Function",
      );
      expect(text).toContain(
        "A worker whose resource has no FaaS `cloud.platform` joins no Serverless Function at all — see [Step 3](#step-3-optional-instrument-your-function-code).",
      );
    });

    it("turns the host on with a host.json that parses", (): void => {
      const text: string = section(
        azure(),
        "### Step 1 — Turn on OpenTelemetry in the Functions host",
      );
      const json: Array<FencedBlock> = fencedBlocks(text).filter(
        (block: FencedBlock): boolean => {
          return block.info === "json";
        },
      );

      expect(json).toHaveLength(1);
      expect(JSON.parse((json[0] as FencedBlock).body)).toEqual({
        version: "2.0",
        telemetryMode: "OpenTelemetry",
      });
      expect(text).toContain('`"telemetryMode": "OpenTelemetry"`');
      expect(text).toContain("Service Bus and Event Hubs");
      expect(text).toContain("`faas.invoke_duration`");
    });

    it("sets the exporter with a well-formed az command", (): void => {
      const text: string = section(
        azure(),
        "### Step 2 — Point the host at OneUptime",
      );
      const { command, options, settings }: AzAppSettingsCommand =
        azAppSettingsCommand(text);

      for (const argument of [
        "--name my-function-app",
        "--resource-group my-rg",
        "--settings",
        "OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp",
        "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
        '"OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"',
      ]) {
        expect(command).toContain(argument);
      }
      expect(Object.fromEntries(options)).toEqual({
        "--name": "my-function-app",
        "--resource-group": "my-rg",
      });
      expect(Object.fromEntries(settings)).toEqual({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://oneuptime.com/otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        OTEL_EXPORTER_OTLP_HEADERS:
          "x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN",
      });
    });

    it("names only OTLP routes ingest serves", (): void => {
      const text: string = section(
        azure(),
        "### Step 2 — Point the host at OneUptime",
      );
      const router: string = fs.readFileSync(OTEL_INGEST_ROUTER_FILE, "utf8");
      const routes: Array<string> = Array.from(
        text.matchAll(/`(\/otlp\/v1\/[a-z]+)`/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(routes.sort()).toEqual([
        "/otlp/v1/logs",
        "/otlp/v1/metrics",
        "/otlp/v1/traces",
      ]);
      for (const route of routes) {
        expect(router).toContain(`"${route}"`);
      }
      expect(text).toContain("`https://YOUR-ONEUPTIME-HOST/otlp`");
      expect(text).toContain("defaults to gRPC");
    });

    it("keeps Application Insights optional: both destinations receive the data when both are set", (): void => {
      const text: string = section(
        azure(),
        "### Step 2 — Point the host at OneUptime",
      );

      expect(text).toContain("`APPLICATIONINSIGHTS_CONNECTION_STRING`");
      expect(text).toContain(
        "with both set, the host sends the same OpenTelemetry data to Application Insights and to OneUptime",
      );
      expect(text).toContain("**This token is a secret.**");
      expect(text).toContain("@Microsoft.KeyVault(SecretUri=");
    });

    /*
     * A Key Vault reference resolves to the secret's value verbatim, and
     * OTEL_EXPORTER_OTLP_HEADERS needs a whole `name=value` pair — a secret
     * holding the bare token sends no x-oneuptime-token header at all. The
     * sibling pages (cloud-other-platforms, cloud-azure-container-apps,
     * cloud-gcp-cloud-run) say the same.
     */
    it("says the Key Vault secret holds the whole header, and who may read it", (): void => {
      const text: string = section(
        azure(),
        "### Step 2 — Point the host at OneUptime",
      );
      const note: string | undefined = text
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("> **This token is a secret.**");
        });

      expect(note).toBeDefined();
      const header: string = azAppSettingsCommand(text).settings.get(
        "OTEL_EXPORTER_OTLP_HEADERS",
      ) as string;
      expect(header).toBe("x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN");
      // The secret holds exactly what the plain setting would.
      expect(note).toContain(
        `store the whole header, \`${header}\`, not just the token`,
      );
      expect(note).toContain("**Key Vault Secrets User** on the vault");
      expect(note).toContain(
        "`OTEL_EXPORTER_OTLP_HEADERS` to a Key Vault reference",
      );
    });

    it("names the worker package or setting for every language", (): void => {
      const text: string = section(
        azure(),
        "### Step 3 — (Optional) instrument your function code",
      );

      for (const token of [
        "`Microsoft.Azure.Functions.Worker.OpenTelemetry`",
        "`OpenTelemetry.Exporter.OpenTelemetryProtocol`",
        "`builder.Services.AddOpenTelemetry().UseFunctionsWorkerDefaults().UseOtlpExporter();`",
        "`npm install @azure/functions-opentelemetry-instrumentation`",
        "`AzureFunctionsInstrumentation`",
        "`com.microsoft.azure.functions:azure-functions-java-opentelemetry`",
        "`PYTHON_ENABLE_OPENTELEMETRY=true`",
        "`OTEL_FUNCTIONS_WORKER_ENABLED=True`",
        "`AzureFunctions.PowerShell.OpenTelemetry.SDK`",
      ]) {
        expect({ token, found: text.includes(token) }).toEqual({
          token,
          found: true,
        });
      }
    });

    /*
     * Ingest falls back to service.name only on a FaaS cloud.platform
     * (OtelIngestBaseService.resolveServerlessFunctionIdentity). The .NET
     * isolated worker's FunctionsResourceDetector and the Node.js Azure
     * detector set it; Microsoft's Python OTLP example builds
     * `Resource.create(...)` with no Azure detector, so its spans and logs
     * got no faas.name and never reached the function. The settings the page
     * gives for that case must name the same app as Step 2 and a platform
     * ingest treats as FaaS — and must not put a faas.name on the resource.
     */
    it("tells workers without an Azure detector how to join the function", (): void => {
      const text: string = section(
        azure(),
        "### Step 3 — (Optional) instrument your function code",
      );

      expect(text).toContain(
        "the same `service.name` and a FaaS `cloud.platform`",
      );
      expect(text).toContain(
        "Microsoft's Python example builds its resource without an Azure detector",
      );
      expect(text).toContain(
        "Every process of the app reads them, the host included",
      );

      const step2: AzAppSettingsCommand = azAppSettingsCommand(
        section(azure(), "### Step 2 — Point the host at OneUptime"),
      );
      const { options, settings }: AzAppSettingsCommand =
        azAppSettingsCommand(text);

      // Same app as Step 2, and nothing else is changed.
      expect(Object.fromEntries(options)).toEqual(
        Object.fromEntries(step2.options),
      );
      expect(Array.from(settings.keys()).sort()).toEqual([
        "OTEL_RESOURCE_ATTRIBUTES",
        "OTEL_SERVICE_NAME",
      ]);

      // The service name is the app's own, which the host reports anyway.
      expect(settings.get("OTEL_SERVICE_NAME")).toBe(options.get("--name"));
      expect(text).toContain(
        "Set `OTEL_SERVICE_NAME` to the Function App's own name.",
      );

      const attributes: Map<string, string> = resourceAttributes(
        settings.get("OTEL_RESOURCE_ATTRIBUTES") as string,
      );
      expect(Object.fromEntries(attributes)).toEqual({
        "cloud.provider": "azure",
        "cloud.platform": FaasCloudPlatform.AzureFunctions,
      });
      expect(
        FAAS_CLOUD_PLATFORM_VALUES.has(
          normalizeCloudPlatform(attributes.get("cloud.platform")) as string,
        ),
      ).toBe(true);
      expect(attributes.has("faas.name")).toBe(false);
    });

    it("lists the limits a reader will hit", (): void => {
      const text: string = section(azure(), "### Limitations");

      expect(text).toContain("**C# in-process apps** can't use OpenTelemetry");
      expect(text).toContain(
        "**Log streaming** in the Azure portal doesn't work",
      );
      expect(text).toContain("`logging.applicationInsights`");
      expect(text).toContain("**Instances** lists `faas.instance` values");
    });
  });
});
