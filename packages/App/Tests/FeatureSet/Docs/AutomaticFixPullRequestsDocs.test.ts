import {
  AI_SRE_PAGE,
  DOCS_CONTENT_DIR,
  UPGRADING_PAGE,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import {
  AI_LANE_SWITCHES,
  AiLane,
  ProjectAiSwitchDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  AUTOMATIC_FIX_SWITCH_COLUMNS,
  getAutomaticFixPullRequestColumns,
} from "Common/Types/AI/AutomaticFixSwitches";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * "The two dots below should be auto-turned on when the 'Fix new alerts
 * automatically' is turned on, and it should actually be a child of 'Fix
 * new alerts automatically'." - the maintainer.
 *
 * The two pull-request switches are part of fixing now: drawn under it
 * while it is on, on and off with it, and opening pull requests only while
 * it is on (Common/Types/AI/AutomaticFixSwitches). The docs say so in the
 * words the dashboard uses, and the upgrade note says what that changes for
 * an existing project and for API and Terraform users.
 */

const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const NOTE_HEADING: string = "### The pull-request switches are part of fixing";
const FIXING_NOTE_HEADING: string =
  "### Fixing new incidents and alerts has a switch of its own";
const NEXT_NOTE_HEADING: string = "### Verify the edition and the license";
const NEW_PROJECTS_NOTE_HEADING: string =
  "### New projects start with every AI feature on";

const AI_AGENT_PAGE: string = path.join(DOCS_CONTENT_DIR, "ai/ai-agent.md");
const INCIDENT_SETTINGS_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "incidents/settings.md",
);
const FA_AI_SRE_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "..",
  "fa",
  "ai",
  "ai-sre.md",
);

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The two pull-request switches' titles, as the dashboard draws them.
function pullRequestTitles(lane: AiLane): Array<string> {
  return (AI_LANE_SWITCHES[lane][1]!.children || []).map(
    (definition: ProjectAiSwitchDefinition<string>): string => {
      return definition.title;
    },
  );
}

// Every column the three switches of both lanes write.
const ALL_COLUMNS: Array<string> = [
  AutoRemediationTriggerEntity.Incident,
  AutoRemediationTriggerEntity.Alert,
].flatMap((signal: AutoRemediationTriggerEntity): Array<string> => {
  return [
    AUTOMATIC_FIX_SWITCH_COLUMNS[signal].fix,
    ...getAutomaticFixPullRequestColumns(signal),
  ];
});

// camelCase to the Terraform provider's snake_case attribute.
function terraformName(column: string): string {
  return column.replace(/[A-Z]/g, (letter: string): string => {
    return `_${letter.toLowerCase()}`;
  });
}

describe("the upgrade note", () => {
  const upgrading: string = read(UPGRADING_PAGE);
  const note: string = flat(getSection(upgrading, NOTE_HEADING));

  it("sits in the 13 → 14 notes, right after fixing's own note and before the edition checks, once", () => {
    const headings: Array<string> = getHeadings(
      getSection(upgrading, THIRTEEN_TO_FOURTEEN_HEADING),
    );
    const position: number = headings.indexOf(NOTE_HEADING);

    expect(position).toBeGreaterThan(0);
    expect(headings[position - 1]).toBe(FIXING_NOTE_HEADING);
    expect(headings[position + 1]).toBe(NEXT_NOTE_HEADING);
    expect(
      getHeadings(upgrading).filter((heading: string): boolean => {
        return heading === NOTE_HEADING;
      }),
    ).toHaveLength(1);
  });

  it("names both switches as the dashboard titles them, and where they now sit", () => {
    for (const title of pullRequestTitles(AiLane.Incident)) {
      expect(note).toContain(`**${title}**`);
    }
    expect(note).toContain(
      "now sit under **Fix new incidents automatically** (or **Fix new alerts automatically**)",
    );
    expect(note).toContain(
      "They are shown only while fixing is on, turning fixing on turns both on, and turning it off turns both off.",
    );
    expect(note).toContain(
      "While fixing is on, either one can be turned off on its own.",
    );
  });

  it("says plainly what changes for an existing project, and how to get the pull requests back", () => {
    expect(note).toContain(
      "A pull request opens on its own only while fixing is on as well as its own switch.",
    );
    expect(note).toContain(
      "A project that had a pull-request switch on and fixing off stops opening those pull requests by itself. Turn fixing on to get them back.",
    );
    expect(note).toContain(
      "keep **Fixes** off on their **AI agent** pages (the default) and add no auto remediation rule",
    );
    expect(note).toContain("The upgrade changes no stored setting.");
    expect(note).toContain(
      "A new project starts with the pull-request switches off, like fixing.",
    );
    expect(note).toContain(
      "**Open Fix PR from this analysis** on an investigation is unchanged: it needs neither switch.",
    );
  });

  it("tells API and Terraform users the server stores what they write, and to set all three at once", () => {
    for (const column of getAutomaticFixPullRequestColumns(
      AutoRemediationTriggerEntity.Incident,
    ).concat(
      getAutomaticFixPullRequestColumns(AutoRemediationTriggerEntity.Alert),
    )) {
      expect(note).toContain(`\`${column}\``);
    }
    expect(note).toContain(
      `\`${terraformName("enableAutomaticIncidentCodeFixes")}\``,
    );
    expect(note).toContain(
      "does not turn the pull-request fields on or off with `enableAutomaticIncidentRemediation`",
    );
    expect(note).toContain(
      "set all three in one request to turn fixing on with its pull requests",
    );
  });

  it("the Terraform name it gives is the provider's snake_case of the field", () => {
    expect(terraformName("enableAutomaticIncidentCodeFixes")).toBe(
      "enable_automatic_incident_code_fixes",
    );
    // The same rule names the fixing switch in the note before it.
    expect(flat(getSection(upgrading, FIXING_NOTE_HEADING))).toContain(
      `\`${terraformName("enableAutomaticIncidentRemediation")}\``,
    );
  });

  it("the new-projects note no longer counts the pull requests among what starts on, and links here", () => {
    const newProjects: string = flat(
      getSection(upgrading, NEW_PROJECTS_NOTE_HEADING),
    );

    expect(newProjects).not.toContain(
      "automatic code fixes and instrumentation fixes",
    );
    expect(newProjects).toContain(
      "The pull requests OneUptime AI opens for incidents and alerts are part of fixing, which starts off",
    );

    const link: string = `(#${slugify(NOTE_HEADING.replace(/^### /, ""))})`;
    expect(link).toBe("(#the-pull-request-switches-are-part-of-fixing)");
    expect(newProjects).toContain(link);
  });
});

describe("the AI SRE page", () => {
  const page: string = flat(read(AI_SRE_PAGE));
  const codeFixes: string = flat(
    getSection(read(AI_SRE_PAGE), "## Automatic code fixes"),
  );

  it("says the pull requests are drawn under fixing, and on and off with it", () => {
    const titles: Array<string> = pullRequestTitles(AiLane.Incident).map(
      (title: string): string => {
        return `_${title}_`;
      },
    );

    expect(page).toContain(
      `Two more switches are part of it, drawn under it while it is on: ${titles[0]} and ${titles[1]}.`,
    );
    expect(page).toContain("Fixing builds on top of investigations:");
    expect(page).not.toContain("One further setting builds on top of");
  });

  it("says, for both signals, that the fix pull request opens only while fixing is on, and both start off", () => {
    expect(codeFixes).toContain(
      "is part of fixing: it sits under **Fix new incidents automatically** on **Incidents > AI > Settings**, and under **Fix new alerts automatically** on **Alerts > AI > Settings**, and opens pull requests only while that switch is on.",
    );
    expect(codeFixes).toContain(
      "Both start **off**, for new projects too; turning fixing on turns it on, and turning fixing off turns it off.",
    );
    expect(codeFixes).toContain(
      "A second switch under fixing, **Open a pull request that adds missing telemetry**",
    );
    expect(codeFixes).toContain("comes on and goes off with fixing too");
    expect(codeFixes).not.toContain("A second switch beside it");
  });

  it("says the auto remediation rules narrow the cluster and host fixes and runbooks, not the pull requests", () => {
    expect(codeFixes).toContain(
      "Auto remediation rules narrow those fixes and the runbooks, not the pull requests: while fixing is on, every investigation that qualifies can open one.",
    );
  });

  it("says how to get the pull requests without OneUptime AI changing clusters or hosts", () => {
    expect(codeFixes).toContain(
      "To get the pull requests without OneUptime AI changing your clusters or hosts, turn fixing on, keep **Fixes** off on each Kubernetes cluster's and host's **AI agent** page (off is their default), and add no auto remediation rule",
    );
  });

  it("names every field the switches write, and says the server turns none of them on by itself", () => {
    for (const column of ALL_COLUMNS) {
      expect(codeFixes).toContain(`\`${column}\``);
    }
    expect(codeFixes).toContain(
      "The server turns none of them on or off by itself, so to turn fixing on with its pull requests, set all three in one request.",
    );
  });
});

describe("the other pages that name the switch", () => {
  it("Fix Tasks says the automatic fix pull request is part of fixing, not set independently or on by default", () => {
    const section: string = flat(
      getSection(
        read(AI_AGENT_PAGE),
        "## Automatic code fixes from investigations",
      ),
    );

    expect(section).toContain(
      "It is part of fixing: it sits under **Fix new incidents automatically** on **Incidents > AI > Settings** (and under **Fix new alerts automatically** on **Alerts > AI > Settings**), comes on when fixing is turned on, and opens pull requests only while fixing is on. Both start off, for new projects too.",
    );
    expect(section).not.toContain("set independently");
    expect(section).not.toContain("**on by default for new projects**");
  });

  it("the incident settings page puts the pull requests under fixing", () => {
    expect(flat(read(INCIDENT_SETTINGS_PAGE))).toContain(
      "fixing them automatically (off until you turn it on), with the fix and missing-telemetry pull requests that are part of fixing drawn under it, and drafting postmortems on or off",
    );
  });

  it("the Persian AI SRE page no longer calls the fix pull request switch independent", () => {
    const fa: string = flat(read(FA_AI_SRE_PAGE));

    expect(fa).not.toContain(
      "مستقل زیر **Incidents > AI > Settings** و **Alerts > AI > Settings** پیکربندی می‌شود",
    );
    expect(fa).not.toContain("به‌طور پیش‌فرض خاموش و مستقل");
    expect(fa).toContain(
      "زیر **Fix new incidents automatically** در **Incidents > AI > Settings** و زیر **Fix new alerts automatically** در **Alerts > AI > Settings** قرار دارد",
    );
  });
});
