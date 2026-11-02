import {
  McpServerClientSetup,
  McpServerDocsMarkdownPath,
  McpServerDocsPath,
  McpServerPageContent,
  McpServerPagePath,
  McpServerPlanNote,
  McpServerTool,
  McpServerTools,
  getMcpServerPageContent,
} from "../Utils/McpServerPage";
import {
  generateLlmsTxt,
  generateMcpManifest,
  generateMcpServerMarkdown,
  generatePricingMarkdown,
  generateProductsJson,
} from "../Utils/AIDiscovery";
import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import Pricing, { PricingCategory, PricingFeature } from "../Utils/Pricing";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs, { IncluderResult } from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * The website's MCP server page (/tool/mcp-server) and its Markdown copy are
 * where llms.txt, the manifest and search send people and agents who want to
 * connect to OneUptime. The page used to show a placeholder address
 * (your-oneuptime.com) and an API key, never the real address or signing in.
 * Its tool list named tools the server does not have (query_logs, get_metrics,
 * search_traces), and the Markdown copy gave no address at all. The manifest
 * pointed at an npm package that cannot start, and nothing an agent reads said
 * connecting needs a paid plan.
 *
 * So what they say is held here to the docs, the billing plan and the pricing
 * data. packages/App/FeatureSet/MCP/Tests/HomeMcpServerPage.test.ts holds the
 * tool names to the tools the server lists.
 */

const HOME_URL: string = "https://oneuptime.com";
const SELF_HOSTED_URL: string = "https://status.example.com";

const REPOSITORY_ROOT: string = path.join(__dirname, "..", "..", "..");
const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");

const content: McpServerPageContent = getMcpServerPageContent(HOME_URL);

const readRepositoryFile: (...names: Array<string>) => string = (
  ...names: Array<string>
): string => {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, ...names), "utf8");
};

/*
 * The page as Routes.ts renders it, without the partials it shares with the
 * rest of the site, so what is left is what this page says itself.
 */
const renderPage: (homeUrl: string) => Promise<Document> = async (
  homeUrl: string,
): Promise<Document> => {
  const seo: PageSEOData = getPageSEO(McpServerPagePath);

  const html: string = (await ejs.renderFile(
    path.join(VIEWS_ROOT, "mcp-server.ejs"),
    {
      enableGoogleTagManager: false,
      seo: { ...seo, fullCanonicalUrl: `${homeUrl}${seo.canonicalPath}` },
      mcpServer: getMcpServerPageContent(homeUrl),
      homeUrl,
    },
    {
      views: [VIEWS_ROOT],
      includer: (included: string): IncluderResult => {
        return { template: `<!-- ${included} -->` };
      },
    },
  )) as string;

  return new JSDOM(html).window.document;
};

const textOf: (document: Document, selector: string) => string = (
  document: Document,
  selector: string,
): string => {
  return (document.querySelector(selector)?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
};

const setupOf: (client: string) => McpServerClientSetup = (
  client: string,
): McpServerClientSetup => {
  const setup: McpServerClientSetup | undefined = content.clientSetups.find(
    (candidate: McpServerClientSetup): boolean => {
      return candidate.client === client;
    },
  );

  if (!setup) {
    throw new Error(`There is no setup for ${client}`);
  }

  return setup;
};

const pricingFeature: (name: string) => PricingFeature = (
  name: string,
): PricingFeature => {
  const feature: PricingFeature | undefined = Pricing.flatMap(
    (category: PricingCategory): Array<PricingFeature> => {
      return category.data;
    },
  ).find((candidate: PricingFeature): boolean => {
    return candidate.name === name;
  });

  if (!feature) {
    throw new Error(`The pricing data has no ${name}`);
  }

  return feature;
};

// The plan a model's @TableBillingAccessControl asks to create a record.
const planToCreate: (model: string) => string | undefined = (
  model: string,
): string | undefined => {
  return readRepositoryFile(
    "packages",
    "Common",
    "Models",
    "DatabaseModels",
    `${model}.ts`,
  ).match(/@TableBillingAccessControl\(\{\s*create: PlanType\.(\w+)/)?.[1];
};

describe("the MCP server page", () => {
  let page: Document;

  beforeAll(async () => {
    page = await renderPage(HOME_URL);
  });

  test("shows the address people connect to, in the command and in the config", () => {
    const connect: string = textOf(page, "#mcp-connect");

    expect(connect).toContain(
      "claude mcp add --transport http oneuptime https://oneuptime.com/mcp",
    );
    expect(connect).toContain('"url": "https://oneuptime.com/mcp"');
  });

  test("never shows a placeholder address", () => {
    expect(page.documentElement.innerHTML).not.toContain("your-oneuptime");
  });

  test("connects by signing in, so the first thing it shows carries no key", () => {
    const connect: string = textOf(page, "#mcp-connect");

    expect(connect).not.toMatch(/api.?key|authorization|bearer/i);
    expect(textOf(page, "#mcp-connect-note")).toContain(
      "sign in to OneUptime when it asks",
    );
  });

  test("says what connecting needs from a plan, beside the address, and links the plans", () => {
    const note: string = textOf(page, "#mcp-connect-note");

    expect(note).toContain(McpServerPlanNote);
    expect(note).toContain(content.selfHosted);
    expect(
      page.querySelector("#mcp-connect-note a")?.getAttribute("href"),
    ).toBe("/pricing");
  });

  test("names the tools listed here, and none the server does not have", () => {
    const html: string = page.documentElement.innerHTML;

    for (const tool of McpServerTools) {
      expect(html).toContain(tool.name);
      expect(html).toContain(tool.description);
    }

    for (const invented of ["query_logs", "get_metrics", "search_traces"]) {
      expect(html).not.toContain(invented);
    }

    // A real tool, but it reads a status's definition, not a monitor's health.
    expect(html).not.toContain("get_monitor_status");
  });

  test("describes signing in, not only API keys", () => {
    const html: string = page.documentElement.innerHTML;

    expect(html).toContain("Sign in with OneUptime");
    expect(html).toContain("limit it to read only");
    expect(html).not.toContain("with your API key");
  });

  /*
   * A phone is narrower than the command. It used to scroll sideways inside
   * its block with nothing to say so, cutting the address off at "oneuptime ht".
   */
  test("wraps the command and the address on a phone, rather than cutting them off", () => {
    const connect: Element | null = page.querySelector("#mcp-connect");

    expect(connect?.className).not.toContain("overflow-x");
    expect(connect?.innerHTML).not.toContain("whitespace-pre");
    expect(connect?.querySelectorAll(".break-words").length).toBe(2);
  });

  test("shows the address of the instance serving it", async () => {
    const selfHosted: Document = await renderPage(SELF_HOSTED_URL);

    expect(textOf(selfHosted, "#mcp-connect")).toContain(
      `${SELF_HOSTED_URL}/mcp`,
    );
    expect(textOf(selfHosted, "#mcp-connect")).not.toContain("oneuptime.com");
  });

  test("gets what it shows from Routes.ts, for the instance's own address", () => {
    const routes: string = readRepositoryFile("packages", "Home", "Routes.ts");

    expect(routes).toContain(
      'mcpServer: getMcpServerPageContent(res.locals["homeUrl"] as string)',
    );
  });

  test("lists the clients the docs do", () => {
    const html: string = page.documentElement.innerHTML;

    for (const client of ["Claude", "Cursor", "VS Code", "Any MCP Client"]) {
      expect(html).toContain(client);
    }
  });
});

describe("the MCP server page's Markdown copy", () => {
  const markdown: string = generateMcpServerMarkdown(HOME_URL, content);

  test("gives the address and the transport", () => {
    expect(markdown).toContain(
      "Address: `https://oneuptime.com/mcp` (streamable HTTP)",
    );
  });

  test("says how each client connects, with its code in a fence", () => {
    for (const setup of content.clientSetups) {
      expect(markdown).toContain(`### ${setup.client}`);
      expect(markdown).toContain(setup.instruction);

      if (setup.code) {
        expect(markdown).toContain(
          [`\`\`\`${setup.code.language}`, ...setup.code.lines, "```"].join(
            "\n",
          ),
        );
      }
    }
  });

  test("says how an agent nobody can sign in for connects", () => {
    expect(markdown).toContain(content.apiKey);
    expect(markdown).toContain(content.apiKeyCommand);
  });

  test("says what it needs from a plan, what does not, and what a self-hosted instance needs", () => {
    expect(markdown).toContain(McpServerPlanNote);
    expect(markdown).toContain(content.selfHosted);
    expect(markdown).toContain(content.publicTools);
  });

  test("names the tools, and where every tool is listed", () => {
    for (const tool of McpServerTools) {
      expect(markdown).toContain(`\`${tool.name}\`: ${tool.description}`);
    }

    expect(markdown).toContain("https://oneuptime.com/mcp/tools");
  });

  test("says what the page's structured data says it does", () => {
    const seo: PageSEOData = getPageSEO(McpServerPagePath);

    expect(seo.softwareApplication?.features.length).toBeGreaterThan(0);

    for (const feature of seo.softwareApplication?.features || []) {
      expect(markdown).toContain(`- ${feature}`);
    }
  });

  test("links the full guide as raw Markdown", () => {
    expect(markdown).toContain(`${HOME_URL}${McpServerDocsMarkdownPath}`);
  });

  test("a trailing slash on the home URL makes no double slash", () => {
    const withSlash: string = generateMcpServerMarkdown(
      `${HOME_URL}/`,
      getMcpServerPageContent(`${HOME_URL}/`),
    );

    expect(withSlash).toBe(markdown);
    expect(withSlash).not.toContain("oneuptime.com//");
  });

  test("Routes.ts serves it in place of the page's summary", () => {
    const routes: string = readRepositoryFile("packages", "Home", "Routes.ts");

    expect(routes).toMatch(
      /pagePath === McpServerPagePath\) \{\s+markdown = generateMcpServerMarkdown\(/,
    );
    expect(routes.indexOf("pagePath === McpServerPagePath")).toBeLessThan(
      routes.indexOf("PageSEOConfig[pagePath]) {"),
    );
  });
});

describe("what the page says, held to the MCP docs", () => {
  const docs: string = readRepositoryFile(
    "packages",
    "App",
    "FeatureSet",
    "Docs",
    "Content",
    "en",
    "ai",
    "mcp-server.md",
  );

  test("the guide the page links is that page", () => {
    expect(McpServerDocsPath).toBe("/docs/ai/mcp-server");
    expect(McpServerDocsMarkdownPath).toBe(
      "/docs/as-markdown/en/ai/mcp-server",
    );
    expect(docs.startsWith("# MCP Server")).toBe(true);
  });

  test("the commands and configurations are the ones the docs give", () => {
    expect(docs).toContain(content.claudeCodeCommand);
    expect(docs).toContain(content.apiKeyCommand);

    for (const client of ["Cursor", "VS Code with GitHub Copilot"]) {
      expect(docs).toContain(setupOf(client).code?.lines.join("\n"));
    }
  });

  test("the steps are the docs' steps", () => {
    expect(docs).toContain("**Customize → Connectors**");
    expect(docs).toContain("**Add custom connector**");
    expect(docs).toContain("choose **oneuptime** to sign in");
    expect(docs).toContain("**Project Settings → Advanced → API Keys**");
    expect(docs).toContain("`x-api-key` header");
  });

  test("the plan is the docs' plan, and only OneUptime Cloud's", () => {
    expect(docs).toContain("On OneUptime Cloud, the Growth plan or higher");
    expect(McpServerPlanNote).toContain("On OneUptime Cloud");
    expect(McpServerPlanNote).toContain("Growth");
  });

  test("the public tools need no credential, as the docs say", () => {
    expect(docs).toContain("The public status page tools need neither.");
    expect(content.publicTools).toContain("need no account or key");
  });
});

describe("what connecting needs from a plan", () => {
  test("signing a client in and creating an API key are both sold on Growth", () => {
    expect(planToCreate("McpOAuthGrant")).toBe("Growth");
    expect(planToCreate("ApiKey")).toBe("Growth");
  });

  test("a self-hosted instance has no plan to check", () => {
    const service: string = readRepositoryFile(
      "packages",
      "Common",
      "Server",
      "Services",
      "ProjectService.ts",
    );

    expect(service).toMatch(
      /getCurrentPlan\(projectId: ObjectID\): Promise<CurrentPlan> \{\s+if \(!IsBillingEnabled\) \{\s+return \{ plan: null,/,
    );
    expect(
      readRepositoryFile(
        "packages",
        "App",
        "FeatureSet",
        "MCP",
        "OAuth",
        "ConsentEndpoint.ts",
      ),
    ).toMatch(/if \(!plan\.plan\) \{\s+return true;/);
  });

  test("the pricing data sells it on the plans the billing check allows", () => {
    expect(pricingFeature("MCP Server for AI Agents").plans).toEqual({
      free: false,
      growth: true,
      scale: true,
      enterprise: true,
    });
  });

  test("it is on the same plans as API access", () => {
    expect(pricingFeature("MCP Server for AI Agents").plans).toEqual(
      pricingFeature("API Access").plans,
    );
  });

  test("the pricing an agent reads names it", () => {
    expect(generatePricingMarkdown(HOME_URL)).toContain(
      "| MCP Server for AI Agents | No | Yes | Yes | Yes |",
    );
  });
});

describe("the MCP manifest", () => {
  const manifest: JSONObject = generateMcpManifest(HOME_URL);

  const registryEntry: JSONObject = JSON.parse(
    readRepositoryFile("packages", "App", "FeatureSet", "MCP", "server.json"),
  ) as JSONObject;

  test("says where to connect as the MCP Registry's entry does", () => {
    const remote: JSONObject = (
      registryEntry["remotes"] as JSONArray
    )[0] as JSONObject;

    expect(manifest["remotes"]).toEqual([
      { type: remote["type"], url: remote["url"] },
    ]);
  });

  test("names no npm package: the server is hosted, and the package on npm cannot start", () => {
    expect(manifest["packages"]).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain("@oneuptime/mcp-server");
  });

  test.each([{ isOAuthEnabled: true }, { isOAuthEnabled: false }])(
    "says what connecting needs from a plan: %j",
    (options: { isOAuthEnabled: boolean }) => {
      const authentication: JSONObject = generateMcpManifest(HOME_URL, options)[
        "authentication"
      ] as JSONObject;

      expect(authentication["instructions"]).toContain(McpServerPlanNote);
    },
  );

  test("its remote follows the instance's own address", () => {
    expect(generateMcpManifest(SELF_HOSTED_URL)["remotes"]).toEqual([
      { type: "streamable-http", url: `${SELF_HOSTED_URL}/mcp` },
    ]);
  });
});

describe("where agents are sent to connect", () => {
  test("llms.txt links the page's Markdown copy as the way to connect", () => {
    expect(generateLlmsTxt(HOME_URL, [])).toContain(
      `[Connect an AI agent](${HOME_URL}${McpServerPagePath}.md)`,
    );
  });

  test("products.json lists the address and signing in", () => {
    const products: Array<JSONObject> = generateProductsJson(HOME_URL)[
      "products"
    ] as Array<JSONObject>;
    const mcpServer: JSONObject | undefined = products.find(
      (product: JSONObject): boolean => {
        return product["url"] === `${HOME_URL}${McpServerPagePath}`;
      },
    );
    const features: string = JSON.stringify(mcpServer?.["features"]);

    expect(features).toContain("https://oneuptime.com/mcp");
    expect(features).toContain("Sign in with OneUptime");
  });

  test("the page's structured data no longer says API keys are the only way in", () => {
    const features: Array<string> =
      getPageSEO(McpServerPagePath).softwareApplication?.features || [];

    expect(features).not.toContain("API key authentication");
    expect(features).toContain(
      "Sign in with OneUptime, or use a project API key",
    );
  });

  test("the tool list has a row for each row the page draws", () => {
    const view: string = readRepositoryFile(
      "packages",
      "Home",
      "Views",
      "mcp-server.ejs",
    );

    McpServerTools.forEach((_tool: McpServerTool, index: number) => {
      expect(view).toContain(`mcpServer.tools[${index}].name`);
      expect(view).toContain(`mcpServer.tools[${index}].description`);
    });

    expect(view).not.toContain(`mcpServer.tools[${McpServerTools.length}]`);
  });
});
