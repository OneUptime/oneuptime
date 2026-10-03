import { describe, expect, test } from "@jest/globals";
import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import {
  DEFAULT_INCOMING_CALL_RING_SECONDS,
  getIncomingCallRingSeconds,
  MAX_INCOMING_CALL_RING_SECONDS,
  MIN_INCOMING_CALL_RING_SECONDS,
} from "../../../Types/IncomingCall/IncomingCallRingTime";

/*
 * How long an incoming call rings the person an escalation rule calls - the
 * rule's escalateAfterSeconds, the timeout of Twilio's <Dial>. The form asks
 * for it as "Ring for (in seconds)", and the webhook hands it to Twilio
 * through getIncomingCallRingSeconds, so a rule written through the API with
 * a time Twilio refuses still rings.
 */

describe("the ring time an incoming call rule starts with", () => {
  test("is 30 seconds, Twilio's own default", () => {
    expect(DEFAULT_INCOMING_CALL_RING_SECONDS).toBe(30);
  });

  test("is what a rule saved without one stores", () => {
    const column: { defaultValue?: unknown; required?: boolean } =
      new IncomingCallPolicyEscalationRule().getTableColumnMetadata(
        "escalateAfterSeconds",
      ) as { defaultValue?: unknown; required?: boolean };

    expect(column.defaultValue).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
  });

  test("sits inside what Twilio takes: 5 seconds to 10 minutes", () => {
    expect(MIN_INCOMING_CALL_RING_SECONDS).toBe(5);
    expect(MAX_INCOMING_CALL_RING_SECONDS).toBe(600);
    expect(DEFAULT_INCOMING_CALL_RING_SECONDS).toBeGreaterThanOrEqual(
      MIN_INCOMING_CALL_RING_SECONDS,
    );
    expect(DEFAULT_INCOMING_CALL_RING_SECONDS).toBeLessThanOrEqual(
      MAX_INCOMING_CALL_RING_SECONDS,
    );
  });
});

describe("the ring time handed to Twilio", () => {
  test("is the rule's own when Twilio takes it", () => {
    expect(getIncomingCallRingSeconds(5)).toBe(5);
    expect(getIncomingCallRingSeconds(20)).toBe(20);
    expect(getIncomingCallRingSeconds(30)).toBe(30);
    expect(getIncomingCallRingSeconds(600)).toBe(600);
  });

  test("is the default when the rule has none", () => {
    expect(getIncomingCallRingSeconds(undefined)).toBe(30);
    expect(getIncomingCallRingSeconds(null)).toBe(30);
    // What the webhook did with a 0 before: `|| 30`.
    expect(getIncomingCallRingSeconds(0)).toBe(30);
  });

  test("is the default for a time that is no time", () => {
    expect(getIncomingCallRingSeconds(-10)).toBe(30);
    expect(getIncomingCallRingSeconds(Number.NaN)).toBe(30);
    expect(getIncomingCallRingSeconds(Number.POSITIVE_INFINITY)).toBe(30);
  });

  test("is raised to Twilio's shortest", () => {
    expect(getIncomingCallRingSeconds(1)).toBe(5);
    expect(getIncomingCallRingSeconds(4)).toBe(5);
  });

  test("is cut to Twilio's longest", () => {
    expect(getIncomingCallRingSeconds(601)).toBe(600);
    expect(getIncomingCallRingSeconds(3600)).toBe(600);
  });

  test("is a whole number of seconds", () => {
    expect(getIncomingCallRingSeconds(12.4)).toBe(12);
    expect(getIncomingCallRingSeconds(12.6)).toBe(13);
    expect(getIncomingCallRingSeconds(0.4)).toBe(5);
  });
});
