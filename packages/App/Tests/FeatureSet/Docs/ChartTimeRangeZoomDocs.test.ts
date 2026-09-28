import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Zooming Into a Time Range" docs against the product (issue #4105).
 *
 * Markdown is not compiled, so nothing else notices when the gesture the
 * page teaches drifts from what the charts do: the button's name, the
 * one-reset-climbs-all-the-way-out rule, which charts are left out. Each test
 * reads a source of truth - the nav, the reset button, the hint, the zoom
 * hook - and checks the page still tells the same story. It also keeps the
 * dashboard authoring page from going back to claiming that bar charts
 * cannot start a zoom.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const ZOOM_PAGE: string = "telemetry/charts-and-time-ranges";
const ZOOM_URL: string = `/docs/${ZOOM_PAGE}`;

function readPage(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, "en", `${page}.md`), "utf8");
}

function readSource(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function allNavLinks(): Array<NavLink> {
  return DocsNav.flatMap((group: NavGroup): Array<NavLink> => {
    return group.links;
  });
}

describe("Zooming Into a Time Range docs", () => {
  it("is in the Telemetry nav, right after the search syntax", () => {
    const telemetry: NavGroup | undefined = DocsNav.find(
      (group: NavGroup): boolean => {
        return group.title === "Telemetry";
      },
    );
    expect(telemetry).toBeDefined();

    const urls: Array<string> = telemetry!.links.map(
      (link: NavLink): string => {
        return link.url;
      },
    );
    expect(urls).toContain(ZOOM_URL);
    expect(urls.indexOf(ZOOM_URL)).toBe(
      urls.indexOf("/docs/telemetry/search-syntax") + 1,
    );
  });

  it("is listed exactly once", () => {
    expect(
      allNavLinks().filter((link: NavLink): boolean => {
        return link.url === ZOOM_URL;
      }),
    ).toHaveLength(1);
  });

  it("teaches both gestures", () => {
    const page: string = readPage(ZOOM_PAGE);

    expect(page).toContain("**Drag across the spike**");
    expect(page).toContain("**Double-click any chart**");
  });

  it("names the reset button the way the product labels it", () => {
    const page: string = readPage(ZOOM_PAGE);
    const button: string = readSource(
      "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton.tsx",
    );

    expect(button).toContain('aria-label="Reset zoom"');
    expect(page).toContain("**Reset zoom**");
  });

  it("quotes the hint charts show, word for word", () => {
    const page: string = readPage(ZOOM_PAGE);
    const hint: string = readSource(
      "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint.tsx",
    );

    for (const words of [
      "Drag to zoom",
      "Drag to zoom · double-click to reset",
    ]) {
      expect(hint).toContain(`"${words}"`);
      expect(page).toContain(`**${words}**`);
    }
  });

  it("promises what the zoom hook does: one reset returns the ORIGINAL range", () => {
    const page: string = readPage(ZOOM_PAGE);
    const hook: string = readSource(
      "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom.ts",
    );

    expect(hook).toContain("Only the FIRST zoom is remembered");
    expect(page).toContain("one reset climbs all the way out");
  });

  it("warns that a zoomed window stops rolling, and never runs past now", () => {
    const page: string = readPage(ZOOM_PAGE);

    expect(page).toContain("**A zoomed window is fixed.**");
    expect(page).toContain("**A zoom never runs past now.**");
  });

  it("says which charts do not zoom, so their absence is not read as a bug", () => {
    const page: string = readPage(ZOOM_PAGE);

    expect(page).toContain("## Charts that don't zoom");
    expect(page).toContain("uptime history strips");
    expect(page).toContain("sparklines in metric lists");
  });

  it("links to a docs page that exists", () => {
    const page: string = readPage(ZOOM_PAGE);
    const links: Array<string> = Array.from(
      page.matchAll(/\]\((\/docs\/[^)#]+)\)/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const file: string = path.join(
        CONTENT_DIR,
        "en",
        `${link.replace("/docs/", "")}.md`,
      );
      expect(fs.existsSync(file)).toBe(true);
    }
  });
});

describe("Dashboard authoring docs on zooming", () => {
  it("no longer claims bar charts cannot start a zoom", () => {
    const page: string = readPage("dashboards/authoring");

    expect(page).not.toContain("Bar charts can't originate a zoom");
    expect(page).toContain("Bar charts zoom the same way");
  });

  it("points at the product-wide zoom page", () => {
    expect(readPage("dashboards/authoring")).toContain(`(${ZOOM_URL})`);
  });
});
