import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  MAX_TEXT_LINE_LENGTH,
  SecurityLogLine,
  buildLogSecurityEvent,
  cutText,
  readLogHost,
} from "./SecurityLogLine";

/*
 * sudo's log line, from an auth log, the journal or syslog:
 *
 *   alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/usr/bin/cat /etc/shadow
 *   alice : 3 incorrect password attempts ; TTY=pts/0 ; ... ; COMMAND=/bin/bash
 *   bob : user NOT in sudoers ; TTY=pts/1 ; ... ; USER=root ; COMMAND=/bin/ls
 *
 * A command run becomes an OCSF Process Activity event (the command is the
 * principal process, so the rule library's Linux rules - password hashes
 * read, history cleared, a download piped into a shell - see it); wrong
 * passwords an Authentication failure; a person sudo refused an Authorize
 * Session failure.
 */

export const SUDO_PROCESS_ACTIVITY_CLASS_UID: number = 1007;
export const SUDO_AUTHENTICATION_CLASS_UID: number = 3002;
export const SUDO_AUTHORIZE_SESSION_CLASS_UID: number = 3003;

const COMMAND_MARKER: string = " ; COMMAND=";
const USER_MARKER: string = "USER=";
const FIELD_SEPARATOR: string = " ; ";
const USER_SEPARATOR: string = " : ";

const MAX_COMMAND_LENGTH: number = 2000;
const MAX_USER_LENGTH: number = 64;

export interface SudoCommand {
  outcome: "Success" | "WrongPassword" | "NotAllowed";
  user: string;
  runAs: string;
  command: string;
  // What sudo said before the fields, when it refused: "user NOT in sudoers".
  reason: string;
}

function isUserName(value: string): boolean {
  return (
    value.length > 0 && value.length <= MAX_USER_LENGTH && !value.includes(" ")
  );
}

export function readSudoCommand(body: string): SudoCommand | null {
  const text: string =
    body.length > MAX_TEXT_LINE_LENGTH
      ? body.slice(0, MAX_TEXT_LINE_LENGTH)
      : body;

  const commandIndex: number = text.indexOf(COMMAND_MARKER);

  if (commandIndex === -1) {
    return null;
  }

  // "<user> : " - the user is the word right before the first " : ".
  const separatorIndex: number = text.indexOf(USER_SEPARATOR);

  if (separatorIndex === -1 || separatorIndex > commandIndex) {
    return null;
  }

  const beforeSeparator: string = text.slice(0, separatorIndex).trimEnd();
  const user: string = beforeSeparator.slice(
    beforeSeparator.lastIndexOf(" ") + 1,
  );

  if (!isUserName(user)) {
    return null;
  }

  const fields: string = text.slice(
    separatorIndex + USER_SEPARATOR.length,
    commandIndex,
  );

  // A refusal is said before the fields: "3 incorrect password attempts ; TTY=...".
  const firstSeparator: number = fields.indexOf(FIELD_SEPARATOR);
  const firstField: string =
    firstSeparator === -1 ? fields : fields.slice(0, firstSeparator);
  const reason: string =
    firstField.includes("=") || !firstField.trim() ? "" : firstField.trim();

  const userIndex: number = fields.lastIndexOf(USER_MARKER);
  let runAs: string = "";

  if (userIndex !== -1) {
    const valueStart: number = userIndex + USER_MARKER.length;
    const valueEnd: number = fields.indexOf(FIELD_SEPARATOR, valueStart);
    runAs = (
      valueEnd === -1
        ? fields.slice(valueStart)
        : fields.slice(valueStart, valueEnd)
    ).trim();
  }

  const command: string = cutText(
    text.slice(commandIndex + COMMAND_MARKER.length).trim(),
    MAX_COMMAND_LENGTH,
  );

  if (!command) {
    return null;
  }

  const lowerReason: string = reason.toLowerCase();
  let outcome: SudoCommand["outcome"] = "Success";

  if (lowerReason.includes("incorrect password")) {
    outcome = "WrongPassword";
  } else if (reason) {
    outcome = "NotAllowed";
  }

  return {
    outcome,
    user,
    runAs: isUserName(runAs) ? runAs : "",
    command,
    reason,
  };
}

export default class SudoLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const sudo: SudoCommand | null = readSudoCommand(line.body || "");

    if (!sudo) {
      return [];
    }

    const host: string = readLogHost(line);
    const runAs: string = sudo.runAs || "root";
    const on: string = host ? ` on ${host}` : "";
    const attributes: { [key: string]: string } = {
      "sudo.run_as": runAs,
      "process.command_line": sudo.command,
      ...(sudo.reason ? { "sudo.reason": sudo.reason } : {}),
    };

    if (sudo.outcome === "WrongPassword") {
      return [
        buildLogSecurityEvent({
          line,
          format: SecurityLogFormat.Sudo,
          classUid: SUDO_AUTHENTICATION_CLASS_UID,
          activityName: "Logon",
          statusName: "Failure",
          severity: OcsfSeverity.Low,
          message: `Wrong sudo password for ${sudo.user}${on}`,
          principalUser: sudo.user,
          principalHost: host,
          principalProcess: sudo.command,
          targetUser: runAs,
          attributes,
        }),
      ];
    }

    if (sudo.outcome === "NotAllowed") {
      return [
        buildLogSecurityEvent({
          line,
          format: SecurityLogFormat.Sudo,
          classUid: SUDO_AUTHORIZE_SESSION_CLASS_UID,
          activityName: "Assign Privileges",
          statusName: "Failure",
          severity: OcsfSeverity.Medium,
          message: `sudo refused ${sudo.user}${on}: ${sudo.reason}`,
          principalUser: sudo.user,
          principalHost: host,
          principalProcess: sudo.command,
          targetUser: runAs,
          attributes,
        }),
      ];
    }

    return [
      buildLogSecurityEvent({
        line,
        format: SecurityLogFormat.Sudo,
        classUid: SUDO_PROCESS_ACTIVITY_CLASS_UID,
        activityName: "Launch",
        statusName: "Success",
        severity: OcsfSeverity.Informational,
        message: `${sudo.user} ran ${sudo.command} as ${runAs}${on}`,
        principalUser: sudo.user,
        principalHost: host,
        principalProcess: sudo.command,
        targetUser: runAs,
        attributes,
      }),
    ];
  }
}
