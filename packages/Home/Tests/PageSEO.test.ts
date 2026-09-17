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
   * /product/vmware is the marketing surface for the VMware product. The
   * template hard-codes its own <title> and meta description, and PageSEO is
   * what feeds the canonical tag, OG tags, breadcrumb JSON-LD, llms.txt and
   * products.json — so the entry has to exist with the product shape and the
   * exact breadcrumb trail, not merely pass the generic checks above.
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
