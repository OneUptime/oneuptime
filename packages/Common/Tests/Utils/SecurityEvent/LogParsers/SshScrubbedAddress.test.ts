import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import { doesDetectionRuleLeaveOutEventsWithNoValue } from "../../../../Types/SecurityEvent/DetectionUncountedEvents";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SshLogParser, {
  SshSignIn,
  readSshSignIn,
} from "../../../../Utils/SecurityEvent/LogParsers/SshLogParser";
import {
  HiddenClientAddress,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  readHiddenClientAddress,
} from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import {
  IPV4_ADDRESS_MASK,
  IPV6_ADDRESS_MASK,
} from "../../../../Utils/Telemetry/ScrubIpAddress";
import { logLine } from "./LogParserFixtures";

/*
 * AN SSH SIGN-IN WHOSE ADDRESS A SCRUB RULE HID (#10485).
 *
 * An IP Address log scrub rule leaves "Failed password for root from
 * [REDACTED] port 52314 ssh2" in place of the line sshd wrote. The parser
 * dropped the whole line - its address was no IP address - so every SSH
 * sign-in of a project that scrubs addresses disappeared from Security
 * Events, and with it "Repeated failed sign-ins for one account", which
 * needs only the user. Now the sign-in is an event: no principal IP, the
 * #10397 marker saying a scrub rule hid it, and the line's words in its
 * message. The rules that count per address leave it out (#10415), so a
 * dozen of them never fire "Brute force from one IP address"; the App
 * suite DetectionRuleArrivalsClickhouse shows that against ClickHouse.
 */

// The tokens a Hash rule leaves: the keyed one (#10394) and the older eight-hex one.
const KEYED_TOKEN: string = ScrubHashToken.ofIpAddress({
  projectId: "0192f1a0-0000-7000-8000-00000000a0a1",
  address: "203.0.113.7",
});
const LEGACY_TOKEN: string = `[HASHED:${crypto.createHash("sha256").update("203.0.113.7").digest("hex").substring(0, 8)}]`;

const SCRUBBED: ReadonlyArray<[string, ScrubbedAddressKind]> = [
  ["[REDACTED]", ScrubbedAddressKind.Redacted],
  [IPV4_ADDRESS_MASK, ScrubbedAddressKind.Masked],
  [IPV6_ADDRESS_MASK, ScrubbedAddressKind.Masked],
  [KEYED_TOKEN, ScrubbedAddressKind.Hashed],
  [LEGACY_TOKEN, ScrubbedAddressKind.Hashed],
];

function onlyEvent(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = SshLogParser.parse(
    logLine(body),
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

function hiddenOf(event: NormalizedSecurityEvent): {
  principalIp: string;
  hidden: Pick<HiddenClientAddress, "kind" | "value" | "place"> | null;
} {
  const hidden: HiddenClientAddress | null = readHiddenClientAddress(event);

  return {
    principalIp: event.principalIp,
    hidden: hidden
      ? { kind: hidden.kind, value: hidden.value, place: hidden.place }
      : null,
  };
}

describe("an SSH sign-in whose address a scrub rule hid", () => {
  test("a failed password is an Authentication event with no address, that says a scrub rule hid it", () => {
    for (const [scrubbed, kind] of SCRUBBED) {
      const event: NormalizedSecurityEvent = onlyEvent(
        `Nov 20 10:00:00 bastion sshd[4242]: Failed password for root from ${scrubbed} port 52314 ssh2`,
      );

      expect({ scrubbed, ...hiddenOf(event) }).toEqual({
        scrubbed,
        principalIp: "",
        hidden: { kind, value: scrubbed, place: ScrubbedAddressPlace.LogBody },
      });
      expect(event.className).toBe("Authentication");
      expect(event.statusName).toBe("Failure");
      expect(event.severityName).toBe(OcsfSeverity.Low);
      expect(event.principalUser).toBe("root");
      expect(event.observables).toEqual(["root"]);
      expect(event.attributes["source.port"]).toBe("52314");
      expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
        SecurityLogFormat.SshSignIn,
      );
      // The message says what the line says.
      expect(event.message).toBe(
        `Failed SSH sign-in for root from ${scrubbed}`,
      );
    }
  });

  test("an unknown user, a key, and a sign-in that worked say so too", () => {
    const invalidUser: NormalizedSecurityEvent = onlyEvent(
      "Invalid user admin from [REDACTED] port 40022",
    );
    expect(hiddenOf(invalidUser)).toEqual({
      principalIp: "",
      hidden: {
        kind: ScrubbedAddressKind.Redacted,
        value: "[REDACTED]",
        place: ScrubbedAddressPlace.LogBody,
      },
    });
    expect(invalidUser.principalUser).toBe("admin");
    expect(invalidUser.message).toBe(
      "Failed SSH sign-in for unknown user admin from [REDACTED]",
    );

    const invalidPassword: NormalizedSecurityEvent = onlyEvent(
      `Failed password for invalid user oracle from ${KEYED_TOKEN} port 60001 ssh2`,
    );
    expect(invalidPassword.principalUser).toBe("oracle");
    expect(invalidPassword.attributes["ssh.invalid_user"]).toBe("true");
    expect(readHiddenClientAddress(invalidPassword)?.kind).toBe(
      ScrubbedAddressKind.Hashed,
    );

    const key: NormalizedSecurityEvent = onlyEvent(
      `Failed publickey for git from ${IPV6_ADDRESS_MASK} port 22 ssh2: RSA SHA256:abc`,
    );
    expect(key.attributes["ssh.method"]).toBe("publickey");
    expect(readHiddenClientAddress(key)?.kind).toBe(ScrubbedAddressKind.Masked);

    const accepted: NormalizedSecurityEvent = onlyEvent(
      "Accepted publickey for ubuntu from [REDACTED] port 51234 ssh2: ED25519 SHA256:xyz",
    );
    expect(accepted.statusName).toBe("Success");
    expect(accepted.severityName).toBe(OcsfSeverity.Informational);
    expect(accepted.message).toBe("SSH sign-in for ubuntu from [REDACTED]");
    expect(readHiddenClientAddress(accepted)?.value).toBe("[REDACTED]");
  });

  test("is read as a sign-in, its user and port as before", () => {
    const signIn: SshSignIn | null = readSshSignIn(
      "Failed password for root from [REDACTED] port 52314 ssh2",
    );

    expect(signIn).toEqual({
      outcome: "Failure",
      method: "password",
      user: "root",
      isInvalidUser: false,
      ip: "",
      scrubbed: { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      source: "[REDACTED]",
      port: 52314,
    });
  });

  test("is one event of the log scan, through the parser it reads every line with", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine("Failed password for root from [REDACTED] port 52314 ssh2"),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.principalUser).toBe("root");
    expect(readHiddenClientAddress(events[0]!)).not.toBeNull();
  });

  test("an address is still named, and nothing is said hidden", () => {
    const event: NormalizedSecurityEvent = onlyEvent(
      "Failed password for root from 203.0.113.7 port 52314 ssh2",
    );

    expect(hiddenOf(event)).toEqual({
      principalIp: "203.0.113.7",
      hidden: null,
    });
    expect(event.message).toBe("Failed SSH sign-in for root from 203.0.113.7");
  });

  test("a word that is neither an address nor what a scrub rule leaves is no sign-in line of sshd's", () => {
    for (const line of [
      "Failed password for root from host.example port 52314 ssh2",
      "Failed password for root from [Redacted] port 52314 ssh2",
      "Failed password for root from unknown port 52314 ssh2",
      "Failed password for root from  port 52314 ssh2",
    ]) {
      expect({ line, events: SshLogParser.parse(logLine(line)) }).toEqual({
        line,
        events: [],
      });
    }
  });

  test("a user name holding a hidden-looking from is still read up to the last from", () => {
    const signIn: SshSignIn | null = readSshSignIn(
      "Failed password for invalid user a from [REDACTED] b from [REDACTED] port 22 ssh2",
    );

    expect(signIn?.user).toBe("a from [REDACTED] b");
    expect(signIn?.scrubbed?.value).toBe("[REDACTED]");
  });
});

describe("what the sign-in rules make of them", () => {
  function libraryRule(title: string): DetectionRuleLibraryEntry {
    const entry: DetectionRuleLibraryEntry | undefined =
      DETECTION_RULE_LIBRARY.find((candidate: DetectionRuleLibraryEntry) => {
        return candidate.title === title;
      });

    if (!entry) {
      throw new Error(`No library rule ${title}`);
    }

    return entry;
  }

  test("the rules that count per address leave them out, and the one per account counts them by their user", () => {
    const event: NormalizedSecurityEvent = onlyEvent(
      "Failed password for root from [REDACTED] port 52314 ssh2",
    );

    // Brute force and spraying group by the address the event does not name.
    for (const title of [
      "Brute force from one IP address",
      "Password spraying",
    ]) {
      const rule: DetectionRuleLibraryEntry = libraryRule(title);

      expect(rule.groupByField).toBe("principalIp");
      expect(doesDetectionRuleLeaveOutEventsWithNoValue(rule)).toBe(true);
      expect(event.principalIp).toBe("");
    }

    // Repeated failed sign-ins groups by the user the event does name.
    const repeated: DetectionRuleLibraryEntry = libraryRule(
      "Repeated failed sign-ins for one account",
    );
    expect(repeated.groupByField).toBe("principalUser");
    expect(event.principalUser).toBe("root");
  });
});
