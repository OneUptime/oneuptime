import { SecurityEventRecord } from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";

/*
 * Stored security events as a destination reads them, for the destination
 * suites: one of each kind OneUptime holds, with made-up names and
 * documentation addresses.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export function securityEventRecord(
  overrides: Partial<SecurityEventRecord> = {},
): SecurityEventRecord {
  return {
    id: "0192f1a0-0000-7000-8000-000000000101",
    time: new Date("2026-10-19T10:00:00.000Z"),
    createdAt: new Date("2026-10-19T10:00:05.000Z"),
    eventUid: "evt-1",
    categoryUid: 0,
    categoryName: "Uncategorized",
    classUid: 0,
    className: "Base Event",
    activityName: "",
    severityId: 1,
    severityName: "Informational",
    statusName: "",
    message: "Something happened",
    vendorName: "Acme",
    productName: "Acme Sensor",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "",
    principalHost: "",
    principalIp: "",
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: "",
    observables: [],
    attributes: {},
    ...overrides,
  };
}

// A failed SSH sign-in, as the log parser stores it.
export const SSH_FAILURE: SecurityEventRecord = securityEventRecord({
  id: "0192f1a0-0000-7000-8000-000000000201",
  eventUid: "log:0192f1a0-0000-7000-8000-00000000aaaa",
  categoryUid: 3,
  categoryName: "Identity & Access Management",
  classUid: 3002,
  className: "Authentication",
  activityName: "Logon",
  severityId: 2,
  severityName: "Low",
  statusName: "Failure",
  message:
    "Failed SSH sign-in for unknown user admin from 203.0.113.7 on web-03",
  vendorName: "OpenSSH",
  productName: "SSH",
  principalUser: "admin",
  principalIp: "203.0.113.7",
  targetHost: "web-03",
  attributes: {
    "oneuptime.source": "logs",
    "oneuptime.log.format": "ssh-sign-in",
    "ssh.method": "password",
  },
});

// A command run with sudo.
export const SUDO_COMMAND: SecurityEventRecord = securityEventRecord({
  id: "0192f1a0-0000-7000-8000-000000000202",
  categoryUid: 1,
  categoryName: "System Activity",
  classUid: 1007,
  className: "Process Activity",
  activityName: "Launch",
  statusName: "Success",
  message: "alice ran /usr/bin/cat /etc/shadow as root on web-03",
  vendorName: "Linux",
  productName: "sudo",
  principalUser: "alice",
  principalHost: "web-03",
  principalProcess: "/usr/bin/cat /etc/shadow",
  targetUser: "root",
});

// A connection a firewall logged.
export const NETWORK_CONNECTION: SecurityEventRecord = securityEventRecord({
  id: "0192f1a0-0000-7000-8000-000000000203",
  categoryUid: 4,
  categoryName: "Network Activity",
  classUid: 4001,
  className: "Network Activity",
  activityName: "Traffic",
  statusName: "Blocked",
  principalIp: "198.51.100.9",
  targetIp: "192.0.2.80",
  targetPort: 3389,
});

// What a detection rule found: a Detection Finding with ATT&CK and a rule.
export const DETECTION_FINDING: SecurityEventRecord = securityEventRecord({
  id: "0192f1a0-0000-7000-8000-000000000204",
  eventUid: "detection-rule:abc",
  categoryUid: 2,
  categoryName: "Findings",
  classUid: 2004,
  className: "Detection Finding",
  activityName: "Create",
  severityId: 4,
  severityName: "High",
  message: "Brute force from one IP address: 12 matches for 203.0.113.7",
  vendorName: "OneUptime",
  productName: "OneUptime Detections",
  ruleId: "0192f1a0-0000-7000-8000-00000000r001",
  ruleName: "Brute force from one IP address",
  mitreTactics: ["TA0006"],
  mitreTechniques: ["T1110.001"],
  principalIp: "203.0.113.7",
  observables: ["203.0.113.7", "admin"],
  attributes: {
    "oneuptime.detection.rule_name": "Brute force from one IP address",
    "oneuptime.detection.match_count": "12",
  },
});
