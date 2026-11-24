import { describe, expect, test } from "@jest/globals";
import ScrubAction, {
  ScrubHashedAddressRecorder,
} from "../../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import TraceScrubAction from "../../../../Types/Trace/TraceScrubAction";
import TraceScrubPatternType from "../../../../Types/Trace/TraceScrubPatternType";

/*
 * WHAT A SCRUB RULE TELLS SECURITY EVENTS' ADDRESS VAULT (#10395).
 *
 * ScrubAction.applyAndRecord is what both engines call for a pattern rule's
 * match: what the rule leaves, as apply() says - and, for an IP Address
 * rule that hashes, the token and the address told to the batch's
 * recorder. Pinned: only that rule's matches are told, in the spelling the
 * token is made of; the record keeps the same token with or without a
 * recorder; and a recorder that throws costs the record nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10395000-0000-4000-8000-0000000000a1",
);

interface Told {
  token: string;
  address: string;
}

class ListRecorder implements ScrubHashedAddressRecorder {
  public told: Array<Told> = [];

  public recordHashedAddress(data: Told): void {
    this.told.push(data);
  }
}

function applyAndRecord(data: {
  match: string;
  action: string;
  patternType: string;
  projectId?: ObjectID | string | null | undefined;
  recorder?: ScrubHashedAddressRecorder | null | undefined;
}): string {
  return ScrubAction.applyAndRecord({
    match: data.match,
    action: data.action,
    patternType: data.patternType,
    projectId: data.projectId === undefined ? PROJECT_ID : data.projectId,
    recorder: data.recorder,
  });
}

describe("an IP Address rule that hashes", () => {
  test("tells the recorder the token it leaves and the address behind it", () => {
    const recorder: ListRecorder = new ListRecorder();

    const left: string = applyAndRecord({
      match: "203.0.113.7",
      action: LogScrubAction.Hash,
      patternType: LogScrubPatternType.IPAddress,
      recorder,
    });

    expect(left).toBe(
      ScrubHashToken.ofIpAddress({
        projectId: PROJECT_ID,
        address: "203.0.113.7",
      }),
    );
    expect(recorder.told).toEqual([{ token: left, address: "203.0.113.7" }]);
  });

  test.each([
    ["an IPv4 address written as IPv6", "::ffff:203.0.113.7", "203.0.113.7"],
    ["IPv6 in capitals", "2001:DB8::7", "2001:db8::7"],
    [
      "IPv6 written out",
      "2001:0db8:0000:0000:0000:0000:0000:0007",
      "2001:db8::7",
    ],
    ["IPv6 already compressed", "2001:db8::7", "2001:db8::7"],
  ])(
    "%s is told in the one spelling its token is made of",
    (_label: string, match: string, address: string) => {
      const recorder: ListRecorder = new ListRecorder();

      const left: string = applyAndRecord({
        match,
        action: LogScrubAction.Hash,
        patternType: LogScrubPatternType.IPAddress,
        recorder,
      });

      expect(recorder.told).toEqual([{ token: left, address }]);
      // The token of the spelling told is the token the record keeps.
      expect(
        ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address }),
      ).toBe(left);
    },
  );

  test("a trace rule's words are the log rule's", () => {
    const recorder: ListRecorder = new ListRecorder();

    applyAndRecord({
      match: "198.51.100.9",
      action: TraceScrubAction.Hash,
      patternType: TraceScrubPatternType.IPAddress,
      recorder,
    });

    expect(
      recorder.told.map((told: Told): string => {
        return told.address;
      }),
    ).toEqual(["198.51.100.9"]);
  });

  test("leaves the same token with a recorder or without one", () => {
    expect(
      applyAndRecord({
        match: "203.0.113.7",
        action: LogScrubAction.Hash,
        patternType: LogScrubPatternType.IPAddress,
        recorder: new ListRecorder(),
      }),
    ).toBe(
      ScrubAction.apply({
        match: "203.0.113.7",
        action: LogScrubAction.Hash,
        patternType: LogScrubPatternType.IPAddress,
        projectId: PROJECT_ID,
      }),
    );
  });

  test("a recorder that throws costs the record nothing: it keeps its token", () => {
    const left: string = applyAndRecord({
      match: "203.0.113.7",
      action: LogScrubAction.Hash,
      patternType: LogScrubPatternType.IPAddress,
      recorder: {
        recordHashedAddress: (): void => {
          throw new Error("the vault is full");
        },
      },
    });

    expect(left).toBe(
      ScrubHashToken.ofIpAddress({
        projectId: PROJECT_ID,
        address: "203.0.113.7",
      }),
    );
  });

  test("a rule whose project is not known redacts, and tells nothing", () => {
    const recorder: ListRecorder = new ListRecorder();

    expect(
      applyAndRecord({
        match: "203.0.113.7",
        action: LogScrubAction.Hash,
        patternType: LogScrubPatternType.IPAddress,
        projectId: null,
        recorder,
      }),
    ).toBe("[REDACTED]");
    expect(recorder.told).toEqual([]);
  });
});

describe("nothing else is told", () => {
  test.each([
    ["Redact", LogScrubAction.Redact],
    ["Mask", LogScrubAction.Mask],
    ["an action no one knows", "shred"],
    ["no action", ""],
  ])(
    "an IP Address rule that does %s leaves nothing to look up",
    (_label: string, action: string) => {
      const recorder: ListRecorder = new ListRecorder();

      applyAndRecord({
        match: "203.0.113.7",
        action,
        patternType: LogScrubPatternType.IPAddress,
        recorder,
      });

      expect(recorder.told).toEqual([]);
    },
  );

  test.each([
    ["Email", LogScrubPatternType.Email, "ada@example.com"],
    ["Credit Card", LogScrubPatternType.CreditCard, "4111 1111 1111 1111"],
    ["SSN", LogScrubPatternType.SSN, "078-05-1120"],
    ["Phone Number", LogScrubPatternType.PhoneNumber, "202-555-0143"],
    ["Sensitive Attribute Keys", LogScrubPatternType.SensitiveKeys, "hunter2"],
    // A custom pattern that finds addresses is still no IP Address rule.
    ["Custom Regex", LogScrubPatternType.Custom, "203.0.113.7"],
  ])(
    "a %s rule that hashes: a hash of any other value is never resolvable",
    (_label: string, patternType: string, match: string) => {
      const recorder: ListRecorder = new ListRecorder();

      const left: string = applyAndRecord({
        match,
        action: LogScrubAction.Hash,
        patternType,
        recorder,
      });

      expect(left).toMatch(/^\[HASHED:[0-9a-f]{16}\]$/);
      expect(recorder.told).toEqual([]);
    },
  );

  test("no recorder, nothing told and nothing thrown", () => {
    expect(
      applyAndRecord({
        match: "203.0.113.7",
        action: LogScrubAction.Hash,
        patternType: LogScrubPatternType.IPAddress,
        recorder: null,
      }),
    ).toMatch(/^\[HASHED:[0-9a-f]{16}\]$/);
  });
});
