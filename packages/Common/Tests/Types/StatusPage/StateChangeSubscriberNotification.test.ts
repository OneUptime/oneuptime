import {
  BulkStateChangeNoteType,
  buildBulkStateChangeMiscDataProps,
  getBulkStateChangeNoteFieldKey,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/BulkStateChange";
import { JSONObject } from "../../../Types/JSON";
import StateChangeSubscriberNotification, {
  StateChangeNotificationColumns,
  StateChangeSubscriberNotificationDecision,
} from "../../../Types/StatusPage/StateChangeSubscriberNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * One state change, one message to status page subscribers. A change posted
 * with a public note while it notifies subscribers is told by the note, and
 * never queued itself; one without a note is queued; one that does not
 * notify is skipped. Both state timeline services (incidents and scheduled
 * maintenance) decide with this, so it is the one place the rule lives.
 */

const SKIPPED_MESSAGE: string =
  "Notifications skipped as subscribers are not to be notified for this test state change.";

describe("StateChangeSubscriberNotification.getPublicNote", () => {
  test("reads the key the dashboard sends the note under", () => {
    expect(StateChangeSubscriberNotification.publicNoteKey).toBe("publicNote");
    expect(getBulkStateChangeNoteFieldKey(BulkStateChangeNoteType.Public)).toBe(
      StateChangeSubscriberNotification.publicNoteKey,
    );
  });

  test("returns the note exactly as written", () => {
    expect(
      StateChangeSubscriberNotification.getPublicNote({
        publicNote: "Maintenance has started.",
      }),
    ).toBe("Maintenance has started.");

    // Markdown keeps its own spacing: an indented block, a trailing break.
    const markdown: string = "    SELECT 1;\n\nWe are back.\n";
    expect(
      StateChangeSubscriberNotification.getPublicNote({ publicNote: markdown }),
    ).toBe(markdown);
  });

  test("reads what the bulk Change State action sends", () => {
    const miscDataProps: JSONObject = buildBulkStateChangeMiscDataProps({
      noteType: BulkStateChangeNoteType.Public,
      note: "Rolled out to every region.",
    });

    expect(StateChangeSubscriberNotification.getPublicNote(miscDataProps)).toBe(
      "Rolled out to every region.",
    );
  });

  test.each([
    ["no misc data", undefined],
    ["null misc data", null],
    ["misc data without a note", {}],
    ["only a private note", { privateNote: "Paged the database team." }],
  ])("is undefined for %s", (_name: string, miscDataProps: unknown) => {
    expect(
      StateChangeSubscriberNotification.getPublicNote(
        miscDataProps as JSONObject | undefined | null,
      ),
    ).toBeUndefined();
  });

  test.each([
    ["an empty note", ""],
    ["spaces", "   "],
    ["line breaks and tabs", "\n\t\r\n "],
    ["a non-breaking space", " "],
  ])(
    "is undefined for a note with no text in it: %s",
    (_name: string, note: string) => {
      expect(
        StateChangeSubscriberNotification.getPublicNote({ publicNote: note }),
      ).toBeUndefined();
    },
  );

  test.each([
    ["a number", 42],
    ["a boolean", true],
    ["null", null],
    ["an object", { text: "Maintenance has started." }],
    ["a list", ["Maintenance has started."]],
  ])(
    "is undefined for a note that is not text: %s",
    (_name: string, note: unknown) => {
      expect(
        StateChangeSubscriberNotification.getPublicNote({
          publicNote: note,
        } as JSONObject),
      ).toBeUndefined();
    },
  );
});

describe("StateChangeSubscriberNotification.getDecision", () => {
  test("to notify, with a public note: sent by the note, and it says so", () => {
    expect(
      StateChangeSubscriberNotification.getDecision({
        shouldStatusPageSubscribersBeNotified: true,
        hasPublicNote: true,
        skippedMessage: SKIPPED_MESSAGE,
      }),
    ).toEqual({
      status: StatusPageSubscriberNotificationStatus.Success,
      message: StateChangeSubscriberNotification.sentByPublicNoteMessage,
    });
  });

  test("the message says why nothing was queued, in plain words", () => {
    expect(StateChangeSubscriberNotification.sentByPublicNoteMessage).toBe(
      "Subscribers are notified by the public note posted with this state change, so they get one message instead of two.",
    );
  });

  test("to notify, without a note: queued, with no message of its own", () => {
    const decision: StateChangeSubscriberNotificationDecision | null =
      StateChangeSubscriberNotification.getDecision({
        shouldStatusPageSubscribersBeNotified: true,
        hasPublicNote: false,
        skippedMessage: SKIPPED_MESSAGE,
      });

    expect(decision?.status).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(decision?.message).toBeUndefined();
  });

  test.each([true, false])(
    "not to notify (note: %s): skipped, saying why",
    (hasPublicNote: boolean) => {
      expect(
        StateChangeSubscriberNotification.getDecision({
          shouldStatusPageSubscribersBeNotified: false,
          hasPublicNote: hasPublicNote,
          skippedMessage: SKIPPED_MESSAGE,
        }),
      ).toEqual({
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: SKIPPED_MESSAGE,
      });
    },
  );

  test.each([
    [undefined, true],
    [undefined, false],
    [null, true],
    [null, false],
  ])(
    "not said (%s, note: %s): no decision, the columns' defaults apply",
    (notify: undefined | null, hasPublicNote: boolean) => {
      expect(
        StateChangeSubscriberNotification.getDecision({
          shouldStatusPageSubscribersBeNotified: notify,
          hasPublicNote: hasPublicNote,
          skippedMessage: SKIPPED_MESSAGE,
        }),
      ).toBeNull();
    },
  );

  test("at most one message is queued for any change, and exactly one when it notifies", () => {
    /*
     * The two jobs that tell subscribers: the state change job sends a
     * Pending change, the public note job a note posted to notify.
     */
    for (const notify of [true, false, undefined]) {
      for (const hasPublicNote of [true, false]) {
        const decision: StateChangeSubscriberNotificationDecision | null =
          StateChangeSubscriberNotification.getDecision({
            shouldStatusPageSubscribersBeNotified: notify,
            hasPublicNote: hasPublicNote,
            skippedMessage: SKIPPED_MESSAGE,
          });

        const changeQueued: boolean =
          (decision?.status ??
            StatusPageSubscriberNotificationStatus.Pending) ===
            StatusPageSubscriberNotificationStatus.Pending &&
          // The column's default when nobody said: notify.
          (notify ?? true) === true;

        // The services post the note with Boolean(the change's flag).
        const noteQueued: boolean = hasPublicNote && Boolean(notify);

        const queued: number = (changeQueued ? 1 : 0) + (noteQueued ? 1 : 0);

        expect({ notify, hasPublicNote, queued }).toEqual({
          notify,
          hasPublicNote,
          queued: notify === false ? 0 : 1,
        });
      }
    }
  });
});

describe("StateChangeSubscriberNotification.applyToStateChange", () => {
  function stateChange(
    columns: StateChangeNotificationColumns,
  ): StateChangeNotificationColumns {
    return { ...columns };
  }

  test("writes the note's decision onto the change", () => {
    const change: StateChangeNotificationColumns = stateChange({
      shouldStatusPageSubscribersBeNotified: true,
    });

    StateChangeSubscriberNotification.applyToStateChange({
      stateChange: change,
      hasPublicNote: true,
      skippedMessage: SKIPPED_MESSAGE,
    });

    expect(change).toEqual({
      shouldStatusPageSubscribersBeNotified: true,
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessage:
        StateChangeSubscriberNotification.sentByPublicNoteMessage,
    });
  });

  test("a status the caller sent does not survive a change that notifies", () => {
    for (const sent of [
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Failed,
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Skipped,
    ]) {
      const change: StateChangeNotificationColumns = stateChange({
        shouldStatusPageSubscribersBeNotified: true,
        subscriberNotificationStatus: sent,
      });

      StateChangeSubscriberNotification.applyToStateChange({
        stateChange: change,
        hasPublicNote: false,
        skippedMessage: SKIPPED_MESSAGE,
      });

      expect(change.subscriberNotificationStatus).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
    }
  });

  test("queuing the change leaves its message as it was", () => {
    const change: StateChangeNotificationColumns = stateChange({
      shouldStatusPageSubscribersBeNotified: true,
      subscriberNotificationStatusMessage: "Set by the caller.",
    });

    StateChangeSubscriberNotification.applyToStateChange({
      stateChange: change,
      hasPublicNote: false,
      skippedMessage: SKIPPED_MESSAGE,
    });

    expect(change.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(change.subscriberNotificationStatusMessage).toBe(
      "Set by the caller.",
    );
  });

  test("a change that does not notify is skipped, with the service's own words", () => {
    const change: StateChangeNotificationColumns = stateChange({
      shouldStatusPageSubscribersBeNotified: false,
    });

    StateChangeSubscriberNotification.applyToStateChange({
      stateChange: change,
      hasPublicNote: true,
      skippedMessage: SKIPPED_MESSAGE,
    });

    expect(change.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(change.subscriberNotificationStatusMessage).toBe(SKIPPED_MESSAGE);
  });

  test("a change that does not say leaves both columns alone", () => {
    const change: StateChangeNotificationColumns = stateChange({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Pending,
      subscriberNotificationStatusMessage: "Set by the caller.",
    });

    StateChangeSubscriberNotification.applyToStateChange({
      stateChange: change,
      hasPublicNote: true,
      skippedMessage: SKIPPED_MESSAGE,
    });

    expect(change).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Pending,
      subscriberNotificationStatusMessage: "Set by the caller.",
    });
  });
});
