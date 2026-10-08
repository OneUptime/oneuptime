import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";
import { JSONObject } from "../../Types/JSON";

/*
 * The pages the server renders itself - each frontend's index.ejs (the shell
 * the Dashboard, the Admin Dashboard and Accounts load in) and the server's
 * own message pages (a sign-in confirmation, an on-call acknowledgement) -
 * name and show the product from the variables
 * Common/Server/Utils/ProductBrandingViewVariables.ts hands every render:
 * `productName`, `productLogoUrl` and `productFaviconUrl`.
 *
 * Without them (no branding: the installation shows OneUptime's and cannot
 * change it) every page is OneUptime's, as it always was. With them, the
 * browser tab, the page title, the home-screen name and the logo are the
 * installation's, and OneUptime's own social cards and splash screens are
 * left out. Every value is HTML-escaped where it is written.
 *
 * The templates are read off disk and rendered with ejs, as the server does.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const FEATURE_SET_DIR: string = path.join(PACKAGES_DIR, "App", "FeatureSet");
const SERVER_VIEWS_DIR: string = path.join(
  PACKAGES_DIR,
  "Common",
  "Server",
  "Views",
);

const BRANDED: JSONObject = {
  productName: "Acme",
  productLogoUrl: "/api/branding/logo?v=1",
  productFaviconUrl: "/api/branding/favicon?v=1",
};

const renderTemplate: (file: string, variables: JSONObject) => string = (
  file: string,
  variables: JSONObject,
): string => {
  return ejs.render(fs.readFileSync(file, "utf8"), variables, {
    filename: file,
  });
};

const TITLE: RegExp = /<title>([\s\S]*?)<\/title>/g;

const titlesOf: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return Array.from(html.matchAll(TITLE)).map(
    (match: RegExpMatchArray): string => {
      return (match[1] || "").trim();
    },
  );
};

const META_CONTENT: (name: string) => RegExp = (name: string): RegExp => {
  return new RegExp(`<meta name="${name}" content="([^"]*)">`);
};

const metaContent: (html: string, name: string) => string | null = (
  html: string,
  name: string,
): string | null => {
  const match: RegExpMatchArray | null = html.match(META_CONTENT(name));
  return match ? match[1] || "" : null;
};

const ICON_LINK: RegExp =
  /<link rel="(?:shortcut icon|icon|apple-touch-icon)"[^>]*>/g;

const iconLinksOf: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return html.match(ICON_LINK) || [];
};

interface IndexPage {
  name: string;
  file: string;
  titles: Array<string>;
  brandedTitles: Array<string>;
}

const INDEX_PAGES: Array<IndexPage> = [
  {
    name: "the Dashboard",
    file: path.join(FEATURE_SET_DIR, "Dashboard", "views", "index.ejs"),
    titles: ["OneUptime Dashboard"],
    brandedTitles: ["Acme Dashboard"],
  },
  {
    name: "the Admin Dashboard",
    file: path.join(FEATURE_SET_DIR, "AdminDashboard", "views", "index.ejs"),
    titles: ["OneUptime Admin Dashboard"],
    brandedTitles: ["Acme Admin Dashboard"],
  },
  {
    name: "Accounts",
    file: path.join(FEATURE_SET_DIR, "Accounts", "views", "index.ejs"),
    titles: ["OneUptime Accounts", "OneUptime | Account"],
    brandedTitles: ["Acme Accounts", "Acme | Account"],
  },
];

describe.each(INDEX_PAGES)("$name's index page", (page: IndexPage) => {
  test("is OneUptime's when rendered without branding", () => {
    const html: string = renderTemplate(page.file, {});

    expect(titlesOf(html)).toEqual(page.titles);
    expect(html).not.toContain("/api/branding/");

    for (const link of iconLinksOf(html)) {
      expect(link).not.toContain("/api/branding/");
    }
  });

  test("names the installation in the tab title when it goes by a name of its own", () => {
    const html: string = renderTemplate(page.file, BRANDED);

    expect(titlesOf(html)).toEqual(page.brandedTitles);
  });

  test("uses the installation's own browser tab icon, and only it", () => {
    const html: string = renderTemplate(page.file, BRANDED);
    const iconLinks: Array<string> = iconLinksOf(html);

    expect(iconLinks.length).toBeGreaterThan(0);

    for (const link of iconLinks) {
      expect(link).toContain('href="/api/branding/favicon?v=1"');
    }

    expect(html).not.toContain("oneuptime-up-v1.svg");
    expect(html).not.toContain("favicon-32x32.png");
  });

  test("a browser tab icon of its own without a name of its own keeps OneUptime's name", () => {
    const html: string = renderTemplate(page.file, {
      productFaviconUrl: "/api/branding/favicon?v=1",
    });

    expect(titlesOf(html)).toEqual(page.titles);
    expect(iconLinksOf(html).join("\n")).toContain("/api/branding/favicon?v=1");
  });

  test("a name of its own without an icon of its own keeps OneUptime's icon", () => {
    const html: string = renderTemplate(page.file, { productName: "Acme" });

    expect(titlesOf(html)).toEqual(page.brandedTitles);
    expect(html).not.toContain("/api/branding/");
  });

  test("escapes the name and the icon address wherever it writes them", () => {
    const html: string = renderTemplate(page.file, {
      productName: 'Acme "Q" & <b>Co</b>',
      productFaviconUrl: '/api/branding/favicon?v=1"><script>x()</script>',
    });

    expect(html).not.toContain("<b>Co</b>");
    expect(html).not.toContain("<script>x()</script>");
    expect(html).toContain("Acme &#34;Q&#34; &amp; &lt;b&gt;Co&lt;/b&gt;");
  });
});

describe("the Dashboard's index page", () => {
  const file: string = INDEX_PAGES[0]!.file;

  test("says what OneUptime is, and who made it, by default", () => {
    const html: string = renderTemplate(file, {});

    expect(metaContent(html, "description")).toBe(
      "OneUptime - the complete open-source observability platform.",
    );
    expect(metaContent(html, "author")).toBe("OneUptime");
    expect(metaContent(html, "application-name")).toBe("OneUptime");
    expect(metaContent(html, "apple-mobile-web-app-title")).toBe("OneUptime");
  });

  test("on a branded installation, says the installation's name instead", () => {
    const html: string = renderTemplate(file, BRANDED);

    expect(metaContent(html, "description")).toBe("Acme");
    expect(metaContent(html, "author")).toBe("Acme");
    expect(metaContent(html, "application-name")).toBe("Acme");
    expect(metaContent(html, "apple-mobile-web-app-title")).toBe("Acme");
  });

  test("leaves out OneUptime's splash screens and Windows tiles on a branded installation", () => {
    expect(renderTemplate(file, {})).toContain("apple-touch-startup-image");
    expect(renderTemplate(file, {})).toContain("msapplication-TileImage");

    for (const variables of [
      BRANDED,
      { productName: "Acme" },
      { productFaviconUrl: "/api/branding/favicon?v=1" },
    ]) {
      const html: string = renderTemplate(file, variables);

      expect(html).not.toContain("apple-touch-startup-image");
      expect(html).not.toContain("msapplication-TileImage");
    }
  });

  test("still links the app manifest, which the server names after the installation", () => {
    expect(renderTemplate(file, BRANDED)).toContain(
      '<link rel="manifest" href="/dashboard/manifest.json">',
    );
  });
});

describe("the product logo on the server's own pages", () => {
  const partial: string = path.join(
    SERVER_VIEWS_DIR,
    "Partials",
    "ProductLogo.ejs",
  );

  test("is OneUptime's logo without branding", () => {
    const html: string = renderTemplate(partial, {});

    expect(html).toContain(
      'src="/oneuptime-assets/brand/oneuptime-logo.svg" alt="OneUptime"',
    );
  });

  test("is the installation's logo, named after it", () => {
    const html: string = renderTemplate(partial, BRANDED);

    expect(html).toContain('src="/api/branding/logo?v=1" alt="Acme"');
    expect(html).not.toContain("oneuptime-logo.svg");
  });

  test("is the installation's name, as text, when it has a name and no logo", () => {
    const html: string = renderTemplate(partial, { productName: "Acme" });

    expect(html).not.toContain("<img");
    expect(html).toContain(">Acme</div>");
  });

  test("is the installation's logo, named OneUptime, when only the logo differs", () => {
    const html: string = renderTemplate(partial, {
      productLogoUrl: "/api/branding/logo?v=1",
    });

    expect(html).toContain('src="/api/branding/logo?v=1" alt="OneUptime"');
  });

  test("escapes the name and the address", () => {
    const html: string = renderTemplate(partial, {
      productName: '"><script>x()</script>',
      productLogoUrl: '/logo"onerror="x()',
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('"onerror="');
    expect(html).toContain("&lt;script&gt;");

    const nameOnly: string = renderTemplate(partial, {
      productName: "<b>Acme</b>",
    });

    expect(nameOnly).not.toContain("<b>");
    expect(nameOnly).toContain("&lt;b&gt;Acme&lt;/b&gt;");
  });

  test.each([
    ["Common/Server/Views/ViewMessage.ejs", "./Partials/ProductLogo.ejs"],
    [
      "Common/Server/Views/AcknowledgeUserOnCallNotification.ejs",
      "./Partials/ProductLogo.ejs",
    ],
    [
      "App/FeatureSet/Identity/Views/Message.ejs",
      "../../../../Common/Server/Views/Partials/ProductLogo.ejs",
    ],
    [
      "App/FeatureSet/Identity/Views/SsoSignInConfirmation.ejs",
      "../../../../Common/Server/Views/Partials/ProductLogo.ejs",
    ],
  ])(
    "%s draws it, and no OneUptime logo of its own",
    (view: string, include: string) => {
      const file: string = path.join(PACKAGES_DIR, view);
      const source: string = fs.readFileSync(file, "utf8");

      expect(source).toContain(`include('${include}')`);
      expect(source).not.toContain("oneuptime-logo.svg");
      expect(source).not.toContain('alt="OneUptime"');

      // The include resolves from the page, as the server renders it.
      expect(fs.existsSync(path.resolve(path.dirname(file), include))).toBe(
        true,
      );
    },
  );
});

describe.each([
  ["the server's", path.join(SERVER_VIEWS_DIR, "Partials", "Head.ejs")],
  [
    "Identity's",
    path.join(FEATURE_SET_DIR, "Identity", "Views", "Partials", "Head.ejs"),
  ],
])("%s page head", (_name: string, file: string) => {
  test("is OneUptime's without branding: its icons and its social cards", () => {
    const html: string = renderTemplate(file, {});

    expect(html).toContain(
      '<meta property="og:url" content="https://oneuptime.com">',
    );
    expect(html).toContain("application/ld+json");
    expect(html).not.toContain("/api/branding/");
  });

  test("uses the installation's own browser tab icon, and only it", () => {
    const html: string = renderTemplate(file, BRANDED);
    const iconLinks: Array<string> = iconLinksOf(html);

    expect(iconLinks.length).toBeGreaterThan(0);

    for (const link of iconLinks) {
      expect(link).toContain('href="/api/branding/favicon?v=1"');
    }
  });

  test("leaves OneUptime's social cards out of an installation with a name of its own", () => {
    const html: string = renderTemplate(file, { productName: "Acme" });

    expect(html).not.toContain("og:title");
    expect(html).not.toContain("twitter:");
    expect(html).not.toContain("application/ld+json");
  });

  test("escapes the icon address", () => {
    const html: string = renderTemplate(file, {
      productFaviconUrl: '/x"><script>x()</script>',
    });

    expect(html).not.toContain("<script>x()</script>");
  });
});
