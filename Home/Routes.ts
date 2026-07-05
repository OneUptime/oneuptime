// improt API
import "./API/BlogAPI";
import { StaticPath, ViewsPath } from "./Utils/Config";
import NotFoundUtil from "./Utils/NotFound";
import ProductCompare, { Product } from "./Utils/ProductCompare";
import {
  generateSitemapIndexXml,
  generatePagesSitemapXml,
  generateCompareSitemapXml,
  generateTagsSitemapXml,
  generateBlogSitemapXml,
  getBlogSitemapPageCount,
  getTagsSitemapPageCount,
} from "./Utils/Sitemap";
import { generateBlogRssFeed, generateTagRssFeed } from "./Utils/RssFeed";
import PageSEOConfig, { getPageSEO, PageSEOData } from "./Utils/PageSEO";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
// Removed unused imports after dynamic sitemap refactor
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
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
  RecentBlogPostLink,
} from "./Utils/AIDiscovery";
import BlogPostUtil, { BlogPostHeader } from "./Utils/BlogPost";

// import jobs.
import "./Jobs/UpdateBlog";
import { getGitHubStarsCount, formatStarCount } from "./Jobs/FetchGitHubStars";
import {
  getGitHubContributorsCount,
  getGitHubCommitsCount,
  formatCount,
} from "./Jobs/FetchGitHubStats";
import { Host, IsBillingEnabled } from "Common/Server/EnvironmentConfig";
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
        next();
      },
    );

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
        enableGoogleTagManager: IsBillingEnabled,
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
      });
    });

    app.get(
      "/infrastructure-agent/install.sh",
      (_req: ExpressRequest, res: ExpressResponse) => {
        // fetch the file from https://raw.githubusercontent.com/oneuptime/infrastructure-agent/release/Scripts/Install/Linux.sh  and send it as response
        res.redirect(
          "https://raw.githubusercontent.com/OneUptime/oneuptime/release/InfrastructureAgent/Scripts/Install/Linux.sh",
        );
      },
    );

    app.get("/install.sh", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect(
        "https://raw.githubusercontent.com/OneUptime/oneuptime/release/Home/Scripts/Install.sh",
      );
    });

    app.get("/support", async (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/support",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/support`, {
        enableGoogleTagManager: IsBillingEnabled,
        seo,
      });
    });

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
          enableGoogleTagManager: IsBillingEnabled,
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
        enableGoogleTagManager: IsBillingEnabled,
        seo,
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
          enableGoogleTagManager: IsBillingEnabled,
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

    app.get(
      "/product/status-page",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/status-page",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/status-page`, {
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
          seo,
        });
      },
    );

    app.get("/status-page", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect("/product/status-page");
    });

    app.get(
      "/logs-management",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect("/product/logs-management");
      },
    );

    let gitHubContributors: Array<JSONObject> = [];
    let gitHubBasicInfo: JSONObject | null = null;
    let gitHubCommits: string = "-";

    app.get("/about", async (_req: ExpressRequest, res: ExpressResponse) => {
      if (gitHubContributors.length === 0) {
        let contributors: Array<JSONObject> = [];

        let hasMoreContributors: boolean = true;

        let pageNumber: number = 1;

        while (hasMoreContributors) {
          const response: HTTPResponse<Array<JSONObject>> | HTTPErrorResponse =
            await API.get<Array<JSONObject>>({
              url: URL.fromString(
                "https://api.github.com/repos/oneuptime/oneuptime/contributors?page=" +
                  pageNumber,
              ),
            });
          pageNumber++;
          if ((response.data as Array<JSONObject>).length < 30) {
            hasMoreContributors = false;
          }

          contributors = contributors.concat(
            response.data as Array<JSONObject>,
          );
        }

        //cache it.
        gitHubContributors = [...contributors];
      }

      const response: HTTPResponse<JSONObject> = await API.get({
        url: URL.fromString(
          "https://api.github.com/repos/oneuptime/oneuptime/commits?sha=master&per_page=1&page=1",
        ),
      });

      if (gitHubCommits === "-") {
        // this is of type: '<https://api.github.com/repositories/380744866/commits?sha=master&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/380744866/commits?sha=master&per_page=1&page=22486>; rel="last"',
        const link: string | undefined = response.headers["link"];
        const urlString: string | undefined = link
          ?.split(",")[1]
          ?.split(";")[0]
          ?.replace("<", "")
          .replace(">", "")
          .trim();
        const url: URL = URL.fromString(urlString!);
        const commits: string = Number.parseInt(
          url.getQueryParam("page") as string,
        ).toLocaleString();

        if (!gitHubBasicInfo) {
          const basicInfo: HTTPResponse<JSONObject> = await API.get({
            url: URL.fromString(
              "https://api.github.com/repos/oneuptime/oneuptime",
            ),
          });

          gitHubBasicInfo = basicInfo.data as JSONObject;
        }

        gitHubCommits = commits;
      }

      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/about",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/about`, {
        contributors: gitHubContributors,
        basicInfo: gitHubBasicInfo,
        commits: gitHubCommits,
        enableGoogleTagManager: IsBillingEnabled,
        seo,
      });
    });

    app.get(
      "/product/status-page",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/status-page`, {
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          footerCards: true,
          cta: true,
          blackLogo: false,
          requestDemoCta: false,
          footerCtaText:
            "Start with Status Pages, expand into everything else. Sign up today.",
        });
      },
    );

    app.get("/status-page", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect("/product/status-page");
    });

    app.get("/workflows", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect("/product/workflows");
    });

    app.get("/runbooks", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect("/product/runbooks");
    });

    app.get("/on-call", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect("/product/on-call");
    });

    app.get(
      "/product/monitoring",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/monitoring",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/monitoring`, {
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
        enableGoogleTagManager: IsBillingEnabled,
        seo,
      });
    });

    app.get("/product/podman", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/podman",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/podman`, {
        enableGoogleTagManager: IsBillingEnabled,
        seo,
      });
    });

    app.get("/product/host", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/host",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/host`, {
        enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/ai-observability",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/ai-observability",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/ai-observability`, {
          enableGoogleTagManager: IsBillingEnabled,
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
        enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
        enableGoogleTagManager: IsBillingEnabled,
        seo,
      });
    });

    app.get(
      "/product/services",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/services",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/services`, {
          enableGoogleTagManager: IsBillingEnabled,
          seo,
        });
      },
    );

    app.get(
      "/product/profiles",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/product/profiles",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/profiles`, {
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
          seo,
        });
      },
    );

    app.get(
      "/scheduled-maintenance",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect("/product/scheduled-maintenance");
      },
    );

    app.get("/product/traces", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/traces",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/traces`, {
        enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
        enableGoogleTagManager: IsBillingEnabled,
        seo,
      });
    });

    app.get("/product/rum", (_req: ExpressRequest, res: ExpressResponse) => {
      const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
        "/product/rum",
        res.locals["homeUrl"] as string,
      );
      res.render(`${ViewsPath}/rum`, {
        enableGoogleTagManager: IsBillingEnabled,
        seo,
      });
    });

    app.get(
      "/incident-management",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect("/product/incident-management");
      },
    );

    app.get("/ai-agent", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect("/product/ai-agent");
    });

    app.get(
      "/tool/mcp-server",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/tool/mcp-server",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/mcp-server`, {
          enableGoogleTagManager: IsBillingEnabled,
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
        enableGoogleTagManager: IsBillingEnabled,
        seo,
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
          enableGoogleTagManager: IsBillingEnabled,
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

    // Solutions pages
    app.get(
      "/solutions/devops",
      (_req: ExpressRequest, res: ExpressResponse) => {
        const seo: PageSEOData & { fullCanonicalUrl: string } = getSEOForPath(
          "/solutions/devops",
          res.locals["homeUrl"] as string,
        );
        res.render(`${ViewsPath}/solutions/devops`, {
          enableGoogleTagManager: IsBillingEnabled,
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
        enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
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
          enableGoogleTagManager: IsBillingEnabled,
          seo,
        });
      },
    );

    app.get("/legal", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "terms",
        requestDemoCta: false,
      });
    });

    app.get("/legal/terms", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "terms",
        requestDemoCta: false,
      });
    });

    app.get("/legal/privacy", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "privacy",
        requestDemoCta: false,
      });
    });

    app.get(
      "/legal/code-of-conduct",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          footerCards: true,
          cta: true,
          blackLogo: false,
          section: "code-of-conduct",
          requestDemoCta: false,
        });
      },
    );

    app.get("/legal/contact", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "contact",
        requestDemoCta: false,
      });
    });

    app.get(
      "/legal/subprocessors",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          footerCards: true,
          cta: true,
          blackLogo: false,
          section: "subprocessors",
          requestDemoCta: false,
        });
      },
    );

    app.get("/legal/dpa", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "dpa",
        requestDemoCta: false,
      });
    });

    app.get("/legal/ccpa", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "ccpa",
        requestDemoCta: false,
      });
    });

    app.get("/legal/cookies", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "cookies",
        requestDemoCta: false,
      });
    });

    app.get("/legal/hipaa", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "hipaa",
        requestDemoCta: false,
      });
    });

    app.get("/legal/dmca", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "dmca",
        requestDemoCta: false,
      });
    });

    app.get("/legal/pci", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: "pci",
        requestDemoCta: false,
      });
    });

    app.get(
      "/legal/iso-27001",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          footerCards: true,
          cta: true,
          blackLogo: false,
          section: "iso-27001",
          requestDemoCta: false,
        });
      },
    );

    app.get(
      "/legal/iso-27017",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          cta: true,
          blackLogo: false,
          section: "iso-27017",
          requestDemoCta: false,
        });
      },
    );

    app.get(
      "/legal/iso-27018",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          cta: true,
          blackLogo: false,
          section: "iso-27018",
          requestDemoCta: false,
        });
      },
    );

    app.get(
      "/legal/iso-27017",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          cta: true,
          blackLogo: false,
          section: "iso-27017",
          requestDemoCta: false,
        });
      },
    );

    app.get(
      "/legal/iso-27018",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          cta: true,
          blackLogo: false,
          section: "iso-27018",
          requestDemoCta: false,
        });
      },
    );

    app.get("/legal/soc-2", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "soc-2",
        requestDemoCta: false,
      });
    });

    app.get("/legal/soc-3", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "soc-3",
        requestDemoCta: false,
      });
    });

    app.get("/legal/vpat", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "vpat",
        requestDemoCta: false,
      });
    });

    app.get(
      "/legal/data-residency",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          cta: true,
          blackLogo: false,
          section: "data-residency",
          requestDemoCta: false,
        });
      },
    );

    app.get("/legal/gdpr", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "gdpr",
        requestDemoCta: false,
      });
    });

    app.get(
      "/legal/21-cfr-part-11",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          cta: true,
          blackLogo: false,
          section: "21-cfr-part-11",
          requestDemoCta: false,
        });
      },
    );

    app.get("/legal/gamp-5", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "gamp-5",
        requestDemoCta: false,
      });
    });

    app.get("/legal/annex-11", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "annex-11",
        requestDemoCta: false,
      });
    });

    app.get("/legal/iso-9001", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "iso-9001",
        requestDemoCta: false,
      });
    });

    app.get(
      "/legal/gxp-cloud",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          cta: true,
          blackLogo: false,
          section: "gxp-cloud",
          requestDemoCta: false,
        });
      },
    );

    app.get("/legal/csa-star", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "csa-star",
        requestDemoCta: false,
      });
    });

    app.get("/legal/fedramp", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "fedramp",
        requestDemoCta: false,
      });
    });

    app.get("/legal/sla", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "sla",
        requestDemoCta: false,
      });
    });

    app.get("/legal/security", (_req: ExpressRequest, res: ExpressResponse) => {
      res.render(`${ViewsPath}/legal.ejs`, {
        footerCards: true,
        support: false,
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        section: "security",
        requestDemoCta: false,
      });
    });

    app.get(
      "/legal/deprecation-policy",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.render(`${ViewsPath}/legal.ejs`, {
          footerCards: true,
          support: false,
          enableGoogleTagManager: IsBillingEnabled,
          cta: true,
          blackLogo: false,
          section: "deprecation-policy",
          requestDemoCta: false,
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
        enableGoogleTagManager: IsBillingEnabled,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
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
          enableGoogleTagManager: IsBillingEnabled,
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

    // Blog tags sitemap (paginated)
    app.get(
      "/sitemap-tags-:page.xml",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const page: number = parseInt(req.params["page"] as string, 10);

          if (isNaN(page) || page < 1) {
            return res.status(404).send("Invalid sitemap page");
          }

          // Check if page exists
          const totalPages: number = await getTagsSitemapPageCount();
          if (page > totalPages) {
            return res.status(404).send("Sitemap page not found");
          }

          const xml: string = await generateTagsSitemapXml(page);
          res.setHeader("Content-Type", "text/xml");
          res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
          return res.send(xml);
        } catch {
          return res.status(500).send("Error generating sitemap");
        }
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

    // Blog RSS feed for a specific tag
    app.get(
      "/blog/tag/:tagName/rss.xml",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const tagName: string = req.params["tagName"] as string;

          if (!tagName) {
            return res.status(404).send("Tag not found");
          }

          const xml: string = await generateTagRssFeed(tagName);
          res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
          return res.send(xml);
        } catch {
          return res.status(500).send("Error generating RSS feed");
        }
      },
    );

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
        res.json(generateMcpManifest(res.locals["homeUrl"] as string));
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
     * Generated from the same structured data as the HTML pages.
     */
    app.get(/^\/.+\.md$/, (req: ExpressRequest, res: ExpressResponse) => {
      const homeUrl: string = res.locals["homeUrl"] as string;
      const pagePath: string = req.path.replace(/\.md$/, "");

      let markdown: string | null = null;

      if (pagePath === "/pricing") {
        markdown = generatePricingMarkdown(homeUrl);
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

    app.get("/*", (_req: ExpressRequest, res: ExpressResponse) => {
      return NotFoundUtil.renderNotFound(res);
    });
  },
};

export default HomeFeatureSet;
