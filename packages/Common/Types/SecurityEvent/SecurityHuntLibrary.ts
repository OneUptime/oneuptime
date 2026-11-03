import TimeRange from "../Time/TimeRange";
import { DetectionRuleDataKind } from "./DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
} from "./DetectionRuleLibrary";

/*
 * THE HUNT LIBRARY: STARTER HUNTS.
 *
 * Ready-made searches over security events, the questions most security
 * teams ask again and again - failed sign-ins, encoded PowerShell, the AWS
 * root account, a shell opened in a pod - each one click from being a hunt
 * of the project's own (Types/SecurityEvent/SecurityHunt), as the Rule
 * Library's rules are one click from being its detection rules.
 *
 * Every search is written in the Events search bar's language, against the
 * fields every source is normalized into (class:, status:, processname:,
 * commandline:, ...) or the source's own attribute keys where only one
 * product says it (CloudTrail's @eventName, Okta's @eventType, Kubernetes
 * audit's @objectRef.resource) - the very keys the Rule Library's Sigma
 * rules read - so a starter finds what the project already sends, with no
 * field mapping. Each one compiles in the shared search's own tests
 * (SecurityHuntLibrary.test).
 *
 * A starter is grouped as the Rule Library groups its rules (its
 * categories), and names the kind of events it reads (DetectionRuleDataKind)
 * so the library says whether the project sends them; one that reads any
 * event (a threat intel match is stamped on whatever it matched) names none.
 *
 * Added, a starter is an ordinary hunt: opened by hand until someone gives
 * it a schedule, named and described in the words of whoever added it, and
 * changed like any other. It keeps the starter's id (libraryHuntId), which
 * is how the library knows the project has it, however it was renamed.
 *
 * Its title and description are Dashboard translation keys, read from here
 * by the string extractor; its search is what a person would type, never
 * translated.
 */

export interface SecurityHuntLibraryEntry {
  // Stable: kept on the hunt it becomes (SecurityHunt.libraryHuntId).
  id: string;
  title: string;
  description: string;
  category: DetectionRuleLibraryCategory;
  // The kind of events it reads; null when it reads any event.
  dataKind: DetectionRuleDataKind | null;
  // In the Events search bar's language, as written.
  searchQuery: string;
  // How far back it looks when it is opened.
  timeRange: TimeRange;
}

export const SECURITY_HUNT_LIBRARY: ReadonlyArray<SecurityHuntLibraryEntry> = [
  // Identity
  {
    id: "failed-sign-ins",
    title: "Failed sign-ins",
    description:
      "Every sign-in that failed, from any source: whose accounts are being guessed at, and from where.",
    category: DetectionRuleLibraryCategory.Identity,
    dataKind: DetectionRuleDataKind.SignIns,
    searchQuery: "class:Authentication status:Failure",
    timeRange: TimeRange.PAST_ONE_DAY,
  },
  {
    id: "admin-sign-ins",
    title: "Sign-ins by admin accounts",
    description:
      "Successful sign-ins by accounts with admin in their name. Check that each was someone you expect, from somewhere you expect.",
    category: DetectionRuleLibraryCategory.Identity,
    dataKind: DetectionRuleDataKind.SignIns,
    searchQuery: "class:Authentication status:Success user:*admin*",
    timeRange: TimeRange.PAST_ONE_WEEK,
  },
  {
    id: "accounts-created",
    title: "Accounts created",
    description:
      "New accounts in any directory you connect. An attacker's way back in looks like any other new account.",
    category: DetectionRuleLibraryCategory.Identity,
    dataKind: DetectionRuleDataKind.AccountChanges,
    searchQuery: 'class:"Account Change" activity:Create',
    timeRange: TimeRange.PAST_ONE_WEEK,
  },
  {
    id: "okta-admin-privileges-granted",
    title: "Admin rights granted in Okta",
    description:
      "Okta users and groups given administrator privileges. Expected during onboarding, worth a look any other time.",
    category: DetectionRuleLibraryCategory.Identity,
    dataKind: DetectionRuleDataKind.OktaSystemLog,
    searchQuery:
      "@eventType:(user.account.privilege.grant OR group.privilege.grant)",
    timeRange: TimeRange.PAST_ONE_MONTH,
  },

  // Endpoint
  {
    id: "encoded-powershell",
    title: "Encoded PowerShell",
    description:
      "PowerShell started with an encoded command, as attackers start what they would rather nobody read.",
    category: DetectionRuleLibraryCategory.Endpoint,
    dataKind: DetectionRuleDataKind.ProcessEvents,
    searchQuery: "processname:powershell.exe commandline:-enc",
    timeRange: TimeRange.PAST_ONE_WEEK,
  },
  {
    id: "certutil-downloads",
    title: "Files downloaded with certutil",
    description:
      "The Windows certificate tool fetching files from an address: a common way to bring tools onto a machine.",
    category: DetectionRuleLibraryCategory.Endpoint,
    dataKind: DetectionRuleDataKind.ProcessEvents,
    searchQuery: "processname:certutil.exe commandline:urlcache",
    timeRange: TimeRange.PAST_ONE_WEEK,
  },
  {
    id: "shadow-copies-deleted",
    title: "Shadow copies deleted",
    description:
      "Windows shadow copies deleted with vssadmin, as ransomware does before it encrypts a machine.",
    category: DetectionRuleLibraryCategory.Endpoint,
    dataKind: DetectionRuleDataKind.ProcessEvents,
    searchQuery: "processname:vssadmin.exe commandline:delete",
    timeRange: TimeRange.PAST_ONE_MONTH,
  },
  {
    id: "scheduled-tasks-created",
    title: "Scheduled tasks created",
    description:
      "Scheduled tasks created from the command line: a way to keep a foothold on a machine after it restarts.",
    category: DetectionRuleLibraryCategory.Endpoint,
    dataKind: DetectionRuleDataKind.ProcessEvents,
    searchQuery: "processname:schtasks.exe commandline:/create",
    timeRange: TimeRange.PAST_ONE_WEEK,
  },
  {
    id: "commands-run-with-sudo",
    title: "Commands run with sudo",
    description:
      "Every command run with sudo on your Linux hosts: who ran it, and where.",
    category: DetectionRuleLibraryCategory.Endpoint,
    dataKind: DetectionRuleDataKind.SudoLogs,
    searchQuery: "product:sudo activity:Launch",
    timeRange: TimeRange.PAST_ONE_DAY,
  },
  {
    id: "windows-event-logs-cleared",
    title: "Windows event logs cleared",
    description:
      "A Windows machine's Security or System log was cleared: the record of what happened on it is gone.",
    category: DetectionRuleLibraryCategory.Endpoint,
    dataKind: DetectionRuleDataKind.WindowsEvents,
    searchQuery: "@EventID:(1102 OR 104)",
    timeRange: TimeRange.PAST_ONE_MONTH,
  },

  // Cloud
  {
    id: "aws-root-account-activity",
    title: "AWS root account activity",
    description:
      "Everything the AWS root account did. Day-to-day work should never need it.",
    category: DetectionRuleLibraryCategory.Cloud,
    dataKind: DetectionRuleDataKind.AwsCloudTrail,
    searchQuery: "@userIdentity.type:Root",
    timeRange: TimeRange.PAST_ONE_MONTH,
  },
  {
    id: "aws-console-sign-ins-without-mfa",
    title: "AWS console sign-ins without MFA",
    description: "Sign-ins to the AWS console that used no second factor.",
    category: DetectionRuleLibraryCategory.Cloud,
    dataKind: DetectionRuleDataKind.AwsCloudTrail,
    searchQuery: "@eventName:ConsoleLogin @additionalEventData.MFAUsed:No",
    timeRange: TimeRange.PAST_ONE_WEEK,
  },
  {
    id: "aws-access-keys-created",
    title: "AWS access keys created",
    description:
      "New AWS access keys. A key outlives a password change and works from anywhere.",
    category: DetectionRuleLibraryCategory.Cloud,
    dataKind: DetectionRuleDataKind.AwsCloudTrail,
    searchQuery: "@eventName:CreateAccessKey",
    timeRange: TimeRange.PAST_ONE_MONTH,
  },

  // Network
  {
    id: "remote-desktop-connections",
    title: "Connections to Remote Desktop",
    description:
      "Network connections to port 3389, where Remote Desktop listens. It should not be open to the internet.",
    category: DetectionRuleLibraryCategory.Network,
    dataKind: DetectionRuleDataKind.NetworkActivity,
    searchQuery: 'class:"Network Activity" targetport:3389',
    timeRange: TimeRange.PAST_ONE_DAY,
  },
  {
    id: "threat-intel-matches",
    title: "Threat intel matches",
    description:
      "Every event that names an indicator on one of your threat intel feeds, whatever sent it.",
    category: DetectionRuleLibraryCategory.Network,
    dataKind: null,
    searchQuery: "@threat.matched:true",
    timeRange: TimeRange.PAST_ONE_WEEK,
  },

  // Web
  {
    id: "sql-injection-in-requests",
    title: "SQL injection in requests",
    description:
      "Web requests whose address carries union select, the shape of a common SQL injection.",
    category: DetectionRuleLibraryCategory.Web,
    dataKind: DetectionRuleDataKind.WebRequests,
    searchQuery: 'class:"HTTP Activity" resource:"union select"',
    timeRange: TimeRange.PAST_ONE_WEEK,
  },
  {
    id: "attacks-that-reached-the-database",
    title: "Attacks that reached the database",
    description:
      "Attack requests whose trace shows they got all the way to your database.",
    category: DetectionRuleLibraryCategory.Web,
    dataKind: DetectionRuleDataKind.WebRequests,
    searchQuery: 'requestoutcome:"Reached Database"',
    timeRange: TimeRange.PAST_ONE_WEEK,
  },

  // Kubernetes
  {
    id: "kubernetes-pod-shells",
    title: "Shells opened in pods",
    description:
      "Someone ran kubectl exec into a running pod: a shell inside your cluster.",
    category: DetectionRuleLibraryCategory.Kubernetes,
    dataKind: DetectionRuleDataKind.KubernetesAuditLogs,
    searchQuery: "@objectRef.resource:pods @objectRef.subresource:exec",
    timeRange: TimeRange.PAST_ONE_WEEK,
  },
];

/*
 * The categories the library has starters in, in the Rule Library's order:
 * a category with none (Data security) is not offered as a filter.
 */
export function getSecurityHuntLibraryCategories(): Array<DetectionRuleLibraryCategory> {
  return DETECTION_RULE_LIBRARY_CATEGORIES.filter(
    (category: DetectionRuleLibraryCategory): boolean => {
      return SECURITY_HUNT_LIBRARY.some(
        (entry: SecurityHuntLibraryEntry): boolean => {
          return entry.category === category;
        },
      );
    },
  );
}

export function getSecurityHuntLibraryEntry(
  id: string | undefined | null,
): SecurityHuntLibraryEntry | undefined {
  if (!id) {
    return undefined;
  }

  return SECURITY_HUNT_LIBRARY.find(
    (entry: SecurityHuntLibraryEntry): boolean => {
      return entry.id === id;
    },
  );
}

export function isSecurityHuntLibraryId(value: unknown): value is string {
  return (
    typeof value === "string" && Boolean(getSecurityHuntLibraryEntry(value))
  );
}
