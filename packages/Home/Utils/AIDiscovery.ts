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
import { ResellersPageContent } from "./Resellers";
import { AirGappedPageContent, AirGappedStep } from "./AirGapped";
import {
  CloudMarketplaceLink,
  CloudMarketplacesContent,
  getCloudMarketplacesContent,
} from "./CloudMarketplaces";
import ProductCompare, {
  Product,
  PricingTier,
  UseCaseComparison,
  getProductCompareSlugs,
} from "./ProductCompare";
import { JSONObject } from "Common/Types/JSON";
import { markdownTableCell } from "Common/Utils/Markdown/MarkdownTableCell";
import { McpOAuthScopeUtil } from "Common/Types/Mcp/McpOAuthScope";

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

/*
 * A value in a markdown table cell: every "|" kept in its cell and every
 * line break made a space (markdownTableCell).
 */
function tableCell(value: string): string {
  return markdownTableCell(value);
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
    `- [Governed claims matrix (JSON)](${baseUrl}/data/claims.json): every published claim about service levels, support, compliance, encryption, deployment, migration, scale, discounts, and contract terms, with its status, qualifier, evidence, and source document`,
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
  lines.push("## Enterprise");
  lines.push("");
  for (const seo of getPagesByType("enterprise")) {
    lines.push(
      `- [${shortTitle(seo)}](${baseUrl}${seo.canonicalPath}.md): ${seo.description}`,
    );
  }
  lines.push(
    `- [Trust Center](${baseUrl}/trust): certifications, attestations, and the governed claims matrix`,
  );
  lines.push(
    `- [Claims matrix (JSON)](${baseUrl}/data/claims.json): every published claim with its status, qualifier, evidence, and source document`,
  );

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

/*
 * Links named in a sentence, as the pages write them: "[A](a) or [B](b)".
 */
function marketplaceLinksSentence(
  links: ReadonlyArray<CloudMarketplaceLink>,
): string {
  return links
    .map((link: CloudMarketplaceLink): string => {
      return `${link.separator}[${link.name}](${link.url})`;
    })
    .join("");
}

export function generatePricingMarkdown(
  homeUrl: string,
  cloudMarketplaces: CloudMarketplacesContent = getCloudMarketplacesContent(),
): string {
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

  // The line under the plans: OneUptime Cloud's public marketplace listings.
  if (cloudMarketplaces.publicListings.cloud.length > 0) {
    lines.push("");
    lines.push(
      `Prefer to pay on your cloud bill? Buy OneUptime Cloud on ${marketplaceLinksSentence(cloudMarketplaces.publicListings.cloud)}, at the same prices. Every marketplace: ${baseUrl}${cloudMarketplaces.sectionPath}`,
    );
  }

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

/*
 * The Resellers page's cloud marketplaces section, as markdown: each
 * marketplace with its listings as the page shows them (a link where the
 * listing is public, "coming soon" where it is not, one line for a
 * marketplace with none), and nothing while no listing is public.
 */
function cloudMarketplacesMarkdown(
  baseUrl: string,
  marketplaces: CloudMarketplacesContent,
): Array<string> {
  if (!marketplaces.hasPublicListing) {
    return [];
  }

  const lines: Array<string> = [];

  lines.push("");
  lines.push("## Buy through your cloud marketplace");
  lines.push("");
  lines.push(
    `Buy OneUptime with the cloud account you already have, and pay for it on your cloud bill. OneUptime Cloud is run by OneUptime, at the prices on ${baseUrl}/pricing. OneUptime Enterprise runs in your own Kubernetes cluster, for ${marketplaces.enterprisePricePerUserHour} per user per hour, with no license key to activate: ${baseUrl}${marketplaces.enterpriseGuidePath}`,
  );
  lines.push("");

  for (const card of marketplaces.marketplaces) {
    if (!card.hasPublicListing) {
      lines.push(`- ${card.name}: coming soon`);
      continue;
    }

    lines.push(`- ${card.name}`);
    for (const listing of card.listings) {
      lines.push(
        listing.listingUrl
          ? `  - [${listing.productName}](${listing.listingUrl}): ${listing.detail}`
          : `  - ${listing.productName}: ${listing.detail}, coming soon`,
      );
    }
  }

  lines.push("");
  lines.push(
    `For annual pricing or a volume discount, ask for a private offer, which you accept on your marketplace: ${baseUrl}${marketplaces.privateOfferPath}`,
  );

  return lines;
}

/*
 * /resellers.md: the resellers by region, from the same content the page
 * renders (Utils/Resellers.ts), the cloud marketplaces, and how to become a
 * reseller.
 */
export function generateResellersMarkdown(
  homeUrl: string,
  content: ResellersPageContent,
): string {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  const seo: PageSEOData | undefined = PageSEOConfig["/resellers"];
  const lines: Array<string> = [];

  lines.push("# Resellers");
  lines.push("");
  if (seo) {
    lines.push(`> ${seo.description}`);
    lines.push("");
  }
  lines.push(`Canonical page: ${baseUrl}/resellers`);

  lines.push("");
  lines.push("## Resellers by region");

  if (content.regions.length === 0) {
    lines.push("");
    lines.push(
      "No resellers are listed yet. Buy OneUptime directly instead: start for free, or talk to the team.",
    );
  }

  for (const group of content.regions) {
    lines.push("");
    lines.push(`### ${group.region}`);
    lines.push("");
    for (const reseller of group.resellers) {
      const localName: string = reseller.localName
        ? ` (${reseller.localName})`
        : "";
      lines.push(
        `- [${reseller.name}](${reseller.websiteUrl})${localName}, ${reseller.location}: ${reseller.summary}`,
      );
    }
  }

  lines.push(...cloudMarketplacesMarkdown(baseUrl, content.cloudMarketplaces));

  lines.push("");
  lines.push("## Become a reseller");
  lines.push("");
  lines.push(
    `Companies that want to sell OneUptime can send the form at ${baseUrl}/resellers#become-a-reseller, or email ${content.form.fallbackEmail}.`,
  );

  lines.push("");
  lines.push("## Learn More");
  lines.push("");
  lines.push(
    `- [All OneUptime products and links for LLMs](${baseUrl}/llms.txt)`,
  );
  lines.push(`- [Pricing](${baseUrl}/pricing.md)`);
  lines.push(`- [Request a demo](${baseUrl}/enterprise/demo.md)`);
  lines.push(`- [Sign up](${baseUrl}/accounts/register)`);
  lines.push("");

  return lines.join("\n");
}

/*
 * A docs or site address as an absolute link: the page writes them rooted
 * ("/docs/..."), and a markdown reader has no page to resolve them against.
 */
function absoluteLink(baseUrl: string, href: string): string {
  return href.startsWith("/") ? `${baseUrl}${href}` : href;
}

/*
 * /enterprise/air-gapped.md: the air-gapped page, section by section, from
 * the same content the page renders (Utils/AirGapped.ts) - who it is for,
 * what runs inside, the four steps and the values they set, every
 * connection out and what to use instead, AI on a model the customer runs,
 * compliance, and the questions buyers ask.
 */
export function generateAirGappedMarkdown(
  homeUrl: string,
  content: AirGappedPageContent,
): string {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  const seo: PageSEOData | undefined = PageSEOConfig[content.pagePath];
  const pageUrl: string = `${baseUrl}${content.pagePath}`;
  const lines: Array<string> = [];

  lines.push(`# ${seo ? shortTitle(seo) : "Air-Gapped Installs"}`);
  lines.push("");
  if (seo) {
    lines.push(`> ${seo.description}`);
    lines.push("");
  }
  lines.push(`Canonical page: ${pageUrl}`);

  lines.push("");
  lines.push("## Who it's for");
  lines.push("");
  for (const audience of content.audiences) {
    lines.push(`- **${audience.title}**: ${audience.description}`);
  }

  lines.push("");
  lines.push("## What runs inside your network");
  lines.push("");
  for (const capability of content.capabilities) {
    const more: string = capability.link
      ? ` ([${capability.link.label}](${absoluteLink(baseUrl, capability.link.href)}))`
      : "";
    lines.push(`- **${capability.title}**: ${capability.description}${more}`);
  }

  lines.push("");
  lines.push("## Four steps to an air-gapped install");
  lines.push("");
  lines.push(
    "The same Helm chart every self-hosted install runs. There is no special air-gapped build.",
  );
  lines.push("");
  content.steps.forEach((step: AirGappedStep, index: number) => {
    // The settings a step names, in brackets - none for a step that has none.
    const settings: string =
      step.settings.length > 0
        ? ` (${step.settings
            .map((setting: string): string => {
              return `\`${setting}\``;
            })
            .join(", ")})`
        : "";
    const more: string = step.link
      ? ` See [${step.link.label}](${absoluteLink(baseUrl, step.link.href)}).`
      : "";
    lines.push(
      `${index + 1}. **${step.title}**: ${step.description}${settings}${more}`,
    );
  });
  lines.push("");
  lines.push(
    `The chart is signed with OneUptime's key, fingerprint ${content.signingKey.fingerprintHalves.join(" ")} (${content.signingKey.url}).`,
  );
  lines.push("");
  lines.push("The values.yaml of an air-gapped install:");
  lines.push("");
  lines.push("```yaml");
  lines.push(content.valuesYaml);
  lines.push("```");
  lines.push("");
  lines.push(content.valuesCaption);
  lines.push("");
  lines.push(
    `${content.upgradeNote} See [Upgrading](${absoluteLink(baseUrl, content.docs.upgrading)}).`,
  );

  lines.push("");
  lines.push("## What reaches out, and what to use instead");
  lines.push("");
  lines.push(
    "Four things reach out on their own unless you change a setting. Everything else reaches out only once you set it up.",
  );
  lines.push("");
  lines.push("| Connection | Where it goes | When | Inside an air gap |");
  lines.push("|---|---|---|---|");
  for (const connection of content.connections) {
    const name: string = connection.onByDefault
      ? `${connection.name} (on by default)`
      : connection.name;
    lines.push(
      `| ${tableCell(name)} | ${tableCell(connection.destination)} | ${tableCell(connection.when)} | ${tableCell(connection.inside)} |`,
    );
  }
  lines.push("");
  lines.push(
    `The exact addresses each integration needs: [connections out of your network](${absoluteLink(baseUrl, content.docs.connectionsOut)}). Every setting that lets OneUptime reach private addresses: [private network access](${absoluteLink(baseUrl, content.docs.privateNetworkAccess)}).`,
  );

  lines.push("");
  lines.push("## OneUptime AI, on a model you run");
  lines.push("");
  for (const option of content.ai.options) {
    lines.push(`- **${option.title}**: ${option.description}`);
  }
  lines.push("");
  lines.push("```bash");
  lines.push(content.ai.envExample);
  lines.push("```");
  lines.push("");
  lines.push(content.ai.setup);
  lines.push("");
  lines.push(content.ai.safety);
  lines.push("");
  lines.push(
    `See [LLM providers](${absoluteLink(baseUrl, content.docs.llmProviders)}).`,
  );

  lines.push("");
  lines.push("## Compliance and data residency");
  lines.push("");
  for (const point of content.compliance) {
    lines.push(`- **${point.title}**: ${point.description}`);
  }

  lines.push("");
  lines.push("## Questions buyers ask");
  for (const faq of content.faqs) {
    lines.push("");
    lines.push(`### ${faq.question}`);
    lines.push("");
    lines.push(faq.answer);
  }

  lines.push("");
  lines.push("## Plan your install");
  lines.push("");
  lines.push(
    `Book a working session with OneUptime's engineers at ${pageUrl}#plan-your-install, or email ${content.planCall.email}.`,
  );

  lines.push("");
  lines.push("## Learn More");
  lines.push("");
  lines.push(
    `- [Self-hosted deployment](${baseUrl}/enterprise/self-hosted.md)`,
  );
  lines.push(
    `- [Self-hosted architecture](${absoluteLink(baseUrl, content.docs.architecture)})`,
  );
  lines.push(
    `- [Offline license activation](${absoluteLink(baseUrl, content.docs.offlineActivation)})`,
  );
  lines.push(`- [Helm chart configuration](${content.helmDocs.configuration})`);
  lines.push(
    `- [All OneUptime products and links for LLMs](${baseUrl}/llms.txt)`,
  );
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

  if (product.competitorPricingTiers && product.competitorPricingTiers.length) {
    lines.push("");
    lines.push(`## ${product.productName} Pricing`);
    for (const tier of product.competitorPricingTiers as Array<PricingTier>) {
      lines.push("");
      lines.push(`### ${tier.name} — ${tier.price} ${tier.period}`);
      if (tier.features && tier.features.length) {
        lines.push("");
        lines.push("Includes:");
        for (const feature of tier.features) {
          lines.push(`- ${feature}`);
        }
      }
      if (tier.limitations && tier.limitations.length) {
        lines.push("");
        lines.push("Limitations:");
        for (const limitation of tier.limitations) {
          lines.push(`- ${limitation}`);
        }
      }
    }
  }

  if (product.useCases && product.useCases.length) {
    lines.push("");
    lines.push("## Real-World Cost Comparison");
    lines.push("");
    lines.push(`| Scenario | ${tableCell(product.productName)} | OneUptime |`);
    lines.push("|---|---|---|");
    for (const useCase of product.useCases as Array<UseCaseComparison>) {
      lines.push(
        `| ${tableCell(useCase.scenario)} | ${tableCell(`${useCase.competitorSolution} — ${useCase.competitorCost}`)} | ${tableCell(`${useCase.oneuptimeSolution} — ${useCase.oneuptimeCost}`)} |`,
      );
    }
  }

  if (product.migrationBenefits && product.migrationBenefits.length) {
    lines.push("");
    lines.push(`## Migrating from ${product.productName}`);
    lines.push("");
    for (const benefit of product.migrationBenefits) {
      lines.push(`- ${benefit}`);
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

/*
 * Manifest served at /.well-known/mcp.json for MCP client discovery.
 *
 * `isOAuthEnabled` is false on an instance that has OAuth sign-in for the MCP
 * server switched off (DISABLE_MCP_OAUTH); the manifest then describes API
 * keys only, as it did before sign-in existed. An MCP client does not need
 * any of this - it discovers OAuth from the endpoint's own 401 - so what is
 * said here is for people and crawlers reading the manifest.
 */
export function generateMcpManifest(
  homeUrl: string,
  options?: { isOAuthEnabled?: boolean | undefined } | undefined,
): JSONObject {
  const baseUrl: string = normalizeBaseUrl(homeUrl);
  const isOAuthEnabled: boolean = options?.isOAuthEnabled !== false;

  const apiKeyInstructions: string = `Create an API key in your OneUptime project settings. Public status page tools and help tools work without authentication. See ${baseUrl}/docs/ai/mcp-server`;

  return {
    name: "OneUptime MCP Server",
    description:
      "Model Context Protocol server for OneUptime. Lets AI agents query and manage incidents, monitors, alerts, on-call schedules, status pages, logs, metrics and traces.",
    endpoint: `${baseUrl}/mcp`,
    transport: ["streamable-http"],
    authentication: isOAuthEnabled
      ? {
          type: "oauth2",
          methods: ["oauth2", "apiKey"],
          oauth2: {
            protectedResourceMetadata: `${baseUrl}/mcp/.well-known/oauth-protected-resource`,
            authorizationServerMetadata: `${baseUrl}/.well-known/oauth-authorization-server/mcp`,
            scopes: [...McpOAuthScopeUtil.ACCESS_SCOPES],
          },
          headers: ["x-api-key", "Authorization: Bearer <api-key>"],
          instructions: `Add the endpoint to an MCP client with no credentials and sign in to OneUptime when the client asks; the client then acts as you in the project you choose. For an unattended agent, use an API key instead: ${apiKeyInstructions}`,
        }
      : {
          type: "apiKey",
          methods: ["apiKey"],
          headers: ["x-api-key", "Authorization: Bearer <api-key>"],
          instructions: apiKeyInstructions,
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
