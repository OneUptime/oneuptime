import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import {
  UDM_PRODUCT_NAME_FALLBACK,
  UDM_VENDOR_NAME_FALLBACK,
  UdmEventType,
  chooseUdmEventType,
  toUdmEvent,
} from "../../../../Utils/SecurityEvent/Destinations/GoogleSecOpsUdmMapper";
import { SecurityEventRecord } from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import UdmNormalizer from "../../../../Utils/SecurityEvent/UdmNormalizer";
import OcsfNormalizer from "../../../../Utils/SecurityEvent/OcsfNormalizer";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  DETECTION_FINDING,
  NETWORK_CONNECTION,
  SSH_FAILURE,
  SUDO_COMMAND,
  securityEventRecord,
} from "./SecurityEventRecordFixtures";

function read(value: JSONObject, path: string): unknown {
  let current: unknown = value;

  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/*
 * What Google SecOps receives: a UDM event per OneUptime event, given the
 * specific type only when it carries the fields that type needs, so SecOps
 * never refuses an event for a missing field.
 */
describe("chooseUdmEventType", () => {
  test("a sign-in with an account and a machine is USER_LOGIN", () => {
    expect(chooseUdmEventType(SSH_FAILURE)).toBe(UdmEventType.UserLogin);
  });

  test("a sign-in that names no machine is GENERIC_EVENT", () => {
    expect(
      chooseUdmEventType({
        ...SSH_FAILURE,
        principalIp: "",
        targetHost: "",
      }),
    ).toBe(UdmEventType.GenericEvent);
  });

  test("a sign-in that names no account is GENERIC_EVENT", () => {
    expect(chooseUdmEventType({ ...SSH_FAILURE, principalUser: "" })).toBe(
      UdmEventType.GenericEvent,
    );
  });

  test("a command on a host is PROCESS_LAUNCH", () => {
    expect(chooseUdmEventType(SUDO_COMMAND)).toBe(UdmEventType.ProcessLaunch);
  });

  test("a command with no host is GENERIC_EVENT", () => {
    expect(chooseUdmEventType({ ...SUDO_COMMAND, principalHost: "" })).toBe(
      UdmEventType.GenericEvent,
    );
  });

  test("a connection between two machines is NETWORK_CONNECTION", () => {
    expect(chooseUdmEventType(NETWORK_CONNECTION)).toBe(
      UdmEventType.NetworkConnection,
    );
  });

  test("a connection with one end only is GENERIC_EVENT", () => {
    expect(chooseUdmEventType({ ...NETWORK_CONNECTION, targetIp: "" })).toBe(
      UdmEventType.GenericEvent,
    );
  });

  test("an address that is not one does not count as a machine", () => {
    expect(
      chooseUdmEventType({
        ...NETWORK_CONNECTION,
        principalIp: "not-an-ip",
      }),
    ).toBe(UdmEventType.GenericEvent);
  });

  test("a finding is GENERIC_EVENT, its meaning in the security result", () => {
    expect(chooseUdmEventType(DETECTION_FINDING)).toBe(
      UdmEventType.GenericEvent,
    );
  });
});

describe("toUdmEvent", () => {
  test("a failed sign-in: the account on the target, the address on the principal", () => {
    const udm: JSONObject = toUdmEvent(SSH_FAILURE);

    expect(read(udm, "metadata.eventType")).toBe("USER_LOGIN");
    expect(read(udm, "metadata.eventTimestamp")).toBe(
      "2026-10-19T10:00:00.000Z",
    );
    expect(read(udm, "metadata.vendorName")).toBe("OpenSSH");
    expect(read(udm, "metadata.productName")).toBe("SSH");
    expect(read(udm, "metadata.productEventType")).toBe(
      "Authentication / Logon",
    );
    expect(read(udm, "metadata.productLogId")).toBe(
      "log:0192f1a0-0000-7000-8000-00000000aaaa",
    );
    expect(read(udm, "principal.ip")).toEqual(["203.0.113.7"]);
    expect(read(udm, "principal.user")).toBeUndefined();
    expect(read(udm, "target.user.userid")).toBe("admin");
    expect(read(udm, "target.hostname")).toBe("web-03");
    expect(read(udm, "extensions.auth.type")).toBe("AUTHTYPE_UNSPECIFIED");

    const result: JSONObject = (udm["securityResult"] as Array<JSONObject>)[0]!;

    expect(result["severity"]).toBe("LOW");
    expect(result["action"]).toEqual(["FAIL"]);
    expect(result["description"]).toBe(SSH_FAILURE.message);
  });

  test("a command run: the command is the target's process, on the principal's machine", () => {
    const udm: JSONObject = toUdmEvent(SUDO_COMMAND);

    expect(read(udm, "metadata.eventType")).toBe("PROCESS_LAUNCH");
    expect(read(udm, "principal.hostname")).toBe("web-03");
    expect(read(udm, "principal.user.userid")).toBe("alice");
    expect(read(udm, "principal.process")).toBeUndefined();
    expect(read(udm, "target.process.commandLine")).toBe(
      "/usr/bin/cat /etc/shadow",
    );
    expect(read(udm, "target.user.userid")).toBe("root");
    expect(read(udm, "target.hostname")).toBe("web-03");
  });

  test("a connection: both ends, the port, and a blocked action", () => {
    const udm: JSONObject = toUdmEvent(NETWORK_CONNECTION);

    expect(read(udm, "metadata.eventType")).toBe("NETWORK_CONNECTION");
    expect(read(udm, "principal.ip")).toEqual(["198.51.100.9"]);
    expect(read(udm, "target.ip")).toEqual(["192.0.2.80"]);
    expect(read(udm, "target.port")).toBe(3389);
    expect((udm["securityResult"] as Array<JSONObject>)[0]!["action"]).toEqual([
      "BLOCK",
    ]);
  });

  test("a finding carries its rule, its severity and its ATT&CK tactics and techniques", () => {
    const udm: JSONObject = toUdmEvent(DETECTION_FINDING);
    const result: JSONObject = (udm["securityResult"] as Array<JSONObject>)[0]!;

    expect(result["severity"]).toBe("HIGH");
    expect(result["ruleName"]).toBe("Brute force from one IP address");
    expect(result["ruleId"]).toBe("0192f1a0-0000-7000-8000-00000000r001");
    expect(result["summary"]).toBe("Brute force from one IP address");
    expect(result["attackDetails"]).toEqual({
      tactics: [{ id: "TA0006" }],
      techniques: [{ id: "T1110.001" }],
    });
  });

  test("the event can be found in OneUptime again from SecOps", () => {
    const additional: JSONObject = toUdmEvent(DETECTION_FINDING)[
      "additional"
    ] as JSONObject;

    expect(additional["oneuptime_event_id"]).toBe(DETECTION_FINDING.id);
    expect(additional["oneuptime_event_uid"]).toBe("detection-rule:abc");
    expect(additional["oneuptime_class"]).toBe("Detection Finding");
    expect(additional["oneuptime.detection.match_count"]).toBe("12");
  });

  test.each<[string, string]>([
    ["Unknown", "UNKNOWN_SEVERITY"],
    ["Informational", "INFORMATIONAL"],
    ["Low", "LOW"],
    ["Medium", "MEDIUM"],
    ["High", "HIGH"],
    ["Critical", "CRITICAL"],
    ["Fatal", "CRITICAL"],
    ["Other", "UNKNOWN_SEVERITY"],
    ["something else", "UNKNOWN_SEVERITY"],
  ])("severity %s is UDM %s", (severityName: string, expected: string) => {
    const result: JSONObject = (
      toUdmEvent(securityEventRecord({ severityName }))[
        "securityResult"
      ] as Array<JSONObject>
    )[0]!;

    expect(result["severity"]).toBe(expected);
  });

  test.each<[string, string | undefined]>([
    ["Success", "ALLOW"],
    ["Allowed", "ALLOW"],
    ["Failure", "FAIL"],
    ["Blocked", "BLOCK"],
    ["Denied", "BLOCK"],
    ["Quarantined", "QUARANTINE"],
    ["", undefined],
    ["Pending", undefined],
  ])(
    "status %j is action %j",
    (statusName: string, action: string | undefined) => {
      const result: JSONObject = (
        toUdmEvent(securityEventRecord({ statusName }))[
          "securityResult"
        ] as Array<JSONObject>
      )[0]!;

      expect(result["action"]).toEqual(action ? [action] : undefined);
    },
  );

  test("an event with no vendor or product says it is OneUptime's", () => {
    const udm: JSONObject = toUdmEvent(
      securityEventRecord({ vendorName: "", productName: "" }),
    );

    expect(read(udm, "metadata.vendorName")).toBe(UDM_VENDOR_NAME_FALLBACK);
    expect(read(udm, "metadata.productName")).toBe(UDM_PRODUCT_NAME_FALLBACK);
  });

  test("an email address as a user is also its email address", () => {
    const udm: JSONObject = toUdmEvent({
      ...SUDO_COMMAND,
      principalUser: "alice@example.com",
    });

    expect(read(udm, "principal.user.emailAddresses")).toEqual([
      "alice@example.com",
    ]);
  });

  test("a URL target is a URL, anything else a resource", () => {
    expect(
      read(
        toUdmEvent(securityEventRecord({ targetResource: "/login?x=1" })),
        "target.url",
      ),
    ).toBe("/login?x=1");
    expect(
      read(
        toUdmEvent(
          securityEventRecord({ targetResource: "pods/exec default/web" }),
        ),
        "target.resource.name",
      ),
    ).toBe("pods/exec default/web");
  });

  test("an invalid port or address is left out rather than refused", () => {
    const udm: JSONObject = toUdmEvent(
      securityEventRecord({
        targetHost: "db",
        targetPort: 70000,
        principalIp: "999.1.1.1",
      }),
    );

    expect(read(udm, "target.port")).toBeUndefined();
    expect(read(udm, "principal")).toBeUndefined();
  });

  test("long text is cut to what UDM fields take", () => {
    const udm: JSONObject = toUdmEvent(
      securityEventRecord({
        message: "m".repeat(5000),
        targetResource: "/".concat("r".repeat(5000)),
        principalProcess: "p ".repeat(2500),
        classUid: 1007,
        principalHost: "h",
      }),
    );

    expect(String(read(udm, "metadata.description")).length).toBe(1024);
    expect(String(read(udm, "target.url")).length).toBe(2048);
    expect(String(read(udm, "target.process.commandLine")).length).toBe(2048);
  });

  test("a long executable and name are cut to what UDM fields take", () => {
    const udm: JSONObject = toUdmEvent(
      securityEventRecord({
        classUid: 1007,
        principalHost: "h",
        principalProcess: "p".repeat(5000),
      }),
    );

    expect(String(read(udm, "target.process.file.fullPath")).length).toBe(1024);
    expect(
      (read(udm, "target.process.file.names") as Array<string>)[0]!.length,
    ).toBe(256);
  });

  test.each<[string]>([
    ["constructor"],
    ["toString"],
    ["__proto__"],
    ["hasOwnProperty"],
  ])(
    "a status written %j is no action: every action SecOps reads is one it takes",
    (statusName: string) => {
      const result: JSONObject = (
        toUdmEvent(securityEventRecord({ statusName }))[
          "securityResult"
        ] as Array<JSONObject>
      )[0]!;

      expect(result["action"]).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("null");
    },
  );

  test.each<[string]>([["constructor"], ["toString"], ["__proto__"]])(
    "a severity written %j is UNKNOWN_SEVERITY",
    (severityName: string) => {
      const result: JSONObject = (
        toUdmEvent(securityEventRecord({ severityName }))[
          "securityResult"
        ] as Array<JSONObject>
      )[0]!;

      expect(result["severity"]).toBe("UNKNOWN_SEVERITY");
    },
  );

  test("a hundred attributes are cut to the forty an event carries", () => {
    const attributes: Record<string, string> = {};

    for (let index: number = 0; index < 100; index++) {
      attributes[`k${String(index).padStart(3, "0")}`] = "v".repeat(1000);
    }

    const additional: JSONObject = toUdmEvent(
      securityEventRecord({ attributes }),
    )["additional"] as JSONObject;

    expect(Object.keys(additional).length).toBeLessThanOrEqual(40);

    for (const value of Object.values(additional)) {
      expect(String(value).length).toBeLessThanOrEqual(512);
    }
  });

  test("forcing GENERIC_EVENT drops the login extension a USER_LOGIN carries", () => {
    const udm: JSONObject = toUdmEvent(SSH_FAILURE, UdmEventType.GenericEvent);

    expect(read(udm, "metadata.eventType")).toBe("GENERIC_EVENT");
    expect(udm["extensions"]).toBeUndefined();
    // The account stays with the actor when the event is not a login.
    expect(read(udm, "principal.user.userid")).toBe("admin");
  });
});

/*
 * OneUptime reads UDM too (the Google SecOps connector and the ingest
 * endpoint's udm format). What it sends must read back as the same event:
 * a round trip keeps the class, the status, the people and the places.
 */
describe("what OneUptime sends, OneUptime reads back the same", () => {
  test.each<[string, SecurityEventRecord]>([
    ["a failed sign-in", SSH_FAILURE],
    ["a command run", SUDO_COMMAND],
    ["a blocked connection", NETWORK_CONNECTION],
  ])("%s", (_name: string, record: SecurityEventRecord) => {
    const readBack: NormalizedSecurityEvent | null = UdmNormalizer.normalize(
      toUdmEvent(record),
    );

    expect(readBack?.classUid).toBe(record.classUid);
    expect(readBack?.time.toISOString()).toBe(record.time.toISOString());
    expect(readBack?.severityName).toBe(record.severityName);
    expect(readBack?.observables.length).toBeGreaterThan(0);
  });
});

/*
 * A launched process is the target's process in UDM and the process that
 * started it the principal's - the other way round from where OCSF's actor
 * puts the parent. Forwarding the acting process as the launched one would
 * hand SecOps the parent's command line under the child's name.
 */
describe("the process an event is about, forwarded", () => {
  const POWERSHELL_LAUNCH: SecurityEventRecord = securityEventRecord({
    ...SUDO_COMMAND,
    vendorName: "Microsoft",
    productName: "Sysmon",
    principalHost: "wkstn-042",
    principalProcess: "WINWORD.EXE",
    processName: "powershell.exe",
    processPath:
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    processCommandLine: "powershell.exe -nop -enc JABzAD0A",
    parentProcessName: "WINWORD.EXE",
    parentProcessPath:
      "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    parentProcessCommandLine: '"WINWORD.EXE" /n "C:\\Users\\a\\invoice.docm"',
  });

  test("a launch: the process that started is the target's, its parent the principal's", () => {
    const udm: JSONObject = toUdmEvent(POWERSHELL_LAUNCH);

    expect(read(udm, "metadata.eventType")).toBe("PROCESS_LAUNCH");
    expect(read(udm, "target.process.commandLine")).toBe(
      "powershell.exe -nop -enc JABzAD0A",
    );
    expect(read(udm, "target.process.file.fullPath")).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(read(udm, "principal.process.commandLine")).toBe(
      '"WINWORD.EXE" /n "C:\\Users\\a\\invoice.docm"',
    );
    expect(read(udm, "principal.process.file.fullPath")).toBe(
      "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    );
  });

  test("SecOps reads the forwarded launch back as the same process and parent", () => {
    const back: NormalizedSecurityEvent = UdmNormalizer.normalize(
      toUdmEvent(POWERSHELL_LAUNCH),
    );

    expect(back.processCommandLine).toBe(POWERSHELL_LAUNCH.processCommandLine);
    expect(back.processPath).toBe(POWERSHELL_LAUNCH.processPath);
    expect(back.processName).toBe("powershell.exe");
    expect(back.parentProcessPath).toBe(POWERSHELL_LAUNCH.parentProcessPath);
    expect(back.parentProcessCommandLine).toBe(
      POWERSHELL_LAUNCH.parentProcessCommandLine,
    );
  });

  test("any other event: the process that acted is the principal's, with its parent", () => {
    const udm: JSONObject = toUdmEvent(
      securityEventRecord({
        ...NETWORK_CONNECTION,
        principalProcess: "powershell.exe",
        processName: "powershell.exe",
        processPath:
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        processCommandLine: "powershell.exe -nop -enc JABzAD0A",
        parentProcessPath: "C:\\Windows\\System32\\cmd.exe",
        parentProcessCommandLine: "cmd.exe /c start powershell",
      }),
    );

    expect(read(udm, "metadata.eventType")).toBe("NETWORK_CONNECTION");
    expect(read(udm, "principal.process.commandLine")).toBe(
      "powershell.exe -nop -enc JABzAD0A",
    );
    expect(read(udm, "principal.process.parentProcess.file.fullPath")).toBe(
      "C:\\Windows\\System32\\cmd.exe",
    );
    expect(read(udm, "target.process")).toBeUndefined();
  });

  test("a row stored before the process fields still forwards its principalProcess", () => {
    const udm: JSONObject = toUdmEvent(SUDO_COMMAND);

    expect(SUDO_COMMAND.processCommandLine).toBe("");
    expect(read(udm, "target.process.commandLine")).toBe(
      SUDO_COMMAND.principalProcess,
    );
    expect(read(udm, "target.process.file")).toBeUndefined();
  });

  test("a long path is cut to what UDM takes", () => {
    const udm: JSONObject = toUdmEvent(
      securityEventRecord({
        ...POWERSHELL_LAUNCH,
        processPath: `C:\\${"a".repeat(5000)}.exe`,
      }),
    );

    expect(String(read(udm, "target.process.file.fullPath")).length).toBe(1024);
  });
});

/*
 * Every process activity is sent as the activity it is. Google's UDM usage
 * guide: in PROCESS_INJECTION, PROCESS_LAUNCH, PROCESS_OPEN,
 * PROCESS_TERMINATION and PROCESS_UNCATEGORIZED the principal is the
 * machine and the process that acted, and target.process the process
 * injected, opened, launched or ended. Before, every Process Activity went
 * out as a PROCESS_LAUNCH, so an injection into lsass.exe read in SecOps as
 * lsass.exe having been started - by the process that injected into it.
 */
describe("a process activity, sent as the activity it is", () => {
  // mimikatz opening lsass.exe, as OneUptime stores an OCSF Process Activity: Open.
  const LSASS_OPENED: SecurityEventRecord = securityEventRecord({
    categoryUid: 1,
    categoryName: "System Activity",
    classUid: 1007,
    className: "Process Activity",
    activityName: "Open",
    vendorName: "Microsoft",
    productName: "Sysmon",
    principalUser: "CORP\\alice",
    principalHost: "wkstn-042",
    principalProcess: "mimikatz.exe sekurlsa::logonpasswords",
    processName: "lsass.exe",
    processPath: "C:\\Windows\\System32\\lsass.exe",
    parentProcessName: "wininit.exe",
  });

  test.each<[string, UdmEventType]>([
    ["Open", UdmEventType.ProcessOpen],
    ["Inject", UdmEventType.ProcessInjection],
    ["Terminate", UdmEventType.ProcessTermination],
    ["Set User ID", UdmEventType.ProcessUncategorized],
    ["Other", UdmEventType.ProcessUncategorized],
    ["Unknown", UdmEventType.ProcessUncategorized],
    ["Something new", UdmEventType.ProcessUncategorized],
    ["Launch", UdmEventType.ProcessLaunch],
    ["", UdmEventType.ProcessLaunch],
  ])(
    "an activity named %j is %s",
    (activityName: string, type: UdmEventType) => {
      expect(chooseUdmEventType({ ...LSASS_OPENED, activityName })).toBe(type);
    },
  );

  test("activity names are read as ingest reads them, whatever their case", () => {
    expect(
      chooseUdmEventType({ ...LSASS_OPENED, activityName: "INJECT" }),
    ).toBe(UdmEventType.ProcessInjection);
    expect(
      chooseUdmEventType({ ...LSASS_OPENED, activityName: " terminate " }),
    ).toBe(UdmEventType.ProcessTermination);
  });

  /*
   * An OCSF event that gave only its activity_id was stored with no
   * activity name before ingest named it: its attributes keep the id, and
   * ingest read its process fields by that id, so it goes out by it too.
   */
  test.each<[string, UdmEventType]>([
    ["1", UdmEventType.ProcessLaunch],
    ["2", UdmEventType.ProcessTermination],
    ["3", UdmEventType.ProcessOpen],
    ["4", UdmEventType.ProcessInjection],
    ["5", UdmEventType.ProcessUncategorized],
    ["0", UdmEventType.ProcessUncategorized],
    ["99", UdmEventType.ProcessUncategorized],
  ])(
    "a stored event with no activity name and activity_id %s is %s",
    (activityId: string, type: UdmEventType) => {
      expect(
        chooseUdmEventType({
          ...LSASS_OPENED,
          activityName: "",
          attributes: { activity_id: activityId, class_uid: "1007" },
        }),
      ).toBe(type);
    },
  );

  test("the activity id wins over the name, as ingest read the event's processes by it", () => {
    expect(
      chooseUdmEventType({
        ...LSASS_OPENED,
        activityName: "Launch",
        attributes: { activity_id: "4" },
      }),
    ).toBe(UdmEventType.ProcessInjection);
  });

  test("an activity id that is no number leaves the name to decide", () => {
    expect(
      chooseUdmEventType({
        ...LSASS_OPENED,
        activityName: "Open",
        attributes: { activity_id: "three" },
      }),
    ).toBe(UdmEventType.ProcessOpen);
  });

  test("an open: the process that acted is the principal's, the process it opened the target's", () => {
    const udm: JSONObject = toUdmEvent(LSASS_OPENED);

    expect(read(udm, "metadata.eventType")).toBe("PROCESS_OPEN");
    expect(read(udm, "metadata.productEventType")).toBe(
      "Process Activity / Open",
    );
    expect(read(udm, "principal.hostname")).toBe("wkstn-042");
    expect(read(udm, "principal.user.userid")).toBe("CORP\\alice");
    expect(read(udm, "principal.process")).toEqual({
      commandLine: "mimikatz.exe sekurlsa::logonpasswords",
    });
    expect(read(udm, "target.process.file.fullPath")).toBe(
      "C:\\Windows\\System32\\lsass.exe",
    );
    expect(read(udm, "target.process.file.names")).toEqual(["lsass.exe"]);
    // The process opened keeps its own parent - never the one that opened it.
    expect(read(udm, "target.process.parentProcess")).toEqual({
      file: { fullPath: "wininit.exe", names: ["wininit.exe"] },
    });
    // It runs on the principal's machine, which UDM wants on the target's side too.
    expect(read(udm, "target.hostname")).toBe("wkstn-042");
  });

  test.each<[string, string]>([
    ["Inject", "PROCESS_INJECTION"],
    ["Terminate", "PROCESS_TERMINATION"],
    ["Other", "PROCESS_UNCATEGORIZED"],
  ])(
    "%s: the same principal and target as an open",
    (activityName: string, type: string) => {
      const udm: JSONObject = toUdmEvent({ ...LSASS_OPENED, activityName });

      expect(read(udm, "metadata.eventType")).toBe(type);
      expect(read(udm, "principal.process.commandLine")).toBe(
        "mimikatz.exe sekurlsa::logonpasswords",
      );
      expect(read(udm, "target.process.file.fullPath")).toBe(
        "C:\\Windows\\System32\\lsass.exe",
      );
      expect(read(udm, "principal.process.file")).toBeUndefined();
    },
  );

  test("a process that acted, known by its path, is the principal's executable", () => {
    const udm: JSONObject = toUdmEvent({
      ...LSASS_OPENED,
      activityName: "Inject",
      principalProcess: "C:\\Users\\alice\\AppData\\Local\\Temp\\loader.exe",
    });

    expect(read(udm, "principal.process")).toEqual({
      file: {
        fullPath: "C:\\Users\\alice\\AppData\\Local\\Temp\\loader.exe",
        names: ["loader.exe"],
      },
    });
  });

  test("a process that acted, known by its name, is the principal's executable", () => {
    const udm: JSONObject = toUdmEvent({
      ...LSASS_OPENED,
      activityName: "Terminate",
      principalProcess: "taskkill.exe",
    });

    expect(read(udm, "principal.process")).toEqual({
      file: { fullPath: "taskkill.exe", names: ["taskkill.exe"] },
    });
  });

  test("an end with no process that acted still names the process ended", () => {
    const udm: JSONObject = toUdmEvent({
      ...LSASS_OPENED,
      activityName: "Terminate",
      principalProcess: "",
    });

    expect(read(udm, "metadata.eventType")).toBe("PROCESS_TERMINATION");
    expect(read(udm, "principal.process")).toBeUndefined();
    expect(read(udm, "principal.hostname")).toBe("wkstn-042");
    expect(read(udm, "target.process.file.names")).toEqual(["lsass.exe"]);
  });

  test("an activity on another machine keeps that machine as the target's", () => {
    const udm: JSONObject = toUdmEvent({
      ...LSASS_OPENED,
      activityName: "Inject",
      targetHost: "dc-01",
    });

    expect(read(udm, "principal.hostname")).toBe("wkstn-042");
    expect(read(udm, "target.hostname")).toBe("dc-01");
  });

  test("an open that names no machine is GENERIC_EVENT, as before", () => {
    expect(
      chooseUdmEventType({
        ...LSASS_OPENED,
        principalHost: "",
        principalIp: "",
      }),
    ).toBe(UdmEventType.GenericEvent);
  });

  /*
   * The process opened, injected into or ended is the event's own: when the
   * event does not name it, principalProcess - the process that acted - is
   * never taken for it, so no type that names a target process is sent.
   */
  test("an open that does not name the process it opened is GENERIC_EVENT", () => {
    const opened: SecurityEventRecord = {
      ...LSASS_OPENED,
      processName: "",
      processPath: "",
      processCommandLine: "",
    };

    expect(chooseUdmEventType(opened)).toBe(UdmEventType.GenericEvent);
    expect(read(toUdmEvent(opened), "target.process")).toBeUndefined();
  });

  test("an open stored before the process fields is GENERIC_EVENT, never a launch of the process that acted", () => {
    const stored: SecurityEventRecord = {
      ...LSASS_OPENED,
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "",
    };
    const udm: JSONObject = toUdmEvent(stored);

    expect(read(udm, "metadata.eventType")).toBe("GENERIC_EVENT");
    expect(read(udm, "principal.process.commandLine")).toBe(
      "mimikatz.exe sekurlsa::logonpasswords",
    );
    expect(read(udm, "target.process")).toBeUndefined();
  });

  describe("a privilege escalation", () => {
    const ESCALATION: SecurityEventRecord = {
      ...LSASS_OPENED,
      activityName: "Privilege Escalation",
      principalUser: "www-data",
      principalProcess: "/tmp/.x/exploit",
      processName: "bash",
      processPath: "/usr/bin/bash",
      processCommandLine: "/bin/bash -p",
      parentProcessName: "",
    };

    test("with the process that raised its privileges and its user, it is PROCESS_PRIVILEGE_ESCALATION", () => {
      const udm: JSONObject = toUdmEvent(ESCALATION);

      expect(read(udm, "metadata.eventType")).toBe(
        "PROCESS_PRIVILEGE_ESCALATION",
      );
      expect(read(udm, "principal.user.userid")).toBe("www-data");
      expect(read(udm, "principal.process.file.fullPath")).toBe(
        "/tmp/.x/exploit",
      );
      expect(read(udm, "target.process.commandLine")).toBe("/bin/bash -p");
    });

    test("without its user, UDM's check would fail: PROCESS_UNCATEGORIZED", () => {
      expect(chooseUdmEventType({ ...ESCALATION, principalUser: "" })).toBe(
        UdmEventType.ProcessUncategorized,
      );
    });

    test("without the process that raised them, PROCESS_UNCATEGORIZED", () => {
      expect(chooseUdmEventType({ ...ESCALATION, principalProcess: "" })).toBe(
        UdmEventType.ProcessUncategorized,
      );
    });

    test("with neither the process escalated nor what UDM checks, GENERIC_EVENT", () => {
      expect(
        chooseUdmEventType({
          ...ESCALATION,
          principalUser: "",
          processName: "",
          processPath: "",
          processCommandLine: "",
        }),
      ).toBe(UdmEventType.GenericEvent);
    });

    test("with the process that raised them and its user, no process escalated is needed", () => {
      expect(
        chooseUdmEventType({
          ...ESCALATION,
          processName: "",
          processPath: "",
          processCommandLine: "",
        }),
      ).toBe(UdmEventType.ProcessPrivilegeEscalation);
    });
  });

  /*
   * A launch whose source named only the launched process's file name
   * (Defender's evidence without a folder, a CIM process_name) used to go
   * out with principalProcess as the launched process: the parent, in a
   * launch. The launched process is the event's own, by its name.
   */
  test("a launch that names its process only by name sends that process, never its parent, as the launched one", () => {
    const launch: SecurityEventRecord = {
      ...LSASS_OPENED,
      activityName: "Launch",
      principalProcess: "explorer.exe",
      processName: "mimikatz.exe",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "explorer.exe",
    };
    const udm: JSONObject = toUdmEvent(launch);

    expect(read(udm, "metadata.eventType")).toBe("PROCESS_LAUNCH");
    expect(read(udm, "target.process")).toEqual({
      file: { fullPath: "mimikatz.exe", names: ["mimikatz.exe"] },
    });
    expect(read(udm, "principal.process")).toEqual({
      file: { fullPath: "explorer.exe", names: ["explorer.exe"] },
    });
  });

  test("a launch that names only its parent is GENERIC_EVENT: what was launched is not known", () => {
    const launch: SecurityEventRecord = {
      ...LSASS_OPENED,
      activityName: "Launch",
      principalProcess: "WINWORD.EXE",
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "WINWORD.EXE",
    };

    expect(chooseUdmEventType(launch)).toBe(UdmEventType.GenericEvent);
    expect(read(toUdmEvent(launch), "target.process")).toBeUndefined();
  });

  /*
   * What OneUptime sends as a process event, its UDM reader reads back as
   * the same activity, with the same process acted on, its parent, and the
   * process that acted.
   */
  test.each<[string]>([["Open"], ["Inject"], ["Terminate"], ["Other"]])(
    "%s reads back as the same activity and processes",
    (activityName: string) => {
      const back: NormalizedSecurityEvent = UdmNormalizer.normalize(
        toUdmEvent({ ...LSASS_OPENED, activityName }),
      );

      expect(back.classUid).toBe(1007);
      expect(back.activityName).toBe(activityName);
      expect(back.processName).toBe("lsass.exe");
      expect(back.processPath).toBe("C:\\Windows\\System32\\lsass.exe");
      expect(back.parentProcessName).toBe("wininit.exe");
      expect(back.principalProcess).toBe(
        "mimikatz.exe sekurlsa::logonpasswords",
      );
    },
  );

  test("a privilege escalation reads back as one", () => {
    const back: NormalizedSecurityEvent = UdmNormalizer.normalize(
      toUdmEvent({
        ...LSASS_OPENED,
        activityName: "Privilege Escalation",
        principalProcess: "/tmp/.x/exploit",
      }),
    );

    expect(back.activityName).toBe("Privilege Escalation");
    expect(back.principalProcess).toBe("/tmp/.x/exploit");
    expect(back.processName).toBe("lsass.exe");
  });

  test("a launch reads back with the process launched and its parent", () => {
    const back: NormalizedSecurityEvent = UdmNormalizer.normalize(
      toUdmEvent({
        ...LSASS_OPENED,
        activityName: "Launch",
        processName: "mimikatz.exe",
        processPath: "C:\\Users\\alice\\mimikatz.exe",
        processCommandLine: "mimikatz.exe sekurlsa::logonpasswords",
        parentProcessName: "cmd.exe",
        parentProcessPath: "C:\\Windows\\System32\\cmd.exe",
      }),
    );

    expect(back.activityName).toBe("Launch");
    expect(back.processName).toBe("mimikatz.exe");
    expect(back.processPath).toBe("C:\\Users\\alice\\mimikatz.exe");
    expect(back.parentProcessName).toBe("cmd.exe");
    expect(back.parentProcessPath).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});

/*
 * From what a source sends to what SecOps receives: an event ingested as
 * OCSF or as UDM, stored, and forwarded.
 */
describe("a process activity from ingest to Google SecOps", () => {
  function stored(event: NormalizedSecurityEvent): SecurityEventRecord {
    const attributes: Record<string, string> = {};

    for (const key of Object.keys(event.attributes)) {
      attributes[key] = String(event.attributes[key]);
    }

    return securityEventRecord({
      time: event.time,
      eventUid: event.eventUid,
      categoryUid: event.categoryUid,
      categoryName: event.categoryName,
      classUid: event.classUid,
      className: event.className,
      activityName: event.activityName,
      severityId: event.severityId,
      severityName: event.severityName,
      statusName: event.statusName,
      message: event.message,
      vendorName: event.vendorName,
      productName: event.productName,
      principalUser: event.principalUser,
      principalHost: event.principalHost,
      principalIp: event.principalIp,
      principalProcess: event.principalProcess,
      processName: event.processName,
      processPath: event.processPath,
      processCommandLine: event.processCommandLine,
      parentProcessName: event.parentProcessName,
      parentProcessPath: event.parentProcessPath,
      parentProcessCommandLine: event.parentProcessCommandLine,
      targetUser: event.targetUser,
      targetHost: event.targetHost,
      targetIp: event.targetIp,
      targetPort: event.targetPort,
      targetResource: event.targetResource,
      observables: event.observables,
      attributes,
    });
  }

  // Sysmon event 8 (CreateRemoteThread) as OCSF: loader.exe injecting into explorer.exe.
  const OCSF_INJECTION: JSONObject = {
    class_uid: 1007,
    category_uid: 1,
    activity_id: 4,
    severity_id: 4,
    time: 1792574100000,
    metadata: {
      uid: "sysmon-8-1",
      product: { name: "Sysmon", vendor_name: "Microsoft" },
    },
    device: { hostname: "wkstn-042", ip: "10.0.4.42" },
    actor: {
      user: { name: "CORP\\alice" },
      process: {
        name: "loader.exe",
        cmd_line: "loader.exe -q",
        file: { path: "C:\\Users\\alice\\AppData\\Local\\Temp\\loader.exe" },
      },
    },
    process: {
      name: "explorer.exe",
      file: { path: "C:\\Windows\\explorer.exe" },
      parent_process: { name: "userinit.exe" },
    },
  };

  test("an OCSF injection that gives only its activity_id is named, stored and sent as PROCESS_INJECTION", () => {
    const event: NormalizedSecurityEvent =
      OcsfNormalizer.normalize(OCSF_INJECTION);

    expect(event.activityName).toBe("Inject");

    const udm: JSONObject = toUdmEvent(stored(event));

    expect(read(udm, "metadata.eventType")).toBe("PROCESS_INJECTION");
    expect(read(udm, "principal.hostname")).toBe("wkstn-042");
    expect(read(udm, "principal.user.userid")).toBe("CORP\\alice");
    expect(read(udm, "principal.process.file.fullPath")).toBe("loader.exe");
    expect(read(udm, "target.process.file.fullPath")).toBe(
      "C:\\Windows\\explorer.exe",
    );
    expect(read(udm, "target.process.parentProcess.file.names")).toEqual([
      "userinit.exe",
    ]);
  });

  test("the same event stored with no activity name, before ingest named it, is sent the same", () => {
    const event: NormalizedSecurityEvent = {
      ...OcsfNormalizer.normalize(OCSF_INJECTION),
      activityName: "",
    };

    expect(chooseUdmEventType(stored(event))).toBe(
      UdmEventType.ProcessInjection,
    );
  });

  test("an OCSF launch is still a PROCESS_LAUNCH, the actor - its parent - the principal's", () => {
    const event: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      ...OCSF_INJECTION,
      activity_id: 1,
      process: {
        name: "explorer.exe",
        file: { path: "C:\\Windows\\explorer.exe" },
      },
    });
    const udm: JSONObject = toUdmEvent(stored(event));

    expect(event.activityName).toBe("Launch");
    expect(read(udm, "metadata.eventType")).toBe("PROCESS_LAUNCH");
    expect(read(udm, "target.process.file.fullPath")).toBe(
      "C:\\Windows\\explorer.exe",
    );
    expect(read(udm, "principal.process.commandLine")).toBe("loader.exe -q");
    expect(read(udm, "principal.process.file.fullPath")).toBe(
      "C:\\Users\\alice\\AppData\\Local\\Temp\\loader.exe",
    );
  });

  test.each<[string]>([
    ["PROCESS_LAUNCH"],
    ["PROCESS_OPEN"],
    ["PROCESS_INJECTION"],
    ["PROCESS_TERMINATION"],
    ["PROCESS_UNCATEGORIZED"],
    ["PROCESS_PRIVILEGE_ESCALATION"],
  ])("a UDM %s read in is sent out as the same type", (eventType: string) => {
    const event: NormalizedSecurityEvent = UdmNormalizer.normalize({
      metadata: {
        event_type: eventType,
        event_timestamp: "2026-10-21T09:15:00Z",
        product_name: "Falcon",
        vendor_name: "CrowdStrike",
      },
      principal: {
        hostname: "wkstn-042",
        user: { userid: "alice" },
        process: {
          file: { full_path: "C:\\Users\\alice\\loader.exe" },
          command_line: "loader.exe -q",
        },
      },
      target: {
        process: {
          file: { full_path: "C:\\Windows\\explorer.exe" },
          parent_process: { file: { full_path: "C:\\Windows\\userinit.exe" } },
        },
      },
    });

    expect(read(toUdmEvent(stored(event)), "metadata.eventType")).toBe(
      eventType,
    );
  });
});

describe("every type the mapper writes", () => {
  test("is chosen for some event, so each one the docs name is one SecOps gets", () => {
    const process: Partial<SecurityEventRecord> = {
      classUid: 1007,
      principalHost: "wkstn-042",
      principalUser: "alice",
      principalProcess: "loader.exe -q",
      processName: "explorer.exe",
    };
    const chosen: Set<UdmEventType> = new Set<UdmEventType>(
      [
        SSH_FAILURE,
        NETWORK_CONNECTION,
        DETECTION_FINDING,
        securityEventRecord({ ...process, activityName: "Launch" }),
        securityEventRecord({ ...process, activityName: "Open" }),
        securityEventRecord({ ...process, activityName: "Inject" }),
        securityEventRecord({ ...process, activityName: "Terminate" }),
        securityEventRecord({
          ...process,
          activityName: "Privilege Escalation",
        }),
        securityEventRecord({ ...process, activityName: "Other" }),
      ].map(chooseUdmEventType),
    );

    expect(Array.from(chosen).sort()).toEqual(
      Object.values(UdmEventType).sort(),
    );
  });
});
