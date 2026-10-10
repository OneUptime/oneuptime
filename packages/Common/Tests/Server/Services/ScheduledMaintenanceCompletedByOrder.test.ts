import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import BadDataException from "../../../Types/Exception/BadDataException";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  ProgressStateKey,
  makeEventInState,
  makeProgressStates,
  mockProgressStateReads,
} from "../TestingUtils/ScheduledMaintenanceProgressWorld";

/*
 * Whether a scheduled maintenance event is complete, as
 * ScheduledMaintenanceService.isScheduledMaintenanceCompleted answers it:
 * what stops its owners' reminders (SendUnresolvedReminderNotification, and
 * the first reminder planned when the event is created).
 *
 * It is complete in its project's completed state and in every state placed
 * after it ("Archived") - the rule the chats' Mark as Complete and Mark as
 * Ongoing read off the event they read already
 * (ScheduledMaintenanceStateService.isCompleteAmong, through
 * WorkspaceMemberActions.getStanding). Both read the same rule, so a button
 * and a reminder never disagree about an event.
 */

const EXPECTED: Array<[ProgressStateKey, boolean]> = [
  ["scheduled", false],
  ["confirmed", false],
  ["ongoing", false],
  ["verifying", false],
  ["ended", false],
  ["reviewing", false],
  ["completed", true],
  ["archived", true],
];

// The service's read of the event, answered with `event`.
let findOneBy: SpyInstance<typeof ScheduledMaintenanceService.findOneBy>;

function readsEvent(event: ScheduledMaintenance | null): void {
  findOneBy = jest
    .spyOn(ScheduledMaintenanceService, "findOneBy")
    .mockResolvedValue(event as never);
}

describe("ScheduledMaintenanceService.isScheduledMaintenanceCompleted: is the event complete", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(EXPECTED)(
    "an event in %s: %s",
    async (key: ProgressStateKey, expected: boolean) => {
      mockProgressStateReads();
      const event: ScheduledMaintenance = makeEventInState(key);
      readsEvent(event);

      await expect(
        ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
          scheduledMaintenanceId: event.id!,
        }),
      ).resolves.toBe(expected);
    },
  );

  test.each(EXPECTED)(
    "answers as the chats' rule does for an event in %s",
    async (key: ProgressStateKey) => {
      mockProgressStateReads();
      const event: ScheduledMaintenance = makeEventInState(key);
      readsEvent(event);

      const states: Array<ScheduledMaintenanceState> = makeProgressStates();

      await expect(
        ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
          scheduledMaintenanceId: event.id!,
        }),
      ).resolves.toBe(
        ScheduledMaintenanceStateService.isCompleteAmong({
          states: states,
          stateId: event.currentScheduledMaintenanceStateId,
        }),
      );
    },
  );

  test("reads the event's state id and project, and the project's states once", async () => {
    const reads: ReturnType<typeof mockProgressStateReads> =
      mockProgressStateReads();
    const event: ScheduledMaintenance = makeEventInState("archived");
    readsEvent(event);

    await ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
      scheduledMaintenanceId: event.id!,
    });

    const select: Record<string, unknown> = (
      findOneBy.mock.calls[0]![0] as unknown as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(select).toEqual({
      projectId: true,
      currentScheduledMaintenanceStateId: true,
    });
    expect(reads.findBy).toHaveBeenCalledTimes(1);
  });

  test("an event without a state is not complete", async () => {
    mockProgressStateReads();
    const event: ScheduledMaintenance = makeEventInState("completed");
    delete event.currentScheduledMaintenanceStateId;
    readsEvent(event);

    await expect(
      ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
        scheduledMaintenanceId: event.id!,
      }),
    ).resolves.toBe(false);
  });

  test("in a project with no completed state, nothing is complete", async () => {
    mockProgressStateReads(
      makeProgressStates().filter(
        (state: ScheduledMaintenanceState): boolean => {
          return !state.isResolvedState;
        },
      ),
    );
    const event: ScheduledMaintenance = makeEventInState("archived");
    readsEvent(event);

    await expect(
      ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
        scheduledMaintenanceId: event.id!,
      }),
    ).resolves.toBe(false);
  });

  test("an event that is not there is refused", async () => {
    mockProgressStateReads();
    readsEvent(null);

    await expect(
      ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
        scheduledMaintenanceId: makeEventInState("completed").id!,
      }),
    ).rejects.toThrow(BadDataException);
  });
});
