import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SECURITY_LOG_ID_ATTRIBUTE,
  SECURITY_LOG_SOURCE_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import SshLogParser, {
  SSH_AUTHENTICATION_METHODS,
  SshSignIn,
  readSshSignIn,
} from "../../../../Utils/SecurityEvent/LogParsers/SshLogParser";
import {
  LOG_TIME,
  NOT_SSH_SIGN_INS,
  SSH_LINES,
  logLine,
} from "./LogParserFixtures";

/*
 * OpenSSH's sign-in lines become OCSF Authentication events the rule
 * library's brute-force and password-spraying rules read: the account as
 * the principal user, the address it came from as the principal IP, and
 * Failure or Success as the status. The account name is whatever a client
 * sent, so a name holding " from " must not move the address.
 */
describe("readSshSignIn", () => {
  test("a failed password for an unknown user, behind a syslog prefix", () => {
    const signIn: SshSignIn | null = readSshSignIn(
      SSH_LINES.failedPasswordInvalidUser,
    );

    expect(signIn).toEqual({
      outcome: "Failure",
      method: "password",
      user: "admin",
      isInvalidUser: true,
      ip: "203.0.113.7",
      port: 52314,
    });
  });

  test("a failed password for a real account", () => {
    expect(readSshSignIn(SSH_LINES.failedPasswordRoot)).toEqual({
      outcome: "Failure",
      method: "password",
      user: "root",
      isInvalidUser: false,
      ip: "198.51.100.23",
      port: 41200,
    });
  });

  test("a failed key from an IPv6 address keeps the address whole", () => {
    const signIn: SshSignIn | null = readSshSignIn(
      SSH_LINES.failedPublicKeyIpv6,
    );

    expect(signIn?.method).toBe("publickey");
    expect(signIn?.user).toBe("git");
    expect(signIn?.ip).toBe("2001:db8::1");
    expect(signIn?.port).toBe(2222);
  });

  test("an unknown user on a server that takes only keys", () => {
    expect(readSshSignIn(SSH_LINES.invalidUser)).toEqual({
      outcome: "Failure",
      method: "",
      user: "oracle",
      isInvalidUser: true,
      ip: "203.0.113.8",
      port: 60001,
    });
  });

  test.each([
    [SSH_LINES.acceptedPublicKey, "publickey", "ubuntu", "198.51.100.4"],
    [SSH_LINES.acceptedPassword, "password", "alice", "192.0.2.10"],
    [
      SSH_LINES.acceptedKeyboardInteractive,
      "keyboard-interactive/pam",
      "bob",
      "192.0.2.11",
    ],
  ])(
    "an accepted sign-in: %s",
    (line: string, method: string, user: string, ip: string) => {
      const signIn: SshSignIn | null = readSshSignIn(line);

      expect(signIn?.outcome).toBe("Success");
      expect(signIn?.method).toBe(method);
      expect(signIn?.user).toBe(user);
      expect(signIn?.ip).toBe(ip);
    },
  );

  test("the 'none' method a scanner tries first", () => {
    expect(readSshSignIn(SSH_LINES.failedNone)?.user).toBe("test");
  });

  test("an account name that holds ' from ' does not move the address", () => {
    const signIn: SshSignIn | null = readSshSignIn(
      "Failed password for invalid user x from 192.0.2.66 port 1 from 203.0.113.7 port 22 ssh2",
    );

    expect(signIn?.ip).toBe("203.0.113.7");
    expect(signIn?.user).toBe("x from 192.0.2.66 port 1");
  });

  test.each(NOT_SSH_SIGN_INS.map((line: string): [string] => [line]))(
    "not a sign-in: %j",
    (line: string) => {
      expect(readSshSignIn(line)).toBeNull();
    },
  );

  test("a line without a port still names the address", () => {
    expect(readSshSignIn("Invalid user guest from 203.0.113.12")?.ip).toBe(
      "203.0.113.12",
    );
  });

  test("every method sshd names is read, and nothing else", () => {
    for (const method of SSH_AUTHENTICATION_METHODS) {
      expect(
        readSshSignIn(`Failed ${method} for root from 203.0.113.7 port 22 ssh2`)
          ?.method,
      ).toBe(method);
    }

    expect(
      readSshSignIn("Failed Password for root from 203.0.113.7 port 22 ssh2"),
    ).toBeNull();
  });
});

describe("SshLogParser.parse", () => {
  test("a failure is a Low OCSF Authentication failure about the account and the address", () => {
    const events: Array<NormalizedSecurityEvent> = SshLogParser.parse(
      logLine(SSH_LINES.failedPasswordInvalidUser, { "host.name": "web-03" }),
    );

    expect(events).toHaveLength(1);

    const event: NormalizedSecurityEvent = events[0]!;

    expect(event.classUid).toBe(3002);
    expect(event.className).toBe("Authentication");
    expect(event.categoryUid).toBe(3);
    expect(event.categoryName).toBe("Identity & Access Management");
    expect(event.activityName).toBe("Logon");
    expect(event.statusName).toBe("Failure");
    expect(event.severityName).toBe(OcsfSeverity.Low);
    expect(event.severityId).toBe(2);
    expect(event.principalUser).toBe("admin");
    expect(event.principalIp).toBe("203.0.113.7");
    expect(event.targetHost).toBe("web-03");
    expect(event.vendorName).toBe("OpenSSH");
    expect(event.productName).toBe("SSH");
    expect(event.time).toEqual(LOG_TIME);
    expect(event.message).toBe(
      "Failed SSH sign-in for unknown user admin from 203.0.113.7 on web-03",
    );
    expect(event.observables).toEqual(["admin", "web-03", "203.0.113.7"]);
  });

  test("a success is an Informational Authentication success", () => {
    const event: NormalizedSecurityEvent = SshLogParser.parse(
      logLine(SSH_LINES.acceptedPublicKey),
    )[0]!;

    expect(event.statusName).toBe("Success");
    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(event.message).toBe("SSH sign-in for ubuntu from 198.51.100.4");
  });

  test("every event says it came from the logs, which format, and which log record", () => {
    const event: NormalizedSecurityEvent = SshLogParser.parse(
      logLine(
        SSH_LINES.failedPasswordRoot,
        {},
        "0192f1a0-0000-7000-8000-00000000abcd",
      ),
    )[0]!;

    expect(event.attributes[SECURITY_LOG_SOURCE_ATTRIBUTE]).toBe("logs");
    expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.SshSignIn,
    );
    expect(event.attributes[SECURITY_LOG_ID_ATTRIBUTE]).toBe(
      "0192f1a0-0000-7000-8000-00000000abcd",
    );
    expect(event.eventUid).toBe("log:0192f1a0-0000-7000-8000-00000000abcd");
    expect(event.attributes["ssh.method"]).toBe("password");
    expect(event.attributes["ssh.invalid_user"]).toBe("false");
    expect(event.attributes["source.port"]).toBe("41200");
  });

  test("the host comes from whichever attribute the shipper used", () => {
    for (const key of [
      "host.name",
      "hostname",
      "syslog.hostname",
      "_HOSTNAME",
    ]) {
      const event: NormalizedSecurityEvent = SshLogParser.parse(
        logLine(SSH_LINES.failedPasswordRoot, { [key]: "db-01" }),
      )[0]!;

      expect(event.targetHost).toBe("db-01");
    }
  });

  test("a line that is not a sign-in is no event", () => {
    for (const line of NOT_SSH_SIGN_INS) {
      expect(SshLogParser.parse(logLine(line))).toEqual([]);
    }
  });
});
