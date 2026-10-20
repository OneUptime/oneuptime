import Recurring from "../../Types/Events/Recurring";
import EventInterval from "../../Types/Events/EventInterval";
import MonitorTemplateSyncFieldUtil from "../../Types/Monitor/MonitorTemplateSyncField";
import MonitorType from "../../Types/Monitor/MonitorType";
import StatusPageSubscriberNotificationEventType from "../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables from "../../Types/StatusPage/SubscriberNotificationTemplateVariables";
import {
  MAX_REFUSED_VALUE_LENGTH,
  REFUSED_VALUE_CUT_MARK,
} from "../../Utils/RefusedValue";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * MORE VALIDATORS REPEAT AT MOST A FEW WORDS OF WHAT THEY REFUSE.
 *
 * A monitor template's "do not sync" field, a subscriber notification
 * template's event type and a rotation's interval type are what a request
 * sent; the message that refuses one goes back with the error and into the
 * server's log. Each now repeats its first 80 characters and "…", as every
 * value validator does (RefusedValue) - a short value reads as it always
 * did.
 * ---------------------------------------------------------------------------
 */

const LONG: string = "x".repeat(400000);

const messageOf: (run: () => unknown) => string = (
  run: () => unknown,
): string => {
  try {
    run();
  } catch (error: unknown) {
    return (error as Error).message;
  }

  throw new Error("expected the value to be refused");
};

const CUT: string =
  "x".repeat(MAX_REFUSED_VALUE_LENGTH) + REFUSED_VALUE_CUT_MARK;

describe("a long refused value is cut in the message", () => {
  test("a monitor template's do-not-sync field", () => {
    expect(
      messageOf(() => {
        return MonitorTemplateSyncFieldUtil.parse([LONG], MonitorType.Website);
      }),
    ).toBe(`Unsupported do not sync field: ${CUT}.`);
    expect(
      messageOf(() => {
        return MonitorTemplateSyncFieldUtil.parse(
          ["nope"],
          MonitorType.Website,
        );
      }),
    ).toBe("Unsupported do not sync field: nope.");
  });

  test("a subscriber notification template's event type", () => {
    expect(
      messageOf(() => {
        return SubscriberNotificationTemplateVariables.getAvailableVariablesForEventType(
          LONG as StatusPageSubscriberNotificationEventType,
        );
      }),
    ).toBe(`Unknown event type: ${CUT}`);
  });

  test("a rotation's interval type", () => {
    const rotation: Recurring = Recurring.getDefault();

    rotation.intervalType = LONG as EventInterval;

    expect(
      messageOf(() => {
        return Recurring.getNextDate(new Date(), rotation);
      }),
    ).toBe(`Invalid Interval Type: ${CUT}`);
    expect(
      messageOf(() => {
        return Recurring.toCalendarUnit("Fortnight" as EventInterval);
      }),
    ).toBe("Invalid Interval Type: Fortnight");
  });
});
