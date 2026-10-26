import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import OcsfNormalizer from "../../../Utils/SecurityEvent/OcsfNormalizer";

/*
 * OCSF is the canonical dialect, so this normalizer mostly lifts fields —
 * which makes its regressions the quiet kind: a producer omits class_name
 * and the row must re-derive it from the uid instead of storing "" ; a
 * payload carries both severity_id and a contradictory severity text and
 * the id must win or text-only producers and id producers grade the same
 * event differently; an unknown class_uid must be kept (with a derived
 * category) because the schema outgrows our curated subset. These tests pin
 * those trust-but-rederive rules plus the attacks/observables merges.
 */
describe("OcsfNormalizer", () => {
  describe("isOcsfEvent", () => {
    test("requires a numeric class_uid", () => {
      expect(OcsfNormalizer.isOcsfEvent({ class_uid: 3002 })).toBe(true);
      expect(OcsfNormalizer.isOcsfEvent({ class_uid: "3002" })).toBe(true);
      expect(OcsfNormalizer.isOcsfEvent({ class_uid: "not-a-number" })).toBe(
        false,
      );
      expect(OcsfNormalizer.isOcsfEvent({})).toBe(false);
      expect(
        OcsfNormalizer.isOcsfEvent({ metadata: { event_type: "USER_LOGIN" } }),
      ).toBe(false);
    });
  });

  describe("normalize: full authentication event", () => {
    const payload: JSONObject = {
      class_uid: 3002,
      activity_name: "Logon",
      severity_id: 4,
      severity: "LOW",
      time: 1714564800000,
      message: "Failed logon attempt",
      status: "Failure",
      metadata: {
        uid: "ocsf-1",
        product: { vendor_name: "Vendor", name: "Product" },
      },
      actor: { user: { name: "alice" }, process: { name: "winlogon.exe" } },
      src_endpoint: { hostname: "laptop-1", ip: "10.1.1.1" },
      dst_endpoint: { hostname: "dc-1", ip: "10.1.1.2", port: 445 },
      user: { name: "bob" },
      attacks: [
        {
          tactic: { uid: "TA0006", name: "Credential Access" },
          technique: { uid: "T1110", name: "Brute Force" },
        },
        { tactic: { uid: "TA0006" }, technique: { uid: "T1110.001" } },
      ],
      observables: [
        { name: "src ip", type_id: 2, value: "10.1.1.1" },
        { name: "domain", type_id: 1, value: "evil.example.com" },
      ],
    };

    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize(payload);

    test("class_name absent -> name derived from the uid", () => {
      expect(result.classUid).toBe(3002);
      expect(result.className).toBe("Authentication");
      expect(result.categoryUid).toBe(3);
      expect(result.categoryName).toBe("Identity & Access Management");
    });

    test("severity_id wins over the contradictory severity text", () => {
      expect(result.severityName).toBe(OcsfSeverity.High);
      expect(result.severityId).toBe(4);
    });

    test("time parses epoch millis", () => {
      expect(result.time.getTime()).toBe(1714564800000);
    });

    test("attacks[] uids extract and dedupe", () => {
      expect(result.mitreTactics).toEqual(["TA0006"]);
      expect(result.mitreTechniques).toEqual(["T1110", "T1110.001"]);
    });

    test("actor / src_endpoint / dst_endpoint / user extraction", () => {
      expect(result.principalUser).toBe("alice");
      expect(result.principalProcess).toBe("winlogon.exe");
      expect(result.principalHost).toBe("laptop-1");
      expect(result.principalIp).toBe("10.1.1.1");
      expect(result.targetUser).toBe("bob");
      expect(result.targetHost).toBe("dc-1");
      expect(result.targetIp).toBe("10.1.1.2");
      expect(result.targetPort).toBe(445);
    });

    test("observables[] values merge with entity fields, deduped", () => {
      expect(result.observables).toEqual([
        "alice",
        "bob",
        "laptop-1",
        "dc-1",
        "10.1.1.1",
        "10.1.1.2",
        "evil.example.com",
      ]);
    });

    test("status, message, product and uid lift as-is", () => {
      expect(result.statusName).toBe("Failure");
      expect(result.message).toBe("Failed logon attempt");
      expect(result.vendorName).toBe("Vendor");
      expect(result.productName).toBe("Product");
      expect(result.eventUid).toBe("ocsf-1");
      expect(result.activityName).toBe("Logon");
    });
  });

  describe("normalize: severity text fallback", () => {
    test("severity text grades when severity_id is absent", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 4001,
        severity: "critical",
      });

      expect(result.severityName).toBe(OcsfSeverity.Critical);
      expect(result.severityId).toBe(5);
    });

    test("unrecognised severity text -> Unknown", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 4001,
        severity: "P1",
      });

      expect(result.severityName).toBe(OcsfSeverity.Unknown);
      expect(result.severityId).toBe(0);
    });
  });

  describe("normalize: unknown class_uid is kept, never dropped", () => {
    test("without class_name -> Base Event with derived category", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 4999,
      });

      expect(result.classUid).toBe(4999);
      expect(result.className).toBe("Base Event");
      expect(result.categoryUid).toBe(4);
      expect(result.categoryName).toBe("Network Activity");
    });

    test("a supplied class_name is trusted", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 4999,
        class_name: "Tunnel Activity",
      });

      expect(result.className).toBe("Tunnel Activity");
    });
  });

  describe("normalize: fallback fields", () => {
    test("disposition backs up status", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 1001,
        disposition: "Blocked",
      });

      expect(result.statusName).toBe("Blocked");
    });

    test("time_dt backs up time", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 1001,
        time_dt: "2024-05-01T12:00:00Z",
      });

      expect(result.time.getTime()).toBe(1714564800000);
    });

    test("finding_info backs up rule fields and the message", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 2004,
        finding_info: { uid: "finding-1", title: "Suspicious login burst" },
      });

      expect(result.ruleId).toBe("finding-1");
      expect(result.ruleName).toBe("Suspicious login burst");
      expect(result.message).toBe("Suspicious login burst");
    });

    test("without message or finding_info, message is the class name", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 3002,
      });

      expect(result.message).toBe("Authentication");
    });

    test("without metadata.uid, eventUid is a content hash", () => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 3002,
      });

      expect(result.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });
});

/*
 * Sigma's Image and CommandLine read the process an event is about. In
 * OCSF Process Activity that is `process`, and in a launch the actor's
 * process is its parent - so the actor can never stand in for it. In every
 * other class the actor's process is the one that acted, and the one the
 * event is about.
 */
describe("OcsfNormalizer: the process an event is about", () => {
  const POWERSHELL: JSONObject = {
    pid: 6532,
    name: "powershell.exe",
    cmd_line: "powershell.exe -nop -enc JABzAD0A",
    file: {
      name: "powershell.exe",
      path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    },
  };

  const WORD: JSONObject = {
    pid: 4120,
    name: "WINWORD.EXE",
    cmd_line: '"WINWORD.EXE" /n "C:\\Users\\alice\\invoice.docm"',
    file: {
      path: "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    },
  };

  test("a launch: the process that started, and the actor as its parent", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 1007,
      activity_id: 1,
      actor: { process: WORD },
      process: POWERSHELL,
    });

    expect(result.processName).toBe("powershell.exe");
    expect(result.processPath).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(result.processCommandLine).toBe("powershell.exe -nop -enc JABzAD0A");
    expect(result.parentProcessName).toBe("WINWORD.EXE");
    expect(result.parentProcessPath).toBe(
      "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    );
    expect(result.parentProcessCommandLine).toBe(
      '"WINWORD.EXE" /n "C:\\Users\\alice\\invoice.docm"',
    );
    // principalProcess keeps the actor's name, as it always has.
    expect(result.principalProcess).toBe("WINWORD.EXE");
  });

  test("a launch's parent is read from process.parent_process and the actor together", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 1007,
      activity_id: 1,
      actor: { process: WORD },
      process: {
        ...POWERSHELL,
        parent_process: { pid: 4120, name: "winword.exe" },
      },
    });

    expect(result.parentProcessName).toBe("winword.exe");
    expect(result.parentProcessPath).toBe(
      "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    );
    expect(result.parentProcessCommandLine).toBe(
      '"WINWORD.EXE" /n "C:\\Users\\alice\\invoice.docm"',
    );
  });

  test("a parent_process that names another process than the actor is not mixed with it", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 1007,
      activity_id: 1,
      actor: { process: WORD },
      process: {
        ...POWERSHELL,
        parent_process: { name: "explorer.exe", cmd_line: "explorer.exe" },
      },
    });

    expect(result.parentProcessName).toBe("explorer.exe");
    expect(result.parentProcessCommandLine).toBe("explorer.exe");
    expect(result.parentProcessPath).toBe("");
  });

  test.each([
    ["an open (activity_id 3)", { activity_id: 3 }],
    ["an injection (activity_id 4)", { activity_id: 4 }],
    ["a termination named only in words", { activity_name: "Terminate" }],
  ])(
    "%s: the actor acted on the process, it is not its parent",
    (_name: string, activity: JSONObject) => {
      const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
        class_uid: 1007,
        ...activity,
        actor: {
          process: {
            name: "mimikatz.exe",
            cmd_line: "mimikatz.exe sekurlsa::logonpasswords",
          },
        },
        process: {
          name: "lsass.exe",
          file: { path: "C:\\Windows\\System32\\lsass.exe" },
          parent_process: { name: "wininit.exe" },
        },
      });

      expect(result.processName).toBe("lsass.exe");
      expect(result.parentProcessName).toBe("wininit.exe");
      expect(result.parentProcessCommandLine).toBe("");
      expect(result.principalProcess).toBe("mimikatz.exe");
    },
  );

  test("a Process Activity that does not name its process leaves it empty: the actor is never it", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 1007,
      activity_id: 1,
      actor: { process: WORD },
    });

    expect(result.processName).toBe("");
    expect(result.processCommandLine).toBe("");
    expect(result.parentProcessName).toBe("WINWORD.EXE");
  });

  test("a Process Activity that names no activity is read as a launch", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 1007,
      actor: { process: WORD },
      process: POWERSHELL,
    });

    expect(result.parentProcessName).toBe("WINWORD.EXE");
  });

  test("in any other class the actor's process is the one the event is about, with its own parent", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 4001,
      activity_id: 1,
      actor: {
        process: {
          ...POWERSHELL,
          parent_process: {
            name: "cmd.exe",
            cmd_line: "cmd.exe /c start powershell",
            file: { path: "C:\\Windows\\System32\\cmd.exe" },
          },
        },
      },
      dst_endpoint: { ip: "203.0.113.7", port: 443 },
    });

    expect(result.processName).toBe("powershell.exe");
    expect(result.processCommandLine).toBe("powershell.exe -nop -enc JABzAD0A");
    expect(result.parentProcessName).toBe("cmd.exe");
    expect(result.parentProcessPath).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(result.parentProcessCommandLine).toBe("cmd.exe /c start powershell");
  });

  test("a path is the file's path, or its folder and name joined", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 1007,
      activity_id: 1,
      process: {
        cmd_line: "/usr/bin/curl -s http://203.0.113.7/x",
        file: { parent_folder: "/usr/bin", name: "curl" },
      },
    });

    expect(result.processPath).toBe("/usr/bin/curl");
    expect(result.processName).toBe("curl");
  });

  test("an event with no process names none", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 3002,
      actor: { user: { name: "alice" } },
    });

    expect([
      result.processName,
      result.processPath,
      result.processCommandLine,
      result.parentProcessName,
      result.parentProcessPath,
      result.parentProcessCommandLine,
    ]).toEqual(["", "", "", "", "", ""]);
  });
});

/*
 * A Process Activity that gives only its activity_id is named by it, so
 * the event says it was an open or an injection wherever it is read: the
 * event's panel and the Activity facet, and the SIEM it is sent to.
 */
describe("a Process Activity's activity name", () => {
  test.each<[number, string]>([
    [0, "Unknown"],
    [1, "Launch"],
    [2, "Terminate"],
    [3, "Open"],
    [4, "Inject"],
    [5, "Set User ID"],
    [99, "Other"],
  ])("activity_id %i alone is named %j", (activityId: number, name: string) => {
    expect(
      OcsfNormalizer.normalize({ class_uid: 1007, activity_id: activityId })
        .activityName,
    ).toBe(name);
  });

  test("an activity_id given as text is named too", () => {
    expect(
      OcsfNormalizer.normalize({ class_uid: 1007, activity_id: "4" })
        .activityName,
    ).toBe("Inject");
  });

  test("the payload's own activity_name is kept as it is written", () => {
    expect(
      OcsfNormalizer.normalize({
        class_uid: 1007,
        activity_id: 3,
        activity_name: "Open (handle)",
      }).activityName,
    ).toBe("Open (handle)");
  });

  test("an id OCSF does not define leaves the name empty", () => {
    expect(
      OcsfNormalizer.normalize({ class_uid: 1007, activity_id: 42 })
        .activityName,
    ).toBe("");
  });

  test("an event that names no activity at all is left unnamed", () => {
    expect(OcsfNormalizer.normalize({ class_uid: 1007 }).activityName).toBe("");
  });

  test("other classes are named only by their payload", () => {
    expect(
      OcsfNormalizer.normalize({ class_uid: 3002, activity_id: 1 })
        .activityName,
    ).toBe("");
    expect(
      OcsfNormalizer.normalize({ class_uid: 4001, activity_id: 3 })
        .activityName,
    ).toBe("");
  });

  test("an injection named by its id reads its processes as an injection, never as a launch", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 1007,
      activity_id: 4,
      actor: { process: { name: "loader.exe" } },
      process: {
        name: "explorer.exe",
        parent_process: { name: "userinit.exe" },
      },
    });

    expect(result.activityName).toBe("Inject");
    expect(result.parentProcessName).toBe("userinit.exe");
    expect(result.principalProcess).toBe("loader.exe");
  });

  test("an activity named constructor is no launch: the actor is not taken for the parent", () => {
    const result: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 1007,
      activity_name: "constructor",
      actor: { process: { name: "loader.exe" } },
      process: { name: "explorer.exe" },
    });

    expect(result.activityName).toBe("constructor");
    expect(result.parentProcessName).toBe("");
  });
});
