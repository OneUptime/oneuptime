import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import TableColumnType from "../../../Types/Database/TableColumnType";
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
 *
 * A new rule rings for 20 seconds, so the call moves on before most
 * voicemail picks up and "answers" it. Rules used to start at 30 - Twilio's
 * own default - and the rules saved then keep their 30.
 */

// What a new rule started with before, and what Twilio's <Dial> rings for when given no timeout.
const PREVIOUS_DEFAULT_RING_SECONDS: number = 30;

interface RingColumnMetadata {
  defaultValue?: unknown;
  required?: boolean;
  isDefaultValueColumn?: boolean;
  type?: TableColumnType;
  description?: string;
}

function ringColumn(): RingColumnMetadata {
  return new IncomingCallPolicyEscalationRule().getTableColumnMetadata(
    "escalateAfterSeconds",
  ) as RingColumnMetadata;
}

// The column as TypeORM creates it in the database.
function storedRingColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (candidate: ColumnMetadataArgs): boolean => {
      return (
        (candidate.target as unknown) === IncomingCallPolicyEscalationRule &&
        candidate.propertyName === "escalateAfterSeconds"
      );
    },
  );
}

describe("the ring time a new incoming call rule starts with", () => {
  test("is 20 seconds", () => {
    expect(DEFAULT_INCOMING_CALL_RING_SECONDS).toBe(20);
  });

  test("is shorter than the 30 seconds rules used to start with, Twilio's own default", () => {
    expect(DEFAULT_INCOMING_CALL_RING_SECONDS).toBeLessThan(
      PREVIOUS_DEFAULT_RING_SECONDS,
    );
  });

  test("is what the API stores for a rule created without one", () => {
    const column: RingColumnMetadata = ringColumn();

    expect(column.defaultValue).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    // Optional on create: the API fills the default in.
    expect(column.isDefaultValueColumn).toBe(true);
    expect(column.required).toBe(true);
    expect(column.type).toBe(TableColumnType.Number);
  });

  test("is the database's default too, so a row written without it rings for 20", () => {
    const stored: ColumnMetadataArgs | undefined = storedRingColumn();

    expect(stored).toBeDefined();
    expect(stored?.options.default).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    expect(stored?.options.nullable).toBe(false);
  });

  test("is in the API's description, with what the number does and Twilio's limits", () => {
    const description: string = ringColumn().description || "";

    expect(description).toBe(
      "How long, in seconds, the phone rings before the call moves on to the next rule. 20 when left out; a time below 5 or above 600 rings for 5 or 600, the limits Twilio takes.",
    );
    expect(description).toContain(
      `${DEFAULT_INCOMING_CALL_RING_SECONDS} when left out`,
    );
    expect(description).not.toContain(String(PREVIOUS_DEFAULT_RING_SECONDS));
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

  test("is handed to Twilio as it is", () => {
    expect(getIncomingCallRingSeconds(DEFAULT_INCOMING_CALL_RING_SECONDS)).toBe(
      DEFAULT_INCOMING_CALL_RING_SECONDS,
    );
  });
});

describe("the ring time handed to Twilio", () => {
  test("is the rule's own when Twilio takes it", () => {
    expect(getIncomingCallRingSeconds(5)).toBe(5);
    expect(getIncomingCallRingSeconds(20)).toBe(20);
    expect(getIncomingCallRingSeconds(45)).toBe(45);
    expect(getIncomingCallRingSeconds(600)).toBe(600);
  });

  test("is still 30 for a rule saved when 30 was the default: nothing rewrites it", () => {
    expect(getIncomingCallRingSeconds(PREVIOUS_DEFAULT_RING_SECONDS)).toBe(30);
  });

  test("is the default when the rule has none", () => {
    expect(getIncomingCallRingSeconds(undefined)).toBe(20);
    expect(getIncomingCallRingSeconds(null)).toBe(20);
    // What the webhook did with a 0 before: `|| 30`.
    expect(getIncomingCallRingSeconds(0)).toBe(20);
  });

  test("is the default for a time that is no time", () => {
    expect(getIncomingCallRingSeconds(-10)).toBe(20);
    expect(getIncomingCallRingSeconds(Number.NaN)).toBe(20);
    expect(getIncomingCallRingSeconds(Number.POSITIVE_INFINITY)).toBe(20);
    expect(getIncomingCallRingSeconds(Number.NEGATIVE_INFINITY)).toBe(20);
  });

  test("is the default for a value that is not a number at all", () => {
    expect(getIncomingCallRingSeconds("30" as unknown as number)).toBe(20);
    expect(getIncomingCallRingSeconds({} as unknown as number)).toBe(20);
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
    expect(getIncomingCallRingSeconds(19.5)).toBe(20);
  });
});
