import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { SECURITY_CASE_QUEUE_VIEWS } from "../../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseNote from "Common/Models/DatabaseModels/SecurityCaseNote";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import {
  SECURITY_OVERVIEW_CASE_WINDOW_IN_DAYS,
  SECURITY_OVERVIEW_DETECTION_WINDOW_IN_DAYS,
} from "Common/Server/API/SecurityCaseAPI";
import {
  SECURITY_PLAYBOOK_STALE_QUEUED_MS,
  SECURITY_PLAYBOOK_STALE_RUNNING_MS,
} from "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import { CONTAINMENT_ENTITY_LIMIT } from "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import Permission from "Common/Types/Permission";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import { securityCasePriorityFromSeverity } from "Common/Types/SecurityCase/SecurityCasePriority";
import { SECURITY_CASE_STATUSES } from "Common/Types/SecurityCase/SecurityCaseStatus";
import {
  SECURITY_CASE_VERDICTS,
  SecurityCaseVerdictDescription,
} from "Common/Types/SecurityCase/SecurityCaseVerdict";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionCategory,
  SecurityPlaybookActionDefinition,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SECURITY_PLAYBOOK_MAX_STEPS } from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import { SECURITY_PLAYBOOK_TRIGGERS } from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { SECURITY_CASE_TEMPLATE_PLACEHOLDERS } from "Common/Utils/SecurityCase/SecurityCaseMarkdown";
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

function rowsOf(
  heading: string,
  which: number = 0,
): Array<Array<string>> {
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

describe("Security Cases and Playbooks docs", () => {
  const page: string = englishPage();

  it("opens the queue where the menu puts it, with the views the queue offers", () => {
    expect(page).toContain(
      "Open **Products → Security Events → Cases**. The queue opens on the open cases; **Assigned to Me**, **Unassigned**, **Closed** and **All** are the other views.",
    );
    expect(
      SECURITY_CASE_QUEUE_VIEWS.map((view: { title: string }): string => {
        return view.title;
      }),
    ).toEqual(["Open", "Assigned to Me", "Unassigned", "Closed", "All"]);
    expect(source(`${DASHBOARD}/Utils/SecurityEventsNavigation.ts`)).toContain(
      'title: "Cases",',
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

    for (const form of [rules, feeds]) {
      expect(form).toContain(
        'title: "Open a Case on Match", stepId: "cases",',
      );
      expect(form).toContain('{ title: "Cases", id: "cases" }');
    }

    expect(connections).toContain('title: "Open Cases From",');
    expect(connections).toContain('initialValues["caseMinimumSeverity"] = "High";');
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

      for (const severity of severities) {
        expect([severity, securityCasePriorityFromSeverity(severity)]).toEqual([
          severity,
          row[1],
        ]);
      }
    }

    // Every OCSF severity is on the table.
    const listed: string = column(rowsOf("How detections are grouped"), 0).join(
      " ",
    );

    for (const severity of Object.values(OcsfSeverity)) {
      expect(listed).toContain(severity);
    }
  });

  it("lists the case's statuses and verdicts as the case knows them", () => {
    expect(column(rowsOf("Work a case"), 0)).toEqual([
      ...SECURITY_CASE_STATUSES,
    ]);

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
    expect(
      flat(source(`${DASHBOARD}/Pages/SecurityEvents/Entities.tsx`)),
    ).toContain(
      "export const ENTITY_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30];",
    );
    expect(page).toContain("over the last day, week or month");
  });

  it("lists the triggers a playbook runs on", () => {
    expect(column(rowsOf("When a playbook runs"), 0)).toEqual([
      ...SECURITY_PLAYBOOK_TRIGGERS,
    ]);
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

    expect(disruptive).toHaveLength(4);
    expect(
      disruptive.every((action: SecurityPlaybookActionDefinition): boolean => {
        return action.category === SecurityPlaybookActionCategory.Contain;
      }),
    ).toBe(true);
    expect(page).toContain(
      "It is on by default for the four Contain steps, which act outside OneUptime.",
    );
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

    expect(
      column(containRows, 0)
        .join(", ")
        .split(", ")
        .sort(),
    ).toEqual([...containTitles].sort());
    expect(page).toContain(
      `A Contain step acts on at most ${CONTAINMENT_ENTITY_LIMIT} of the case's users or hosts.`,
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

  it("names the API's routes as the models serve them", () => {
    for (const [model, route] of [
      [new SecurityCase(), "/security-case"],
      [new SecurityCaseNote(), "/security-case-note"],
      [new SecurityPlaybook(), "/security-playbook"],
      [new SecurityPlaybookRun(), "/security-playbook-run"],
    ] as Array<[SecurityCase, string]>) {
      expect(model.getCrudApiPath()?.toString()).toBe(route);
      expect(codeSpans(section(page, "Automate"))).toContain(route);
    }
  });
});
