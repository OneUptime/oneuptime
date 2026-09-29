import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ObjectID from "../../../Types/ObjectID";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test: saving any column the evaluation worker reads makes
 * the SLO due immediately (nextEvaluationAt = now), so the page the user
 * saved from shows the new numbers within one worker tick instead of at the
 * SLO's next regular evaluation.
 *
 * The Settings page made four more such columns editable in one place:
 * which statuses count as down, how several monitors combine, where the
 * calendar month starts and ends, and when the SLO turns At Risk. Each one
 * changes the result, so each one must force the re-evaluation.
 *
 * Other workstreams add their own behaviour to onUpdateSuccess (feed items,
 * archive handling), so these tests stub the neighbours out and count only
 * the nextEvaluationAt stamps.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const DOWNTIME_STATUS_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

type SloFields = Record<string, unknown>;

interface StampCall {
  id: ObjectID;
  data: { nextEvaluationAt: Date };
  props: Record<string, unknown>;
}

function makeSlo(fields: SloFields): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  const writable: Record<string, unknown> = slo as unknown as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(fields)) {
    writable[key] = fields[key];
  }

  return slo;
}

function makeOnUpdate(data: SloFields): OnUpdate<ServiceLevelObjective> {
  return {
    updateBy: {
      query: { _id: SLO_ID.toString() },
      data: data,
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<ServiceLevelObjective>,
    carryForward: null,
  };
}

// Calls the protected hook without widening the service's public surface.
function callOnUpdateSuccess(
  onUpdate: OnUpdate<ServiceLevelObjective>,
  updatedItemIds: Array<ObjectID>,
): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks["onUpdateSuccess"]!.apply(ServiceLevelObjectiveService, [
    onUpdate,
    updatedItemIds,
  ]);
}

describe("ServiceLevelObjectiveService.onUpdateSuccess - forcing re-evaluation from Settings", () => {
  let updateOneByIdSpy: jest.SpyInstance;

  function stampCalls(): Array<StampCall> {
    return updateOneByIdSpy.mock.calls
      .map((call: Array<unknown>): StampCall => {
        return call[0] as StampCall;
      })
      .filter((call: StampCall): boolean => {
        return call?.data?.nextEvaluationAt instanceof Date;
      });
  }

  async function expectOneStampFor(data: SloFields): Promise<void> {
    const before: number = Date.now();
    await callOnUpdateSuccess(makeOnUpdate(data), [SLO_ID]);
    const after: number = Date.now();

    const stamps: Array<StampCall> = stampCalls();

    expect(stamps).toHaveLength(1);
    expect(stamps[0]!.id).toEqual(SLO_ID);
    expect(stamps[0]!.props).toEqual({ isRoot: true });
    expect(stamps[0]!.data.nextEvaluationAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(stamps[0]!.data.nextEvaluationAt.getTime()).toBeLessThanOrEqual(
      after,
    );
  }

  beforeEach(() => {
    updateOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);

    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(
        makeSlo({ _id: SLO_ID.toString(), projectId: PROJECT_ID, name: "API" }),
      );

    jest.spyOn(ServiceLevelObjectiveService, "findBy").mockResolvedValue([]);

    jest
      .spyOn(
        ServiceLevelObjectiveService,
        "resolveOpenBurnRateAlertsAndIncidentsForSlo",
      )
      .mockResolvedValue(undefined);

    jest
      .spyOn(
        ServiceLevelObjectiveFeedService,
        "createServiceLevelObjectiveFeedItem",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const settingsFields: Array<{ label: string; data: SloFields }> = [
    {
      label: "the multi-monitor mode",
      data: { multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage },
    },
    {
      label: "the downtime monitor statuses",
      data: {
        downtimeMonitorStatuses: [{ _id: DOWNTIME_STATUS_ID.toString() }],
      },
    },
    {
      label: "the at-risk threshold",
      data: { atRiskThresholdPercentage: 35 },
    },
    {
      label: "the calendar-month timezone",
      data: { timezone: "Europe/Berlin" },
    },
  ];

  for (const settingsField of settingsFields) {
    it(`forces re-evaluation when ${settingsField.label} changes`, async () => {
      await expectOneStampFor(settingsField.data);
    });
  }

  /*
   * Both are real changes, not "nothing sent": an empty status list makes
   * the worker count every non-operational status, and a cleared timezone
   * moves calendar-month boundaries back to UTC.
   */
  it("forces re-evaluation when the downtime statuses are cleared to the default", async () => {
    await expectOneStampFor({ downtimeMonitorStatuses: [] });
  });

  it("forces re-evaluation when the timezone is cleared back to UTC", async () => {
    await expectOneStampFor({ timezone: null });
  });

  it("still forces re-evaluation for the objective's own inputs", async () => {
    await expectOneStampFor({ targetPercentage: 99.95 });
  });

  it("stamps once per SLO when a Settings card saves several of these columns together", async () => {
    await callOnUpdateSuccess(
      makeOnUpdate({
        multiMonitorMode: SloMultiMonitorMode.AnyDown,
        downtimeMonitorStatuses: [],
      }),
      [SLO_ID],
    );

    expect(stampCalls()).toHaveLength(1);
  });

  it("stamps every updated SLO, not just the first", async () => {
    await callOnUpdateSuccess(makeOnUpdate({ atRiskThresholdPercentage: 10 }), [
      SLO_ID,
      OTHER_SLO_ID,
    ]);

    expect(
      stampCalls().map((call: StampCall): string => {
        return call.id.toString();
      }),
    ).toEqual([SLO_ID.toString(), OTHER_SLO_ID.toString()]);
  });

  it.each([
    { label: "name", data: { name: "Checkout availability" } },
    { label: "description", data: { description: "A clearer description" } },
  ])(
    "does not force re-evaluation for a $label change the worker never reads",
    async ({ data }: { label: string; data: SloFields }) => {
      await callOnUpdateSuccess(makeOnUpdate(data), [SLO_ID]);

      expect(stampCalls()).toHaveLength(0);
    },
  );

  it("swallows a failed stamp instead of failing the Settings save", async () => {
    updateOneByIdSpy.mockRejectedValue(new Error("db down"));

    const onUpdate: OnUpdate<ServiceLevelObjective> = makeOnUpdate({
      downtimeMonitorStatuses: [],
    });

    await expect(callOnUpdateSuccess(onUpdate, [SLO_ID])).resolves.toBe(
      onUpdate,
    );
  });
});
