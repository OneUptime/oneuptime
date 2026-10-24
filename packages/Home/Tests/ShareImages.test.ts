import PageSEOConfig, { PageSEOData, getPageSEO } from "../Utils/PageSEO";
import { getProductCompareSlugs } from "../Utils/ProductCompare";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * LINK PREVIEWS: THE SHARE IMAGE.
 *
 * Every page without a share image of its own named /img/og-image.png, a
 * file that did not exist, so a link to oneuptime.com shared on LinkedIn, X
 * or Slack showed no image. /product/on-call and /product/workflows named
 * images that did not exist either, the about page wrote a second set of
 * Open Graph tags pointing at the missing file, and every page's image_src
 * hint was an SVG labelled image/png.
 *
 * Home serves /img from Static/img (Routes.ts mounts Static at the site
 * root), so a share image URL resolves to exactly one file there.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const STATIC_ROOT: string = path.join(__dirname, "..", "Static");
const HOME_URL: string = "https://oneuptime.com";

// What LinkedIn, X and Slack render in a link preview. Not SVG.
const RASTER_IMAGE: RegExp = /\.(?:png|jpe?g)$/i;
const PNG_FILE: RegExp = /\.png$/i;

// X's ceiling for a summary_large_image card; LinkedIn's is the same.
const MAX_SHARE_IMAGE_BYTES: number = 5 * 1024 * 1024;

// X's floor for a large image card.
const MIN_SHARE_IMAGE_WIDTH: number = 300;
const MIN_SHARE_IMAGE_HEIGHT: number = 157;

const DEFAULT_SHARE_IMAGE: string = "/img/og-image.png";

type SEOForTemplate = PageSEOData & { fullCanonicalUrl: string };

interface ImageSize {
  format: "png" | "jpeg";
  width: number;
  height: number;
}

interface SharedImages {
  ogImage: Array<string>;
  twitterImage: Array<string>;
  imageSrc: Array<string>;
}

function seoFor(pagePath: string, homeUrl: string = HOME_URL): SEOForTemplate {
  const seo: PageSEOData = getPageSEO(pagePath);

  return { ...seo, fullCanonicalUrl: `${homeUrl}${seo.canonicalPath}` };
}

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

function openingTags(html: string, tag: string): Array<string> {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map(
    (match: RegExpMatchArray): string => {
      return match[0];
    },
  );
}

function attributeValue(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}=["']([^"']*)["']`, "i").exec(tag)?.[1];
}

// The content of every <meta> whose name or property is `name`.
function metaContents(html: string, name: string): Array<string> {
  return openingTags(html, "meta")
    .filter((meta: string): boolean => {
      return (
        attributeValue(meta, "name") === name ||
        attributeValue(meta, "property") === name
      );
    })
    .map((meta: string): string => {
      return attributeValue(meta, "content") || "";
    });
}

function sharedImagesIn(html: string): SharedImages {
  return {
    ogImage: metaContents(html, "og:image"),
    twitterImage: metaContents(html, "twitter:image"),
    imageSrc: openingTags(html, "link")
      .filter((link: string): boolean => {
        return attributeValue(link, "rel") === "image_src";
      })
      .map((link: string): string => {
        return attributeValue(link, "href") || "";
      }),
  };
}

// The file under Static a URL on this site is served from.
function staticFileFor(url: string, homeUrl: string = HOME_URL): string {
  expect(url.startsWith(`${homeUrl}/`)).toBe(true);

  const urlPath: string = url.slice(homeUrl.length).split(/[?#]/)[0]!;

  return path.join(STATIC_ROOT, ...urlPath.split("/").filter(Boolean));
}

/*
 * Width and height from the file's own header: a PNG's IHDR chunk, or a
 * JPEG's start-of-frame segment. Null for anything else, which no preview
 * renders anyway.
 */
function imageSize(file: string): ImageSize | null {
  const bytes: Buffer = fs.readFileSync(file);

  if (
    bytes.length > 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return {
      format: "png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }

  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset: number = 2;

    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        return null;
      }

      const marker: number = bytes[offset + 1]!;
      const isStartOfFrame: boolean =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;

      if (isStartOfFrame) {
        return {
          format: "jpeg",
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      }

      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
  }

  return null;
}

// What a share image must be, with the page named in any failure.
function expectUsableShareImage(page: string, url: string): void {
  const file: string = staticFileFor(url);

  expect([page, url, fs.existsSync(file)]).toEqual([page, url, true]);
  expect([page, url, RASTER_IMAGE.test(file)]).toEqual([page, url, true]);
  expect([page, url, fs.statSync(file).size <= MAX_SHARE_IMAGE_BYTES]).toEqual([
    page,
    url,
    true,
  ]);

  const size: ImageSize | null = imageSize(file);

  expect([page, url, size?.format]).toEqual([
    page,
    url,
    PNG_FILE.test(file) ? "png" : "jpeg",
  ]);
  expect([
    page,
    url,
    size!.width >= MIN_SHARE_IMAGE_WIDTH &&
      size!.height >= MIN_SHARE_IMAGE_HEIGHT,
  ]).toEqual([page, url, true]);
}

async function renderHead(locals: Record<string, unknown>): Promise<string> {
  return render("head-social.ejs", { homeUrl: HOME_URL, ...locals });
}

function viewFiles(directory: string = VIEWS_ROOT): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...viewFiles(fullPath));
    } else if (entry.name.endsWith(".ejs")) {
      files.push(path.relative(VIEWS_ROOT, fullPath).split(path.sep).join("/"));
    }
  }

  return files.sort();
}

function viewsContaining(text: string): Array<string> {
  return viewFiles().filter((file: string): boolean => {
    return fs.readFileSync(path.join(VIEWS_ROOT, file), "utf8").includes(text);
  });
}

// Every page the site describes: the register, plus every comparison page.
const allPagePaths: Array<string> = [
  ...Object.keys(PageSEOConfig),
  ...getProductCompareSlugs().map((slug: string): string => {
    return `/compare/${slug}`;
  }),
];

describe("the default share image", () => {
  test("is a 1200 x 630 PNG in the folder Home serves /img from", () => {
    const file: string = path.join(STATIC_ROOT, "img", "og-image.png");

    expect(fs.existsSync(file)).toBe(true);
    expect(imageSize(file)).toEqual({
      format: "png",
      width: 1200,
      height: 630,
    });
    expect(fs.statSync(file).size).toBeLessThan(MAX_SHARE_IMAGE_BYTES);
  });

  test("is what a page with no image of its own shares, in every preview tag", async () => {
    expect(PageSEOConfig["/legal/terms"]!.ogImage).toBeUndefined();

    const html: string = await renderHead({ seo: seoFor("/legal/terms") });
    const url: string = `${HOME_URL}${DEFAULT_SHARE_IMAGE}`;

    expect(sharedImagesIn(html)).toEqual({
      ogImage: [url],
      twitterImage: [url],
      imageSrc: [url],
    });
  });

  test("is what a page rendered without SEO data shares", async () => {
    const html: string = await renderHead({});
    const url: string = `${HOME_URL}${DEFAULT_SHARE_IMAGE}`;

    expect(sharedImagesIn(html)).toEqual({
      ogImage: [url],
      twitterImage: [url],
      imageSrc: [url],
    });
  });

  test("is served from the host the page is on", async () => {
    const stagingUrl: string = "https://staging.oneuptime.example";
    const html: string = await renderHead({
      homeUrl: stagingUrl,
      seo: seoFor("/pricing", stagingUrl),
    });

    expect(metaContents(html, "og:image")).toEqual([
      `${stagingUrl}${DEFAULT_SHARE_IMAGE}`,
    ]);
  });
});

describe("every page's share image", () => {
  test("the walk covers the register and every comparison page", () => {
    expect(allPagePaths.length).toBeGreaterThan(90);
  });

  test.each(allPagePaths)(
    "%s shares one PNG or JPG that exists",
    async (pagePath: string) => {
      const html: string = await renderHead({ seo: seoFor(pagePath) });
      const images: SharedImages = sharedImagesIn(html);

      // One image, named the same way to every network that reads the page.
      expect(images.ogImage.length).toBe(1);
      expect(images.twitterImage).toEqual(images.ogImage);
      expect(images.imageSrc).toEqual(images.ogImage);

      expectUsableShareImage(pagePath, images.ogImage[0]!);
    },
  );

  test("every image the register names is a PNG or JPG under Static/img", () => {
    const named: Array<[string, string]> = Object.entries(PageSEOConfig)
      .filter(([, seo]: [string, PageSEOData]): boolean => {
        return Boolean(seo.ogImage);
      })
      .map(([pagePath, seo]: [string, PageSEOData]): [string, string] => {
        return [pagePath, seo.ogImage!];
      });

    expect(named.length).toBeGreaterThan(10);

    for (const [pagePath, image] of named) {
      expect([pagePath, image.startsWith("/img/")]).toEqual([pagePath, true]);
      expectUsableShareImage(pagePath, `${HOME_URL}${image}`);
    }
  });

  test("the workflows page shares the screenshot its hero shows", () => {
    const image: string = PageSEOConfig["/product/workflows"]!.ogImage!;

    expect(
      fs.readFileSync(path.join(VIEWS_ROOT, "workflows.ejs"), "utf8"),
    ).toContain(`src="${image}"`);
  });

  test("the on-call page shares the screenshot of its policies, which its hero now draws", () => {
    /*
     * The hero draws an escalation policy in HTML
     * (Partials/home-mocks/mock-oncall.ejs), which a link preview cannot
     * show, so the page keeps sharing the real screenshot of its policies.
     */
    const image: string = PageSEOConfig["/product/on-call"]!.ogImage!;

    expect(image).toBe("/img/on-call-policies.png");
    expect(fs.existsSync(path.join(STATIC_ROOT, image))).toBe(true);
    expect(
      fs.readFileSync(path.join(VIEWS_ROOT, "on-call.ejs"), "utf8"),
    ).toContain("include('./Partials/home-mocks/mock-oncall')");
  });

  test("the large-card pages share an image at least as wide as a large card", async () => {
    for (const pagePath of allPagePaths) {
      const seo: PageSEOData = getPageSEO(pagePath);

      if (seo.twitterCard === "summary") {
        continue;
      }

      const html: string = await renderHead({ seo: seoFor(pagePath) });
      const size: ImageSize | null = imageSize(
        staticFileFor(metaContents(html, "og:image")[0]!),
      );

      // A large card is drawn 2:1 at up to 1200 pixels wide.
      expect([pagePath, size!.width >= 600]).toEqual([pagePath, true]);
    }
  });
});

describe("only head-social.ejs writes a page's preview tags", () => {
  /*
   * A template that writes its own copy puts two og:image tags on the page,
   * and the networks take the first: about.ejs pointed at the missing image
   * that way. Blog posts write their own, from the post.
   */
  test.each([
    'property="og:image"',
    'name="twitter:image"',
    'property="og:title"',
    'property="og:description"',
    'name="twitter:title"',
    'name="twitter:site"',
  ])("%s", (tag: string) => {
    expect(viewsContaining(tag)).toEqual(["Blog/Post.ejs", "head-social.ejs"]);
  });

  test("the image_src hint is written with the page's own image", () => {
    expect(viewsContaining('rel="image_src"')).toEqual(["head-social.ejs"]);
  });

  test.each([
    ["about.ejs", "/about", { contributors: [] }],
    ["support.ejs", "/support", {}],
    ["pricing.ejs", "/pricing", { pricing: [] }],
    ["kubernetes.ejs", "/product/kubernetes", {}],
  ] as Array<[string, string, Record<string, unknown>]>)(
    "%s carries each preview tag once",
    async (
      template: string,
      pagePath: string,
      locals: Record<string, unknown>,
    ) => {
      const html: string = await render(template, {
        enableGoogleTagManager: false,
        seo: seoFor(pagePath),
        homeUrl: HOME_URL,
        ...locals,
      });

      for (const tag of [
        "og:title",
        "og:description",
        "og:url",
        "og:type",
        "og:image",
        "twitter:card",
        "twitter:title",
        "twitter:description",
        "twitter:image",
        "twitter:site",
      ]) {
        expect([template, tag, metaContents(html, tag).length]).toEqual([
          template,
          tag,
          1,
        ]);
      }
    },
  );
});
