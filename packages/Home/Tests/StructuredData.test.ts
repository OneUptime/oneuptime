import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";
import { replaceHtmlMarkup } from "Common/Types/HtmlMarkup";
import type { BlogPost } from "../Utils/BlogPost";
import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import ProductCompare, {
  FAQ,
  Product,
  getProductCompareSlugs,
} from "../Utils/ProductCompare";

/*
 * THE SITE'S STRUCTURED DATA (JSON-LD), WRITTEN FROM OBJECTS.
 *
 * Search engines read a page's JSON-LD as JSON, from the raw text of its
 * script element: nothing there is read for HTML character references. The
 * FAQ, breadcrumb, web page, software and blog post blocks were written by
 * hand, their values placed with EJS's HTML escape - so an apostrophe
 * reached search engines as "&#39;" (sixty FAQ entries of the comparison
 * pages hold one), an "&" as "&amp;" - and a FAQ answer's quote was escaped
 * twice, for JSON and then for HTML, into "\&#34;", which no JSON reader
 * accepts. A blog post's description was placed as it was, so its own quote
 * ended the JSON string. Every block is now written through
 * Views/Partials/json-ld.ejs: JSON.stringify of an object, every "<" written
 * as < so no value can end the script element.
 *
 * These tests read every block of the rendered pages back as JSON: each
 * parses, holds no character reference, and holds exactly the text its page
 * was given.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";
const LD_JSON_TYPE: string = 'type="application/ld+json"';
const CHARACTER_REFERENCE: RegExp =
  /&(?:#\d+|#x[0-9a-f]+|amp|quot|apos|lt|gt|nbsp);/i;

type StructuredData = Record<string, unknown>;

async function render(
  template: string,
  locals: Record<string, unknown>,
): Promise<string> {
  return (await ejs.renderFile(path.join(VIEWS_ROOT, template), locals, {
    views: [VIEWS_ROOT],
  })) as string;
}

/*
 * The text of each JSON-LD script element of a page. The shared walk hands
 * each script element over whole (rawTextElements), as a browser reads it.
 */
function structuredDataTextsIn(html: string): Array<string> {
  const texts: Array<string> = [];

  replaceHtmlMarkup(
    html,
    (markup: string): string => {
      const startTagEnd: number = markup.indexOf(">");
      const startTag: string = markup.slice(0, startTagEnd + 1);

      if (
        markup.toLowerCase().startsWith("<script") &&
        startTag.includes(LD_JSON_TYPE)
      ) {
        texts.push(markup.slice(startTagEnd + 1, markup.lastIndexOf("</")));
      }

      return "";
    },
    { rawTextElements: true },
  );

  return texts;
}

function structuredDataIn(html: string): Array<StructuredData> {
  return structuredDataTextsIn(html).map((text: string): StructuredData => {
    return JSON.parse(text) as StructuredData;
  });
}

// Every string a value holds, however deep.
function stringsIn(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringsIn);
  }

  return [];
}

function expectReadableStructuredData(html: string, page: string): void {
  const texts: Array<string> = structuredDataTextsIn(html);

  expect([page, texts.length > 0]).toEqual([page, true]);

  for (const text of texts) {
    // No value can end the element: a "<" is written as <.
    expect([page, text.includes("<")]).toEqual([page, false]);

    const data: StructuredData = JSON.parse(text) as StructuredData;

    for (const value of stringsIn(data)) {
      expect([page, value, CHARACTER_REFERENCE.test(value)]).toEqual([
        page,
        value,
        false,
      ]);
    }
  }
}

function seoFor(pagePath: string): PageSEOData & { fullCanonicalUrl: string } {
  const seo: PageSEOData = getPageSEO(pagePath);

  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

async function renderCompare(slug: string, product: Product): Promise<string> {
  return render("product-compare.ejs", {
    support: false,
    enableGoogleTagManager: false,
    footerCards: true,
    cta: true,
    blackLogo: false,
    requestDemoCta: false,
    productConfig: product,
    onlyShowCompareTable: false,
    seo: seoFor(`/compare/${slug}`),
    homeUrl: HOME_URL,
  });
}

describe("the comparison pages' FAQ structured data", () => {
  const slugs: Array<string> = getProductCompareSlugs();

  test("every comparison page's FAQ reads as written, apostrophes and all", async () => {
    let apostrophes: number = 0;

    for (const slug of slugs) {
      const product: Product = ProductCompare(slug);
      const html: string = await renderCompare(slug, product);

      expectReadableStructuredData(html, slug);

      const faqPage: StructuredData | undefined = structuredDataIn(html).find(
        (data: StructuredData): boolean => {
          return data["@type"] === "FAQPage";
        },
      );

      expect([slug, faqPage]).toEqual([
        slug,
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: product.faq.map((faq: FAQ): StructuredData => {
            return {
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: { "@type": "Answer", text: faq.answer },
            };
          }),
        },
      ]);

      apostrophes += product.faq.filter((faq: FAQ): boolean => {
        return faq.question.includes("'") || faq.answer.includes("'");
      }).length;
    }

    // The entries that reached search engines with "&#39;" in them before.
    expect(apostrophes).toBeGreaterThan(0);
  }, 120000);

  test("a FAQ holding quotes, a backslash, an ampersand and markup still reads as written", async () => {
    const slug: string = slugs[0]!;
    const product: Product = ProductCompare(slug);
    const faq: FAQ = {
      question: 'Is it "really" R&D\'s pick at 50% < 60%?',
      answer: 'Yes \\ no: "</script><b>after</b>" & <b>bold</b>\nnext line',
    };
    const html: string = await renderCompare(slug, { ...product, faq: [faq] });

    expectReadableStructuredData(html, slug);

    const faqPage: StructuredData | undefined = structuredDataIn(html).find(
      (data: StructuredData): boolean => {
        return data["@type"] === "FAQPage";
      },
    );

    expect(faqPage?.["mainEntity"]).toEqual([
      {
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      },
    ]);
  });
});

describe("the blog post's structured data", () => {
  const blogPost: (title: string, description: string) => BlogPost = (
    title: string,
    description: string,
  ): BlogPost => {
    return {
      title: title,
      description: description,
      formattedPostDate: "October 07, 2026",
      fileName: "2026-10-07-structured-data",
      tags: ["Observability", "R&D"],
      postDate: "2026-10-07",
      blogUrl: `${HOME_URL}/blog/post/2026-10-07-structured-data/view`,
      contributors: [],
      htmlBody: "<p>Body.</p>",
      markdownBody: "",
      socialMediaImageUrl: `${HOME_URL}/blog/post/2026-10-07-structured-data/social-media.png`,
      author: {
        username: "someone",
        githubUrl: "https://github.com/someone",
        profileImageUrl: "https://github.com/someone.png",
        name: "Some O'Neil",
      },
      validationStatus: "validated",
      validationDate: "October 08, 2026",
    };
  };

  async function renderPost(post: BlogPost): Promise<string> {
    return render(path.join("Blog", "Post.ejs"), {
      support: false,
      footerCards: true,
      cta: true,
      blackLogo: false,
      requestDemoCta: false,
      blogPost: post,
      enableGoogleTagManager: false,
      homeUrl: HOME_URL,
    });
  }

  test("a post's title, description and author read as written", async () => {
    const post: BlogPost = blogPost(
      "Why it's \"done\": R&D's take on 99.9% < 100%",
      'A description with "quotes", a \\ backslash and </script><b>after</b> in it.',
    );
    const html: string = await renderPost(post);

    expectReadableStructuredData(html, "blog post");

    const data: Array<StructuredData> = structuredDataIn(html);
    const posting: StructuredData | undefined = data.find(
      (item: StructuredData): boolean => {
        return item["@type"] === "BlogPosting";
      },
    );
    const breadcrumbs: StructuredData | undefined = data.find(
      (item: StructuredData): boolean => {
        return item["@type"] === "BreadcrumbList";
      },
    );

    expect(posting).toMatchObject({
      headline: post.title,
      description: post.description,
      keywords: "Observability, R&D",
      author: { "@type": "Person", name: "Some O'Neil" },
      datePublished: "2026-10-07T00:00:00.000Z",
      url: post.blogUrl,
      mainEntityOfPage: post.blogUrl,
    });
    expect(
      (breadcrumbs?.["itemListElement"] as Array<StructuredData>)[2],
    ).toEqual({ "@type": "ListItem", position: 3, name: post.title });
  });

  test("an ordinary post's structured data is what it always was", async () => {
    const post: BlogPost = blogPost(
      "Diagrams everywhere",
      "Drawing diagrams in Markdown.",
    );
    const data: Array<StructuredData> = structuredDataIn(
      await renderPost(post),
    );

    expect(data).toEqual([
      {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        keywords: "Observability, R&D",
        publisher: {
          "@type": "Organization",
          name: "OneUptime",
          url: "https://oneuptime.com/",
          logo: {
            "@type": "ImageObject",
            url: "https://oneuptime.com/img/OneUptimePNG/1.png",
            width: 60,
            height: 60,
          },
        },
        author: {
          "@type": "Person",
          name: "Some O'Neil",
          url: "https://github.com/someone",
          sameAs: [],
        },
        headline: "Diagrams everywhere",
        url: post.blogUrl,
        datePublished: "2026-10-07T00:00:00.000Z",
        dateModified: "2026-10-07T00:00:00.000Z",
        description: "Drawing diagrams in Markdown.",
        mainEntityOfPage: post.blogUrl,
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://oneuptime.com/",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Blog",
            item: "https://oneuptime.com/blog",
          },
          { "@type": "ListItem", position: 3, name: "Diagrams everywhere" },
        ],
      },
    ]);
  });
});

describe("every page's head: organization, breadcrumbs, web page and software", () => {
  async function renderHead(seo: Record<string, unknown>): Promise<string> {
    return render("head-social.ejs", { homeUrl: HOME_URL, seo: seo });
  }

  test("a page's title and description read as written in its web page block", async () => {
    const html: string = await renderHead({
      title: 'Pricing & Plans | It\'s "OneUptime"',
      description: "Plans for teams of 1 < n < 100 & more.",
      fullCanonicalUrl: `${HOME_URL}/pricing`,
      pageType: "other",
      breadcrumbs: [
        { name: "Home", url: "/" },
        { name: "R&D's tools", url: "/pricing" },
      ],
    });

    expectReadableStructuredData(html, "pricing head");

    const data: Array<StructuredData> = structuredDataIn(html);

    expect(
      data.map((item: StructuredData): unknown => {
        return item["@type"];
      }),
    ).toEqual(["Organization", "BreadcrumbList", "WebPage"]);
    expect(data[2]).toMatchObject({
      name: 'Pricing & Plans | It\'s "OneUptime"',
      description: "Plans for teams of 1 < n < 100 & more.",
      url: `${HOME_URL}/pricing`,
    });
    expect(data[1]!["itemListElement"]).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${HOME_URL}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "R&D's tools",
        item: `${HOME_URL}/pricing`,
      },
    ]);
  });

  test("every page the site describes gets readable structured data, products with their features", async () => {
    for (const pagePath of [
      "/",
      "/pricing",
      "/product/monitoring",
      "/product/status-page",
      "/product/incident-management",
      "/books",
    ]) {
      const seo: PageSEOData & { fullCanonicalUrl: string } = seoFor(pagePath);
      const html: string = await renderHead(
        seo as unknown as Record<string, unknown>,
      );

      expectReadableStructuredData(html, pagePath);

      if (seo.pageType === "product" && seo.softwareApplication) {
        const software: StructuredData | undefined = structuredDataIn(
          html,
        ).find((item: StructuredData): boolean => {
          return item["@type"] === "SoftwareApplication";
        });

        expect(software).toMatchObject({
          name: seo.softwareApplication.name,
          description: seo.softwareApplication.description,
          featureList: seo.softwareApplication.features,
          offers: { price: "0", priceCurrency: "USD" },
        });
      }
    }
  });
});

describe("one way to write structured data", () => {
  function viewFiles(directory: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...viewFiles(fullPath));
      } else if (entry.name.endsWith(".ejs")) {
        files.push(
          path.relative(VIEWS_ROOT, fullPath).split(path.sep).join("/"),
        );
      }
    }

    return files.sort();
  }

  test("only Partials/json-ld.ejs writes a JSON-LD script element; the views include it", () => {
    const files: Array<string> = viewFiles(VIEWS_ROOT);
    const writers: Array<string> = files.filter((file: string): boolean => {
      return fs
        .readFileSync(path.join(VIEWS_ROOT, file), "utf8")
        .includes("application/ld+json");
    });
    const includers: Array<string> = files.filter((file: string): boolean => {
      return fs
        .readFileSync(path.join(VIEWS_ROOT, file), "utf8")
        .includes("Partials/json-ld");
    });

    expect(writers).toEqual(["Partials/json-ld.ejs"]);
    expect(includers).toEqual(
      expect.arrayContaining([
        "Blog/Post.ejs",
        "books.ejs",
        "head-social.ejs",
        "product-compare.ejs",
      ]),
    );
  });
});
