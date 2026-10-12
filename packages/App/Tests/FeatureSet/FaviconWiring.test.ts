import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

const APP_ROOT: string = path.resolve(__dirname, "..", "..");

/*
 * The page as the server renders it. Without the installation's branding
 * variables (Common/Server/Utils/ProductBrandingViewVariables.ts) it is
 * OneUptime's page, which is what the icons below are pinned on; with a
 * browser tab icon of its own, that icon is the only one offered.
 */
function renderIndexPage(
  file: string,
  variables: Record<string, unknown> = {},
): string {
  return ejs.render(fs.readFileSync(file, "utf8"), variables, {
    filename: file,
  });
}
const SHARED_FAVICON_URL: string =
  "/oneuptime-assets/brand/favicons/oneuptime-up-v1.svg";

interface AppShell {
  name: string;
  routePrefix: string;
  publicRoot: string;
  file: string;
  source: string;
}

const APP_SHELLS: Array<AppShell> = [
  {
    name: "Dashboard",
    routePrefix: "/dashboard",
    publicRoot: path.join(APP_ROOT, "FeatureSet", "Dashboard", "public"),
    file: path.join(APP_ROOT, "FeatureSet", "Dashboard", "views", "index.ejs"),
    source: renderIndexPage(
      path.join(APP_ROOT, "FeatureSet", "Dashboard", "views", "index.ejs"),
    ),
  },
  {
    name: "Admin Dashboard",
    routePrefix: "/admin",
    publicRoot: path.join(APP_ROOT, "FeatureSet", "AdminDashboard", "public"),
    file: path.join(
      APP_ROOT,
      "FeatureSet",
      "AdminDashboard",
      "views",
      "index.ejs",
    ),
    source: renderIndexPage(
      path.join(APP_ROOT, "FeatureSet", "AdminDashboard", "views", "index.ejs"),
    ),
  },
];

function attribute(tag: string, name: string): string | null {
  const match: RegExpMatchArray | null = tag.match(
    new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i"),
  );

  return match?.[2] || null;
}

function ordinaryIconLinks(source: string): Array<string> {
  return (source.match(/<link\b[^>]*>/gi) || []).filter((tag: string) => {
    const rel: string | null = attribute(tag, "rel");

    return Boolean(rel?.toLowerCase().split(/\s+/).includes("icon"));
  });
}

describe.each(APP_SHELLS)("$name favicon", (shell: AppShell) => {
  const iconLinks: Array<string> = ordinaryIconLinks(shell.source);
  const iconHrefs: Array<string> = iconLinks.map((tag: string) => {
    return attribute(tag, "href") || "";
  });

  test("offers only contrast-safe, cache-busted browser icons", () => {
    expect(iconHrefs).toEqual([
      `${shell.routePrefix}/assets/img/favicons/favicon.ico?v=up-v1`,
      `${shell.routePrefix}/assets/img/favicons/favicon-32x32.png?v=up-v1`,
      `${shell.routePrefix}/assets/img/favicons/favicon-16x16.png?v=up-v1`,
      SHARED_FAVICON_URL,
    ]);
  });

  test("keeps the scalable Up mark self-identifying to browsers", () => {
    const svgLink: string | undefined = iconLinks.find((tag: string) => {
      return attribute(tag, "href") === SHARED_FAVICON_URL;
    });

    expect(svgLink).toBeDefined();
    expect(attribute(svgLink!, "type")).toBe("image/svg+xml");
    expect(attribute(svgLink!, "sizes")).toBe("any");
  });

  test("ships every app-local fallback it advertises", () => {
    const localHrefs: Array<string> = iconHrefs.filter((href: string) => {
      return href !== SHARED_FAVICON_URL;
    });

    for (const href of localHrefs) {
      const relativePath: string = href
        .slice(shell.routePrefix.length + 1)
        .split("?")[0]!;

      expect([
        href,
        fs.existsSync(path.join(shell.publicRoot, relativePath)),
      ]).toEqual([href, true]);
    }
  });

  test("does not let transparent light artwork override the Up mark", () => {
    expect(iconHrefs.join("\n")).not.toMatch(
      /(?:ou-wb\.svg|favicon-194x194|android-chrome-192x192)/,
    );
  });

  test("offers only the installation's own icon when it has one", () => {
    const branded: string = renderIndexPage(shell.file, {
      productFaviconUrl: "/api/branding/favicon?v=1",
    });

    expect(
      ordinaryIconLinks(branded).map((tag: string) => {
        return attribute(tag, "href");
      }),
    ).toEqual(["/api/branding/favicon?v=1", "/api/branding/favicon?v=1"]);
  });
});
