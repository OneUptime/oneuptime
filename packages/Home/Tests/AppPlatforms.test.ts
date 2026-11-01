import {
  AppPlatformCard,
  AppPlatformProviderGroup,
  AppPlatformsPageContent,
  OTHER_PLATFORMS_DOCS_URL,
  getAppPlatformCards,
  getAppPlatformsPageContent,
} from "../Utils/AppPlatforms";
import PageSEOConfig, { PageSEOData, getPageSEO } from "../Utils/PageSEO";
import { isRedirectPath } from "../Utils/Sitemap";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatformDescriptor,
} from "Common/Types/Cloud/CloudPlatform";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * App Platforms on the website: the product the apps on managed app and
 * container platforms moved to out of Cloud, which keeps cloud accounts and
 * every resource in them. Its page lists the platforms from the product's
 * own catalog, each linking to the docs page that sets it up; Cloud's page
 * is about accounts and resources now, and each links to the other. There
 * is no product registry on the site, so every hand-kept product list is
 * rendered here and checked for it.
 */

const HOME: string = path.join(__dirname, "..");
const VIEWS_ROOT: string = path.join(HOME, "Views");
const HOME_URL: string = "https://oneuptime.com";
const DOCS_CONTENT: string = path.join(
  HOME,
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

async function render(
  templateFileName: string,
  locals: Record<string, unknown>,
): Promise<string> {
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, templateFileName),
    locals,
    { views: [VIEWS_ROOT] },
  )) as string;
}

function seoFor(pagePath: string): PageSEOData & { fullCanonicalUrl: string } {
  const seo: PageSEOData = getPageSEO(pagePath);
  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

function escapeForHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#39;");
}

const routesSource: string = fs.readFileSync(
  path.join(HOME, "Routes.ts"),
  "utf-8",
);

describe("the platforms the page lists", () => {
  const cards: Array<AppPlatformCard> = getAppPlatformCards();

  test("are every platform of the product's catalog, once, named as the product names them", () => {
    expect(
      cards.map((card: AppPlatformCard): Array<string> => {
        return [card.platform, card.name];
      }),
    ).toEqual(
      MANAGED_CLOUD_PLATFORMS.map(
        (descriptor: ManagedCloudPlatformDescriptor): Array<string> => {
          return [descriptor.platform, descriptor.productName];
        },
      ),
    );
    expect(
      new Set(cards.map((card: AppPlatformCard) => card.platform)).size,
    ).toBe(cards.length);
  });

  test("each links to the docs page that sets it up, and every one is a real page", () => {
    const byPlatform: Record<string, string> = Object.fromEntries(
      cards.map((card: AppPlatformCard): [string, string] => {
        return [card.platform, card.docsUrl];
      }),
    );

    expect(byPlatform["aws_ecs"]).toBe("/docs/telemetry/cloud-aws-ecs");
    expect(byPlatform["gcp_cloud_run"]).toBe(
      "/docs/telemetry/cloud-gcp-cloud-run",
    );
    expect(byPlatform["azure_container_apps"]).toBe(
      "/docs/telemetry/cloud-azure-container-apps",
    );
    expect(byPlatform["aws_app_runner"]).toBe(OTHER_PLATFORMS_DOCS_URL);
    expect(byPlatform["azure_app_service"]).toBe(OTHER_PLATFORMS_DOCS_URL);

    for (const card of cards) {
      const page: string = path.join(
        DOCS_CONTENT,
        `${card.docsUrl.replace("/docs/", "")}.md`,
      );

      expect({ platform: card.platform, page: fs.existsSync(page) }).toEqual({
        platform: card.platform,
        page: true,
      });
    }
  });

  test("are grouped by cloud, AWS first, with no empty group", () => {
    const content: AppPlatformsPageContent = getAppPlatformsPageContent();

    expect(
      content.providers.map((group: AppPlatformProviderGroup): string => {
        return group.label;
      }),
    ).toEqual(["AWS", "Google Cloud", "Azure"]);
    expect(
      content.providers.flatMap(
        (group: AppPlatformProviderGroup): Array<AppPlatformCard> => {
          return group.platforms;
        },
      ).length,
    ).toBe(content.platforms.length);

    for (const group of content.providers) {
      for (const card of group.platforms) {
        expect(card.provider).toBe(group.provider);
      }
    }
  });
});

describe("app-platforms.ejs", () => {
  let html: string = "";
  const seo: PageSEOData = PageSEOConfig["/product/app-platforms"]!;
  const content: AppPlatformsPageContent = getAppPlatformsPageContent();

  beforeAll(async () => {
    // Exactly the locals Routes.ts hands the template, plus homeUrl.
    html = await render("app-platforms.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/app-platforms"),
      homeUrl: HOME_URL,
      appPlatforms: content,
    });
  });

  test("renders a complete page", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html.length).toBeGreaterThan(10000);
  });

  test("the head is written from the SEO entry", () => {
    expect(html).toContain(`<title>${escapeForHtml(seo.title)}</title>`);
    expect(html).toContain(`content="${escapeForHtml(seo.description)}"`);
  });

  test("says what the product is: the apps on managed platforms", () => {
    expect(html).toContain("Every app on every managed platform");
    expect(html).toContain(
      "AWS ECS and Fargate, Google Cloud Run, Azure App Service",
    );
    expect(html).toContain(
      `${content.platforms.length} managed platforms, one product`,
    );
  });

  test("lists every platform of the catalog, under its cloud, each linking to its setup", () => {
    const section: string = html.slice(
      html.indexOf('id="app-platforms-platforms"'),
      html.indexOf("<!-- Why OneUptime Section -->"),
    );

    for (const card of content.platforms) {
      expect(section).toContain(
        `href="${card.docsUrl}" class="group flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-gray-200 hover:ring-blue-300" data-platform="${card.platform}"`,
      );
      expect(section).toContain(`>${escapeForHtml(card.name)}</span>`);
    }

    for (const group of content.providers) {
      expect(section).toContain(`data-provider="${group.provider}"`);
    }
  });

  test("links to Cloud for the accounts the apps run in", () => {
    const section: string = html.slice(
      html.indexOf('id="app-platforms-cloud"'),
    );

    expect(section).toContain('href="/product/cloud"');
    expect(section).toContain("Explore Cloud");
  });

  test("draws its own product icon, one colour, from currentColor", async () => {
    const icon: string = await render("Partials/icons/app-platforms.ejs", {});

    expect(icon).toContain('stroke="currentColor"');
    expect(icon).toContain('fill="none"');
    expect(icon).not.toMatch(/fill="#|stroke="#/);
    expect(html).toContain(
      icon.slice(icon.indexOf("<path"), icon.indexOf("></path>")),
    );
  });
});

describe("cloud.ejs, after the split", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await render("cloud.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/cloud"),
      homeUrl: HOME_URL,
    });
  });

  test("is about connecting accounts and every resource in them", () => {
    expect(html).toContain(
      "Connect your AWS accounts, Azure subscriptions and Google Cloud projects in a few clicks, read-only.",
    );
    expect(html).toContain("One command. Every account you run.");
    expect(html).toContain("All Resources");
  });

  test("no longer markets the environments, which are App Platforms'", () => {
    expect(html).not.toContain("Cloud Environments");
    expect(html).not.toContain("Environments appear");
    expect(html).not.toContain("View Environment");
  });

  test("links to App Platforms for the apps on managed platforms", () => {
    // In the page itself, beside the nav's and the footer's links.
    const main: string = html.slice(
      html.indexOf('<main id="main-content">'),
      html.indexOf("</main>"),
    );

    // A section of its own, and the feature card about the apps.
    const section: string = main.slice(
      main.indexOf('id="cloud-app-platforms"'),
    );

    expect(section).toContain('href="/product/app-platforms"');
    expect(section).toContain("Explore App Platforms");
    expect(main).toContain(
      '<a href="/product/app-platforms" class="font-medium text-gray-900 underline',
    );
  });

  test("its SEO entry no longer promises auto-discovered environments", () => {
    const seo: PageSEOData = PageSEOConfig["/product/cloud"]!;

    expect(seo.description).not.toContain("environments");
    expect(seo.description).toContain("read-only");
  });
});

describe("App Platforms on every product surface", () => {
  test("the navigation lists it in both the mobile grid and the flyout, next to Cloud", async () => {
    const nav: string = await render("nav.ejs", { homeUrl: HOME_URL });

    expect(nav.split('href="/product/app-platforms"').length - 1).toBe(2);
    expect(nav).toContain(
      'data-search="app platforms paas ecs fargate cloud run app service container apps beanstalk app engine"',
    );

    // Right after Cloud, in each list.
    for (const list of [
      nav.slice(0, nav.indexOf('id="product-modal"')),
      nav.slice(nav.indexOf('id="product-modal"')),
    ]) {
      const cloud: number = list.indexOf('href="/product/cloud"');
      const appPlatforms: number = list.indexOf(
        'href="/product/app-platforms"',
      );

      expect(cloud).toBeGreaterThan(-1);
      expect(appPlatforms).toBeGreaterThan(cloud);
      expect(
        list.slice(cloud, appPlatforms).split('href="/product/').length - 1,
      ).toBe(1);
    }
  });

  test("the footer lists it after Cloud", async () => {
    const footer: string = await render("footer.ejs", {
      footerCards: false,
      cta: false,
      homeUrl: HOME_URL,
    });
    const cloud: number = footer.indexOf('href="/product/cloud"');

    expect(cloud).toBeGreaterThan(-1);
    expect(footer.indexOf('href="/product/app-platforms"')).toBeGreaterThan(
      cloud,
    );
  });

  test("the homepage's product list lists it, with its icon", async () => {
    const products: string = await render("Partials/home-products.ejs", {
      homeUrl: HOME_URL,
    });

    expect(products.split('href="/product/app-platforms"').length - 1).toBe(1);
    expect(products).toContain("App Platforms");
    expect(products).toContain("ECS, Cloud Run &amp; App Service");
  });
});

describe("App Platforms product page", () => {
  test("is registered, renders its own template and hands it the catalog", () => {
    expect(routesSource).toContain('"/product/app-platforms"');
    expect(routesSource).toContain(`${"${ViewsPath}"}/app-platforms`);
    expect(routesSource).toContain(
      "appPlatforms: getAppPlatformsPageContent()",
    );
    expect(routesSource).toContain(
      'import { getAppPlatformsPageContent } from "./Utils/AppPlatforms";',
    );
  });

  test("is a canonical page, not a redirect", () => {
    expect(isRedirectPath("/product/app-platforms")).toBe(false);
  });

  test("resolves SEO data typed as a product, under Products", () => {
    const seo: PageSEOData | undefined =
      PageSEOConfig["/product/app-platforms"];

    expect(seo).toBeDefined();
    expect(seo!.canonicalPath).toBe("/product/app-platforms");
    expect(seo!.pageType).toBe("product");
    expect(seo!.breadcrumbs).toEqual([
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "App Platforms", url: "/product/app-platforms" },
    ]);
    expect(seo!.title.length).toBeLessThanOrEqual(60);
    expect(seo!.description.length).toBeLessThanOrEqual(240);
  });

  test("is prioritised in the sitemap config", () => {
    const sitemapSource: string = fs.readFileSync(
      path.join(HOME, "Utils", "Sitemap.ts"),
      "utf-8",
    );

    expect(sitemapSource).toContain(
      '"/product/app-platforms": { priority: 0.9, changefreq: "weekly" }',
    );
  });
});
