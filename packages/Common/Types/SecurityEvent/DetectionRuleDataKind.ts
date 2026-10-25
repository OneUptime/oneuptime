import SecurityEventConnectorProvider from "./Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "./Connectors/SecurityEventConnectorCatalog";
import SecurityLogFormat, {
  SecurityLogFormatDefinition,
  getSecurityLogFormatDefinition,
} from "./SecurityLogFormat";

/*
 * What a rule of the library reads: the kind of security event it needs to
 * find anything at all - sign-ins, Okta's System Log, process command
 * lines, AWS CloudTrail and so on - and how OneUptime tells that a project
 * sends that kind: by what the events it stored carry, their OCSF class
 * (className), vendor (vendorName) or product (productName), as the
 * connectors and the log parsers ("Your logs") stamp them.
 *
 * The Rule Library says beside each rule whether the project sends what it
 * reads, so a security engineer adds rules for the data they have, and
 * knows what to connect for the rest. A rule whose kind never arrives
 * still runs - one quick query a run - and never fires.
 */
export enum DetectionRuleDataKind {
  // Sign-ins, failed and successful, from any source (OCSF Authentication).
  SignIns = "sign-ins",
  // Accounts created, changed or removed, from any source (OCSF Account Change).
  AccountChanges = "account-changes",
  // Okta's System Log, read by Okta's own event types.
  OktaSystemLog = "okta-system-log",
  // Processes started, with their command lines: an EDR, Sysmon, auditd, sudo.
  ProcessEvents = "process-events",
  // sudo's log lines, which "Your logs" reads.
  SudoLogs = "sudo-logs",
  // AWS CloudTrail records, which "Your logs" reads.
  AwsCloudTrail = "aws-cloudtrail",
  // Connections between hosts: firewalls, flow logs, IDS (OCSF Network Activity).
  NetworkActivity = "network-activity",
  // Requests to web servers (OCSF HTTP Activity), as "Your logs" reads access logs.
  WebRequests = "web-requests",
  // Kubernetes audit logs, which "Your logs" reads.
  KubernetesAuditLogs = "kubernetes-audit-logs",
}

export const DETECTION_RULE_DATA_KINDS_IN_ORDER: ReadonlyArray<DetectionRuleDataKind> =
  [
    DetectionRuleDataKind.SignIns,
    DetectionRuleDataKind.AccountChanges,
    DetectionRuleDataKind.OktaSystemLog,
    DetectionRuleDataKind.ProcessEvents,
    DetectionRuleDataKind.SudoLogs,
    DetectionRuleDataKind.AwsCloudTrail,
    DetectionRuleDataKind.NetworkActivity,
    DetectionRuleDataKind.WebRequests,
    DetectionRuleDataKind.KubernetesAuditLogs,
  ];

/*
 * The classes, vendors and products of the security events a project
 * stored lately, each as stored (the Rule Library reads them with one
 * grouped count over the window it looks at).
 */
export interface SecurityEventKindsSeen {
  classNames: ReadonlyArray<string>;
  vendorNames: ReadonlyArray<string>;
  productNames: ReadonlyArray<string>;
}

/*
 * How events of one kind are recognized: an event of any of these classes,
 * vendors or products is one. Compared without regard to case or the
 * spaces around a value.
 */
export interface DetectionRuleDataKindDefinition {
  kind: DetectionRuleDataKind;
  classNames: ReadonlyArray<string>;
  vendorNames: ReadonlyArray<string>;
  productNames: ReadonlyArray<string>;
}

// The product a log format stamps on every event it makes.
function logFormatProduct(format: SecurityLogFormat): Array<string> {
  const definition: SecurityLogFormatDefinition | undefined =
    getSecurityLogFormatDefinition(format);

  return definition && definition.productName ? [definition.productName] : [];
}

// The vendor and product a connector stamps on every event it imports.
function connectorStamp(provider: SecurityEventConnectorProvider): {
  vendorNames: Array<string>;
  productNames: Array<string>;
} {
  const definition: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(provider);

  return {
    vendorNames: definition?.vendorName ? [definition.vendorName] : [],
    productNames: definition?.productName ? [definition.productName] : [],
  };
}

const OKTA: { vendorNames: Array<string>; productNames: Array<string> } =
  connectorStamp(SecurityEventConnectorProvider.OktaSystemLog);

export const DETECTION_RULE_DATA_KINDS: ReadonlyArray<DetectionRuleDataKindDefinition> =
  [
    {
      kind: DetectionRuleDataKind.SignIns,
      classNames: ["Authentication"],
      vendorNames: [],
      productNames: [],
    },
    {
      /*
       * An account created anywhere (OCSF Account Change), or by Okta, whose
       * own event types the rules read beside it.
       */
      kind: DetectionRuleDataKind.AccountChanges,
      classNames: ["Account Change"],
      vendorNames: OKTA.vendorNames,
      productNames: OKTA.productNames,
    },
    {
      kind: DetectionRuleDataKind.OktaSystemLog,
      classNames: [],
      vendorNames: OKTA.vendorNames,
      productNames: OKTA.productNames,
    },
    {
      // sudo's commands are process events too (SudoLogParser).
      kind: DetectionRuleDataKind.ProcessEvents,
      classNames: ["Process Activity"],
      vendorNames: [],
      productNames: [],
    },
    {
      kind: DetectionRuleDataKind.SudoLogs,
      classNames: [],
      vendorNames: [],
      productNames: logFormatProduct(SecurityLogFormat.Sudo),
    },
    {
      /*
       * Only CloudTrail as "Your logs" reads it: the rules read CloudTrail's
       * own fields (eventName, userIdentity.type), which a SIEM's copy of a
       * CloudTrail record does not keep.
       */
      kind: DetectionRuleDataKind.AwsCloudTrail,
      classNames: [],
      vendorNames: [],
      productNames: logFormatProduct(SecurityLogFormat.AwsCloudTrail),
    },
    {
      kind: DetectionRuleDataKind.NetworkActivity,
      classNames: ["Network Activity"],
      vendorNames: [],
      productNames: [],
    },
    {
      kind: DetectionRuleDataKind.WebRequests,
      classNames: ["HTTP Activity"],
      vendorNames: [],
      productNames: logFormatProduct(SecurityLogFormat.WebAttack),
    },
    {
      kind: DetectionRuleDataKind.KubernetesAuditLogs,
      classNames: [],
      vendorNames: [],
      productNames: logFormatProduct(SecurityLogFormat.KubernetesAudit),
    },
  ];

export function getDetectionRuleDataKindDefinition(
  kind: DetectionRuleDataKind,
): DetectionRuleDataKindDefinition | undefined {
  return DETECTION_RULE_DATA_KINDS.find(
    (definition: DetectionRuleDataKindDefinition): boolean => {
      return definition.kind === kind;
    },
  );
}

function normalize(value: string): string {
  return (value || "").trim().toLowerCase();
}

function seenAny(
  wanted: ReadonlyArray<string>,
  seen: ReadonlyArray<string>,
): boolean {
  if (wanted.length === 0 || seen.length === 0) {
    return false;
  }

  const seenValues: Set<string> = new Set(seen.map(normalize));

  return wanted.some((value: string): boolean => {
    return seenValues.has(normalize(value));
  });
}

// Whether the events seen include any of this kind.
export function isDetectionRuleDataKindSeen(
  kind: DetectionRuleDataKind,
  seen: SecurityEventKindsSeen,
): boolean {
  const definition: DetectionRuleDataKindDefinition | undefined =
    getDetectionRuleDataKindDefinition(kind);

  if (!definition) {
    return false;
  }

  return (
    seenAny(definition.classNames, seen.classNames) ||
    seenAny(definition.vendorNames, seen.vendorNames) ||
    seenAny(definition.productNames, seen.productNames)
  );
}
