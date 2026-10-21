import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  MAX_TEXT_LINE_LENGTH,
  SecurityLogLine,
  buildLogSecurityEvent,
  readIpAddress,
  readLogHost,
  readPort,
  readWord,
} from "./SecurityLogLine";

/*
 * OpenSSH's sign-in lines, wherever they were collected (an auth log, the
 * journal, syslog):
 *
 *   Failed password for root from 203.0.113.7 port 52314 ssh2
 *   Failed password for invalid user admin from 203.0.113.7 port 52314 ssh2
 *   Failed publickey for git from 203.0.113.7 port 52314 ssh2: RSA SHA256:...
 *   Invalid user admin from 203.0.113.7 port 52314
 *   Accepted publickey for ubuntu from 198.51.100.4 port 51234 ssh2: ED25519 ...
 *
 * Each becomes an OCSF Authentication event: a failure for "Failed" and
 * "Invalid user" (a server that only takes keys says nothing more about an
 * unknown user), a success for "Accepted". The account is the principal
 * user and the address it came from the principal IP, which is what the
 * rule library's brute-force and password-spraying rules group on.
 *
 * The account name is whatever the client sent, so it can hold spaces and
 * even " from ". The address is therefore read after the LAST " from ",
 * which sshd writes after the name.
 */

export const SSH_AUTHENTICATION_CLASS_UID: number = 3002;

const FAILED_MARKER: string = "Failed ";
const ACCEPTED_MARKER: string = "Accepted ";
const INVALID_USER_MARKER: string = "Invalid user ";
const FOR: string = " for ";
const FROM: string = " from ";
const PORT: string = " port ";
const INVALID_USER_PREFIX: string = "invalid user ";

// The longest authentication method name sshd writes (keyboard-interactive/pam).
const MAX_METHOD_LENGTH: number = 40;
const MAX_USER_LENGTH: number = 255;

export interface SshSignIn {
  outcome: "Failure" | "Success";
  // password, publickey, keyboard-interactive/pam ... ("" for Invalid user).
  method: string;
  user: string;
  isInvalidUser: boolean;
  ip: string;
  port: number;
}

/*
 * The authentication methods sshd names in its log, as prefixes: a method
 * can carry a submethod ("keyboard-interactive/pam"). Matched exactly, so
 * the log scan's candidate words (SECURITY_LOG_PREFILTER) are sure to hold
 * every line this parser reads.
 */
export const SSH_AUTHENTICATION_METHODS: ReadonlyArray<string> = [
  "password",
  "publickey",
  "keyboard-interactive",
  "none",
  "hostbased",
  "gssapi",
];

function isMethodName(method: string): boolean {
  if (!method || method.length > MAX_METHOD_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < method.length; index++) {
    const code: number = method.charCodeAt(index);
    const isLowerLetter: boolean = code >= 97 && code <= 122;
    const isDigit: boolean = code >= 48 && code <= 57;
    const isPunctuation: boolean = code === 45 || code === 47; // - /

    if (!isLowerLetter && !isDigit && !isPunctuation) {
      return false;
    }
  }

  return SSH_AUTHENTICATION_METHODS.some((known: string): boolean => {
    return method.startsWith(known);
  });
}

// The address and port after the last " from " that follows `from`.
function readSource(
  text: string,
  from: number,
): { fromIndex: number; ip: string; port: number } | null {
  const fromIndex: number = text.lastIndexOf(FROM);

  if (fromIndex < from) {
    return null;
  }

  const ipStart: number = fromIndex + FROM.length;
  const ip: string = readIpAddress(readWord(text, ipStart));

  if (!ip) {
    return null;
  }

  const portIndex: number = text.indexOf(PORT, ipStart);
  const port: number =
    portIndex === -1 ? 0 : readPort(readWord(text, portIndex + PORT.length));

  return { fromIndex, ip, port };
}

// "Failed <method> for [invalid user ]<user> from <ip> port <port>" and Accepted.
function readAttempt(
  text: string,
  marker: string,
  outcome: "Failure" | "Success",
): SshSignIn | null {
  const markerIndex: number = text.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const methodStart: number = markerIndex + marker.length;
  const forIndex: number = text.indexOf(FOR, methodStart);

  if (forIndex === -1 || forIndex - methodStart > MAX_METHOD_LENGTH) {
    return null;
  }

  const method: string = text.slice(methodStart, forIndex);

  if (!isMethodName(method)) {
    return null;
  }

  let userStart: number = forIndex + FOR.length;
  let isInvalidUser: boolean = false;

  if (text.startsWith(INVALID_USER_PREFIX, userStart)) {
    isInvalidUser = true;
    userStart += INVALID_USER_PREFIX.length;
  }

  const source: { fromIndex: number; ip: string; port: number } | null =
    readSource(text, userStart);

  if (!source) {
    return null;
  }

  const user: string = text.slice(userStart, source.fromIndex).trim();

  if (!user || user.length > MAX_USER_LENGTH) {
    return null;
  }

  return {
    outcome,
    method,
    user,
    isInvalidUser,
    ip: source.ip,
    port: source.port,
  };
}

// "Invalid user <user> from <ip> port <port>".
function readInvalidUser(text: string): SshSignIn | null {
  const markerIndex: number = text.indexOf(INVALID_USER_MARKER);

  if (markerIndex === -1) {
    return null;
  }

  const userStart: number = markerIndex + INVALID_USER_MARKER.length;
  const source: { fromIndex: number; ip: string; port: number } | null =
    readSource(text, userStart);

  if (!source) {
    return null;
  }

  const user: string = text.slice(userStart, source.fromIndex).trim();

  if (!user || user.length > MAX_USER_LENGTH) {
    return null;
  }

  return {
    outcome: "Failure",
    method: "",
    user,
    isInvalidUser: true,
    ip: source.ip,
    port: source.port,
  };
}

export function readSshSignIn(body: string): SshSignIn | null {
  const text: string =
    body.length > MAX_TEXT_LINE_LENGTH
      ? body.slice(0, MAX_TEXT_LINE_LENGTH)
      : body;

  return (
    readAttempt(text, FAILED_MARKER, "Failure") ||
    readAttempt(text, ACCEPTED_MARKER, "Success") ||
    readInvalidUser(text)
  );
}

export default class SshLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const signIn: SshSignIn | null = readSshSignIn(line.body || "");

    if (!signIn) {
      return [];
    }

    const host: string = readLogHost(line);
    const isFailure: boolean = signIn.outcome === "Failure";

    const message: string = isFailure
      ? `Failed SSH sign-in${signIn.isInvalidUser ? " for unknown user" : " for"} ${signIn.user} from ${signIn.ip}${host ? ` on ${host}` : ""}`
      : `SSH sign-in for ${signIn.user} from ${signIn.ip}${host ? ` on ${host}` : ""}`;

    return [
      buildLogSecurityEvent({
        line,
        format: SecurityLogFormat.SshSignIn,
        classUid: SSH_AUTHENTICATION_CLASS_UID,
        activityName: "Logon",
        statusName: signIn.outcome,
        severity: isFailure ? OcsfSeverity.Low : OcsfSeverity.Informational,
        message,
        principalUser: signIn.user,
        principalIp: signIn.ip,
        targetHost: host,
        attributes: {
          "ssh.method": signIn.method,
          "ssh.invalid_user": signIn.isInvalidUser ? "true" : "false",
          ...(signIn.port ? { "source.port": String(signIn.port) } : {}),
        },
      }),
    ];
  }
}
