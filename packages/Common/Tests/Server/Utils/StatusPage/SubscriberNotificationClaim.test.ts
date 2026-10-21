import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import SubscriberNotificationClaim from "../../../../Server/Utils/StatusPage/SubscriberNotificationClaim";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "../../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationInterruption from "../../../../Types/StatusPage/SubscriberNotificationInterruption";
import { getJestSpyOn } from "../../../Spy";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The claim and the interrupted-send write are each one compare-and-set, so
 * two subscriber job runs cannot both send one notification, and the
 * sweeper cannot overwrite a send that settled at the last moment.
 */

const NOTE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

let service: DatabaseService<IncidentPublicNote>;
let compareAndSet: jest.Mock;

beforeEach(() => {
  jest.restoreAllMocks();
  service = new DatabaseService<IncidentPublicNote>(IncidentPublicNote);
  compareAndSet = getJestSpyOn(
    service,
    "compareAndSetColumnsByIdWithoutHooks",
  ).mockResolvedValue(true as never) as unknown as jest.Mock;
});

describe("SubscriberNotificationClaim.claim", () => {
  test("moves the notification from Pending to InProgress, only at the version the job read", async () => {
    await expect(
      SubscriberNotificationClaim.claim({
        service: service,
        id: NOTE_ID,
        statusColumn: "subscriberNotificationStatusOnNoteUpdated",
        version: 4,
      }),
    ).resolves.toBe(true);

    expect(compareAndSet).toHaveBeenCalledWith({
      id: NOTE_ID,
      data: {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      expectedData: {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Pending,
        version: 4,
      },
    });
  });

  test("stamps updatedAt, which the sweeper times the send from", async () => {
    await SubscriberNotificationClaim.claim({
      service: service,
      id: NOTE_ID,
      statusColumn: "subscriberNotificationStatusOnNoteCreated",
      version: 4,
    });

    const input: { skipUpdateDateColumn?: boolean } = compareAndSet.mock
      .calls[0]![0] as { skipUpdateDateColumn?: boolean };

    expect(input.skipUpdateDateColumn).toBeUndefined();
  });

  /*
   * A row other code writes while its send runs - an open incident, which
   * the owners' reminders and state changes keep updating - has its own
   * claimed-at column, stamped by the claim alone, for the sweeper to time
   * the send from.
   */
  test("stamps the notification's claimed-at column with the time of the claim", async () => {
    const before: number = Date.now();

    await SubscriberNotificationClaim.claim({
      service: service as unknown as DatabaseService<Incident>,
      id: NOTE_ID,
      statusColumn: "subscriberNotificationStatusOnIncidentCreated",
      claimedAtColumn: "subscriberNotificationClaimedAtOnIncidentCreated",
      version: 4,
    });

    const input: { data: Record<string, unknown>; expectedData: unknown } =
      compareAndSet.mock.calls[0]![0] as {
        data: Record<string, unknown>;
        expectedData: unknown;
      };
    const claimedAt: Date = input.data[
      "subscriberNotificationClaimedAtOnIncidentCreated"
    ] as Date;

    expect(input.data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.InProgress,
    );
    expect(claimedAt).toBeInstanceOf(Date);
    expect(claimedAt.getTime()).toBeGreaterThanOrEqual(before);
    // The condition is unchanged: its status and version only.
    expect(input.expectedData).toEqual({
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      version: 4,
    });
  });

  test("settles other columns in the same write, only while they still hold what was read", async () => {
    await SubscriberNotificationClaim.claim({
      service: service,
      id: NOTE_ID,
      statusColumn: "subscriberNotificationStatusOnNoteCreated",
      version: 4,
      alsoSet: {
        data: {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.Skipped,
        },
        expected: {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
      },
    });

    expect(compareAndSet).toHaveBeenCalledWith({
      id: NOTE_ID,
      data: {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
      },
      expectedData: {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Pending,
        version: 4,
      },
    });
  });

  test("another run's claim, or a change since the read, loses", async () => {
    compareAndSet.mockResolvedValue(false as never);

    await expect(
      SubscriberNotificationClaim.claim({
        service: service,
        id: NOTE_ID,
        statusColumn: "subscriberNotificationStatusOnNoteCreated",
        version: 4,
      }),
    ).resolves.toBe(false);
  });

  test("a row read without its version is claimed on its status alone", async () => {
    await SubscriberNotificationClaim.claim({
      service: service,
      id: NOTE_ID,
      statusColumn: "subscriberNotificationStatusOnNoteCreated",
      version: undefined,
    });

    expect(
      (compareAndSet.mock.calls[0]![0] as { expectedData: unknown })
        .expectedData,
    ).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Pending,
    });
  });
});

describe("SubscriberNotificationClaim.failInterrupted", () => {
  test("marks the notification Failed with the reason, only if it is still InProgress at the version read", async () => {
    await expect(
      SubscriberNotificationClaim.failInterrupted({
        service: service,
        id: NOTE_ID,
        statusColumn: "subscriberNotificationStatusOnNoteCreated",
        messageColumn: "subscriberNotificationStatusMessage",
        message: SubscriberNotificationInterruption.resendsMessage,
        version: 9,
      }),
    ).resolves.toBe(true);

    expect(compareAndSet).toHaveBeenCalledWith({
      id: NOTE_ID,
      data: {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessage:
          SubscriberNotificationInterruption.resendsMessage,
      },
      expectedData: {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
        version: 9,
      },
    });
  });

  test("a send that settled in the meantime keeps its outcome", async () => {
    compareAndSet.mockResolvedValue(false as never);

    await expect(
      SubscriberNotificationClaim.failInterrupted({
        service: service,
        id: NOTE_ID,
        statusColumn: "subscriberNotificationStatusOnNoteCreated",
        messageColumn: "subscriberNotificationStatusMessage",
        message: SubscriberNotificationInterruption.resendsMessage,
        version: 9,
      }),
    ).resolves.toBe(false);
  });
});

describe("SubscriberNotificationInterruption", () => {
  test("both messages start with the prefix and say what Retry does", () => {
    for (const message of [
      SubscriberNotificationInterruption.resumesMessage,
      SubscriberNotificationInterruption.resendsMessage,
    ]) {
      expect(message.startsWith("Interrupted:")).toBe(true);
      expect(
        SubscriberNotificationInterruption.isInterruptedMessage(message),
      ).toBe(true);
      expect(message).toContain("Retry");
    }

    expect(SubscriberNotificationInterruption.resumesMessage).toContain(
      "only to the status pages that were not sent it in full",
    );
    expect(SubscriberNotificationInterruption.resendsMessage).toContain(
      "to every status page",
    );
  });

  test("tells an interruption from any other failure", () => {
    for (const message of [
      undefined,
      null,
      "",
      "connect ECONNREFUSED",
      "Not every subscriber was sent this notification: 1 of 5 messages failed.",
    ]) {
      expect(
        SubscriberNotificationInterruption.isInterruptedMessage(message),
      ).toBe(false);
    }
  });
});
