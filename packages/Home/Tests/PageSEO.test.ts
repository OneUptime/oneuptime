import PageSEOConfig, {
  BreadcrumbItem,
  PageSEOData,
  createDefaultSEO,
} from "../Utils/PageSEO";

/*
 * PageSEO is the source of every marketing page's <title>, meta description,
 * canonical URL and breadcrumb structured data. getSEOForPath (Routes.ts)
 * looks entries up by request path, so the config key must equal the entry's
 * canonicalPath or a page silently serves another page's canonical tag — an
 * SEO defect that de-indexes the page. These tests pin that contract and the
 * breadcrumb shape rather than any specific copy.
 */

const VALID_PAGE_TYPES: Set<string> = new Set<string>([
  "home",
  "product",
  "pricing",
  "legal",
  "blog",
  "about",
  "support",
  "enterprise",
  "compare",
  "solutions",
  "industry",
  "integration",
  "other",
]);

const entries: Array<[string, PageSEOData]> = Object.entries(PageSEOConfig);

describe("createDefaultSEO", () => {
  test("carries through its arguments and applies safe defaults", () => {
    const seo: PageSEOData = createDefaultSEO(
      "Title",
      "Description",
      "/some-path",
    );
    expect(seo.title).toBe("Title");
    expect(seo.description).toBe("Description");
    expect(seo.canonicalPath).toBe("/some-path");
    // Default page type and a Home breadcrumb so every page has a trail.
    expect(seo.pageType).toBe("other");
    expect(seo.breadcrumbs).toEqual([{ name: "Home", url: "/" }]);
  });

  test("respects an explicit page type", () => {
    const seo: PageSEOData = createDefaultSEO("T", "D", "/p", "product");
    expect(seo.pageType).toBe("product");
  });
});

describe("PageSEOConfig", () => {
  test("has entries", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  test("every config key equals its canonicalPath", () => {
    /*
     * getSEOForPath resolves by request path; a key that disagrees with its own
     * canonicalPath serves the wrong canonical URL for that page.
     */
    for (const [key, data] of entries) {
      expect(data.canonicalPath).toBe(key);
    }
  });

  test.each(entries)(
    "%s has a non-empty title and description",
    (_key: string, data: PageSEOData) => {
      expect(data.title.trim().length).toBeGreaterThan(0);
      expect(data.description.trim().length).toBeGreaterThan(0);
    },
  );

  test.each(entries)(
    "%s has a rooted canonical path",
    (key: string, data: PageSEOData) => {
      expect(data.canonicalPath.startsWith("/")).toBe(true);
      /*
       * No trailing slash except the homepage, so canonical URLs do not split
       * crawl equity between /x and /x/.
       */
      if (key !== "/") {
        expect(data.canonicalPath.endsWith("/")).toBe(false);
      }
    },
  );

  test.each(entries)(
    "%s has a valid page type",
    (_key: string, data: PageSEOData) => {
      expect(VALID_PAGE_TYPES.has(data.pageType)).toBe(true);
    },
  );

  test.each(entries)(
    "%s has a well-formed breadcrumb trail",
    (_key: string, data: PageSEOData) => {
      expect(Array.isArray(data.breadcrumbs)).toBe(true);
      expect(data.breadcrumbs.length).toBeGreaterThan(0);

      // The trail always starts at Home.
      const first: BreadcrumbItem = data.breadcrumbs[0]!;
      expect(first.name).toBe("Home");
      expect(first.url).toBe("/");

      for (const crumb of data.breadcrumbs) {
        expect(crumb.name.trim().length).toBeGreaterThan(0);
        expect(crumb.url.startsWith("/")).toBe(true);
      }

      /*
       * The final crumb is the page itself, so breadcrumb structured data and the
       * canonical URL agree.
       */
      const last: BreadcrumbItem =
        data.breadcrumbs[data.breadcrumbs.length - 1]!;
      expect(last.url).toBe(data.canonicalPath);
    },
  );

  test.each(entries)(
    "%s optional OG fields are non-empty when present",
    (_key: string, data: PageSEOData) => {
      if (data.ogImage !== undefined) {
        expect(data.ogImage.trim().length).toBeGreaterThan(0);
      }
      if (data.ogType !== undefined) {
        expect(data.ogType.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test("no two pages share a canonical path", () => {
    const canonicals: Array<string> = entries.map(
      ([, data]: [string, PageSEOData]): string => {
        return data.canonicalPath;
      },
    );
    expect(new Set(canonicals).size).toBe(canonicals.length);
  });
});

describe("the VMware product page entry", () => {
  /*
   * /product/vmware is the marketing surface for the VMware product. PageSEO
   * is what feeds its <title>, meta description, canonical tag, OG tags,
   * breadcrumb JSON-LD, llms.txt and products.json — so the entry has to
   * exist with the product shape and the exact breadcrumb trail, not merely
   * pass the generic checks above.
   */
  const seo: PageSEOData | undefined = PageSEOConfig["/product/vmware"];

  test("is registered as a product page", () => {
    expect(seo).toBeDefined();
    expect(seo!.canonicalPath).toBe("/product/vmware");
    expect(seo!.pageType).toBe("product");
    expect(seo!.twitterCard).toBe("summary_large_image");
  });

  test("walks Home → Products → VMware", () => {
    expect(seo!.breadcrumbs).toEqual([
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "VMware", url: "/product/vmware" },
    ]);
  });

  test("describes vSphere, not Proxmox, in its copy", () => {
    const copy: string = `${seo!.title} ${seo!.description}`;

    expect(seo!.title).toMatch(/VMware Monitoring/);
    expect(seo!.title).toMatch(/\| OneUptime$/);
    for (const term of ["vCenter", "ESXi", "datastore"]) {
      expect(copy).toContain(term);
    }
    // Proxmox-only concepts must not leak into the VMware entry.
    expect(copy).not.toMatch(/proxmox|pve|quorum|replication|backup/i);
  });

  test("carries a SoftwareApplication schema with the product's features", () => {
    expect(seo!.softwareApplication).toBeDefined();
    expect(seo!.softwareApplication!.name).toBe("OneUptime VMware Monitoring");
    expect(seo!.softwareApplication!.features.length).toBeGreaterThanOrEqual(8);

    const features: string = seo!.softwareApplication!.features.join(" | ");
    expect(features).toContain("vCenter");
    expect(features).toMatch(/vSAN/);
    expect(features).toMatch(/Open source/);
    expect(features).not.toMatch(/proxmox|quorum|replication|backup/i);
  });

  test("the topology page counts VMware among its infrastructure sources", () => {
    const topology: PageSEOData = PageSEOConfig["/product/topology"]!;

    expect(topology.softwareApplication!.description).toContain("VMware");
    expect(topology.softwareApplication!.features).toContain(
      "Kubernetes, Proxmox, VMware, Ceph, Docker Swarm & hosts",
    );
  });
});

describe("the Databases product page entry", () => {
  /*
   * /product/databases is the marketing surface for the Databases product.
   * This entry is what feeds its <title>, meta description, canonical tag,
   * OG tags, breadcrumb JSON-LD, llms.txt and products.json.
   */
  const seo: PageSEOData | undefined = PageSEOConfig["/product/databases"];

  test("is registered as a product page", () => {
    expect(seo).toBeDefined();
    expect(seo!.canonicalPath).toBe("/product/databases");
    expect(seo!.pageType).toBe("product");
    expect(seo!.twitterCard).toBe("summary_large_image");
  });

  test("walks Home → Products → Databases", () => {
    expect(seo!.breadcrumbs).toEqual([
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Databases", url: "/product/databases" },
    ]);
  });

  test("names the engines people search for, and where the data comes from", () => {
    expect(seo!.title).toMatch(/^Database Monitoring \|/);
    expect(seo!.title).toMatch(/\| OneUptime$/);
    /*
     * Three engines fit in a title search results show whole; the rest are
     * named in the feature list.
     */
    for (const engine of ["PostgreSQL", "MySQL", "Redis"]) {
      expect(seo!.title).toContain(engine);
    }
    for (const engine of ["MongoDB", "MariaDB", "SQL Server", "Oracle"]) {
      expect(seo!.softwareApplication!.features.join(" | ")).toContain(engine);
    }
    for (const source of ["traces", "Kubernetes", "OpenTelemetry"]) {
      expect(seo!.description).toContain(source);
    }
  });

  test("carries a SoftwareApplication schema with the product's features", () => {
    expect(seo!.softwareApplication).toBeDefined();
    expect(seo!.softwareApplication!.name).toBe(
      "OneUptime Database Monitoring",
    );
    expect(seo!.softwareApplication!.features.length).toBeGreaterThanOrEqual(8);

    const features: string = seo!.softwareApplication!.features.join(" | ");
    expect(features).toMatch(/Auto-discovery from traces, Kubernetes/);
    expect(features).toMatch(/Database Health monitor/);
    expect(features).toContain("OpenTelemetry native");
    expect(features).toContain("Open source");
  });
});

describe("the Queues product page entry", () => {
  /*
   * /product/queues is the marketing surface for the Queues product. This
   * entry is what feeds its <title>, meta description, canonical tag, OG
   * tags, breadcrumb JSON-LD, llms.txt and products.json.
   */
  const seo: PageSEOData | undefined = PageSEOConfig["/product/queues"];

  test("is registered as a product page", () => {
    expect(seo).toBeDefined();
    expect(seo!.canonicalPath).toBe("/product/queues");
    expect(seo!.pageType).toBe("product");
    expect(seo!.twitterCard).toBe("summary_large_image");
  });

  test("walks Home → Products → Queues", () => {
    expect(seo!.breadcrumbs).toEqual([
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Queues", url: "/product/queues" },
    ]);
  });

  test("names the brokers people search for, and where the data comes from", () => {
    expect(seo!.title).toMatch(/^Message Queue Monitoring \|/);
    expect(seo!.title).toMatch(/\| OneUptime$/);
    // Three brokers fit in the title; the rest are in the feature list.
    for (const broker of ["Kafka", "RabbitMQ", "SQS"]) {
      expect(seo!.title).toContain(broker);
    }
    for (const broker of ["Pub/Sub", "Azure Service Bus", "NATS"]) {
      expect(seo!.softwareApplication!.features.join(" | ")).toContain(broker);
    }
    for (const source of ["OpenTelemetry traces", "broker metrics"]) {
      expect(seo!.description).toContain(source);
    }
    for (const signal of ["consumer lag", "dead letters"]) {
      expect(seo!.description).toContain(signal);
    }
  });

  test("carries a SoftwareApplication schema with the product's features", () => {
    expect(seo!.softwareApplication).toBeDefined();
    expect(seo!.softwareApplication!.name).toBe("OneUptime Queue Monitoring");
    expect(seo!.softwareApplication!.features.length).toBeGreaterThanOrEqual(8);

    const features: string = seo!.softwareApplication!.features.join(" | ");
    expect(features).toMatch(
      /Auto-discovery from OpenTelemetry messaging spans/,
    );
    expect(features).toMatch(/consumer lag, dead letters/);
    expect(features).toContain("OpenTelemetry native");
    expect(features).toContain("Open source");
  });
});

describe("the Resellers page entry", () => {
  const seo: PageSEOData | undefined = PageSEOConfig["/resellers"];

  test("is registered at /resellers, as an enterprise page so llms.txt lists it", () => {
    expect(seo).toBeDefined();
    expect(seo!.canonicalPath).toBe("/resellers");
    expect(seo!.pageType).toBe("enterprise");
  });

  test("walks Home → Resellers", () => {
    expect(
      seo!.breadcrumbs.map((crumb: BreadcrumbItem) => {
        return [crumb.name, crumb.url];
      }),
    ).toEqual([
      ["Home", "/"],
      ["Resellers", "/resellers"],
    ]);
  });

  test("leads with the page's name and fits in a search result", () => {
    expect(seo!.title).toBe(
      "Resellers | Buy Through a Local Partner | OneUptime",
    );
    expect(seo!.title.length).toBeLessThanOrEqual(60);
    expect(seo!.description.length).toBeLessThanOrEqual(160);
  });

  test("names no reseller, so it stays true as the list changes", () => {
    expect(`${seo!.title} ${seo!.description}`).not.toMatch(/SLEXN|Korea/);
    expect(seo!.description).toContain("become a reseller");
  });

  test("says a buyer can also pay on their cloud bill, naming no marketplace, so it stays true as listings go public", () => {
    expect(seo!.description).toBe(
      "Buy OneUptime through a reseller in your country, or on your cloud marketplace and pay on your cloud bill. Or apply to become a reseller.",
    );
    expect(`${seo!.title} ${seo!.description}`).not.toMatch(
      /AWS|Amazon|Azure|Microsoft|Google/,
    );
  });

  test("gives both ways to buy first, then the way to sell", () => {
    const description: string = seo!.description;

    expect(description.startsWith("Buy OneUptime through a reseller")).toBe(
      true,
    );
    expect(description.indexOf("a reseller in your country")).toBeLessThan(
      description.indexOf("cloud marketplace"),
    );
    expect(description.indexOf("cloud marketplace")).toBeLessThan(
      description.indexOf("become a reseller"),
    );
    // One sentence to buy, one to sell.
    expect(
      description.split(". ").map((sentence: string): string => {
        return sentence.split(" ")[0] || "";
      }),
    ).toEqual(["Buy", "Or"]);
  });
});
