import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import { ProcessReading, fileNameOfPath } from "../NormalizerHelpers";
import {
  SecurityLogLine,
  buildLogSecurityEvent,
  cutText,
  readLogHost,
  readPort,
  readRemoteIpAddress,
} from "./SecurityLogLine";
import { WindowsEventRecord, readWindowsEventRecord } from "./WindowsEventRecord";

/*
 * Windows events that matter to a security team, from the Security,
 * System, Sysmon, Microsoft Defender and PowerShell logs
 * (WindowsEventRecord reads every way they arrive):
 *
 *   - sign-ins: failed ones (4625, 4771), and the successful ones a person
 *     made - at the keyboard, over Remote Desktop, with cached or explicit
 *     credentials (4624 logon types 2, 8, 9, 10, 11, 12 and 13; 4648).
 *     Network and service logons, most of a domain controller's log,
 *     stay logs.
 *   - processes started (4688, Sysmon 1), with their command lines, which
 *     the rule library's endpoint rules read;
 *   - accounts and groups changed (4720-4767), services installed (4697,
 *     7045) or disabled (7040), scheduled tasks (4698-4702), the audit
 *     policy changed (4719) and logs cleared (1102, 104);
 *   - everything Sysmon records but a process ending;
 *   - what Microsoft Defender found, did and failed to do, and its
 *     protection being turned off;
 *   - script blocks PowerShell itself flagged as suspicious (4104, logged
 *     as a warning).
 *
 * The event keeps every field under its Windows name (TargetUserName,
 * LogonType, CommandLine, GrantedAccess) beside EventID, Channel and
 * Provider_Name: Sigma reads any field it has no column for by that name,
 * so rules written for Windows - the rule library's and SigmaHQ's - match
 * as written. Each provider and event id here is in the line as written,
 * which is what the log scan asks the database for
 * (WINDOWS_PREFILTER_GROUPS).
 */

export const WINDOWS_PROVIDERS: {
  securityAuditing: string;
  eventLog: string;
  serviceControlManager: string;
  sysmon: string;
  defender: string;
  powerShell: string;
} = {
  securityAuditing: "Microsoft-Windows-Security-Auditing",
  eventLog: "Microsoft-Windows-Eventlog",
  serviceControlManager: "Service Control Manager",
  sysmon: "Microsoft-Windows-Sysmon",
  defender: "Microsoft-Windows-Windows Defender",
  powerShell: "Microsoft-Windows-PowerShell",
};

// OCSF classes the events land in.
const AUTHENTICATION: number = 3002;
const ACCOUNT_CHANGE: number = 3001;
const GROUP_MANAGEMENT: number = 3006;
const PROCESS_ACTIVITY: number = 1007;
const FILE_ACTIVITY: number = 1001;
const KERNEL_EXTENSION_ACTIVITY: number = 1003;
const MODULE_ACTIVITY: number = 1005;
const SCHEDULED_JOB_ACTIVITY: number = 1006;
const EVENT_LOG_ACTIVITY: number = 1008;
const SCRIPT_ACTIVITY: number = 1009;
const DETECTION_FINDING: number = 2004;
const NETWORK_ACTIVITY: number = 4001;
const DNS_ACTIVITY: number = 4003;
const APPLICATION_LIFECYCLE: number = 6002;
const REGISTRY_KEY_ACTIVITY: number = 201001;
const REGISTRY_VALUE_ACTIVITY: number = 201002;

// 4624's logon types a person made, by the words a sign-in is told with.
export const KEPT_LOGON_TYPES: Record<string, string> = {
  "2": "at the keyboard",
  "8": "over the network with a cleartext password",
  "9": "with new credentials",
  "10": "over Remote Desktop",
  "11": "with cached credentials",
  "12": "over Remote Desktop with cached credentials",
  "13": "to unlock with cached credentials",
};

// Every logon type, by the words a failed sign-in is told with.
const LOGON_TYPE_WORDS: Record<string, string> = {
  ...KEPT_LOGON_TYPES,
  "3": "over the network",
  "4": "as a batch job",
  "5": "as a service",
  "7": "to unlock",
};

/*
 * Why a sign-in failed, by its NTSTATUS (4625's SubStatus, else Status) or
 * Kerberos code (4771's Status), in the words a person reads.
 */
export const WINDOWS_FAILURE_REASONS: Record<string, string> = {
  "0xc000006a": "wrong password",
  "0xc0000064": "no such user",
  "0xc0000234": "account locked out",
  "0xc0000072": "account disabled",
  "0xc000006f": "outside the allowed hours",
  "0xc0000070": "not allowed from this workstation",
  "0xc0000071": "password expired",
  "0xc0000193": "account expired",
  "0xc0000133": "clocks out of sync",
  "0xc0000224": "must change password",
  "0xc000015b": "logon type not allowed",
  "0xc000005e": "no logon server available",
  "0xc0000413": "blocked by the authentication firewall",
  "0x12": "account disabled, locked out or expired",
  "0x17": "password expired",
  "0x18": "wrong password",
  "0x25": "clocks out of sync",
};

// Groups whose members administer a machine or a domain.
export const PRIVILEGED_WINDOWS_GROUPS: ReadonlyArray<string> = [
  "administrators",
  "domain admins",
  "enterprise admins",
  "schema admins",
  "account operators",
  "backup operators",
  "server operators",
  "print operators",
  "dnsadmins",
  "group policy creator owners",
  "enterprise key admins",
  "key admins",
  "remote desktop users",
];

/*
 * Accounts Windows itself runs as. A logon by one is the machine at work,
 * not a person, and is left out of the successful sign-ins kept.
 */
const SERVICE_ACCOUNT_NAMES: ReadonlyArray<string> = [
  "system",
  "local service",
  "network service",
  "anonymous logon",
];

const SERVICE_ACCOUNT_PREFIXES: ReadonlyArray<string> = ["dwm-", "umfd-"];

// Defender's own severity words, as OCSF's.
const DEFENDER_SEVERITIES: Record<string, OcsfSeverity> = {
  severe: OcsfSeverity.Critical,
  high: OcsfSeverity.High,
  moderate: OcsfSeverity.Medium,
  medium: OcsfSeverity.Medium,
  low: OcsfSeverity.Low,
};

interface WindowsEventReading {
  classUid: number;
  className?: string | undefined;
  activityName: string;
  statusName: string;
  severity: OcsfSeverity;
  message: string;
  principalUser?: string | undefined;
  principalHost?: string | undefined;
  principalIp?: string | undefined;
  principalProcess?: string | undefined;
  process?: ProcessReading | undefined;
  parentProcess?: ProcessReading | undefined;
  targetUser?: string | undefined;
  targetHost?: string | undefined;
  targetIp?: string | undefined;
  targetPort?: number | undefined;
  targetResource?: string | undefined;
  ruleName?: string | undefined;
  mitreTactics?: Array<string> | undefined;
  mitreTechniques?: Array<string> | undefined;
}

type EventReader = (event: WindowsEvent) => WindowsEventReading | null;

/*
 * One record as the readers below see it: its fields by name, with the
 * "-" Windows writes for "none" read as empty.
 */
class WindowsEvent {
  public record: WindowsEventRecord;
  public computer: string;

  public constructor(record: WindowsEventRecord, computer: string) {
    this.record = record;
    this.computer = computer;
  }

  public field(name: string): string {
    const value: string = (this.record.data[name] || "").trim();

    return value === "-" ? "" : value;
  }

  public firstField(names: ReadonlyArray<string>): string {
    for (const name of names) {
      const value: string = this.field(name);

      if (value) {
        return value;
      }
    }

    return "";
  }
}

function isMachineAccount(name: string): boolean {
  return name.trim().endsWith("$");
}

function isServiceAccount(name: string): boolean {
  const lower: string = name.trim().toLowerCase();

  return (
    !lower ||
    isMachineAccount(lower) ||
    SERVICE_ACCOUNT_NAMES.includes(lower) ||
    SERVICE_ACCOUNT_PREFIXES.some((prefix: string): boolean => {
      return lower.startsWith(prefix);
    })
  );
}

function failureReason(event: WindowsEvent): string {
  for (const code of [
    event.field("SubStatus"),
    event.field("Status"),
    event.field("FailureCode"),
  ]) {
    const reason: string | undefined =
      WINDOWS_FAILURE_REASONS[code.toLowerCase()];

    if (reason) {
      return reason;
    }
  }

  return "";
}

// "CN=Bob Smith,OU=Staff,DC=corp,DC=example" -> "Bob Smith".
export function commonNameOf(distinguishedName: string): string {
  const value: string = distinguishedName.trim();

  if (!value.toUpperCase().startsWith("CN=")) {
    return value;
  }

  let end: number = 3;

  while (end < value.length) {
    if (value.charAt(end) === "\\") {
      end += 2;
      continue;
    }

    if (value.charAt(end) === ",") {
      break;
    }

    end++;
  }

  return value.slice(3, end).split("\\").join("");
}

// "file:_C:\\Users\\a\\x.exe" (Defender's Path) -> "C:\\Users\\a\\x.exe".
function defenderPath(path: string): string {
  const first: string = path.split(";")[0] || "";
  const underscore: number = first.indexOf("_");

  return underscore !== -1 && underscore < 16
    ? first.slice(underscore + 1).trim()
    : first.trim();
}

// The words a message joins a user's name and domain with, when both are known.
function withDomain(user: string, domain: string): string {
  return domain && user && !user.includes("\\") && !user.includes("@")
    ? `${domain}\\${user}`
    : user;
}

// ---------------------------------------------------------------- Security

function signInSuccess(event: WindowsEvent): WindowsEventReading | null {
  const logonType: string = event.field("LogonType");
  const user: string = event.field("TargetUserName");

  if (!KEPT_LOGON_TYPES[logonType] || isServiceAccount(user)) {
    return null;
  }

  const ip: string = readRemoteIpAddress(event.field("IpAddress"));
  const workstation: string = event.field("WorkstationName");

  return {
    classUid: AUTHENTICATION,
    activityName: "Logon",
    statusName: "Success",
    severity: OcsfSeverity.Informational,
    message: `${withDomain(user, event.field("TargetDomainName"))} signed in to ${event.computer || "Windows"} ${KEPT_LOGON_TYPES[logonType]}${ip ? ` from ${ip}` : ""}`,
    principalUser: user,
    principalIp: ip,
    principalHost: workstation,
    targetHost: event.computer,
    process: { path: event.field("ProcessName") },
  };
}

function signInFailure(event: WindowsEvent): WindowsEventReading {
  const user: string = event.field("TargetUserName");
  const ip: string = readRemoteIpAddress(event.field("IpAddress"));
  const reason: string = failureReason(event);
  const how: string = LOGON_TYPE_WORDS[event.field("LogonType")] || "";

  return {
    classUid: AUTHENTICATION,
    activityName: "Logon",
    statusName: "Failure",
    severity: OcsfSeverity.Low,
    message: `Failed sign-in${user ? ` for ${withDomain(user, event.field("TargetDomainName"))}` : ""} to ${event.computer || "Windows"}${how ? ` ${how}` : ""}${ip ? ` from ${ip}` : ""}${reason ? `: ${reason}` : ""}`,
    principalUser: user,
    principalIp: ip,
    principalHost: event.field("WorkstationName"),
    targetHost: event.computer,
    process: { path: event.field("ProcessName") },
  };
}

function explicitCredentials(event: WindowsEvent): WindowsEventReading | null {
  const subject: string = event.field("SubjectUserName");
  const target: string = event.field("TargetUserName");

  if (isMachineAccount(subject) || !target) {
    return null;
  }

  const server: string = event.field("TargetServerName");
  const ip: string = readRemoteIpAddress(event.field("IpAddress"));

  return {
    classUid: AUTHENTICATION,
    activityName: "Logon",
    statusName: "Success",
    severity: OcsfSeverity.Informational,
    message: `${subject || "Someone"} signed in as ${withDomain(target, event.field("TargetDomainName"))}${server && server !== "localhost" ? ` on ${server}` : ""} with explicit credentials`,
    principalUser: subject,
    principalIp: ip,
    principalHost: event.computer,
    targetUser: target,
    targetHost: server,
    process: { path: event.field("ProcessName") },
  };
}

function kerberosFailure(event: WindowsEvent): WindowsEventReading {
  const user: string = event.field("TargetUserName");
  const ip: string = readRemoteIpAddress(event.field("IpAddress"));
  const reason: string = failureReason(event);

  return {
    classUid: AUTHENTICATION,
    activityName: "Logon",
    statusName: "Failure",
    severity: OcsfSeverity.Low,
    message: `Kerberos pre-authentication failed${user ? ` for ${user}` : ""}${ip ? ` from ${ip}` : ""}${reason ? `: ${reason}` : ""}`,
    principalUser: user,
    principalIp: ip,
    targetHost: event.computer,
  };
}

function processCreated(event: WindowsEvent): WindowsEventReading {
  const target: string = event.field("TargetUserName");
  const subject: string = event.field("SubjectUserName");
  // The account the process runs as, else the one that started it.
  const user: string = target || subject;
  const path: string = event.field("NewProcessName");
  const parent: string = event.field("ParentProcessName");

  return {
    classUid: PROCESS_ACTIVITY,
    activityName: "Launch",
    statusName: "Success",
    severity: OcsfSeverity.Informational,
    message: `${fileNameOfPath(path) || "A process"} started on ${event.computer || "Windows"}${user ? ` as ${user}` : ""}`,
    principalUser: user,
    principalHost: event.computer,
    principalProcess: fileNameOfPath(parent),
    process: { path, commandLine: event.field("CommandLine") },
    parentProcess: { path: parent },
  };
}

function serviceInstalled(event: WindowsEvent): WindowsEventReading {
  const name: string = event.field("ServiceName");
  const path: string = event.firstField(["ServiceFileName", "ImagePath"]);
  const subject: string = event.field("SubjectUserName");

  return {
    classUid: APPLICATION_LIFECYCLE,
    activityName: "Install",
    statusName: "Success",
    severity: OcsfSeverity.Low,
    message: `Service ${name ? `"${name}" ` : ""}installed on ${event.computer || "Windows"}${path ? `: ${path}` : ""}`,
    principalUser: isMachineAccount(subject) ? "" : subject,
    principalHost: event.computer,
    targetResource: name,
    /*
     * What the service runs, as written: a path and its arguments, or a
     * command (%COMSPEC% /c powershell -enc ...) - a command line, which is
     * what the endpoint rules read.
     */
    process: { commandLine: path },
    mitreTactics: ["TA0003"],
    mitreTechniques: ["T1543.003"],
  };
}

function serviceDisabled(event: WindowsEvent): WindowsEventReading | null {
  // param1 the service, param2 the old start type, param3 the new one.
  const name: string = event.firstField(["param1", "ServiceName"]);
  const newType: string = event.firstField(["param3", "NewStartType"]);

  if (!newType.toLowerCase().includes("disabled")) {
    return null;
  }

  return {
    classUid: APPLICATION_LIFECYCLE,
    activityName: "Disable",
    statusName: "Success",
    severity: OcsfSeverity.Low,
    message: `Service ${name ? `"${name}" ` : ""}disabled on ${event.computer || "Windows"}`,
    principalHost: event.computer,
    targetResource: name,
  };
}

function scheduledTask(activity: string, verb: string): EventReader {
  return (event: WindowsEvent): WindowsEventReading => {
    const task: string = event.field("TaskName");
    const subject: string = event.field("SubjectUserName");

    return {
      classUid: SCHEDULED_JOB_ACTIVITY,
      activityName: activity,
      statusName: "Success",
      severity:
        activity === "Create" ? OcsfSeverity.Low : OcsfSeverity.Informational,
      message: `Scheduled task ${task ? `"${task}" ` : ""}${verb} on ${event.computer || "Windows"}${subject && !isMachineAccount(subject) ? ` by ${subject}` : ""}`,
      principalUser: isMachineAccount(subject) ? "" : subject,
      principalHost: event.computer,
      targetResource: task,
      ...(activity === "Create"
        ? { mitreTactics: ["TA0003"], mitreTechniques: ["T1053.005"] }
        : {}),
    };
  };
}

function auditPolicyChanged(event: WindowsEvent): WindowsEventReading {
  const subject: string = event.field("SubjectUserName");

  return {
    classUid: EVENT_LOG_ACTIVITY,
    activityName: "Update",
    statusName: "Success",
    severity: OcsfSeverity.Medium,
    message: `Audit policy changed on ${event.computer || "Windows"}${subject && !isMachineAccount(subject) ? ` by ${subject}` : ""}`,
    principalUser: isMachineAccount(subject) ? "" : subject,
    principalHost: event.computer,
    targetResource: event.firstField(["SubcategoryGuid", "CategoryId"]),
    mitreTactics: ["TA0112"],
    mitreTechniques: ["T1685"],
  };
}

function accountChanged(
  activity: string,
  verb: string,
  severity: OcsfSeverity,
): EventReader {
  return (event: WindowsEvent): WindowsEventReading => {
    const subject: string = event.field("SubjectUserName");
    const target: string = event.field("TargetUserName");

    return {
      classUid: ACCOUNT_CHANGE,
      activityName: activity,
      statusName: "Success",
      severity,
      message: `Account ${target ? `${withDomain(target, event.field("TargetDomainName"))} ` : ""}${verb} on ${event.computer || "Windows"}${subject && !isMachineAccount(subject) ? ` by ${subject}` : ""}`,
      principalUser: isMachineAccount(subject) ? "" : subject,
      principalHost: event.computer,
      targetUser: target,
      ...(activity === "Create"
        ? { mitreTactics: ["TA0003"], mitreTechniques: ["T1136"] }
        : {}),
    };
  };
}

function accountLockedOut(event: WindowsEvent): WindowsEventReading {
  const target: string = event.field("TargetUserName");
  // 4740 names the computer the failed sign-ins came from as TargetDomainName.
  const caller: string = event.field("TargetDomainName");

  return {
    classUid: ACCOUNT_CHANGE,
    activityName: "Lock",
    statusName: "Success",
    severity: OcsfSeverity.Low,
    message: `Account ${target || "unknown"} locked out on ${event.computer || "Windows"}${caller ? ` after failed sign-ins from ${caller}` : ""}`,
    principalHost: caller,
    targetUser: target,
    targetHost: event.computer,
  };
}

function groupMembership(added: boolean): EventReader {
  return (event: WindowsEvent): WindowsEventReading => {
    const subject: string = event.field("SubjectUserName");
    const group: string = event.field("TargetUserName");
    const member: string =
      commonNameOf(event.field("MemberName")) || event.field("MemberSid");
    const isPrivileged: boolean = PRIVILEGED_WINDOWS_GROUPS.includes(
      group.toLowerCase(),
    );

    return {
      classUid: GROUP_MANAGEMENT,
      activityName: added ? "Add User" : "Remove User",
      statusName: "Success",
      severity: added
        ? isPrivileged
          ? OcsfSeverity.Medium
          : OcsfSeverity.Low
        : OcsfSeverity.Informational,
      message: `${member || "A member"} ${added ? "added to" : "removed from"} ${group || "a group"} on ${event.computer || "Windows"}${subject && !isMachineAccount(subject) ? ` by ${subject}` : ""}`,
      principalUser: isMachineAccount(subject) ? "" : subject,
      principalHost: event.computer,
      targetUser: member,
      targetResource: withDomain(group, event.field("TargetDomainName")),
      ...(added
        ? { mitreTactics: ["TA0003"], mitreTechniques: ["T1098"] }
        : {}),
    };
  };
}

function logCleared(logName: string): EventReader {
  return (event: WindowsEvent): WindowsEventReading => {
    const subject: string = event.field("SubjectUserName");

    return {
      classUid: EVENT_LOG_ACTIVITY,
      activityName: "Clear",
      statusName: "Success",
      severity: OcsfSeverity.High,
      message: `The ${event.field("Channel") || logName} log was cleared on ${event.computer || "Windows"}${subject ? ` by ${withDomain(subject, event.field("SubjectDomainName"))}` : ""}`,
      principalUser: subject,
      principalHost: event.computer,
      targetResource: event.field("Channel") || logName,
      mitreTactics: ["TA0005"],
      mitreTechniques: ["T1070.001"],
    };
  };
}

// ---------------------------------------------------------------- Sysmon

function sysmonImage(event: WindowsEvent): string {
  return event.field("Image");
}

function sysmonReading(
  event: WindowsEvent,
  reading: Omit<WindowsEventReading, "statusName" | "principalHost"> & {
    statusName?: string | undefined;
  },
): WindowsEventReading {
  return {
    statusName: "Success",
    principalHost: event.computer,
    principalUser: event.field("User"),
    ...reading,
  };
}

const SYSMON_READERS: Record<number, EventReader> = {
  1: (event: WindowsEvent): WindowsEventReading => {
    const image: string = sysmonImage(event);

    return sysmonReading(event, {
      classUid: PROCESS_ACTIVITY,
      activityName: "Launch",
      severity: OcsfSeverity.Informational,
      message: `${fileNameOfPath(image) || "A process"} started on ${event.computer || "Windows"}${event.field("User") ? ` as ${event.field("User")}` : ""}`,
      principalProcess: fileNameOfPath(event.field("ParentImage")),
      process: { path: image, commandLine: event.field("CommandLine") },
      parentProcess: {
        path: event.field("ParentImage"),
        commandLine: event.field("ParentCommandLine"),
      },
    });
  },
  2: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: FILE_ACTIVITY,
      activityName: "Update",
      severity: OcsfSeverity.Informational,
      message: `A file's creation time was changed on ${event.computer || "Windows"}: ${event.field("TargetFilename")}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("TargetFilename"),
    });
  },
  3: (event: WindowsEvent): WindowsEventReading => {
    const destinationIp: string = event.field("DestinationIp");
    const port: number = readPort(event.field("DestinationPort"));

    return sysmonReading(event, {
      classUid: NETWORK_ACTIVITY,
      activityName: "Open",
      severity: OcsfSeverity.Informational,
      message: `${fileNameOfPath(sysmonImage(event)) || "A process"} on ${event.computer || "Windows"} connected to ${event.field("DestinationHostname") || destinationIp}${port ? `:${port}` : ""}`,
      principalIp: readRemoteIpAddress(event.field("SourceIp")),
      process: { path: sysmonImage(event) },
      targetHost: event.field("DestinationHostname"),
      targetIp: readRemoteIpAddress(destinationIp),
      targetPort: port,
    });
  },
  4: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: 0,
      className: "Sysmon Service Activity",
      activityName: event.field("State") || "Update",
      severity: OcsfSeverity.Low,
      message: `Sysmon's state changed on ${event.computer || "Windows"}${event.field("State") ? `: ${event.field("State")}` : ""}`,
    });
  },
  6: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: KERNEL_EXTENSION_ACTIVITY,
      activityName: "Load",
      severity: OcsfSeverity.Informational,
      message: `Driver loaded on ${event.computer || "Windows"}: ${event.field("ImageLoaded")}`,
      targetResource: event.field("ImageLoaded"),
    });
  },
  7: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: MODULE_ACTIVITY,
      activityName: "Load",
      severity: OcsfSeverity.Informational,
      message: `${fileNameOfPath(sysmonImage(event)) || "A process"} loaded ${fileNameOfPath(event.field("ImageLoaded")) || "a module"} on ${event.computer || "Windows"}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("ImageLoaded"),
    });
  },
  8: (event: WindowsEvent): WindowsEventReading => {
    const source: string = event.field("SourceImage");
    const target: string = event.field("TargetImage");

    return sysmonReading(event, {
      classUid: PROCESS_ACTIVITY,
      activityName: "Inject",
      severity: OcsfSeverity.Low,
      message: `${fileNameOfPath(source) || "A process"} started a thread in ${fileNameOfPath(target) || "another process"} on ${event.computer || "Windows"}`,
      principalUser: event.firstField(["SourceUser", "User"]),
      principalProcess: fileNameOfPath(source),
      process: { path: target },
    });
  },
  9: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: FILE_ACTIVITY,
      activityName: "Read",
      severity: OcsfSeverity.Low,
      message: `${fileNameOfPath(sysmonImage(event)) || "A process"} read ${event.field("Device") || "a disk"} directly on ${event.computer || "Windows"}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("Device"),
    });
  },
  10: (event: WindowsEvent): WindowsEventReading => {
    const source: string = event.field("SourceImage");
    const target: string = event.field("TargetImage");

    return sysmonReading(event, {
      classUid: PROCESS_ACTIVITY,
      activityName: "Open",
      severity: fileNameOfPath(target).toLowerCase() === "lsass.exe"
        ? OcsfSeverity.Medium
        : OcsfSeverity.Informational,
      message: `${fileNameOfPath(source) || "A process"} opened ${fileNameOfPath(target) || "another process"} on ${event.computer || "Windows"}${event.field("GrantedAccess") ? ` (access ${event.field("GrantedAccess")})` : ""}`,
      principalUser: event.firstField(["SourceUser", "User"]),
      principalProcess: fileNameOfPath(source),
      process: { path: target },
    });
  },
  11: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: FILE_ACTIVITY,
      activityName: "Create",
      severity: OcsfSeverity.Informational,
      message: `${fileNameOfPath(sysmonImage(event)) || "A process"} created ${event.field("TargetFilename")} on ${event.computer || "Windows"}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("TargetFilename"),
    });
  },
  12: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: REGISTRY_KEY_ACTIVITY,
      activityName: event.field("EventType") === "DeleteKey" ? "Delete" : "Create",
      severity: OcsfSeverity.Informational,
      message: `Registry key ${event.field("EventType") === "DeleteKey" ? "deleted" : "created"} on ${event.computer || "Windows"}: ${event.field("TargetObject")}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("TargetObject"),
    });
  },
  13: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: REGISTRY_VALUE_ACTIVITY,
      activityName: "Set",
      severity: OcsfSeverity.Informational,
      message: `Registry value set on ${event.computer || "Windows"}: ${event.field("TargetObject")}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("TargetObject"),
    });
  },
  14: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: REGISTRY_KEY_ACTIVITY,
      activityName: "Rename",
      severity: OcsfSeverity.Informational,
      message: `Registry key renamed on ${event.computer || "Windows"}: ${event.field("TargetObject")}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("TargetObject"),
    });
  },
  15: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: FILE_ACTIVITY,
      activityName: "Create",
      severity: OcsfSeverity.Informational,
      message: `A file stream was created on ${event.computer || "Windows"}: ${event.field("TargetFilename")}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("TargetFilename"),
    });
  },
  16: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: 0,
      className: "Sysmon Service Activity",
      activityName: "Update",
      severity: OcsfSeverity.Low,
      message: `Sysmon's configuration changed on ${event.computer || "Windows"}`,
      targetResource: event.field("Configuration"),
    });
  },
  17: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: 0,
      className: "Pipe Activity",
      activityName: "Create",
      severity: OcsfSeverity.Informational,
      message: `${fileNameOfPath(sysmonImage(event)) || "A process"} created pipe ${event.field("PipeName")} on ${event.computer || "Windows"}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("PipeName"),
    });
  },
  18: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: 0,
      className: "Pipe Activity",
      activityName: "Connect",
      severity: OcsfSeverity.Informational,
      message: `${fileNameOfPath(sysmonImage(event)) || "A process"} connected to pipe ${event.field("PipeName")} on ${event.computer || "Windows"}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("PipeName"),
    });
  },
  19: (event: WindowsEvent): WindowsEventReading => {
    return wmiReading(event, "event filter");
  },
  20: (event: WindowsEvent): WindowsEventReading => {
    return wmiReading(event, "event consumer");
  },
  21: (event: WindowsEvent): WindowsEventReading => {
    return wmiReading(event, "consumer bound to a filter");
  },
  22: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: DNS_ACTIVITY,
      activityName: "Query",
      severity: OcsfSeverity.Informational,
      message: `${fileNameOfPath(sysmonImage(event)) || "A process"} on ${event.computer || "Windows"} looked up ${event.field("QueryName")}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("QueryName"),
    });
  },
  23: (event: WindowsEvent): WindowsEventReading => {
    return fileDeleted(event);
  },
  24: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: 0,
      className: "Clipboard Activity",
      activityName: "Update",
      severity: OcsfSeverity.Informational,
      message: `${fileNameOfPath(sysmonImage(event)) || "A process"} changed the clipboard on ${event.computer || "Windows"}`,
      process: { path: sysmonImage(event) },
    });
  },
  25: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: PROCESS_ACTIVITY,
      activityName: "Tamper",
      severity: OcsfSeverity.Medium,
      message: `A process image was tampered with on ${event.computer || "Windows"}: ${sysmonImage(event)}${event.field("Type") ? ` (${event.field("Type")})` : ""}`,
      process: { path: sysmonImage(event) },
    });
  },
  26: (event: WindowsEvent): WindowsEventReading => {
    return fileDeleted(event);
  },
  27: (event: WindowsEvent): WindowsEventReading => {
    return fileBlocked(event, "an executable");
  },
  28: (event: WindowsEvent): WindowsEventReading => {
    return fileBlocked(event, "shredding");
  },
  29: (event: WindowsEvent): WindowsEventReading => {
    return sysmonReading(event, {
      classUid: FILE_ACTIVITY,
      activityName: "Create",
      severity: OcsfSeverity.Low,
      message: `${fileNameOfPath(sysmonImage(event)) || "A process"} wrote an executable on ${event.computer || "Windows"}: ${event.field("TargetFilename")}`,
      process: { path: sysmonImage(event) },
      targetResource: event.field("TargetFilename"),
    });
  },
};

function wmiReading(event: WindowsEvent, what: string): WindowsEventReading {
  return sysmonReading(event, {
    classUid: 0,
    className: "WMI Activity",
    activityName: event.field("Operation") || "Create",
    severity: OcsfSeverity.Low,
    message: `WMI ${what} ${event.field("Operation") ? `${event.field("Operation").toLowerCase()}d` : "changed"} on ${event.computer || "Windows"}${event.field("Name") ? `: ${event.field("Name")}` : ""}`,
    targetResource: event.firstField(["Name", "Consumer", "Filter"]),
    mitreTactics: ["TA0003"],
    mitreTechniques: ["T1546.003"],
  });
}

function fileDeleted(event: WindowsEvent): WindowsEventReading {
  return sysmonReading(event, {
    classUid: FILE_ACTIVITY,
    activityName: "Delete",
    severity: OcsfSeverity.Informational,
    message: `${fileNameOfPath(sysmonImage(event)) || "A process"} deleted ${event.field("TargetFilename")} on ${event.computer || "Windows"}`,
    process: { path: sysmonImage(event) },
    targetResource: event.field("TargetFilename"),
  });
}

function fileBlocked(event: WindowsEvent, what: string): WindowsEventReading {
  return sysmonReading(event, {
    classUid: FILE_ACTIVITY,
    activityName: "Create",
    statusName: "Blocked",
    severity: OcsfSeverity.Medium,
    message: `Sysmon blocked ${what} on ${event.computer || "Windows"}: ${event.field("TargetFilename")}`,
    process: { path: sysmonImage(event) },
    targetResource: event.field("TargetFilename"),
  });
}

// ---------------------------------------------------------------- Defender

function defenderDetection(kind: "found" | "acted" | "failed" | "behavior"): EventReader {
  return (event: WindowsEvent): WindowsEventReading => {
    const threat: string = event.field("Threat Name");
    const path: string = defenderPath(event.field("Path"));
    const severityName: string = event.field("Severity Name").toLowerCase();
    const action: string = event.field("Action Name");
    const user: string = event.field("Detection User");
    const base: OcsfSeverity =
      DEFENDER_SEVERITIES[severityName] || OcsfSeverity.High;
    const severity: OcsfSeverity =
      kind === "failed"
        ? OcsfSeverity.Critical
        : kind === "acted"
          ? OcsfSeverity.Medium
          : base;
    const what: string = threat || "A threat";
    const message: string =
      kind === "found"
        ? `Microsoft Defender found ${what} on ${event.computer || "Windows"}${path ? ` in ${path}` : ""}`
        : kind === "acted"
          ? `Microsoft Defender acted on ${what} on ${event.computer || "Windows"}${action ? `: ${action}` : ""}`
          : kind === "failed"
            ? `Microsoft Defender could not act on ${what} on ${event.computer || "Windows"}${action ? `: ${action}` : ""}`
            : `Microsoft Defender found suspicious behavior on ${event.computer || "Windows"}${threat ? `: ${threat}` : ""}`;

    return {
      classUid: DETECTION_FINDING,
      activityName: "Create",
      statusName:
        kind === "acted"
          ? "Remediated"
          : kind === "failed"
            ? "Failure"
            : "Detected",
      severity,
      message,
      ruleName: threat || "Microsoft Defender detection",
      principalUser: user,
      principalHost: event.computer,
      targetResource: path,
      process: { path: event.field("Process Name") },
    };
  };
}

function defenderProtection(what: string): EventReader {
  return (event: WindowsEvent): WindowsEventReading => {
    return {
      classUid: DETECTION_FINDING,
      activityName: "Create",
      statusName: "Detected",
      severity: OcsfSeverity.High,
      message: `Microsoft Defender ${what} on ${event.computer || "Windows"}`,
      ruleName: `Microsoft Defender ${what}`,
      principalHost: event.computer,
      mitreTactics: ["TA0112"],
      mitreTechniques: ["T1685"],
    };
  };
}

function defenderConfigurationChanged(event: WindowsEvent): WindowsEventReading {
  const setting: string = event.firstField(["New Value", "Feature Name"]);

  return {
    classUid: DETECTION_FINDING,
    activityName: "Create",
    statusName: "Detected",
    severity: OcsfSeverity.Medium,
    message: `Microsoft Defender's configuration changed on ${event.computer || "Windows"}${setting ? `: ${cutText(setting, 300)}` : ""}`,
    ruleName: "Microsoft Defender configuration changed",
    principalHost: event.computer,
    targetResource: setting,
  };
}

function defenderAttackSurface(kind: "blocked" | "audited"): EventReader {
  return (event: WindowsEvent): WindowsEventReading => {
    const path: string = event.firstField(["Path", "Process Name"]);

    return {
      classUid: DETECTION_FINDING,
      activityName: "Create",
      statusName: kind === "blocked" ? "Blocked" : "Detected",
      severity: kind === "blocked" ? OcsfSeverity.Medium : OcsfSeverity.Low,
      message: `Microsoft Defender ${kind === "blocked" ? "blocked" : "would have blocked"} ${fileNameOfPath(event.field("Process Name")) || "a process"} on ${event.computer || "Windows"}${path ? `: ${path}` : ""}`,
      ruleName: "Microsoft Defender attack surface reduction",
      principalUser: event.field("User"),
      principalHost: event.computer,
      process: { path: event.field("Process Name") },
      targetResource: path,
    };
  };
}

// ---------------------------------------------------------------- PowerShell

function suspiciousScriptBlock(event: WindowsEvent): WindowsEventReading | null {
  const level: string = event.record.level.trim().toLowerCase();

  // PowerShell logs a script block it finds suspicious as a warning (level 3).
  if (level !== "warning" && level !== "3") {
    return null;
  }

  const path: string = event.field("Path");

  return {
    classUid: SCRIPT_ACTIVITY,
    activityName: "Execute",
    statusName: "Success",
    severity: OcsfSeverity.Medium,
    message: `PowerShell ran a script block it flagged as suspicious on ${event.computer || "Windows"}${path ? ` from ${path}` : ""}`,
    principalHost: event.computer,
    process: { name: "powershell.exe" },
    targetResource: path,
    mitreTactics: ["TA0002"],
    mitreTechniques: ["T1059.001"],
  };
}

/*
 * The events read, by provider and id. A reader may still pass an event
 * by (a network logon, a service started on demand) by returning null.
 */
const READERS: Record<string, Record<number, EventReader>> = {
  [WINDOWS_PROVIDERS.securityAuditing.toLowerCase()]: {
    4624: signInSuccess,
    4625: signInFailure,
    4648: explicitCredentials,
    4688: processCreated,
    4697: serviceInstalled,
    4698: scheduledTask("Create", "created"),
    4699: scheduledTask("Delete", "deleted"),
    4700: scheduledTask("Enable", "enabled"),
    4701: scheduledTask("Disable", "disabled"),
    4702: scheduledTask("Update", "updated"),
    4719: auditPolicyChanged,
    4720: accountChanged("Create", "created", OcsfSeverity.Low),
    4722: accountChanged("Enable", "enabled", OcsfSeverity.Informational),
    4723: accountChanged(
      "Password Change",
      "had its password changed",
      OcsfSeverity.Informational,
    ),
    4724: accountChanged(
      "Password Reset",
      "had its password reset",
      OcsfSeverity.Low,
    ),
    4725: accountChanged("Disable", "disabled", OcsfSeverity.Low),
    4726: accountChanged("Delete", "deleted", OcsfSeverity.Low),
    4728: groupMembership(true),
    4729: groupMembership(false),
    4732: groupMembership(true),
    4733: groupMembership(false),
    4740: accountLockedOut,
    4756: groupMembership(true),
    4757: groupMembership(false),
    4767: accountChanged("Unlock", "unlocked", OcsfSeverity.Informational),
    4771: kerberosFailure,
    4781: accountChanged("Rename", "renamed", OcsfSeverity.Low),
  },
  [WINDOWS_PROVIDERS.eventLog.toLowerCase()]: {
    1102: logCleared("Security"),
    104: logCleared("System"),
  },
  [WINDOWS_PROVIDERS.serviceControlManager.toLowerCase()]: {
    7045: serviceInstalled,
    7040: serviceDisabled,
  },
  [WINDOWS_PROVIDERS.sysmon.toLowerCase()]: SYSMON_READERS,
  [WINDOWS_PROVIDERS.defender.toLowerCase()]: {
    1006: defenderDetection("found"),
    1116: defenderDetection("found"),
    1007: defenderDetection("acted"),
    1117: defenderDetection("acted"),
    1008: defenderDetection("failed"),
    1118: defenderDetection("failed"),
    1119: defenderDetection("failed"),
    1015: defenderDetection("behavior"),
    5001: defenderProtection("real-time protection turned off"),
    5010: defenderProtection("scanning for spyware turned off"),
    5012: defenderProtection("scanning for viruses turned off"),
    5007: defenderConfigurationChanged,
    1121: defenderAttackSurface("blocked"),
    1122: defenderAttackSurface("audited"),
  },
  [WINDOWS_PROVIDERS.powerShell.toLowerCase()]: {
    4104: suspiciousScriptBlock,
  },
};

/*
 * The event ids read for each provider, as text: what the prefilter asks
 * the database for (4624 has a group of its own, which leaves the logon
 * types not kept out).
 */
export function getWindowsEventIds(provider: string): Array<string> {
  return Object.keys(READERS[provider.toLowerCase()] || {});
}

// 4624's logon types that are never kept: a network, batch, service or unlock logon.
export const NOISY_LOGON_TYPES: ReadonlyArray<string> = ["3", "4", "5", "7"];

/*
 * How a successful sign-in's LogonType reads in each shape it arrives in,
 * lowercase: the collector's OTLP map (with or without the oneof name
 * protobuf adds after the value), a JSON shipper's string or number, and
 * the event's XML.
 */
export function logonTypeMarkers(logonType: string): Array<string> {
  return [
    `"key":"logontype","value":{"stringvalue":"${logonType}"`,
    `"key":"logontype","value":{"string_value":"${logonType}"`,
    `"logontype":"${logonType}"`,
    `"logontype": "${logonType}"`,
    `"logontype":${logonType},`,
    `"logontype":${logonType}}`,
    `"logontype": ${logonType},`,
    `"logontype": ${logonType}}`,
    `name='logontype'>${logonType}<`,
    `name="logontype">${logonType}<`,
  ];
}

export interface WindowsPrefilterGroup {
  requires: string;
  anyOf: ReadonlyArray<string>;
  noneOf?: ReadonlyArray<string> | undefined;
}

/*
 * What the log scan asks the database for, per provider: the provider's
 * name and the ids read. A successful sign-in is asked for apart, leaving
 * out the logon types never kept - a domain controller's log is mostly
 * those. Every line the parser keeps passes one of these.
 */
export const WINDOWS_PREFILTER_GROUPS: ReadonlyArray<WindowsPrefilterGroup> =
  [
    {
      requires: WINDOWS_PROVIDERS.securityAuditing.toLowerCase(),
      anyOf: getWindowsEventIds(WINDOWS_PROVIDERS.securityAuditing).filter(
        (id: string): boolean => {
          return id !== "4624";
        },
      ),
    },
    {
      requires: WINDOWS_PROVIDERS.securityAuditing.toLowerCase(),
      anyOf: ["4624"],
      noneOf: NOISY_LOGON_TYPES.flatMap((logonType: string): Array<string> => {
        return logonTypeMarkers(logonType);
      }),
    },
    {
      requires: WINDOWS_PROVIDERS.eventLog.toLowerCase(),
      anyOf: getWindowsEventIds(WINDOWS_PROVIDERS.eventLog),
    },
    {
      requires: WINDOWS_PROVIDERS.serviceControlManager.toLowerCase(),
      anyOf: getWindowsEventIds(WINDOWS_PROVIDERS.serviceControlManager),
    },
    {
      // Everything Sysmon records is read but a process ending.
      requires: WINDOWS_PROVIDERS.sysmon.toLowerCase(),
      anyOf: [WINDOWS_PROVIDERS.sysmon.toLowerCase()],
    },
    {
      requires: WINDOWS_PROVIDERS.defender.toLowerCase(),
      anyOf: getWindowsEventIds(WINDOWS_PROVIDERS.defender),
    },
    {
      requires: WINDOWS_PROVIDERS.powerShell.toLowerCase(),
      anyOf: getWindowsEventIds(WINDOWS_PROVIDERS.powerShell),
    },
  ];

export default class WindowsEventLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const record: WindowsEventRecord | null = readWindowsEventRecord(
      line.body || "",
    );

    if (!record) {
      return [];
    }

    const providerKey: string = record.provider.trim().toLowerCase();
    const reader: EventReader | undefined =
      READERS[providerKey]?.[record.eventId];

    if (!reader) {
      return [];
    }

    const computer: string = record.computer || readLogHost(line);
    const reading: WindowsEventReading | null = reader(
      new WindowsEvent(record, computer),
    );

    if (!reading) {
      return [];
    }

    const attributes: JSONObject = {
      EventID: String(record.eventId),
      Provider_Name: record.provider,
    };

    if (record.channel) {
      attributes["Channel"] = record.channel;
    }

    if (record.computer) {
      attributes["Computer"] = record.computer;
    }

    if (record.recordId) {
      attributes["EventRecordID"] = record.recordId;
    }

    if (record.level) {
      attributes["Level"] = record.level;
    }

    if (record.keywords) {
      attributes["Keywords"] = cutText(record.keywords, 255);
    }

    if (record.userSid) {
      attributes["UserID"] = record.userSid;
    }

    for (const name of Object.keys(record.data)) {
      // The event's own fields, never in place of the record's.
      if (attributes[name] === undefined) {
        attributes[name] = record.data[name]!;
      }
    }

    return [
      buildLogSecurityEvent({
        line,
        format: SecurityLogFormat.WindowsEvents,
        classUid: reading.classUid,
        className: reading.className,
        activityName: reading.activityName,
        statusName: reading.statusName,
        severity: reading.severity,
        message: reading.message,
        time: record.time || undefined,
        ruleName: reading.ruleName,
        eventUid:
          record.recordId && record.computer
            ? `windows:${record.computer}:${record.channel || providerKey}:${record.recordId}`
            : undefined,
        principalUser: reading.principalUser,
        principalHost: reading.principalHost,
        principalIp: reading.principalIp,
        principalProcess: reading.principalProcess,
        process: reading.process,
        parentProcess: reading.parentProcess,
        targetUser: reading.targetUser,
        targetHost: reading.targetHost,
        targetIp: reading.targetIp,
        targetPort: reading.targetPort,
        targetResource: reading.targetResource,
        attributes,
        mitreTactics: reading.mitreTactics,
        mitreTechniques: reading.mitreTechniques,
      }),
    ];
  }
}
