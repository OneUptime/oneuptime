import { describe, expect, test } from "@jest/globals";
import ScrubAction, {
  SCRUB_REDACTED_TEXT,
} from "../../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import TraceScrubAction from "../../../../Types/Trace/TraceScrubAction";
import TraceScrubPatternType from "../../../../Types/Trace/TraceScrubPatternType";

/*
 * WHAT A SCRUB RULE LEAVES IN PLACE OF A MATCH: ONE ANSWER FOR THE LOG,
 * TRACE AND SESSION REPLAY SCRUBBERS.
 *
 * The three engines each kept a copy of Redact, Mask and Hash; they all ask
 * ScrubAction now, so these tests pin what every engine writes. The Hash
 * token is the project's (#10394), an IP address's in one spelling for
 * every way it is written, and an IP address masks to a shape of its own
 * kind (#10393).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000c10394",
);

function apply(
  match: string,
  action: string,
  patternType: string,
  projectId: ObjectID | string | null | undefined = PROJECT_ID,
): string {
  return ScrubAction.apply({
    match: match,
    action: action,
    patternType: patternType,
    projectId: projectId,
  });
}

describe("Redact", () => {
  test("is [REDACTED] for every pattern type", () => {
    for (const patternType of Object.values(LogScrubPatternType)) {
      expect(apply("anything", LogScrubAction.Redact, patternType)).toBe(
        "[REDACTED]",
      );
    }

    expect(SCRUB_REDACTED_TEXT).toBe("[REDACTED]");
  });

  test("is what an action no one knows does too", () => {
    expect(apply("ada@example.com", "shred", LogScrubPatternType.Email)).toBe(
      "[REDACTED]",
    );
    expect(apply("ada@example.com", "", LogScrubPatternType.Email)).toBe(
      "[REDACTED]",
    );
  });
});

describe("Mask", () => {
  test.each([
    [LogScrubPatternType.Email, "ada@example.com", "a***@***.com"],
    [LogScrubPatternType.Email, "no-at-sign", "***@***.***"],
    [
      LogScrubPatternType.CreditCard,
      "4111 1111 1111 1234",
      "****-****-****-1234",
    ],
    [LogScrubPatternType.SSN, "123-45-6789", "***-**-6789"],
    [LogScrubPatternType.PhoneNumber, "555-123-4567", "***-***-4567"],
    [LogScrubPatternType.IPAddress, "8.8.8.8", "***.***.***.***"],
    [LogScrubPatternType.IPAddress, "::ffff:8.8.8.8", "***.***.***.***"],
    [
      LogScrubPatternType.IPAddress,
      "2001:4860:4860::8888",
      "****:****:****:****:****:****:****:****",
    ],
    [LogScrubPatternType.Custom, "secret-value", "s**********e"],
    [LogScrubPatternType.SensitiveKeys, "hunter2", "h*****2"],
  ])(
    "a %s match %s becomes %s",
    (patternType: string, match: string, masked: string) => {
      expect(apply(match, LogScrubAction.Mask, patternType)).toBe(masked);
    },
  );
});

describe("Hash", () => {
  test("is the project's token, made by the one function every engine hashes through", () => {
    expect(
      apply("ada@example.com", LogScrubAction.Hash, LogScrubPatternType.Email),
    ).toBe(
      ScrubHashToken.ofValue({
        projectId: PROJECT_ID,
        value: "ada@example.com",
      }),
    );
    expect(
      apply("hunter2", LogScrubAction.Hash, LogScrubPatternType.SensitiveKeys),
    ).toBe(ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: "hunter2" }));
  });

  test("of an IP address is the address's token, in one spelling for every way it is written", () => {
    const token: string = apply(
      "::ffff:203.0.113.7",
      LogScrubAction.Hash,
      LogScrubPatternType.IPAddress,
    );

    expect(token).toBe(
      ScrubHashToken.ofIpAddress({
        projectId: PROJECT_ID,
        address: "203.0.113.7",
      }),
    );
    expect(
      apply("203.0.113.7", LogScrubAction.Hash, LogScrubPatternType.IPAddress),
    ).toBe(token);
  });

  test("of the same text by a custom pattern is the text's own token", () => {
    // Only the IP Address pattern reads an address in one spelling.
    expect(
      apply(
        "::ffff:203.0.113.7",
        LogScrubAction.Hash,
        LogScrubPatternType.Custom,
      ),
    ).toBe(
      ScrubHashToken.ofValue({
        projectId: PROJECT_ID,
        value: "::ffff:203.0.113.7",
      }),
    );
  });

  test.each([
    ["no project", undefined],
    ["a null project", null],
    ["an empty project", ""],
    ["a blank project", "   "],
  ])(
    "with %s, cannot make the project's token, and redacts: the value is never stored",
    (_label: string, projectId: string | null | undefined) => {
      expect(
        ScrubAction.apply({
          match: "203.0.113.7",
          action: LogScrubAction.Hash,
          patternType: LogScrubPatternType.IPAddress,
          projectId: projectId,
        }),
      ).toBe("[REDACTED]");
    },
  );

  test("differs between two projects", () => {
    expect(
      apply("123-45-6789", LogScrubAction.Hash, LogScrubPatternType.SSN),
    ).not.toBe(
      apply(
        "123-45-6789",
        LogScrubAction.Hash,
        LogScrubPatternType.SSN,
        new ObjectID("0193b0a1-0000-7000-8000-000000c20394"),
      ),
    );
  });
});

describe("a trace rule's words", () => {
  test("are a log rule's, so one comparison serves both", () => {
    expect({ ...TraceScrubAction }).toEqual({ ...LogScrubAction });
    expect({ ...TraceScrubPatternType }).toEqual({ ...LogScrubPatternType });
  });
});
