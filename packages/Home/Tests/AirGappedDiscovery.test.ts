import {
  AIR_GAPPED_PAGE_PATH,
  AIR_GAPPED_SHORT_PATHS,
  AIR_GAPPED_VALUES_YAML,
  AirGappedConnection,
  AirGappedFaq,
  AirGappedPageContent,
  AirGappedStep,
  getAirGappedContent,
} from "../Utils/AirGapped";
import {
  generateAirGappedMarkdown,
  generateLlmsTxt,
} from "../Utils/AIDiscovery";
import PageSEOConfig, { PageSEOData } from "../Utils/PageSEO";
import { REDIRECT_PATHS, isRedirectPath } from "../Utils/Sitemap";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE AIR-GAPPED PAGE, FOR MACHINES AND CRAWLERS.
 *
 * How the page is reached and read without a browser: its route and the
 * short addresses buyers type (each a permanent redirect, none in the
 * sitemap), its sitemap entry, its line in llms.txt, and its markdown
 * variant, /enterprise/air-gapped.md, written from the same content as the
 * page (Utils/AirGapped.ts) - section by section, every link absolute.
 */

const HOME_URL: string = "https://oneuptime.com";
const HOME: string = path.join(__dirname, "..");

const routesSource: string = fs.readFileSync(
  path.join(HOME, "Routes.ts"),
  "utf8",
);
const sitemapSource: string = fs.readFileSync(
  path.join(HOME, "Utils", "Sitemap.ts"),
  "utf8",
);

// Every markdown link's target, and every second-level heading.
/*
 * The target excludes "(" and "]" as well as ")": an attempt never runs past
 * the next "](", so the scan stays linear in the markdown's length.
 */
const MARKDOWN_LINK_TARGET: RegExp = /\]\(([^()\]\s]+)\)/g;
const SECOND_LEVEL_HEADING: RegExp = /^## (.+)$/gm;

/*
 * The source of the app.get( that registers `routePath`, up to the next
 * app.get(: indexOf rather than one regex over thousands of lines.
 */
function bodyOfGetRoute(routePath: string): string | null {
  const declaration: string = `"${routePath}"`;
  let searchFrom: number = 0;

  while (searchFrom < routesSource.length) {
    const index: number = routesSource.indexOf(declaration, searchFrom);

    if (index === -1) {
      return null;
    }

    if (
      routesSource
        .slice(Math.max(0, index - 40), index)
        .trim()
        .endsWith("app.get(")
    ) {
      const rest: string = routesSource.slice(index + declaration.length);
      const next: number = rest.indexOf("app.get(");

      return next === -1 ? rest : rest.slice(0, next);
    }

    searchFrom = index + declaration.length;
  }

  return null;
}

function markdown(
  content: AirGappedPageContent = getAirGappedContent(),
  homeUrl: string = HOME_URL,
): string {
  return generateAirGappedMarkdown(homeUrl, content);
}

describe("the air-gapped page's routes", () => {
  test("the page is registered, rendered with its content and handed its own SEO entry", () => {
    const body: string | null = bodyOfGetRoute(AIR_GAPPED_PAGE_PATH);

    expect(body).not.toBeNull();
    expect(body).toContain("res.render(`${ViewsPath}/air-gapped`");
    expect(body).toContain("airGapped: getAirGappedContent()");
    expect(body).toContain(
      'getSEOForPath(\n          "/enterprise/air-gapped"',
    );
    expect(body).toContain("enableGoogleTagManager: GoogleTagManagerEnabled");
  });

  test.each(
    AIR_GAPPED_SHORT_PATHS.map((shortPath: string) => {
      return [shortPath];
    }),
  )(
    "%s redirects permanently to the page, keeping the query",
    (shortPath: string) => {
      const body: string | null = bodyOfGetRoute(shortPath);

      expect(body).toContain(
        'redirectPreservingQuery(req, res, "/enterprise/air-gapped", 301);',
      );
    },
  );

  test("the short addresses are what buyers type", () => {
    expect(AIR_GAPPED_SHORT_PATHS).toEqual(["/air-gapped", "/airgapped"]);
  });

  test("the short addresses stay out of the sitemap, and the page is in it", () => {
    for (const shortPath of AIR_GAPPED_SHORT_PATHS) {
      expect(REDIRECT_PATHS.has(shortPath)).toBe(true);
      expect(isRedirectPath(shortPath)).toBe(true);
    }

    expect(isRedirectPath(AIR_GAPPED_PAGE_PATH)).toBe(false);
    expect(sitemapSource).toContain(
      '"/enterprise/air-gapped": { priority: 0.8, changefreq: "weekly" }',
    );
  });

  test("its markdown variant is the page's own, not the generic one", () => {
    const start: number = routesSource.indexOf("app.get(/^\\/.+\\.md$/");
    const handler: string = routesSource.slice(
      start,
      routesSource.indexOf("app.get(", start + 1),
    );

    expect(handler).toContain(
      '} else if (pagePath === "/enterprise/air-gapped") {\n        markdown = generateAirGappedMarkdown(homeUrl, getAirGappedContent());',
    );
    // Checked before the generic SEO-entry branch, which would win otherwise.
    expect(
      handler.indexOf('pagePath === "/enterprise/air-gapped"'),
    ).toBeLessThan(handler.indexOf("PageSEOConfig[pagePath]"));
  });
});

describe("llms.txt", () => {
  test("lists the page with the other enterprise pages, linking its markdown", () => {
    const txt: string = generateLlmsTxt(HOME_URL, []);
    const enterprise: string = txt.slice(
      txt.indexOf("## Enterprise"),
      txt.indexOf("## Compare OneUptime"),
    );
    const seo: PageSEOData = PageSEOConfig[AIR_GAPPED_PAGE_PATH]!;

    expect(enterprise).toContain(
      `- [Air-Gapped Monitoring & Observability](https://oneuptime.com/enterprise/air-gapped.md): ${seo.description}`,
    );
  });
});

describe("/enterprise/air-gapped.md", () => {
  test("leads with the page's name, description and canonical address", () => {
    const md: string = markdown();
    const seo: PageSEOData = PageSEOConfig[AIR_GAPPED_PAGE_PATH]!;

    expect(md.startsWith("# Air-Gapped Monitoring & Observability\n")).toBe(
      true,
    );
    expect(md).toContain(`> ${seo.description}`);
    expect(md).toContain(
      "Canonical page: https://oneuptime.com/enterprise/air-gapped",
    );
  });

  test("has the page's sections, in the page's order", () => {
    expect(
      Array.from(
        markdown().matchAll(SECOND_LEVEL_HEADING),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ).toEqual([
      "Who it's for",
      "What runs inside your network",
      "Four steps to an air-gapped install",
      "What reaches out, and what to use instead",
      "OneUptime AI, on a model you run",
      "Compliance and data residency",
      "Questions buyers ask",
      "Plan your install",
      "Learn More",
    ]);
  });

  test("numbers the four steps with the settings each uses", () => {
    const md: string = markdown();

    getAirGappedContent().steps.forEach(
      (step: AirGappedStep, index: number) => {
        // In brackets after the step - and no empty brackets for a step with none.
        const settings: string =
          step.settings.length > 0
            ? ` (${step.settings
                .map((setting: string): string => {
                  return `\`${setting}\``;
                })
                .join(", ")})`
            : "";

        expect(md).toContain(
          `${index + 1}. **${step.title}**: ${step.description}${settings}`,
        );
      },
    );

    expect(md).not.toContain("()");
    // The licensing step names no setting, and still says where to read on.
    expect(md).toContain(
      "4. **License the Enterprise Edition offline**: Running the Enterprise Edition?",
    );
    expect(md).toContain(
      "never contacts us. See [Offline activation](https://oneuptime.com/docs/self-hosted/enterprise#offline-activation-air-gapped-installs).",
    );
  });

  test("keeps the page's code as markdown code: settings and commands between backticks", () => {
    const md: string = markdown();

    expect(md).toContain("pin `image.tag` to the release you mirrored");
    expect(md).toContain("run `helm install`, as on any cluster");
    expect(md).toContain("| Update check (on by default) | `api.github.com` |");
    expect(md).toContain(
      "Set `updateCheck.disabled: true`, or point `updateCheck.url` at a mirror.",
    );
    expect(md).toContain(
      "Set `dnsConfig.nameservers` to `[]` so probes use your DNS alone.",
    );
  });

  test("carries the values.yaml exactly as the page shows it, and the signing key", () => {
    const md: string = markdown();

    expect(md).toContain(`\`\`\`yaml\n${AIR_GAPPED_VALUES_YAML}\n\`\`\``);
    expect(md).toContain(
      "fingerprint 83F2 C1DD F58A 0524 64C4 A172 9D87 E494 AC01 6697",
    );
  });

  test("tables every connection out, marking the ones made by default", () => {
    const md: string = markdown();

    expect(md).toContain(
      "| Connection | Where it goes | When | Inside an air gap |",
    );

    for (const connection of getAirGappedContent().connections) {
      const name: string = connection.onByDefault
        ? `${connection.name} (on by default)`
        : connection.name;

      expect(md).toContain(
        `| ${name} | ${connection.destination} | ${connection.when} | ${connection.inside} |`,
      );
    }
  });

  test("keeps a table cell's own | inside the cell", () => {
    const content: AirGappedPageContent = getAirGappedContent();
    const connections: Array<AirGappedConnection> = [
      {
        ...content.connections[0]!,
        when: "Once a day | then again",
      },
    ];
    const md: string = markdown({ ...content, connections });
    const row: string | undefined = md.split("\n").find((line: string) => {
      return line.startsWith("| Update check");
    });

    expect(row).toBeDefined();
    expect(row).toContain("Once a day \\| then again");
  });

  test("answers every question, each under its own heading", () => {
    const md: string = markdown();

    for (const faq of getAirGappedContent().faqs as Array<AirGappedFaq>) {
      expect(md).toContain(`### ${faq.question}\n\n${faq.answer}`);
    }
  });

  test("writes every link absolute, so it works where the markdown is read", () => {
    const targets: Array<string> = Array.from(
      markdown().matchAll(MARKDOWN_LINK_TARGET),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(targets.length).toBeGreaterThan(8);

    for (const target of targets) {
      expect([target, new URL(target).protocol]).toEqual([target, "https:"]);
    }

    expect(targets).toContain(
      "https://oneuptime.com/docs/self-hosted/enterprise#offline-activation-air-gapped-installs",
    );
    expect(targets).toContain(
      "https://oneuptime.com/docs/ai/llm-provider#self-hosted-zero-config-via-environment-variables",
    );
  });

  test("says where to book or write", () => {
    expect(markdown()).toContain(
      "Book a working session with OneUptime's engineers at https://oneuptime.com/enterprise/air-gapped#plan-your-install, or email enterprise@oneuptime.com.",
    );
  });

  test("normalizes a trailing slash on the home URL", () => {
    const md: string = markdown(
      getAirGappedContent(),
      "https://oneuptime.com/",
    );

    expect(md).toContain(
      "Canonical page: https://oneuptime.com/enterprise/air-gapped\n",
    );
    expect(md).not.toContain("https://oneuptime.com//");
  });
});
