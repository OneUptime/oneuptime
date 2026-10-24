import { describe, expect, test } from "@jest/globals";
import SecurityCasePriorityLevel from "Common/Types/SecurityCase/SecurityCasePriorityLevel";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  CASE_FROM_EVENT_TITLE_LIMIT,
  SecurityCaseDraft,
  buildCaseFromSecurityEvent,
  getEventEntities,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventCase";

/*
 * A case opened by hand from one event: its title, priority and entities,
 * and an event's untrusted text reaching the case's Markdown only as code.
 */

describe("opening a case from a security event", () => {
  test("names the case after what the event was and what it did", () => {
    const draft: SecurityCaseDraft = buildCaseFromSecurityEvent({
      className: "Authentication",
      activityName: "Logon failed",
      severityName: "High",
    });

    expect(draft.title).toBe("Authentication: Logon failed");
    expect(draft.priorityLevel).toBe(SecurityCasePriorityLevel.High);
  });

  test("falls back to the message, on one line, and to a plain name", () => {
    expect(
      buildCaseFromSecurityEvent({
        message: "Multiple\n\nfailed   logons",
      }).title,
    ).toBe("Security event: Multiple failed logons");
    expect(buildCaseFromSecurityEvent({}).title).toBe("Security event");
  });

  test("keeps a long title within the limit", () => {
    const draft: SecurityCaseDraft = buildCaseFromSecurityEvent({
      className: "Process Activity",
      message: "x".repeat(5000),
    });

    expect(draft.title.length).toBeLessThanOrEqual(CASE_FROM_EVENT_TITLE_LIMIT);
    expect(draft.title.endsWith("…")).toBe(true);
  });

  test("takes the event's severity as the case's priority, Medium when unknown", () => {
    expect(
      buildCaseFromSecurityEvent({ severityName: "Critical" }).priorityLevel,
    ).toBe(SecurityCasePriorityLevel.Critical);
    expect(buildCaseFromSecurityEvent({ severityName: "Fatal" }).priorityLevel).toBe(
      SecurityCasePriorityLevel.Critical,
    );
    expect(buildCaseFromSecurityEvent({}).priorityLevel).toBe(
      SecurityCasePriorityLevel.Medium,
    );
  });

  test("names the event's users, hosts and addresses, typed by their columns first", () => {
    expect(
      getEventEntities({
        principalUser: "alice@example.com",
        principalHost: "web-01",
        principalIp: "10.0.0.5",
        targetIp: "",
        observables: ["web-01", "203.0.113.7", "ALICE@example.com"],
      }),
    ).toEqual([
      { type: SecurityEntityType.User, value: "alice@example.com" },
      { type: SecurityEntityType.Host, value: "web-01" },
      { type: SecurityEntityType.IpAddress, value: "10.0.0.5" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    ]);
  });

  test("names the process a launch started and the one that started it, as processes", () => {
    expect(
      getEventEntities({
        principalHost: "laptop-7",
        principalProcess: "winword.exe",
        processName: "powershell.exe",
        parentProcessName: "WINWORD.EXE",
      }),
    ).toEqual([
      { type: SecurityEntityType.Host, value: "laptop-7" },
      // The acting process and the parent are one process: named once.
      { type: SecurityEntityType.Process, value: "winword.exe" },
      { type: SecurityEntityType.Process, value: "powershell.exe" },
    ]);
  });

  test("carries the event's ATT&CK mapping", () => {
    const draft: SecurityCaseDraft = buildCaseFromSecurityEvent({
      mitreTactics: ["TA0006"],
      mitreTechniques: ["T1110"],
    });

    expect(draft.mitreTactics).toEqual(["TA0006"]);
    expect(draft.mitreTechniques).toEqual(["T1110"]);
  });

  test("quotes the event's text as code, so it can never become a link", () => {
    const draft: SecurityCaseDraft = buildCaseFromSecurityEvent({
      className: "[click](https://evil.example)",
      message: "Login from [here](https://evil.example) <img src=x>",
      vendorName: "Acme",
      productName: "EDR",
      eventUid: "abc-123",
      time: new Date("2026-10-14T10:00:00.000Z"),
      severityName: "High",
    });

    expect(draft.description).toContain("2026-10-14T10:00:00.000Z");
    expect(draft.description).toContain("Acme EDR");
    expect(draft.description).toContain("`abc-123`");
    // The message only as a code span, where Markdown makes nothing of it.
    expect(draft.description).toContain(
      "**Message:** `Login from [here](https://evil.example) <",
    );
    expect(draft.description).not.toContain("<img");
    // The class name is escaped where it is written as text.
    expect(draft.description).not.toContain("[click](https://evil.example)");
  });
});
