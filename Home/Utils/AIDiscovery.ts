/*
 * AI/LLM discovery surfaces for the marketing site: llms.txt, llms-full.txt,
 * the MCP well-known manifest, markdown variants of marketing pages (*.md)
 * and the /data/*.json endpoints.
 *
 * Everything here is generated from data that already drives the HTML pages
 * (PageSEO, Pricing, ProductCompare, Reviews) so the two can never drift.
 * These functions are pure (no filesystem or database access) — callers pass
 * in the home URL and, where needed, the blog post list.
 */

import PageSEOConfig, { PageSEOData } from "./PageSEO";
import Pricing, { PricingPlans } from "./Pricing";
import ProductCompare, {
  Product,
  getProductCompareSlugs,
} from "./ProductCompare";
import { JSONObject } from "Common/Types/JSON";

/*
 * Minimal blog post shape so this module does not depend on the blog utils
 * (which pull in server-only modules and the blog filesystem).
 */
export interface RecentBlogPostLink {
  title: string;
  description: string;
  fileName: string;
}

function normalizeBaseUrl(homeUrl: string): string {
  return (homeUrl || "https://oneuptime.com").replace(/\/$/, "");
}

// "Status Page | Free Public & Private Status Pages | OneUptime" -> "Status Page"
function shortTitle(seo: PageSEOData): string {
  if (seo.softwareApplication?.name) {
    return seo.softwareApplication.name;
  }
  return (seo.title.split("|")[0] || seo.title).trim();
}

function getPagesByType(pageType: PageSEOData["pageType"]): Array<PageSEOData> {
  return Object.values(PageSEOConfig).filter((seo: PageSEOData) => {
    return seo.pageType === pageType;
  });
}

function formatPlanValue(value: string | boolean): string {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  return value;
}

// Escape characters that would break a markdown table cell.
function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/*
 * ProductCompare feature cells use "tick" as a sentinel for a checkmark and
 * "" for "not available".
 */
function formatCompareValue(value: string): string {
  if (value === "tick") {
    return "Yes";
  }
  if (!value || !value.trim()) {
    return "No";
  }
  return value;
}

const machineReadableSection: (baseUrl: string) => Array<string> = (
  baseUrl: string,
): Array<string> => {
  return [
    "## Machine-Readable Resources",
    "",
    `- [OpenAPI specification](${baseUrl}/api/openapi/spec): full REST API schema for the OneUptime platform`,
    `- [MCP server manifest](${baseUrl}/.well-known/mcp.json): connect AI agents to OneUptime via Model Context Protocol (endpoint: ${baseUrl}/mcp)`,
    `- [Documentation index for LLMs](${baseUrl}/docs/llms.txt): all docs pages with raw markdown variants`,
    `- [API reference](${baseUrl}/reference): human-friendly API documentation`,
    `- [Pricing (JSON)](${baseUrl}/data/pricing.json): plans and feature matrix as JSON`,
    `- [Pricing (Markdown)](${baseUrl}/pricing.md): plans and feature matrix as markdown`,
    `- [Products (JSON)](${baseUrl}/data/products.json): every product with description and feature list`,
    `- [Comparisons (JSON)](${baseUrl}/data/compare.json): OneUptime vs other tools`,
    `- [Customer reviews (JSON)](${baseUrl}/data/reviews.json)`,
    `- [Blog RSS feed](${baseUrl}/blog/rss.xml): every post also has a raw markdown variant at /blog/post/<post>/markdown`,
  ];
};

export function generateLlmsTxt(
  homeUrl: string,
  recentPosts: Array<RecentBlogPostLink>,
): string {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  const lines: Array<string> = [];

  lines.push("# OneUptime");
  lines.push("");
  lines.push(
    "> OneUptime is an open-source (Apache 2.0), all-in-one observability platform: uptime monitoring, status pages, incident management, on-call scheduling and alerting, logs, metrics, traces, error tracking, dashboards, workflow automation, runbooks and an AI reliability agent. Available as a cloud service at https://oneuptime.com or self-hosted.",
  );
  lines.push("");
  lines.push(
    "Most marketing pages on this site have a markdown variant: append `.md` to the page path (for example `/pricing.md` or `/product/monitoring.md`).",
  );
  lines.push("");
  lines.push(...machineReadableSection(baseUrl));

  lines.push("");
  lines.push("## Products");
  lines.push("");
  for (const seo of getPagesByType("product")) {
    lines.push(
      `- [${shortTitle(seo)}](${baseUrl}${seo.canonicalPath}.md): ${seo.description}`,
    );
  }

  lines.push("");
  lines.push("## Solutions");
  lines.push("");
  for (const seo of getPagesByType("solutions")) {
    lines.push(
      `- [${shortTitle(seo)}](${baseUrl}${seo.canonicalPath}.md): ${seo.description}`,
    );
  }

  lines.push("");
  lines.push("## Industries");
  lines.push("");
  for (const seo of getPagesByType("industry")) {
    lines.push(
      `- [${shortTitle(seo)}](${baseUrl}${seo.canonicalPath}.md): ${seo.description}`,
    );
  }

  lines.push("");
  lines.push("## Compare OneUptime");
  lines.push("");
  for (const slug of getProductCompareSlugs()) {
    const product: Product = ProductCompare(slug);
    lines.push(
      `- [OneUptime vs ${product.productName}](${baseUrl}/compare/${slug}.md): ${product.tagline}`,
    );
  }

  lines.push("");
  lines.push("## Pricing");
  lines.push("");
  for (const plan of PricingPlans) {
    lines.push(`- ${plan.name}: ${plan.monthlyPricePerUser}`);
  }
  lines.push(
    `- Full feature matrix: [markdown](${baseUrl}/pricing.md) / [JSON](${baseUrl}/data/pricing.json)`,
  );

  lines.push("");
  lines.push("## Docs & Support");
  lines.push("");
  lines.push(`- [Documentation](${baseUrl}/docs)`);
  lines.push(
    `- [Documentation for LLMs](${baseUrl}/docs/llms.txt): index of all docs with raw markdown links`,
  );
  lines.push(`- [API Reference](${baseUrl}/reference)`);
  lines.push(
    `- [MCP Server](${baseUrl}/tool/mcp-server.md): query and manage OneUptime from AI agents`,
  );
  lines.push(`- [Support](${baseUrl}/support)`);
  lines.push(
    "- [Source code on GitHub](https://github.com/OneUptime/oneuptime)",
  );

  if (recentPosts.length > 0) {
    lines.push("");
    lines.push("## Recent Blog Posts");
    lines.push("");
    for (const post of recentPosts) {
      lines.push(
        `- [${post.title}](${baseUrl}/blog/post/${post.fileName}/markdown): ${post.description}`,
      );
    }
    lines.push(`- [All posts](${baseUrl}/blog)`);
  }

  lines.push("");
  lines.push("## Optional");
  lines.push("");
  lines.push(
    `- [llms-full.txt](${baseUrl}/llms-full.txt): expanded version of this file with full product, pricing and comparison detail inline`,
  );
  lines.push("");

  return lines.join("\n");
}

export function generateLlmsFullTxt(
  homeUrl: string,
  recentPosts: Array<RecentBlogPostLink>,
): string {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  const lines: Array<string> = [];

  lines.push("# OneUptime");
  lines.push("");
  lines.push(
    "> OneUptime is an open-source (Apache 2.0), all-in-one observability platform: uptime monitoring, status pages, incident management, on-call scheduling and alerting, logs, metrics, traces, error tracking, dashboards, workflow automation, runbooks and an AI reliability agent. Available as a cloud service at https://oneuptime.com or self-hosted.",
  );
  lines.push("");
  lines.push(...machineReadableSection(baseUrl));

  lines.push("");
  lines.push("## Products");
  for (const seo of getPagesByType("product")) {
    lines.push("");
    lines.push(`### ${shortTitle(seo)}`);
    lines.push("");
    lines.push(seo.description);
    lines.push("");
    lines.push(`Page: ${baseUrl}${seo.canonicalPath}`);
    if (seo.softwareApplication) {
      lines.push("");
      lines.push("Features:");
      lines.push("");
      for (const feature of seo.softwareApplication.features) {
        lines.push(`- ${feature}`);
      }
    }
  }

  lines.push("");
  lines.push(generatePricingMarkdown(homeUrl));

  lines.push("");
  lines.push("## Comparisons");
  for (const slug of getProductCompareSlugs()) {
    const product: Product = ProductCompare(slug);
    lines.push("");
    lines.push(`### OneUptime vs ${product.productName}`);
    lines.push("");
    lines.push(product.description);
    lines.push("");
    lines.push(
      `Full comparison: ${baseUrl}/compare/${slug} (markdown: ${baseUrl}/compare/${slug}.md)`,
    );
    for (const difference of product.keyDifferences || []) {
      lines.push(`- ${difference.title}: ${difference.description}`);
    }
  }

  if (recentPosts.length > 0) {
    lines.push("");
    lines.push("## Recent Blog Posts");
    lines.push("");
    for (const post of recentPosts) {
      lines.push(
        `- [${post.title}](${baseUrl}/blog/post/${post.fileName}/markdown): ${post.description}`,
      );
    }
  }

  lines.push("");

  return lines.join("\n");
}

export function generatePricingMarkdown(homeUrl: string): string {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  const lines: Array<string> = [];

  lines.push("## Pricing");
  lines.push("");
  lines.push(
    "> OneUptime pricing starts free. Paid plans are priced per user per month. Telemetry (logs, metrics, traces) is billed on usage at $0.10/GB ingested. Self-hosting the open-source platform is free.",
  );
  lines.push("");
  lines.push("| Plan | Price (monthly billing) | Price (yearly billing) |");
  lines.push("|---|---|---|");
  for (const plan of PricingPlans) {
    lines.push(
      `| ${plan.name} | ${tableCell(plan.monthlyPricePerUser)} | ${tableCell(plan.yearlyMonthlyPricePerUser)} |`,
    );
  }
  lines.push("");
  lines.push(`Canonical page: ${baseUrl}/pricing`);

  for (const category of Pricing) {
    lines.push("");
    lines.push(`### ${category.name}`);
    lines.push("");
    lines.push("| Feature | Free | Growth | Scale | Enterprise |");
    lines.push("|---|---|---|---|---|");
    for (const feature of category.data) {
      const cells: Array<string> = ["free", "growth", "scale", "enterprise"];
      const row: string = cells
        .map((planKey: string) => {
          return tableCell(formatPlanValue(feature.plans[planKey] ?? "No"));
        })
        .join(" | ");
      lines.push(`| ${tableCell(feature.name)} | ${row} |`);
    }
  }

  lines.push("");

  return lines.join("\n");
}

/*
 * Markdown variant of a marketing page, generated from its SEO/structured
 * data. Rich for product pages (feature lists); title + description for the
 * rest.
 */
export function generatePageMarkdown(
  seo: PageSEOData,
  homeUrl: string,
): string {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  const lines: Array<string> = [];

  lines.push(`# ${shortTitle(seo)}`);
  lines.push("");
  lines.push(`> ${seo.description}`);
  lines.push("");
  lines.push(`Canonical page: ${baseUrl}${seo.canonicalPath}`);

  if (seo.softwareApplication) {
    lines.push("");
    lines.push("## Features");
    lines.push("");
    for (const feature of seo.softwareApplication.features) {
      lines.push(`- ${feature}`);
    }
  }

  lines.push("");
  lines.push("## Learn More");
  lines.push("");
  lines.push(
    `- [All OneUptime products and links for LLMs](${baseUrl}/llms.txt)`,
  );
  lines.push(`- [Pricing](${baseUrl}/pricing.md)`);
  lines.push(`- [Documentation](${baseUrl}/docs)`);
  lines.push(`- [Sign up](${baseUrl}/accounts/register)`);
  lines.push("");

  return lines.join("\n");
}

export function generateCompareMarkdown(
  slug: string,
  homeUrl: string,
): string | null {
  const product: Product | undefined = ProductCompare(slug);
  if (!product) {
    return null;
  }

  const baseUrl: string = normalizeBaseUrl(homeUrl);
  const lines: Array<string> = [];

  lines.push(`# OneUptime vs ${product.productName}`);
  lines.push("");
  lines.push(`> ${product.tagline}`);
  lines.push("");
  lines.push(product.description);
  lines.push("");
  lines.push(product.descriptionLine2);
  lines.push("");
  lines.push(`Canonical page: ${baseUrl}/compare/${slug}`);
  if (product.lastUpdated) {
    lines.push("");
    lines.push(`Last updated: ${product.lastUpdated}`);
  }

  if (product.keyDifferences && product.keyDifferences.length > 0) {
    lines.push("");
    lines.push("## Key Differences");
    for (const difference of product.keyDifferences) {
      lines.push("");
      lines.push(`### ${difference.title}`);
      lines.push("");
      lines.push(difference.description);
    }
  }

  if (product.items && product.items.length > 0) {
    lines.push("");
    lines.push("## Feature Comparison");
    for (const category of product.items) {
      lines.push("");
      lines.push(`### ${category.name}`);
      lines.push("");
      lines.push(`| Feature | ${tableCell(product.productName)} | OneUptime |`);
      lines.push("|---|---|---|");
      for (const item of category.data) {
        lines.push(
          `| ${tableCell(item.title)} (${tableCell(item.description)}) | ${tableCell(formatCompareValue(item.productColumn))} | ${tableCell(formatCompareValue(item.oneuptimeColumn))} |`,
        );
      }
    }
  }

  if (product.faq && product.faq.length > 0) {
    lines.push("");
    lines.push("## FAQ");
    for (const faq of product.faq) {
      lines.push("");
      lines.push(`### ${faq.question}`);
      lines.push("");
      lines.push(faq.answer);
    }
  }

  lines.push("");
  lines.push("## Learn More");
  lines.push("");
  lines.push(`- [Pricing](${baseUrl}/pricing.md)`);
  lines.push(`- [All comparisons](${baseUrl}/data/compare.json)`);
  lines.push(`- [Sign up](${baseUrl}/accounts/register)`);
  lines.push("");

  return lines.join("\n");
}

// Manifest served at /.well-known/mcp.json for MCP client discovery.
export function generateMcpManifest(homeUrl: string): JSONObject {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  return {
    name: "OneUptime MCP Server",
    description:
      "Model Context Protocol server for OneUptime. Lets AI agents query and manage incidents, monitors, alerts, on-call schedules, status pages, logs, metrics and traces.",
    endpoint: `${baseUrl}/mcp`,
    transport: ["streamable-http"],
    authentication: {
      type: "apiKey",
      headers: ["x-api-key", "Authorization: Bearer <api-key>"],
      instructions: `Create an API key in your OneUptime project settings. Public status page tools and help tools work without authentication. See ${baseUrl}/docs/ai/mcp-server`,
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
    },
    documentation: `${baseUrl}/docs/ai/mcp-server`,
    website: `${baseUrl}/tool/mcp-server`,
    openapi: `${baseUrl}/api/openapi/spec`,
    packages: [
      {
        registry: "npm",
        name: "@oneuptime/mcp-server",
      },
    ],
  };
}

export function generateProductsJson(homeUrl: string): JSONObject {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  return {
    products: getPagesByType("product").map((seo: PageSEOData) => {
      return {
        name: shortTitle(seo),
        description: seo.description,
        url: `${baseUrl}${seo.canonicalPath}`,
        markdownUrl: `${baseUrl}${seo.canonicalPath}.md`,
        features: seo.softwareApplication?.features || [],
      };
    }),
  };
}

export function generateCompareIndexJson(homeUrl: string): JSONObject {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  return {
    comparisons: getProductCompareSlugs().map((slug: string) => {
      const product: Product = ProductCompare(slug);
      return {
        slug,
        productName: product.productName,
        tagline: product.tagline,
        url: `${baseUrl}/compare/${slug}`,
        markdownUrl: `${baseUrl}/compare/${slug}.md`,
        jsonUrl: `${baseUrl}/data/compare/${slug}`,
      };
    }),
  };
}
