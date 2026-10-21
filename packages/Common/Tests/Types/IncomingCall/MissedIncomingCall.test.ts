import { describe, expect, test } from "@jest/globals";
import IncomingCallStatus from "../../../Types/IncomingCall/IncomingCallStatus";
import MissedIncomingCall, {
  IncomingCallStatusMessage,
  MISSED_INCOMING_CALL_STATUSES,
  MissedIncomingCallReason,
} from "../../../Types/IncomingCall/MissedIncomingCall";

/*
 * Which incoming calls count as missed, and why. The owner notification and
 * the docs both rest on this one definition, so it is pinned status by status.
 */
describe("MissedIncomingCall.isMissed", () => {
  test.each([
    IncomingCallStatus.NoAnswer,
    IncomingCallStatus.CallerHungUp,
    IncomingCallStatus.Failed,
  ])("%s is a missed call", (status: IncomingCallStatus) => {
    expect(MissedIncomingCall.isMissed(status)).toBe(true);
  });

  test("a call someone answered is not missed", () => {
    expect(MissedIncomingCall.isMissed(IncomingCallStatus.Completed)).toBe(
      false,
    );
    expect(MissedIncomingCall.isMissed(IncomingCallStatus.Connected)).toBe(
      false,
    );
  });

  test.each([
    IncomingCallStatus.Initiated,
    IncomingCallStatus.Ringing,
    IncomingCallStatus.Escalated,
  ])(
    "%s is still in progress, so not missed yet",
    (status: IncomingCallStatus) => {
      expect(MissedIncomingCall.isMissed(status)).toBe(false);
    },
  );

  test("no status is not a missed call", () => {
    expect(MissedIncomingCall.isMissed(undefined)).toBe(false);
    expect(MissedIncomingCall.isMissed(null)).toBe(false);
  });

  test("every status is classified the same way by isMissed and getReason", () => {
    for (const status of Object.values(IncomingCallStatus)) {
      expect({
        status,
        missed: MissedIncomingCall.isMissed(status),
      }).toEqual({
        status,
        missed: MissedIncomingCall.getReason({ status }) !== null,
      });
    }
  });

  test("the missed statuses are exactly No Answer, Caller Hung Up and Failed", () => {
    expect([...MISSED_INCOMING_CALL_STATUSES].sort()).toEqual(
      [
        IncomingCallStatus.CallerHungUp,
        IncomingCallStatus.Failed,
        IncomingCallStatus.NoAnswer,
      ].sort(),
    );
    expect(Object.isFrozen(MISSED_INCOMING_CALL_STATUSES)).toBe(true);
  });
});

describe("MissedIncomingCall.getReason", () => {
  test("nobody answered", () => {
    expect(
      MissedIncomingCall.getReason({ status: IncomingCallStatus.NoAnswer }),
    ).toBe(MissedIncomingCallReason.NoAnswer);
  });

  test("the caller hung up", () => {
    expect(
      MissedIncomingCall.getReason({
        status: IncomingCallStatus.CallerHungUp,
      }),
    ).toBe(MissedIncomingCallReason.CallerHungUp);
  });

  test("a failed call is told apart by the message the webhook stored", () => {
    expect(
      MissedIncomingCall.getReason({
        status: IncomingCallStatus.Failed,
        statusMessage: IncomingCallStatusMessage.PolicyDisabled,
      }),
    ).toBe(MissedIncomingCallReason.PolicyDisabled);

    expect(
      MissedIncomingCall.getReason({
        status: IncomingCallStatus.Failed,
        statusMessage: IncomingCallStatusMessage.NoOneAvailable,
      }),
    ).toBe(MissedIncomingCallReason.NoOneAvailable);
  });

  test("any other failure is a plain failure", () => {
    for (const statusMessage of [
      undefined,
      null,
      "",
      "Twilio configuration not found",
    ]) {
      expect(
        MissedIncomingCall.getReason({
          status: IncomingCallStatus.Failed,
          statusMessage,
        }),
      ).toBe(MissedIncomingCallReason.Failed);
    }
  });

  test("a completed or unfinished call has no reason", () => {
    for (const status of [
      IncomingCallStatus.Completed,
      IncomingCallStatus.Connected,
      IncomingCallStatus.Initiated,
      IncomingCallStatus.Escalated,
      undefined,
    ]) {
      expect(MissedIncomingCall.getReason({ status })).toBeNull();
    }
  });

  test("the stored messages keep the values existing call logs already carry", () => {
    // Call logs written before this change carry these exact strings.
    expect(IncomingCallStatusMessage.PolicyDisabled).toBe("Policy is disabled");
    expect(IncomingCallStatusMessage.NoOneAvailable).toBe(
      "No on-call user available in any escalation rule",
    );
  });
});
