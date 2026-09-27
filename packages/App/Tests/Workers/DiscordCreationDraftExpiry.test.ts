import RunCron from "../../FeatureSet/Workers/Utils/Cron";
import Service from "Common/Server/Services/DiscordCreationDraftService";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * Failure inventory before registration: no startup sweep, slower expiry,
 * cleanup errors hidden from the worker's retry/failure infrastructure.
 */
jest.mock(
  "../../FeatureSet/Workers/Utils/Cron",
  (): Record<string, unknown> => {
    return { __esModule: true, default: jest.fn() };
  },
);
jest.mock(
  "Common/Server/Services/DiscordCreationDraftService",
  (): Record<string, unknown> => {
    return { __esModule: true, default: { clearExpiredContent: jest.fn() } };
  },
);

import "../../FeatureSet/Workers/Jobs/Discord/ClearExpiredCreationDrafts";

test("draft content is swept every minute and on startup", async (): Promise<void> => {
  expect(RunCron).toHaveBeenCalledWith(
    "Discord:ClearExpiredCreationDrafts",
    { schedule: EVERY_MINUTE, runOnStartup: true },
    expect.any(Function),
  );
  const callback: () => Promise<void> = jest.mocked(RunCron).mock.calls[0]![2];
  jest.mocked(Service.clearExpiredContent).mockResolvedValue();
  await callback();
  expect(Service.clearExpiredContent).toHaveBeenCalledTimes(1);
});

test("cleanup failure rejects the job instead of declaring successful erasure", async (): Promise<void> => {
  const callback: () => Promise<void> = jest.mocked(RunCron).mock.calls[0]![2];
  jest
    .mocked(Service.clearExpiredContent)
    .mockRejectedValue(new Error("database unavailable"));
  await expect(callback()).rejects.toThrow("database unavailable");
});
