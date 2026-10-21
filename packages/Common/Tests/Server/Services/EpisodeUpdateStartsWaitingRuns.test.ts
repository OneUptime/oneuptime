import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import WaitingRunsOnRecordChange from "../../../Server/Utils/OnCall/WaitingRunsOnRecordChange";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * An episode whose runs wait for working hours, written something its
 * on-call rules read - its severity, labels, title or description - may now
 * match a rule that pages right away: its update starts those runs
 * (WaitingRunsOnRecordChange). An update that writes nothing the rules read
 * starts nothing, and a start that fails never fails the update.
 *
 * onUpdateSuccess runs for real; starting the runs is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5eed-4aaa-8bbb-000000000001",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5eed-4aaa-8bbb-0000000000e1",
);
const SECOND_EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5eed-4aaa-8bbb-0000000000e2",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "0193c0de-5eed-4aaa-8bbb-0000000000f1",
);

type OnUpdateSuccess = (
  onUpdate: OnUpdate<never>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<never>>;

function onUpdateSuccessOf(service: unknown): OnUpdateSuccess {
  return (service as { onUpdateSuccess: OnUpdateSuccess }).onUpdateSuccess.bind(
    service,
  );
}

function update(data: Record<string, unknown>): OnUpdate<never> {
  return {
    updateBy: {
      query: {},
      data: data,
      props: { tenantId: PROJECT_ID },
    },
    carryForward: undefined,
  } as unknown as OnUpdate<never>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

const CASES: Array<{
  kind: string;
  service: unknown;
  severityKeys: Array<string>;
  start: "startForAlertEpisode" | "startForIncidentEpisode";
}> = [
  {
    kind: "alert episode",
    service: AlertEpisodeService,
    severityKeys: ["alertSeverityId", "alertSeverity"],
    start: "startForAlertEpisode",
  },
  {
    kind: "incident episode",
    service: IncidentEpisodeService,
    severityKeys: ["incidentSeverityId", "incidentSeverity"],
    start: "startForIncidentEpisode",
  },
];

describe.each(CASES)("an $kind's update", (episode: (typeof CASES)[0]) => {
  function stubStart(): SpyInstance<
    typeof WaitingRunsOnRecordChange.startForAlertEpisode
  > {
    return jest
      .spyOn(WaitingRunsOnRecordChange, episode.start)
      .mockResolvedValue(0);
  }

  test.each(episode.severityKeys)(
    "writing its severity (%s) starts the runs of each episode updated",
    async (severityKey: string) => {
      const start: SpyInstance<
        typeof WaitingRunsOnRecordChange.startForAlertEpisode
      > = stubStart();

      await onUpdateSuccessOf(episode.service)(
        update({ [severityKey]: SEVERITY_ID }),
        [EPISODE_ID, SECOND_EPISODE_ID],
      );

      expect(start.mock.calls).toEqual([[EPISODE_ID], [SECOND_EPISODE_ID]]);
    },
  );

  test.each(["labels", "title", "description"])(
    "writing its %s starts its runs",
    async (key: string) => {
      const start: SpyInstance<
        typeof WaitingRunsOnRecordChange.startForAlertEpisode
      > = stubStart();

      await onUpdateSuccessOf(episode.service)(update({ [key]: [] }), [
        EPISODE_ID,
      ]);

      expect(start).toHaveBeenCalledWith(EPISODE_ID);
    },
  );

  test("writing nothing its rules read starts nothing", async () => {
    const start: SpyInstance<
      typeof WaitingRunsOnRecordChange.startForAlertEpisode
    > = stubStart();

    await onUpdateSuccessOf(episode.service)(
      update({ rootCause: "Disk full", isOwnerNotified: true }),
      [EPISODE_ID],
    );

    expect(start).not.toHaveBeenCalled();
  });

  test("a start that fails is logged, and never fails the update", async () => {
    const start: SpyInstance<
      typeof WaitingRunsOnRecordChange.startForAlertEpisode
    > = stubStart();
    start.mockRejectedValueOnce(new Error("Database is down"));
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    const onUpdate: OnUpdate<never> = update({
      [episode.severityKeys[0]!]: SEVERITY_ID,
    });

    await expect(
      onUpdateSuccessOf(episode.service)(onUpdate, [
        EPISODE_ID,
        SECOND_EPISODE_ID,
      ]),
    ).resolves.toBe(onUpdate);

    // The other episode still starts.
    expect(start.mock.calls).toEqual([[EPISODE_ID], [SECOND_EPISODE_ID]]);
    expect(String(logged.mock.calls[0]![0])).toContain(
      "Starting waiting on-call runs failed",
    );
  });
});
