import { describe, expect, test } from "@jest/globals";
import {
  getSecurityCaseFigures,
  minutesBetween,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseFigures";
import {
  SECURITY_CASE_VIEW_SELECT,
  getSecurityCaseRecordName,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseViewSelect";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import fs from "fs";
import path from "path";

/*
 * What a case's pages read of the case, once, in their layout, and the
 * figures its Overview leads with: how long it has been open (or took), and
 * how long until it was acknowledged and contained.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const OPENED: Date = new Date("2026-10-14T08:48:00.000Z");

function caseOpenedAt(fields: Partial<SecurityCase>): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase.createdAt = OPENED;
  Object.assign(securityCase, fields);
  return securityCase;
}

describe("minutesBetween", () => {
  test("counts the minutes from one moment to a later one", () => {
    expect(minutesBetween(OPENED, new Date("2026-10-14T09:02:00.000Z"))).toBe(
      14,
    );
    expect(minutesBetween(OPENED, OPENED)).toBe(0);
  });

  test("has nothing to say when either moment is missing, or the second comes first", () => {
    expect(minutesBetween(undefined, OPENED)).toBeNull();
    expect(minutesBetween(OPENED, undefined)).toBeNull();
    expect(minutesBetween(OPENED, null)).toBeNull();
    expect(
      minutesBetween(OPENED, new Date("2026-10-14T08:00:00.000Z")),
    ).toBeNull();
  });
});

describe("a case's figures", () => {
  const now: Date = new Date("2026-10-14T12:00:00.000Z");

  test("an open case: open for until now, acknowledged, not yet contained", () => {
    expect(
      getSecurityCaseFigures(
        caseOpenedAt({
          acknowledgedAt: new Date("2026-10-14T09:02:00.000Z"),
        }),
        now,
      ),
    ).toEqual({
      openForInMinutes: 192,
      timeToAcknowledgeInMinutes: 14,
      timeToContainInMinutes: null,
    });
  });

  test("a closed case: how long it took, to the moment it closed", () => {
    expect(
      getSecurityCaseFigures(
        caseOpenedAt({
          acknowledgedAt: new Date("2026-10-14T09:00:00.000Z"),
          containedAt: new Date("2026-10-14T09:30:00.000Z"),
          closedAt: new Date("2026-10-14T10:48:00.000Z"),
        }),
        now,
      ),
    ).toEqual({
      openForInMinutes: 120,
      timeToAcknowledgeInMinutes: 12,
      timeToContainInMinutes: 42,
    });
  });

  test("a case with no opening moment has no figures", () => {
    expect(getSecurityCaseFigures(new SecurityCase(), now)).toEqual({
      openForInMinutes: null,
      timeToAcknowledgeInMinutes: null,
      timeToContainInMinutes: null,
    });
  });
});

describe("what a case's pages read of it", () => {
  test("the header, the facts, the figures, the response targets, the entities, the incident and OneUptime AI's triage", () => {
    expect(Object.keys(SECURITY_CASE_VIEW_SELECT).sort()).toEqual(
      [
        "_id",
        "caseNumberWithPrefix",
        "title",
        "description",
        "securityCaseStatusId",
        "securityCasePriorityId",
        "verdict",
        "closingNote",
        "source",
        "entities",
        "mitreTactics",
        "mitreTechniques",
        "detectionCount",
        "firstDetectedAt",
        "lastDetectedAt",
        "acknowledgedAt",
        "containedAt",
        "closedAt",
        "createdAt",
        // Where the case stands against its targets: the header and Overview.
        "acknowledgeDueAt",
        "acknowledgeMissedAt",
        "containDueAt",
        "containMissedAt",
        "incidentId",
        "incident",
        "assignedToUserId",
        "assignedToUser",
        "assignedToTeamId",
        "assignedToTeam",
        "labels",
        "aiVerdict",
        "aiSuggestedSecurityCasePriorityId",
        "aiSuggestedPlaybookId",
        "aiTriageReport",
        "aiTriagedAt",
        "aiTriagePromptInjectionSuspected",
      ].sort(),
    );
  });

  test("every column it reads is a column of the case", () => {
    const model: SecurityCase = new SecurityCase();

    for (const column of Object.keys(SECURITY_CASE_VIEW_SELECT)) {
      expect({
        column,
        isColumn: Boolean(model.getTableColumnMetadata(column)),
      }).toEqual({ column, isColumn: true });
    }
  });

  test("the layout reads the case with it, once, for every page", () => {
    const layout: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Pages",
        "SecurityEvents",
        "CaseView",
        "Layout.tsx",
      ),
      "utf8",
    );

    expect(layout).toContain("select: SECURITY_CASE_VIEW_SELECT");
    expect(layout.split("ModelAPI.getItem<SecurityCase>").length - 1).toBe(1);

    // No page under it reads the case again.
    for (const page of [
      "Index.tsx",
      "Timeline.tsx",
      "Detections.tsx",
      "Entities.tsx",
      "PlaybookRuns.tsx",
      "Notes.tsx",
      "AuditLogs.tsx",
      "Delete.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, "Pages", "SecurityEvents", "CaseView", page),
        "utf8",
      );

      expect({
        page,
        readsTheCase: source.includes("ModelAPI.getItem"),
      }).toEqual({ page, readsTheCase: false });
      expect({
        page,
        usesTheLayout: source.includes("useSecurityCaseView()"),
      }).toEqual({ page, usesTheLayout: true });
    }
  });
});

describe("what the case's crumb and the browser tab call it", () => {
  test("its number, the way a security team names its cases", () => {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase.caseNumberWithPrefix = "CASE-142";
    securityCase.title = "Password spray against Okta from 203.0.113.47";

    expect(getSecurityCaseRecordName(securityCase)).toBe("CASE-142");
  });

  test("its title for a case with no number, and nothing for a case with neither", () => {
    const untitled: SecurityCase = new SecurityCase();
    untitled.title = "  Password spray  ";

    expect(getSecurityCaseRecordName(untitled)).toBe("Password spray");

    const blank: SecurityCase = new SecurityCase();
    blank.caseNumberWithPrefix = "   ";

    expect(getSecurityCaseRecordName(blank)).toBeNull();
  });
});
