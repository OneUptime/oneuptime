import PageSEOConfig, { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import { getProductCompareSlugs } from "../Utils/ProductCompare";
import {
  ClaimStatuses,
  getClaimsMatrix,
  getClaimsNeedingReview,
} from "../Utils/Claims";
import {
  generateCompareIndexJson,
  generateCompareMarkdown,
  generateLlmsFullTxt,
  generateLlmsTxt,
  generateMcpManifest,
  generatePageMarkdown,
  generatePricingMarkdown,
  generateProductsJson,
} from "../Utils/AIDiscovery";
import {
  DocsAddress,
  DocsAddressTarget,
  docsAddressesIn,
  targetOfDocsAddress,
} from "Common/Tests/Helpers/DocsAddresses";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, test } from "@jest/globals";
import ejs, { IncluderResult } from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * The website's links into the docs, from Home's own CI job.
 *
 * Eight cards on the industries and solutions pages linked a category's own
 * docs address - /docs/compliance, /docs/integrations, /docs/terraform,
 * /docs/rbac, /docs/api, /docs/incidents - which the docs answered with a
 * 404 (compliance, rbac and api are not even categories). Each now names
 * the page it means, and says what it opens. Beyond those, every docs
 * address the website writes - in its sources, and in the AI discovery
 * files it renders (llms.txt, llms-full.txt, every page's Markdown, the
 * comparison pages, products.json, the MCP manifest) - names a page of the
 * docs' nav, the docs' root or one of their files, at a heading the page
 * has.
 *
 * The docs are read as files here, never imported: this job installs only
 * Home's and Common's dependencies. App's Tests/FeatureSet/Docs/
 * WebsiteDocsLinks follows the same links through the docs' real routes.
 */

const HOME: string = path.join(__dirname, "..");
const VIEWS_ROOT: string = path.join(HOME, "Views");
const HOME_URL: string = "https://oneuptime.com";
const DOCS: string = path.join(HOME, "..", "App", "FeatureSet", "Docs");
const DOCS_CONTENT: string = path.join(DOCS, "Content", "en");
// The installers the docs serve at /docs/static/scripts, which a command downloads.
const DOCS_INSTALLERS: string = path.join(DOCS, "Static", "scripts");

// The docs' nav, its languages and the files they serve, read as text.
const NAV_PAGE_URL: RegExp = /url:\s*"\/docs\/([^"/]+\/[^"/]+)"/g;
const DOCS_ROOT_FILE_ROUTE: RegExp = /app\.get\(\s*"\/docs\/([\w-]+\.\w+)"/g;
const JSON_FILE: RegExp = /\.json$/;
const MARKDOWN_HEADING: RegExp = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const CODE_FENCE: RegExp = /^\s*(```|~~~)/;
const WHITESPACE_RUN: RegExp = /\s+/g;
// Tools the devops card used to name, which the Terraform provider does not serve.
const UNSUPPORTED_IAC_TOOLS: RegExp = /pulumi|cloudformation/i;

// What the website is written in. Stylesheets are left out: a selector such as a[href^="/docs/api"] is no link.
const WEBSITE_FILE: RegExp = /\.(?:ts|ejs|js|json|html|md|txt)$/;
const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  ".git",
];
const SKIPPED_FILES: Array<string> = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];

const NAV_PAGES: Array<string> = [
  ...fs
    .readFileSync(path.join(DOCS, "Utils", "Nav.ts"), "utf8")
    .matchAll(NAV_PAGE_URL),
].map((match: RegExpMatchArray): string => {
  return match[1]!;
});

const DOCS_LANGUAGES: Array<string> = fs
  .readdirSync(path.join(DOCS, "Locales"))
  .filter((file: string): boolean => {
    return JSON_FILE.test(file);
  })
  .map((file: string): string => {
    return file.replace(JSON_FILE, "");
  });

const DOCS_ROOT_FILES: Array<string> = [
  ...fs
    .readFileSync(path.join(DOCS, "Index.ts"), "utf8")
    .matchAll(DOCS_ROOT_FILE_ROUTE),
].map((match: RegExpMatchArray): string => {
  return match[1]!;
});

// An English docs page: its title (line 1) and the anchors of its headings.
interface DocsPage {
  title: string;
  anchors: Set<string>;
}

const docsPageOf: (page: string) => DocsPage | null = (
  page: string,
): DocsPage | null => {
  const file: string = path.join(DOCS_CONTENT, `${page}.md`);

  if (!fs.existsSync(file)) {
    return null;
  }

  const lines: Array<string> = fs.readFileSync(file, "utf8").split("\n");
  const anchors: Set<string> = new Set();
  let inFence: boolean = false;

  lines.forEach((line: string, index: number): void => {
    if (CODE_FENCE.test(line)) {
      inFence = !inFence;
      return;
    }

    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(MARKDOWN_HEADING);

    // Line 1 is the title, which the docs show above the page, with no anchor.
    if (heading && index > 0) {
      anchors.add(slugifyMarkdownHeading(heading[1]!));
    }
  });

  return {
    title: (lines[0] || "").replace(MARKDOWN_HEADING, "$1"),
    anchors: anchors,
  };
};

/*
 * One of the docs' installers (/docs/static/scripts/<agent>/install.sh), which
 * the website may name where it sends a reader to it: the infrastructure
 * agent's short address redirects there (Utils/Config.ts). No page, but a
 * file every OneUptime serves, so it leads somewhere when the docs have it.
 */
const isDocsInstaller: (address: DocsAddress) => boolean = (
  address: DocsAddress,
): boolean => {
  const [endpoint, folder, ...rest] = address.names;

  return (
    endpoint === "static" &&
    folder === "scripts" &&
    rest.length > 0 &&
    !rest.includes("..") &&
    address.anchor === null &&
    fs.existsSync(path.join(DOCS_INSTALLERS, ...rest)) &&
    fs.statSync(path.join(DOCS_INSTALLERS, ...rest)).isFile()
  );
};

// Where a docs address leads, or why it leads nowhere.
const problemOf: (address: DocsAddress) => string | null = (
  address: DocsAddress,
): string | null => {
  const target: DocsAddressTarget = targetOfDocsAddress(
    address,
    DOCS_LANGUAGES,
  );

  if (!address.writtenWhole) {
    return "built at run time: write the address out whole";
  }

  switch (target.kind) {
    case "root":
      return null;
    case "file":
      return DOCS_ROOT_FILES.includes(target.name!)
        ? null
        : "a file the docs do not serve";
    case "category":
      return "a category's own address names no page: link the page itself";
    case "page": {
      const page: string = target.name!.toLowerCase();

      if (!NAV_PAGES.includes(page)) {
        return "a page the docs' nav does not list";
      }

      const docsPage: DocsPage | null = docsPageOf(page);

      if (docsPage === null) {
        return "a page with no English copy";
      }

      return address.anchor !== null && !docsPage.anchors.has(address.anchor)
        ? "a heading the page does not have"
        : null;
    }
    default:
      return isDocsInstaller(address) ? null : "not a page of the docs";
  }
};

// The problems of every docs address in a text, with where each is written.
const problemsIn: (where: string, text: string) => Array<string> = (
  where: string,
  text: string,
): Array<string> => {
  return docsAddressesIn(text).flatMap((address: DocsAddress) => {
    const problem: string | null = problemOf(address);
    return problem === null
      ? []
      : [`${where}:${address.line}: ${address.address} (${problem})`];
  });
};

const websiteFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
          walk(full);
        }
      } else if (
        WEBSITE_FILE.test(entry.name) &&
        !SKIPPED_FILES.includes(entry.name)
      ) {
        files.push(full);
      }
    }
  };
  walk(HOME);
  return files;
};

// The AI discovery files, as the routes render them, by their address.
const aiDiscoveryFiles: () => Array<[string, string]> = (): Array<
  [string, string]
> => {
  const files: Array<[string, string]> = [
    ["/llms.txt", generateLlmsTxt(HOME_URL, [])],
    ["/llms-full.txt", generateLlmsFullTxt(HOME_URL, [])],
    ["/pricing.md", generatePricingMarkdown(HOME_URL)],
    ["/products.json", JSON.stringify(generateProductsJson(HOME_URL))],
    ["/compare.json", JSON.stringify(generateCompareIndexJson(HOME_URL))],
    ["/.well-known/mcp.json", JSON.stringify(generateMcpManifest(HOME_URL))],
    [
      "/.well-known/mcp.json (sign-in off)",
      JSON.stringify(generateMcpManifest(HOME_URL, { isOAuthEnabled: false })),
    ],
  ];

  for (const pagePath of Object.keys(PageSEOConfig)) {
    const seo: PageSEOData = getPageSEO(pagePath);
    files.push([`${pagePath}.md`, generatePageMarkdown(seo, HOME_URL)]);
  }

  for (const slug of getProductCompareSlugs()) {
    const markdown: string | null = generateCompareMarkdown(slug, HOME_URL);
    if (markdown !== null) {
      files.push([`/compare/${slug}.md`, markdown]);
    }
  }

  return files;
};

/*
 * A page as Routes.ts renders it, its own words only: every partial it
 * shares with the rest of the site (the head, nav, footer, product grid)
 * is left out.
 */
const renderOwnContent: (
  template: string,
  locals: Record<string, unknown>,
) => Promise<Document> = async (
  template: string,
  locals: Record<string, unknown>,
): Promise<Document> => {
  const html: string = (await ejs.renderFile(
    path.join(VIEWS_ROOT, template),
    { homeUrl: HOME_URL, enableGoogleTagManager: false, ...locals },
    {
      views: [VIEWS_ROOT],
      includer: (included: string): IncluderResult => {
        return { template: `<!-- ${included} -->` };
      },
    },
  )) as string;

  return new JSDOM(html).window.document;
};

const seoFor: (pagePath: string) => PageSEOData & {
  fullCanonicalUrl: string;
} = (pagePath: string): PageSEOData & { fullCanonicalUrl: string } => {
  const seo: PageSEOData = getPageSEO(pagePath);
  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
};

const wordsOf: (element: Element | null | undefined) => string = (
  element: Element | null | undefined,
): string => {
  return (element?.textContent || "").replace(WHITESPACE_RUN, " ").trim();
};

interface CardLink {
  // The page's address, and the card's heading on it.
  page: string;
  card: string;
  // Where the card's link goes, and what it says.
  href: string;
  label: string;
  // The title of the docs page it opens, for a docs link.
  docsTitle: string | null;
}

const CARD_LINKS: Array<CardLink> = [
  {
    page: "/industries/government",
    card: "Compliance Reporting",
    href: "/trust#certifications",
    label: "Compliance Docs",
    docsTitle: null,
  },
  {
    page: "/industries/healthcare",
    card: "HIPAA Compliance Reports",
    href: "/trust#certifications",
    label: "Compliance Docs",
    docsTitle: null,
  },
  {
    page: "/industries/fintech",
    card: "Compliance-Ready Reporting",
    href: "/trust#certifications",
    label: "Compliance Docs",
    docsTitle: null,
  },
  {
    page: "/industries/ecommerce",
    card: "Payment Gateway Health",
    href: "/docs/monitor/external-status-page-monitor",
    label: "Monitor Payment Providers",
    docsTitle: "External Status Page Monitor",
  },
  {
    page: "/solutions/devops",
    card: "Infrastructure as Code",
    href: "/docs/terraform/index",
    label: "Terraform Provider",
    docsTitle: "Terraform Overview",
  },
  {
    page: "/solutions/platform",
    card: "Multi-tenant RBAC",
    href: "/docs/permissions/index",
    label: "RBAC Documentation",
    docsTitle: "Users, Teams & Permissions",
  },
  {
    page: "/solutions/developers",
    card: "API-First Architecture",
    href: "/docs/api-reference/api-reference",
    label: "API Documentation",
    docsTitle: "OneUptime API Reference",
  },
  {
    page: "/solutions/sre",
    card: "Incident Management",
    href: "/docs/incidents/index",
    label: "Incident Docs",
    docsTitle: "Incidents Overview",
  },
];

// A card on a page: the box its heading and its link sit in.
const cardOn: (document: Document, heading: string) => Element = (
  document: Document,
  heading: string,
): Element => {
  const title: Element | undefined = Array.from(
    document.querySelectorAll("h3"),
  ).find((candidate: Element): boolean => {
    return wordsOf(candidate) === heading;
  });

  expect([heading, title !== undefined]).toEqual([heading, true]);

  return title!.parentElement as Element;
};

describe("the cards that linked a category's own docs address", () => {
  test.each(CARD_LINKS)(
    "$page: $card links to $href",
    async (expected: CardLink) => {
      const document: Document = await renderOwnContent(
        `${expected.page.slice(1)}.ejs`,
        { seo: seoFor(expected.page) },
      );
      const links: Array<Element> = Array.from(
        cardOn(document, expected.card).querySelectorAll("a"),
      );

      expect(
        links.map((link: Element): [string | null, string] => {
          return [link.getAttribute("href"), wordsOf(link)];
        }),
      ).toEqual([[expected.href, expected.label]]);
    },
  );

  test("no card on those pages links a category's own docs address, or a docs page that is not there", async () => {
    for (const expected of CARD_LINKS) {
      const document: Document = await renderOwnContent(
        `${expected.page.slice(1)}.ejs`,
        { seo: seoFor(expected.page) },
      );
      const hrefs: Array<string> = Array.from(
        document.querySelectorAll('a[href^="/docs"]'),
      ).map((link: Element): string => {
        return link.getAttribute("href") || "";
      });

      expect({
        page: expected.page,
        problems: problemsIn(expected.page, hrefs.join("\n")),
      }).toEqual({ page: expected.page, problems: [] });
    }
  });

  test.each(
    CARD_LINKS.filter((card: CardLink): boolean => {
      return card.docsTitle !== null;
    }),
  )("$card opens the docs page it means: $docsTitle", (expected: CardLink) => {
    const page: string = expected.href.slice("/docs/".length);
    const docsPage: DocsPage | null = docsPageOf(page);

    expect(NAV_PAGES).toContain(page);
    expect(docsPage?.title).toBe(expected.docsTitle);
  });

  test("the compliance cards open the trust center's certifications, which list each regime they name", async () => {
    const trust: Document = await renderOwnContent("trust.ejs", {
      seo: seoFor("/trust"),
      footerCards: true,
      support: false,
      cta: true,
      blackLogo: false,
      requestDemoCta: false,
      claimStatuses: ClaimStatuses,
      claimsMatrix: getClaimsMatrix(),
      claimsUnderReviewCount: getClaimsNeedingReview().length,
    });
    const certifications: Element | null =
      trust.getElementById("certifications");
    const listed: Array<string> = Array.from(
      certifications?.querySelectorAll("a[href]") || [],
    ).map((link: Element): string => {
      return link.getAttribute("href") || "";
    });

    expect(wordsOf(certifications?.querySelector("h2"))).toBe(
      "Certifications and attestations",
    );
    // Healthcare names HIPAA, fintech PCI DSS and SOC 2; government has FedRAMP.
    expect(listed).toEqual(
      expect.arrayContaining([
        "/legal/hipaa",
        "/legal/pci",
        "/legal/soc-2",
        "/legal/fedramp",
        "/legal/iso-27001",
      ]),
    );
    expect(PageSEOConfig["/trust"]?.canonicalPath).toBe("/trust");
  });

  test("the infrastructure-as-code card names the tools the Terraform docs cover, and no other", async () => {
    const document: Document = await renderOwnContent("solutions/devops.ejs", {
      seo: seoFor("/solutions/devops"),
    });
    const card: string = wordsOf(cardOn(document, "Infrastructure as Code"));
    const terraformDocs: string = fs.readFileSync(
      path.join(DOCS_CONTENT, "terraform", "index.md"),
      "utf8",
    );

    expect(card).toContain("Terraform and OpenTofu.");
    expect(card).not.toMatch(UNSUPPORTED_IAC_TOOLS);
    expect(terraformDocs).toContain("OpenTofu");
    expect(terraformDocs).not.toMatch(UNSUPPORTED_IAC_TOOLS);
  });

  test("the payment card opens the page that watches the providers it names", () => {
    const statusPageDocs: string = fs.readFileSync(
      path.join(DOCS_CONTENT, "monitor", "external-status-page-monitor.md"),
      "utf8",
    );

    expect(statusPageDocs).toContain("https://status.stripe.com");
  });
});

// Node.DOCUMENT_POSITION_FOLLOWING, which jsdom's Node does not lend the test.
const DOCUMENT_POSITION_FOLLOWING: number = 4;

/*
 * A product page sends a reader on to the docs that explain it. The
 * scheduled maintenance page had no way there: under its four "How it
 * works" steps it now links the overview of the docs' Scheduled
 * Maintenance group.
 */
describe("the scheduled maintenance product page", () => {
  test("links the Scheduled Maintenance docs overview, under its four steps", async () => {
    const document: Document = await renderOwnContent(
      "scheduled-maintenance.ejs",
      { seo: seoFor("/product/scheduled-maintenance") },
    );
    const docsLinks: Array<Element> = Array.from(
      document.querySelectorAll('a[href^="/docs"]'),
    );

    expect(
      docsLinks.map((link: Element): [string | null, string] => {
        return [link.getAttribute("href"), wordsOf(link)];
      }),
    ).toEqual([
      [
        "/docs/scheduled-maintenance/index",
        "Read the scheduled maintenance docs \u2192",
      ],
    ]);

    // In the "How It Works" section, after its steps.
    const heading: Element | undefined = Array.from(
      document.querySelectorAll("h2"),
    ).find((candidate: Element): boolean => {
      return wordsOf(candidate) === "From planning to completion in four steps";
    });
    const steps: Array<Element> = Array.from(
      document.querySelectorAll("h3"),
    ).filter((candidate: Element): boolean => {
      return [
        "Schedule Event",
        "Notify Subscribers",
        "Post Updates",
        "Complete & Resolve",
      ].includes(wordsOf(candidate));
    });
    const link: Element = docsLinks[0] as Element;

    expect(heading).toBeDefined();
    expect(steps).toHaveLength(4);
    // The link comes after the last step.
    expect(
      (steps[3] as Element).compareDocumentPosition(link) &
        DOCUMENT_POSITION_FOLLOWING,
    ).toBe(DOCUMENT_POSITION_FOLLOWING);
    expect(heading!.closest("div.relative")?.contains(link)).toBe(true);
  });

  test("opens the first page of the group, as the docs' nav lists it", () => {
    expect(NAV_PAGES).toContain("scheduled-maintenance/index");
    expect(docsPageOf("scheduled-maintenance/index")?.title).toBe(
      "Scheduled Maintenance Overview",
    );
    expect(
      NAV_PAGES.find((page: string): boolean => {
        return page.startsWith("scheduled-maintenance/");
      }),
    ).toBe("scheduled-maintenance/index");
  });
});

describe("every docs address the website writes", () => {
  test("is read from the docs as they are: their nav, languages and files", () => {
    expect(NAV_PAGES.length).toBeGreaterThan(200);
    expect(NAV_PAGES).toEqual(
      expect.arrayContaining([
        "cli/index",
        "terraform/index",
        "permissions/index",
        "incidents/index",
      ]),
    );
    expect(DOCS_LANGUAGES).toEqual(expect.arrayContaining(["en", "de", "fa"]));
    expect(DOCS_LANGUAGES).toHaveLength(17);
    expect(DOCS_ROOT_FILES).toEqual(
      expect.arrayContaining(["llms.txt", "llms-full.txt", "sitemap.xml"]),
    );
    expect(docsPageOf("cli/index")?.anchors.has("install-the-cli")).toBe(true);
  });

  test("tells a link that leads somewhere from one that does not", () => {
    for (const [address, problem] of [
      ['"/docs"', null],
      ['"/docs/de"', null],
      ['"/docs/llms.txt"', null],
      ['"/docs/cli/index#install-the-cli"', null],
      ['"/docs/de/cli/index"', null],
      ['"/docs/compliance"', "category"],
      ['"/docs/terraform"', "category"],
      ['"/docs/de/terraform"', "category"],
      ['"/docs/cli/nope"', "nav does not list"],
      ['"/docs/cli/index#no-such-heading"', "heading the page does not have"],
      ['"/docs/robots.txt"', "do not serve"],
      ['"/docs/static/css/style.css"', "not a page"],
      // An installer the docs serve, which a command downloads; not one they lack.
      ['"/docs/static/scripts/infrastructure-agent/install.sh"', null],
      ['"/docs/static/scripts/no-such-agent/install.sh"', "not a page"],
      ['"/docs/static/scripts/../css/style.css"', "not a page"],
      // A page's title has no anchor: the docs show it above the page.
      [
        `"/docs/cli/index#${slugifyMarkdownHeading(docsPageOf("cli/index")!.title)}"`,
        "heading the page does not have",
      ],
    ] as Array<[string, string | null]>) {
      const found: Array<string> = problemsIn("text", address);

      if (problem === null) {
        expect({ address, found }).toEqual({ address, found: [] });
      } else {
        expect({ address, found: found.join("") }).toEqual({
          address,
          found: expect.stringContaining(problem),
        });
      }
    }
  });

  test("in its views, partials and data, names a page of the docs, at a heading it has", () => {
    const files: Array<string> = websiteFiles();
    let found: number = 0;
    const problems: Array<string> = files.flatMap((file: string) => {
      const text: string = fs.readFileSync(file, "utf8");
      found += docsAddressesIn(text).length;
      return problemsIn(path.relative(HOME, file), text);
    });

    expect(files.length).toBeGreaterThan(100);
    expect(found).toBeGreaterThan(30);
    expect(problems).toEqual([]);
  });

  test("in the AI discovery files it renders, names a page of the docs", () => {
    const files: Array<[string, string]> = aiDiscoveryFiles();
    const found: Array<string> = files.flatMap(
      ([, text]: [string, string]): Array<string> => {
        return docsAddressesIn(text).map((address: DocsAddress): string => {
          return address.address;
        });
      },
    );
    const problems: Array<string> = files.flatMap(
      ([address, text]: [string, string]): Array<string> => {
        return problemsIn(address, text);
      },
    );

    expect(files.length).toBeGreaterThan(100);
    // The docs, their llms.txt and the MCP server's page, written after the origin.
    expect(found).toEqual(
      expect.arrayContaining([
        "/docs",
        "/docs/llms.txt",
        "/docs/ai/mcp-server",
      ]),
    );
    expect(problems).toEqual([]);
  });
});
