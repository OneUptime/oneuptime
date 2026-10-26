import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  SECURITY_AI_SWITCHES,
  ProjectAiSwitchDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { DetectionRuleAiDraftCopy } from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleAiDraftCopy";
import { SECURITY_PLAYBOOK_TRIGGER_DESCRIPTIONS } from "../../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTriggerOptions";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import {
  SECURITY_CASE_MENU,
  SecurityCaseMenuItem,
  SecurityCaseMenuSection,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityCaseNavigation";
import Project from "Common/Models/DatabaseModels/Project";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import Permission from "Common/Types/Permission";
import {
  SECURITY_CASE_AI_VERDICTS,
  SecurityCaseAiVerdictDescription,
} from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityPlaybookTrigger from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";
import SecurityPlaybookRunStatus, {
  isFinishedSecurityPlaybookRunStatus,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * OneUptime AI in Security (telemetry/security-ai), held to the product it
 * describes: the card's states and buttons are the card's own words, the
 * four reads and the verdicts they suggest are the code's, in its order,
 * the switch, the trigger, Draft with AI and Ask AI's question are named as
 * the product names them, and what the page says about who may do what,
 * what is never triaged on its own and when the AI trigger runs is what
 * the code does. A change to any of them fails here until the page says so.
 *
 * The card's model (SecurityCaseAiTriage) is read as source: App cannot
 * load what imports React, and the card's words are plain string keys.
 */

const PAGE: string = "telemetry/security-ai";

const REPO_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

const LINE_BREAK: RegExp = /\n/;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;

function englishPage(): string {
  return readPage("en", PAGE);
}

function source(relative: string): string {
  return fs.readFileSync(path.join(REPO_DIR, relative), "utf8");
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

function rowsOf(heading: string): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(
    section(englishPage(), heading),
  );

  expect(found.length).toBeGreaterThan(0);

  return (found[0] as Array<Array<string>>).slice(1);
}

function boldSpans(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * A string the card's model keys, read off its source: the value of
 * `name: translationKey("...")` in SecurityCaseAiCopy, on one line or
 * wrapped onto the next.
 */
function cardWord(name: string): string {
  const model: string = flat(
    source(`${DASHBOARD}/Components/SecurityCase/SecurityCaseAiTriage.ts`),
  );
  const marker: string = `${name}: translationKey(`;
  const at: number = model.indexOf(marker);

  expect({ name, found: at >= 0 }).toEqual({ name, found: true });

  let start: number = at + marker.length;

  while (model[start] === " ") {
    start++;
  }

  expect({ name, quoted: model[start] === '"' }).toEqual({
    name,
    quoted: true,
  });

  return model.slice(start + 1, model.indexOf('"', start + 1));
}

function withoutFinalStop(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

describe("OneUptime AI in Security docs", () => {
  const page: string = englishPage();

  it("names the card's four states, and the button each offers, as the card draws them", () => {
    const rows: Array<Array<string>> = rowsOf("Triage a case");

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [...boldSpans(row[0] as string), ...boldSpans(row[1] as string)];
      }),
    ).toEqual([
      [cardWord("notTriagedTitle"), cardWord("triageButton")],
      [cardWord("triagingTitle")],
      ["Likely Malicious", cardWord("triageAgainButton")],
      [cardWord("failedTitle"), cardWord("tryAgainButton")],
    ]);
    expect(page).toContain(
      `the **${cardWord("cardTitle")}** card is at the top of its page.`,
    );
  });

  it("names what the card offers under the read as the card draws it", () => {
    for (const name of [
      "suggestedPriority",
      "setPriorityButton",
      "suggestedPlaybook",
      "runPlaybookButton",
      "askButton",
    ]) {
      expect(page).toContain(`**${cardWord(name)}**`);
    }

    expect(page).toContain("**Evidence checked**");
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/AI/InvestigationReport/InvestigationEvidenceList.tsx`,
        ),
      ),
    ).toContain("Re-run with your permissions over the same time window");
  });

  it("lists the four reads, what each means and the verdict each suggests, in the product's order", () => {
    expect(
      rowsOf("What it concludes").map((row: Array<string>): Array<string> => {
        return row.slice(0, 3);
      }),
    ).toEqual(
      SECURITY_CASE_AI_VERDICTS.map(
        (read: SecurityCaseAiVerdictDescription): Array<string> => {
          return [
            read.verdict,
            withoutFinalStop(read.description),
            read.suggestedCloseVerdict || "Nothing",
          ];
        },
      ),
    );
  });

  it("filters every case list by the read, under the filter's own title", () => {
    const table: string = flat(
      source(`${DASHBOARD}/Components/SecurityCase/SecurityCasesTable.tsx`),
    );

    expect(table).toContain(
      'aiVerdict: { field: { aiVerdict: true }, title: "AI Verdict",',
    );
    expect(page).toContain("filters by it with **AI Verdict**.");
  });

  it("turns automatic triage on where the menu has it, with the switch's own title", () => {
    const aiSection: SecurityEventsMenuSection | undefined =
      SECURITY_EVENTS_MENU.find(
        (menuSection: SecurityEventsMenuSection): boolean => {
          return menuSection.title === "AI";
        },
      );

    expect(
      (aiSection?.items || []).map(
        (item: SecurityEventsMenuItem): [string, string] => {
          return [item.title, item.page];
        },
      ),
    ).toEqual([["Settings", "SECURITY_EVENTS_SETTINGS_AI"]]);
    expect(
      SECURITY_AI_SWITCHES.map(
        (definition: ProjectAiSwitchDefinition<string>): [string, string] => {
          return [definition.column, definition.title];
        },
      ),
    ).toEqual([["enableAutomaticSecurityCaseTriage", "Triage new cases"]]);
    expect(page).toContain(
      "Open **Products → Security Events → AI → Settings** and turn on **Triage new cases**",
    );
  });

  it("says new projects start with it on, and a project created before keeps it off", () => {
    const projectService: string = source(
      "Common/Server/Services/ProjectService.ts",
    );
    const defaults: string = projectService.slice(
      projectService.indexOf("export const NEW_PROJECT_AI_DEFAULT_COLUMNS"),
    );

    expect(defaults.slice(0, defaults.indexOf("];"))).toContain(
      '"enableAutomaticSecurityCaseTriage"',
    );
    expect(
      new Project().getTableColumnMetadata("enableAutomaticSecurityCaseTriage")
        .defaultValue,
    ).toBe(false);
    expect(page).toContain(
      "New projects start with it on; a project created before keeps it off until someone turns it on.",
    );
  });

  it("says who may change the switch: the column's own update list", () => {
    expect(
      new Project().getColumnAccessControlFor(
        "enableAutomaticSecurityCaseTriage",
      )?.update,
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
    expect(page).toContain("Project Owner and Project Admin can change it.");
  });

  it("says who may start a triage: the roles that work cases, and not Security Viewer", () => {
    const working: Array<Permission> =
      new SecurityCase().getUpdatePermissions();

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
    ]) {
      expect(working).toContain(permission);
    }

    expect(working).not.toContain(Permission.SecurityViewer);
    expect(flat(source("Common/Server/API/SecurityCaseAPI.ts"))).toContain(
      "allowedPermissions: new SecurityCase().getUpdatePermissions()",
    );
    expect(page).toContain(
      "Project Owner, Project Admin, Security Admin or Security Member. Security Viewer reads every triage but cannot start one.",
    );
  });

  it("says a case opened by hand and the test attack's case are not triaged on their own", () => {
    const ingest: string = flat(
      source("Common/Server/Utils/SecurityCase/SecurityCaseIngest.ts"),
    );

    expect(ingest).toContain(
      "if (signal.isSetupTest !== true) { launches.push((): Promise<ObjectID | null> => { return SecurityCaseTriage.triageNewCase({",
    );
    expect(page).toContain(
      "A case opened by hand, and the case of the test attack from **Send a test attack**, are triaged when someone clicks **Triage with AI**.",
    );
  });

  it("names the trigger as the playbook form does, and says when it runs", () => {
    expect(SecurityPlaybookTrigger.TriagedAsLikelyMalicious).toBe(
      "Triaged as Likely Malicious",
    );
    expect(page).toContain(
      "A playbook whose **Trigger** is **Triaged as Likely Malicious** runs on a case once, when a triage reads it as Likely Malicious.",
    );
    // And the Security Cases page's trigger table says the form's sentence.
    expect(readPage("en", "telemetry/security-cases")).toContain(
      `| Triaged as Likely Malicious | ${withoutFinalStop(
        SECURITY_PLAYBOOK_TRIGGER_DESCRIPTIONS[
          SecurityPlaybookTrigger.TriagedAsLikelyMalicious
        ],
      )} |`,
    );
  });

  it("says the trigger runs once a case, never after text written to steer an AI, and on the test attack's case only inside OneUptime", () => {
    const launcher: string = flat(
      source(
        "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookLauncher.ts",
      ),
    );
    const runner: string = flat(
      source("Common/Server/Utils/AI/Security/SecurityCaseTriageRunner.ts"),
    );

    expect(launcher).toContain("private static async hasRunOnCase(");
    expect(runner).toContain(
      "data.decision.verdict === SecurityCaseAiVerdict.LikelyMalicious && !data.scan.found()",
    );
    expect(runner).toContain(
      "onlyPlaybooksThatStayInside: data.isSetupTestCase === true,",
    );
    expect(page).toContain(
      "- after a triage that found text written to steer an AI;",
    );
    expect(page).toContain(
      "- a second time on the same case, however often the case is triaged;",
    );
    expect(page).toContain(
      "- on the test attack's case, unless every step of the playbook stays inside OneUptime.",
    );
  });

  it("names Draft with AI's buttons as the form draws them, under the Sigma rule field", () => {
    const rules: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/DetectionRules.tsx`),
    );

    expect(rules).toContain('title: "Sigma Rule (YAML)"');
    expect(rules).toContain("<DetectionRuleAiDraft");
    expect(page).toContain(
      `under the **Sigma Rule (YAML)** field, click **${DetectionRuleAiDraftCopy.openButton}**`,
    );
    expect(page).toContain(`**${DetectionRuleAiDraftCopy.draftButton}**`);
    expect(page).toContain(`**${DetectionRuleAiDraftCopy.openAgainButton}**`);
  });

  it("says drafting takes the permission to create detection rules, as the route asks", () => {
    expect(flat(source("Common/Server/API/DetectionRuleAPI.ts"))).toContain(
      "CommonAPI.assertCanCreateTable({ modelType: DetectionRule, props,",
    );
    expect(page).toContain(
      "Drafting takes a role that can create detection rules.",
    );
  });

  it("names a question Ask AI offers on a case, as the chat draws it", () => {
    expect(
      flat(source(`${DASHBOARD}/Components/AIChat/PageContext.ts`)),
    ).toContain('title: "Is it real?",');
    expect(page).toContain("offers questions such as **Is it real?**.");
  });

  /*
   * A Security Viewer reads every triage but cannot start one: the card
   * greys the button that would start one, says who can beside it, and
   * offers nothing it could not do (#5175's review).
   */
  it("says what a Security Viewer's card offers, as the card draws it", () => {
    const card: string = flat(
      source(`${DASHBOARD}/Components/SecurityCase/SecurityCaseAiCard.tsx`),
    );

    // The line beside the greyed button, only for who is known not to start one.
    expect(cardWord("whoCanTriage")).toBe(
      "Someone who can edit this case can start a triage.",
    );
    expect(card).toContain(
      "if (triageAccess !== SecurityCaseAiTriageAccess.No) { return <></>; }",
    );
    expect(card).toContain("disabled={!canStart || isStarting}");
    expect(card).toContain(
      "{triageButton(SecurityCaseAiCopy.triageButton, true)} {renderWhoCanTriage()}",
    );
    expect(card).toContain(
      "{triageButton(SecurityCaseAiCopy.tryAgainButton, true)} {renderWhoCanTriage()}",
    );
    // Triage again and Set priority are offered only to who may use them.
    expect(card).toContain(
      "{blockingReason || triageAccess !== SecurityCaseAiTriageAccess.Yes ? ( <></> ) : ( triageButton(SecurityCaseAiCopy.triageAgainButton, false) )}",
    );
    expect(card).toContain("{offerPriority && updateGate.isAllowed ? (");

    expect(page).toContain(
      `A Security Viewer reads the same card: **${cardWord("triageButton")}** and **${cardWord("tryAgainButton")}** stay greyed beside a line that says who can start a triage, and **${cardWord("triageAgainButton")}** and **${cardWord("setPriorityButton")}** are not offered.`,
    );
  });

  /*
   * While the playbook OneUptime AI suggests is already running on the case,
   * the card shows that run's status where Run playbook would be: a second
   * run would ask for the same approval again (#5175's review).
   */
  it("says the suggested playbook's run shows its status in place of Run playbook while it is running", () => {
    const model: string = flat(
      source(`${DASHBOARD}/Components/SecurityCase/SecurityCaseAiTriage.ts`),
    );
    const card: string = flat(
      source(`${DASHBOARD}/Components/SecurityCase/SecurityCaseAiCard.tsx`),
    );
    const investigation: SecurityCaseMenuSection | undefined =
      SECURITY_CASE_MENU.find((section: SecurityCaseMenuSection): boolean => {
        return section.title === "Investigation";
      });

    // A run not yet finished takes Run playbook's place; a finished one, or none, leaves it.
    expect(model).toContain(
      "isFinishedSecurityPlaybookRunStatus(latestRunStatus) ) { return null; }",
    );
    expect(
      isFinishedSecurityPlaybookRunStatus(
        SecurityPlaybookRunStatus.WaitingForApproval,
      ),
    ).toBe(false);
    expect(card).toContain("{suggestedPlaybookRun ? (");
    expect(card).toContain(
      "<SecurityPlaybookRunStatusPill value={suggestedPlaybookRun}",
    );
    // The run is on the case's own Playbooks page.
    expect(
      (investigation?.items || []).map((item: SecurityCaseMenuItem): string => {
        return item.title;
      }),
    ).toContain("Playbooks");
    expect(cardWord("suggestedPlaybookRunning")).toBe(
      "This playbook is already running on this case. Its run is under the case's Playbooks.",
    );

    expect(page).toContain(
      `While that playbook is already running on the case, its run's status, such as **${SecurityPlaybookRunStatus.WaitingForApproval}**, takes the place of **${cardWord("runPlaybookButton")}**: the run is on the case's **Playbooks**, and a second one would ask for the same approval again.`,
    );
  });

  it("says one triage runs on a case at a time, as the start refuses a second", () => {
    expect(
      flat(source("Common/Server/Utils/AI/Security/SecurityCaseTriage.ts")),
    ).toContain('return { started: false, code: "already_triaging" };');
    expect(page).toContain("A case has one triage at a time");
  });
});
