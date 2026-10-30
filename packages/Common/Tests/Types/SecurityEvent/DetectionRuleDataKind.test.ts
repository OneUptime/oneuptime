import { describe, expect, test } from "@jest/globals";
import { JSONValue } from "../../../Types/JSON";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  DATA_SECURITY_SIGNAL_PRODUCT_NAME,
  DATA_SECURITY_STORE_CHANGE_SIGNAL,
} from "../../../Types/SecurityEvent/DataSecuritySignal";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  DETECTION_RULE_DATA_KINDS,
  DETECTION_RULE_DATA_KINDS_IN_ORDER,
  DetectionRuleDataKind,
  DetectionRuleDataKindDefinition,
  SecurityEventKindsSeen,
  getDetectionRuleDataKindDefinition,
  isDetectionRuleDataKindSeen,
} from "../../../Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { OcsfEventClasses } from "../../../Types/SecurityEvent/OcsfEventClass";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
  getSecurityLogFormatDefinition,
} from "../../../Types/SecurityEvent/SecurityLogFormat";
import SigmaRule, {
  SigmaFieldRequirement,
  SigmaSelection,
} from "../../../Types/SecurityEvent/SigmaRule";
import SecurityLogParser from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SigmaRuleSetParser, {
  sigmaRulesOf,
} from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  SSH_LINES,
  SUDO_LINES,
  WEB_LINES,
  auditEvent,
  cloudTrailRecord,
  logLine,
} from "../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

/*
 * What each rule of the library reads (DetectionRuleDataKind), and how the
 * Rule Library tells a project sends it: from the classes, vendors and
 * products of the events it stored.
 *
 * Pinned against the things the kinds stand for, not against a copy of
 * them: each library rule's own Sigma fields say which kind it reads, and
 * the events "Your logs" makes out of real log lines - and the vendor and
 * product the Okta connector stamps - are recognized as the kinds they are.
 */

const NOTHING: SecurityEventKindsSeen = {
  classNames: [],
  vendorNames: [],
  productNames: [],
};

// Every field a rule's selections ask for, across every rule a correlation reads.
function fieldsOf(entry: DetectionRuleLibraryEntry): Array<{
  field: string;
  values: Array<JSONValue>;
}> {
  return sigmaRulesOf(SigmaRuleSetParser.parse(entry.sigmaRuleYaml)).flatMap(
    (rule: SigmaRule) => {
      return rule.selections.flatMap((selection: SigmaSelection) => {
        return selection.fieldMaps.flatMap(
          (fieldMap: Array<SigmaFieldRequirement>) => {
            return fieldMap.map((requirement: SigmaFieldRequirement) => {
              return {
                field: requirement.field,
                values: requirement.values,
              };
            });
          },
        );
      });
    },
  );
}

function readsField(
  entry: DetectionRuleLibraryEntry,
  field: string,
  value?: string,
): boolean {
  return fieldsOf(entry).some(
    (requirement: { field: string; values: Array<JSONValue> }): boolean => {
      return (
        requirement.field === field &&
        (value === undefined ||
          requirement.values.some((candidate: JSONValue): boolean => {
            return String(candidate) === value;
          }))
      );
    },
  );
}

// What the events a project stored say, as the page's grouped count reads them.
function seenFrom(
  events: ReadonlyArray<NormalizedSecurityEvent>,
): SecurityEventKindsSeen {
  return {
    classNames: events.map((event: NormalizedSecurityEvent): string => {
      return event.className;
    }),
    vendorNames: events.map((event: NormalizedSecurityEvent): string => {
      return event.vendorName;
    }),
    productNames: events.map((event: NormalizedSecurityEvent): string => {
      return event.productName;
    }),
  };
}

function parse(body: string): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse(logLine(body, { "host.name": "web-03" }));
}

function kindsSeenIn(
  seen: SecurityEventKindsSeen,
): Array<DetectionRuleDataKind> {
  return DETECTION_RULE_DATA_KINDS_IN_ORDER.filter(
    (kind: DetectionRuleDataKind): boolean => {
      return isDetectionRuleDataKindSeen(kind, seen);
    },
  );
}

describe("the kinds of event library rules read", () => {
  test("every kind is defined once, in the order the page lists them", () => {
    expect(
      DETECTION_RULE_DATA_KINDS.map(
        (definition: DetectionRuleDataKindDefinition) => {
          return definition.kind;
        },
      ),
    ).toEqual(DETECTION_RULE_DATA_KINDS_IN_ORDER);
    expect(new Set(DETECTION_RULE_DATA_KINDS_IN_ORDER).size).toBe(
      Object.values(DetectionRuleDataKind).length,
    );
  });

  test("every kind is recognized by at least one class, vendor or product", () => {
    for (const definition of DETECTION_RULE_DATA_KINDS) {
      const recognizers: number =
        definition.classNames.length +
        definition.vendorNames.length +
        definition.productNames.length;

      expect([definition.kind, recognizers > 0]).toEqual([
        definition.kind,
        true,
      ]);
    }
  });

  test("the classes the kinds name are OCSF classes OneUptime maps events onto", () => {
    const classNames: Array<string> = OcsfEventClasses.map(
      (eventClass: { name: string }): string => {
        return eventClass.name;
      },
    );

    for (const definition of DETECTION_RULE_DATA_KINDS) {
      for (const className of definition.classNames) {
        expect([definition.kind, classNames.includes(className)]).toEqual([
          definition.kind,
          true,
        ]);
      }
    }
  });

  test("the products of Your logs and the Okta connector are the ones the kinds name", () => {
    const productOf: (format: SecurityLogFormat) => string = (
      format: SecurityLogFormat,
    ): string => {
      return getSecurityLogFormatDefinition(format)!.productName;
    };

    expect(
      getDetectionRuleDataKindDefinition(DetectionRuleDataKind.SudoLogs)
        ?.productNames,
    ).toEqual([productOf(SecurityLogFormat.Sudo)]);
    expect(
      getDetectionRuleDataKindDefinition(DetectionRuleDataKind.AwsCloudTrail)
        ?.productNames,
    ).toEqual([productOf(SecurityLogFormat.AwsCloudTrail)]);
    expect(
      getDetectionRuleDataKindDefinition(
        DetectionRuleDataKind.KubernetesAuditLogs,
      )?.productNames,
    ).toEqual([productOf(SecurityLogFormat.KubernetesAudit)]);
    expect(
      getDetectionRuleDataKindDefinition(DetectionRuleDataKind.WebRequests)
        ?.productNames,
    ).toEqual([productOf(SecurityLogFormat.WebAttack)]);

    const okta: SecurityEventConnectorDefinition =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.OktaSystemLog,
      )!;

    expect(
      getDetectionRuleDataKindDefinition(DetectionRuleDataKind.DataSecurity)
        ?.productNames,
    ).toEqual([DATA_SECURITY_SIGNAL_PRODUCT_NAME]);

    for (const kind of [
      DetectionRuleDataKind.OktaSystemLog,
      DetectionRuleDataKind.AccountChanges,
    ]) {
      expect(getDetectionRuleDataKindDefinition(kind)?.vendorNames).toEqual([
        okta.vendorName,
      ]);
      expect(getDetectionRuleDataKindDefinition(kind)?.productNames).toEqual([
        okta.productName,
      ]);
    }
  });
});

describe("each library rule names the kind of event its Sigma reads", () => {
  const entries: Array<[string, DetectionRuleLibraryEntry]> =
    DETECTION_RULE_LIBRARY.map(
      (
        entry: DetectionRuleLibraryEntry,
      ): [string, DetectionRuleLibraryEntry] => {
        return [entry.title, entry];
      },
    );

  test("every rule names a known kind", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      expect([
        entry.title,
        Object.values(DetectionRuleDataKind).includes(entry.dataKind),
      ]).toEqual([entry.title, true]);
    }
  });

  test.each(entries)(
    "%s",
    (_title: string, entry: DetectionRuleLibraryEntry) => {
      switch (entry.dataKind) {
        case DetectionRuleDataKind.SignIns:
          expect(readsField(entry, "className", "Authentication")).toBe(true);
          break;
        case DetectionRuleDataKind.AccountChanges:
          expect(readsField(entry, "className", "Account Change")).toBe(true);
          break;
        case DetectionRuleDataKind.OktaSystemLog:
          // Okta's own event types, which only its System Log carries.
          expect(readsField(entry, "eventType")).toBe(true);
          expect(entry.dataSource).toBe("Okta System Log");
          break;
        case DetectionRuleDataKind.EntraId:
          /*
           * The Microsoft 365 audit log comes through the Microsoft Entra ID
           * connection: its rules read the connection's own reading of it.
           */
          if (entry.dataSource.startsWith("Microsoft 365 audit log")) {
            expect(readsField(entry, "microsoft365.forwardsMail")).toBe(true);
            expect(entry.dataSource).toContain("Microsoft Entra ID connection");
            break;
          }

          // Entra ID's own fields, which only its sign-ins and audit logs carry.
          expect(
            readsField(entry, "riskLevelDuringSignIn") ||
              readsField(entry, "riskLevelAggregated") ||
              readsField(entry, "activityDisplayName"),
          ).toBe(true);
          expect(entry.dataSource.startsWith("Microsoft Entra ID")).toBe(true);
          break;
        case DetectionRuleDataKind.GoogleWorkspace:
          // The Reports API's event names, which only Workspace's activities carry.
          expect(readsField(entry, "event.name")).toBe(true);
          expect(entry.dataSource.startsWith("Google Workspace")).toBe(true);
          break;
        case DetectionRuleDataKind.WindowsEvents:
          // Windows' own event ids, kept under Windows' name for them.
          expect(readsField(entry, "EventID")).toBe(true);
          break;
        case DetectionRuleDataKind.GoogleCloudAuditLogs:
          expect(readsField(entry, "protoPayload.methodName")).toBe(true);
          break;
        case DetectionRuleDataKind.AzureActivityLog:
          // An Azure operation's name, as the Activity Log writes it.
          expect(readsField(entry, "activityName")).toBe(true);
          break;
        case DetectionRuleDataKind.ProcessEvents:
          expect(readsField(entry, "CommandLine")).toBe(true);
          break;
        case DetectionRuleDataKind.SudoLogs:
          expect(readsField(entry, "productName", "sudo")).toBe(true);
          break;
        case DetectionRuleDataKind.AwsCloudTrail:
          expect(
            readsField(entry, "eventName") ||
              readsField(entry, "errorCode") ||
              readsField(entry, "userIdentity.type") ||
              readsField(entry, "productName", "AWS CloudTrail"),
          ).toBe(true);
          break;
        case DetectionRuleDataKind.NetworkActivity:
          expect(readsField(entry, "className", "Network Activity")).toBe(true);
          break;
        case DetectionRuleDataKind.WebRequests:
          // What was asked for, or how far the request got (only a request followed into its trace has an outcome).
          expect(
            readsField(entry, "targetResource") ||
              readsField(entry, "requestOutcome"),
          ).toBe(true);
          break;
        case DetectionRuleDataKind.KubernetesAuditLogs:
          expect(readsField(entry, "objectRef.resource")).toBe(true);
          break;
        case DetectionRuleDataKind.OneUptimeTraces:
        case DetectionRuleDataKind.NetworkFlows:
        case DetectionRuleDataKind.OneUptimeAuditLog:
        case DetectionRuleDataKind.SessionReplays:
          // What a source of your OneUptime data found, as each of its events names it.
          expect(readsField(entry, "oneuptime.signal")).toBe(true);
          break;
        case DetectionRuleDataKind.DataSecurity:
          // A change to a sensitive store, as Data Security writes one.
          expect(
            readsField(
              entry,
              "oneuptime.signal",
              DATA_SECURITY_STORE_CHANGE_SIGNAL,
            ),
          ).toBe(true);
          expect(readsField(entry, "oneuptime.cloud.operation")).toBe(true);
          break;
        default:
          throw new Error(`No check for ${String(entry.dataKind)}`);
      }
    },
  );

  test("the recommended rules read only what most projects can send without a product: no Okta, no network gear", () => {
    for (const entry of getRecommendedDetectionRules()) {
      expect([entry.title, entry.dataKind]).not.toEqual([
        entry.title,
        DetectionRuleDataKind.OktaSystemLog,
      ]);
      expect([entry.title, entry.dataKind]).not.toEqual([
        entry.title,
        DetectionRuleDataKind.NetworkActivity,
      ]);
    }
  });
});

describe("whether a project sends a kind", () => {
  test("nothing seen sends no kind", () => {
    expect(kindsSeenIn(NOTHING)).toEqual([]);
  });

  test("a class, vendor or product counts whatever its case or spacing", () => {
    expect(
      isDetectionRuleDataKindSeen(DetectionRuleDataKind.SignIns, {
        ...NOTHING,
        classNames: ["  authentication "],
      }),
    ).toBe(true);
    expect(
      isDetectionRuleDataKindSeen(DetectionRuleDataKind.OktaSystemLog, {
        ...NOTHING,
        vendorNames: ["OKTA"],
      }),
    ).toBe(true);
    expect(
      isDetectionRuleDataKindSeen(DetectionRuleDataKind.KubernetesAuditLogs, {
        ...NOTHING,
        productNames: ["kubernetes AUDIT log"],
      }),
    ).toBe(true);
  });

  test("a value of another kind, or the empty value a source that did not say leaves, sends nothing", () => {
    expect(
      kindsSeenIn({
        classNames: ["Detection Finding", ""],
        vendorNames: ["CrowdStrike", ""],
        productNames: ["Falcon", ""],
      }),
    ).toEqual([]);
  });

  test("Okta's System Log is its own kind and account changes, not sign-ins (those come by their class)", () => {
    expect(
      kindsSeenIn({
        ...NOTHING,
        vendorNames: ["Okta"],
        productNames: ["Okta System Log"],
      }),
    ).toEqual([
      DetectionRuleDataKind.AccountChanges,
      DetectionRuleDataKind.OktaSystemLog,
    ]);
  });

  test("SSH sign-ins from your logs send sign-ins", () => {
    const seen: SecurityEventKindsSeen = seenFrom([
      ...parse(SSH_LINES.failedPasswordInvalidUser),
      ...parse(SSH_LINES.acceptedPublicKey),
    ]);

    expect(kindsSeenIn(seen)).toEqual([DetectionRuleDataKind.SignIns]);
  });

  test("sudo's commands from your logs send sudo logs and process events (the Linux rules read their command lines)", () => {
    const seen: SecurityEventKindsSeen = seenFrom(parse(SUDO_LINES.commandRun));

    expect(kindsSeenIn(seen)).toEqual(
      expect.arrayContaining([
        DetectionRuleDataKind.ProcessEvents,
        DetectionRuleDataKind.SudoLogs,
      ]),
    );
    expect(kindsSeenIn(seen)).not.toContain(
      DetectionRuleDataKind.KubernetesAuditLogs,
    );
  });

  test("Kubernetes audit events from your logs send Kubernetes audit logs", () => {
    const seen: SecurityEventKindsSeen = seenFrom(
      parse(
        JSON.stringify(
          auditEvent({
            verb: "create",
            objectRef: {
              resource: "pods",
              namespace: "default",
              name: "web-7d9",
              subresource: "exec",
            },
          }),
        ),
      ),
    );

    expect(kindsSeenIn(seen)).toContain(
      DetectionRuleDataKind.KubernetesAuditLogs,
    );
  });

  test("CloudTrail records from your logs send AWS CloudTrail", () => {
    const seen: SecurityEventKindsSeen = seenFrom(
      parse(JSON.stringify(cloudTrailRecord({}))),
    );

    expect(kindsSeenIn(seen)).toContain(DetectionRuleDataKind.AwsCloudTrail);
  });

  test("web attacks from your logs send web requests", () => {
    const seen: SecurityEventKindsSeen = seenFrom([
      ...parse(WEB_LINES.sqlInjectionEncoded),
      ...parse(WEB_LINES.pathTraversal),
    ]);

    expect(kindsSeenIn(seen)).toContain(DetectionRuleDataKind.WebRequests);
  });

  test("every format of your logs sends at least one kind a library rule reads", () => {
    const kindsRead: Set<DetectionRuleDataKind> = new Set(
      DETECTION_RULE_LIBRARY.map(
        (entry: DetectionRuleLibraryEntry): DetectionRuleDataKind => {
          return entry.dataKind;
        },
      ),
    );

    for (const format of SECURITY_LOG_FORMATS) {
      const definition: DetectionRuleDataKindDefinition | undefined =
        DETECTION_RULE_DATA_KINDS.find(
          (candidate: DetectionRuleDataKindDefinition): boolean => {
            return (
              candidate.productNames.includes(format.productName) ||
              isDetectionRuleDataKindSeen(candidate.kind, {
                ...NOTHING,
                productNames: [format.productName],
              })
            );
          },
        );

      /*
       * SSH sign-ins come by their class (Authentication), and so do a
       * security product's CEF and LEEF records (Authentication, Network
       * Activity, Detection Finding), which carry the product's own name;
       * the rest by product.
       */
      if (
        format.format === SecurityLogFormat.SshSignIn ||
        format.format === SecurityLogFormat.Cef ||
        format.format === SecurityLogFormat.Leef
      ) {
        continue;
      }

      expect([format.format, Boolean(definition)]).toEqual([
        format.format,
        true,
      ]);
      expect(kindsRead.has(definition!.kind)).toBe(true);
    }
  });
});
