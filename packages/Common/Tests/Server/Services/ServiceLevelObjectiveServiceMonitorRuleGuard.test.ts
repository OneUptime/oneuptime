import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveMonitorRuleService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - the manual-add guard on ServiceLevelObjectiveService.
 *
 * While an SLO has at least one ENABLED monitor rule, its monitor list belongs
 * to those rules. The Monitors page disables its buttons, but a disabled
 * button is not enforcement - the API is. So onBeforeUpdate, for any caller
 * that is not root:
 *
 *   - refuses adding a monitor that is not already attached;
 *   - refuses removing a monitor a rule attached (it would be re-attached on
 *     the next sync, which reads as the edit silently failing);
 *   - allows removing a monitor attached by hand.
 *
 * Root writes pass untouched, because the rule engine writes `monitors` as
 * root and must never be refused by the guard that protects its own output.
 * The read that decides all this runs before the permission check, so it pins
 * the caller's tenant.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const MANUAL_MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const RULE_MONITOR_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const NEW_MONITOR_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

const MANAGED_BY_RULES_MESSAGE: string =
  "This SLO's monitors are managed by its monitor rules. Disable the rules to add monitors by hand.";

const RULE_ATTACHED_REMOVAL_MESSAGE: string =
  "A monitor rule attached this monitor, so removing it by hand would not stick: the rule would attach it again. Change or disable the rule to detach it.";

// Calls the protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(ServiceLevelObjectiveService, args);
}

function makeMonitor(id: ObjectID): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id.toString();
  return monitor;
}

function makeSlo(fields: {
  id?: ObjectID | undefined;
  monitors: Array<ObjectID>;
  autoAddedMonitors: Array<ObjectID>;
}): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = (fields.id || SLO_ID).toString();
  slo.monitors = fields.monitors.map(makeMonitor);
  slo.autoAddedMonitors = fields.autoAddedMonitors.map(makeMonitor);
  return slo;
}

function makeUpdateBy(
  monitors: unknown,
  props?: Record<string, unknown> | undefined,
): UpdateBy<ServiceLevelObjective> {
  return {
    query: { _id: SLO_ID.toString() },
    data: { monitors: monitors },
    props: props || { tenantId: PROJECT_ID, userId: USER_ID },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<ServiceLevelObjective>;
}

// `{ _id }` stubs, the shape the dashboard and the REST API send.
function stubs(ids: Array<ObjectID>): Array<{ _id: string }> {
  return ids.map((id: ObjectID) => {
    return { _id: id.toString() };
  });
}

describe("ServiceLevelObjectiveService.onBeforeUpdate - monitors managed by monitor rules", () => {
  let sloFindBySpy: jest.SpyInstance;
  let enabledRulesSpy: jest.SpyInstance;

  beforeEach(() => {
    /*
     * The SLO feed takes a before-snapshot in the same hook; it is covered by
     * its own tests and neutralised here so the only reads are the guard's.
     */
    const service: Record<string, unknown> =
      ServiceLevelObjectiveService as unknown as Record<string, unknown>;

    if (typeof service["readFeedSnapshotBeforeUpdate"] === "function") {
      jest
        .spyOn(
          ServiceLevelObjectiveService as never,
          "readFeedSnapshotBeforeUpdate" as never,
        )
        .mockResolvedValue(null as never);
    }

    sloFindBySpy = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([
        makeSlo({
          monitors: [MANUAL_MONITOR_ID, RULE_MONITOR_ID],
          autoAddedMonitors: [RULE_MONITOR_ID],
        }),
      ]);

    enabledRulesSpy = jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleService,
        "findServiceLevelObjectiveIdsWithEnabledRules",
      )
      .mockResolvedValue(new Set<string>([SLO_ID.toString()]));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses adding a monitor by hand while a rule is enabled", async () => {
    const promise: Promise<unknown> = callHook(
      "onBeforeUpdate",
      makeUpdateBy(stubs([MANUAL_MONITOR_ID, RULE_MONITOR_ID, NEW_MONITOR_ID])),
    );

    await expect(promise).rejects.toThrow(BadDataException);
    await expect(promise).rejects.toThrow(MANAGED_BY_RULES_MESSAGE);
  });

  it("lets a resubmit of the same monitor list through", async () => {
    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy(stubs([RULE_MONITOR_ID, MANUAL_MONITOR_ID])),
      ),
    ).resolves.toBeDefined();
  });

  it("lets a hand-attached monitor be removed", async () => {
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy(stubs([RULE_MONITOR_ID]))),
    ).resolves.toBeDefined();
  });

  it("refuses removing a monitor a rule attached - it would come straight back", async () => {
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy(stubs([MANUAL_MONITOR_ID]))),
    ).rejects.toThrow(RULE_ATTACHED_REMOVAL_MESSAGE);
  });

  it("refuses clearing the list when a rule-attached monitor is on it", async () => {
    await expect(callHook("onBeforeUpdate", makeUpdateBy([]))).rejects.toThrow(
      RULE_ATTACHED_REMOVAL_MESSAGE,
    );
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy(null)),
    ).rejects.toThrow(RULE_ATTACHED_REMOVAL_MESSAGE);
  });

  it("allows any hand edit once no rule is enabled", async () => {
    enabledRulesSpy.mockResolvedValue(new Set<string>());

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy(stubs([NEW_MONITOR_ID]))),
    ).resolves.toBeDefined();

    expect(enabledRulesSpy).toHaveBeenCalledTimes(1);
    expect(
      (enabledRulesSpy.mock.calls[0]![0] as Array<ObjectID>).map(
        (id: ObjectID) => {
          return id.toString();
        },
      ),
    ).toEqual([SLO_ID.toString()]);
  });

  it("lets root writes through without reading anything - the rule engine writes as root", async () => {
    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy(stubs([NEW_MONITOR_ID]), { isRoot: true }),
      ),
    ).resolves.toBeDefined();

    expect(enabledRulesSpy).not.toHaveBeenCalled();
    expect(
      sloFindBySpy.mock.calls.filter((call: Array<unknown>) => {
        return Boolean(
          (call[0] as { select: Record<string, unknown> }).select[
            "autoAddedMonitors"
          ],
        );
      }),
    ).toHaveLength(0);
  });

  it("reads nothing for an update that does not write monitors", async () => {
    await callHook("onBeforeUpdate", {
      ...makeUpdateBy(undefined),
      data: { name: "Renamed" },
    });

    expect(enabledRulesSpy).not.toHaveBeenCalled();
  });

  it("pins the caller's tenant onto the raw query before reading, and reads as root", async () => {
    await callHook(
      "onBeforeUpdate",
      makeUpdateBy(stubs([MANUAL_MONITOR_ID, RULE_MONITOR_ID])),
    );

    const guardRead: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: unknown;
    } = sloFindBySpy.mock.calls.find((call: Array<unknown>) => {
      return Boolean(
        (call[0] as { select: Record<string, unknown> }).select[
          "autoAddedMonitors"
        ],
      );
    })![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: unknown;
    };

    expect(guardRead.query).toEqual({
      _id: SLO_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(guardRead.select).toEqual({
      _id: true,
      monitors: { _id: true },
      autoAddedMonitors: { _id: true },
    });
    expect(guardRead.props).toEqual({ isRoot: true });
  });

  it("understands every shape a monitor list arrives in", async () => {
    const shapes: Array<unknown> = [
      [MANUAL_MONITOR_ID.toString(), RULE_MONITOR_ID.toString()],
      [
        { _id: MANUAL_MONITOR_ID.toString().toUpperCase() },
        { _id: RULE_MONITOR_ID.toString() },
      ],
      [MANUAL_MONITOR_ID, RULE_MONITOR_ID],
      [makeMonitor(MANUAL_MONITOR_ID), makeMonitor(RULE_MONITOR_ID)],
    ];

    for (const shape of shapes) {
      await expect(
        callHook("onBeforeUpdate", makeUpdateBy(shape)),
      ).resolves.toBeDefined();
    }

    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy([
          MANUAL_MONITOR_ID.toString(),
          RULE_MONITOR_ID.toString(),
          NEW_MONITOR_ID.toString().toUpperCase(),
        ]),
      ),
    ).rejects.toThrow(MANAGED_BY_RULES_MESSAGE);
  });

  it("asks no rule question when the query matches no SLO", async () => {
    sloFindBySpy.mockResolvedValue([]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy(stubs([NEW_MONITOR_ID]))),
    ).resolves.toBeDefined();
    expect(enabledRulesSpy).not.toHaveBeenCalled();
  });

  it("guards each SLO by its own rules", async () => {
    sloFindBySpy.mockResolvedValue([
      makeSlo({ id: SLO_ID, monitors: [], autoAddedMonitors: [] }),
      makeSlo({
        id: OTHER_SLO_ID,
        monitors: [NEW_MONITOR_ID],
        autoAddedMonitors: [],
      }),
    ]);

    // Only the SLO that already carries the monitor has a rule: nothing new for it.
    enabledRulesSpy.mockResolvedValue(
      new Set<string>([OTHER_SLO_ID.toString()]),
    );

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy(stubs([NEW_MONITOR_ID]))),
    ).resolves.toBeDefined();

    // The SLO without the monitor has the rule: that is an add.
    enabledRulesSpy.mockResolvedValue(new Set<string>([SLO_ID.toString()]));

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy(stubs([NEW_MONITOR_ID]))),
    ).rejects.toThrow(MANAGED_BY_RULES_MESSAGE);
  });

  it("does not treat a stale bookkeeping entry for an unattached monitor as a removal", async () => {
    sloFindBySpy.mockResolvedValue([
      makeSlo({
        monitors: [MANUAL_MONITOR_ID],
        autoAddedMonitors: [RULE_MONITOR_ID],
      }),
    ]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy(stubs([MANUAL_MONITOR_ID]))),
    ).resolves.toBeDefined();
  });
});
