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
import {
  SECURITY_CASE_AI_AREA_COPY,
  SECURITY_CASE_AI_MODE_LABELS,
  SECURITY_CASE_AI_OFF_MEANING,
  SecurityCaseAiLimitsCopy,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/SecurityCaseAiLimitsCopy";
import {
  SECURITY_CASE_AI_RESPONSE_STAGE_COPY,
  SecurityCaseAiResponseCopy,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityCase/AiResponse/SecurityCaseAiResponseCopy";
import { SecurityCaseAiResponseStage } from "../../../FeatureSet/Dashboard/src/Components/SecurityCase/AiResponse/SecurityCaseAiResponseModel";
import { UPDATES_COPY } from "../../../FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleUpdatesCopy";
import {
  SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR,
  SECURITY_CASE_AI_ALWAYS_ASKS,
  SECURITY_CASE_AI_AREAS,
  SECURITY_CASE_AI_BLOCK_DURATION,
  SECURITY_CASE_AI_DEFAULT_MODES,
  SECURITY_CASE_AI_MODE_COLUMNS,
  SECURITY_CASE_AI_QUIET_WINDOW_HOURS,
  SECURITY_CASE_HAND_OFFS_TOLD_NOBODY,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiArea,
  SecurityCaseAiMode,
  SecurityCaseHandOffReason,
} from "Common/Types/SecurityCase/SecurityCaseAi";
import { SECURITY_CASE_AI_ACTION_REASON_SENTENCES } from "Common/Types/SecurityCase/SecurityCaseAiWords";
import { SecurityBlockDuration } from "Common/Types/SecurityBlocklist/SecurityBlock";
import { NotificationRuleUpdateKind } from "Common/Types/Workspace/NotificationRules/NotificationRuleUpdates";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
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

function sectionOf(heading: string): string {
  return section(englishPage(), heading);
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
    ).toEqual([
      ["enableAutomaticSecurityCaseTriage", "Triage new cases"],
      ["enableAutomaticSecurityCaseResponse", "Work cases end to end"],
    ]);
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
  it("turns working cases on beside triage, on for new projects and off for a project created before", () => {
    const projectService: string = source(
      "Common/Server/Services/ProjectService.ts",
    );
    const defaults: string = projectService.slice(
      projectService.indexOf("export const NEW_PROJECT_AI_DEFAULT_COLUMNS"),
    );

    expect(defaults.slice(0, defaults.indexOf("];"))).toContain(
      '"enableAutomaticSecurityCaseResponse"',
    );
    expect(
      new Project().getTableColumnMetadata(
        "enableAutomaticSecurityCaseResponse",
      ).defaultValue,
    ).toBe(false);
    expect(
      new Project().getColumnAccessControlFor(
        "enableAutomaticSecurityCaseResponse",
      )?.update,
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);

    const section: string = flat(sectionOf("Work a case end to end"));

    expect(section).toContain(
      "On the same page, turn on **Work cases end to end**: OneUptime AI then takes each case its triage reads as Likely Malicious and works it, within what you allow under **What OneUptime AI may do on a case**. New projects start with it on; a project created before keeps it off until someone turns it on. Project Owner and Project Admin can change it.",
    );
    expect(SecurityCaseAiLimitsCopy.cardTitle).toBe(
      "What OneUptime AI may do on a case",
    );
  });

  it("says when Respond with AI is not offered, as the start turns it down", () => {
    const starter: string = flat(
      source(
        "Common/Server/Utils/AI/Security/Response/SecurityCaseResponse.ts",
      ),
    );

    for (const code of ["inconclusive", "steering_text", "highest_priority"]) {
      expect(starter).toContain(`return "${code}";`);
    }

    // The switch is the project's: with it off, nobody's Respond with AI starts a run.
    expect(starter).toContain(
      'if (!limits.isOn) { return "response_disabled"; }',
    );
    expect(SecurityCaseAiResponseCopy.respondButton).toBe("Respond with AI");
    expect(flat(sectionOf("Work a case end to end"))).toContain(
      "It is not offered on a case whose triage was Inconclusive, whose data reads like instructions to an AI, or that is at your highest priority: those are a person's.",
    );
  });

  it("names every row of What OneUptime AI may do on a case, and where new projects start, as the card and the columns have them", () => {
    const rows: Array<Array<string>> = rowsOf(
      "What OneUptime AI may do on a case",
    );
    const project: Project = new Project();

    expect(
      rows.map((row: Array<string>): [string, string] => {
        return [row[0] as string, row[2] as string];
      }),
    ).toEqual(
      SECURITY_CASE_AI_AREAS.map(
        (area: SecurityCaseAiArea): [string, string] => {
          return [
            `**${SECURITY_CASE_AI_AREA_COPY[area].title}**`,
            SECURITY_CASE_AI_MODE_LABELS[SECURITY_CASE_AI_DEFAULT_MODES[area]],
          ];
        },
      ),
    );

    // Each column starts where the table says.
    for (const area of SECURITY_CASE_AI_AREAS) {
      expect(
        project.getTableColumnMetadata(SECURITY_CASE_AI_MODE_COLUMNS[area])
          .defaultValue,
      ).toBe(SECURITY_CASE_AI_DEFAULT_MODES[area]);
    }
  });

  it("says what each of the three choices means, in the card's words", () => {
    const section: string = flat(
      sectionOf("What OneUptime AI may do on a case"),
    );

    expect(section).toContain(
      `- **${SECURITY_CASE_AI_MODE_LABELS[SecurityCaseAiMode.Off]}**: ${SECURITY_CASE_AI_OFF_MEANING}`,
    );
    expect(section).toContain(
      `- **${SECURITY_CASE_AI_MODE_LABELS[SecurityCaseAiMode.Ask]}**: it asks a person`,
    );
    expect(section).toContain(
      `- **${SECURITY_CASE_AI_MODE_LABELS[SecurityCaseAiMode.OnItsOwn]}**: it does it without asking`,
    );
    expect(section).toContain(
      `**${SecurityCaseAiLimitsCopy.edgeConfirmButton}** is a Security Admin's confirmation`,
    );
    // Who may change a row: the columns' own update list.
    for (const area of SECURITY_CASE_AI_AREAS) {
      expect(
        new Project().getColumnAccessControlFor(
          SECURITY_CASE_AI_MODE_COLUMNS[area],
        )?.update,
      ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
    }
  });

  it("states the limits no setting goes past, as the code sets them", () => {
    const section: string = flat(
      sectionOf("What OneUptime AI may do on a case"),
    );

    expect(SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR).toBe(10);
    expect(section).toContain(
      "takes at most 10 actions on its own an hour, across all your cases, and then hands the next case to people;",
    );
    expect(SECURITY_CASE_AI_BLOCK_DURATION).toBe(SecurityBlockDuration.OneDay);
    expect(section).toContain("- blocks for 24 hours at most;");
    expect(SECURITY_CASE_AI_ALWAYS_ASKS).toEqual([
      SecurityCaseAiActionKind.DeclareIncident,
      SecurityCaseAiActionKind.OfferRuleException,
    ]);
    expect(section).toContain(
      "- always asks before it declares an incident or adds a rule exception;",
    );
    expect(SECURITY_CASE_AI_QUIET_WINDOW_HOURS).toBe(24);
    expect(flat(sectionOf("What it does"))).toContain(
      "the case's detection has been quiet for 24 hours",
    );
  });

  it("names the card's stages and buttons as the card draws them", () => {
    const rows: Array<Array<string>> = rowsOf("Its log on the case");

    expect(
      rows.map((row: Array<string>): string => {
        return boldSpans(row[0] as string)[0] as string;
      }),
    ).toEqual(
      [
        SecurityCaseAiResponseStage.NotWorking,
        SecurityCaseAiResponseStage.Working,
        SecurityCaseAiResponseStage.WaitingForPeople,
        SecurityCaseAiResponseStage.HandedToPeople,
        SecurityCaseAiResponseStage.Finished,
      ].map((stage: SecurityCaseAiResponseStage): string => {
        return SECURITY_CASE_AI_RESPONSE_STAGE_COPY[stage].title;
      }),
    );

    const section: string = flat(sectionOf("Its log on the case"));

    for (const word of [
      SecurityCaseAiResponseCopy.sectionTitle,
      SecurityCaseAiResponseCopy.respondButton,
      SecurityCaseAiResponseCopy.takeOverButton,
      SecurityCaseAiResponseCopy.approveButton,
      SecurityCaseAiResponseCopy.declineButton,
      SecurityCaseAiResponseCopy.closingReportTitle,
    ]) {
      expect(section).toContain(`**${word}**`);
    }

    // The reasons it quotes are the log's own.
    for (const reason of [
      SecurityCaseAiActionReason.OnItsOwn,
      SecurityCaseAiActionReason.SettingAsks,
      SecurityCaseAiActionReason.NoWayToDoIt,
    ]) {
      expect(section).toContain(
        `**${SECURITY_CASE_AI_ACTION_REASON_SENTENCES[reason]}**`,
      );
    }

    expect(
      SecurityCaseAiResponseCopy.trackRecord.other
        .replace("{{held}}", "14")
        .replace("{{count}}", "15"),
    ).toBe("It held on 14 of 15 similar cases.");
    expect(section).toContain('"It held on 14 of 15 similar cases."');
  });

  it("lists every reason OneUptime AI hands a case to people, and Take Over tells nobody", () => {
    // Each reason, by the words the page gives it: a new reason fails to compile here.
    const said: Record<SecurityCaseHandOffReason, string> = {
      [SecurityCaseHandOffReason.SteeringText]:
        "some of the case's data reads like instructions to an AI",
      [SecurityCaseHandOffReason.HighestPriority]:
        "the case is at your highest priority",
      [SecurityCaseHandOffReason.ProtectedTarget]:
        "what its next step acts on is protected",
      [SecurityCaseHandOffReason.BreakerTripped]:
        "it has acted on its own as often as it may in an hour",
      [SecurityCaseHandOffReason.AiOff]:
        "AI is off for the project or for security cases",
      [SecurityCaseHandOffReason.NoLlmProvider]: "there is no LLM provider",
      [SecurityCaseHandOffReason.OutOfCredits]:
        "the project is out of AI credits or reached its daily AI limit",
      [SecurityCaseHandOffReason.NotLikelyMalicious]:
        "its triage could not tell whether the case is real",
      [SecurityCaseHandOffReason.DidNotHold]: "a step it took does not hold",
      [SecurityCaseHandOffReason.StepFailed]:
        "a step it started did not finish",
      [SecurityCaseHandOffReason.Declined]:
        "a person turned down or undid a step it took",
      [SecurityCaseHandOffReason.CannotTell]: "it cannot tell what to do next",
      [SecurityCaseHandOffReason.OnlyPeopleCanDo]:
        "everything left on the case is a person's to do",
      [SecurityCaseHandOffReason.TakenOver]:
        "**Take Over** hands the case over without telling anyone",
    };
    const section: string = flat(sectionOf("When it hands a case to people"));

    for (const words of Object.values(said)) {
      expect(section).toContain(words);
    }

    expect(SECURITY_CASE_HAND_OFFS_TOLD_NOBODY).toEqual([
      SecurityCaseHandOffReason.TakenOver,
    ]);
  });

  it("names where people hear of a hand-off as their settings and the workspace rules name it", () => {
    const settings: string = flat(
      source(`${DASHBOARD}/Pages/UserSettings/NotificationSettings.tsx`),
    );
    const section: string = flat(sectionOf("When it hands a case to people"));

    expect(settings).toContain(
      'label: "OneUptime AI handed a security case to people",',
    );
    expect(section).toContain(
      "**OneUptime AI handed a security case to people**, under **User Settings → Notification Settings**",
    );
    expect(
      UPDATES_COPY[NotificationRuleEventType.SecurityCase].kinds[
        NotificationRuleUpdateKind.AI
      ]?.title,
    ).toBe("Handed to people by OneUptime AI");
    expect(section).toContain("under **Handed to people by OneUptime AI**.");
  });

  it("names the Overview's figures as the Overview draws them", () => {
    const bar: string = flat(
      source(
        `${DASHBOARD}/Components/SecurityOverview/SecurityAiOverviewBar.tsx`,
      ),
    );
    const section: string = flat(sectionOf("How it is measured"));

    for (const label of [
      "Resolved by OneUptime AI",
      "Time to Contain with AI",
      "Time to Close with AI",
      "Approvals Asked",
    ]) {
      expect(bar).toContain(`translator.translateText("${label}")`);
      expect(section).toContain(`**${label}**`);
    }
  });
});
