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
  RecentBlogPostLink,
} from "../Utils/AIDiscovery";
import { getResellersPageContent } from "../Utils/Resellers";
import {
  CloudMarketplaceEntries,
  CloudMarketplaceEntry,
  getCloudMarketplacesContent,
} from "../Utils/CloudMarketplaces";
import PageSEOConfig from "../Utils/PageSEO";
import { getProductCompareSlugs } from "../Utils/ProductCompare";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import { JSONObject } from "Common/Types/JSON";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";

const homeUrl: string = "https://oneuptime.com";

describe("AIDiscovery", () => {
  test("llms.txt lists products, pricing and machine-readable resources", () => {
    const posts: Array<RecentBlogPostLink> = [
      {
        title: "Some Post",
        description: "Some description",
        fileName: "2026-01-01-some-post",
      },
    ];
    const txt: string = generateLlmsTxt(homeUrl, posts);

    expect(txt).toContain("# OneUptime");
    expect(txt).toContain("https://oneuptime.com/product/monitoring.md");
    expect(txt).toContain("https://oneuptime.com/pricing.md");
    expect(txt).toContain("https://oneuptime.com/.well-known/mcp.json");
    expect(txt).toContain("https://oneuptime.com/docs/llms.txt");
    expect(txt).toContain("https://oneuptime.com/llms-full.txt");
    expect(txt).toContain("https://oneuptime.com/api/openapi/spec");
    expect(txt).toContain("/blog/post/2026-01-01-some-post/markdown");
  });

  test("llms.txt omits the blog section when no posts are available", () => {
    const txt: string = generateLlmsTxt(homeUrl, []);
    expect(txt).not.toContain("## Recent Blog Posts");
  });

  test("llms.txt normalizes a trailing slash on the home url", () => {
    const txt: string = generateLlmsTxt("https://oneuptime.com/", []);
    expect(txt).toContain("https://oneuptime.com/pricing.md");
    expect(txt).not.toContain("https://oneuptime.com//");
  });

  test("llms-full.txt includes product features, pricing and comparisons", () => {
    const txt: string = generateLlmsFullTxt(homeUrl, []);
    expect(txt).toContain("### OneUptime Monitoring");
    expect(txt).toContain(
      "| Plan | Price (monthly billing) | Price (yearly billing) |",
    );
    expect(txt).toContain("### OneUptime vs PagerDuty");
  });

  test("pricing markdown contains plans and the feature matrix", () => {
    const md: string = generatePricingMarkdown(homeUrl);
    expect(md).toContain("| Growth | $22 | $20 |");
    expect(md).toContain("### Status Page");
    expect(md).toContain("| Feature | Free | Growth | Scale | Enterprise |");
  });

  test("page markdown is generated from PageSEO data", () => {
    const md: string = generatePageMarkdown(
      PageSEOConfig["/product/monitoring"]!,
      homeUrl,
    );
    expect(md).toContain("# OneUptime Monitoring");
    expect(md).toContain("## Features");
    expect(md).toContain(
      "Canonical page: https://oneuptime.com/product/monitoring",
    );
  });

  test("compare markdown renders tables and returns null for unknown slugs", () => {
    const md: string | null = generateCompareMarkdown("pagerduty", homeUrl);
    expect(md).not.toBeNull();
    expect(md).toContain("# OneUptime vs PagerDuty");
    expect(md).toContain("## Feature Comparison");

    expect(generateCompareMarkdown("not-a-real-product", homeUrl)).toBeNull();
  });

  test("mcp manifest points at the /mcp endpoint", () => {
    const manifest: JSONObject = generateMcpManifest(homeUrl);
    expect(manifest["endpoint"]).toBe("https://oneuptime.com/mcp");
    expect(manifest["documentation"]).toBe(
      "https://oneuptime.com/docs/ai/mcp-server",
    );
  });

  /*
   * How the manifest says an MCP client authenticates. The MCP server now
   * lets a client sign its user in with OAuth, and still takes an API key;
   * an instance can switch sign-in off (DISABLE_MCP_OAUTH), and the manifest
   * then has to go back to describing API keys only - a manifest that
   * advertises a sign-in the server will not offer sends a reader looking
   * for discovery documents that are not there.
   */
  describe("mcp manifest authentication", () => {
    const API_KEY_HEADERS: Array<string> = [
      "x-api-key",
      "Authorization: Bearer <api-key>",
    ];

    type AuthenticationOfFunction = (manifest: JSONObject) => JSONObject;

    const authenticationOf: AuthenticationOfFunction = (
      manifest: JSONObject,
    ): JSONObject => {
      return manifest["authentication"] as JSONObject;
    };

    test("by default it describes signing in with OAuth, with API keys as the alternative", () => {
      const authentication: JSONObject = authenticationOf(
        generateMcpManifest(homeUrl),
      );

      expect(authentication["type"]).toBe("oauth2");
      expect(authentication["methods"]).toEqual(["oauth2", "apiKey"]);
      expect(authentication["oauth2"]).toEqual({
        protectedResourceMetadata:
          "https://oneuptime.com/mcp/.well-known/oauth-protected-resource",
        authorizationServerMetadata:
          "https://oneuptime.com/.well-known/oauth-authorization-server/mcp",
        scopes: ["mcp:read", "mcp:write"],
      });

      // An API key still works, so how to send one is still listed.
      expect(authentication["headers"]).toEqual(API_KEY_HEADERS);
    });

    test("the default instructions say to sign in, and still say how to use an API key", () => {
      const instructions: string = String(
        authenticationOf(generateMcpManifest(homeUrl))["instructions"],
      );

      expect(instructions).toContain("sign in to OneUptime");
      expect(instructions).toContain("with no credentials");
      expect(instructions).toContain("API key");
      expect(instructions).toContain(
        "Public status page tools and help tools work without authentication",
      );
      expect(instructions).toContain(
        "https://oneuptime.com/docs/ai/mcp-server",
      );
    });

    test.each([
      { name: "no options at all", options: undefined },
      { name: "an empty options object", options: {} },
      {
        name: "isOAuthEnabled: undefined",
        options: { isOAuthEnabled: undefined },
      },
      { name: "isOAuthEnabled: true", options: { isOAuthEnabled: true } },
    ])(
      "$name means OAuth is on: only an explicit false switches it off",
      (data: {
        options: { isOAuthEnabled?: boolean | undefined } | undefined;
      }) => {
        expect(generateMcpManifest(homeUrl, data.options)).toEqual(
          generateMcpManifest(homeUrl),
        );
        expect(
          authenticationOf(generateMcpManifest(homeUrl, data.options))["type"],
        ).toBe("oauth2");
      },
    );

    test("with OAuth switched off it describes API keys only, as it did before sign-in existed", () => {
      const manifest: JSONObject = generateMcpManifest(homeUrl, {
        isOAuthEnabled: false,
      });
      const authentication: JSONObject = authenticationOf(manifest);

      expect(authentication["type"]).toBe("apiKey");
      expect(authentication["methods"]).toEqual(["apiKey"]);
      expect(authentication["headers"]).toEqual(API_KEY_HEADERS);

      // No OAuth block at all - not an empty one, and not a null.
      expect(Object.keys(authentication)).not.toContain("oauth2");
      expect(Object.keys(authentication).sort()).toEqual([
        "headers",
        "instructions",
        "methods",
        "type",
      ]);

      const instructions: string = String(authentication["instructions"]);

      expect(instructions).toBe(
        "Create an API key in your OneUptime project settings. Public status page tools and help tools work without authentication. See https://oneuptime.com/docs/ai/mcp-server",
      );
      expect(instructions.toLowerCase()).not.toContain("sign in");
      expect(instructions.toLowerCase()).not.toContain("oauth");

      // Nothing anywhere in the document hints at a sign-in.
      expect(JSON.stringify(manifest).toLowerCase()).not.toContain("oauth");
      expect(JSON.stringify(manifest).toLowerCase()).not.toContain("sign in");
    });

    test("switching OAuth off changes the authentication block and nothing else", () => {
      const withOAuth: JSONObject = generateMcpManifest(homeUrl);
      const withoutOAuth: JSONObject = generateMcpManifest(homeUrl, {
        isOAuthEnabled: false,
      });

      expect(Object.keys(withoutOAuth)).toEqual(Object.keys(withOAuth));

      for (const key of Object.keys(withOAuth)) {
        if (key === "authentication") {
          expect(withoutOAuth[key]).not.toEqual(withOAuth[key]);
          continue;
        }

        expect(withoutOAuth[key]).toEqual(withOAuth[key]);
      }

      // The endpoint and the documentation are the same either way.
      expect(withoutOAuth["endpoint"]).toBe("https://oneuptime.com/mcp");
      expect(withoutOAuth["documentation"]).toBe(
        "https://oneuptime.com/docs/ai/mcp-server",
      );
    });

    test("the OAuth URLs follow the home URL, and a trailing slash on it is normalised", () => {
      for (const url of [
        "https://oneuptime.example.com",
        "https://oneuptime.example.com/",
      ]) {
        const manifest: JSONObject = generateMcpManifest(url);

        expect(manifest["endpoint"]).toBe("https://oneuptime.example.com/mcp");
        expect(authenticationOf(manifest)["oauth2"]).toEqual({
          protectedResourceMetadata:
            "https://oneuptime.example.com/mcp/.well-known/oauth-protected-resource",
          authorizationServerMetadata:
            "https://oneuptime.example.com/.well-known/oauth-authorization-server/mcp",
          scopes: ["mcp:read", "mcp:write"],
        });
        expect(JSON.stringify(manifest)).not.toContain("example.com//");
      }
    });

    test("an empty home URL falls back to oneuptime.com for the OAuth URLs too", () => {
      const oauth2: JSONObject = authenticationOf(generateMcpManifest(""))[
        "oauth2"
      ] as JSONObject;

      expect(oauth2["protectedResourceMetadata"]).toBe(
        "https://oneuptime.com/mcp/.well-known/oauth-protected-resource",
      );
      expect(oauth2["authorizationServerMetadata"]).toBe(
        "https://oneuptime.com/.well-known/oauth-authorization-server/mcp",
      );
    });

    test("the discovery URLs are where the MCP server itself says its documents are", () => {
      /*
       * The manifest is written in the Home service and the documents are
       * served by the App, so nothing but this ties the two together. The
       * protected resource metadata URL is the one the server's own 401
       * challenge names; the authorization server metadata URL is the
       * issuer's, built the way RFC 8414 section 3.1 says to build it (the
       * well-known segment goes BEFORE the issuer's path).
       */
      const oauth2: JSONObject = authenticationOf(generateMcpManifest(homeUrl))[
        "oauth2"
      ] as JSONObject;

      expect(
        new URL(String(oauth2["protectedResourceMetadata"])).pathname,
      ).toBe(
        new URL(McpOAuthConfig.getProtectedResourceMetadataUrl()).pathname,
      );

      const issuer: URL = new URL(McpOAuthConfig.getIssuer());

      expect(
        new URL(String(oauth2["authorizationServerMetadata"])).pathname,
      ).toBe(`/.well-known/oauth-authorization-server${issuer.pathname}`);

      // The manifest's endpoint is the resource those documents describe.
      expect(
        new URL(String(generateMcpManifest(homeUrl)["endpoint"])).pathname,
      ).toBe(new URL(McpOAuthConfig.getResource()).pathname);
    });

    test("the scopes are the two access scopes a token can carry, and not offline_access", () => {
      const scopes: Array<string> = (
        authenticationOf(generateMcpManifest(homeUrl))["oauth2"] as JSONObject
      )["scopes"] as Array<string>;

      expect(scopes).toEqual([McpOAuthScope.Read, McpOAuthScope.Write]);
      expect(scopes).not.toContain(McpOAuthScope.OfflineAccess);
    });

    test("the manifest survives being sent as JSON unchanged, in both modes", () => {
      for (const options of [
        { isOAuthEnabled: true },
        { isOAuthEnabled: false },
      ]) {
        const manifest: JSONObject = generateMcpManifest(homeUrl, options);

        expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
      }
    });

    test("what the hosted site's E2E check reads is unaffected by either mode", () => {
      // packages/E2E/Tests/Home/AIDiscovery.spec.ts pins exactly these.
      for (const options of [
        { isOAuthEnabled: true },
        { isOAuthEnabled: false },
      ]) {
        const manifest: JSONObject = generateMcpManifest(homeUrl, options);

        expect(manifest["name"]).toBe("OneUptime MCP Server");
        expect(String(manifest["endpoint"])).toMatch(/^https?:\/\/.+\/mcp$/);
        expect(manifest["transport"]).toContain("streamable-http");
        expect((manifest["capabilities"] as JSONObject)["tools"]).toBe(true);
      }
    });
  });

  test("products json lists every product page with markdown urls", () => {
    const products: Array<JSONObject> = generateProductsJson(homeUrl)[
      "products"
    ] as Array<JSONObject>;
    expect(products.length).toBeGreaterThan(20);
    for (const product of products) {
      expect(product["markdownUrl"]).toMatch(
        /^https:\/\/oneuptime\.com\/.+\.md$/,
      );
    }
  });

  test("the Databases product page is listed for machines", () => {
    const products: Array<JSONObject> = generateProductsJson(homeUrl)[
      "products"
    ] as Array<JSONObject>;
    const databases: JSONObject | undefined = products.find(
      (product: JSONObject): boolean => {
        return product["url"] === "https://oneuptime.com/product/databases";
      },
    );

    expect(databases).toBeDefined();
    expect(databases!["markdownUrl"]).toBe(
      "https://oneuptime.com/product/databases.md",
    );
    expect((databases!["features"] as Array<string>).length).toBeGreaterThan(0);
    expect(generateLlmsTxt(homeUrl, [])).toContain(
      "https://oneuptime.com/product/databases.md",
    );
    expect(
      generatePageMarkdown(PageSEOConfig["/product/databases"]!, homeUrl),
    ).toContain("Canonical page: https://oneuptime.com/product/databases");
  });

  test("the Queues product page is listed for machines", () => {
    const products: Array<JSONObject> = generateProductsJson(homeUrl)[
      "products"
    ] as Array<JSONObject>;
    const queues: JSONObject | undefined = products.find(
      (product: JSONObject): boolean => {
        return product["url"] === "https://oneuptime.com/product/queues";
      },
    );

    expect(queues).toBeDefined();
    expect(queues!["markdownUrl"]).toBe(
      "https://oneuptime.com/product/queues.md",
    );
    expect((queues!["features"] as Array<string>).length).toBeGreaterThan(0);
    expect(generateLlmsTxt(homeUrl, [])).toContain(
      "https://oneuptime.com/product/queues.md",
    );
    expect(
      generatePageMarkdown(PageSEOConfig["/product/queues"]!, homeUrl),
    ).toContain("Canonical page: https://oneuptime.com/product/queues");
  });

  test("llms.txt lists the enterprise pages and the claims matrix", () => {
    const txt: string = generateLlmsTxt(homeUrl, []);

    expect(txt).toContain("## Enterprise");
    expect(txt).toContain("https://oneuptime.com/enterprise/self-hosted.md");
    expect(txt).toContain("https://oneuptime.com/trust");
    expect(txt).toContain("https://oneuptime.com/data/claims.json");
  });

  test("the self-hosted page has a markdown variant with its deployment detail", () => {
    const md: string = generatePageMarkdown(
      PageSEOConfig["/enterprise/self-hosted"]!,
      homeUrl,
    );

    expect(md).toContain("# OneUptime Self-Hosted");
    expect(md).toContain("## Features");
    expect(md.toLowerCase()).toContain("helm");
    expect(md.toLowerCase()).toContain("air-gapped");
    expect(md).toContain(
      "Canonical page: https://oneuptime.com/enterprise/self-hosted",
    );
  });

  test("compare index json lists every comparison slug", () => {
    const comparisons: Array<JSONObject> = generateCompareIndexJson(homeUrl)[
      "comparisons"
    ] as Array<JSONObject>;
    expect(comparisons.length).toBe(getProductCompareSlugs().length);
  });
});

describe("the MCP manifest's scope list belongs to that manifest", () => {
  test("changing one manifest does not change the next", () => {
    const first: JSONObject = generateMcpManifest("https://oneuptime.com");
    const scopes: Array<string> = (
      (first["authentication"] as JSONObject)["oauth2"] as JSONObject
    )["scopes"] as Array<string>;

    scopes.push("admin");
    scopes.shift();

    const second: JSONObject = generateMcpManifest("https://oneuptime.com");

    expect(
      ((second["authentication"] as JSONObject)["oauth2"] as JSONObject)[
        "scopes"
      ],
    ).toEqual(["mcp:read", "mcp:write"]);
  });
});

describe("the resellers, for machines", () => {
  test("llms.txt lists the Resellers page with the other ways to buy", () => {
    const txt: string = generateLlmsTxt(homeUrl, []);
    const enterprise: string = txt.slice(
      txt.indexOf("## Enterprise"),
      txt.indexOf("## Compare OneUptime"),
    );

    expect(enterprise).toContain(
      `- [Resellers](https://oneuptime.com/resellers.md): ${PageSEOConfig["/resellers"]!.description}`,
    );
  });

  test("/resellers.md lists each reseller by region, with its website", () => {
    const md: string = generateResellersMarkdown(
      homeUrl,
      getResellersPageContent({ inquiryInbox: "partners@example.com" }),
    );

    expect(md.startsWith("# Resellers\n")).toBe(true);
    expect(md).toContain(`> ${PageSEOConfig["/resellers"]!.description}`);
    expect(md).toContain("Canonical page: https://oneuptime.com/resellers");
    expect(md).toContain("## Resellers by region");
    expect(md).toContain("### Asia Pacific");
    expect(md).toContain(
      "- [SLEXN](https://www.slexn.com) (슬렉슨), Seoul, South Korea: Software solutions and consulting.",
    );
  });

  test("/resellers.md says how to become one, and where to write", () => {
    const md: string = generateResellersMarkdown(
      homeUrl,
      getResellersPageContent({ inquiryInbox: "partners@example.com" }),
    );

    expect(md).toContain("## Become a reseller");
    expect(md).toContain(
      "Companies that want to sell OneUptime can send the form at https://oneuptime.com/resellers#become-a-reseller, or email partners@example.com.",
    );
  });

  test("/resellers.md says so when no reseller is listed", () => {
    const md: string = generateResellersMarkdown(
      homeUrl,
      getResellersPageContent({
        resellers: [],
        inquiryInbox: "partners@example.com",
      }),
    );

    expect(md).toContain("No resellers are listed yet.");
    expect(md).not.toContain("###");
  });

  test("/resellers.md normalizes a trailing slash on the home url", () => {
    const md: string = generateResellersMarkdown(
      "https://oneuptime.com/",
      getResellersPageContent({ inquiryInbox: "partners@example.com" }),
    );

    expect(md).toContain("Canonical page: https://oneuptime.com/resellers");
    expect(md).not.toContain("https://oneuptime.com//");
  });
});

describe("the cloud marketplaces, for machines", () => {
  const noListing: Array<CloudMarketplaceEntry> = CloudMarketplaceEntries.map(
    (entry: CloudMarketplaceEntry): CloudMarketplaceEntry => {
      return { ...entry, listingUrls: { cloud: null, enterprise: null } };
    },
  );

  function resellersMarkdown(
    cloudMarketplaces?: Array<CloudMarketplaceEntry>,
  ): string {
    return generateResellersMarkdown(
      homeUrl,
      getResellersPageContent({
        inquiryInbox: "partners@example.com",
        cloudMarketplaces: cloudMarketplaces,
      }),
    );
  }

  // The lines of a markdown section, from its heading to the next one.
  function sectionOf(markdown: string, heading: string): Array<string> {
    const lines: Array<string> = markdown.split("\n");
    const start: number = lines.indexOf(heading);

    expect(start).toBeGreaterThan(-1);

    const rest: Array<string> = lines.slice(start + 1);
    const end: number = rest.findIndex((line: string): boolean => {
      return line.startsWith("## ");
    });

    return end === -1 ? rest : rest.slice(0, end);
  }

  test("/resellers.md lists them after the resellers and before how to become one", () => {
    const md: string = resellersMarkdown();
    const headings: Array<string> = md
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("## ");
      });

    expect(headings).toEqual([
      "## Resellers by region",
      "## Buy through your cloud marketplace",
      "## Become a reseller",
      "## Learn More",
    ]);
  });

  test("/resellers.md says what each product is and lists each listing as the page shows it", () => {
    expect(
      sectionOf(resellersMarkdown(), "## Buy through your cloud marketplace"),
    ).toEqual([
      "",
      "Buy OneUptime with the cloud account you already have, and pay for it on your cloud bill. OneUptime Cloud is run by OneUptime, at the prices on https://oneuptime.com/pricing. OneUptime Enterprise runs in your own Kubernetes cluster, for $0.10 per user per hour, with no license key to activate: https://oneuptime.com/docs/installation/cloud-marketplaces",
      "",
      "- AWS Marketplace",
      "  - [OneUptime Cloud](https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw): Hosted by OneUptime",
      "  - OneUptime Enterprise: Self-hosted on Amazon EKS, coming soon",
      "- Microsoft Marketplace",
      "  - [OneUptime Cloud](https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-cloud): Hosted by OneUptime",
      "  - [OneUptime Enterprise](https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-enterprise): Self-hosted on Azure Kubernetes Service",
      "- Google Cloud Marketplace: coming soon",
      "",
      "For annual pricing or a volume discount, ask for a private offer, which you accept on your marketplace: https://oneuptime.com/enterprise/demo",
      "",
    ]);
  });

  test("/resellers.md links every public listing the list has, and no other", () => {
    const md: string = resellersMarkdown();

    for (const entry of CloudMarketplaceEntries) {
      for (const url of Object.values(entry.listingUrls)) {
        if (url) {
          expect(md).toContain(`](${url})`);
        }
      }
    }

    expect(md.split("](https://aws.amazon.com/").length - 1).toBe(1);
    expect(md.split("](https://marketplace.microsoft.com/").length - 1).toBe(2);
    expect(md).not.toContain("](https://console.cloud.google.com/");
  });

  test("/resellers.md leaves the marketplaces out while no listing is public", () => {
    const md: string = resellersMarkdown(noListing);

    expect(md).not.toContain("## Buy through your cloud marketplace");
    expect(md).not.toContain("coming soon");
    expect(md).not.toContain("Marketplace");
    expect(md).not.toContain("private offer");
    expect(md).toContain("## Become a reseller");
  });

  test("/resellers.md normalizes a trailing slash in the marketplaces' links too", () => {
    const md: string = generateResellersMarkdown(
      "https://oneuptime.com/",
      getResellersPageContent({ inquiryInbox: "partners@example.com" }),
    );

    expect(md).toContain(
      "with no license key to activate: https://oneuptime.com/docs/installation/cloud-marketplaces",
    );
    expect(md).not.toContain("https://oneuptime.com//");
  });

  test("/resellers.md keeps third-level headings for the regions alone", () => {
    const md: string = resellersMarkdown();

    expect(
      md.split("\n").filter((line: string): boolean => {
        return line.startsWith("### ");
      }),
    ).toEqual(["### Asia Pacific"]);
  });

  test("pricing markdown names OneUptime Cloud's public listings under the plans", () => {
    const md: string = generatePricingMarkdown(homeUrl);
    const line: string =
      "Prefer to pay on your cloud bill? Buy OneUptime Cloud on [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw) or [Microsoft Marketplace](https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-cloud), at these prices. Every marketplace: https://oneuptime.com/resellers#cloud-marketplaces";

    expect(md).toContain(line);
    // After the plans, before the feature matrix.
    expect(
      md.indexOf("Canonical page: https://oneuptime.com/pricing"),
    ).toBeLessThan(md.indexOf(line));
    expect(md.indexOf(line)).toBeLessThan(md.indexOf("### "));
  });

  test("pricing markdown says nothing of marketplaces while no OneUptime Cloud listing is public", () => {
    const md: string = generatePricingMarkdown(
      homeUrl,
      getCloudMarketplacesContent(noListing),
    );

    expect(md).not.toContain("Marketplace");
    expect(md).toContain("| Growth | $22 | $20 |");
  });

  test("llms.txt lists the Resellers page with the description that names the marketplaces", () => {
    const txt: string = generateLlmsTxt(homeUrl, []);

    expect(txt).toContain(
      `- [Resellers](https://oneuptime.com/resellers.md): ${PageSEOConfig["/resellers"]!.description}`,
    );
    expect(PageSEOConfig["/resellers"]!.description).toContain(
      "cloud marketplace",
    );
  });
});
