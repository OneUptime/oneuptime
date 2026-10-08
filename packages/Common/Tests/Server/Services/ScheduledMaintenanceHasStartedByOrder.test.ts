import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  ProgressStateKey,
  makeEventInState,
  mockProgressStateReads,
} from "../TestingUtils/ScheduledMaintenanceProgressWorld";

/*
 * Whether a scheduled maintenance event has started, as
 * ScheduledMaintenanceService.isScheduledMaintenanceOngoing answers it: what
 * stops the owners' reminders of a rule set to stop once the event is
 * ongoing (SendUnresolvedReminderNotification), and what Slack's Mark as
 * Ongoing refuses with "already in ongoing state".
 *
 * It has started in the ongoing state and in every state after it - a state
 * of the project's own between Ongoing and Ended ("Verifying") as much as
 * Ended, a state after Ended ("Reviewing") or Completed. A state of the
 * project's own placed before Ongoing ("Confirmed") is still waiting, as
 * Scheduled is (Common/Utils/ScheduledMaintenanceStart.hasStarted). Read
 * with the ongoing flag alone, an event moved on to "Verifying" kept
 * reminding its owners that it had not started.
 */

const EXPECTED: Array<[ProgressStateKey, boolean]> = [
  ["scheduled", false],
  ["confirmed", false],
  ["ongoing", true],
  ["verifying", true],
  ["ended", true],
  ["reviewing", true],
  ["completed", true],
  ["archived", true],
];

function readsEvent(key: ProgressStateKey): ScheduledMaintenance {
  const event: ScheduledMaintenance = makeEventInState(key);

  jest
    .spyOn(ScheduledMaintenanceService, "findOneBy")
    .mockResolvedValue(event as never);

  return event;
}

describe("ScheduledMaintenanceService.isScheduledMaintenanceOngoing: has the event started", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(EXPECTED)(
    "an event in %s: %s",
    async (key: ProgressStateKey, expected: boolean) => {
      mockProgressStateReads();
      const event: ScheduledMaintenance = readsEvent(key);

      await expect(
        ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
          scheduledMaintenanceId: event.id!,
        }),
      ).resolves.toBe(expected);
    },
  );

  test.each([
    "scheduled",
    "ongoing",
    "ended",
    "completed",
  ] as Array<ProgressStateKey>)(
    "a built-in state (%s) is decided by its flag, without reading the project's states",
    async (key: ProgressStateKey) => {
      const reads: ReturnType<typeof mockProgressStateReads> =
        mockProgressStateReads();
      const event: ScheduledMaintenance = readsEvent(key);

      await ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
        scheduledMaintenanceId: event.id!,
      });

      expect(reads.findBy).not.toHaveBeenCalled();
    },
  );

  test.each([
    "confirmed",
    "verifying",
    "reviewing",
    "archived",
  ] as Array<ProgressStateKey>)(
    "a state of the project's own (%s) is placed by one read of the project's states",
    async (key: ProgressStateKey) => {
      const reads: ReturnType<typeof mockProgressStateReads> =
        mockProgressStateReads();
      const event: ScheduledMaintenance = readsEvent(key);

      await ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
        scheduledMaintenanceId: event.id!,
      });

      expect(reads.findBy).toHaveBeenCalledTimes(1);
    },
  );

  test("asks for the event's state with its place and flags", async () => {
    mockProgressStateReads();
    const event: ScheduledMaintenance = readsEvent("verifying");

    await ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
      scheduledMaintenanceId: event.id!,
    });

    const findOneBy: jest.SpiedFunction<
      typeof ScheduledMaintenanceService.findOneBy
    > = ScheduledMaintenanceService.findOneBy as unknown as jest.SpiedFunction<
      typeof ScheduledMaintenanceService.findOneBy
    >;
    const select: Record<string, unknown> = (
      findOneBy.mock.calls[0]![0] as unknown as {
        select: Record<string, unknown>;
      }
    ).select;
    const stateSelect: Record<string, unknown> = select[
      "currentScheduledMaintenanceState"
    ] as Record<string, unknown>;

    for (const column of [
      "order",
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ]) {
      expect([column, stateSelect[column]]).toEqual([column, true]);
    }
  });
});
