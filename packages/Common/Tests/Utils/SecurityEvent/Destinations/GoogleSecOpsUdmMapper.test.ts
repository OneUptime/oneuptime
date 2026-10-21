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
        principalProcess: "p".repeat(5000),
        classUid: 1007,
        principalHost: "h",
      }),
    );

    expect(String(read(udm, "metadata.description")).length).toBe(1024);
    expect(String(read(udm, "target.url")).length).toBe(2048);
    expect(String(read(udm, "target.process.commandLine")).length).toBe(2048);
  });

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

    expect(String(read(udm, "target.process.file.fullPath")).length).toBe(
      1024,
    );
  });
});
