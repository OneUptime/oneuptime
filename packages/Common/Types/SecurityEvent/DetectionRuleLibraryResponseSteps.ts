import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "./DetectionRuleLibrary";
import {
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
} from "./DetectionRuleResponseSteps";
import lookupTable from "../../Utils/LookupTable";

/*
 * WHAT TO DO WHEN A RULE LIBRARY RULE FIRES (#9621).
 *
 * Each rule in the library comes with response steps of its own
 * (DetectionRuleResponseSteps): what a responder checks to tell whether it
 * is real, what stops the harm that kind of attack does, and what fixes
 * what let it happen. A case's Response Plan shows them ahead of its
 * general steps - and a rule's Fix steps take the place of the general
 * ones, so a case opened by a library rule says what to do about that kind
 * of attack, not about attacks in general.
 *
 * They add what the plan cannot work out by itself: the plan already says
 * to block the address a case is about, to suspend its user and cut its
 * host off the network, to rule out a false positive and to declare an
 * incident, so these never repeat it.
 *
 * Steps shared by several rules are written once (LIBRARY_STEPS), and keep
 * the same id in each: a case two of them are on ticks the step off once.
 * Adding a library rule copies its steps onto the project's rule, where
 * the team can change them (SecurityTemplateRecords). A library rule added
 * before rules had steps reads them from here
 * (getDetectionRuleLibraryResponseStepsForYaml).
 *
 * Every library rule has steps, each one checkable as a rule's own
 * (DetectionRuleLibraryResponseSteps test).
 */

const { Confirm, Contain, Fix } = DetectionRuleResponsePhase;

// A step's id in LIBRARY_STEP_TEXTS: the test checks every one a rule names is there.
type LibraryStepId = string;

// The part of the plan a library step goes under, and its words.
interface LibraryStepText {
  phase: DetectionRuleResponsePhase;
  text: string;
}

/*
 * Every step a library rule carries, by its id, with the part of the plan
 * it goes under and its words.
 */
const LIBRARY_STEP_TEXTS: Readonly<Record<LibraryStepId, LibraryStepText>> = {
  // ----- Sign-ins -----
  "signin-success-after-failures": {
    phase: Confirm,
    text: "Check whether any sign-in from the same address succeeded during or after the failures.",
  },
  "spray-accounts-signed-in": {
    phase: Confirm,
    text: "List the accounts it tried, and check whether any of them signed in successfully afterwards.",
  },
  "ask-owner-was-signing-in": {
    phase: Confirm,
    text: "Ask the account's owner whether they were trying to sign in, and from where.",
  },
  "check-failed-signin-sources": {
    phase: Confirm,
    text: "Check where the failed sign-ins came from: one address, or many at once.",
  },
  "ask-owner-signin-theirs": {
    phase: Confirm,
    text: "Ask the account's owner whether the sign-in was theirs. Travel or a new VPN can explain one from a new place.",
  },
  "ask-owner-success-theirs": {
    phase: Confirm,
    text: "Ask the account's owner whether the successful sign-in after the failures was theirs.",
  },
  "reset-signed-in-accounts": {
    phase: Contain,
    text: "Reset the password of every account that signed in from the same address, and end its sessions.",
  },
  "reset-password-end-sessions": {
    phase: Contain,
    text: "If the sign-in was not the owner's, reset the account's password and end every session it has.",
  },
  "mfa-and-lockout": {
    phase: Fix,
    text: "Make sure every account it went after uses MFA, and lock an account out after repeated failed sign-ins.",
  },
  "ban-weak-passwords": {
    phase: Fix,
    text: "Block common and breached passwords, and require MFA for every account.",
  },
  "mfa-new-locations": {
    phase: Fix,
    text: "Require MFA for sign-ins from new places and new devices.",
  },
  "block-malicious-signins": {
    phase: Fix,
    text: "Block sign-ins from known malicious addresses with a conditional access or sign-on policy.",
  },

  // ----- MFA -----
  "ask-owner-approved-push": {
    phase: Confirm,
    text: "Ask the account's owner whether they approved a sign-in they did not start.",
  },
  "reset-password-now": {
    phase: Contain,
    text: "Reset the account's password now: whoever started the sign-in has it.",
  },
  "mfa-number-matching": {
    phase: Fix,
    text: "Move the account to number matching or a phishing-resistant factor, and limit how many pushes can be sent.",
  },
  "confirm-mfa-reset": {
    phase: Confirm,
    text: "Confirm with the account's owner and your help desk that someone asked for the MFA reset.",
  },
  "undo-mfa-reset": {
    phase: Contain,
    text: "If nobody asked for it, remove the new factors, reset the password and end every session of the account.",
  },
  "verify-before-mfa-reset": {
    phase: Fix,
    text: "Make your help desk confirm who is asking before it resets anyone's MFA.",
  },

  // ----- Accounts, roles and admin rights -----
  "confirm-grant-approved": {
    phase: Confirm,
    text: "Check who made the change, and whether a ticket or a change request asked for it.",
  },
  "remove-unapproved-admin": {
    phase: Contain,
    text: "If nobody asked for it, take the admin rights away now.",
  },
  "remove-unapproved-role": {
    phase: Contain,
    text: "If nobody asked for it, remove the role assignment now.",
  },
  "restrict-admin-grants": {
    phase: Fix,
    text: "Limit who can grant admin rights, and require a second person to approve it.",
  },
  "confirm-account-created": {
    phase: Confirm,
    text: "Check who created the account, and whether an onboarding ticket asked for it.",
  },
  "disable-new-account": {
    phase: Contain,
    text: "If nobody asked for the account, disable it.",
  },
  "disable-new-admin": {
    phase: Contain,
    text: "If nobody asked for the account, disable it and remove its admin rights.",
  },
  "review-new-accounts": {
    phase: Fix,
    text: "Require approval for new accounts, and review accounts nobody owns.",
  },
  "confirm-impersonation": {
    phase: Confirm,
    text: "Check who started the session, and whether a support request asked for it.",
  },
  "end-impersonation": {
    phase: Contain,
    text: "If nobody asked for it, end the session and suspend the admin who started it.",
  },
  "limit-impersonation": {
    phase: Fix,
    text: "Let only a few admins impersonate users, and require a reason for each session.",
  },
  "review-admin-groups": {
    phase: Fix,
    text: "Manage the administrators groups from one place, and review who is in them every month.",
  },
  "local-admin-management": {
    phase: Fix,
    text: "Manage local administrators centrally, with a tool such as LAPS, and review them every month.",
  },
  "entra-pim": {
    phase: Fix,
    text: "Use Privileged Identity Management, so admin roles are granted only when needed and approved.",
  },
  "azure-pim": {
    phase: Fix,
    text: "Use Privileged Identity Management for privileged Azure roles, so they are granted only when needed.",
  },

  // ----- Tokens, keys and app credentials -----
  "confirm-token-created": {
    phase: Confirm,
    text: "Check who created the key or token, what it can do, and whether they meant to.",
  },
  "revoke-new-token": {
    phase: Contain,
    text: "If nobody meant to create it, revoke it now.",
  },
  "token-hygiene": {
    phase: Fix,
    text: "Give keys and tokens an expiry and only the access they need, and review the long-lived ones.",
  },
  "check-app-consent": {
    phase: Confirm,
    text: "Check which app was given consent, by whom, and to which permissions.",
  },
  "revoke-app-consent": {
    phase: Contain,
    text: "If it is not an app your team uses, revoke its consent and disable it.",
  },
  "require-consent-approval": {
    phase: Fix,
    text: "Require an admin to approve an app before users can consent to it.",
  },
  "confirm-app-credential": {
    phase: Confirm,
    text: "Check who added the credential, to which app or user, and whether they meant to.",
  },
  "remove-app-credential": {
    phase: Contain,
    text: "If nobody meant to add it, remove the credential and check what signed in with it since.",
  },
  "limit-app-credentials": {
    phase: Fix,
    text: "Limit who can add credentials to apps, and prefer certificates or managed identities to secrets.",
  },
  "confirm-access-key": {
    phase: Confirm,
    text: "Check who created the access key, for which user, and whether they meant to.",
  },
  "deactivate-new-key": {
    phase: Contain,
    text: "If nobody meant to create the key, deactivate it now.",
  },
  "prefer-roles": {
    phase: Fix,
    text: "Use roles instead of long-lived access keys, and rotate the keys you keep.",
  },
  "confirm-sa-key": {
    phase: Confirm,
    text: "Check who created the key, for which service account, and whether they meant to.",
  },
  "delete-sa-key": {
    phase: Contain,
    text: "If nobody meant to create the key, delete it now.",
  },
  "block-sa-keys": {
    phase: Fix,
    text: "Stop service account keys being created with an organization policy, and use workload identity instead.",
  },

  // ----- Mail and files -----
  "check-mail-forwarding": {
    phase: Confirm,
    text: "Check where the mail is forwarded to, and ask the mailbox's owner whether they set it up.",
  },
  "remove-mail-forwarding": {
    phase: Contain,
    text: "If the owner did not set it up, remove the forwarding and reset their password.",
  },
  "block-external-forwarding": {
    phase: Fix,
    text: "Block automatic forwarding to addresses outside your organization.",
  },
  "check-public-file": {
    phase: Confirm,
    text: "Check what the file holds, and who made it public.",
  },
  "unshare-file": {
    phase: Contain,
    text: "Turn off sharing by link for the file.",
  },
  "limit-drive-sharing": {
    phase: Fix,
    text: "Limit sharing outside your organization in Google Drive's sharing settings.",
  },

  // ----- Google Workspace -----
  "check-2sv-off": {
    phase: Confirm,
    text: "Check who turned 2-Step Verification off, and for which accounts.",
  },
  "turn-2sv-on": {
    phase: Contain,
    text: "Turn 2-Step Verification back on, and end the sessions of the accounts it covers.",
  },
  "enforce-2sv": {
    phase: Fix,
    text: "Enforce 2-Step Verification for the whole organization, so it cannot be turned off account by account.",
  },
  "require-2sv": {
    phase: Fix,
    text: "Require 2-Step Verification for every account.",
  },
  "check-delegation": {
    phase: Confirm,
    text: "Check which client was given domain-wide delegation, and with which scopes.",
  },
  "remove-delegation": {
    phase: Contain,
    text: "If nobody meant to grant it, delete the delegation.",
  },
  "review-delegations": {
    phase: Fix,
    text: "Review every domain-wide delegation, and keep only the scopes each app needs.",
  },

  // ----- Microsoft Entra ID -----
  "entra-check-risk": {
    phase: Confirm,
    text: "Open the sign-in in Entra ID's risky sign-ins report, and check why it was flagged.",
  },
  "entra-confirm-compromised": {
    phase: Contain,
    text: "If it was not the owner, confirm the user compromised in Entra ID, reset the password and revoke their sessions.",
  },
  "entra-risk-policy": {
    phase: Fix,
    text: "Turn on a sign-in risk policy that requires MFA for risky sign-ins, or blocks them.",
  },

  // ----- Remote access -----
  "check-rdp-signin": {
    phase: Confirm,
    text: "Check who signed in over Remote Desktop, from where, and whether they should reach the machine that way.",
  },
  "close-rdp": {
    phase: Contain,
    text: "Close Remote Desktop to the internet, on the machine and at the firewall in front of it.",
  },
  "rdp-behind-vpn": {
    phase: Fix,
    text: "Put Remote Desktop behind a VPN or a gateway that requires MFA.",
  },

  // ----- Hosts: what ran -----
  "decode-powershell": {
    phase: Confirm,
    text: "Decode the command, and check what it does and what started it.",
  },
  "powershell-logging": {
    phase: Fix,
    text: "Turn on PowerShell script block logging, and Constrained Language Mode where you can.",
  },
  "check-ransomware": {
    phase: Confirm,
    text: "Check whether files on the host are being encrypted: deleting shadow copies is often ransomware's first step.",
  },
  "isolate-host-now": {
    phase: Contain,
    text: "Cut the host off the network now, before it reaches other machines.",
  },
  "restore-offline-backups": {
    phase: Fix,
    text: "Restore what was lost from backups kept offline, and check that they are complete.",
  },
  "check-tool-account": {
    phase: Confirm,
    text: "Check which account ran it, and how that account got the rights to.",
  },
  "reset-host-accounts": {
    phase: Fix,
    text: "Reset the passwords of every account that signed in to the host, starting with the admins.",
  },
  "lsa-protection": {
    phase: Fix,
    text: "Turn on LSA protection and Credential Guard, so other processes cannot read sign-in secrets.",
  },
  "check-downloaded-file": {
    phase: Confirm,
    text: "Find the file it downloaded, and check it with your antivirus or a sandbox.",
  },
  "remove-downloaded-file": {
    phase: Contain,
    text: "Delete the file, and block the address it came from.",
  },
  "block-lolbin-downloads": {
    phase: Fix,
    text: "Stop certutil and other built-in tools from reaching the internet.",
  },
  "check-downloaded-script": {
    phase: Confirm,
    text: "Find the script it downloaded, and check what it ran.",
  },
  "remove-script-changes": {
    phase: Fix,
    text: "Undo what the script changed, and stop running scripts straight from the internet.",
  },
  "check-reverse-shell": {
    phase: Confirm,
    text: "Find the process that opened the connection, and the address it connects to.",
  },
  "rebuild-host": {
    phase: Fix,
    text: "Find how the attacker got in, and rebuild the host from a known-good image.",
  },
  "check-history-cleared": {
    phase: Confirm,
    text: "Check who cleared the history, and what else they did on the host.",
  },
  "central-shell-logging": {
    phase: Fix,
    text: "Send shell activity to central logging, so clearing a history hides nothing.",
  },
  "check-scheduled-task": {
    phase: Confirm,
    text: "Check what the task runs, who created it, and whether a deployment explains it.",
  },
  "remove-scheduled-task": {
    phase: Contain,
    text: "If nobody expected it, disable the task and delete it.",
  },
  "check-new-service": {
    phase: Confirm,
    text: "Check what the service runs, who installed it, and whether a deployment explains it.",
  },
  "remove-new-service": {
    phase: Contain,
    text: "If nobody expected it, stop the service and delete it.",
  },
  "check-other-persistence": {
    phase: Fix,
    text: "Check the host for other ways it was set to run again: services, scheduled tasks, startup entries and accounts.",
  },
  "check-miner": {
    phase: Confirm,
    text: "Check the process's CPU use, and the mining pool it connects to.",
  },
  "stop-miner": {
    phase: Contain,
    text: "Stop the miner, and block the mining pool's address.",
  },
  "find-miner-entry": {
    phase: Fix,
    text: "Find how the miner got on the host, and rebuild the host if you cannot tell.",
  },
  "check-protection-off": {
    phase: Confirm,
    text: "Check who turned protection off, and whether they meant to.",
  },
  "protection-on-scan": {
    phase: Contain,
    text: "Turn protection back on now, and run a full scan of the host.",
  },
  "tamper-protection": {
    phase: Fix,
    text: "Turn on tamper protection, so protection cannot be turned off on the host.",
  },
  "check-firewall-off": {
    phase: Confirm,
    text: "Check who turned the firewall off, and whether they meant to.",
  },
  "firewall-on": {
    phase: Contain,
    text: "Turn the host's firewall back on now.",
  },
  "firewall-policy": {
    phase: Fix,
    text: "Manage the host firewall from a central policy, so it cannot be turned off on the host.",
  },
  "ask-sudo-reason": {
    phase: Confirm,
    text: "Ask the user why they ran sudo on this host, and check what they ran.",
  },
  "limit-sudo": {
    phase: Fix,
    text: "Limit sudo to the people and the commands that need it.",
  },
  "check-log-cleared": {
    phase: Confirm,
    text: "Check who cleared the log, and what they did on the host before.",
  },
  "forward-event-logs": {
    phase: Fix,
    text: "Forward the host's event logs as they are written, so clearing them hides nothing.",
  },
  "defender-check-action": {
    phase: Confirm,
    text: "Check in Microsoft Defender whether the file was blocked, quarantined or ran.",
  },
  "defender-full-scan": {
    phase: Contain,
    text: "If it ran, run a full scan of the device, and check the other devices it reached.",
  },
  "find-malware-entry": {
    phase: Fix,
    text: "Find how the file arrived - mail, a download, a USB drive - and block that way in.",
  },

  // ----- AWS -----
  "check-trail-stopped": {
    phase: Confirm,
    text: "Check who stopped the trail, and what else they did in the account.",
  },
  "restart-cloudtrail": {
    phase: Contain,
    text: "Start the trail again now.",
  },
  "protect-cloudtrail": {
    phase: Fix,
    text: "Use an organization trail, and a service control policy that stops anyone turning it off.",
  },
  "check-guardduty-removed": {
    phase: Confirm,
    text: "Check who removed the detector, and what else they did in the account.",
  },
  "enable-guardduty": {
    phase: Contain,
    text: "Turn GuardDuty back on in the region now.",
  },
  "protect-guardduty": {
    phase: Fix,
    text: "Manage GuardDuty from your organization's delegated admin account, so member accounts cannot turn it off.",
  },
  "check-root-use": {
    phase: Confirm,
    text: "Check what the root account did, and who holds its credentials.",
  },
  "secure-root": {
    phase: Contain,
    text: "If nobody expected it, change the root password and its MFA device now.",
  },
  "limit-root": {
    phase: Fix,
    text: "Keep the root account for the few tasks that need it, behind a hardware MFA key.",
  },
  "require-mfa-console": {
    phase: Contain,
    text: "Require MFA for the user before they can sign in to the console again.",
  },
  "enforce-aws-mfa": {
    phase: Fix,
    text: "Enforce MFA for every IAM user with a policy that denies actions without it.",
  },
  "check-denied-calls": {
    phase: Confirm,
    text: "Check which identity made the calls, and what it tried to reach.",
  },
  "deactivate-identity-keys": {
    phase: Contain,
    text: "If its keys may have been stolen, deactivate them.",
  },
  "rotate-identity-credentials": {
    phase: Fix,
    text: "Find everywhere the identity's credentials are used, and rotate them.",
  },
  "check-new-region": {
    phase: Confirm,
    text: "Check what was created in the region, and whether your team works there.",
  },
  "remove-region-resources": {
    phase: Contain,
    text: "Delete what nobody expected there, such as instances started to mine cryptocurrency.",
  },
  "deny-unused-regions": {
    phase: Fix,
    text: "Deny the regions you do not use with a service control policy.",
  },

  // ----- Google Cloud and Azure -----
  "check-log-sink": {
    phase: Confirm,
    text: "Check who changed the log sink, and where the logs go now.",
  },
  "restore-log-sink": {
    phase: Contain,
    text: "Put the sink back as it was.",
  },
  "protect-log-sinks": {
    phase: Fix,
    text: "Protect your log sinks and log buckets with IAM conditions and a locked retention policy.",
  },
  "check-diagnostic-deleted": {
    phase: Confirm,
    text: "Check who deleted the diagnostic setting, and what it sent where.",
  },
  "restore-diagnostic": {
    phase: Contain,
    text: "Create the diagnostic setting again now.",
  },
  "azure-policy-diagnostics": {
    phase: Fix,
    text: "Deploy diagnostic settings with Azure Policy, so they are put back when someone removes them.",
  },

  // ----- Networks -----
  "close-open-ports": {
    phase: Fix,
    text: "Close the ports the scan found open that do not need to be reachable.",
  },
  "limit-reachable-hosts": {
    phase: Fix,
    text: "Check which hosts answered the sweep, and take off the network what should not be reachable.",
  },
  "check-large-transfer": {
    phase: Confirm,
    text: "Find what was sent and where: the process on the host, and who owns the destination.",
  },
  "block-transfer-destination": {
    phase: Contain,
    text: "If it was not a backup or a sync your team runs, block the destination.",
  },
  "limit-egress": {
    phase: Fix,
    text: "Limit which hosts can send data out of your network, and to where.",
  },
  "confirm-pcap-download": {
    phase: Confirm,
    text: "Check who downloaded the packet capture, and whether they meant to.",
  },
  "limit-pcap-access": {
    phase: Fix,
    text: "Limit who can download packet captures, since they can hold passwords and data.",
  },

  // ----- Web apps -----
  "check-db-queries": {
    phase: Confirm,
    text: "Check the database's logs for queries the attack may have changed.",
  },
  "parameterized-queries": {
    phase: Fix,
    text: "Build the route's database queries with parameters, never by joining in what the request sent.",
  },
  "safe-file-paths": {
    phase: Fix,
    text: "Check how the route builds file paths, and serve files only from a folder you allow.",
  },
  "check-log4j": {
    phase: Confirm,
    text: "Check whether any of your services runs a Log4j older than 2.17.1.",
  },
  "upgrade-log4j": {
    phase: Fix,
    text: "Upgrade Log4j to 2.17.1 or later in every service.",
  },
  "check-injected-query": {
    phase: Confirm,
    text: "Find the query the database ran, and what data it could read or change.",
  },
  "block-vulnerable-route": {
    phase: Contain,
    text: "Block the route at your WAF, or take it offline, until it is fixed.",
  },
  "rotate-db-credentials": {
    phase: Fix,
    text: "Rotate the database credentials the app uses.",
  },
  "check-app-exception": {
    phase: Confirm,
    text: "Open the exception, and check what the request made the app do.",
  },
  "fix-exception-code": {
    phase: Fix,
    text: "Fix the code the exception points to, so a request like it is turned away instead.",
  },
  "check-ssrf-metadata": {
    phase: Confirm,
    text: "Check whether the request reached the metadata service and got credentials back.",
  },
  "rotate-instance-role": {
    phase: Contain,
    text: "If it got credentials, rotate the credentials of the instance's role now.",
  },
  "require-imdsv2": {
    phase: Fix,
    text: "Require IMDSv2, and check how the route fetches the addresses it is given.",
  },
  "check-llm-response": {
    phase: Confirm,
    text: "Check what the model answered, and whether it called a tool or showed data it should not.",
  },
  "limit-llm-tools": {
    phase: Fix,
    text: "Limit what the model's tools can do, and treat what the model writes as untrusted.",
  },

  // ----- Kubernetes -----
  "check-pod-shell": {
    phase: Confirm,
    text: "Check who opened the shell, and what they ran in it.",
  },
  "replace-pod": {
    phase: Contain,
    text: "If nobody expected it, delete the pod, so a clean one takes its place.",
  },
  "limit-pod-exec": {
    phase: Fix,
    text: "Allow pods/exec only to the people who need it, with RBAC.",
  },
  "check-privileged-pod": {
    phase: Confirm,
    text: "Check who created the pod, from which image, and why it needs to be privileged.",
  },
  "delete-pod": {
    phase: Contain,
    text: "If nobody expected it, delete the pod.",
  },
  "pod-security": {
    phase: Fix,
    text: "Enforce the restricted Pod Security Standard in the namespaces that do not need privileged pods.",
  },
  "delete-binding": {
    phase: Contain,
    text: "If nobody asked for it, delete the binding now.",
  },
  "review-cluster-admin": {
    phase: Fix,
    text: "Keep cluster-admin for break-glass accounts, and review its bindings every month.",
  },

  // ----- OpenStack -----
  "keystone-lockout": {
    phase: Fix,
    text: "Lock accounts out after repeated failed sign-ins in Keystone, and require MFA.",
  },
  "rotate-openstack-admin": {
    phase: Contain,
    text: "If it was not the admin, rotate their password and application credentials.",
  },
  "restrict-admin-networks": {
    phase: Fix,
    text: "Let admin credentials be used only from your own networks.",
  },
  "delete-app-credential": {
    phase: Contain,
    text: "If nobody meant to create the application credential, delete it.",
  },
  "check-open-security-group": {
    phase: Confirm,
    text: "Check which ports the rule opens, and on which servers.",
  },
  "narrow-security-group": {
    phase: Contain,
    text: "Narrow the rule to the addresses that need it, or remove it.",
  },
  "review-security-groups": {
    phase: Fix,
    text: "Review security groups regularly, and keep management ports closed to the internet.",
  },
  "check-public-image": {
    phase: Confirm,
    text: "Check what the image holds: keys, passwords or data.",
  },
  "make-image-private": {
    phase: Contain,
    text: "Make the image private again.",
  },
  "limit-public-images": {
    phase: Fix,
    text: "Limit who can publish public images.",
  },

  // ----- OneUptime -----
  "revert-role-change": {
    phase: Contain,
    text: "If nobody meant to, put the roles back as they were.",
  },
  "check-mass-delete": {
    phase: Confirm,
    text: "Check who deleted the records, and whether a cleanup explains it.",
  },
  "restore-deleted-records": {
    phase: Fix,
    text: "Restore what was deleted from a backup, and limit who can delete records in bulk.",
  },
  "check-control-change": {
    phase: Confirm,
    text: "Check which control changed, who changed it, and whether they meant to.",
  },
  "revert-control-change": {
    phase: Contain,
    text: "If nobody meant to, set it back now.",
  },
  "limit-security-admins": {
    phase: Fix,
    text: "Let only a few admins change security settings.",
  },

  // ----- Data stores -----
  "check-public-bucket": {
    phase: Confirm,
    text: "Check what the bucket holds, and who made it public.",
  },
  "make-bucket-private": {
    phase: Contain,
    text: "Make the bucket private again now.",
  },
  "block-public-access": {
    phase: Fix,
    text: "Turn on Block Public Access for the account, so no bucket can be made public.",
  },
  "check-shared-snapshot": {
    phase: Confirm,
    text: "Check which account the snapshot was shared with, and whether it is one of yours.",
  },
  "unshare-snapshot": {
    phase: Contain,
    text: "Stop sharing the snapshot now.",
  },
  "limit-snapshot-sharing": {
    phase: Fix,
    text: "Limit who can share snapshots, and encrypt them with keys you control.",
  },
  "check-protection-removed": {
    phase: Confirm,
    text: "Check which protection was removed, and who removed it.",
  },
  "restore-protection": {
    phase: Contain,
    text: "Put the protection back now: encryption, versioning or deletion protection.",
  },
  "enforce-store-protection": {
    phase: Fix,
    text: "Enforce the protection with a policy, so it cannot be removed.",
  },
  "check-db-export": {
    phase: Confirm,
    text: "Check where the export went, and who started it.",
  },
  "remove-db-export": {
    phase: Contain,
    text: "If nobody meant to, delete the export, and take away access to where it went.",
  },
  "limit-db-exports": {
    phase: Fix,
    text: "Limit who can export sensitive databases.",
  },
};

/*
 * Each library rule's steps, by the rule's Sigma id: what to check, what to
 * contain and what to fix, in the order a responder does them.
 */
const LIBRARY_RULE_STEPS: Readonly<Record<string, Array<LibraryStepId>>> = {
  // Brute force from one IP address
  "acf2a37e-301a-46de-87c7-d4343f3a8445": [
    "signin-success-after-failures",
    "reset-signed-in-accounts",
    "mfa-and-lockout",
  ],
  // Password spraying
  "c6b500e1-8b3c-4be3-b303-ef90a0355345": [
    "spray-accounts-signed-in",
    "reset-signed-in-accounts",
    "ban-weak-passwords",
  ],
  // Repeated failed sign-ins for one account
  "e16d3ff9-32d3-4180-b4fc-c3c2fd4ca835": [
    "ask-owner-was-signing-in",
    "check-failed-signin-sources",
    "mfa-and-lockout",
  ],
  // MFA push fatigue
  "dfcaef4f-07f2-438d-a869-4db25e1a1fc0": [
    "ask-owner-approved-push",
    "reset-password-end-sessions",
    "mfa-number-matching",
  ],
  // MFA push rejected or reported
  "6096316d-9af5-4ed4-9b00-5e61f9f0d3de": [
    "ask-owner-was-signing-in",
    "reset-password-now",
    "mfa-number-matching",
  ],
  // Account locked out
  "ca851016-9804-44ae-97e5-3687241e6d41": [
    "ask-owner-was-signing-in",
    "check-failed-signin-sources",
    "mfa-and-lockout",
  ],
  // Admin privileges granted
  "254307b4-0ef4-4399-8db9-6c405b16d4bb": [
    "confirm-grant-approved",
    "remove-unapproved-admin",
    "restrict-admin-grants",
  ],
  // MFA factors reset
  "da8d444e-14af-459d-9688-c7236c1e67c5": [
    "confirm-mfa-reset",
    "undo-mfa-reset",
    "verify-before-mfa-reset",
  ],
  // API token created
  "48dfd028-6a09-4efa-8a2f-8526a6cca13c": [
    "confirm-token-created",
    "revoke-new-token",
    "token-hygiene",
  ],
  // Admin impersonation session started
  "84e62bfa-318e-437c-bc5e-6f0c225570dc": [
    "confirm-impersonation",
    "end-impersonation",
    "limit-impersonation",
  ],
  // Sign-in from a malicious IP address
  "4eae9e9c-f247-4290-9d97-fb5042309b67": [
    "ask-owner-signin-theirs",
    "reset-password-end-sessions",
    "block-malicious-signins",
  ],
  // New account created
  "d4663a7b-417b-4e52-a4a1-0cea57462f33": [
    "confirm-account-created",
    "disable-new-account",
    "review-new-accounts",
  ],
  // Failed sign-ins, then a success from the same address
  "1e112332-583d-4fd9-b688-9b5d715d5896": [
    "ask-owner-success-theirs",
    "reset-password-end-sessions",
    "mfa-and-lockout",
  ],
  // Sign-in from an address the account never used
  "e65a43a0-6eb3-4441-beff-ecdfc5f0b8f4": [
    "ask-owner-signin-theirs",
    "reset-password-end-sessions",
    "mfa-new-locations",
  ],
  // Okta sign-in from a new country
  "99749e02-7b91-4139-96ca-fdc1ad7a0c53": [
    "ask-owner-signin-theirs",
    "reset-password-end-sessions",
    "mfa-new-locations",
  ],
  // New account given admin rights within an hour
  "497508d7-8051-41b8-905f-c149c008eca4": [
    "confirm-account-created",
    "disable-new-admin",
    "restrict-admin-grants",
  ],
  // Risky sign-in to Microsoft Entra ID
  "6520677f-9137-4245-a64f-de99b1de1f80": [
    "entra-check-risk",
    "entra-confirm-compromised",
    "entra-risk-policy",
  ],
  // Admin role assigned in Microsoft Entra ID
  "bcb2b1ec-2c44-4ca3-b7b1-6a3d8ecb2ac9": [
    "confirm-grant-approved",
    "remove-unapproved-role",
    "entra-pim",
  ],
  // App given consent in Microsoft Entra ID
  "2fce0248-3fca-4bd8-90bf-e3c6517a6236": [
    "check-app-consent",
    "revoke-app-consent",
    "require-consent-approval",
  ],
  // Credentials added to an app in Microsoft Entra ID
  "12325932-bdc4-4ac0-b298-89bacf24e4a4": [
    "confirm-app-credential",
    "remove-app-credential",
    "limit-app-credentials",
  ],
  // Mail forwarding set up in Microsoft 365
  "f05db5ba-80cc-4504-a44b-94052681e077": [
    "check-mail-forwarding",
    "remove-mail-forwarding",
    "block-external-forwarding",
  ],
  // Suspicious sign-in flagged by Google
  "65ae2039-ead2-466f-af67-bd67bcb85a95": [
    "ask-owner-signin-theirs",
    "reset-password-end-sessions",
    "require-2sv",
  ],
  // Admin privileges granted in Google Workspace
  "9d46ee62-1005-412e-9041-4a67045449e6": [
    "confirm-grant-approved",
    "remove-unapproved-admin",
    "restrict-admin-grants",
  ],
  // 2-Step Verification turned off in Google Workspace
  "117c666a-49c3-452a-b222-4ba4706e06d1": [
    "check-2sv-off",
    "turn-2sv-on",
    "enforce-2sv",
  ],
  // Domain-wide delegation granted in Google Workspace
  "8ec42d8b-ddfc-4247-8288-1241c6b5e297": [
    "check-delegation",
    "remove-delegation",
    "review-delegations",
  ],
  // File made public in Google Drive
  "f55f5b08-dbc1-49aa-b58a-cffd44360774": [
    "check-public-file",
    "unshare-file",
    "limit-drive-sharing",
  ],
  // Member added to a Windows administrators group
  "5968082b-ec2d-4c85-9788-d019b1cde11a": [
    "confirm-grant-approved",
    "remove-unapproved-admin",
    "review-admin-groups",
  ],
  // Windows account locked out
  "62ad4fdd-7d48-4374-97ea-da0fee709161": [
    "ask-owner-was-signing-in",
    "check-failed-signin-sources",
    "mfa-and-lockout",
  ],
  // Remote Desktop sign-in from the internet
  "4b0f1c6b-3ac8-4963-8fa4-802cdbf2a956": [
    "check-rdp-signin",
    "close-rdp",
    "rdp-behind-vpn",
  ],
  // Encoded PowerShell command
  "50e60fa4-eddb-4138-b68b-1f928a8f1f10": [
    "decode-powershell",
    "check-other-persistence",
    "powershell-logging",
  ],
  // Shadow copies deleted
  "0117bc13-9c29-4468-a916-af69bc488fca": [
    "check-ransomware",
    "isolate-host-now",
    "restore-offline-backups",
  ],
  // Credential dumping tool
  "a2999ff2-396e-449d-a3a4-484fb4c8b7b6": [
    "check-tool-account",
    "isolate-host-now",
    "reset-host-accounts",
  ],
  // File downloaded with certutil
  "08213b34-020a-4ab7-9d3b-e500079a7754": [
    "check-downloaded-file",
    "remove-downloaded-file",
    "block-lolbin-downloads",
  ],
  // Download piped into a shell
  "aee4cdc7-f786-4023-a636-135397c6ff49": [
    "check-downloaded-script",
    "remove-downloaded-file",
    "remove-script-changes",
  ],
  // Reverse shell
  "deeb8c3e-02d1-465e-bc88-83b49be848b5": [
    "check-reverse-shell",
    "isolate-host-now",
    "rebuild-host",
  ],
  // Shell history cleared or disabled
  "738efe94-2259-4435-b346-f52c488409a0": [
    "check-history-cleared",
    "central-shell-logging",
  ],
  // Password hashes read on Linux
  "bbfee430-70b5-4d88-83aa-ef34aca8a8aa": [
    "check-tool-account",
    "isolate-host-now",
    "reset-host-accounts",
  ],
  // Scheduled task created
  "66da2b4b-eb78-4bbf-8641-9e1bd9bf5add": [
    "check-scheduled-task",
    "remove-scheduled-task",
    "check-other-persistence",
  ],
  // Service installed from the command line
  "bb4c1441-ead6-4741-a55d-ffed4df9cd6e": [
    "check-new-service",
    "remove-new-service",
    "check-other-persistence",
  ],
  // Cryptocurrency miner
  "1c5de9c5-c305-422c-b485-af1dbbe9e763": [
    "check-miner",
    "stop-miner",
    "find-miner-entry",
  ],
  // Antivirus protection turned off
  "fd186eb5-3937-48af-bf0e-288a8385b45b": [
    "check-protection-off",
    "protection-on-scan",
    "tamper-protection",
  ],
  // Host firewall turned off
  "aab531be-d7c5-4749-8f40-eb4e22b9c21a": [
    "check-firewall-off",
    "firewall-on",
    "firewall-policy",
  ],
  // Local administrator added
  "0c1e122c-da8e-41a5-94c9-27de63f2a7db": [
    "confirm-grant-approved",
    "remove-unapproved-admin",
    "local-admin-management",
  ],
  // First sudo on a host by a user
  "0b55cc2f-57df-49ed-b98b-2e6b7f976d32": ["ask-sudo-reason", "limit-sudo"],
  // Windows event log cleared
  "4ebb2d0b-0d0c-4942-a9b5-d5f49a8792f1": [
    "check-log-cleared",
    "forward-event-logs",
  ],
  // Service installed that runs a command or a script
  "57eeee36-6dea-4aa0-b2cc-c008d1471170": [
    "check-new-service",
    "remove-new-service",
    "check-other-persistence",
  ],
  // LSASS memory read by another process
  "21d2996d-991f-4b0e-8c5e-7a702cfcdb22": [
    "check-tool-account",
    "isolate-host-now",
    "reset-host-accounts",
    "lsa-protection",
  ],
  // Microsoft Defender found malware
  "cd308b82-2c9e-4f9c-b471-64b17691c323": [
    "defender-check-action",
    "defender-full-scan",
    "find-malware-entry",
  ],
  // Microsoft Defender protection turned off
  "245f9cf4-f26c-4ce0-a471-b1b386229ebe": [
    "check-protection-off",
    "protection-on-scan",
    "tamper-protection",
  ],
  // CloudTrail logging stopped
  "e431079d-c7d4-4ae3-9bfc-b6407f2697b8": [
    "check-trail-stopped",
    "restart-cloudtrail",
    "protect-cloudtrail",
  ],
  // GuardDuty detector removed
  "0a8c9dcc-c2b4-46a0-8b41-8ac0c8b532a1": [
    "check-guardduty-removed",
    "enable-guardduty",
    "protect-guardduty",
  ],
  // AWS root account used
  "3d89d3d5-2b7e-4650-bee7-dac72b6704c3": [
    "check-root-use",
    "secure-root",
    "limit-root",
  ],
  // Console sign-in without MFA
  "388b42f9-2239-40bb-bf1a-2a476ad099c0": [
    "ask-owner-signin-theirs",
    "require-mfa-console",
    "enforce-aws-mfa",
  ],
  // Access key created
  "066bf906-3932-4e5d-9920-131825734ea0": [
    "confirm-access-key",
    "deactivate-new-key",
    "prefer-roles",
  ],
  // Burst of access-denied API calls
  "2917bec0-2331-4e59-bdd4-a81211529156": [
    "check-denied-calls",
    "deactivate-identity-keys",
    "rotate-identity-credentials",
  ],
  // AWS activity in a region the account never used
  "c71e033b-45d0-44cb-8835-c05cb59c9a96": [
    "check-new-region",
    "remove-region-resources",
    "deny-unused-regions",
  ],
  // Service account key created in Google Cloud
  "5dcbc2ba-eb97-4180-8bf3-38012dba4d45": [
    "confirm-sa-key",
    "delete-sa-key",
    "block-sa-keys",
  ],
  // Google Cloud audit logs re-routed or deleted
  "7949172c-ca9f-4b76-9e55-1671bbf396d0": [
    "check-log-sink",
    "restore-log-sink",
    "protect-log-sinks",
  ],
  // Role assignment created in Azure
  "35ab59f2-2747-45d8-afc1-071b81de4c98": [
    "confirm-grant-approved",
    "remove-unapproved-role",
    "azure-pim",
  ],
  // Azure diagnostic setting deleted
  "4e89bd36-5acc-453b-b4be-ce3980d532a5": [
    "check-diagnostic-deleted",
    "restore-diagnostic",
    "azure-policy-diagnostics",
  ],
  // Port scan
  "3c85f9a3-095a-4f77-8035-6fb7158dd458": ["close-open-ports"],
  // Network sweep
  "8f0fe4f6-c29a-4eb1-9426-73bb4ae1f3aa": ["limit-reachable-hosts"],
  // SQL injection attempts
  "cfdf6ad4-7138-4201-8a1c-6bf962335cee": [
    "check-db-queries",
    "parameterized-queries",
  ],
  // Path traversal attempts
  "68d61e5d-79d2-4f41-8c1b-c017f6d0bd52": ["safe-file-paths"],
  // Log4Shell exploit attempt
  "866b7566-304e-442b-b1ad-ca08264af493": ["check-log4j", "upgrade-log4j"],
  // Injected SQL reached the database
  "a1218db8-8e28-4afb-ae8e-ed4f0aef7595": [
    "check-injected-query",
    "block-vulnerable-route",
    "parameterized-queries",
    "rotate-db-credentials",
  ],
  // Attack request broke the app
  "47d32cc6-462c-44f9-8bcb-b99d7b083860": [
    "check-app-exception",
    "fix-exception-code",
  ],
  // Shell opened in a pod
  "1ce3af71-a3d5-409a-b477-34e4a734aa83": [
    "check-pod-shell",
    "replace-pod",
    "limit-pod-exec",
  ],
  // Privileged pod created
  "44e60520-facd-443a-bf1f-8c741819be91": [
    "check-privileged-pod",
    "delete-pod",
    "pod-security",
  ],
  // Cluster-admin granted
  "f18675fc-8708-44ff-9393-13e9c15250c0": [
    "confirm-grant-approved",
    "delete-binding",
    "review-cluster-admin",
  ],
  // First shell in a namespace by a user
  "861ed734-f8ec-46da-a0f8-cadeb0e1c750": [
    "check-pod-shell",
    "replace-pod",
    "limit-pod-exec",
  ],
  // OpenStack failed logins burst
  "6e7a4f92-2d3b-4b31-9a55-1f0c8e7d4a10": [
    "check-failed-signin-sources",
    "signin-success-after-failures",
    "keystone-lockout",
  ],
  // OpenStack role granted on a protected project
  "b1d2c8a4-4e0f-4a1c-8f43-73a6d5e2c901": [
    "confirm-grant-approved",
    "remove-unapproved-role",
    "restrict-admin-grants",
  ],
  // OpenStack admin credential used from a new address
  "c94e1b77-8a26-4d57-b2f1-0ea3f6d81c22": [
    "ask-owner-signin-theirs",
    "rotate-openstack-admin",
    "restrict-admin-networks",
  ],
  // OpenStack application credential created
  "0a5d3e68-71f2-4c8b-a9d4-6b2f1e0c7d35": [
    "confirm-app-credential",
    "delete-app-credential",
    "token-hygiene",
  ],
  // OpenStack security group opened to the world
  "f7b2e94c-3a68-4e1d-b05f-92c7d1a4e680": [
    "check-open-security-group",
    "narrow-security-group",
    "review-security-groups",
  ],
  // OpenStack public image published
  "2d8c6f13-9be4-47a0-8c1d-e5f30a7b9246": [
    "check-public-image",
    "make-image-private",
    "limit-public-images",
  ],
  // Server-side request forgery toward cloud metadata
  "a3d31a45-a620-48d2-895e-84b44f834b65": [
    "check-ssrf-metadata",
    "rotate-instance-role",
    "require-imdsv2",
  ],
  // Prompt injection attempt
  "48612a6d-c4b3-4ffb-a5da-0bc4e1e8a45b": [
    "check-llm-response",
    "limit-llm-tools",
  ],
  // Port scan seen in network flows
  "c3a5a3a9-2f46-418f-b9e5-cea6f11fd2ff": ["close-open-ports"],
  // Network sweep seen in network flows
  "ed597f63-c407-4b6e-81ff-674b917b7dbe": ["limit-reachable-hosts"],
  // Large transfer out of your network
  "b608ce0e-3d76-46c8-bcc2-1726de3fb3f3": [
    "check-large-transfer",
    "block-transfer-destination",
    "limit-egress",
  ],
  // Packet capture downloaded from OneUptime
  "0b89c3b4-d695-45e3-b4cb-27693cb77ae7": [
    "confirm-pcap-download",
    "limit-pcap-access",
  ],
  // New API key or MCP client in OneUptime
  "0720ff0e-f7af-4adb-8e61-1ded25079a39": [
    "confirm-token-created",
    "revoke-new-token",
    "token-hygiene",
  ],
  // Roles changed in OneUptime
  "976f75a0-9773-4be7-9b69-94b0262614a1": [
    "confirm-grant-approved",
    "revert-role-change",
    "restrict-admin-grants",
  ],
  // Many records deleted at once in OneUptime
  "51a51214-ca6e-43bc-b9ba-abf06cf4a135": [
    "check-mass-delete",
    "restore-deleted-records",
  ],
  // Security controls changed in OneUptime
  "d281b129-d12e-44e7-9b5b-957029e9a5a8": [
    "check-control-change",
    "revert-control-change",
    "limit-security-admins",
  ],
  // Signed-in user in two countries within an hour
  "2d9c0872-c111-4db5-8651-33621280dcff": [
    "ask-owner-signin-theirs",
    "reset-password-end-sessions",
    "mfa-new-locations",
  ],
  // A sensitive bucket was made public
  "7c8121cd-87ff-4e1c-bd5e-b1c3ab130737": [
    "check-public-bucket",
    "make-bucket-private",
    "block-public-access",
  ],
  // A snapshot of a sensitive database was shared
  "281a4d7b-8fe9-4b78-b847-33b464cabe01": [
    "check-shared-snapshot",
    "unshare-snapshot",
    "limit-snapshot-sharing",
  ],
  // Protection was removed from a sensitive store
  "f2dd0b9c-be85-4199-aa1a-ef64a520f887": [
    "check-protection-removed",
    "restore-protection",
    "enforce-store-protection",
  ],
  // A sensitive database was exported
  "6a40541c-7d7f-4463-af86-8efdf6c9be9c": [
    "check-db-export",
    "remove-db-export",
    "limit-db-exports",
  ],
};

/*
 * The two tables above as they are read: by a rule's id a caller hands in,
 * and by the step ids a rule names. A Map answers only for the ids it was
 * given, never for "constructor" or any other name every object inherits
 * (Utils/LookupTable), whatever text it is asked with.
 */
const STEP_TEXT_BY_ID: ReadonlyMap<LibraryStepId, LibraryStepText> =
  lookupTable(LIBRARY_STEP_TEXTS);

const STEP_IDS_BY_LIBRARY_RULE_ID: ReadonlyMap<
  string,
  Array<LibraryStepId>
> = lookupTable(LIBRARY_RULE_STEPS);

// Every step a library rule carries, by id: for the test that checks each one.
export function getDetectionRuleLibraryStepCatalog(): Array<DetectionRuleResponseStep> {
  return Array.from(STEP_TEXT_BY_ID.entries()).map(
    ([id, step]: [
      LibraryStepId,
      LibraryStepText,
    ]): DetectionRuleResponseStep => {
      return {
        id,
        phase: step.phase,
        text: step.text,
      };
    },
  );
}

// The library rule ids that have steps: for the test that checks each is a library rule.
export function getDetectionRuleLibraryIdsWithSteps(): Array<string> {
  return Array.from(STEP_IDS_BY_LIBRARY_RULE_ID.keys());
}

// The step ids a library rule names, as written: for the test that checks each is in the catalog.
export function getDetectionRuleLibraryStepIdsNamed(
  libraryRuleId: string,
): Array<string> {
  return [...(STEP_IDS_BY_LIBRARY_RULE_ID.get(libraryRuleId) || [])];
}

/*
 * A library rule's steps, by its Sigma id: a copy for each caller, so a
 * rule built from it owns its list. None for an id the library has none
 * for - "constructor" or any other name an object inherits included.
 */
export function getDetectionRuleLibraryResponseSteps(
  libraryRuleId: string,
): Array<DetectionRuleResponseStep> {
  const steps: Array<DetectionRuleResponseStep> = [];

  for (const id of STEP_IDS_BY_LIBRARY_RULE_ID.get(libraryRuleId) || []) {
    const step: LibraryStepText | undefined = STEP_TEXT_BY_ID.get(id);

    if (step) {
      steps.push({
        id,
        phase: step.phase,
        text: step.text,
      });
    }
  }

  return steps;
}

/*
 * The library rule a project's rule was added from, by the Sigma id its
 * YAML carries (as SecurityTemplateRecords knows one): null for a rule of
 * the project's own.
 */
export function findDetectionRuleLibraryEntryForYaml(
  sigmaRuleYaml: string | null | undefined,
): DetectionRuleLibraryEntry | null {
  const yaml: string = sigmaRuleYaml || "";

  if (!yaml) {
    return null;
  }

  return (
    DETECTION_RULE_LIBRARY.find((entry: DetectionRuleLibraryEntry): boolean => {
      return yaml.indexOf(`id: ${entry.id}`) !== -1;
    }) || null
  );
}

/*
 * The steps a library rule added before rules had steps of their own
 * reads: its library entry's. None for a rule of the project's own.
 */
export function getDetectionRuleLibraryResponseStepsForYaml(
  sigmaRuleYaml: string | null | undefined,
): Array<DetectionRuleResponseStep> {
  const entry: DetectionRuleLibraryEntry | null =
    findDetectionRuleLibraryEntryForYaml(sigmaRuleYaml);

  return entry ? getDetectionRuleLibraryResponseSteps(entry.id) : [];
}
