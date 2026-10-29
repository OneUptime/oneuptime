import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import { getLiveRowEventTypes } from "Common/UI/Components/ModelTable/LiveRows";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { readPage } from "./DocsContentSupport";

/*
 * Home Page & Shortcuts → Finding your way around → Pages and lists says
 * three things about every page and list. Markdown is not compiled, so each
 * is read here against the code that makes it true:
 *
 *   - its trail example, *Project › Docker › Settings › Owner Rules*, is the
 *     trail Docker's Owner Rules page draws (every page has one:
 *     Common/Tests/App/Dashboard/EveryPageHasATrail);
 *   - the lists of incidents, alerts and episodes keep themselves current:
 *     each of the four kinds is announced as it is created and changed, the
 *     Dashboard listens once signed in, and a table listens unless it is
 *     told not to (UseLiveRows, LiveListsWiring);
 *   - on a phone the chips fold behind Filter, the set ones staying in sight
 *     with Clear all (FacetFilterBar).
 *
 * Every docs language writes the trail's steps, Filter and Clear all as its
 * dashboard draws them.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);

const HOME: string = "introduction/home";

function source(...parts: Array<string>): string {
  return fs.readFileSync(path.join(...parts), "utf8");
}

// All whitespace removed, for code Prettier may wrap either way.
function dense(text: string): string {
  return text.replace(/\s+/g, "");
}

// The text from a heading to the next heading of its level or above.
function sectionOf(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);
  expect({ heading, found: start > -1 }).toEqual({ heading, found: true });
  const level: string = heading.slice(0, heading.indexOf(" ") + 1);
  const rest: string = markdown.slice(start + heading.length + 2);
  const ends: Array<number> = ["\n## ", level === "### " ? "\n### " : "\n## "]
    .map((marker: string): number => {
      return rest.indexOf(marker);
    })
    .filter((index: number): boolean => {
      return index > -1;
    });

  return rest.slice(0, ends.length ? Math.min(...ends) : undefined);
}

const ENGLISH: string = readPage("en", HOME);
const SECTION: string = sectionOf(ENGLISH, "### Pages and lists");

const TRAIL: Array<string> = ["Project", "Docker", "Settings", "Owner Rules"];

describe("Pages and lists, in English", () => {
  it("sits under Finding your way around, after the bars at the top", () => {
    const finding: string = sectionOf(ENGLISH, "## Finding your way around");

    expect(finding.indexOf("### The bars at the top")).toBeGreaterThan(-1);
    expect(finding.indexOf("### Pages and lists")).toBeGreaterThan(
      finding.indexOf("### The bars at the top"),
    );
  });

  it("gives a trail Docker's Owner Rules page draws", () => {
    expect(SECTION).toContain(`*${TRAIL.join(" › ")}*`);

    const docker: string = source(
      DASHBOARD_SRC,
      "Utils/Breadcrumbs/DockerBreadcrumbs.ts",
    );

    expect(dense(docker)).toContain(
      dense(
        `BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SETTINGS_OWNER_RULES, [${TRAIL.map(
          (step: string): string => {
            return `"${step}",`;
          },
        ).join("")}])`,
      ),
    );
  });

  it("says the lists of incidents, alerts and episodes keep themselves current, and wait while you work", () => {
    expect(SECTION).toContain("**Lists keep themselves current.**");
    expect(SECTION).toContain(
      "the lists of incidents, alerts and episodes show it within seconds, without a refresh",
    );
    expect(SECTION).toContain("such as rows ticked or a dialog open, it waits");

    // Each kind is announced as it is created and as it changes.
    for (const model of [
      new Incident(),
      new Alert(),
      new IncidentEpisode(),
      new AlertEpisode(),
    ] as Array<BaseModel>) {
      expect([model.tableName, getLiveRowEventTypes(model)]).toEqual([
        model.tableName,
        expect.arrayContaining([ModelEventType.Create, ModelEventType.Update]),
      ]);
    }

    // The Dashboard listens once signed in; a table listens unless told not to.
    const index: string = dense(source(DASHBOARD_SRC, "Index.tsx"));
    expect(index).toContain("if(UserUtil.isLoggedIn()){Realtime.init();}");

    const table: string = dense(
      source(REPO_ROOT, "Common/UI/Components/ModelTable/BaseModelTable.tsx"),
    );
    expect(table).toContain("isEnabled:props.isLive!==false");
  });

  it("says the chips fold behind Filter on a phone, the set ones in sight with Clear all", () => {
    expect(SECTION).toContain(
      "**On a phone, the filter chips fold away** behind **Filter**",
    );
    expect(SECTION).toContain(
      "The chips you set stay in sight, with **Clear all**",
    );

    const bar: string = source(
      DASHBOARD_SRC,
      "Components/ResourceOwners/FacetFilterBar.tsx",
    );
    expect(bar).toContain("useIsBelowWidth(PHONE_BELOW_WIDTH_IN_PX)");
    expect(bar).toContain('translator.translateText("Filter")');
    expect(bar).toContain('translator.translateText("Clear all")');

    const styles: string = source(
      DASHBOARD_SRC,
      "Components/ResourceOwners/FilterChipStyles.ts",
    );
    expect(styles).toContain("[&>*:has([data-filter-chip-set=false])]:hidden");
  });
});

describe.each(
  SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
    return language !== "en";
  }).map((language: string): [string] => {
    return [language];
  }),
)("Pages and lists, in %s", (language: string) => {
  const page: string = readPage(language, HOME);

  it("writes the trail's steps as its dashboard draws them", () => {
    const trail: string = TRAIL.map((step: string): string => {
      return drawnDashboardLabel(language, step);
    }).join(" › ");

    expect(page).toContain(`*${trail}*`);
  });

  it("names Filter and Clear all as its dashboard draws them", () => {
    for (const label of ["Filter", "Clear all"]) {
      expect(page).toContain(`**${drawnDashboardLabel(language, label)}**`);
    }
  });
});
