import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  SECURITY_CASE_QUEUE_VIEWS,
  SecurityCaseQueueView,
  getSecurityCaseQueueQuery,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";
import {
  ASSIGN_TO_ME,
  ASSIGN_TO_SOMEONE_ELSE,
  CHANGE_PRIORITY,
  CHANGE_STATUS,
  doesStatusCloseSecurityCase,
  getSecurityCaseAssignWrite,
  isAssignToMeOffered,
  isAssignToSomeoneElseOffered,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseChanges";
import { SECURITY_PLAYBOOK_RUN_VIEWS } from "../../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunViews";
import { UNDO_BUTTON_TITLES } from "../../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunStepRows";
import { CREATE_FROM_TEMPLATE } from "../../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplateModel";
import {
  ATTACK_COVERAGE_VIEW_LABELS,
  AttackCoverageView,
  TACTIC_LIBRARY_COUNT,
  readAttackCoverageView,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/AttackCoverageCopy";
import {
  ENTITY_LOOKUP_HOURS,
  ENTITY_LOOKUP_TITLE,
  ENTITY_RISK_TABLE_TITLE,
  OPEN_IN_CORRELATE,
  RISKIEST_ENTITIES_TITLE,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import { SECURITY_OVERVIEW_RISKIEST_ENTITY_LIMIT } from "Common/Types/SecurityCase/SecurityEntityRisk";
import { ARCHIVABLE_VALUE_COPY } from "../../../FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivableValueCopy";
import {
  STATE_SETTINGS_COPY,
  StateSettingsPageCopy,
} from "../../../FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsCopy";
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
import PageMap from "../../../FeatureSet/Dashboard/src/Utils/PageMap";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseNote from "Common/Models/DatabaseModels/SecurityCaseNote";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import SecurityCaseTask from "Common/Models/DatabaseModels/SecurityCaseTask";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import SecurityProtectedEntity from "Common/Models/DatabaseModels/SecurityProtectedEntity";
import {
  RESPONSE_TARGETS_COPY,
  RESPONSE_TARGET_DURATION_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/ResponseTargetsCopy";
import { SECURITY_CASE_TASKS_COPY } from "../../../FeatureSet/Dashboard/src/Components/SecurityCase/Tasks/SecurityCaseTasksCopy";
import { SECURITY_CASE_EVIDENCE_COPY } from "../../../FeatureSet/Dashboard/src/Components/SecurityCase/Evidence/SecurityCaseEvidenceCopy";
import {
  MAX_SECURITY_CASE_TARGET_IN_MINUTES,
  SECURITY_CASE_TARGET_AT_RISK_FRACTION,
  describeTargetDuration,
} from "Common/Utils/SecurityCase/SecurityCaseTargets";
import {
  SECURITY_OVERVIEW_CASE_WINDOW_IN_DAYS,
  SECURITY_OVERVIEW_DETECTION_WINDOW_IN_DAYS,
} from "Common/Server/API/SecurityCaseAPI";
import {
  SECURITY_PLAYBOOK_STALE_QUEUED_MS,
  SECURITY_PLAYBOOK_STALE_RUNNING_MS,
} from "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import { CONTAINMENT_ENTITY_LIMIT } from "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import { MAX_EVIDENCE_DETECTIONS } from "Common/Server/Utils/SecurityPlaybook/SecurityCaseEvidence";
import {
  GOOGLE_WORKSPACE_DIRECTORY_SECURITY_SCOPE,
  GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE,
} from "Common/Server/Utils/SecurityEvent/Response/GoogleWorkspaceResponseClient";
import {
  SecurityPlaybookStepOutcome,
  describeSecurityPlaybookStepOutcome,
  getSecurityPlaybookStepOutcomes,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import { SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS } from "Common/Types/SecurityPlaybook/SecurityPlaybookTemplates";
import { MAX_NOTIFIED_DATA_STORES } from "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookDataStoreOwners";
import Permission from "Common/Types/Permission";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
  securityCasePriorityLevelFromSeverity,
} from "Common/Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage, {
  SECURITY_CASE_STAGE_FLAGS,
} from "Common/Types/SecurityCase/SecurityCaseStage";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueProtection,
  ArchivableValueType,
} from "Common/Utils/ArchivableValues";
import SecurityCasePriorities, {
  DEFAULT_SECURITY_CASE_PRIORITIES,
  DefaultSecurityCasePriority,
} from "Common/Utils/SecurityCase/SecurityCasePriorities";
import {
  DEFAULT_SECURITY_CASE_STATUSES,
  DefaultSecurityCaseStatus,
} from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import { STATE_LISTS, StateListType } from "Common/Utils/StateOrder";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testStatusId,
} from "Common/Tests/Helpers/SecurityCaseValues";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_CASE_VERDICTS,
  SecurityCaseVerdictDescription,
} from "Common/Types/SecurityCase/SecurityCaseVerdict";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionCategory,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookUndoAction,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SECURITY_PLAYBOOK_MAX_STEPS,
  SecurityPlaybookStep,
  TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import { matchesProtectedEntityPattern } from "Common/Types/SecurityPlaybook/SecurityProtectedEntity";
import { SECURITY_PLAYBOOK_TRIGGERS } from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { SECURITY_CASE_TEMPLATE_PLACEHOLDERS } from "Common/Utils/SecurityCase/SecurityCaseMarkdown";
import { SECURITY_CASE_NOTIFICATION_EVENT_TYPES } from "Common/Server/Services/UserNotificationSettingService";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import {
  SECURITY_CASE_NOTIFICATION_CHOICE_TEMPLATES,
  SecurityCaseNotificationPriorityChoice,
  describeSecurityCaseNotificationChoice,
  getDefaultSecurityCaseNotificationMinimum,
  getSecurityCaseNotificationPriorityChoices,
} from "Common/Utils/SecurityCase/SecurityCaseNotificationPriority";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import { NotificationRuleConditionUtil } from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Security Cases and Playbooks page, held to the product it describes:
 * the statuses, verdicts, triggers, steps and placeholders it lists are the
 * code's own, in the code's order; the numbers it gives - the step limit, the
 * containment limit, the overview's windows, the recovery times - are the
 * code's constants; and what it says each role may do is what the models
 * allow. A change to any of them fails here until the page says so too.
 *
 * A case's priorities and statuses are the project's own (Security Events >
 * Settings): the page lists a new project's, as DEFAULT_SECURITY_CASE_
 * PRIORITIES and DEFAULT_SECURITY_CASE_STATUSES name them, and says what the
 * built-in ones do as the settings pages and the archive rules say it.
 */

const PAGE: string = "telemetry/security-cases";

const REPO_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

const LINE_BREAK: RegExp = /\n/;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const INLINE_CODE: RegExp = /`([^`]+)`/g;
const MINUTE_IN_MS: number = 60 * 1000;

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

function rowsOf(heading: string, which: number = 0): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(
    section(englishPage(), heading),
  );

  expect(found.length).toBeGreaterThan(which);

  return (found[which] as Array<Array<string>>).slice(1);
}

function column(rows: Array<Array<string>>, index: number): Array<string> {
  return rows.map((row: Array<string>): string => {
    return row[index] as string;
  });
}

function boldSpans(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function codeSpans(text: string): Array<string> {
  return Array.from(text.matchAll(INLINE_CODE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// "Critical, High, Medium, Low and Informational", as a sentence lists them.
function sentenceList(items: Array<string>): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// A new project's priority of a level, by its name.
function priorityNameOf(level: SecurityCasePriorityLevel): string {
  return DEFAULT_SECURITY_CASE_PRIORITIES.find(
    (priority: DefaultSecurityCasePriority): boolean => {
      return priority.level === level;
    },
  )!.name;
}

describe("Security Cases and Playbooks docs", () => {
  const page: string = englishPage();

  it("opens the queue where the menu puts it, with the queue's other pages beside it", () => {
    expect(page).toContain(
      "Open **Products → Security Events → Security Cases → Open Cases** for the queue. **Assigned to Me**, **Unassigned**, **Closed Cases** and **All Cases** are pages of their own beside it, each listing the cases its name says.",
    );
    expect(
      SECURITY_CASE_QUEUE_VIEWS.map((view: { title: string }): string => {
        return view.title;
      }),
    ).toEqual([
      "Open Cases",
      "Assigned to Me",
      "Unassigned",
      "Closed Cases",
      "All Cases",
    ]);
    expect(source(`${DASHBOARD}/Utils/SecurityEventsNavigation.ts`)).toContain(
      'title: "Security Cases",',
    );
    expect(page).not.toContain("are the other views");
  });

  it("names the runs held for a decision as the page that lists them, and every run", () => {
    expect(
      SECURITY_PLAYBOOK_RUN_VIEWS.map((view: { title: string }): string => {
        return view.title;
      }),
    ).toEqual(["Approvals", "Playbook Runs"]);
    expect(page).toContain(
      "**Approvals**, under **Playbooks** in the menu, lists the runs held for a decision and counts them; **Playbook Runs** lists every run.",
    );
    expect(page).toContain(
      "under **Products → Security Events → Playbooks → Playbook Runs**, step by step:",
    );
  });

  it("says each of the overview's counts opens the page that lists them", () => {
    expect(section(page, "The overview")).toContain(
      "- The open cases assigned to you, the open cases nobody has picked up, and the playbook steps waiting for approval, each opening the page that lists them.",
    );
  });

  it("says what each Security role may do with cases and playbooks, as the models allow", () => {
    const roleRows: Array<Array<string>> = rowsOf("Before you begin");
    const memberCan: (permissions: Array<Permission>) => boolean = (
      permissions: Array<Permission>,
    ): boolean => {
      return permissions.includes(Permission.SecurityMember);
    };

    expect(column(roleRows, 0)).toEqual([
      "Security Admin",
      "Security Member",
      "Security Viewer",
    ]);

    // Members work cases, notes and runs - and approve steps - but neither set up playbooks nor delete cases.
    expect(memberCan(new SecurityCase().getCreatePermissions())).toBe(true);
    expect(memberCan(new SecurityCase().getUpdatePermissions())).toBe(true);
    expect(memberCan(new SecurityCase().getDeletePermissions())).toBe(false);
    expect(memberCan(new SecurityCaseNote().getCreatePermissions())).toBe(true);
    expect(memberCan(new SecurityPlaybookRun().getCreatePermissions())).toBe(
      true,
    );
    expect(memberCan(new SecurityPlaybookRun().getUpdatePermissions())).toBe(
      true,
    );
    expect(memberCan(new SecurityPlaybook().getCreatePermissions())).toBe(
      false,
    );
    // Members work tasks and add evidence; removing evidence is the Admin's.
    expect(memberCan(new SecurityCaseTask().getCreatePermissions())).toBe(true);
    expect(memberCan(new SecurityCaseTask().getUpdatePermissions())).toBe(true);
    expect(memberCan(new SecurityCaseEvidence().getCreatePermissions())).toBe(
      true,
    );
    expect(memberCan(new SecurityCaseEvidence().getDeletePermissions())).toBe(
      false,
    );
    expect(new SecurityCaseEvidence().getDeletePermissions()).toContain(
      Permission.SecurityAdmin,
    );
    for (const model of [new SecurityCaseTask(), new SecurityCaseEvidence()]) {
      expect(model.getReadPermissions()).toContain(Permission.SecurityViewer);
    }
    expect(flat(section(page, "Before you begin"))).toContain(
      "| Security Member | Open, assign, change and close cases, write notes, work tasks, add evidence, run playbooks and approve or reject their steps |",
    );
    expect(new SecurityCase().getDeletePermissions()).toContain(
      Permission.SecurityAdmin,
    );
    expect(new SecurityCase().getReadPermissions()).toContain(
      Permission.SecurityViewer,
    );
    expect(new SecurityPlaybookRun().getCreatePermissions()).toContain(
      Permission.CreateSecurityPlaybookRun,
    );
    expect(new SecurityPlaybookRun().getUpdatePermissions()).toContain(
      Permission.EditSecurityPlaybookRun,
    );
  });

  it("names the switches that open cases as the forms title them", () => {
    const sourceRows: Array<Array<string>> = rowsOf("Where cases come from");

    expect(column(sourceRows, 0)).toEqual([
      "Detection rules",
      "Threat intelligence",
      "Connected products",
      "Entity risk",
      "People",
    ]);

    const rules: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/DetectionRules.tsx`),
    );
    const feeds: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/ThreatIntel.tsx`),
    );
    const connections: string = flat(
      source(
        `${DASHBOARD}/Components/SecurityEvents/SecurityEventConnectionFormModal.tsx`,
      ),
    );

    /*
     * Both draw the shared On Match step (SecurityMatchActionFields), whose
     * first switch opens cases.
     */
    const onMatch: string = flat(
      source(
        `${DASHBOARD}/Components/SecurityEvents/SecurityMatchActionFields.ts`,
      ),
    );

    expect(onMatch).toContain(
      'title: "Open a Case on Match", stepId: "on-match",',
    );

    for (const form of [rules, feeds]) {
      expect(form).toContain('{ title: "On Match", id: "on-match" }');
      expect(form).toContain("...getSecurityMatchActionFields<");
    }

    for (const row of sourceRows.slice(0, 2)) {
      expect(row[2]).toMatch(
        /^\*\*Open a Case on Match\*\*, on the (rule|feed)'s \*\*On Match\*\* step$/,
      );
    }

    // Entity risk opens cases from Settings > Risk Scoring's one switch.
    const riskCopy: string = flat(
      source(
        `${DASHBOARD}/Components/SecurityEvents/EntityRisk/EntityRiskCopy.ts`,
      ),
    );

    expect(riskCopy).toContain(
      'export const RISK_CASES_CARD_TITLE: string = translationKey("Risk Cases");',
    );
    expect(sourceRows[3]?.[2]).toBe(
      "**Risk Cases**, under **Settings → Risk Scoring**",
    );

    expect(connections).toContain('title: "Open Cases From",');
    expect(connections).toContain(
      'initialValues["caseMinimumSeverity"] = "High";',
    );
    expect(connections).toContain('High: translationKey("High and above"),');
    expect(page).toContain(
      "A connection opens cases for **High and above** unless you choose another level",
    );
  });

  it("maps severity to priority as a detection opening a case does", () => {
    for (const row of rowsOf("How detections are grouped")) {
      const severities: Array<string> = (row[0] as string)
        .split(/, | or /)
        .map((part: string): string => {
          return part.trim();
        });

      // The built-in priority of the severity's level, as a new project names it.
      for (const severity of severities) {
        expect([
          severity,
          priorityNameOf(securityCasePriorityLevelFromSeverity(severity)),
        ]).toEqual([severity, row[1]]);
      }
    }

    expect(page).toContain(
      "A case's priority comes from the detection's severity, at the project's built-in priority for that level, whatever you have named it:",
    );

    // Every OCSF severity is on the table.
    const listed: string = column(rowsOf("How detections are grouped"), 0).join(
      " ",
    );

    for (const severity of Object.values(OcsfSeverity)) {
      expect(listed).toContain(severity);
    }
  });

  it("lists a new project's case statuses, and the verdicts, as the case knows them", () => {
    const statusRows: Array<Array<string>> = rowsOf("Work a case");

    expect(column(statusRows, 0)).toEqual(
      DEFAULT_SECURITY_CASE_STATUSES.map(
        (status: DefaultSecurityCaseStatus): string => {
          return status.name;
        },
      ),
    );

    statusRows.forEach((row: Array<string>, index: number): void => {
      // The status's own description, without its full stop.
      expect(`${row[1]}.`).toBe(
        DEFAULT_SECURITY_CASE_STATUSES[index]!.description,
      );
    });

    expect(section(page, "Work a case")).toContain(
      "A new project's cases move through four statuses, which you can rename and add to (see [Case priorities and statuses](#case-priorities-and-statuses)).",
    );

    const verdictRows: Array<Array<string>> = rowsOf("Close a case");

    expect(column(verdictRows, 0)).toEqual(
      SECURITY_CASE_VERDICTS.map(
        (item: SecurityCaseVerdictDescription): string => {
          return item.verdict;
        },
      ),
    );

    verdictRows.forEach((row: Array<string>, index: number): void => {
      // The dialog's own description, without its full stop.
      expect(`${row[1]}.`).toBe(SECURITY_CASE_VERDICTS[index]!.description);
    });
  });

  it("lists a case's pages as its side menu has them, in its order, Advanced folded", () => {
    const sectionState: string = source(
      "Common/UI/Components/SideMenu/SideMenuSectionState.ts",
    );
    const foldedTitlesStart: number = sectionState.indexOf(
      "export const SECTION_TITLES_COLLAPSED_BY_DEFAULT",
    );
    const foldedTitles: string = sectionState.slice(
      foldedTitlesStart,
      sectionState.indexOf("];", foldedTitlesStart),
    );

    expect(foldedTitlesStart).toBeGreaterThan(0);
    expect(section(page, "Work a case")).toContain(
      "A case has a side menu of its own, as an incident has, and each part of the case is a page of its own:",
    );
    expect(page).toContain("| Side menu section | Pages |");
    expect(rowsOf("Work a case", 1)).toEqual(
      SECURITY_CASE_MENU.map(
        (menuSection: SecurityCaseMenuSection): Array<string> => {
          const pages: string = menuSection.items
            .map((item: SecurityCaseMenuItem): string => {
              return `**${item.title}**`;
            })
            .join(", ");

          // A section titled to fold (SideMenuSectionState) starts folded.
          return [
            `**${menuSection.title}**`,
            foldedTitles.includes(`"${menuSection.title}",`)
              ? `${pages}, folded until you click **${menuSection.title}**`
              : pages,
          ];
        },
      ),
    );

    // Each page is described, in the menu's order.
    const described: Array<string> = flat(section(page, "Work a case"))
      .split(" - **")
      .slice(1)
      .map((item: string): string => {
        return item.slice(0, item.indexOf("**"));
      })
      // The Overview's own cards, described beside it: not pages of the menu.
      .filter((title: string): boolean => {
        return (
          title !== "OneUptime AI" &&
          title !== "Impact" &&
          title !== "MITRE ATT&CK"
        );
      });

    expect(described).toEqual(
      SECURITY_CASE_MENU.flatMap(
        (menuSection: SecurityCaseMenuSection): Array<string> => {
          return menuSection.items.map((item: SecurityCaseMenuItem): string => {
            return item.title;
          });
        },
      ),
    );
  });

  it("says what the case's header keeps on every page, and where a link to the case lands", () => {
    const header: string = flat(
      source(`${DASHBOARD}/Components/SecurityCase/SecurityCaseHeader.tsx`),
    );

    for (const action of [
      "Assign to Me",
      "Run Playbook",
      "Declare Incident",
      "Close Case",
    ]) {
      expect(header).toContain(`title: "${action}",`);
    }
    expect(header).toContain(
      '<MoreMenuSection key="priority" title="Set priority">',
    );
    // The ⋯'s items, in the menu's order after its priority section.
    const more: Array<string> = [
      'text="Assign to Someone Else"',
      'text="Change Status"',
      'text="Edit Case"',
      'text="Delete Case"',
    ];

    for (const item of more) {
      expect(header).toContain(item);
    }
    expect(
      more.map((item: string): number => {
        return header.indexOf(item);
      }),
    ).toEqual(
      [...more]
        .map((item: string): number => {
          return header.indexOf(item);
        })
        .sort((a: number, b: number): number => {
          return a - b;
        }),
    );
    expect(flat(section(page, "Work a case"))).toContain(
      "Every page keeps the case's header on top: its number, priority, status and title, **Assign to Me**, **Run Playbook**, **Declare Incident** and **Close Case**, and in the ⋯ menu beside them **Set priority**, **Assign to Someone Else**, **Change Status**, **Edit Case** and **Delete Case**. So the case can be worked from any of its pages, and a link to the case still opens its **Overview**.",
    );

    // The case's own address is its Overview, the first entry of its menu.
    expect(SECURITY_CASE_MENU[0]?.items[0]).toEqual(
      expect.objectContaining({
        page: PageMap.SECURITY_CASE_VIEW,
        title: "Overview",
      }),
    );
    expect(source(`${DASHBOARD}/Utils/RouteMap.ts`)).toContain(
      "[PageMap.SECURITY_CASE_VIEW]: `cases/${RouteParams.ModelID}`,",
    );
  });

  it("says how a case is worked from the queue's lists, as their rows and Bulk Actions offer it", () => {
    const queue: string = flat(section(page, "Work cases from the queue"));
    const statuses: ReturnType<typeof buildDefaultTestStatuses> =
      buildDefaultTestStatuses();
    const openCase: SecurityCase = new SecurityCase();
    openCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
    const closedCase: SecurityCase = new SecurityCase();
    closedCase.securityCaseStatusId = testStatusId(SecurityCaseStage.Closed);
    const someone: string = "80000000-0000-4000-8000-000000000001";
    const team: string = "81000000-0000-4000-8000-000000000001";

    // The row's ⋯ moves, by the names the Dashboard draws, in its order.
    expect(queue).toContain(
      `the ⋯ menu on a case's row has **${ASSIGN_TO_ME}**, **${ASSIGN_TO_SOMEONE_ELSE}**, **${CHANGE_STATUS}** and **${CHANGE_PRIORITY}**.`,
    );
    // The bulk bar's own button.
    expect(
      source("Common/UI/Components/BulkUpdate/BulkUpdateForm.tsx"),
    ).toContain('tx("Bulk Actions")');
    expect(queue).toContain(
      "select them and use the same actions under **Bulk Actions**: it says which cases it changed, and which it left as they were, and why.",
    );

    // A person, or a team whose case waits under Unassigned.
    expect(queue).toContain(
      `use **${ASSIGN_TO_SOMEONE_ELSE}** and pick one person, or a team. A team's case waits under **Unassigned** until someone on the team takes it.`,
    );
    expect(getSecurityCaseAssignWrite({ teamId: team })).toEqual({
      assignedToTeamId: team,
      assignedToUserId: null,
    });
    const unassigned: SecurityCaseQueueView | undefined =
      SECURITY_CASE_QUEUE_VIEWS.find((view: SecurityCaseQueueView): boolean => {
        return view.key === "unassigned";
      });
    expect(unassigned?.title).toBe("Unassigned");
    expect(
      getSecurityCaseQueueQuery("unassigned", new ObjectID(someone), statuses)[
        "assignedToUserId"
      ],
    ).toBeInstanceOf(IsNull);

    // Closing asks what Close Case asks.
    expect(queue).toContain(
      "A status that closes a case asks for a verdict and a closing note, as **Close Case** does.",
    );
    expect(
      doesStatusCloseSecurityCase({
        securityCase: openCase,
        statusId: testStatusId(SecurityCaseStage.Closed).toString(),
        statuses: statuses,
      }),
    ).toBe(true);

    // Nobody takes a closed case: it is reopened first.
    expect(queue).toContain(
      `A closed case is not assigned to anyone. To work it again, reopen it with **${CHANGE_STATUS}**.`,
    );
    expect(
      isAssignToMeOffered({
        securityCase: closedCase,
        statuses: statuses,
        myUserId: someone,
      }),
    ).toBe(false);
    expect(
      isAssignToSomeoneElseOffered({
        securityCase: closedCase,
        statuses: statuses,
      }),
    ).toBe(false);
    expect(
      SECURITY_CASE_QUEUE_VIEWS.find((view: SecurityCaseQueueView): boolean => {
        return view.key === "closed";
      })?.canAssignToSomeoneElse,
    ).toBe(false);
  });

  it("says the menu counts the runs waiting for an approval, and what deleting a case takes with it", () => {
    const playbookRuns: SecurityCaseMenuItem | undefined =
      SECURITY_CASE_MENU.flatMap(
        (menuSection: SecurityCaseMenuSection): Array<SecurityCaseMenuItem> => {
          return menuSection.items;
        },
      ).find((item: SecurityCaseMenuItem): boolean => {
        return item.title === "Playbooks";
      });

    expect(playbookRuns?.badge).toBe("runsWaitingForApproval");
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityCase/SecurityCaseMenuBadgeCount.ts`,
        ),
      ),
    ).toContain('getSecurityPlaybookRunView("waiting").query');
    expect(page).toContain(
      "While runs wait, the menu shows how many beside **Playbooks**.",
    );

    expect(
      flat(source(`${DASHBOARD}/Pages/SecurityEvents/CaseView/Delete.tsx`)),
    ).toContain(
      "{{case}} and its detections, notes, timeline and playbook runs are deleted for good. To keep the record, close it with a verdict instead.",
    );
    expect(page).toContain(
      "- **Delete Case**: deletes the case and its detections, notes, timeline and playbook runs for good. To keep the record, close it with a verdict instead.",
    );
  });

  it("opens the case priorities and statuses where the menu puts them, folded under Settings", () => {
    const settings: SecurityEventsMenuSection | undefined =
      SECURITY_EVENTS_MENU.find((menu: SecurityEventsMenuSection): boolean => {
        return menu.title === "Settings";
      });

    expect(
      settings?.items.map((item: SecurityEventsMenuItem): string => {
        return item.title;
      }),
    ).toEqual([
      STATE_SETTINGS_COPY[StateListType.SecurityCasePriority].title,
      // How fast a case at each priority must be worked, beside the priorities.
      RESPONSE_TARGETS_COPY.title,
      STATE_SETTINGS_COPY[StateListType.SecurityCaseStatus].title,
      // When an entity's risk opens a case (Entity Risk's docs page).
      "Risk Scoring",
    ]);
    expect(settings?.startsCollapsed).toBe(true);
    expect(flat(section(page, "Case priorities and statuses"))).toContain(
      "Each project keeps its own case priorities and statuses, under **Products → Security Events → Settings → Case Priorities** and **Case Statuses**.",
    );
  });

  it("gives a new project's response targets as its priorities start with them, and where they are set", () => {
    const targets: string = flat(section(page, "Response targets"));
    const rows: Array<Array<string>> = rowsOf("Response targets");

    expect(targets).toContain(
      `A response target is how fast a case must be worked: **${RESPONSE_TARGETS_COPY.acknowledgeColumn}**, how long a new case may wait for someone to take it on, and **${RESPONSE_TARGETS_COPY.containColumn}**, how long it may take to be contained or closed.`,
    );
    // Where the menu puts the page, under the title it draws.
    expect(targets).toContain(
      `Each case priority has its own, under **Products → Security Events → Settings → ${RESPONSE_TARGETS_COPY.title}**`,
    );
    // The duration field's units, and the longest target it keeps: a year.
    expect(
      [
        RESPONSE_TARGET_DURATION_COPY.minutes,
        RESPONSE_TARGET_DURATION_COPY.hours,
        RESPONSE_TARGET_DURATION_COPY.days,
      ].map((unit: string): string => {
        return unit.toLowerCase();
      }),
    ).toEqual(["minutes", "hours", "days"]);
    expect(targets).toContain("in minutes, hours or days, up to a year");
    expect(MAX_SECURITY_CASE_TARGET_IN_MINUTES).toBe(365 * 24 * 60);

    // A new project's priorities, with the targets they start with.
    expect(rows).toEqual(
      DEFAULT_SECURITY_CASE_PRIORITIES.map(
        (priority: DefaultSecurityCasePriority): Array<string> => {
          return [
            priority.name,
            priority.acknowledgeWithinInMinutes === null
              ? RESPONSE_TARGETS_COPY.noTarget
              : describeTargetDuration(priority.acknowledgeWithinInMinutes),
            priority.containWithinInMinutes === null
              ? RESPONSE_TARGETS_COPY.noTarget
              : describeTargetDuration(priority.containWithinInMinutes),
          ];
        },
      ),
    );

    // At risk in the last fifth of a target.
    expect(SECURITY_CASE_TARGET_AT_RISK_FRACTION).toBe(0.2);
    expect(targets).toContain(
      "In the last fifth of a target, the case is about to miss it",
    );
    // The lists' column, by its title.
    expect(targets).toContain(
      `a **${RESPONSE_TARGETS_COPY.dueColumn}** column you can turn on and sort by`,
    );
  });

  it("names the Evidence and Tasks pages' buttons as they draw them, and what the menu counts", () => {
    const work: string = flat(section(page, "Work a case"));

    expect(SECURITY_CASE_EVIDENCE_COPY.title).toBe("Evidence");
    expect(work).toContain(
      `**${SECURITY_CASE_EVIDENCE_COPY.addFile}** uploads a file of up to 10 MB`,
    );
    expect(work).toContain(
      `**${SECURITY_CASE_EVIDENCE_COPY.addLink}** points to evidence kept somewhere else`,
    );
    expect(SECURITY_CASE_TASKS_COPY.title).toBe("Tasks");
    expect(
      SECURITY_CASE_MENU.flatMap(
        (menuSection: SecurityCaseMenuSection): Array<SecurityCaseMenuItem> => {
          return menuSection.items;
        },
      ).find((item: SecurityCaseMenuItem): boolean => {
        return item.title === SECURITY_CASE_TASKS_COPY.title;
      })?.badge,
    ).toBe("openTasks");
    expect(work).toContain(
      "the menu shows how many tasks are open beside **Tasks**.",
    );
    expect(flat(section(page, "Close a case"))).toContain(
      "While tasks on the case are still open, **Close Case** says how many.",
    );
  });

  it("says what each built-in status and priority does, and that they keep their order", () => {
    const builtInRows: Array<Array<string>> = rowsOf(
      "Case priorities and statuses",
    );
    const statuses: Record<string, string> = {
      "The new status": SECURITY_CASE_STAGE_FLAGS.New,
      "The acknowledged status": SECURITY_CASE_STAGE_FLAGS.Acknowledged,
      "The contained status": SECURITY_CASE_STAGE_FLAGS.Contained,
      "The closed status": SECURITY_CASE_STAGE_FLAGS.Closed,
    };
    const priorityRow: string = `The ${sentenceList(
      DEFAULT_SECURITY_CASE_PRIORITIES.map(
        (priority: DefaultSecurityCasePriority): string => {
          return priority.name;
        },
      ),
    )} priorities`;

    expect(column(builtInRows, 0)).toEqual([
      ...Object.keys(statuses),
      priorityRow,
    ]);

    // Every built-in flag is one the lists keep in order, and the archive refuses.
    for (const [type, listType, flags] of [
      [
        ArchivableValueType.SecurityCaseStatus,
        StateListType.SecurityCaseStatus,
        Object.values(statuses),
      ],
      [
        ArchivableValueType.SecurityCasePriority,
        StateListType.SecurityCasePriority,
        Object.values(SECURITY_CASE_PRIORITY_LEVEL_FLAGS),
      ],
    ] as Array<[ArchivableValueType, StateListType, Array<string>]>) {
      expect(STATE_LISTS[listType].keepsBuiltInOrder).toBe(true);
      expect(
        ARCHIVABLE_VALUES[type].protections
          .map((protection: ArchivableValueProtection): string => {
            return protection.column;
          })
          .sort(),
      ).toEqual([...flags].sort());
    }

    // A case someone opens starts at the medium priority.
    expect(
      (
        SecurityCasePriorities.getDefaultPriority(
          buildDefaultTestPriorities(),
        ) as SecurityCasePriority
      ).name,
    ).toBe(priorityNameOf(SecurityCasePriorityLevel.Medium));
    expect(builtInRows[4]![1]).toContain(
      `a case someone opens starts at ${priorityNameOf(SecurityCasePriorityLevel.Medium)}`,
    );
    expect(page).toContain(
      "They can be renamed and recolored, but not deleted or archived, and they keep their order:",
    );
  });

  it("says where a value you add goes, and names the settings pages' columns and archive as they draw them", () => {
    const text: string = flat(section(page, "Case priorities and statuses"));
    const statusCopy: StateSettingsPageCopy =
      STATE_SETTINGS_COPY[StateListType.SecurityCaseStatus];
    const priorityCopy: StateSettingsPageCopy =
      STATE_SETTINGS_COPY[StateListType.SecurityCasePriority];

    // A status goes just above the closed one; a priority to the end.
    expect(STATE_LISTS[StateListType.SecurityCaseStatus].insertAboveFlag).toBe(
      SECURITY_CASE_STAGE_FLAGS.Closed,
    );
    expect(
      STATE_LISTS[StateListType.SecurityCasePriority].insertAboveFlag,
    ).toBeUndefined();
    expect(text).toContain(
      "A status you add goes just above the closed status",
    );
    expect(text).toContain("A priority you add goes to the end");

    expect(statusCopy.countsAs?.title).toBe("Counts as");
    expect(text).toContain("as the **Counts as** column shows");
    expect(priorityCopy.builtInColumn?.title).toBe("Detection severity");
    expect(text).toContain(
      "the **Detection severity** column shows which detections",
    );

    expect(
      ARCHIVABLE_VALUE_COPY[ArchivableValueType.SecurityCaseStatus]
        .archivedTitle,
    ).toBe("Archived Case Statuses");
    expect(
      ARCHIVABLE_VALUE_COPY[ArchivableValueType.SecurityCasePriority]
        .archivedTitle,
    ).toBe("Archived Case Priorities");
    expect(text).toContain(
      "Archived values are listed in the folded **Archived Case Statuses** or **Archived Case Priorities** section under the table, where **Unarchive** puts one back.",
    );
    expect(text).toContain(
      "**Delete** is refused while cases have the value or a playbook runs from the priority.",
    );
  });

  it("says how far back a case's entities' activity goes", () => {
    // Read as text: the pages are React, and hold the numbers as constants.
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityCase/SecurityCaseEntitiesCard.tsx`,
        ),
      ),
    ).toContain("export const ENTITY_ACTIVITY_HOURS: number = 24 * 7;");
    expect(page).toContain(
      "with their activity across all your security events in the last 7 days",
    );
    // A lookup reads 30 days, and the page says so.
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityEvents/EntityRisk/EntityRiskCopy.ts`,
        ),
      ),
    ).toContain("export const ENTITY_LOOKUP_HOURS: number = 30 * 24;");
    expect(page).toContain("looks any value up across 30 days of events");
    // No ranking over a day, a week or a month is left to describe.
    expect(page).not.toContain("over the last day, week or month");
  });

  it("lists the triggers a playbook runs on, under the name the form gives them", () => {
    expect(column(rowsOf("When a playbook runs"), 0)).toEqual([
      ...SECURITY_PLAYBOOK_TRIGGERS,
    ]);
    expect(page).toContain("| Trigger | When it runs |");
    expect(page).toContain("that its **Trigger** fits");
    expect(
      flat(source(`${DASHBOARD}/Pages/SecurityEvents/Playbooks.tsx`)),
    ).toContain('field: { trigger: true }, stepId: "when", title: "Trigger",');
  });

  it("lists every step a playbook can take, by category and title, in the picker's order", () => {
    const stepRows: Array<Array<string>> = rowsOf("Steps");

    expect(
      stepRows.map((row: Array<string>): [string, string] => {
        return [row[0] as string, row[1] as string];
      }),
    ).toEqual(
      SECURITY_PLAYBOOK_ACTIONS.map(
        (action: SecurityPlaybookActionDefinition): [string, string] => {
          return [action.category, action.title];
        },
      ),
    );
  });

  it("gives the step limit, and the steps that wait for approval by default", () => {
    expect(page).toContain(
      `A playbook has at most ${SECURITY_PLAYBOOK_MAX_STEPS} steps.`,
    );

    const disruptive: Array<SecurityPlaybookActionDefinition> =
      SECURITY_PLAYBOOK_ACTIONS.filter(
        (action: SecurityPlaybookActionDefinition): boolean => {
          return action.isDisruptive;
        },
      );

    // Okta, CrowdStrike, Defender, and Microsoft Entra ID and Google Workspace's two each.
    expect(disruptive).toHaveLength(8);
    expect(
      disruptive.every((action: SecurityPlaybookActionDefinition): boolean => {
        return action.category === SecurityPlaybookActionCategory.Contain;
      }),
    ).toBe(true);
    expect(page).toContain(
      "The eight steps that cut someone off always do, unless a Security Admin turns it off.",
    );
    expect(flat(section(page, "Approval"))).toContain(
      "The eight steps that cut someone off wait for approval.",
    );
  });

  it("says when a step runs and whether it carries on wait under More fields, as the step's dialog folds them", () => {
    const dialog: string = flat(
      source(
        `${DASHBOARD}/Components/SecurityPlaybook/SecurityPlaybookStepDialog.tsx`,
      ),
    );
    const steps: string = flat(section(page, "Steps"));

    // Both fold into the dialog's More fields (getAdvancedFormSection).
    expect(dialog).toContain(
      "const howItRuns: FormFieldCollapsibleSection<JSONObject> = getAdvancedFormSection<JSONObject>();",
    );

    for (const title of ["Run This Step", "Carry On If It Fails"]) {
      const field: string = dialog.slice(dialog.indexOf(`title: "${title}",`));

      expect(field.slice(0, field.indexOf("}, {"))).toContain(
        "collapsibleSection: howItRuns,",
      );
    }

    expect(steps).toContain(
      "- **Run This Step**: **Always**, or only after a result of a step before it, such as **Check entities against threat intel** finding a known-bad entity;",
    );
    expect(steps).toContain(
      "Off, a failed step stops the run. It waits under **More fields**, with **Run This Step**.",
    );
    // The old switch is gone from the dialog, and from the page.
    expect(dialog).not.toContain('title: "Only If Threat Intel Matched"');
    expect(page).not.toContain("**Only If Threat Intel Matched**");
  });

  it("lists the results each step before offers to wait on, as Run This Step words them", () => {
    const rows: Array<Array<string>> = rowsOf("Branch on a step's result");
    const titleOf: (type: SecurityPlaybookActionType) => string = (
      type: SecurityPlaybookActionType,
    ): string => {
      return SECURITY_PLAYBOOK_ACTIONS.find(
        (action: SecurityPlaybookActionDefinition): boolean => {
          return action.type === type;
        },
      )!.title;
    };
    const resultsOf: (type: SecurityPlaybookActionType) => string = (
      type: SecurityPlaybookActionType,
    ): string => {
      const phrases: Array<string> = getSecurityPlaybookStepOutcomes({
        action: type,
        continueOnFailure: false,
      }).map((outcome: SecurityPlaybookStepOutcome): string => {
        return describeSecurityPlaybookStepOutcome(type, outcome);
      });

      return phrases
        .map((phrase: string, index: number): string => {
          return index === 0
            ? phrase.charAt(0).toUpperCase() + phrase.slice(1)
            : phrase;
        })
        .join(", or ");
    };

    expect(rows).toEqual([
      [
        titleOf(SecurityPlaybookActionType.CheckThreatIntel),
        resultsOf(SecurityPlaybookActionType.CheckThreatIntel),
      ],
      [
        titleOf(SecurityPlaybookActionType.LookUpEntityActivity),
        resultsOf(SecurityPlaybookActionType.LookUpEntityActivity),
      ],
      [
        "Any other step",
        "Succeeded, and failed when it has **Carry On If It Fails** on",
      ],
    ]);

    // Any other step succeeds; it can be waited on to fail only when it carries on.
    expect(
      getSecurityPlaybookStepOutcomes({
        action: SecurityPlaybookActionType.AddCaseNote,
        continueOnFailure: false,
      }),
    ).toEqual([SecurityPlaybookStepOutcome.Succeeded]);
    expect(
      getSecurityPlaybookStepOutcomes({
        action: SecurityPlaybookActionType.AddCaseNote,
        continueOnFailure: true,
      }),
    ).toEqual([
      SecurityPlaybookStepOutcome.Succeeded,
      SecurityPlaybookStepOutcome.Failed,
    ]);
    expect(
      describeSecurityPlaybookStepOutcome(
        SecurityPlaybookActionType.AddCaseNote,
        SecurityPlaybookStepOutcome.Failed,
      ),
    ).toBe("failed");
  });

  it("says the Escalate Known-Bad Indicators template branches on threat intel, and where a skipped step says why", () => {
    const branch: string = flat(section(page, "Branch on a step's result"));
    const template: { title: string; steps: Array<SecurityPlaybookStep> } = ((
      found: (typeof SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS)[number],
    ): { title: string; steps: Array<SecurityPlaybookStep> } => {
      return {
        title: found.title,
        steps: found.getSteps({
          priorityId: (): string => {
            return "priority";
          },
          statusId: (): string => {
            return "status";
          },
        }),
      };
    })(
      SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS.find(
        (
          candidate: (typeof SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS)[number],
        ) => {
          return candidate.key === "known-bad";
        },
      )!,
    );
    const [check, ...rest] = template.steps;

    expect(check!.action).toBe(SecurityPlaybookActionType.CheckThreatIntel);
    expect(rest.length).toBeGreaterThan(0);

    for (const later of rest) {
      expect(later.runIf).toEqual({
        stepId: check!.id,
        outcome: SecurityPlaybookStepOutcome.Found,
      });
    }

    expect(branch).toContain(
      `The **${template.title}** template raises a case's priority and status only when threat intel matched`,
    );
    expect(branch).toContain(
      "When the step waited on ends another way, the step that waits is skipped, and the run says why under it",
    );
    // The skipped step's reason, as the engine writes it.
    expect(
      flat(
        source(
          "Common/Types/SecurityPlaybook/SecurityPlaybookStepCondition.ts",
        ),
      ),
    ).toContain("reason: `Skipped: it runs only if step ${waitedOn + 1}");
  });

  it("says Add tasks leaves out the tasks a case has, and Preserve the evidence keeps the events behind its detections", () => {
    const actions: string = flat(
      source("Common/Server/Utils/SecurityPlaybook/SecurityPlaybookActions.ts"),
    );

    expect(page).toContain(
      "A playbook's **Add tasks** step adds tasks too, and leaves out any the case has already.",
    );
    expect(actions).toContain(
      "return skipped(mdText`The case has these tasks already.`);",
    );
    expect(MAX_EVIDENCE_DETECTIONS).toBe(100);
    expect(flat(section(page, "Responding through OneUptime"))).toContain(
      `- **Preserve the evidence** keeps the latest event of each of the case's detections, up to ${MAX_EVIDENCE_DETECTIONS}, on its **Evidence** page as it is now,`,
    );
  });

  it("names the permissions and scopes Microsoft Entra ID and Google Workspace containment needs, as the clients ask for them", () => {
    const containment: string = flat(section(page, "Containment"));
    const entra: string = flat(
      source(
        "Common/Server/Utils/SecurityEvent/Response/MicrosoftEntraIdResponseClient.ts",
      ),
    );

    for (const permission of [
      "User.Read.All",
      "User.EnableDisableAccount.All",
      "User.RevokeSessions.All",
    ]) {
      expect(entra).toContain(permission);
    }

    expect(containment).toContain(
      "| Microsoft Entra ID | An app with the User.Read.All, User.EnableDisableAccount.All and User.RevokeSessions.All application permissions |",
    );
    expect(GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE).toBe(
      "https://www.googleapis.com/auth/admin.directory.user",
    );
    expect(GOOGLE_WORKSPACE_DIRECTORY_SECURITY_SCOPE).toBe(
      "https://www.googleapis.com/auth/admin.directory.user.security",
    );
    expect(containment).toContain(
      "| Google Workspace | Domain-wide delegation with the admin.directory.user and admin.directory.user.security scopes, for an administrator who manages the user |",
    );
    expect(containment).toContain(
      "changes an administrator's account only for an app that also holds the Privileged Authentication Administrator role",
    );
    expect(entra).toContain("Privileged Authentication Administrator role");
  });

  it("names the connection each Contain step acts through, and how many entities it acts on", () => {
    const containRows: Array<Array<string>> = rowsOf("Containment");
    const containTitles: Array<string> = SECURITY_PLAYBOOK_ACTIONS.filter(
      (action: SecurityPlaybookActionDefinition): boolean => {
        return action.category === SecurityPlaybookActionCategory.Contain;
      },
    ).map((action: SecurityPlaybookActionDefinition): string => {
      return action.title;
    });

    expect(column(containRows, 0).join(", ").split(", ").sort()).toEqual(
      [...containTitles].sort(),
    );
    expect(page).toContain(
      `A step acts on at most ${CONTAINMENT_ENTITY_LIMIT} users or hosts.`,
    );
  });

  it("says a Contain step acts only on what the case is about: grouped on, or known to threat intel", () => {
    const containment: string = flat(section(page, "Containment"));

    expect(containment).toContain(
      "A user or host step acts only on the users or hosts the case is about, never on every one it names:",
    );
    expect(containment).toContain(
      "- The value a detection of the case is grouped on,",
    );
    expect(containment).toContain(
      "- A user or host of the case that your threat intelligence knows as an indicator.",
    );
    expect(containment).toContain(
      "says on the run what it did with each one: done, already done, not found, refused, or protected.",
    );
  });

  it("says the data store steps act through the store's cloud connection, on the case's stores, never on one public by design", () => {
    const containment: string = flat(section(page, "Containment"));
    const steps: string = flat(section(page, "Steps"));

    expect(
      [
        SecurityPlaybookActionType.BlockDataStorePublicAccess,
        SecurityPlaybookActionType.RevokeDataStoreSharing,
      ].map((action: SecurityPlaybookActionType): string | undefined => {
        return SECURITY_PLAYBOOK_ACTIONS.find(
          (definition: SecurityPlaybookActionDefinition): boolean => {
            return definition.type === action;
          },
        )?.title;
      }),
    ).toEqual([
      "Block public access to data stores",
      "Revoke data store sharing",
    ]);
    expect(MAX_NOTIFIED_DATA_STORES).toBe(10);
    expect(containment).toContain(
      "| Block public access to data stores, Revoke data store sharing | The store's cloud connection | **Data security response** turned on, and its setup command run again |",
    );
    expect(containment).toContain(
      "The two data store steps act on the data stores the case is about, at most 10:",
    );
    expect(containment).toContain(
      "They leave a store marked **Public By Design** alone",
    );
    expect(steps).toContain(
      "**Run a runbook**, **Post a status page announcement** and the two data store steps start with it on",
    );

    for (const action of [
      SecurityPlaybookActionType.BlockDataStorePublicAccess,
      SecurityPlaybookActionType.RevokeDataStoreSharing,
    ]) {
      const definition: SecurityPlaybookActionDefinition | undefined =
        SECURITY_PLAYBOOK_ACTIONS.find(
          (candidate: SecurityPlaybookActionDefinition): boolean => {
            return candidate.type === action;
          },
        );

      expect(definition?.needsApprovalByDefault).toBe(true);
      expect(definition?.isDisruptive).toBe(false);
    }
  });

  it("names the protected entities page where the menu puts it, and matches values as the page says", () => {
    const playbooks: SecurityEventsMenuSection | undefined =
      SECURITY_EVENTS_MENU.find((menu: SecurityEventsMenuSection): boolean => {
        return menu.title === "Playbooks";
      });

    expect(
      playbooks?.items.map((item: SecurityEventsMenuItem): string => {
        return item.title;
      }),
    ).toContain("Protected Entities");
    expect(page).toContain(
      "**Protected Entities**, under **Playbooks** in the menu, lists the users and hosts no playbook contains",
    );
    expect(page).toContain(
      "A value matches whatever its case, and `*` stands for any run of characters: `svc-*` protects every service account.",
    );
    expect(matchesProtectedEntityPattern("svc-*", "SVC-Backup")).toBe(true);
    expect(page).toContain("Security Admins keep the list.");
    expect(new SecurityProtectedEntity().getCreatePermissions()).toContain(
      Permission.SecurityAdmin,
    );
    expect(new SecurityProtectedEntity().getCreatePermissions()).not.toContain(
      Permission.SecurityMember,
    );
  });

  it("says who may turn approval off, what the approver picks, and that whoever started a run cannot approve it", () => {
    const approval: string = flat(section(page, "Approval"));
    const runCard: string = flat(
      source(
        `${DASHBOARD}/Components/SecurityPlaybook/SecurityPlaybookRunCard.tsx`,
      ),
    );

    expect([...TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS]).toContain(
      Permission.SecurityAdmin,
    );
    expect([...TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS]).not.toContain(
      Permission.SecurityMember,
    );
    expect(approval).toContain(
      "Only a Security Admin can turn **Needs Approval** off for one, and OneUptime records who did.",
    );
    expect(approval).toContain(
      "under **Act On**, every one ticked: untick any it should leave alone.",
    );
    expect(runCard).toContain('title: "Act On",');
    expect(approval).toContain(
      "Whoever started a run cannot approve its steps: someone else does, though they can still reject it.",
    );
  });

  it("names the undo buttons as the run draws them, one for each step that can be undone", () => {
    const undoable: Array<string> = SECURITY_PLAYBOOK_ACTIONS.filter(
      (action: SecurityPlaybookActionDefinition): boolean => {
        return Boolean(getSecurityPlaybookUndoAction(action.type));
      },
    ).map((action: SecurityPlaybookActionDefinition): string => {
      return UNDO_BUTTON_TITLES[
        getSecurityPlaybookUndoAction(action.type)!.type
      ]!;
    });

    // Okta's and Google Workspace's undo are both Unsuspend.
    expect(undoable).toEqual([
      "Unsuspend",
      "Lift Containment",
      "Release",
      "Enable",
      "Unsuspend",
    ]);
    expect(flat(section(page, "Undo"))).toContain(
      "a contained user or host also has a button of its own on its step: **Unsuspend**, **Lift Containment**, **Release** or **Enable**. A sign-out cannot be undone.",
    );
  });

  it("lists the message placeholders as the templates fill them", () => {
    const placeholderRows: Array<Array<string>> = rowsOf("Messages");

    expect(
      placeholderRows.map((row: Array<string>): string => {
        return codeSpans(row[0] as string)[0] as string;
      }),
    ).toEqual(
      SECURITY_CASE_TEMPLATE_PLACEHOLDERS.map(
        (item: { placeholder: string }): string => {
          return item.placeholder;
        },
      ),
    );
    expect(column(placeholderRows, 1)).toEqual(
      SECURITY_CASE_TEMPLATE_PLACEHOLDERS.map(
        (item: { description: string }): string => {
          return item.description;
        },
      ),
    );
  });

  it("lists a run's statuses, and the times after which a stalled run is picked up", () => {
    expect(column(rowsOf("Runs and approvals"), 0)).toEqual(
      Object.values(SecurityPlaybookRunStatus),
    );
    expect(SECURITY_PLAYBOOK_STALE_QUEUED_MS).toBe(2 * MINUTE_IN_MS);
    expect(SECURITY_PLAYBOOK_STALE_RUNNING_MS).toBe(30 * MINUTE_IN_MS);
    expect(page).toContain(
      "a queued run is queued again after 2 minutes, and a run that has said nothing for 30 minutes is failed.",
    );
  });

  it("gives the overview's windows as the overview counts them", () => {
    expect(SECURITY_OVERVIEW_CASE_WINDOW_IN_DAYS).toBe(30);
    expect(SECURITY_OVERVIEW_DETECTION_WINDOW_IN_DAYS).toBe(14);

    const overview: string = section(page, "The overview");

    expect(overview).toContain("over the cases opened in the last 30 days");
    expect(overview).toContain(
      "The cases opened each day for 30 days, by priority, and the detections raised each day for 14 days, by source.",
    );
    expect(boldSpans(overview)).toContain("Mean Time to Acknowledge");
  });

  /*
   * The Overview draws its ranked lists the most urgent first, in rows of
   * cards of a size (Pages/SecurityEvents/Overview.tsx): what is open now
   * and who it touches, then what raised detections, the attacker goals and
   * how the month's closed cases turned out. The page lists them in that
   * order too.
   */
  it("lists the overview's ranked lists in the order the Overview draws them", () => {
    const overviewPage: string = source(
      `${DASHBOARD}/Pages/SecurityEvents/Overview.tsx`,
    );
    const phrases: Array<[string, string]> = [
      // The card's title on the page, the docs' words for it.
      ["Open Cases", "The open cases by priority and by status"],
      // Entity Risk's scores, the top of its list: never a count of findings.
      ["Riskiest Entities", "the riskiest entities by their risk score"],
      ["Top Detections", "the detections that fired most"],
      ["MITRE ATT&CK Tactics", "the ATT&CK tactics behind the cases"],
      ["Verdicts", "the verdicts of the last 30 days"],
    ];
    const positionsIn: (
      text: string,
      needles: Array<string>,
    ) => Array<number> = (
      text: string,
      needles: Array<string>,
    ): Array<number> => {
      return needles.map((needle: string): number => {
        return text.indexOf(needle);
      });
    };
    const ascending: (positions: Array<number>) => boolean = (
      positions: Array<number>,
    ): boolean => {
      return positions.every((position: number, index: number): boolean => {
        return (
          position >= 0 && (index === 0 || position > positions[index - 1]!)
        );
      });
    };

    const titles: Array<number> = positionsIn(
      overviewPage,
      phrases.map(([title]: [string, string]): string => {
        return `title="${title}"`;
      }),
    );
    const words: Array<number> = positionsIn(
      section(page, "The overview"),
      phrases.map(([, words]: [string, string]): string => {
        return words;
      }),
    );

    expect({ titles: ascending(titles), words: ascending(words) }).toEqual({
      titles: true,
      words: true,
    });
    expect(section(page, "The overview")).toContain(
      "- The open cases by priority and by status, the riskiest entities by their risk score, the detections that fired most, the ATT&CK tactics behind the cases, and the verdicts of the last 30 days.",
    );
  });

  it("names the five notifications as Notification Settings lists them, on by email and push", () => {
    const settingsPage: string = source(
      `${DASHBOARD}/Pages/UserSettings/NotificationSettings.tsx`,
    );
    const settingService: string = source(
      "Common/Server/Services/UserNotificationSettingService.ts",
    );
    const notificationRows: Array<Array<string>> = rowsOf("Notifications");

    expect(column(notificationRows, 0)).toEqual([
      "New security case",
      "Security case assigned to me",
      "Playbook step waiting for my approval",
      "Security case response target",
      "Security case task assigned to me",
    ]);
    expect(flat(section(page, "Notifications"))).toContain(
      "OneUptime tells people about five things on a case.",
    );

    for (const label of column(notificationRows, 0)) {
      expect(settingsPage).toContain(`label: "${label}",`);
    }

    // Each is added for every member with email and push on.
    for (const eventType of SECURITY_CASE_NOTIFICATION_EVENT_TYPES) {
      const member: string = Object.entries(NotificationSettingEventType).find(
        ([, value]: [string, string]): boolean => {
          return value === eventType;
        },
      )![0];

      expect(settingService).toContain(
        `NotificationSettingEventType.${member},\n      { alertByPush: true },`,
      );
    }

    expect(column(notificationRows, 2)).toEqual([
      "Email and push, for High and Critical cases",
      "Email and push",
      "Email and push",
      "Email and push",
      "Email and push",
    ]);
    // Nobody has to choose: the default is the project's high priority, and above.
    expect(
      (
        getDefaultSecurityCaseNotificationMinimum(
          buildDefaultTestPriorities(),
        ) as SecurityCasePriority
      ).name,
    ).toBe(priorityNameOf(SecurityCasePriorityLevel.High));
  });

  it("says a push opens the case in the On-Call app, where a waiting step is approved or rejected and the case taken on and closed", () => {
    const handlers: string = flat(
      source("MobileApp/src/notifications/handlers.ts"),
    );
    const caseScreen: string = source(
      "MobileApp/src/screens/SecurityCaseDetailScreen.tsx",
    );
    const approval: string = source(
      "MobileApp/src/components/security/PlaybookApproval.tsx",
    );

    // The push names its case and project, and carries the case's link.
    expect(flat(source("Common/Server/Utils/PushNotificationUtil.ts"))).toMatch(
      /public static createSecurityCaseNotification\(.{0,900}?clickAction: params\.caseViewLink,.{0,400}?entityType: "security-case", entityId: params\.securityCaseId, projectId: params\.projectId,/,
    );
    // The app opens the case's own screen from them.
    expect(handlers).toMatch(
      /case "security-case": \/\*.{0,600}?\*\/ navigationRef\.navigate\( "Inbox", buildInboxDetailNavigation\(\{ name: "SecurityCaseDetail", params: \{ caseId: entityId, projectId \},/,
    );
    // Where the waiting step is decided, the case taken on and closed.
    expect(approval).toContain('label="Approve"');
    expect(approval).toContain('label="Reject"');
    expect(caseScreen).toContain('label: "Assign to me",');
    expect(caseScreen).toContain('label: "Close case",');

    /*
     * 1.7.0 is the store release the case screen ships in: 1.6.0 and
     * earlier open on their last screen.
     */
    expect(englishPage()).toContain(
      "WhatsApp messages are not sent for security cases. A push notification opens the case in the OneUptime On-Call app (1.7.0 or later), where you can approve or reject a waiting playbook step, take the case on and close it. Its link opens the case in the browser.",
    );
  });

  it("lists a new project's priority choices as the setting offers them, the default marked", () => {
    const choiceRows: Array<Array<string>> = rowsOf("Choose what you are told");
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();
    const choices: Array<SecurityCaseNotificationPriorityChoice> =
      getSecurityCaseNotificationPriorityChoices({ priorities: priorities });
    const defaultId: string = (
      getDefaultSecurityCaseNotificationMinimum(
        priorities,
      ) as SecurityCasePriority
    ).id!.toString();
    const defaultChoice: string = describeSecurityCaseNotificationChoice(
      choices.find(
        (choice: SecurityCaseNotificationPriorityChoice): boolean => {
          return choice.priorityId === defaultId;
        },
      )!,
    );

    // One choice for each of the project's priorities, most urgent first.
    expect(column(choiceRows, 0)).toEqual(
      choices.map(describeSecurityCaseNotificationChoice),
    );
    expect(defaultChoice).toBe("High and above");
    expect(
      choiceRows.find((row: Array<string>): boolean => {
        return row[0] === defaultChoice;
      })![1],
    ).toContain("(the default)");
    expect(page).toContain(
      "The choices follow the project's case priorities, under their own names: these are a new project's.",
    );
    expect(page).toContain(
      `so a Medium case notifies nobody who kept the default, **${defaultChoice}**.`,
    );

    // The setting's own picker words them with the same templates.
    const settingsPage: string = flat(
      source(`${DASHBOARD}/Pages/UserSettings/NotificationSettings.tsx`),
    );

    for (const template of Object.values(
      SECURITY_CASE_NOTIFICATION_CHOICE_TEMPLATES,
    )) {
      expect(settingsPage).toContain(`"${template}"`);
    }
  });

  it("lists the Slack and Microsoft Teams conditions a Security Case rule offers", () => {
    const conditionRows: Array<Array<string>> = rowsOf(
      "Post to Slack and Microsoft Teams channels",
    );
    const offered: Array<string> =
      NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.SecurityCase,
      );

    expect(
      column(conditionRows, 0)
        .flatMap((cell: string): Array<string> => {
          return cell.split(", ");
        })
        .sort(),
    ).toEqual([...offered].sort());
    expect(page).toContain(
      "**Products → Security Events → Workspace → Slack** (or **Microsoft Teams**)",
    );
  });

  it("names the API's routes as the models serve them", () => {
    for (const [model, route] of [
      [new SecurityCase(), "/security-case"],
      [new SecurityCaseNote(), "/security-case-note"],
      [new SecurityPlaybook(), "/security-playbook"],
      [new SecurityPlaybookRun(), "/security-playbook-run"],
      [new SecurityProtectedEntity(), "/security-protected-entity"],
      [new SecurityCasePriority(), "/security-case-priority"],
      [new SecurityCaseStatus(), "/security-case-status"],
      [new SecurityCaseTask(), "/security-case-task"],
      [new SecurityCaseEvidence(), "/security-case-evidence"],
    ] as Array<[SecurityCase, string]>) {
      expect(model.getCrudApiPath()?.toString()).toBe(route);
      expect(codeSpans(section(page, "Automate"))).toContain(route);
    }

    // And the Terraform resources a project's priorities and statuses are kept as.
    expect(codeSpans(section(page, "Automate"))).toEqual(
      expect.arrayContaining([
        "oneuptime_security_case_priority",
        "oneuptime_security_case_status",
      ]),
    );
  });

  it("says the templates are a new project's empty list, and Create from Template's once it has playbooks", () => {
    expect(CREATE_FROM_TEMPLATE).toBe("Create from Template");
    expect(page).toContain(
      "A project with no playbooks sees the templates in place of an empty list; once there are playbooks, **Create from Template** on the list opens them, with **Added** on the ones the project already has.",
    );

    const playbooks: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/Playbooks.tsx`),
    );

    // The empty list is the picker; the card's button opens it in a dialog.
    expect(playbooks).toContain(
      "noItemsMessage={ <SecurityPlaybookTemplatePicker showIntro={true}",
    );
    expect(playbooks).toContain("title: CREATE_FROM_TEMPLATE,");
    expect(
      source(
        `${DASHBOARD}/Components/SecurityPlaybook/SecurityPlaybookTemplatePicker.tsx`,
      ),
    ).toContain('translator.translateText("Added")');
  });

  it("says every list of runs draws each run as a line, Show steps opening it, and a run waiting for approval or a case's newest open", () => {
    expect(page).toContain(
      "On **Playbook Runs**, on a playbook's page and on a case's **Playbooks**, each run is a line that says how far it got, or the step where it stopped; **Show steps** opens its steps. A run waiting for approval opens by itself, and so does the newest run on a case.",
    );

    for (const file of ["PlaybookRuns.tsx", "PlaybookView.tsx"]) {
      expect({
        file,
        folds: source(`${DASHBOARD}/Pages/SecurityEvents/${file}`).includes(
          "isCollapsible={true}",
        ),
      }).toEqual({ file, folds: true });
    }

    // A case's own runs fold too, its newest open: the page's Playbooks.
    const caseRuns: string = flat(
      source(
        `${DASHBOARD}/Components/SecurityPlaybook/SecurityCasePlaybookRuns.tsx`,
      ),
    );
    expect(caseRuns).toContain("isCollapsible={true}");
    expect(caseRuns).toContain("isExpandedAtFirst={index === 0}");
    expect(
      SECURITY_CASE_MENU.flatMap(
        (menu: SecurityCaseMenuSection): Array<SecurityCaseMenuItem> => {
          return menu.items;
        },
      ).find((item: SecurityCaseMenuItem): boolean => {
        return item.page === PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS;
      })?.title,
    ).toBe("Playbooks");

    const card: string = flat(
      source(
        `${DASHBOARD}/Components/SecurityPlaybook/SecurityPlaybookRunCard.tsx`,
      ),
    );
    expect(card).toContain('isExpanded ? "Hide steps" : "Show steps"');
    expect(card).toContain(
      "!props.isCollapsible || isWaiting || Boolean(props.isExpandedAtFirst)",
    );
  });

  /*
   * One riskiest list: Entity Risk ranks by risk score, and the Overview's
   * Riskiest Entities is its top. The Entities page, which ranked values by
   * how many findings named them, folded into Entity Risk with its lookup.
   */
  it("says Entity Risk ranks the riskiest by risk score, the Overview shows its top, and the lookup under it opens a value in Correlate", () => {
    const findThreats: string = section(page, "Find threats");

    expect(findThreats).toContain(
      "- **Entity Risk** ranks the users, hosts and addresses by their risk score, the riskiest first, and the Overview's **Riskiest Entities** shows the top of the same list. Select an entity to see why it is risky. Under the list, **Look Up an Entity** looks any value up across 30 days of events, a domain or a file hash too, and opens it in **Correlate**.",
    );
    expect(findThreats).not.toContain("**Entities**");
    expect(page).not.toContain("findings name most");
    expect(page).not.toContain("named by the most findings");

    // The words are the product's.
    expect(ENTITY_RISK_TABLE_TITLE).toBe("Entity Risk");
    expect(RISKIEST_ENTITIES_TITLE).toBe("Riskiest Entities");
    expect(ENTITY_LOOKUP_TITLE).toBe("Look Up an Entity");
    expect(OPEN_IN_CORRELATE).toBe("Open in Correlate");
    expect(ENTITY_LOOKUP_HOURS).toBe(30 * 24);
    expect(SECURITY_OVERVIEW_RISKIEST_ENTITY_LIMIT).toBe(8);

    // Entity Risk and Correlate are in the menu; Entities is not.
    const titles: Array<string> = SECURITY_EVENTS_MENU.flatMap(
      (menu: SecurityEventsMenuSection): Array<string> => {
        return menu.items.map((item: SecurityEventsMenuItem): string => {
          return item.title;
        });
      },
    );
    expect(titles).toContain("Entity Risk");
    expect(titles).toContain("Correlate");
    expect(titles).not.toContain("Entities");

    /*
     * The lookup is under Entity Risk's list, and opens a value in Correlate
     * - over the 30 days it read, so Correlate shows what it counted.
     */
    const entityRisk: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/EntityRisk.tsx`),
    );
    expect(entityRisk.indexOf("<EntityLookupCard />")).toBeGreaterThan(
      entityRisk.indexOf("<ModelTable<SecurityEntityRisk>"),
    );
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityEvents/EntityRisk/EntityLookupCard.tsx`,
        ),
      ),
    ).toContain(
      "Navigation.navigate( getCorrelateRouteForEntity( lookup.value, ENTITY_LOOKUP_HOURS, ), );",
    );

    // The Overview's card is the overview's own answer: Entity Risk's rows.
    const overviewPage: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/Overview.tsx`),
    );
    expect(overviewPage).toContain("riskiest={overview.riskiestEntities}");
  });

  it("says ATT&CK Coverage opens on the tactics, the Rule Library's count beside each, and the matrix a switch away", () => {
    expect(section(page, "Find threats")).toContain(
      "- **ATT&CK Coverage** lists the MITRE ATT&CK tactics, each with how many of its techniques your enabled rules cover, and how many more the **Rule Library** has rules for. Open a tactic for its techniques, or switch to **Matrix** for the whole matrix.",
    );
    expect(readAttackCoverageView(null)).toBe(AttackCoverageView.Tactics);
    expect(ATTACK_COVERAGE_VIEW_LABELS[AttackCoverageView.Matrix]).toBe(
      "Matrix",
    );
    expect(TACTIC_LIBRARY_COUNT).toBe("+{{count}} in the Rule Library");
  });
});
