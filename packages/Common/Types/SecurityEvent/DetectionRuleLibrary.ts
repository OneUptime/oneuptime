import { DetectionRuleDataKind } from "./DetectionRuleDataKind";

/*
 * The rule library: ready-made detection rules a project adds with one click
 * instead of writing Sigma from nothing.
 *
 * Every rule is written against the fields OneUptime stores - the typed
 * columns every source is normalized into (className, statusName,
 * principalUser, and CommandLine, which reads the command line of the
 * process an event is about, ...) or the source's own attribute keys where
 * only one product says it (Okta's `eventType`, CloudTrail's `eventName`,
 * Kubernetes audit's `objectRef.resource`) - so a rule added here matches
 * the events the project already has, with no field mapping.
 * Each one parses and compiles in the engine's own tests.
 *
 * A rule's Sigma `id` is its identity: a project's detection rule whose
 * YAML carries the same id is "this library rule, added", which is how the
 * library shows what a project already has.
 *
 * Some rules are Sigma correlations (SigmaCorrelation.ts) - a sequence, or
 * the first time a user or host shows a value - written whole in one YAML
 * with the rules they read, so adding one adds everything it needs. Their
 * YAML holds their grouping, so they set no Group By Field of their own.
 */

export enum DetectionRuleLibraryCategory {
  Identity = "Identity",
  Endpoint = "Endpoint",
  Cloud = "Cloud",
  Network = "Network",
  Web = "Web",
  Kubernetes = "Kubernetes",
}

export const DETECTION_RULE_LIBRARY_CATEGORIES: ReadonlyArray<DetectionRuleLibraryCategory> =
  [
    DetectionRuleLibraryCategory.Identity,
    DetectionRuleLibraryCategory.Endpoint,
    DetectionRuleLibraryCategory.Cloud,
    DetectionRuleLibraryCategory.Network,
    DetectionRuleLibraryCategory.Web,
    DetectionRuleLibraryCategory.Kubernetes,
  ];

export interface DetectionRuleLibraryEntry {
  // The Sigma `id` in the YAML.
  id: string;
  title: string;
  description: string;
  category: DetectionRuleLibraryCategory;
  // The events the rule reads, said the way a person would look for them.
  dataSource: string;
  /*
   * The kind of event that is (DetectionRuleDataKind): what the Rule
   * Library checks the project sends, so it can say whether the rule has
   * anything to read.
   */
  dataKind: DetectionRuleDataKind;
  sigmaRuleYaml: string;
  evaluationIntervalInMinutes: number;
  groupByField?: string | undefined;
  distinctCountField?: string | undefined;
  matchCountThreshold: number;
}

export const DETECTION_RULE_LIBRARY: ReadonlyArray<DetectionRuleLibraryEntry> =
  [
    // Identity
    {
      id: "acf2a37e-301a-46de-87c7-d4343f3a8445",
      title: "Brute force from one IP address",
      description:
        "Ten or more failed sign-ins from the same IP address within five minutes: someone guessing passwords.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Authentication events from any source",
      dataKind: DetectionRuleDataKind.SignIns,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalIp",
      matchCountThreshold: 10,
      sigmaRuleYaml: `title: Brute force from one IP address
id: acf2a37e-301a-46de-87c7-d4343f3a8445
description: Many failed sign-ins from one IP address in a short time.
level: high
tags:
  - attack.credential_access
  - attack.t1110.001
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`,
    },
    {
      id: "c6b500e1-8b3c-4be3-b303-ef90a0355345",
      title: "Password spraying",
      description:
        "One IP address failing to sign in as five or more different accounts within ten minutes: one common password tried against many users.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Authentication events from any source",
      dataKind: DetectionRuleDataKind.SignIns,
      evaluationIntervalInMinutes: 10,
      groupByField: "principalIp",
      distinctCountField: "principalUser",
      matchCountThreshold: 5,
      sigmaRuleYaml: `title: Password spraying
id: c6b500e1-8b3c-4be3-b303-ef90a0355345
description: One IP address failing to sign in as many different accounts.
level: high
tags:
  - attack.credential_access
  - attack.t1110.003
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`,
    },
    {
      id: "e16d3ff9-32d3-4180-b4fc-c3c2fd4ca835",
      title: "Repeated failed sign-ins for one account",
      description:
        "Fifteen or more failed sign-ins for the same account within fifteen minutes, from wherever they come: a targeted guessing attack, or a stolen password being tried.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Authentication events from any source",
      dataKind: DetectionRuleDataKind.SignIns,
      evaluationIntervalInMinutes: 15,
      groupByField: "principalUser",
      matchCountThreshold: 15,
      sigmaRuleYaml: `title: Repeated failed sign-ins for one account
id: e16d3ff9-32d3-4180-b4fc-c3c2fd4ca835
description: Many failed sign-ins for one account in a short time.
level: medium
tags:
  - attack.credential_access
  - attack.t1110
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`,
    },
    {
      id: "dfcaef4f-07f2-438d-a869-4db25e1a1fc0",
      title: "MFA push fatigue",
      description:
        "Five or more Okta push challenges sent to one person within ten minutes: an attacker with the password hoping they tap Approve.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 10,
      groupByField: "principalUser",
      matchCountThreshold: 5,
      sigmaRuleYaml: `title: MFA push fatigue
id: dfcaef4f-07f2-438d-a869-4db25e1a1fc0
description: Many MFA push challenges sent to one person in a short time.
level: high
tags:
  - attack.credential_access
  - attack.t1621
detection:
  selection:
    eventType: system.push.send_factor_verify_push
  condition: selection
`,
    },
    {
      id: "6096316d-9af5-4ed4-9b00-5e61f9f0d3de",
      title: "MFA push rejected or reported",
      description:
        "Somebody rejected an Okta push they did not start, or reported the sign-in as suspicious: their password is likely known to someone else.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalUser",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: MFA push rejected or reported
id: 6096316d-9af5-4ed4-9b00-5e61f9f0d3de
description: A person rejected an MFA push or reported a sign-in as suspicious.
level: high
tags:
  - attack.credential_access
  - attack.t1621
detection:
  selection:
    eventType:
      - user.mfa.okta_verify.deny_push
      - user.account.report_suspicious_activity_by_enduser
  condition: selection
`,
    },
    {
      id: "ca851016-9804-44ae-97e5-3687241e6d41",
      title: "Account locked out",
      description: "Okta locked an account after too many failed sign-ins.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalUser",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Account locked out
id: ca851016-9804-44ae-97e5-3687241e6d41
description: An account was locked after too many failed sign-ins.
level: medium
tags:
  - attack.credential_access
  - attack.t1110
detection:
  selection:
    eventType: user.account.lock
  condition: selection
`,
    },
    {
      id: "254307b4-0ef4-4399-8db9-6c405b16d4bb",
      title: "Admin privileges granted",
      description:
        "An Okta user or group was given administrator privileges. Expected during onboarding; worth a second look any other time.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 5,
      groupByField: "targetUser",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Admin privileges granted
id: 254307b4-0ef4-4399-8db9-6c405b16d4bb
description: A user or group was given administrator privileges.
level: medium
tags:
  - attack.persistence
  - attack.privilege_escalation
  - attack.t1098
detection:
  selection:
    eventType:
      - user.account.privilege.grant
      - group.privilege.grant
  condition: selection
`,
    },
    {
      id: "da8d444e-14af-459d-9688-c7236c1e67c5",
      title: "MFA factors reset",
      description:
        "Somebody's Okta MFA factors were reset or removed. An attacker who resets them can enroll their own.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 5,
      groupByField: "targetUser",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: MFA factors reset
id: da8d444e-14af-459d-9688-c7236c1e67c5
description: A user's MFA factors were reset or removed.
level: medium
tags:
  - attack.credential_access
  - attack.defense_impairment
  - attack.t1556
detection:
  selection:
    eventType:
      - user.mfa.factor.reset_all
      - user.mfa.factor.deactivate
  condition: selection
`,
    },
    {
      id: "48dfd028-6a09-4efa-8a2f-8526a6cca13c",
      title: "API token created",
      description:
        "A new Okta API token was created. Tokens act with their creator's privileges and outlive a password change.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalUser",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: API token created
id: 48dfd028-6a09-4efa-8a2f-8526a6cca13c
description: A new API token was created.
level: low
tags:
  - attack.persistence
  - attack.t1098.001
detection:
  selection:
    eventType: system.api_token.create
  condition: selection
`,
    },
    {
      id: "84e62bfa-318e-437c-bc5e-6f0c225570dc",
      title: "Admin impersonation session started",
      description:
        "An Okta administrator started a session impersonating another user.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalUser",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Admin impersonation session started
id: 84e62bfa-318e-437c-bc5e-6f0c225570dc
description: An administrator started a session impersonating another user.
level: medium
tags:
  - attack.privilege_escalation
  - attack.t1078
detection:
  selection:
    eventType: user.session.impersonation.initiate
  condition: selection
`,
    },
    {
      id: "4eae9e9c-f247-4290-9d97-fb5042309b67",
      title: "Sign-in from a malicious IP address",
      description:
        "Okta ThreatInsight flagged a request from an IP address it knows to be malicious.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalIp",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Sign-in from a malicious IP address
id: 4eae9e9c-f247-4290-9d97-fb5042309b67
description: A request came from an IP address known to be malicious.
level: high
tags:
  - attack.initial_access
  - attack.t1078
detection:
  selection:
    eventType: security.threat.detected
  condition: selection
`,
    },
    {
      id: "d4663a7b-417b-4e52-a4a1-0cea57462f33",
      title: "New account created",
      description:
        "An account was created. Attackers add accounts to keep their access after a password reset.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Account change events from any source",
      dataKind: DetectionRuleDataKind.AccountChanges,
      evaluationIntervalInMinutes: 5,
      groupByField: "targetUser",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: New account created
id: d4663a7b-417b-4e52-a4a1-0cea57462f33
description: An account was created.
level: low
tags:
  - attack.persistence
  - attack.t1136
detection:
  selection_class:
    className: Account Change
    activityName: Create
  selection_okta:
    eventType: user.lifecycle.create
  condition: 1 of selection_*
`,
    },

    {
      id: "1e112332-583d-4fd9-b688-9b5d715d5896",
      title: "Failed sign-ins, then a success from the same address",
      description:
        "Five or more failed sign-ins from one IP address, then one from it that worked, within ten minutes: a password that was guessed.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Authentication events from any source",
      dataKind: DetectionRuleDataKind.SignIns,
      evaluationIntervalInMinutes: 5,
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Failed sign-ins, then a success from the same address
id: 1e112332-583d-4fd9-b688-9b5d715d5896
description: Many failed sign-ins from one IP address, then one from it that worked.
level: high
tags:
  - attack.credential_access
  - attack.t1110
  - attack.initial_access
  - attack.t1078
correlation:
  type: temporal_ordered
  rules:
    - failed_sign_ins
    - successful_sign_in
  group-by:
    - principalIp
  timespan: 10m
---
title: Five failed sign-ins
name: failed_sign_ins
correlation:
  type: event_count
  rules:
    - failed_sign_in
  group-by:
    - principalIp
  timespan: 10m
  condition:
    gte: 5
---
title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection
`,
    },
    {
      id: "e65a43a0-6eb3-4441-beff-ecdfc5f0b8f4",
      title: "Sign-in from an address the account never used",
      description:
        "An account signed in from an IP address it has not signed in from in two weeks. Expected after travel or on a new network; worth a look for admins.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Authentication events from any source",
      dataKind: DetectionRuleDataKind.SignIns,
      evaluationIntervalInMinutes: 15,
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Sign-in from an address the account never used
id: e65a43a0-6eb3-4441-beff-ecdfc5f0b8f4
description: The first sign-in of an account from an IP address in two weeks.
level: low
tags:
  - attack.initial_access
  - attack.t1078
correlation:
  type: new_value
  rules:
    - successful_sign_in
  group-by:
    - principalUser
  timespan: 14d
  condition:
    field: principalIp
---
title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection
`,
    },
    {
      id: "99749e02-7b91-4139-96ca-fdc1ad7a0c53",
      title: "Okta sign-in from a new country",
      description:
        "A person signed in to Okta from a country they have not signed in from in thirty days: travel, or someone else with their password.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 15,
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Okta sign-in from a new country
id: 99749e02-7b91-4139-96ca-fdc1ad7a0c53
description: The first Okta sign-in of a person from a country in thirty days.
level: medium
tags:
  - attack.initial_access
  - attack.t1078.004
correlation:
  type: new_value
  rules:
    - okta_sign_in
  group-by:
    - principalUser
  timespan: 30d
  condition:
    field: client.geographicalContext.country
---
title: Okta sign-in
name: okta_sign_in
detection:
  selection:
    eventType: user.session.start
    outcome.result: SUCCESS
  condition: selection
`,
    },
    {
      id: "497508d7-8051-41b8-905f-c149c008eca4",
      title: "New account given admin rights within an hour",
      description:
        "An account was created and given administrator privileges less than an hour later: how an attacker keeps the access they got.",
      category: DetectionRuleLibraryCategory.Identity,
      dataSource: "Okta System Log",
      dataKind: DetectionRuleDataKind.OktaSystemLog,
      evaluationIntervalInMinutes: 5,
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: New account given admin rights within an hour
id: 497508d7-8051-41b8-905f-c149c008eca4
description: An account was created, then given administrator privileges within an hour.
level: high
tags:
  - attack.persistence
  - attack.t1136
  - attack.privilege_escalation
  - attack.t1098
correlation:
  type: temporal_ordered
  rules:
    - account_created
    - admin_granted
  group-by:
    - targetUser
  timespan: 1h
---
title: Account created
name: account_created
detection:
  selection_class:
    className: Account Change
    activityName: Create
  selection_okta:
    eventType: user.lifecycle.create
  condition: 1 of selection_*
---
title: Admin privileges granted
name: admin_granted
detection:
  selection:
    eventType: user.account.privilege.grant
  condition: selection
`,
    },

    // Endpoint
    {
      id: "50e60fa4-eddb-4138-b68b-1f928a8f1f10",
      title: "Encoded PowerShell command",
      description:
        "PowerShell started with a base64-encoded command, a common way to hide what a script does.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, Sysmon or Windows",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Encoded PowerShell command
id: 50e60fa4-eddb-4138-b68b-1f928a8f1f10
description: PowerShell started with a base64-encoded command.
level: high
tags:
  - attack.execution
  - attack.stealth
  - attack.t1059.001
  - attack.t1027
detection:
  selection_powershell:
    CommandLine|contains:
      - powershell
      - pwsh
  selection_encoded:
    CommandLine|contains:
      - ' -enc '
      - ' -encodedcommand '
      - ' -ec '
      - ' -e JAB'
  condition: selection_powershell and selection_encoded
`,
    },
    {
      id: "0117bc13-9c29-4468-a916-af69bc488fca",
      title: "Shadow copies deleted",
      description:
        "Volume shadow copies or the backup catalog were deleted. Ransomware does this right before it encrypts, so recovery is harder.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, Sysmon or Windows",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 1,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Shadow copies deleted
id: 0117bc13-9c29-4468-a916-af69bc488fca
description: Volume shadow copies or the backup catalog were deleted.
level: critical
tags:
  - attack.impact
  - attack.t1490
detection:
  selection_vssadmin:
    CommandLine|contains|all:
      - vssadmin
      - delete
      - shadows
  selection_wmic:
    CommandLine|contains|all:
      - wmic
      - shadowcopy
      - delete
  selection_wbadmin:
    CommandLine|contains|all:
      - wbadmin
      - delete
      - catalog
  condition: 1 of selection_*
`,
    },
    {
      id: "a2999ff2-396e-449d-a3a4-484fb4c8b7b6",
      title: "Credential dumping tool",
      description:
        "A command line that reads passwords out of memory: Mimikatz commands, or a dump of the LSASS process.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, Sysmon or Windows",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 1,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Credential dumping tool
id: a2999ff2-396e-449d-a3a4-484fb4c8b7b6
description: A command line that reads credentials out of memory.
level: critical
tags:
  - attack.credential_access
  - attack.t1003.001
detection:
  selection_mimikatz:
    CommandLine|contains:
      - 'sekurlsa::'
      - 'lsadump::'
      - 'kerberos::golden'
      - mimikatz
  selection_lsass_dump:
    CommandLine|contains|all:
      - lsass
      - dump
  selection_comsvcs:
    CommandLine|contains|all:
      - comsvcs
      - MiniDump
  condition: 1 of selection_*
`,
    },
    {
      id: "08213b34-020a-4ab7-9d3b-e500079a7754",
      title: "File downloaded with certutil",
      description:
        "certutil, a Windows certificate tool, was used to download a file: a classic way to pull in a payload with a trusted binary.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, Sysmon or Windows",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: File downloaded with certutil
id: 08213b34-020a-4ab7-9d3b-e500079a7754
description: certutil was used to download a file.
level: high
tags:
  - attack.command_and_control
  - attack.t1105
detection:
  selection:
    CommandLine|contains|all:
      - certutil
      - urlcache
  condition: selection
`,
    },
    {
      id: "aee4cdc7-f786-4023-a636-135397c6ff49",
      title: "Download piped into a shell",
      description:
        "curl or wget output piped straight into sh or bash: code run from the internet without being saved or checked.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, auditd or Falco",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Download piped into a shell
id: aee4cdc7-f786-4023-a636-135397c6ff49
description: curl or wget output piped straight into a shell.
level: high
tags:
  - attack.execution
  - attack.t1059.004
  - attack.t1105
detection:
  selection_download:
    CommandLine|contains:
      - curl
      - wget
  selection_shell:
    CommandLine|contains:
      - '| sh'
      - '|sh'
      - '| bash'
      - '|bash'
  condition: selection_download and selection_shell
`,
    },
    {
      id: "deeb8c3e-02d1-465e-bc88-83b49be848b5",
      title: "Reverse shell",
      description:
        "A command line that hands a shell to a remote machine, the way an attacker takes interactive control of a host.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, auditd or Falco",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 1,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Reverse shell
id: deeb8c3e-02d1-465e-bc88-83b49be848b5
description: A command line that hands a shell to a remote machine.
level: critical
tags:
  - attack.execution
  - attack.command_and_control
  - attack.t1059.004
  - attack.t1095
detection:
  selection:
    CommandLine|contains:
      - /dev/tcp/
      - /dev/udp/
      - 'nc -e '
      - 'ncat -e '
      - 'bash -i >&'
      - 'sh -i >&'
      - 'socat exec:'
  condition: selection
`,
    },
    {
      id: "738efe94-2259-4435-b346-f52c488409a0",
      title: "Shell history cleared or disabled",
      description:
        "Shell history was cleared or turned off, so the commands that follow leave no trace.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, auditd or Falco",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Shell history cleared or disabled
id: 738efe94-2259-4435-b346-f52c488409a0
description: Shell history was cleared or turned off.
level: medium
tags:
  - attack.defense_impairment
  - attack.t1690
detection:
  selection:
    CommandLine|contains:
      - 'history -c'
      - 'unset HISTFILE'
      - 'HISTFILE=/dev/null'
      - 'HISTSIZE=0'
      - '.bash_history'
  condition: selection
`,
    },
    {
      id: "bbfee430-70b5-4d88-83aa-ef34aca8a8aa",
      title: "Password hashes read on Linux",
      description:
        "A process read /etc/shadow, where Linux keeps password hashes. Only a few system tools ever should.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, auditd or Falco",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Password hashes read on Linux
id: bbfee430-70b5-4d88-83aa-ef34aca8a8aa
description: A process read /etc/shadow.
level: high
tags:
  - attack.credential_access
  - attack.t1003.008
detection:
  selection:
    CommandLine|contains: /etc/shadow
  condition: selection
`,
    },
    {
      id: "66da2b4b-eb78-4bbf-8641-9e1bd9bf5add",
      title: "Scheduled task created",
      description:
        "A Windows scheduled task was created from the command line, a common way to make malware start again after a reboot.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, Sysmon or Windows",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Scheduled task created
id: 66da2b4b-eb78-4bbf-8641-9e1bd9bf5add
description: A scheduled task was created from the command line.
level: medium
tags:
  - attack.execution
  - attack.persistence
  - attack.t1053.005
detection:
  selection:
    CommandLine|contains|all:
      - schtasks
      - /create
  condition: selection
`,
    },
    {
      id: "bb4c1441-ead6-4741-a55d-ffed4df9cd6e",
      title: "Service installed from the command line",
      description:
        "A Windows service was created with sc.exe. Malware installs itself as a service to run with SYSTEM rights on every boot.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, Sysmon or Windows",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Service installed from the command line
id: bb4c1441-ead6-4741-a55d-ffed4df9cd6e
description: A service was created with sc.exe.
level: medium
tags:
  - attack.persistence
  - attack.privilege_escalation
  - attack.t1543.003
detection:
  selection:
    CommandLine|contains|all:
      - 'sc'
      - 'create'
      - 'binpath='
  condition: selection
`,
    },
    {
      id: "1c5de9c5-c305-422c-b485-af1dbbe9e763",
      title: "Cryptocurrency miner",
      description:
        "A process that looks like a cryptocurrency miner: someone is spending your compute on their wallet.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from any source",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Cryptocurrency miner
id: 1c5de9c5-c305-422c-b485-af1dbbe9e763
description: A process that looks like a cryptocurrency miner.
level: high
tags:
  - attack.impact
  - attack.t1496
detection:
  selection:
    CommandLine|contains:
      - xmrig
      - minerd
      - cpuminer
      - 'stratum+tcp://'
      - 'stratum+ssl://'
      - '--donate-level'
  condition: selection
`,
    },
    {
      id: "fd186eb5-3937-48af-bf0e-288a8385b45b",
      title: "Antivirus protection turned off",
      description:
        "Microsoft Defender's real-time protection was turned off with PowerShell.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from an EDR, Sysmon or Windows",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 1,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Antivirus protection turned off
id: fd186eb5-3937-48af-bf0e-288a8385b45b
description: Defender real-time protection was turned off with PowerShell.
level: high
tags:
  - attack.defense_impairment
  - attack.t1685
detection:
  selection_cmdlet:
    CommandLine|contains: Set-MpPreference
  selection_setting:
    CommandLine|contains:
      - DisableRealtimeMonitoring
      - DisableBehaviorMonitoring
      - DisableIOAVProtection
      - DisableScriptScanning
  condition: selection_cmdlet and selection_setting
`,
    },
    {
      id: "aab531be-d7c5-4749-8f40-eb4e22b9c21a",
      title: "Host firewall turned off",
      description:
        "The host firewall was turned off or flushed from the command line.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from any source",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Host firewall turned off
id: aab531be-d7c5-4749-8f40-eb4e22b9c21a
description: The host firewall was turned off or flushed.
level: high
tags:
  - attack.defense_impairment
  - attack.t1686
detection:
  selection:
    CommandLine|contains:
      - 'advfirewall set allprofiles state off'
      - 'advfirewall set currentprofile state off'
      - 'ufw disable'
      - 'systemctl stop firewalld'
      - 'systemctl disable firewalld'
      - 'iptables -F'
  condition: selection
`,
    },
    {
      id: "0c1e122c-da8e-41a5-94c9-27de63f2a7db",
      title: "Local administrator added",
      description:
        "An account was added to the local Administrators or sudo group from the command line.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "Process events from any source",
      dataKind: DetectionRuleDataKind.ProcessEvents,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalHost",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Local administrator added
id: 0c1e122c-da8e-41a5-94c9-27de63f2a7db
description: An account was added to a local administrators group.
level: high
tags:
  - attack.persistence
  - attack.privilege_escalation
  - attack.t1098
detection:
  selection_windows:
    CommandLine|contains|all:
      - localgroup
      - administrators
      - /add
  selection_linux:
    CommandLine|contains:
      - 'usermod -aG sudo'
      - 'usermod -aG wheel'
      - 'usermod -a -G sudo'
      - 'usermod -a -G wheel'
  condition: 1 of selection_*
`,
    },

    {
      id: "0b55cc2f-57df-49ed-b98b-2e6b7f976d32",
      title: "First sudo on a host by a user",
      description:
        "A user ran a command with sudo on a host where they had not used sudo in two weeks: a new admin, or someone else's account.",
      category: DetectionRuleLibraryCategory.Endpoint,
      dataSource: "sudo logs",
      dataKind: DetectionRuleDataKind.SudoLogs,
      evaluationIntervalInMinutes: 15,
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: First sudo on a host by a user
id: 0b55cc2f-57df-49ed-b98b-2e6b7f976d32
description: The first sudo command of a user on a host in two weeks.
level: medium
tags:
  - attack.privilege_escalation
  - attack.t1548.003
correlation:
  type: new_value
  rules:
    - sudo_command
  group-by:
    - principalHost
  timespan: 14d
  condition:
    field: principalUser
---
title: Command run with sudo
name: sudo_command
detection:
  selection:
    productName: sudo
    activityName: Launch
  condition: selection
`,
    },

    // Cloud
    {
      id: "e431079d-c7d4-4ae3-9bfc-b6407f2697b8",
      title: "CloudTrail logging stopped",
      description:
        "An AWS CloudTrail trail was stopped or deleted: the audit log of everything that happens next is gone.",
      category: DetectionRuleLibraryCategory.Cloud,
      dataSource: "AWS CloudTrail events",
      dataKind: DetectionRuleDataKind.AwsCloudTrail,
      evaluationIntervalInMinutes: 5,
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: CloudTrail logging stopped
id: e431079d-c7d4-4ae3-9bfc-b6407f2697b8
description: A CloudTrail trail was stopped or deleted.
level: high
tags:
  - attack.defense_impairment
  - attack.t1685
detection:
  selection:
    eventSource: cloudtrail.amazonaws.com
    eventName:
      - StopLogging
      - DeleteTrail
  condition: selection
`,
    },
    {
      id: "0a8c9dcc-c2b4-46a0-8b41-8ac0c8b532a1",
      title: "GuardDuty detector removed",
      description:
        "An AWS GuardDuty detector was deleted, turning off threat detection for that region.",
      category: DetectionRuleLibraryCategory.Cloud,
      dataSource: "AWS CloudTrail events",
      dataKind: DetectionRuleDataKind.AwsCloudTrail,
      evaluationIntervalInMinutes: 5,
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: GuardDuty detector removed
id: 0a8c9dcc-c2b4-46a0-8b41-8ac0c8b532a1
description: A GuardDuty detector was deleted.
level: high
tags:
  - attack.defense_impairment
  - attack.t1685
detection:
  selection:
    eventSource: guardduty.amazonaws.com
    eventName: DeleteDetector
  condition: selection
`,
    },
    {
      id: "3d89d3d5-2b7e-4650-bee7-dac72b6704c3",
      title: "AWS root account used",
      description:
        "The AWS account's root user made a request. Root should be locked away, with day-to-day work done through IAM roles.",
      category: DetectionRuleLibraryCategory.Cloud,
      dataSource: "AWS CloudTrail events",
      dataKind: DetectionRuleDataKind.AwsCloudTrail,
      evaluationIntervalInMinutes: 5,
      groupByField: "recipientAccountId",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: AWS root account used
id: 3d89d3d5-2b7e-4650-bee7-dac72b6704c3
description: The AWS root user made a request.
level: high
tags:
  - attack.privilege_escalation
  - attack.t1078.004
detection:
  selection:
    userIdentity.type: Root
  filter_service:
    eventType: AwsServiceEvent
  condition: selection and not filter_service
`,
    },
    {
      id: "388b42f9-2239-40bb-bf1a-2a476ad099c0",
      title: "Console sign-in without MFA",
      description:
        "Somebody signed in to the AWS console without multi-factor authentication.",
      category: DetectionRuleLibraryCategory.Cloud,
      dataSource: "AWS CloudTrail events",
      dataKind: DetectionRuleDataKind.AwsCloudTrail,
      evaluationIntervalInMinutes: 5,
      groupByField: "userIdentity.arn",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Console sign-in without MFA
id: 388b42f9-2239-40bb-bf1a-2a476ad099c0
description: An AWS console sign-in without multi-factor authentication.
level: medium
tags:
  - attack.initial_access
  - attack.t1078.004
detection:
  selection:
    eventName: ConsoleLogin
    additionalEventData.MFAUsed: 'No'
    responseElements.ConsoleLogin: Success
  condition: selection
`,
    },
    {
      id: "066bf906-3932-4e5d-9920-131825734ea0",
      title: "Access key created",
      description:
        "A new AWS IAM access key was created: long-lived credentials that keep working after a password reset.",
      category: DetectionRuleLibraryCategory.Cloud,
      dataSource: "AWS CloudTrail events",
      dataKind: DetectionRuleDataKind.AwsCloudTrail,
      evaluationIntervalInMinutes: 5,
      groupByField: "userIdentity.arn",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Access key created
id: 066bf906-3932-4e5d-9920-131825734ea0
description: A new IAM access key was created.
level: low
tags:
  - attack.persistence
  - attack.t1098.001
detection:
  selection:
    eventSource: iam.amazonaws.com
    eventName: CreateAccessKey
  condition: selection
`,
    },
    {
      id: "2917bec0-2331-4e59-bdd4-a81211529156",
      title: "Burst of access-denied API calls",
      description:
        "Twenty or more AWS API calls denied for one identity within ten minutes: someone probing what a stolen key can do.",
      category: DetectionRuleLibraryCategory.Cloud,
      dataSource: "AWS CloudTrail events",
      dataKind: DetectionRuleDataKind.AwsCloudTrail,
      evaluationIntervalInMinutes: 10,
      groupByField: "userIdentity.arn",
      matchCountThreshold: 20,
      sigmaRuleYaml: `title: Burst of access-denied API calls
id: 2917bec0-2331-4e59-bdd4-a81211529156
description: Many AWS API calls denied for one identity.
level: medium
tags:
  - attack.discovery
  - attack.t1580
detection:
  selection:
    errorCode:
      - AccessDenied
      - UnauthorizedOperation
      - Client.UnauthorizedOperation
  condition: selection
`,
    },

    {
      id: "c71e033b-45d0-44cb-8835-c05cb59c9a96",
      title: "AWS activity in a region the account never used",
      description:
        "Calls in an AWS region the account had no activity in for thirty days: attackers start miners and hide resources in regions nobody watches.",
      category: DetectionRuleLibraryCategory.Cloud,
      dataSource: "AWS CloudTrail",
      dataKind: DetectionRuleDataKind.AwsCloudTrail,
      evaluationIntervalInMinutes: 15,
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: AWS activity in a region the account never used
id: c71e033b-45d0-44cb-8835-c05cb59c9a96
description: The first calls in an AWS region of an account in thirty days.
level: medium
tags:
  - attack.stealth
  - attack.t1535
correlation:
  type: new_value
  rules:
    - cloudtrail_call
  group-by:
    - targetHost
  timespan: 30d
  condition:
    field: awsRegion
---
title: CloudTrail call
name: cloudtrail_call
detection:
  selection:
    productName: AWS CloudTrail
    statusName: Success
  condition: selection
`,
    },

    // Network
    {
      id: "3c85f9a3-095a-4f77-8035-6fb7158dd458",
      title: "Port scan",
      description:
        "One IP address reaching twenty or more different ports within five minutes: somebody mapping which services you run.",
      category: DetectionRuleLibraryCategory.Network,
      dataSource: "Network activity events (firewalls, flow logs, IDS)",
      dataKind: DetectionRuleDataKind.NetworkActivity,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalIp",
      distinctCountField: "targetPort",
      matchCountThreshold: 20,
      sigmaRuleYaml: `title: Port scan
id: 3c85f9a3-095a-4f77-8035-6fb7158dd458
description: One IP address reaching many different ports.
level: medium
tags:
  - attack.discovery
  - attack.t1046
detection:
  selection:
    className: Network Activity
  condition: selection
`,
    },
    {
      id: "8f0fe4f6-c29a-4eb1-9426-73bb4ae1f3aa",
      title: "Network sweep",
      description:
        "One IP address reaching twenty-five or more different hosts within five minutes: somebody looking for machines to move to.",
      category: DetectionRuleLibraryCategory.Network,
      dataSource: "Network activity events (firewalls, flow logs, IDS)",
      dataKind: DetectionRuleDataKind.NetworkActivity,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalIp",
      distinctCountField: "targetIp",
      matchCountThreshold: 25,
      sigmaRuleYaml: `title: Network sweep
id: 8f0fe4f6-c29a-4eb1-9426-73bb4ae1f3aa
description: One IP address reaching many different hosts.
level: medium
tags:
  - attack.discovery
  - attack.t1018
detection:
  selection:
    className: Network Activity
  condition: selection
`,
    },

    // Web
    {
      id: "cfdf6ad4-7138-4201-8a1c-6bf962335cee",
      title: "SQL injection attempts",
      description:
        "Three or more requests from one IP address within five minutes carrying SQL injection patterns.",
      category: DetectionRuleLibraryCategory.Web,
      dataSource: "HTTP or web server events",
      dataKind: DetectionRuleDataKind.WebRequests,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalIp",
      matchCountThreshold: 3,
      sigmaRuleYaml: `title: SQL injection attempts
id: cfdf6ad4-7138-4201-8a1c-6bf962335cee
description: Requests carrying SQL injection patterns.
level: high
tags:
  - attack.initial_access
  - attack.t1190
detection:
  selection:
    targetResource|contains:
      - "' or '1'='1"
      - "' or 1=1"
      - '%27%20or%201%3D1'
      - 'union select'
      - 'union all select'
      - 'union%20select'
      - 'sleep('
      - 'benchmark('
      - 'information_schema'
  condition: selection
`,
    },
    {
      id: "68d61e5d-79d2-4f41-8c1b-c017f6d0bd52",
      title: "Path traversal attempts",
      description:
        "Three or more requests from one IP address within five minutes trying to climb out of the web root with ../ sequences.",
      category: DetectionRuleLibraryCategory.Web,
      dataSource: "HTTP or web server events",
      dataKind: DetectionRuleDataKind.WebRequests,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalIp",
      matchCountThreshold: 3,
      sigmaRuleYaml: `title: Path traversal attempts
id: 68d61e5d-79d2-4f41-8c1b-c017f6d0bd52
description: Requests trying to read files outside the web root.
level: medium
tags:
  - attack.initial_access
  - attack.t1190
detection:
  selection:
    targetResource|contains:
      - '../../'
      - '..%2f'
      - '..%2F'
      - '%2e%2e%2f'
      - '%2E%2E%2F'
      - '/etc/passwd'
  condition: selection
`,
    },
    {
      id: "866b7566-304e-442b-b1ad-ca08264af493",
      title: "Log4Shell exploit attempt",
      description:
        "A request or log line carrying a JNDI lookup, the Log4Shell (CVE-2021-44228) exploit string.",
      category: DetectionRuleLibraryCategory.Web,
      dataSource: "HTTP, web server or application events",
      dataKind: DetectionRuleDataKind.WebRequests,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalIp",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Log4Shell exploit attempt
id: 866b7566-304e-442b-b1ad-ca08264af493
description: A request carrying a JNDI lookup string.
level: high
tags:
  - attack.initial_access
  - attack.t1190
detection:
  selection_resource:
    targetResource|contains: '\${jndi:'
  selection_message:
    message|contains: '\${jndi:'
  condition: 1 of selection_*
`,
    },

    /*
     * What happened next, as the request's trace showed it
     * (Types/SecurityEvent/SecurityEventRequestOutcome): the attempts above
     * say somebody tried; these say it worked.
     */
    {
      id: "a1218db8-8e28-4afb-ae8e-ed4f0aef7595",
      title: "Injected SQL reached the database",
      description:
        "A request carrying SQL injection reached the database: a query it made holds the payload, or it waited as long as its SQL asked the database to sleep.",
      category: DetectionRuleLibraryCategory.Web,
      dataSource: "Web requests followed into their traces",
      dataKind: DetectionRuleDataKind.WebRequests,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalIp",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Injected SQL reached the database
id: a1218db8-8e28-4afb-ae8e-ed4f0aef7595
description: A request whose injected SQL ran in a query the app made.
level: critical
tags:
  - attack.initial_access
  - attack.t1190
detection:
  selection:
    requestOutcome: 'Reached Database'
  condition: selection
`,
    },
    {
      id: "47d32cc6-462c-44f9-8bcb-b99d7b083860",
      title: "Attack request broke the app",
      description:
        "A request carrying an attack made the app fail: it answered with a server error, or threw an exception. The payload reached code that did not expect it.",
      category: DetectionRuleLibraryCategory.Web,
      dataSource: "Web requests followed into their traces",
      dataKind: DetectionRuleDataKind.WebRequests,
      evaluationIntervalInMinutes: 5,
      groupByField: "principalIp",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Attack request broke the app
id: 47d32cc6-462c-44f9-8bcb-b99d7b083860
description: A request carrying an attack string that errored in the app.
level: high
tags:
  - attack.initial_access
  - attack.t1190
detection:
  selection:
    className: 'HTTP Activity'
    requestOutcome: 'Errored'
  condition: selection
`,
    },

    // Kubernetes
    {
      id: "1ce3af71-a3d5-409a-b477-34e4a734aa83",
      title: "Shell opened in a pod",
      description:
        "Somebody ran kubectl exec into a running pod. Fine during an outage; worth knowing about any other time.",
      category: DetectionRuleLibraryCategory.Kubernetes,
      dataSource: "Kubernetes audit logs",
      dataKind: DetectionRuleDataKind.KubernetesAuditLogs,
      evaluationIntervalInMinutes: 5,
      groupByField: "user.username",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Shell opened in a pod
id: 1ce3af71-a3d5-409a-b477-34e4a734aa83
description: kubectl exec was run against a pod.
level: medium
tags:
  - attack.execution
  - attack.t1609
detection:
  selection:
    objectRef.resource: pods
    objectRef.subresource: exec
    verb: create
  condition: selection
`,
    },
    {
      id: "44e60520-facd-443a-bf1f-8c741819be91",
      title: "Privileged pod created",
      description:
        "A pod was created with a privileged container, which can take over the node it runs on.",
      category: DetectionRuleLibraryCategory.Kubernetes,
      dataSource: "Kubernetes audit logs",
      dataKind: DetectionRuleDataKind.KubernetesAuditLogs,
      evaluationIntervalInMinutes: 5,
      groupByField: "user.username",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Privileged pod created
id: 44e60520-facd-443a-bf1f-8c741819be91
description: A pod was created with a privileged container.
level: high
tags:
  - attack.privilege_escalation
  - attack.execution
  - attack.t1610
  - attack.t1611
detection:
  selection:
    objectRef.resource: pods
    verb: create
    requestObject.spec.containers.0.securityContext.privileged: 'true'
  condition: selection
`,
    },
    {
      id: "f18675fc-8708-44ff-9393-13e9c15250c0",
      title: "Cluster-admin granted",
      description:
        "A ClusterRoleBinding to cluster-admin was created: full control of the cluster for whoever it names.",
      category: DetectionRuleLibraryCategory.Kubernetes,
      dataSource: "Kubernetes audit logs",
      dataKind: DetectionRuleDataKind.KubernetesAuditLogs,
      evaluationIntervalInMinutes: 5,
      groupByField: "user.username",
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: Cluster-admin granted
id: f18675fc-8708-44ff-9393-13e9c15250c0
description: A ClusterRoleBinding to cluster-admin was created.
level: high
tags:
  - attack.privilege_escalation
  - attack.persistence
  - attack.t1098.006
detection:
  selection:
    objectRef.resource: clusterrolebindings
    verb: create
    requestObject.roleRef.name: cluster-admin
  condition: selection
`,
    },
    {
      id: "861ed734-f8ec-46da-a0f8-cadeb0e1c750",
      title: "First shell in a namespace by a user",
      description:
        "Somebody ran kubectl exec into a pod in a namespace where they had not opened a shell in thirty days.",
      category: DetectionRuleLibraryCategory.Kubernetes,
      dataSource: "Kubernetes audit logs",
      dataKind: DetectionRuleDataKind.KubernetesAuditLogs,
      evaluationIntervalInMinutes: 15,
      matchCountThreshold: 1,
      sigmaRuleYaml: `title: First shell in a namespace by a user
id: 861ed734-f8ec-46da-a0f8-cadeb0e1c750
description: The first kubectl exec of a user in a namespace in thirty days.
level: medium
tags:
  - attack.execution
  - attack.t1609
correlation:
  type: new_value
  rules:
    - pod_shell
  group-by:
    - user.username
  timespan: 30d
  condition:
    field: objectRef.namespace
---
title: Shell opened in a pod
name: pod_shell
detection:
  selection:
    objectRef.resource: pods
    objectRef.subresource: exec
    verb: create
  condition: selection
`,
    },
  ];

export function getDetectionRuleLibraryEntry(
  id: string,
): DetectionRuleLibraryEntry | undefined {
  return DETECTION_RULE_LIBRARY.find(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return entry.id === id;
    },
  );
}

/*
 * The rules a project turns on first, in one click (Security Events >
 * Overview, the Rule Library's "Turn on recommended rules"): the ones that
 * find something in data most projects already have or can send in
 * minutes - sign-in failures from any source, and what "Your logs" reads
 * (SecurityLogFormat): sudo commands on Linux hosts, attacks on web
 * servers, Kubernetes audit logs and AWS CloudTrail. A rule only reads its
 * own kind of event, so one whose kind never arrives costs one quick query
 * per run and never fires.
 *
 * The rules that need one product's events (Okta, an EDR, a firewall) wait
 * in the library until that product is connected.
 */
export const RECOMMENDED_DETECTION_RULE_IDS: ReadonlyArray<string> = [
  // Identity, from any source of sign-ins (SSH and sudo included).
  "acf2a37e-301a-46de-87c7-d4343f3a8445",
  "c6b500e1-8b3c-4be3-b303-ef90a0355345",
  "e16d3ff9-32d3-4180-b4fc-c3c2fd4ca835",
  // A sequence: failed sign-ins from one address, then one that worked.
  "1e112332-583d-4fd9-b688-9b5d715d5896",
  // Linux commands, from sudo or an EDR.
  "aee4cdc7-f786-4023-a636-135397c6ff49",
  "deeb8c3e-02d1-465e-bc88-83b49be848b5",
  "738efe94-2259-4435-b346-f52c488409a0",
  "bbfee430-70b5-4d88-83aa-ef34aca8a8aa",
  // AWS CloudTrail.
  "e431079d-c7d4-4ae3-9bfc-b6407f2697b8",
  "0a8c9dcc-c2b4-46a0-8b41-8ac0c8b532a1",
  "3d89d3d5-2b7e-4650-bee7-dac72b6704c3",
  "388b42f9-2239-40bb-bf1a-2a476ad099c0",
  "066bf906-3932-4e5d-9920-131825734ea0",
  "2917bec0-2331-4e59-bdd4-a81211529156",
  // Attacks on web servers.
  "cfdf6ad4-7138-4201-8a1c-6bf962335cee",
  "68d61e5d-79d2-4f41-8c1b-c017f6d0bd52",
  "866b7566-304e-442b-b1ad-ca08264af493",
  // Kubernetes audit logs.
  "1ce3af71-a3d5-409a-b477-34e4a734aa83",
  "44e60520-facd-443a-bf1f-8c741819be91",
  "f18675fc-8708-44ff-9393-13e9c15250c0",
];

export function isRecommendedDetectionRule(
  entry: Pick<DetectionRuleLibraryEntry, "id">,
): boolean {
  return RECOMMENDED_DETECTION_RULE_IDS.includes(entry.id);
}

// The recommended rules, in the library's order.
export function getRecommendedDetectionRules(): Array<DetectionRuleLibraryEntry> {
  return DETECTION_RULE_LIBRARY.filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return isRecommendedDetectionRule(entry);
    },
  );
}

// The rule a setup test fires: many failed sign-ins from one address.
export const SETUP_TEST_DETECTION_RULE_ID: string =
  "acf2a37e-301a-46de-87c7-d4343f3a8445";
