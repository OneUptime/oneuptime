import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordKind,
} from "../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import ObjectID from "../../../Types/ObjectID";
import { ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import {
  getOnCallPageRecordDeletedMessage,
  ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE,
  ON_CALL_PAGE_RECORD_DELETED_MESSAGE_START,
} from "../../../Types/OnCallDutyPolicy/OnCallPageRecordGone";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * How a person's on-call log says it ended because its incident, alert or
 * episode was deleted (issue #8106): the worker that runs their rules
 * (UserOnCallLog:ExecutePendingExecutions) ends such a log Completed with
 * this message, where it used to throw and retry the log every minute,
 * forever.
 */

const KINDS: Array<OnCallTimeoutRecordKind> = [
  "incident",
  "alert",
  "incident episode",
  "alert episode",
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the message of a log whose record was deleted", () => {
  test("names the kind of record that was deleted", () => {
    expect(getOnCallPageRecordDeletedMessage("incident")).toBe(
      "Execution completed because incident is deleted.",
    );
    expect(getOnCallPageRecordDeletedMessage("alert")).toBe(
      "Execution completed because alert is deleted.",
    );
    expect(getOnCallPageRecordDeletedMessage("incident episode")).toBe(
      "Execution completed because incident episode is deleted.",
    );
    expect(getOnCallPageRecordDeletedMessage("alert episode")).toBe(
      "Execution completed because alert episode is deleted.",
    );
  });

  test("a log that names no record says so, and does not claim one was deleted", () => {
    for (const nothing of [null, undefined, "", "   "]) {
      expect(getOnCallPageRecordDeletedMessage(nothing)).toBe(
        ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE,
      );
    }

    expect(ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE).toBe(
      "Execution completed because this page names no incident, alert or episode.",
    );
    expect(ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE).not.toMatch(/deleted/);
  });

  test("a kind written with spaces around it reads as the kind", () => {
    expect(getOnCallPageRecordDeletedMessage("  alert ")).toBe(
      "Execution completed because alert is deleted.",
    );
  });

  test("every message starts as the worker's other endings do, and is one sentence", () => {
    expect(ON_CALL_PAGE_RECORD_DELETED_MESSAGE_START).toBe(
      ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START,
    );

    for (const kind of [...KINDS, null]) {
      const message: string = getOnCallPageRecordDeletedMessage(kind);

      expect(
        message.startsWith(ON_CALL_PAGE_RECORD_DELETED_MESSAGE_START),
      ).toBe(true);
      expect(message.endsWith(".")).toBe(true);
      expect(message.match(/\./g)).toHaveLength(1);
    }
  });

  /*
   * A page again (OnCallAcknowledgementTimeout) whose record is deleted was
   * already ended by the worker with "Execution completed because " and the
   * reason getPageAgainOverReason gives. Every log whose record is deleted
   * now ends before that is asked, so the words must be the same.
   */
  test("reads exactly as a page again whose record was deleted always ended", async () => {
    jest
      .spyOn(OnCallAcknowledgementTimeout, "readRecordState")
      .mockResolvedValue(null);

    for (const kind of KINDS) {
      const reason: string | null =
        await OnCallAcknowledgementTimeout.getPageAgainOverReason({
          run: { pageAgainNumber: 1 },
          kind: kind,
          recordId: ObjectID.generate(),
        });

      expect(`Execution completed because ${reason}.`).toBe(
        getOnCallPageRecordDeletedMessage(kind),
      );
    }
  });

  test("the kind a log's message names is the record the log pages about", () => {
    const id: ObjectID = ObjectID.generate();

    expect(
      getOnCallPageRecordDeletedMessage(
        OnCallAcknowledgementTimeout.getRunRecord({
          triggeredByAlertEpisodeId: id,
        })?.kind,
      ),
    ).toBe("Execution completed because alert episode is deleted.");

    // A log that names nothing has no record to name.
    expect(
      getOnCallPageRecordDeletedMessage(
        OnCallAcknowledgementTimeout.getRunRecord({})?.kind,
      ),
    ).toBe(ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE);
  });
});
