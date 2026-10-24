import { readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { AiRuleFix } from "Common/Types/AI/AiRule";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
} from "Common/Types/AI/TelemetryAi";
import {
  PROFILE_INSIGHT_BASELINE_OFFSET_HOURS,
  PROFILE_INSIGHT_CATEGORIES,
  PROFILE_INSIGHT_MIN_FUNCTION_SAMPLES,
  PROFILE_INSIGHT_MIN_GROWN_SHARE_PERCENT,
  PROFILE_INSIGHT_MIN_GROWTH_POINTS,
  PROFILE_INSIGHT_MIN_OWN_SHARE_PERCENT,
  PROFILE_INSIGHT_MIN_WINDOW_SAMPLES,
  PROFILE_INSIGHT_WINDOW_MINUTES,
} from "Common/Utils/Profiles/ProfileInsight";
import { ProfileCategory } from "Common/Utils/Profiles/ProfileTypes";
import { InvestigationRuleTiming } from "../../../FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_SWITCHES,
  getTelemetryAiFixOptions,
} from "../../../FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";

/*
 * The Profiles page's "Find and fix slow code with AI" section, held to the
 * code it describes (Common/Types/AI/TelemetryAi, Utils/Profiles/
 * ProfileInsight and the Profiler's AI section): how often OneUptime looks,
 * what it files, the switch and where it is, the rules' answers, and how
 * many pull requests OneUptime AI opens on its own. The translations follow
 * the English page line for line (TelemetryDocsTranslations).
 */

const PROFILES: string = "telemetry/profiles";
const SECTION_HEADING: string = "## Find and fix slow code with AI";

const PACKAGES_ROOT: string = path.join(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
}

// The section, from its heading to the next level-2 heading.
function readSection(): string {
  const page: string = readPage("en", PROFILES);
  const start: number = page.indexOf(SECTION_HEADING);

  expect(start).toBeGreaterThan(-1);

  const next: number = page.indexOf("\n## ", start + SECTION_HEADING.length);

  return page.slice(start, next === -1 ? page.length : next);
}

describe("the Profiles page's section on finding and fixing slow code", () => {
  const section: string = readSection();

  it("comes before Data Retention, after the Profiler's own sections", () => {
    const page: string = readPage("en", PROFILES);

    expect(page.indexOf(SECTION_HEADING)).toBeGreaterThan(
      page.indexOf("## Explore profiles in OneUptime"),
    );
    expect(page.indexOf(SECTION_HEADING)).toBeLessThan(
      page.indexOf("## Data Retention"),
    );
  });

  it("says OneUptime looks every hour, at the last hour, against the same hour a day before", () => {
    expect(TELEMETRY_AI_LANES[TelemetryAiLane.Profile].scanEveryMinutes).toBe(
      60,
    );
    expect(PROFILE_INSIGHT_WINDOW_MINUTES).toBe(60);
    expect(PROFILE_INSIGHT_BASELINE_OFFSET_HOURS).toBe(24);
    expect(section).toContain("Every hour OneUptime looks through");
    expect(section).toContain("over the last hour");
    expect(section).toContain("since the same hour the day before");
  });

  it("states the gates a function is filed by, as the code has them", () => {
    expect(section).toContain(
      `its service sent at least ${PROFILE_INSIGHT_MIN_WINDOW_SAMPLES} samples in the last hour, the function at least ${PROFILE_INSIGHT_MIN_FUNCTION_SAMPLES} of them`,
    );
    expect(section).toContain(
      `it takes at least ${PROFILE_INSIGHT_MIN_OWN_SHARE_PERCENT}% of the service's CPU time or wall time`,
    );
    expect(section).toContain(
      `its share grew by ${PROFILE_INSIGHT_MIN_GROWTH_POINTS} points or more since the same hour the day before, to at least ${PROFILE_INSIGHT_MIN_GROWN_SHARE_PERCENT}%`,
    );
    // CPU time and wall time: the two kinds OneUptime reads.
    expect([...PROFILE_INSIGHT_CATEGORIES].sort()).toEqual(
      [ProfileCategory.Cpu, ProfileCategory.Wall].sort(),
    );
  });

  it("names the switch as the Settings page draws it, on for new projects", () => {
    const switches: ReadonlyArray<{ column: string; title: string }> =
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Profile];

    expect(switches).toHaveLength(1);
    expect(switches[0]!.column).toBe(
      TELEMETRY_AI_LANES[TelemetryAiLane.Profile].switchColumn,
    );
    expect(section).toContain(
      `holds the switch **${switches[0]!.title}**, on for new projects`,
    );

    // ProjectService turns it on for every new project.
    const projectService: string = readSource(
      "Common/Server/Services/ProjectService.ts",
    );
    const defaults: string = projectService.slice(
      projectService.indexOf("NEW_PROJECT_AI_DEFAULT_COLUMNS"),
    );

    expect(defaults).toContain('"enableAutomaticProfileRemediation"');
  });

  it("gives the paths of the Profiler's AI section as its menu draws it", () => {
    const sideMenu: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Profiles/SideMenu.tsx",
    );
    const aiSection: string = sideMenu.slice(sideMenu.indexOf('title: "AI"'));

    for (const page of ["Insights", "Logs", "Settings"]) {
      expect(aiSection).toContain(`title: "${page}"`);
      expect(section).toContain(
        `**Products → Performance Profiles → AI → ${page}**`,
      );
    }
  });

  it("names the rules' answers as their form draws them", () => {
    const fixTitles: Array<string> = getTelemetryAiFixOptions(
      TelemetryAiLane.Profile,
    ).map((option: CardSelectOption): string => {
      return option.title;
    });

    expect(fixTitles).toEqual([
      "Don't fix",
      "Ask before fixing",
      "Fix without asking",
    ]);
    expect(
      getTelemetryAiFixOptions(TelemetryAiLane.Profile).map(
        (option: CardSelectOption): string => {
          return option.value;
        },
      ),
    ).toEqual([
      AiRuleFix.DoNotFix,
      AiRuleFix.AskFirst,
      AiRuleFix.WithoutAsking,
    ]);

    for (const title of fixTitles) {
      expect(section).toContain(`**${title}**`);
    }

    const timing: Record<InvestigationRuleTiming, { title: string }> =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].timing;

    expect(section).toContain(
      `**${timing[InvestigationRuleTiming.RightAway].title}**, or **${timing[InvestigationRuleTiming.AfterWait].title}**`,
    );
  });

  it("names the finding's way into the Profiler as its link draws it", () => {
    // Read from the source: the link util needs a browser to load.
    const links: string = readSource(
      "App/FeatureSet/Dashboard/src/Utils/AIInsightExplorerLinks.ts",
    );
    const profileCase: string = links.slice(
      links.indexOf("case AIInsightType.ProfileHotspot:"),
    );

    expect(profileCase).toContain('target: "profiles"');
    expect(profileCase).toContain('label: "Open in Profiler"');
    expect(section).toContain("**Open in Profiler**");
  });

  it("says how many pull requests OneUptime AI opens on its own a day", () => {
    expect(section).toContain(
      `OneUptime AI opens at most ${TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY} pull requests on its own each day (UTC), one for each finding`,
    );
  });
});
