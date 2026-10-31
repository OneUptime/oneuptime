// improt API
import "./API/BlogAPI";
import {
  InfrastructureAgentInstallScriptPath,
  InstallScriptPath,
  StaticPath,
  ViewsPath,
} from "./Utils/Config";
import NotFoundUtil from "./Utils/NotFound";
import ProductCompare, {
  Product,
  getProductCompareSlugs,
} from "./Utils/ProductCompare";
import {
  generateSitemapIndexXml,
  generatePagesSitemapXml,
  generateCompareSitemapXml,
  generateIntegrationsSitemapXml,
  generateBlogSitemapXml,
  getBlogSitemapPageCount,
  sendRetiredSitemap,
} from "./Utils/Sitemap";
import { generateBlogRssFeed } from "./Utils/RssFeed";
import PageSEOConfig, { getPageSEO, PageSEOData } from "./Utils/PageSEO";
import DatabaseConfig from "Common/Server/DatabaseConfig";
// Removed unused imports after dynamic sitemap refactor
import { JSONObject } from "Common/Types/JSON";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
} from "Common/Server/Utils/Express";
import "ejs";
// xmlbuilder imports removed (handled inside Sitemap util)
import OSSFriends, { OSSFriend, OSSCategory } from "./Utils/OSSFriends";
import Reviews, { AllReviews, Review } from "./Utils/Reviews";
import Pricing, { PricingCategory, PricingPlans } from "./Utils/Pricing";
import {
  generateLlmsTxt,
  generateLlmsFullTxt,
  generateMcpManifest,
  generatePageMarkdown,
  generatePricingMarkdown,
  generateCompareMarkdown,
  generateProductsJson,
  generateCompareIndexJson,
  generateResellersMarkdown,
  generateAirGappedMarkdown,
  RecentBlogPostLink,
} from "./Utils/AIDiscovery";
import { generateNostrWellKnown } from "./Utils/Nostr";
import {
  generateMicrosoftIdentityAssociation,
  MicrosoftIdentityAssociationPaths,
} from "./Utils/MicrosoftIdentityAssociation";
import BlogPostUtil, { BlogPostHeader } from "./Utils/BlogPost";
import { getSelfHostedContent } from "./Utils/SelfHosted";
import { getAirGappedContent } from "./Utils/AirGapped";
import { getDatabasesPageContent } from "./Utils/Databases";
import { getQueuesPageContent } from "./Utils/Queues";
import { getCliPageContent } from "./Utils/CliPage";
import { getResellersPageContent } from "./Utils/Resellers";
import { getCloudMarketplacesContent } from "./Utils/CloudMarketplaces";
import {
  ResellerInquiryHandlerOptions,
  createDefaultResellerInquiryOptions,
  registerResellerInquiryRoute,
} from "./API/ResellerInquiryAPI";
import { redirectPreservingQuery } from "./Utils/Redirect";
import { redirectLegacyUrl } from "./Utils/LegacyRedirects";
import { fetchGitHubContributors } from "./Utils/GitHubContributors";
import { BackToMetal } from "./Utils/Books/BookCatalog";
import { DefaultBookStore } from "./Utils/Books/BookStore";
import { handleBookContent } from "./Utils/Books/BookContentRoute";
import { getBookPageAssets } from "./Utils/StaticAssets";
import {
  GuidePageContent,
  getGuidePageContent,
} from "./Utils/Integrations/OpenTelemetry/GuidePage";
import {
  getFeaturedGuideCards,
  getIntegrationsIndexContent,
  getIntegrationsScriptPath,
} from "./Utils/Integrations/OpenTelemetry/IntegrationsIndex";
import {
  generateGuideMarkdown,
  generateIntegrationsIndexMarkdown,
} from "./Utils/Integrations/OpenTelemetry/GuideMarkdown";
import { getGuidePage } from "./Utils/Integrations/OpenTelemetry/OpenTelemetryGuides";
import {
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  OPEN_TELEMETRY_GUIDE_PATH_PREFIX,
  OpenTelemetryGuideEntry,
  getOpenTelemetryGuide,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import {
  PROVIDER_LOGO_ROUTE,
  serveProviderLogo,
} from "./Utils/ProviderLogoFiles";
import {
  Claim,
  ClaimStatuses,
  Claims,
  getClaimsMatrix,
  getClaimsNeedingReview,
} from "./Utils/Claims";
import {
  TailwindStylesheet,
  TailwindStylesheetRoutePattern,
  findTailwindStylesheet,
  serveTailwindStylesheet,
} from "./Utils/TailwindStylesheet";
import {
  ProductIconSprite,
  ProductIconSpriteRoutePattern,
  buildProductIconSprite,
  serveProductIconSprite,
} from "./Utils/ProductIconSprite";
import logger from "Common/Server/Utils/Logger";

// import jobs.
import "./Jobs/UpdateBlog";
import { getGitHubStarsCount, formatStarCount } from "./Jobs/FetchGitHubStars";
import {
  getGitHubContributorsCount,
  getGitHubCommitsCount,
  formatCount,
} from "./Jobs/FetchGitHubStats";
import {
  DisableMcpOAuth,
  Host,
  GoogleTagManagerEnabled,
} from "Common/Server/EnvironmentConfig";
import LocalCache from "Common/Server/Infrastructure/LocalCache";

// Helper to get SEO data and merge with homeUrl for templates
const getSEOForPath: (
  path: string,
  homeUrl: string,
) => PageSEOData & { fullCanonicalUrl: string } = (
  path: string,
  homeUrl: string,
): PageSEOData & { fullCanonicalUrl: string } => {
  const seo: PageSEOData = getPageSEO(path);
  const baseUrl: string = homeUrl.replace(/\/$/, "");
  return {
    ...seo,
    fullCanonicalUrl: `${baseUrl}${seo.canonicalPath}`,
  };
};

const HomeFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    // Where the Resellers page's form sends, and its limits (/resellers).
    const resellerInquiry: ResellerInquiryHandlerOptions =
      createDefaultResellerInquiryOptions();

    /*
     * The compiled Tailwind stylesheet the image build wrote
     * (Utils/TailwindStylesheet.ts). Every page reads its URL from
     * app.locals - not res.locals, which the blog's routes (API/BlogAPI.ts,
     * registered before this middleware) never get. With no build the URL
     * is null and head-basic.ejs loads the Play CDN runtime instead.
     */
    const tailwindStylesheet: TailwindStylesheet | null =
      findTailwindStylesheet();

    app.locals["tailwindStylesheetHref"] = tailwindStylesheet
      ? tailwindStylesheet.href
      : null;

    if (tailwindStylesheet) {
      logger.info(`Serving compiled Tailwind CSS: ${tailwindStylesheet.href}`);
    } else {
      logger.warn(
        "No compiled Tailwind CSS (npm run build:css); pages load the Tailwind Play CDN runtime instead.",
      );
    }

    app.get(
      TailwindStylesheetRoutePattern,
      serveTailwindStylesheet(tailwindStylesheet),
    );

    /*
     * The product icons as one cached sprite (Utils/ProductIconSprite.ts),
     * which the nav's menus and the sections below the fold draw from. If it
     * cannot be made, productIconSpriteHref is null and every icon is drawn
     * inline, as before.
     */
    let productIconSprite: ProductIconSprite | null = null;

    try {
      productIconSprite = await buildProductIconSprite();
    } catch (err) {
      logger.error(
        "Could not build the product icon sprite; icons are inline.",
      );
      logger.error(err);
    }

    app.locals["productIconSpriteHref"] = productIconSprite
      ? productIconSprite.href
      : null;

    /*
     * The OpenTelemetry guides the telemetry product pages feature
     * (Views/Partials/integrations/framework-strip.ejs): every page reads
     * them from app.locals, as it reads the stylesheet's URL.
     */
    app.locals["frameworkGuides"] = getFeaturedGuideCards();

    app.get(
      ProductIconSpriteRoutePattern,
      serveProductIconSprite(productIconSprite),
    );

    /*
     * Routes
     *  Middleware to inject baseUrl and SEO data for templates
     */
    app.use(
      async (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
        if (!res.locals["homeUrl"]) {
          try {
            // Try to get cached home URL first.
            let homeUrl: string | undefined = LocalCache.getString(
              "home",
              "url",
            );

            if (!homeUrl) {
              homeUrl = (await DatabaseConfig.getHomeUrl())
                .toString()
                .replace(/\/$/, "");
              LocalCache.setString("home", "url", homeUrl);
            }

            res.locals["homeUrl"] = homeUrl;
          } catch {
            // Fallback hard-coded production domain if env misconfigured
            res.locals["homeUrl"] = "https://oneuptime.com";
          }
        }
        // Inject SEO data for current path
        res.locals["seo"] = getSEOForPath(
          req.path,
          res.locals["homeUrl"] as string,
        );
        /*
         * The GitHub numbers the jobs keep fresh (Jobs/FetchGitHubStars.ts,
         * Jobs/FetchGitHubStats.ts), for any page that shows them. Read from
         * the cache: nothing here asks GitHub.
         */
        res.locals["githubStars"] = formatStarCount(getGitHubStarsCount());
        res.locals["githubContributors"] = formatCount(
          getGitHubContributorsCount(),
        );
        res.locals["githubCommits"] = formatCount(getGitHubCommitsCount());
        next();
      },
    );

    /*
     * AI / LLM discovery endpoints. Everything below is generated from the
     * same data that drives the HTML pages (see Utils/AIDiscovery.ts).
     */

    type GetRecentBlogPostLinksFunction = () => Promise<
      Array<RecentBlogPostLink>
    >;
    const getRecentBlogPostLinks: GetRecentBlogPostLinksFunction =
      async (): Promise<Array<RecentBlogPostLink>> => {
        try {
          const posts: Array<BlogPostHeader> =
            await BlogPostUtil.getBlogPostList();
          return posts.slice(0, 15).map((post: BlogPostHeader) => {
            return {
              title: post.title,
              description: post.description,
              fileName: post.fileName,
            };
          });
        } catch {
          // Blog content may be unavailable (e.g. local dev without the blog repo).
          return [];
        }
      };

    type SendAITextResponseFunction = (
      res: ExpressResponse,
      body: string,
      contentType: string,
    ) => void;
    const sendAITextResponse: SendAITextResponseFunction = (
      res: ExpressResponse,
      body: string,
      contentType: string,
    ): void => {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(body);
    };

    app.get("/llms.txt", async (_req: ExpressRequest, res: ExpressResponse) => {
      try {
        const txt: string = generateLlmsTxt(
          res.locals["homeUrl"] as string,
          await getRecentBlogPostLinks(),
        );
        sendAITextResponse(res, txt, "text/plain; charset=utf-8");
      } catch {
        res.status(500).send("Error generating llms.txt");
      }
    });

    app.get(
      "/llms-full.txt",
      async (_req: ExpressRequest, res: ExpressResponse) => {
        try {
          const txt: string = generateLlmsFullTxt(
            res.locals["homeUrl"] as string,
            await getRecentBlogPostLinks(),
          );
          sendAITextResponse(res, txt, "text/plain; charset=utf-8");
        } catch {
          res.status(500).send("Error generating llms-full.txt");
        }
      },
    );

    // MCP client discovery manifest.
    app.get(
      "/.well-known/mcp.json",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader("Cache-Control", "public, max-age=600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.json(
          generateMcpManifest(res.locals["homeUrl"] as string, {
            isOAuthEnabled: !DisableMcpOAuth,
          }),
        );
      },
    );

    /*
     * NIP-05 identity document. Nostr clients fetch it cross-origin to check
     * that the identifier on the OneUptime account really belongs to this
     * domain, so the open CORS header is part of the spec rather than an
     * extra. Off the canonical host it answers with an empty names object -
     * see Home/Utils/Nostr.ts for why.
     */
    app.get(
      "/.well-known/nostr.json",
      (req: ExpressRequest, res: ExpressResponse) => {
        const requestedName: string | undefined =
          typeof req.query["name"] === "string" ? req.query["name"] : undefined;

        res.setHeader("Cache-Control", "public, max-age=600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.json(
          generateNostrWellKnown({
            host: Host,
            requestedName: requestedName,
          }),
        );
      },
    );

    /*
     * Microsoft Entra fetches this to let OneUptime's app registrations name
     * oneuptime.com as their publisher domain. Off the canonical host it
     * lists no apps - see Home/Utils/MicrosoftIdentityAssociation.ts.
     */
    app.get(
      MicrosoftIdentityAssociationPaths,
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader("Cache-Control", "public, max-age=600");
        res.json(generateMicrosoftIdentityAssociation({ host: Host }));
      },
    );

    // Machine-readable marketing data.
    app.get(
      "/data/pricing.json",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader("Cache-Control", "public, max-age=600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.json({
          plans: PricingPlans,
          telemetryIngestPricePerGB: "$0.10",
          featureMatrix: Pricing,
        });
      },
    );

    app.get(
      "/data/products.json",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader("Cache-Control", "public, max-age=600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.json(generateProductsJson(res.locals["homeUrl"] as string));
      },
    );

    app.get(
      "/data/reviews.json",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader("Cache-Control", "public, max-age=600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.json({
          reviews: AllReviews.map((review: Review) => {
            return { ...review };
          }),
        });
      },
    );

    /*
     * The governed claims matrix, machine-readable. Sales engineering, RFP
     * tooling, and AI agents should read this rather than scrape a landing page.
     */
    app.get(
      "/data/claims.json",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader("Cache-Control", "public, max-age=600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.json({
          statuses: ClaimStatuses,
          claims: Claims.map((claim: Claim) => {
            return { ...claim };
          }),
        });
      },
    );

    app.get(
      "/data/compare.json",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader("Cache-Control", "public, max-age=600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.json(generateCompareIndexJson(res.locals["homeUrl"] as string));
      },
    );

    app.get(
      "/data/compare/:product",
      (req: ExpressRequest, res: ExpressResponse) => {
        const product: Product | undefined = ProductCompare(
          req.params["product"] as string,
        );
        if (!product) {
          res.status(404);
          res.setHeader("Access-Control-Allow-Origin", "*");
          return res.json({ error: "Comparison not found" });
        }
        res.setHeader("Cache-Control", "public, max-age=600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.json(product as unknown as JSONObject);
      },
    );

    /*
     * Markdown variants of marketing pages: append `.md` to a page path
     * (e.g. /pricing.md, /product/monitoring.md, /compare/pagerduty.md).
     * Generated from the same structured data as the HTML pages. A variant
     * is the page again, for tools and AI assistants, so it is never a
     * search result of its own: every answer here is noindex.
     */
    app.get(/^\/.+\.md$/, (req: ExpressRequest, res: ExpressResponse) => {
      res.setHeader("X-Robots-Tag", "noindex");
      const homeUrl: string = res.locals["homeUrl"] as string;
      const pagePath: string = req.path.replace(/\.md$/, "");

      let markdown: string | null = null;

      if (pagePath === "/pricing") {
        markdown = generatePricingMarkdown(homeUrl);
      } else if (pagePath === "/resellers") {
        markdown = generateResellersMarkdown(
          homeUrl,
          getResellersPageContent({
            inquiryInbox: resellerInquiry.inbox.toString(),
          }),
        );
      } else if (pagePath === "/enterprise/air-gapped") {
        markdown = generateAirGappedMarkdown(homeUrl, getAirGappedContent());
      } else if (pagePath === OPEN_TELEMETRY_GUIDES_INDEX_PATH) {
        markdown = generateIntegrationsIndexMarkdown(homeUrl);
      } else if (pagePath.startsWith(OPEN_TELEMETRY_GUIDE_PATH_PREFIX)) {
        const guide: ReturnType<typeof getGuidePage> = getGuidePage(
          pagePath.slice(OPEN_TELEMETRY_GUIDE_PATH_PREFIX.length),
        );
        markdown = guide ? generateGuideMarkdown(guide, homeUrl) : null;
      } else if (pagePath.startsWith("/compare/")) {
        markdown = generateCompareMarkdown(
          pagePath.replace("/compare/", ""),
          homeUrl,
        );
      } else if (PageSEOConfig[pagePath]) {
        markdown = generatePageMarkdown(PageSEOConfig[pagePath]!, homeUrl);
      }

      if (!markdown) {
        res.status(404);
        return res
          .type("text/plain; charset=utf-8")
          .send(
            "No markdown variant for this page. See /llms.txt for available content.",
          );
      }

      return sendAITextResponse(res, markdown, "text/markdown; charset=utf-8");
    });

    app.get("/", (_req: ExpressRequest, res: ExpressResponse) => {
      const { reviewsList1, reviewsList2, reviewsList3 } = Reviews;
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/",
        res.locals["homeUrl"] as string,
      );

      const githubStars: string | null = formatStarCount(getGitHubStarsCount());
      const githubContributors: string = formatCount(
        getGitHubContributorsCount(),
      );
      const githubCommits: string = formatCount(getGitHubCommitsCount());

      res.render(`${ViewsPath}/index`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        reviewsList1,
        reviewsList2,
        reviewsList3,
        seo,
        githubStars,
        githubContributors,
        githubCommits,
        // The homepage's air-gapped section states the air-gapped page's own facts.
        airGapped: getAirGappedContent(),
      });
    });

    app.get(
      "/infrastructure-agent/install.sh",
      (_req: ExpressRequest, res: ExpressResponse) => {
        /*
         * The infrastructure agent's installer is served by every OneUptime
         * with its docs (packages/App/FeatureSet/Docs/Static), so this
         * address sends readers to it on this same host, never to GitHub.
         */
        res.redirect(InfrastructureAgentInstallScriptPath);
      },
    );

    app.get("/install.sh", (_req: ExpressRequest, res: ExpressResponse) => {
      /*
       * Served from this image rather than redirected to raw GitHub, so the
       * installer keeps working when files move in the repository.
       */
      res.sendFile(InstallScriptPath);
    });

    app.get("/support", async (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/support",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/support`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get("/books", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/books",
        res.locals["homeUrl"] as string,
      );

      // Start loading the full text now, so the reader opens without waiting.
      DefaultBookStore.warm(BackToMetal.slug);

      res.render(`${ViewsPath}/books.ejs`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        book: BackToMetal,
        bookAssets: getBookPageAssets(),
        seo,
      });
    });

    // The full text of a book, for the in-page reader on /books.
    app.get("/books/:slug/content.json", handleBookContent);

    app.get(
      "/oss-friends",
      async (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/oss-friends",
          res.locals["homeUrl"] as string,
        );

        // Get unique categories in the order they appear
        const categories: OSSCategory[] = [];
        for (const friend of OSSFriends) {
          if (!categories.includes(friend.category)) {
            categories.push(friend.category);
          }
        }

        res.render(`${ViewsPath}/oss-friends`, {
          ossFriends: OSSFriends.map((friend: OSSFriend) => {
            return {
              ...friend,
              repositoryUrl: friend.repositoryUrl.toString(),
              websiteUrl: friend.websiteUrl.toString(),
            };
          }),
          categories,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get("/pricing", (_req: ExpressRequest, res: ExpressResponse) => {
      const pricing: Array<PricingCategory> = Pricing;

      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/pricing",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/pricing`, {
        pricing,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
        // The line under the plans naming OneUptime Cloud's marketplace listings.
        cloudMarketplaces: getCloudMarketplacesContent(),
      });
    });

    app.get(
      "/enterprise/demo",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/enterprise/demo",
          res.locals["homeUrl"] as string,
        );
        const { reviewsList1, reviewsList2, reviewsList3 } = Reviews;
        res.render(`${ViewsPath}/demo`, {
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          footerCards: false,
          cta: false,
          blackLogo: true,
          requestDemoCta: false,
          seo,
          reviewsList1,
          reviewsList2,
          reviewsList3,
        });
      },
    );

    /*
     * oneuptime.com/demo and the other addresses people type for the demo
     * page (Utils/DemoPage.ts, DEMO_SHORT_PATHS), kept alive the way the
     * self-hosted ones are: each moves permanently to the page, keeping the
     * query string a campaign carries.
     */
    app.get("/demo", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get("/request-demo", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get("/request-a-demo", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get("/book-demo", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get("/book-a-demo", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get("/schedule-demo", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get("/schedule-a-demo", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get("/get-demo", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get("/get-a-demo", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get("/contact-sales", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/demo", 301);
    });

    app.get(
      "/enterprise/request-demo",
      (req: ExpressRequest, res: ExpressResponse) => {
        redirectPreservingQuery(req, res, "/enterprise/demo", 301);
      },
    );

    /*
     * Resellers: the companies that sell OneUptime by region, and the form
     * other companies send to become one (Utils/Resellers.ts). The form
     * posts to RESELLER_INQUIRY_PATH, which emails the one inbox inquiries
     * go to (API/ResellerInquiryAPI.ts); the page names that inbox for
     * people who would rather write.
     */
    app.get("/resellers", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/resellers",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/resellers`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
        resellers: getResellersPageContent({
          inquiryInbox: resellerInquiry.inbox.toString(),
        }),
      });
    });

    registerResellerInquiryRoute(app, resellerInquiry);

    app.get(
      "/product/status-page",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/status-page",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/status-page`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/logs-management",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/logs-management",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/logs-management`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get("/status-page", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/product/status-page", 301);
    });

    app.get("/logs-management", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/product/logs-management", 301);
    });

    let gitHubContributors: Array<JSONObject> = [];

    app.get("/about", async (_req: ExpressRequest, res: ExpressResponse) => {
      if (gitHubContributors.length === 0) {
        /*
         * Bounded and never throws (Utils/GitHubContributors.ts): when GitHub
         * refuses, the page renders with what arrived, or with none, and the
         * next visit asks again. A list that arrived is kept.
         */
        gitHubContributors = await fetchGitHubContributors();
      }

      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/about",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/about`, {
        /*
         * Only the contributors: the page shows nothing else of GitHub's (the
         * commit count it used to ask GitHub for on every visit, and the
         * repository's details, were never on it).
         */
        contributors: gitHubContributors,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get("/workflows", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/product/workflows", 301);
    });

    app.get("/runbooks", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/product/runbooks", 301);
    });

    app.get("/on-call", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/product/on-call", 301);
    });

    app.get(
      "/product/monitoring",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/monitoring",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/monitoring`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/on-call",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/on-call",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/on-call`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/workflows",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/workflows",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/workflows`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/runbooks",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/runbooks",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/runbooks`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/incident-management",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/incident-management",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/incident-management`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/ai-agent",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/ai-agent",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/ai-agent`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/metrics",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/metrics",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/metrics`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/kubernetes",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/kubernetes",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/kubernetes`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get("/product/docker", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/docker",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/docker`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get("/product/podman", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/podman",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/podman`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get("/product/host", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/host",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/host`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get(
      "/product/proxmox",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/proxmox",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/proxmox`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get("/product/vmware", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/vmware",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/vmware`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get(
      "/product/ai-observability",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/ai-observability",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/ai-observability`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get("/product/ceph", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/ceph",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/ceph`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get(
      "/product/docker-swarm",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/docker-swarm",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/docker-swarm`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get("/product/iot", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/iot",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/iot`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get(
      "/product/network-monitoring",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/network-monitoring",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/network-monitoring`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/observability",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/observability",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/observability`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/topology",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/topology",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/topology`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/security-events",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/security-events",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/security-events`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/services",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/services",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/services`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/databases",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/databases",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/databases`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
          databases: getDatabasesPageContent(),
        });
      },
    );

    app.get("/product/queues", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/queues",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/queues`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
        queues: getQueuesPageContent(),
      });
    });

    app.get(
      "/product/profiles",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/profiles",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/profiles`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/scheduled-maintenance",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/scheduled-maintenance",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/scheduled-maintenance`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/scheduled-maintenance",
      (req: ExpressRequest, res: ExpressResponse) => {
        redirectPreservingQuery(
          req,
          res,
          "/product/scheduled-maintenance",
          301,
        );
      },
    );

    app.get("/product/traces", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/traces",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/traces`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get(
      "/product/exceptions",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/exceptions",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/exceptions`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/dashboards",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/dashboards",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/dashboards`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/serverless",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/serverless",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/serverless`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get("/product/cloud", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/cloud",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/cloud`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get("/product/rum", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/rum",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/rum`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get(
      "/incident-management",
      (req: ExpressRequest, res: ExpressResponse) => {
        redirectPreservingQuery(req, res, "/product/incident-management", 301);
      },
    );

    app.get("/ai-agent", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/product/ai-agent", 301);
    });

    app.get(
      "/tool/mcp-server",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/tool/mcp-server",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/mcp-server`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get("/tool/cli", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/tool/cli",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/cli`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
        cli: getCliPageContent(),
      });
    });

    app.get(
      "/enterprise/overview",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const { reviewsList1, reviewsList2, reviewsList3 } = Reviews;
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/enterprise/overview",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/enterprise-overview.ejs`, {
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          footerCards: true,
          cta: true,
          blackLogo: false,
          requestDemoCta: true,
          reviewsList1,
          reviewsList2,
          reviewsList3,
          seo,
        });
      },
    );

    app.get(
      "/enterprise/self-hosted",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/enterprise/self-hosted",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/self-hosted.ejs`, {
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          footerCards: true,
          cta: false,
          blackLogo: false,
          requestDemoCta: true,
          selfHosted: getSelfHostedContent(),
          seo,
        });
      },
    );

    /*
     * `/self-hosted` and `/on-premise` are what buyers type and what search
     * results point at. Keep them alive, pointing at the canonical page.
     */
    app.get("/self-hosted", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/self-hosted", 301);
    });

    app.get("/self-hosting", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/self-hosted", 301);
    });

    app.get("/on-premise", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/self-hosted", 301);
    });

    /*
     * Air-gapped installs: running OneUptime on a network with no route to
     * the internet (Utils/AirGapped.ts holds every fact the page states).
     * The short addresses are what buyers type, kept alive the way the
     * self-hosted ones are.
     */
    app.get(
      "/enterprise/air-gapped",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/enterprise/air-gapped",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/air-gapped`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
          airGapped: getAirGappedContent(),
        });
      },
    );

    app.get("/air-gapped", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/air-gapped", 301);
    });

    app.get("/airgapped", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/enterprise/air-gapped", 301);
    });

    // Solutions pages
    app.get(
      "/solutions/devops",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/solutions/devops",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/solutions/devops`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get("/solutions/sre", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/solutions/sre",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/solutions/sre`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo,
      });
    });

    app.get(
      "/solutions/platform",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/solutions/platform",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/solutions/platform`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/solutions/developers",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/solutions/developers",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/solutions/developers`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/solutions/incident-response",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/solutions/incident-response",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/solutions/incident-response`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/solutions/uptime-monitoring",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/solutions/uptime-monitoring",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/solutions/uptime-monitoring`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/solutions/observability",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/solutions/observability",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/solutions/observability`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/solutions/status-communication",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/solutions/status-communication",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/solutions/status-communication`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    // Industries pages
    app.get(
      "/industries/fintech",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/industries/fintech",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/industries/fintech`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/industries/saas",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/industries/saas",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/industries/saas`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/industries/healthcare",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/industries/healthcare",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/industries/healthcare`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/industries/ecommerce",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/industries/ecommerce",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/industries/ecommerce`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/industries/media",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/industries/media",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/industries/media`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    app.get(
      "/industries/government",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/industries/government",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/industries/government`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo,
        });
      },
    );

    /*
     * /legal always rendered the Terms of Service: the same page as
     * /legal/terms, under a second URL, so search engines saw two copies of
     * one document. It redirects there permanently, which keeps what every
     * link to /legal (the footer, the trust center, the product's own
     * footers) has always shown, and leaves one URL to rank. The Legal Center
     * header and sidebar on every legal page still list every document.
     */
    app.get("/legal", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/legal/terms", 301);
    });

    app.get("/legal/terms", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "terms",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/terms", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/privacy", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "privacy",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/privacy", res.locals["homeUrl"] as string),
      });
    });

    app.get(
      "/legal/code-of-conduct",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          footerCards: true,
          cta: true,
          blackLogo: false,
          section: "code-of-conduct",
          requestDemoCta: false,
          seo: getSEOForPath(
            "/legal/code-of-conduct",
            res.locals["homeUrl"] as string,
          ),
        });
      },
    );

    app.get("/legal/contact", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "contact",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/contact", res.locals["homeUrl"] as string),
      });
    });

    app.get(
      "/legal/subprocessors",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          footerCards: true,
          cta: true,
          blackLogo: false,
          section: "subprocessors",
          requestDemoCta: false,
          seo: getSEOForPath(
            "/legal/subprocessors",
            res.locals["homeUrl"] as string,
          ),
        });
      },
    );

    app.get("/legal/dpa", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "dpa",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/dpa", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/ccpa", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "ccpa",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/ccpa", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/cookies", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "cookies",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/cookies", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/hipaa", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "hipaa",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/hipaa", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/dmca", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "dmca",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/dmca", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/pci", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "pci",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/pci", res.locals["homeUrl"] as string),
      });
    });

    app.get(
      "/legal/iso-27001",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          footerCards: true,
          cta: true,
          blackLogo: false,
          section: "iso-27001",
          requestDemoCta: false,
          seo: getSEOForPath(
            "/legal/iso-27001",
            res.locals["homeUrl"] as string,
          ),
        });
      },
    );

    app.get(
      "/legal/iso-27017",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          cta: true,
          blackLogo: false,
          section: "iso-27017",
          requestDemoCta: false,
          seo: getSEOForPath(
            "/legal/iso-27017",
            res.locals["homeUrl"] as string,
          ),
        });
      },
    );

    app.get(
      "/legal/iso-27018",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          cta: true,
          blackLogo: false,
          section: "iso-27018",
          requestDemoCta: false,
          seo: getSEOForPath(
            "/legal/iso-27018",
            res.locals["homeUrl"] as string,
          ),
        });
      },
    );

    app.get("/legal/soc-2", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "soc-2",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/soc-2", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/soc-3", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "soc-3",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/soc-3", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/vpat", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "vpat",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/vpat", res.locals["homeUrl"] as string),
      });
    });

    app.get(
      "/legal/data-residency",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          cta: true,
          blackLogo: false,
          section: "data-residency",
          requestDemoCta: false,
          seo: getSEOForPath(
            "/legal/data-residency",
            res.locals["homeUrl"] as string,
          ),
        });
      },
    );

    app.get("/legal/gdpr", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "gdpr",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/gdpr", res.locals["homeUrl"] as string),
      });
    });

    app.get(
      "/legal/21-cfr-part-11",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          cta: true,
          blackLogo: false,
          section: "21-cfr-part-11",
          requestDemoCta: false,
          seo: getSEOForPath(
            "/legal/21-cfr-part-11",
            res.locals["homeUrl"] as string,
          ),
        });
      },
    );

    app.get("/legal/gamp-5", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "gamp-5",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/gamp-5", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/annex-11", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "annex-11",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/annex-11", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/iso-9001", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "iso-9001",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/iso-9001", res.locals["homeUrl"] as string),
      });
    });

    app.get(
      "/legal/gxp-cloud",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          cta: true,
          blackLogo: false,
          section: "gxp-cloud",
          requestDemoCta: false,
          seo: getSEOForPath(
            "/legal/gxp-cloud",
            res.locals["homeUrl"] as string,
          ),
        });
      },
    );

    app.get("/legal/csa-star", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "csa-star",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/csa-star", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/fedramp", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "fedramp",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/fedramp", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/sla", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "sla",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/sla", res.locals["homeUrl"] as string),
      });
    });

    app.get("/legal/security", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        section: "security",
        requestDemoCta: false,
        seo: getSEOForPath("/legal/security", res.locals["homeUrl"] as string),
      });
    });

    app.get(
      "/legal/deprecation-policy",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          cta: true,
          blackLogo: false,
          section: "deprecation-policy",
          requestDemoCta: false,
          seo: getSEOForPath(
            "/legal/deprecation-policy",
            res.locals["homeUrl"] as string,
          ),
        });
      },
    );

    app.get("/trust", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/trust",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/trust.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        claimStatuses: ClaimStatuses,
        claimsMatrix: getClaimsMatrix(),
        claimsUnderReviewCount: getClaimsNeedingReview().length,
        seo,
      });
    });

    /*
     * /trust is the canonical trust center. /security and /security-center are
     * what people type and what security questionnaires link to.
     */
    app.get("/security", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/trust", 301);
    });

    app.get("/security-center", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/trust", 301);
    });

    app.get("/trust-center", (req: ExpressRequest, res: ExpressResponse) => {
      redirectPreservingQuery(req, res, "/trust", 301);
    });

    // Compare index / landing page
    app.get("/compare", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/compare",
        res.locals["homeUrl"] as string,
      );

      /*
       * Curated grouping of comparisons. Any slug not listed here is appended
       * to a final "More comparisons" group so new entries never disappear.
       */
      const groupDefinitions: Array<{ title: string; slugs: Array<string> }> = [
        {
          title: "Incident Response & On-Call",
          slugs: [
            "pagerduty",
            "incident.io",
            "opsgenie",
            "squadcast",
            "firehydrant",
            "rootly",
            "xmatters",
          ],
        },
        {
          title: "Monitoring & Observability",
          slugs: [
            "datadog",
            "newrelic",
            "signoz",
            "grafana",
            "dynatrace",
            "splunk",
            "sentry",
            "appdynamics",
            "elastic",
            "prometheus",
            "zabbix",
            "nagios",
          ],
        },
        {
          title: "Uptime & Synthetic Monitoring",
          slugs: [
            "pingdom",
            "uptime-robot",
            "checkly",
            "better-uptime",
            "site24x7",
            "cronitor",
            "healthchecks-io",
            "freshping",
          ],
        },
        {
          title: "Status Pages",
          slugs: ["statuspage.io", "instatus"],
        },
      ];

      const allSlugs: Array<string> = getProductCompareSlugs();
      const usedSlugs: Set<string> = new Set<string>();

      const toCard: (slug: string) => {
        slug: string;
        productName: string;
        tagline: string;
        iconUrl: string;
      } | null = (slug: string) => {
        const product: Product = ProductCompare(slug);
        if (!product) {
          return null;
        }
        usedSlugs.add(slug);
        return {
          slug,
          productName: product.productName,
          tagline: product.tagline,
          iconUrl: product.iconUrl,
        };
      };

      const compareGroups: Array<{
        title: string;
        items: Array<{
          slug: string;
          productName: string;
          tagline: string;
          iconUrl: string;
        }>;
      }> = groupDefinitions
        .map((group: { title: string; slugs: Array<string> }) => {
          return {
            title: group.title,
            items: group.slugs
              .filter((slug: string) => {
                return allSlugs.includes(slug);
              })
              .map(toCard)
              .filter(
                (
                  card: {
                    slug: string;
                    productName: string;
                    tagline: string;
                    iconUrl: string;
                  } | null,
                ): card is {
                  slug: string;
                  productName: string;
                  tagline: string;
                  iconUrl: string;
                } => {
                  return card !== null;
                },
              ),
          };
        })
        .filter((group: { title: string; items: Array<unknown> }) => {
          return group.items.length > 0;
        });

      const remaining: Array<string> = allSlugs.filter((slug: string) => {
        return !usedSlugs.has(slug);
      });
      if (remaining.length > 0) {
        compareGroups.push({
          title: "More comparisons",
          items: remaining.map(toCard).filter(
            (
              card: {
                slug: string;
                productName: string;
                tagline: string;
                iconUrl: string;
              } | null,
            ): card is {
              slug: string;
              productName: string;
              tagline: string;
              iconUrl: string;
            } => {
              return card !== null;
            },
          ),
        });
      }

      res.render(`${ViewsPath}/compare-index.ejs`, {
        support: false,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        compareGroups,
        compareCount: allSlugs.length,
        seo,
      });
    });

    app.get(
      "/compare/:product",
      (req: ExpressRequest, res: ExpressResponse) => {
        const productConfig: Product = ProductCompare(
          req.params["product"] as string,
        );

        if (!productConfig) {
          return NotFoundUtil.renderNotFound(res);
        }
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          `/compare/${req.params["product"]}`,
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/product-compare.ejs`, {
          support: false,
          enableGoogleTagManager: GoogleTagManagerEnabled,
          footerCards: true,
          cta: true,
          blackLogo: false,
          requestDemoCta: false,
          productConfig,
          onlyShowCompareTable: false,
          seo,
        });
      },
    );

    /*
     * The integrations: one OpenTelemetry guide per framework, and their
     * index, grouped by language (Utils/Integrations/OpenTelemetry). Each
     * guide is data of one shape, drawn by one template; a slug the catalog
     * does not know is the site's not-found page.
     */
    app.get(PROVIDER_LOGO_ROUTE, serveProviderLogo);

    app.get("/integrations", (_req: ExpressRequest, res: ExpressResponse) => {
      const homeUrl: string = res.locals["homeUrl"] as string;
      res.render(`${ViewsPath}/integrations/index`, {
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo: getSEOForPath("/integrations", homeUrl),
        integrations: getIntegrationsIndexContent(homeUrl),
        integrationsScript: getIntegrationsScriptPath(),
      });
    });

    // The guides' folder is no page of its own: it is the index.
    app.get(
      "/integrations/opentelemetry",
      (req: ExpressRequest, res: ExpressResponse) => {
        redirectPreservingQuery(req, res, "/integrations", 301);
      },
    );

    app.get(
      "/integrations/opentelemetry/:framework",
      (req: ExpressRequest, res: ExpressResponse) => {
        const slug: string = String(req.params["framework"] || "");
        const entry: OpenTelemetryGuideEntry | undefined =
          getOpenTelemetryGuide(slug);
        const homeUrl: string = res.locals["homeUrl"] as string;
        const guide: GuidePageContent | null = entry
          ? getGuidePageContent(entry.slug, homeUrl)
          : null;

        if (!guide) {
          return NotFoundUtil.renderNotFound(res);
        }

        return res.render(`${ViewsPath}/integrations/opentelemetry-guide`, {
          enableGoogleTagManager: GoogleTagManagerEnabled,
          seo: getSEOForPath(`/integrations/opentelemetry/${slug}`, homeUrl),
          guide: guide,
          integrationsScript: getIntegrationsScriptPath(),
        });
      },
    );

    // Dynamic Sitemap Index
    app.get(
      "/sitemap.xml",
      async (_req: ExpressRequest, res: ExpressResponse) => {
        try {
          const xml: string = await generateSitemapIndexXml();
          res.setHeader("Content-Type", "text/xml");
          res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
          res.send(xml);
        } catch {
          // Fallback minimal sitemap index if dynamic generation fails
          const fallback: string = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</sitemapindex>`;
          res.setHeader("Content-Type", "text/xml");
          res.status(200).send(fallback);
        }
      },
    );

    // Static pages sitemap
    app.get(
      "/sitemap-pages.xml",
      async (_req: ExpressRequest, res: ExpressResponse) => {
        try {
          const xml: string = await generatePagesSitemapXml();
          res.setHeader("Content-Type", "text/xml");
          res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
          res.send(xml);
        } catch {
          res.status(500).send("Error generating sitemap");
        }
      },
    );

    // Compare pages sitemap
    app.get(
      "/sitemap-compare.xml",
      async (_req: ExpressRequest, res: ExpressResponse) => {
        try {
          const xml: string = await generateCompareSitemapXml();
          res.setHeader("Content-Type", "text/xml");
          res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
          res.send(xml);
        } catch {
          res.status(500).send("Error generating sitemap");
        }
      },
    );

    // The OpenTelemetry guides' sitemap
    app.get(
      "/sitemap-integrations.xml",
      async (_req: ExpressRequest, res: ExpressResponse) => {
        try {
          const xml: string = await generateIntegrationsSitemapXml();
          res.setHeader("Content-Type", "text/xml");
          res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
          res.send(xml);
        } catch {
          res.status(500).send("Error generating sitemap");
        }
      },
    );

    /*
     * Blog tags sitemaps, retired: tag pages are noindex, and the index no
     * longer lists these. Gone (410), so crawlers drop the addresses.
     */
    app.get(
      "/sitemap-tags-:page.xml",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return sendRetiredSitemap(res);
      },
    );

    // Blog posts sitemap (paginated)
    app.get(
      "/sitemap-blog-:page.xml",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const page: number = parseInt(req.params["page"] as string, 10);

          if (isNaN(page) || page < 1) {
            return res.status(404).send("Invalid sitemap page");
          }

          // Check if page exists
          const totalPages: number = await getBlogSitemapPageCount();
          if (page > totalPages) {
            return res.status(404).send("Sitemap page not found");
          }

          const xml: string = await generateBlogSitemapXml(page);
          res.setHeader("Content-Type", "text/xml");
          res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
          return res.send(xml);
        } catch {
          return res.status(500).send("Error generating sitemap");
        }
      },
    );

    // Blog RSS feed (all posts)
    app.get(
      "/blog/rss.xml",
      async (_req: ExpressRequest, res: ExpressResponse) => {
        try {
          const xml: string = await generateBlogRssFeed();
          res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
          res.send(xml);
        } catch {
          res.status(500).send("Error generating RSS feed");
        }
      },
    );

    /*
     * A tag's RSS feed, /blog/tag/:tagSlug/rss.xml, is served by API/BlogAPI.ts
     * with the tag's page, ahead of its route for the tags' old addresses.
     */

    // robots.txt (dynamic) - If domain is not oneuptime.com, disallow all.
    app.get("/robots.txt", (_req: ExpressRequest, res: ExpressResponse) => {
      let body: string = "";

      if (Host !== "oneuptime.com") {
        // Disallow everything on non-production / preview / on-prem domains so they are not indexed.
        body = [
          "User-agent: *",
          "Disallow: /",
          "# Disallowed because host is not oneuptime.com",
        ].join("\n");
      } else {
        /*
         * Allow all and point to sitemap
         * res.locals.homeUrl is set earlier middleware; fallback to canonical domain.
         */
        const homeUrl: string = (
          res.locals["homeUrl"] || "https://oneuptime.com"
        ).replace(/\/$/, "");
        body = [
          `# LLM-friendly content index: ${homeUrl}/llms.txt`,
          "",
          "# AI / LLM crawlers are welcome.",
          "User-agent: GPTBot",
          "User-agent: ChatGPT-User",
          "User-agent: OAI-SearchBot",
          "User-agent: ClaudeBot",
          "User-agent: Claude-Web",
          "User-agent: anthropic-ai",
          "User-agent: PerplexityBot",
          "User-agent: Google-Extended",
          "User-agent: cohere-ai",
          "User-agent: meta-externalagent",
          "Allow: /",
          "Allow: /api/openapi",
          "Disallow: /api/",
          "",
          "User-agent: *",
          "Allow: /",
          "Allow: /api/openapi",
          "Disallow: /api/",
          "",
          `Sitemap: ${homeUrl}/sitemap.xml`,
        ].join("\n");
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      // Encourage caches to revalidate often in case environment changes.
      res.setHeader("Cache-Control", "public, max-age=300"); // 5 minutes
      return res.status(200).send(body + "\n");
    });

    /*
     * Cache policy for static contents
     * Loads up the site faster
     */
    app.use(
      ExpressStatic(StaticPath, {
        setHeaders(res: ExpressResponse) {
          res.setHeader("Cache-Control", "public,max-age=31536000,immutable");
        },
      }),
    );

    /*
     * Addresses earlier versions of the site published move permanently to
     * the pages that replaced them (Utils/LegacyRedirects.ts). Here, after
     * every route and the static files, so a retired address can never
     * shadow anything the site still serves.
     */
    app.use(redirectLegacyUrl);

    app.get("/*", (_req: ExpressRequest, res: ExpressResponse) => {
      return NotFoundUtil.renderNotFound(res);
    });
  },
};

export default HomeFeatureSet;
