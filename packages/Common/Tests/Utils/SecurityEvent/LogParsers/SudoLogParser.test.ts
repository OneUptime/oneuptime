import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import SudoLogParser, {
  SudoCommand,
  readSudoCommand,
} from "../../../../Utils/SecurityEvent/LogParsers/SudoLogParser";
import { NOT_SUDO_LINES, SUDO_LINES, logLine } from "./LogParserFixtures";

/*
 * sudo's line becomes the event a security team wants from it: a command
 * run as another user is OCSF Process Activity with the command as the
 * principal process (what the rule library's Linux rules read), wrong
 * passwords an Authentication failure, and a person sudo refused an
 * Authorize Session failure.
 */
describe("readSudoCommand", () => {
  test("a command run as root, behind a syslog prefix", () => {
    expect(readSudoCommand(SUDO_LINES.commandRun)).toEqual({
      outcome: "Success",
      user: "alice",
      runAs: "root",
      command: "/usr/bin/cat /etc/shadow",
      reason: "",
    });
  });

  test("wrong passwords", () => {
    const sudo: SudoCommand | null = readSudoCommand(SUDO_LINES.wrongPassword);

    expect(sudo?.outcome).toBe("WrongPassword");
    expect(sudo?.reason).toBe("3 incorrect password attempts");
    expect(sudo?.command).toBe("/bin/bash");
  });

  test("a person not allowed to use sudo", () => {
    const sudo: SudoCommand | null = readSudoCommand(SUDO_LINES.notInSudoers);

    expect(sudo?.outcome).toBe("NotAllowed");
    expect(sudo?.user).toBe("bob");
    expect(sudo?.reason).toBe("user NOT in sudoers");
  });

  test("a line with no TTY, as sudo writes for a script", () => {
    const sudo: SudoCommand | null = readSudoCommand(SUDO_LINES.withoutTty);

    expect(sudo?.outcome).toBe("Success");
    expect(sudo?.user).toBe("carol");
    expect(sudo?.runAs).toBe("postgres");
    expect(sudo?.command).toBe("/usr/bin/psql -l");
  });

  test.each(NOT_SUDO_LINES.map((line: string): [string] => [line]))(
    "not a sudo line: %j",
    (line: string) => {
      expect(readSudoCommand(line)).toBeNull();
    },
  );

  test("a very long command is cut, not dropped", () => {
    const sudo: SudoCommand | null = readSudoCommand(
      `alice : TTY=pts/0 ; PWD=/ ; USER=root ; COMMAND=/bin/echo ${"a".repeat(5000)}`,
    );

    expect(sudo?.command.length).toBeLessThanOrEqual(2000);
    expect(sudo?.command.startsWith("/bin/echo a")).toBe(true);
  });
});

describe("SudoLogParser.parse", () => {
  test("a command run is Process Activity with the command as the principal process", () => {
    const event: NormalizedSecurityEvent = SudoLogParser.parse(
      logLine(SUDO_LINES.commandRun, { "host.name": "web-03" }),
    )[0]!;

    expect(event.classUid).toBe(1007);
    expect(event.className).toBe("Process Activity");
    expect(event.categoryName).toBe("System Activity");
    expect(event.activityName).toBe("Launch");
    expect(event.statusName).toBe("Success");
    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(event.principalUser).toBe("alice");
    expect(event.targetUser).toBe("root");
    expect(event.principalHost).toBe("web-03");
    expect(event.principalProcess).toBe("/usr/bin/cat /etc/shadow");
    expect(event.message).toBe(
      "alice ran /usr/bin/cat /etc/shadow as root on web-03",
    );
    expect(event.vendorName).toBe("Linux");
    expect(event.productName).toBe("sudo");
    expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.Sudo,
    );
  });

  test("wrong passwords are an Authentication failure for the person", () => {
    const event: NormalizedSecurityEvent = SudoLogParser.parse(
      logLine(SUDO_LINES.wrongPassword),
    )[0]!;

    expect(event.className).toBe("Authentication");
    expect(event.statusName).toBe("Failure");
    expect(event.severityName).toBe(OcsfSeverity.Low);
    expect(event.principalUser).toBe("alice");
    expect(event.message).toBe("Wrong sudo password for alice");
  });

  test("a person sudo refused is a Medium Authorize Session failure", () => {
    const event: NormalizedSecurityEvent = SudoLogParser.parse(
      logLine(SUDO_LINES.notInSudoers),
    )[0]!;

    expect(event.className).toBe("Authorize Session");
    expect(event.statusName).toBe("Failure");
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.attributes["sudo.reason"]).toBe("user NOT in sudoers");
  });

  test("lines that are not sudo's are no event", () => {
    for (const line of NOT_SUDO_LINES) {
      expect(SudoLogParser.parse(logLine(line))).toEqual([]);
    }
  });
});
