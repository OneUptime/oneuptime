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
import { getPageSEO, PageSEOData } from "./Utils/PageSEO";
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
import Reviews from "./Utils/Reviews";

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
      const pricing: Array<JSONObject> = [
        {
          name: "Status Page",
          data: [
            {
              name: "Public Status Page",
              plans: {
                free: "1",
                growth: "Unlimited",
                scale: "Unlimited",
                enterprise: "Unlimited",
              },
            },
            {
              name: "Subscribers",
              plans: {
                free: "100",
                growth: "Unlimited",
                scale: "Unlimited",
                enterprise: "Unlimited",
              },
            },
            {
              name: "Custom Branding",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "SSL Certificate",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Custom Domain",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Private Status Page",
              plans: {
                free: false,
                growth: "Unlimited",
                scale: "Unlimited",
                enterprise: "Unlimited",
              },
            },
            {
              name: "Private Status Page Users",
              plans: {
                free: false,
                growth: "Unlimited",
                scale: "Unlimited",
                enterprise: "Unlimited",
              },
            },
          ],
        },
        {
          name: "Incident Management",
          data: [
            {
              name: "Basic Incident Management",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Public Postmortem Notes",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Private Postmortem Notes",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Incident Workflows",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Custom Incident State",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Custom Incident Severity",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
          ],
        },
        {
          name: "Monitoring",
          data: [
            {
              name: "Static / Manual Monitors",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Website Monitoring",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "API Monitoring",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Synthetic Monitoring (with Playwright)",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },

            {
              name: "IPv4 Monitoring",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },

            {
              name: "IPv6 Monitoring",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Inbound Webhook / Heartbeat Monitoring",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "VM or Server Monitoring",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Network Monitoring",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Container Monitoring",
              plans: {
                free: "Coming Soon",
                growth: "Coming Soon",
                scale: "Coming Soon",
                enterprise: "Coming Soon",
              },
            },
            {
              name: "Kubernetes Cluster Monitoring",
              plans: {
                free: "Coming Soon",
                growth: "Coming Soon",
                scale: "Coming Soon",
                enterprise: "Coming Soon",
              },
            },
          ],
        },
        {
          name: "On-Call and Alerts",
          data: [
            {
              name: "SMS Alerts",
              plans: {
                free: "$0.10/SMS",
                growth: "$0.10/SMS",
                scale: "$0.10/SMS",
                enterprise: "$0.10/SMS",
              },
            },
            {
              name: "Phone Call Alerts",
              plans: {
                free: "$0.10/min",
                growth: "$0.10/min",
                scale: "$0.10/min",
                enterprise: "$0.10/min",
              },
            },
            {
              name: "Bring Your Own Twilio",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Email Alerts",
              plans: {
                free: "Free",
                growth: "Free",
                scale: "Free",
                enterprise: "Free",
              },
            },
            {
              name: "On-Call Escalation",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "On-Call Rotation",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Advanced Workflows",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Logs and Events",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Webhook Alerts",
              plans: {
                free: "Coming Soon",
                growth: "Coming Soon",
                scale: "Coming Soon",
                enterprise: "Coming Soon",
              },
            },
            {
              name: "Vacation and OOO Policy",
              plans: {
                free: "Coming Soon",
                growth: "Coming Soon",
                scale: "Coming Soon",
                enterprise: "Coming Soon",
              },
            },
            {
              name: "On-Call Pay",
              plans: {
                free: "Coming Soon",
                growth: "Coming Soon",
                scale: "Coming Soon",
                enterprise: "Coming Soon",
              },
            },
            {
              name: "Reports",
              plans: {
                free: "Coming Soon",
                growth: "Coming Soon",
                scale: "Coming Soon",
                enterprise: "Coming Soon",
              },
            },
          ],
        },
        {
          name: "Logs Management",
          data: [
            {
              name: "Ingest with OpenTelemetry",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Ingest with Fluentd",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Ingest +1000 Sources",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Application Logs",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Container Logs",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Data Rentention",
              plans: {
                free: "15 days",
                growth: "Custom",
                scale: "Custom",
                enterprise: "Custom",
              },
            },
            {
              name: "Workflows",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Advanced Team Permissions",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
          ],
        },
        {
          name: "Telemetry / APM",
          data: [
            {
              name: "Metrics",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Traces",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Error Tracking",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Ingest Pricing",
              plans: {
                free: "$0.10/GB",
                growth: "$0.10/GB",
                scale: "$0.10/GB",
                enterprise: "$0.10/GB",
              },
            },
            {
              name: "Data Rentention",
              plans: {
                free: "15 days",
                growth: "Custom",
                scale: "Custom",
                enterprise: "Custom",
              },
            },
            {
              name: "Workflows",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Advanced Team Permissions",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
          ],
        },
        {
          name: "Error Tracking",
          data: [
            {
              name: "Track Errors and Exceptions",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Cross Microservice Issues",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Distributed Tracing",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Stack Traces",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Version Management",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Data Rentention",
              plans: {
                free: "15 days",
                growth: "Custom",
                scale: "Custom",
                enterprise: "Custom",
              },
            },
            {
              name: "Workflows",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Advanced Team Permissions",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
          ],
        },
        {
          name: "AI Agent",
          data: [
            {
              name: "LLM Token Pricing",
              plans: {
                free: "$0.02/1K tokens",
                growth: "$0.02/1K tokens",
                scale: "$0.02/1K tokens",
                enterprise: "$0.02/1K tokens",
              },
            },
            {
              name: "Bring Your Own LLM",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Incident Analysis & Insights",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Root Cause Suggestions",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Automated Runbook Generation",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Log Analysis & Anomaly Detection",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Fix Errors Automatically",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Integrate with GitHub, GitLab",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Integrate with Slack / Teams",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
          ],
        },
        {
          name: "Support and More",
          data: [
            {
              name: "Support",
              plans: {
                free: "Email Support",
                growth: "Email Support",
                scale: "Email and Chat Support",
                enterprise: "Email, Chat, Phone Support",
              },
            },
            {
              name: "Support SLA",
              plans: {
                free: "5 business day",
                growth: "1 business day",
                scale: "6 hours",
                enterprise: "1 hour priority",
              },
            },
            {
              name: "Service SLA",
              plans: {
                free: "99.00%",
                growth: "99.90%",
                scale: "99.95%",
                enterprise: "99.99%",
              },
            },
          ],
        },
        {
          name: "Advanced Features",
          data: [
            {
              name: "API Access",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
            {
              name: "Advanced Workflows",
              plans: {
                free: false,
                growth: "500 Runs / month",
                scale: "2000 Runs  /month",
                enterprise: "Unlimited Runs",
              },
            },
            {
              name: "5000+ Integrations",
              plans: {
                free: false,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
          ],
        },
        {
          name: "Billing",
          data: [
            {
              name: "Billing Period",
              plans: {
                free: "Free",
                growth: "Monthly or Yearly",
                scale: "Monthly or Yearly",
                enterprise: "Custom",
              },
            },
            {
              name: "Payment Method",
              plans: {
                free: false,
                growth: "Visa / Mastercard / Amex / Bitcoin",
                scale: "Visa / Mastercard / Amex / Bitcoin",
                enterprise:
                  "Visa / Mastercard / Amex / ACH / Invoices / Bitcoin",
              },
            },
            {
              name: "Cancel Anytime",
              plans: {
                free: true,
                growth: true,
                scale: true,
                enterprise: true,
              },
            },
          ],
        },
      ];

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
          "User-agent: *",
          "Allow: /",
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

    app.get("/*", (_req: ExpressRequest, res: ExpressResponse) => {
      return NotFoundUtil.renderNotFound(res);
    });
  },
};

export default HomeFeatureSet;
