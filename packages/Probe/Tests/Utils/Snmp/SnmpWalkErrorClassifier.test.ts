import { describe, expect, test } from "@jest/globals";
import snmp from "net-snmp";
import {
  SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH,
  SnmpWalkAuthenticationReason,
  SnmpWalkFailure,
  SnmpWalkFailureKind,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import SnmpWalkErrorClassifier from "../../../Utils/Snmp/SnmpWalkErrorClassifier";
import { SnmpWalkOutOfOrderError } from "../../../Utils/Snmp/SnmpOidWalker";

/*
 * Every way a walk can fail, as net-snmp raises it, sorted into what the
 * dashboard explains: the errors are built with net-snmp's own classes and
 * the exact texts it puts in them (its usmStats names, RFC 3414), so a
 * net-snmp upgrade that rewords one fails here rather than turning an
 * authentication failure into "something went wrong" on the page.
 */

const HOST: string = "10.0.0.1";

type ErrorConstructor = new (message: string) => Error;

const RequestTimedOutError: ErrorConstructor = (
  snmp as unknown as { RequestTimedOutError: ErrorConstructor }
).RequestTimedOutError;

function usmReport(message: string): Error {
  return new snmp.ResponseInvalidError(
    message,
    snmp.ResponseInvalidCode.EAuthFailure,
  );
}

function systemError(code: string, message: string): Error {
  const error: Error & { code?: string } = new Error(message);
  error.code = code;
  return error;
}

function classify(error: unknown): SnmpWalkFailure {
  return SnmpWalkErrorClassifier.classify(error, HOST);
}

describe("no answer", () => {
  test("net-snmp's timeout is a timeout", () => {
    expect(classify(new RequestTimedOutError("Request timed out"))).toEqual({
      kind: SnmpWalkFailureKind.Timeout,
      message: "Request timed out",
    });
  });

  test("any other error that says it timed out is a timeout", () => {
    expect(classify(new Error("The operation timed out")).kind).toBe(
      SnmpWalkFailureKind.Timeout,
    );
  });
});

describe("an SNMPv3 agent's usmStats report (RFC 3414)", () => {
  test.each([
    ["Unknown User Name", SnmpWalkAuthenticationReason.UnknownUser],
    [
      "Wrong Digest (incorrect password, community or key)",
      SnmpWalkAuthenticationReason.WrongDigest,
    ],
    [
      "Unsupported Security Level",
      SnmpWalkAuthenticationReason.UnsupportedSecurityLevel,
    ],
    ["Decryption Error", SnmpWalkAuthenticationReason.Decryption],
    ["Not In Time Window", SnmpWalkAuthenticationReason.NotInTimeWindow],
    ["Unknown Engine ID", SnmpWalkAuthenticationReason.UnknownEngineId],
  ])(
    '"%s" is an authentication failure that names its reason',
    (message: string, reason: SnmpWalkAuthenticationReason) => {
      expect(classify(usmReport(message))).toEqual({
        kind: SnmpWalkFailureKind.Authentication,
        authenticationReason: reason,
        message: message,
      });
    },
  );

  test("a reply whose digest does not match ours is a wrong authentication password", () => {
    expect(
      classify(
        usmReport(
          "Authentication digest 0a0b received in message does not match digest 0c0d calculated for message",
        ),
      ).authenticationReason,
    ).toBe(SnmpWalkAuthenticationReason.WrongDigest);
  });

  test("a reply that cannot be decrypted is a wrong privacy password", () => {
    expect(
      classify(
        new snmp.ResponseInvalidError(
          "Failed to decrypt PDU: Error: bad decrypt",
          snmp.ResponseInvalidCode.ECouldNotDecrypt,
        ),
      ),
    ).toEqual({
      kind: SnmpWalkFailureKind.Authentication,
      authenticationReason: SnmpWalkAuthenticationReason.Decryption,
      message: "Failed to decrypt PDU: Error: bad decrypt",
    });
  });

  test("an authentication failure net-snmp words some other way still is one, without a reason", () => {
    expect(classify(usmReport("Unexpected Report PDU"))).toEqual({
      kind: SnmpWalkFailureKind.Authentication,
      message: "Unexpected Report PDU",
    });
  });
});

describe("the agent answering with an error", () => {
  test.each([
    ["authorizationError", snmp.ErrorStatus.AuthorizationError],
    ["noAccess", snmp.ErrorStatus.NoAccess],
  ])(
    "%s is the agent's access control refusing: an authentication failure, access denied",
    (_label: string, status: number) => {
      expect(classify(new snmp.RequestFailedError("Refused", status))).toEqual({
        kind: SnmpWalkFailureKind.Authentication,
        authenticationReason: SnmpWalkAuthenticationReason.AccessDenied,
        message: "Refused",
      });
    },
  );

  test("net-snmp's own check of a reply's user is an unknown user", () => {
    expect(
      classify(
        new snmp.RequestFailedError(
          "Local user not found for message with user monitoring",
          snmp.ErrorStatus.GeneralError,
        ),
      ).authenticationReason,
    ).toBe(SnmpWalkAuthenticationReason.UnknownUser);
  });

  test.each([
    ["genErr", snmp.ErrorStatus.GeneralError],
    ["tooBig", snmp.ErrorStatus.TooBig],
    ["noSuchName", snmp.ErrorStatus.NoSuchName],
  ])("%s is an agent error", (_label: string, status: number) => {
    expect(
      classify(new snmp.RequestFailedError("GeneralError", status)).kind,
    ).toBe(SnmpWalkFailureKind.AgentError);
  });

  test("an answer net-snmp finds malformed is an agent error", () => {
    expect(
      classify(
        new snmp.ResponseInvalidError(
          "OID '1.3.6.1.2' in request at position '0' does not precede OID '1.3.6.1.1' in response at position '0'",
          snmp.ResponseInvalidCode.EOutOfOrder,
        ),
      ).kind,
    ).toBe(SnmpWalkFailureKind.AgentError);
  });

  test("OIDs that go backwards are an agent error", () => {
    expect(
      classify(new SnmpWalkOutOfOrderError("1.3.6.1.2", "1.3.6.1.1")),
    ).toEqual({
      kind: SnmpWalkFailureKind.AgentError,
      message:
        "The device returned 1.3.6.1.1 after 1.3.6.1.2: OIDs must only move forward, so the walk stopped here rather than loop.",
    });
  });
});

describe("the probe not reaching the device", () => {
  test.each([
    ["ENOTFOUND", "getaddrinfo ENOTFOUND switch.invalid"],
    ["EAI_AGAIN", "getaddrinfo EAI_AGAIN switch.example.com"],
    ["EHOSTUNREACH", "send EHOSTUNREACH 10.0.0.1:161"],
    ["ECONNREFUSED", "send ECONNREFUSED 10.0.0.1:161"],
  ])("%s is unreachable", (code: string, message: string) => {
    expect(classify(systemError(code, message))).toEqual({
      kind: SnmpWalkFailureKind.Unreachable,
      message: message,
    });
  });

  test("a probe with no address to send from says it is the probe, not the device", () => {
    const failure: SnmpWalkFailure = classify(
      systemError(
        "EADDRNOTAVAIL",
        "send EADDRNOTAVAIL fd00::1:161 - Cannot assign requested address",
      ),
    );

    expect(failure.kind).toBe(SnmpWalkFailureKind.Unreachable);
    expect(failure.message.startsWith("This probe ")).toBe(true);
  });
});

describe("everything else", () => {
  test("the device's saved credentials that cannot open a session are a configuration failure", () => {
    expect(
      SnmpWalkErrorClassifier.configuration(
        new Error(
          "SNMP v3 is selected for 10.0.0.1 but no v3 credentials (username) are configured.",
        ),
      ),
    ).toEqual({
      kind: SnmpWalkFailureKind.Configuration,
      message:
        "SNMP v3 is selected for 10.0.0.1 but no v3 credentials (username) are configured.",
    });
  });

  test("an error nothing recognises is unknown, with its message", () => {
    expect(classify(new Error("Something odd"))).toEqual({
      kind: SnmpWalkFailureKind.Unknown,
      message: "Something odd",
    });
  });

  test("a thrown string is unknown, with the string", () => {
    expect(classify("socket closed")).toEqual({
      kind: SnmpWalkFailureKind.Unknown,
      message: "socket closed",
    });
  });

  test("a message is never longer than the result keeps", () => {
    expect(
      classify(new Error("x".repeat(5000))).message.length,
    ).toBeLessThanOrEqual(SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH);
  });
});
