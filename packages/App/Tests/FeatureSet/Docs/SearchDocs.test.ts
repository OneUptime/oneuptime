import {
  buildPageSearchCommandDescriptors,
  getPageSearchIndexEntries,
  PageSearchCommandDescriptor,
  PageSearchIndexEntry,
} from "../../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import {
  getPageSearchAreas,
  PageSearchAction,
  PageSearchArea,
  PageSearchPermission,
} from "../../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import {
  filterPaletteCommands,
  PaletteCommandMatch,
} from "Common/UI/Components/CommandPalette/PaletteFilter";
import { PaletteCommand } from "Common/UI/Components/CommandPalette/Types";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Home Page & Shortcuts (introduction/home; Getting Started until the docs
 * overhaul gave the dashboard's own ways around a page of their own) tells a
 * new user how to find any page with Search (Cmd/Ctrl+K). It names pages,
 * their breadcrumbs, the words Search knows for them and the Delete Project
 * action; these read the same names from the page index Search uses, and
 * fail when the page and Search drift apart.
 */

const HOME_PAGE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "FeatureSet",
    "Docs",
    "Content",
    "en",
    "introduction",
    "home.md",
  ),
  "utf8",
);

const HEADING: string = "## Searching for a page, a setting or an action";

const SECTION: string = ((): string => {
  const start: number = HOME_PAGE.indexOf(HEADING);
  expect(start).toBeGreaterThan(-1);
  const next: number = HOME_PAGE.indexOf("\n## ", start + 1);
  return HOME_PAGE.slice(start, next === -1 ? undefined : next);
})();

const AREAS: Array<PageSearchArea> = getPageSearchAreas();
const ENTRIES: Array<PageSearchIndexEntry> = getPageSearchIndexEntries(AREAS);

function findEntry(title: string, areaId?: string): PageSearchIndexEntry {
  const entry: PageSearchIndexEntry | undefined = ENTRIES.find(
    (candidate: PageSearchIndexEntry): boolean => {
      return (
        candidate.page.title === title &&
        (areaId === undefined || candidate.area.id === areaId)
      );
    },
  );

  expect({ title, found: Boolean(entry) }).toEqual({ title, found: true });

  return entry!;
}

describe("Home Page & Shortcuts explains Search", () => {
  test("it says how to open Search", () => {
    expect(SECTION).toContain("**Cmd+K**");
    expect(SECTION).toContain("**Ctrl+K**");
    expect(SECTION).toContain("search icon in the top bar");
  });

  test("every page it names is one Search offers, under that name", () => {
    for (const title of [
      "API Keys",
      "Danger Zone",
      "On-Call Schedules",
      "Incident Severity",
      "Notification Methods",
    ]) {
      expect([title, SECTION.includes(title)]).toEqual([title, true]);
      findEntry(title);
    }

    // Custom Fields, in the three products it names.
    for (const areaId of ["incidents", "alerts", "monitors"]) {
      findEntry("Custom Fields", areaId);
    }
  });

  test("its breadcrumb example is where API Keys lives", () => {
    expect(SECTION).toContain("*Project Settings › Advanced*");

    const apiKeys: PageSearchIndexEntry = findEntry("API Keys");
    expect(apiKeys.area.title).toBe("Project Settings");
    expect(apiKeys.section.title).toBe("Advanced");
  });

  test("the other words it promises are keywords of those pages", () => {
    const promises: Array<[string, string]> = [
      ["pager", "On-Call Policies"],
      ["escalation", "On-Call Policies"],
      ["rota", "On-Call Schedules"],
      ["2fa", "Two-factor authentication"],
      ["delete project", "Danger Zone"],
    ];

    for (const [word, title] of promises) {
      expect([word, SECTION.includes(`*${word}*`)]).toEqual([word, true]);
      expect([word, findEntry(title).page.keywords || []]).toEqual([
        word,
        expect.arrayContaining([word]),
      ]);
    }
  });

  test("Delete Project is an action, offered only to people allowed to delete the project", () => {
    expect(SECTION).toContain("Delete Project, which opens the Danger Zone");
    expect(SECTION).toContain("offered only to people allowed to do it");

    const action: PageSearchAction | undefined = (
      findEntry("Danger Zone").page.actions || []
    ).find((candidate: PageSearchAction): boolean => {
      return candidate.title === "Delete Project";
    });

    expect(action?.permission).toBe(PageSearchPermission.DeleteProject);
  });

  test("its search examples work: the product's name narrows, a typo is forgiven", () => {
    const pages: Array<PaletteCommand> = buildPageSearchCommandDescriptors({
      areas: AREAS,
      availability: {
        isBillingEnabled: true,
        isMonitorGroupsEnabled: true,
        canDeleteProject: true,
      },
      getRouteTemplate: (key: string): string => {
        return `/dashboard/:projectId/${key.toLowerCase()}`;
      },
      getRoutePath: (key: string): string => {
        return `/dashboard/project/${key.toLowerCase()}`;
      },
      getProductTitle: (): undefined => {
        return undefined;
      },
      translate: (text: string): string => {
        return text;
      },
      catalog: [],
    }).map((descriptor: PageSearchCommandDescriptor): PaletteCommand => {
      return {
        id: descriptor.id,
        title: descriptor.title,
        keywords: descriptor.keywords,
        breadcrumb: descriptor.breadcrumb,
        breadcrumbKeywords: descriptor.breadcrumbKeywords,
        category: "Pages",
        onSelect: (): void => {},
      };
    });

    const first: (query: string) => string = (query: string): string => {
      const match: PaletteCommandMatch | undefined = filterPaletteCommands(
        pages,
        query,
      )[0];
      return match
        ? `${match.command.title} — ${(match.command.breadcrumb || []).join(" › ")}`
        : "";
    };

    expect(SECTION).toContain("*incident custom fields*");
    expect(first("incident custom fields")).toBe(
      "Custom Fields — Incidents › Settings",
    );

    expect(SECTION).toContain("*incidnet*");
    expect(first("incidnet")).toMatch(/^.*Incident.* — Incidents/);

    for (const query of ["on-call", "on call", "oncall"]) {
      expect([query, SECTION.includes(`*${query}*`)]).toEqual([query, true]);
      expect(first(query)).toMatch(/^On-Call /);
    }
  });
});
