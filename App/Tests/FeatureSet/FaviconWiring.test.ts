import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const APP_ROOT: string = path.resolve(__dirname, "..", "..");
const SHARED_FAVICON_URL: string =
  "/oneuptime-assets/brand/favicons/oneuptime-up-v1.svg";

interface AppShell {
  name: string;
  routePrefix: string;
  publicRoot: string;
  source: string;
}

const APP_SHELLS: Array<AppShell> = [
  {
    name: "Dashboard",
    routePrefix: "/dashboard",
    publicRoot: path.join(APP_ROOT, "FeatureSet", "Dashboard", "public"),
    source: fs.readFileSync(
      path.join(APP_ROOT, "FeatureSet", "Dashboard", "views", "index.ejs"),
      "utf8",
    ),
  },
  {
    name: "Admin Dashboard",
    routePrefix: "/admin",
    publicRoot: path.join(APP_ROOT, "FeatureSet", "AdminDashboard", "public"),
    source: fs.readFileSync(
      path.join(APP_ROOT, "FeatureSet", "AdminDashboard", "views", "index.ejs"),
      "utf8",
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
});
