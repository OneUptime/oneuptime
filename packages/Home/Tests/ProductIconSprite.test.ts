import {
  ProductIconSprite,
  ProductIconSpriteRoutePattern,
  ProductIconsDirectory,
  buildProductIconSprite,
  getIconDrawing,
  serveProductIconSprite,
} from "../Utils/ProductIconSprite";
import {
  KITCHEN_SINK_MARKDOWN,
  MARKETING_PAGES,
  MarketingPage,
  VIEWS_ROOT,
  blogPostWith,
  listFiles,
  renderMarketingPage,
  renderView,
  seoFor,
} from "./Helpers/TailwindPages";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  createExpressApp,
} from "Common/Server/Utils/Express";
import BlogTag from "../Utils/BlogTag";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import ejs from "ejs";
import fs from "fs";
import http from "http";
import { JSDOM } from "jsdom";
import { AddressInfo } from "net";
import path from "path";

/*
 * The product icons as one cached sprite (Utils/ProductIconSprite.ts): each
 * icon partial draws `<use href="<sprite>#<icon>">` where its caller asks
 * and the server has a sprite, and its own paths everywhere else. These hold
 * the sprite to the partials, the partials to their inline drawing, and the
 * sprite to the places where an icon is out of sight when the page first
 * paints.
 */

const HOME_ROOT: string = path.join(__dirname, "..");
const SPRITE_HREF: string = "/img/product-icons.0123456789ab.svg";

const ICON_PARTIALS: Array<string> = fs
  .readdirSync(ProductIconsDirectory)
  .filter((name: string): boolean => {
    return name.endsWith(".ejs");
  })
  .sort();

const renderIcon: (
  partial: string,
  locals: Record<string, unknown>,
) => Promise<string> = async (
  partial: string,
  locals: Record<string, unknown>,
): Promise<string> => {
  return (await ejs.renderFile(
    path.join(ProductIconsDirectory, partial),
    locals,
  )) as string;
};

const openingTag: (html: string) => string = (html: string): string => {
  const start: number = html.indexOf("<svg");
  return html.slice(start, html.indexOf(">", start) + 1);
};

const spriteGroups: (svg: string) => Map<string, Element> = (
  svg: string,
): Map<string, Element> => {
  const document: Document = new JSDOM(svg, { contentType: "image/svg+xml" })
    .window.document;
  const groups: Map<string, Element> = new Map<string, Element>();

  for (const group of Array.from(document.querySelectorAll("defs > g"))) {
    groups.set(group.getAttribute("id") || "", group);
  }

  return groups;
};

/*
 * A drawing as SVG reads it - parsed as XML and written back - with the
 * whitespace between tags taken out, so markup written either way compares.
 */
const normalized: (markup: string) => string = (markup: string): string => {
  const document: Document = new JSDOM(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    { contentType: "image/svg+xml" },
  ).window.document;

  expect(document.querySelector("parsererror")).toBeNull();

  return document.documentElement.innerHTML.replace(/>\s+</g, "><").trim();
};

describe("the sprite", () => {
  let sprite: ProductIconSprite;
  let groups: Map<string, Element>;

  beforeAll(async () => {
    sprite = await buildProductIconSprite();
    groups = spriteGroups(sprite.svg);
  });

  test("is well-formed SVG with one group per icon partial", () => {
    const document: Document = new JSDOM(sprite.svg, {
      contentType: "image/svg+xml",
    }).window.document;

    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.documentElement.tagName).toBe("svg");
    expect(ICON_PARTIALS.length).toBeGreaterThan(30);
    expect(Array.from(groups.keys())).toEqual(
      ICON_PARTIALS.map((partial: string): string => {
        return partial.replace(/\.ejs$/, "");
      }),
    );
  });

  test.each(ICON_PARTIALS)(
    "holds %s's own drawing, exactly",
    async (partial: string) => {
      const inline: string = await renderIcon(partial, {
        iconClass: "h-4 w-4",
      });
      const group: Element = groups.get(partial.replace(/\.ejs$/, ""))!;

      expect(group).toBeDefined();
      expect(normalized(group.innerHTML)).toBe(
        normalized(getIconDrawing(inline)),
      );
      // Paths, not a reference to something else, and nothing it styles by class.
      expect(group.innerHTML).toMatch(
        /<(path|circle|rect|line|polygon|polyline|ellipse)\b/,
      );
      expect(group.innerHTML).not.toMatch(/\b(id|class|style)=|<use\b|url\(#/);
    },
  );

  test("is named for the hash of its content, so a changed icon is a new URL", () => {
    const hash: string = crypto
      .createHash("sha256")
      .update(sprite.svg)
      .digest("hex");

    expect(sprite.fileName).toBe(`product-icons.${hash.slice(0, 12)}.svg`);
    expect(sprite.href).toBe(`/img/${sprite.fileName}`);
    expect(ProductIconSpriteRoutePattern.test(sprite.href)).toBe(true);
  });

  test("comes out the same from the same partials", async () => {
    expect((await buildProductIconSprite()).svg).toBe(sprite.svg);
  });

  test("leaves the partials' comments out", () => {
    expect(sprite.svg).not.toContain("<!--");
  });
});

describe("an icon's drawing", () => {
  /*
   * What the sprite takes of a partial (getIconDrawing): what its <svg>
   * draws, without comments or the space between tags. No partial ships a
   * comment ("ships no HTML comment", below); these hold what one would come
   * to. Taking a comment out can bring what was around it together into a
   * new "<!--", and one that never closes runs to the end, so neither may
   * be left in the drawing.
   */
  const drawingOf: (inside: string) => string = (inside: string): string => {
    return getIconDrawing(`<svg viewBox="0 0 24 24">${inside}</svg>`);
  };

  test.each([
    ["a comment", '<!-- a --><path d="M0 0"/>'],
    [
      "comments around the paths",
      '<!-- a -->\n  <path d="M0 0"/>\n  <!-- b -->',
    ],
    [
      "a comment whose taking out brings another together",
      '<!<!-- a -->-- b --><path d="M0 0"/>',
    ],
    ["a comment that never closes", '<path d="M0 0"/><!-- c'],
  ])("%s: none is left", (_name: string, inside: string) => {
    const drawing: string = drawingOf(inside);

    expect(drawing).toBe('<path d="M0 0"/>');
    expect(drawing).not.toContain("<!--");
  });
});

describe("an icon partial", () => {
  test.each(ICON_PARTIALS)(
    "%s draws from the sprite inside the same <svg> when asked",
    async (partial: string) => {
      const name: string = partial.replace(/\.ejs$/, "");
      const inline: string = await renderIcon(partial, {
        iconClass: "h-4 w-4",
      });
      const fromSprite: string = await renderIcon(partial, {
        iconClass: "h-4 w-4",
        useIconSprite: true,
        productIconSpriteHref: SPRITE_HREF,
      });

      // Same size, colour, stroke and viewBox: the drawing lands where it did.
      expect(openingTag(fromSprite)).toBe(openingTag(inline));
      expect(openingTag(inline)).toContain('viewBox="0 0 24 24"');
      expect(getIconDrawing(fromSprite)).toBe(
        `<use href="${SPRITE_HREF}#${name}"></use>`,
      );
    },
  );

  test.each(ICON_PARTIALS)(
    "%s draws inline without the server's sprite, or when not asked",
    async (partial: string) => {
      const inline: string = await renderIcon(partial, {
        iconClass: "h-4 w-4",
      });

      expect(
        await renderIcon(partial, {
          iconClass: "h-4 w-4",
          useIconSprite: true,
        }),
      ).toBe(inline);
      expect(
        await renderIcon(partial, {
          iconClass: "h-4 w-4",
          productIconSpriteHref: SPRITE_HREF,
        }),
      ).toBe(inline);
      expect(inline).not.toContain("<use");
    },
  );

  test.each(ICON_PARTIALS)(
    "%s ships no HTML comment",
    async (partial: string) => {
      expect(await renderIcon(partial, {})).not.toContain("<!--");
    },
  );
});

describe("where the sprite is used", () => {
  /*
   * A <use> of another file draws nothing until that file has arrived, so
   * only icons that are out of sight at first paint use it: the nav's menus,
   * hidden until opened, and sections well below the fold. Icons at the top
   * of a page - each product page's hero badge - stay inline.
   */
  const USING_THE_SPRITE: Array<string> = [
    "Blog/Partials/BlogCta.ejs",
    "Partials/home-products.ejs",
    "nav.ejs",
  ];

  test("is only the templates that have been looked at", () => {
    const using: Array<string> = listFiles(VIEWS_ROOT, ".ejs")
      .filter((file: string): boolean => {
        return fs.readFileSync(file, "utf8").includes("useIconSprite: true");
      })
      .map((file: string): string => {
        return path.relative(VIEWS_ROOT, file).split(path.sep).join("/");
      });

    expect(using).toEqual(USING_THE_SPRITE);
  });

  test.each(USING_THE_SPRITE)(
    "%s uses it for every product icon it draws",
    (template: string) => {
      const source: string = fs.readFileSync(
        path.join(VIEWS_ROOT, template),
        "utf8",
      );
      const includes: Array<string> =
        source.match(/include\([^)]*icons\/[^)]*\)/g) || [];

      /*
       * A template that draws its icons from a list includes the partial
       * once, in the loop; the homepage test below counts what it draws.
       */
      expect(includes.length).toBeGreaterThan(0);
      expect(
        includes.filter((include: string): boolean => {
          return !include.includes("useIconSprite: true");
        }),
      ).toEqual([]);
    },
  );

  describe("on the homepage", () => {
    let document: Document;

    beforeAll(async () => {
      const homepage: MarketingPage = MARKETING_PAGES.find(
        (page: MarketingPage): boolean => {
          return page.template === "index.ejs";
        },
      )!;
      document = new JSDOM(
        await renderMarketingPage(homepage, {
          productIconSpriteHref: SPRITE_HREF,
        }),
      ).window.document;
    }, 600000);

    test("every <use> is in a menu hidden until opened, or below the hero", () => {
      const uses: Array<Element> = Array.from(document.querySelectorAll("use"));
      const hero: Element = document.getElementById("hero-section")!;

      expect(uses.length).toBeGreaterThan(100);
      expect(hero).not.toBeNull();

      const atFirstPaint: Array<string> = uses
        .filter((use: Element): boolean => {
          const hiddenMenu: Element | null = use.closest(
            "#mobile-menu[hidden], #product-modal.hidden",
          );
          const belowTheHero: boolean =
            !hero.contains(use) &&
            Boolean(
              hero.compareDocumentPosition(use) &
                document.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING,
            ) &&
            Boolean(use.closest("#products"));

          return !hiddenMenu && !belowTheHero;
        })
        .map((use: Element): string => {
          return use.getAttribute("href") || "";
        });

      expect(atFirstPaint).toEqual([]);
    });

    test("the product index draws its product icons from it", () => {
      const products: Element = document.querySelector("#products")!;

      expect(products).not.toBeNull();
      expect(products.querySelectorAll("use").length).toBeGreaterThan(5);
    });

    test("and points at an icon the sprite has", async () => {
      const sprite: ProductIconSprite = await buildProductIconSprite();
      const groups: Map<string, Element> = spriteGroups(sprite.svg);

      for (const use of Array.from(document.querySelectorAll("use"))) {
        const href: string = use.getAttribute("href") || "";

        expect(href.startsWith(`${SPRITE_HREF}#`)).toBe(true);
        expect([href, groups.has(href.split("#")[1]!)]).toEqual([href, true]);
      }
    });

    test("leaves no product icon drawn inline in the nav's menus", () => {
      for (const menu of ["#mobile-menu", "#product-modal"]) {
        const element: Element = document.querySelector(menu)!;
        const iconSvgs: Array<Element> = Array.from(
          element.querySelectorAll("svg"),
        ).filter((svg: Element): boolean => {
          return svg.querySelector("use") !== null;
        });

        expect([menu, iconSvgs.length > 10]).toEqual([menu, true]);
      }
    });
  });

  test("a blog post draws the call to action's icons from it, after the article", async () => {
    const htmlBody: string = await Markdown.convertToHTML(
      KITCHEN_SINK_MARKDOWN,
      MarkdownContentType.Blog,
    );
    const document: Document = new JSDOM(
      await renderView(path.join("Blog", "Post.ejs"), {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        blogPost: blogPostWith(htmlBody),
        blogTagPath: BlogTag.getPagePathOfTag,
        enableGoogleTagManager: false,
        seo: { fullCanonicalUrl: "https://oneuptime.com/blog/post/x/view" },
        productIconSpriteHref: SPRITE_HREF,
      }),
    ).window.document;
    const article: Element = document.querySelector("article")!;
    const uses: Array<Element> = Array.from(document.querySelectorAll("use"));

    expect(uses.length).toBeGreaterThan(10);

    for (const use of uses) {
      const inHiddenMenu: boolean = Boolean(
        use.closest("#mobile-menu[hidden], #product-modal.hidden"),
      );
      const afterArticle: boolean = Boolean(
        article.compareDocumentPosition(use) &
          document.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING,
      );

      expect(inHiddenMenu || afterArticle).toBe(true);
    }
  }, 600000);

  test("a product page's hero badge stays inline", async () => {
    const html: string = await renderView("topology.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/topology"),
      productIconSpriteHref: SPRITE_HREF,
    });
    const document: Document = new JSDOM(html).window.document;
    const hero: Element = document.getElementById("topo-hero-section")!;

    expect(hero).not.toBeNull();
    expect(hero.querySelectorAll("use")).toHaveLength(0);
    expect(hero.querySelectorAll("svg path").length).toBeGreaterThan(0);
  }, 600000);
});

describe("serving the sprite", () => {
  interface Answer {
    status: number;
    contentType: string;
    cacheControl: string;
    body: string;
  }

  let sprite: ProductIconSprite;
  let servers: Array<http.Server> = [];

  const start: (served: ProductIconSprite | null) => Promise<number> = async (
    served: ProductIconSprite | null,
  ): Promise<number> => {
    const app: ExpressApplication = createExpressApp();
    app.get(ProductIconSpriteRoutePattern, serveProductIconSprite(served));
    app.use((_req: ExpressRequest, res: ExpressResponse) => {
      res.status(404).send("not found");
    });

    const server: http.Server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    return (server.address() as AddressInfo).port;
  };

  const request: (port: number, urlPath: string) => Promise<Answer> = (
    port: number,
    urlPath: string,
  ): Promise<Answer> => {
    return new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
        http
          .get(
            { host: "127.0.0.1", port: port, path: urlPath, agent: false },
            (response: http.IncomingMessage) => {
              let body: string = "";
              response.setEncoding("utf8");
              response.on("data", (chunk: string) => {
                body += chunk;
              });
              response.on("end", () => {
                resolve({
                  status: response.statusCode || 0,
                  contentType: String(response.headers["content-type"] || ""),
                  cacheControl: String(response.headers["cache-control"] || ""),
                  body: body,
                });
              });
            },
          )
          .on("error", reject);
      },
    );
  };

  beforeAll(async () => {
    sprite = await buildProductIconSprite();
  });

  afterAll(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    }
    servers = [];
  });

  test("sends it as SVG, cached for a year at its own URL", async () => {
    const port: number = await start(sprite);
    const answer: Answer = await request(port, sprite.href);

    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe("image/svg+xml; charset=utf-8");
    expect(answer.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(answer.body).toBe(sprite.svg);
  });

  test("and never to be kept at another build's", async () => {
    const port: number = await start(sprite);
    const answer: Answer = await request(
      port,
      "/img/product-icons.ba9876543210.svg",
    );

    expect(answer.status).toBe(200);
    expect(answer.cacheControl).toBe("no-store");
    expect(answer.body).toBe(sprite.svg);
  });

  test("leaves other URLs, and a server without one, to the routes after it", async () => {
    const port: number = await start(sprite);

    for (const urlPath of [
      "/img/product-icons.svg",
      "/img/product-icons.0123456789AB.svg",
      `/img/x/${sprite.fileName}`,
    ]) {
      expect([urlPath, (await request(port, urlPath)).status]).toEqual([
        urlPath,
        404,
      ]);
    }

    expect((await request(await start(null), sprite.href)).status).toBe(404);
  });

  test("Routes.ts builds it at startup, hands pages its URL, and serves it before the catch-all", () => {
    const routes: string = fs.readFileSync(
      path.join(HOME_ROOT, "Routes.ts"),
      "utf8",
    );
    const route: number = routes.search(
      /app\.get\(\s*ProductIconSpriteRoutePattern,/,
    );

    expect(routes).toContain("await buildProductIconSprite()");
    expect(routes).toContain('app.locals["productIconSpriteHref"]');
    expect(route).toBeGreaterThan(0);
    expect(route).toBeLessThan(routes.indexOf('app.get("/*"'));
    expect(route).toBeLessThan(routes.indexOf("ExpressStatic(StaticPath"));
  });
});
