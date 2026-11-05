import { renderView, seoFor, VIEWS_ROOT } from "./Helpers/TailwindPages";
import PageSEOConfig from "../Utils/PageSEO";
import { getAllOpenStackAlertTemplates } from "Common/Types/Monitor/OpenStackAlertTemplates";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The OpenStack product page. What it may claim is held to the docs and the
 * code below; the trademark rules (OpenInfra's policy) are held here too.
 */

const HOME_ROOT: string = path.join(__dirname, "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(HOME_ROOT, relative), "utf8");
}

describe("the OpenStack product page", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await renderView("openstack.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/openstack"),
    });
  });

  test("renders a complete page with its head written from the SEO entry", () => {
    const seo: { title: string; description: string } =
      PageSEOConfig["/product/openstack"]!;

    expect(html).toContain("</html>");
    expect(html).toContain(
      `<title>${seo.title.replace(/&/g, "&amp;")}</title>`,
    );
    expect(html).toContain('id="openstack-hero-section"');
    expect(html).toContain('id="openstack-faq"');
    expect(html).toContain(
      '<link rel="canonical" href="https://oneuptime.com/product/openstack"',
    );
  });

  test("is routed, in the sitemap, and canonical", () => {
    expect(read("Routes.ts")).toContain('"/product/openstack"');
    expect(read("Routes.ts")).toContain("${ViewsPath}/openstack");
    expect(read("Utils/Sitemap.ts")).toContain(
      '"/product/openstack": { priority: 0.9, changefreq: "weekly" }',
    );
    expect(PageSEOConfig["/product/openstack"]!.canonicalPath).toBe(
      "/product/openstack",
    );
  });

  test("the alert template count it states is true", () => {
    expect(html).toContain("More than 90 ready-made alert templates");
    expect(getAllOpenStackAlertTemplates().length).toBeGreaterThan(90);
  });

  test("names the releases it was recorded on, and no others", () => {
    for (const release of ["Epoxy", "Flamingo", "Gazpacho", "Hibiscus"]) {
      expect(html).toContain(release);
    }
    for (const fixture of [
      "epoxy-ovn",
      "flamingo-ovn",
      "gazpacho-ovn",
      "gazpacho-ovs",
      "hibiscus-ovn",
    ]) {
      expect(
        fs.existsSync(
          path.join(
            HOME_ROOT,
            "..",
            "Common",
            "Tests",
            "Fixtures",
            "OpenStack",
            fixture,
          ),
        ),
      ).toBe(true);
    }
  });

  test("does not claim a real cloud of the size that was only simulated", () => {
    expect(html).toContain("a simulation");
    expect(html).toContain("no cloud that large has run against it");
  });

  test("says how far each deployment tool's guide has been run, as the docs do", () => {
    const docs: string = fs.readFileSync(
      path.join(
        HOME_ROOT,
        "..",
        "App",
        "FeatureSet",
        "Docs",
        "Content",
        "en",
        "telemetry",
        "openstack-deployment-tools.md",
      ),
      "utf8",
    );

    for (const tool of [
      "Kolla-Ansible",
      "OpenStack-Ansible",
      "OpenStack-Helm",
      "Atmosphere",
      "Canonical Sunbeam",
      "Mirantis MOSK",
    ]) {
      expect(html).toContain(tool);
      expect(docs).toContain(tool);
    }
    expect(html).toContain("Not run on either");
  });

  test("uses the name as the policy allows: no logo, no endorsement, a notice", () => {
    expect(html).toContain(
      "OpenStack is a trademark of the OpenInfra Foundation.",
    );
    expect(html).toContain("not endorsed by or affiliated with");
    expect(html).not.toMatch(/official OpenStack/i);
    expect(html).not.toMatch(/OpenStack[- ]certified/i);
    expect(html).not.toMatch(/OpenStack[- ]compatible/i);
    expect(html).not.toMatch(/powered by OpenStack/i);
    // The page's own name leads; the mark is neutral and drawn in-house.
    expect(html).not.toMatch(/<img[^>]+openstack/i);
  });

  test("every internal link is a page that exists", () => {
    const links: Array<string> = Array.from(
      html.matchAll(/href="(\/product\/[a-z-]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(links.length).toBeGreaterThan(4);
    for (const href of links) {
      expect(PageSEOConfig[href]?.canonicalPath).toBe(href);
    }
  });
});

describe("OpenStack on every product surface", () => {
  test("the navigation lists it in the mobile grid and the flyout", async () => {
    const nav: string = await renderView("nav.ejs", {});

    expect(nav.split('href="/product/openstack"').length - 1).toBe(2);
  });

  test("the footer lists it", async () => {
    const footer: string = await renderView("footer.ejs", {
      footerCards: false,
      cta: false,
    });

    expect(footer).toContain('href="/product/openstack"');
  });

  test.each([
    "Partials/product-showcase.ejs",
    "Partials/hero-cards/product-grid.ejs",
    "Partials/home-products.ejs",
  ])("%s links to it", async (template: string) => {
    expect(await renderView(template, {})).toContain(
      'href="/product/openstack"',
    );
  });

  test("the icon is neutral, not the OpenStack logo", async () => {
    const icon: string = await renderView("Partials/icons/openstack.ejs", {
      iconClass: "h-3 w-3",
    });
    const source: string = fs.readFileSync(
      path.join(VIEWS_ROOT, "Partials", "icons", "openstack.ejs"),
      "utf8",
    );

    expect(icon).toContain('class="h-3 w-3 text-sky-600"');
    expect(icon).toContain("<rect");
    expect(source).toContain("it is not the OpenStack logo");
  });
});
