import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import MonitorCriteriaReplaced, {
  WrittenMonitorTemplate,
} from "../../../Server/Utils/Monitor/MonitorCriteriaReplaced";
import MonitorTurnedOff from "../../../Server/Utils/Monitor/MonitorTurnedOff";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A WRITE THAT TAKES CRITERIA OFF A MONITOR RESOLVES WHAT THEY LEFT OPEN, ON
 * EVERY PATH THAT WRITES ITS STEPS (issue #11453).
 *
 * A template's Sync Criteria to Linked Monitors and Sync from Template, a
 * link or an unlink, a person's edit in the dashboard, the API, Terraform,
 * a workflow: all of them write the monitor's steps through MonitorService.
 * So MonitorService itself reads what each monitor's criteria were before
 * the write - only those of a monitor holding a criteria that resolves its
 * own incidents or alerts - and once the write is saved hands each to
 * MonitorCriteriaReplaced.resolveAfterWrite, which resolves what the
 * criteria the write took off would have resolved on their own.
 *
 * What onBeforeUpdate carries (getCriteriaChangeCarry), and what
 * onUpdateSuccess does with it, are both run here for real; the database,
 * the feed and the resolve itself are stubbed. The whole path - every one
 * of those writes, on a migrated Postgres - is
 * MonitorCriteriaRemovedPostgres.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-0e0e-4aaa-8bbb-000000000002");
const TEMPLATE_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-000000000003",
);
const CHECKOUT: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a1";
const SEARCH: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a2";
const BY_HAND: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a3";

function stepsWith(
  criteria: Array<{ id: string; resolves: boolean }>,
): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.data!.id = "step-1";
  step.data!.monitorCriteria.data = {
    monitorCriteriaInstanceArray: criteria.map(
      (entry: { id: string; resolves: boolean }): MonitorCriteriaInstance => {
        const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
        instance.data!.id = entry.id;
        instance.data!.name = entry.id;
        instance.data!.incidents = [
          {
            id: `${entry.id}-incident`,
            title: "Down",
            description: "",
            autoResolveIncident: entry.resolves,
          },
        ];
        return instance;
      },
    ),
  };

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = { monitorStepsInstanceArray: [step] };
  return steps;
}

function monitorRow(data: {
  id: string;
  name: string;
  steps: MonitorSteps | null;
  monitorTemplateId?: ObjectID | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(new ObjectID(data.id));
  monitor.projectId = PROJECT_ID;
  monitor.name = data.name;

  if (data.steps) {
    monitor.monitorSteps = data.steps;
  }

  if (data.monitorTemplateId) {
    monitor.monitorTemplateId = data.monitorTemplateId;
  }

  return monitor;
}

type CriteriaChangeCarry = {
  stepsWritten: MonitorSteps | null;
  writtenTemplate: WrittenMonitorTemplate;
  before: Dictionary<{
    name: string;
    monitorSteps: MonitorSteps | null;
    monitorTemplateId: string | null;
  }>;
};

const service: {
  getCriteriaChangeCarry: (data: {
    monitors: Array<Monitor>;
    stepsWritten: MonitorSteps | null | undefined;
    writtenTemplate: WrittenMonitorTemplate;
  }) => CriteriaChangeCarry | null;
  onUpdateSuccess: (
    onUpdate: OnUpdate<Monitor>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<Monitor>>;
} = MonitorService as unknown as {
  getCriteriaChangeCarry: (data: {
    monitors: Array<Monitor>;
    stepsWritten: MonitorSteps | null | undefined;
    writtenTemplate: WrittenMonitorTemplate;
  }) => CriteriaChangeCarry | null;
  onUpdateSuccess: (
    onUpdate: OnUpdate<Monitor>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<Monitor>>;
};

const UNCHANGED_TEMPLATE: WrittenMonitorTemplate = {
  isWritten: false,
  id: null,
};

let resolves: MockFunction;
let turnedOff: MockFunction;
let templateReads: MockFunction;
let errors: MockFunction;
let order: Array<string>;

beforeEach(() => {
  order = [];

  jest.spyOn(MonitorService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Monitor | null> => {
    const monitor: Monitor = new Monitor(data.id);
    monitor.projectId = PROJECT_ID;
    monitor.name = "A monitor";
    return monitor;
  }) as never);
  jest
    .spyOn(MonitorService, "getMonitorLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/monitor") as never,
    );
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorProbeService, "pruneStaleLastMonitoringLogEntries")
    .mockResolvedValue(undefined as never);

  resolves = getJestMockFunction();
  resolves.mockImplementation((async (): Promise<unknown> => {
    order.push("criteria");
    return { resolvedIncidentIds: ["incident-1"], resolvedAlertIds: [] };
  }) as never);
  jest
    .spyOn(MonitorCriteriaReplaced, "resolveAfterWrite")
    .mockImplementation(resolves as never);

  turnedOff = getJestMockFunction();
  turnedOff.mockImplementation((async (): Promise<unknown> => {
    order.push("turned off");
    return { resolvedIncidentIds: [], resolvedAlertIds: [] };
  }) as never);
  jest
    .spyOn(MonitorTurnedOff, "resolveWhatItWouldHaveResolved")
    .mockImplementation(turnedOff as never);

  templateReads = getJestMockFunction();
  templateReads.mockImplementation((async (): Promise<MonitorTemplate> => {
    const template: MonitorTemplate = new MonitorTemplate(TEMPLATE_ID);
    template.templateName = "Production API Health";
    return template;
  }) as never);
  jest
    .spyOn(MonitorTemplateService, "findOneById")
    .mockImplementation(templateReads as never);

  errors = getJestMockFunction();
  jest.spyOn(logger, "error").mockImplementation(errors as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what onBeforeUpdate carries for a write of steps", () => {
  test("each monitor that holds a criteria resolving its own records, with its name, steps and template", () => {
    const checkoutSteps: MonitorSteps = stepsWith([
      { id: "slow", resolves: true },
    ]);
    const carry: CriteriaChangeCarry | null = service.getCriteriaChangeCarry({
      monitors: [
        monitorRow({
          id: CHECKOUT,
          name: "Checkout API",
          steps: checkoutSteps,
          monitorTemplateId: TEMPLATE_ID,
        }),
        monitorRow({
          id: BY_HAND,
          name: "Billing API",
          steps: stepsWith([{ id: "manual", resolves: false }]),
        }),
        monitorRow({ id: SEARCH, name: "Search API", steps: null }),
      ],
      stepsWritten: stepsWith([{ id: "down", resolves: true }]),
      writtenTemplate: UNCHANGED_TEMPLATE,
    });

    expect(Object.keys(carry!.before)).toEqual([CHECKOUT]);
    expect(carry!.before[CHECKOUT]!.name).toBe("Checkout API");
    expect(carry!.before[CHECKOUT]!.monitorTemplateId).toBe(
      TEMPLATE_ID.toString(),
    );
    expect(
      carry!.before[
        CHECKOUT
      ]!.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.map(
        (criteria: MonitorCriteriaInstance): string | undefined => {
          return criteria.data?.id;
        },
      ),
    ).toEqual(["slow"]);
    expect(carry!.writtenTemplate).toEqual(UNCHANGED_TEMPLATE);
  });

  test("nothing when no monitor it writes holds one: a monitor whose incidents a person resolves keeps them", () => {
    expect(
      service.getCriteriaChangeCarry({
        monitors: [
          monitorRow({
            id: BY_HAND,
            name: "Billing API",
            steps: stepsWith([{ id: "manual", resolves: false }]),
          }),
          monitorRow({ id: SEARCH, name: "Search API", steps: null }),
        ],
        stepsWritten: stepsWith([]),
        writtenTemplate: UNCHANGED_TEMPLATE,
      }),
    ).toBeNull();
  });

  test("a write that clears the steps carries none written: every criteria goes", () => {
    const carry: CriteriaChangeCarry | null = service.getCriteriaChangeCarry({
      monitors: [
        monitorRow({
          id: CHECKOUT,
          name: "Checkout API",
          steps: stepsWith([{ id: "slow", resolves: true }]),
        }),
      ],
      stepsWritten: null,
      writtenTemplate: UNCHANGED_TEMPLATE,
    });

    expect(carry!.stepsWritten).toBeNull();
  });

  test("steps written as JSON, as the API sends them, are read as steps", () => {
    const carry: CriteriaChangeCarry | null = service.getCriteriaChangeCarry({
      monitors: [
        monitorRow({
          id: CHECKOUT,
          name: "Checkout API",
          steps: stepsWith([{ id: "slow", resolves: true }]),
        }),
      ],
      stepsWritten: stepsWith([
        { id: "down", resolves: true },
      ]).toJSON() as unknown as MonitorSteps,
      writtenTemplate: UNCHANGED_TEMPLATE,
    });

    expect(carry!.stepsWritten).toBeInstanceOf(MonitorSteps);
  });
});

// The update as DatabaseService runs onUpdateSuccess, with a carry of its own.
async function runUpdateSuccess(data: {
  carry: CriteriaChangeCarry | null;
  updatedIds: Array<string>;
  props?: DatabaseCommonInteractionProps;
  writes?: Dictionary<unknown>;
  turnedOffIds?: Array<string>;
}): Promise<void> {
  const updateBy: UpdateBy<Monitor> = {
    query: {},
    data: (data.writes || {
      monitorSteps: data.carry?.stepsWritten,
    }) as UpdateBy<Monitor>["data"],
    props: data.props || { userId: USER_ID, tenantId: PROJECT_ID },
    limit: 100,
    skip: 0,
  };

  await service.onUpdateSuccess(
    {
      updateBy: updateBy,
      carryForward: {
        ...(data.carry ? { criteriaChange: data.carry } : {}),
        ...(data.turnedOffIds
          ? { monitorIdsTurnedOff: data.turnedOffIds }
          : {}),
      },
    },
    data.updatedIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

function carryOf(data: {
  monitors: Array<Monitor>;
  written: MonitorSteps | null;
  writtenTemplate?: WrittenMonitorTemplate;
}): CriteriaChangeCarry {
  return service.getCriteriaChangeCarry({
    monitors: data.monitors,
    stepsWritten: data.written,
    writtenTemplate: data.writtenTemplate || UNCHANGED_TEMPLATE,
  })!;
}

interface Asked {
  monitorId: string;
  monitorName: string;
  stepsAfter: MonitorSteps | null;
  templateIdBefore: string | null;
  writtenTemplate: WrittenMonitorTemplate;
  changedByUserId: string | undefined;
}

function asked(): Array<Asked> {
  return resolves.mock.calls.map((call: Array<unknown>): Asked => {
    const data: Parameters<
      typeof MonitorCriteriaReplaced.resolveAfterWrite
    >[0] = call[0] as Parameters<
      typeof MonitorCriteriaReplaced.resolveAfterWrite
    >[0];

    return {
      monitorId: data.monitorId.toString(),
      monitorName: data.monitorName,
      stepsAfter: (data.stepsAfter as MonitorSteps | null) || null,
      templateIdBefore: data.templateIdBefore
        ? data.templateIdBefore.toString()
        : null,
      writtenTemplate: data.writtenTemplate,
      changedByUserId: data.changedByUserId?.toString(),
    };
  });
}

describe("what onUpdateSuccess resolves once the write is saved", () => {
  test("each monitor carried, with the steps written, its template before, and who made the write", async () => {
    const written: MonitorSteps = stepsWith([{ id: "down", resolves: true }]);

    await runUpdateSuccess({
      carry: carryOf({
        monitors: [
          monitorRow({
            id: CHECKOUT,
            name: "Checkout API",
            steps: stepsWith([{ id: "slow", resolves: true }]),
            monitorTemplateId: TEMPLATE_ID,
          }),
          monitorRow({
            id: SEARCH,
            name: "Search API",
            steps: stepsWith([{ id: "slow", resolves: true }]),
          }),
        ],
        written: written,
      }),
      updatedIds: [CHECKOUT, SEARCH],
    });

    expect(asked()).toEqual([
      {
        monitorId: CHECKOUT,
        monitorName: "Checkout API",
        stepsAfter: expect.any(MonitorSteps),
        templateIdBefore: TEMPLATE_ID.toString(),
        writtenTemplate: UNCHANGED_TEMPLATE,
        changedByUserId: USER_ID.toString(),
      },
      {
        monitorId: SEARCH,
        monitorName: "Search API",
        stepsAfter: expect.any(MonitorSteps),
        templateIdBefore: null,
        writtenTemplate: UNCHANGED_TEMPLATE,
        changedByUserId: USER_ID.toString(),
      },
    ]);
  });

  test("a monitor the write did not reach - not saved, or not carried - is not asked about", async () => {
    await runUpdateSuccess({
      carry: carryOf({
        monitors: [
          monitorRow({
            id: CHECKOUT,
            name: "Checkout API",
            steps: stepsWith([{ id: "slow", resolves: true }]),
          }),
          monitorRow({
            id: SEARCH,
            name: "Search API",
            steps: stepsWith([{ id: "slow", resolves: true }]),
          }),
        ],
        written: stepsWith([]),
      }),
      // Search API's row was not saved; Billing API was never carried.
      updatedIds: [CHECKOUT, BY_HAND],
    });

    expect(
      asked().map((entry: Asked): string => {
        return entry.monitorId;
      }),
    ).toEqual([CHECKOUT]);
  });

  test("a write OneUptime makes for nobody names nobody", async () => {
    await runUpdateSuccess({
      carry: carryOf({
        monitors: [
          monitorRow({
            id: CHECKOUT,
            name: "Checkout API",
            steps: stepsWith([{ id: "slow", resolves: true }]),
          }),
        ],
        written: stepsWith([]),
      }),
      updatedIds: [CHECKOUT],
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(asked()[0]!.changedByUserId).toBeUndefined();
  });

  test("hands on the template the write wrote, for a link or an unlink", async () => {
    const writtenTemplate: WrittenMonitorTemplate = {
      isWritten: true,
      id: TEMPLATE_ID,
    };

    await runUpdateSuccess({
      carry: carryOf({
        monitors: [
          monitorRow({
            id: CHECKOUT,
            name: "Checkout API",
            steps: stepsWith([{ id: "slow", resolves: true }]),
          }),
        ],
        written: stepsWith([]),
        writtenTemplate: writtenTemplate,
      }),
      updatedIds: [CHECKOUT],
    });

    expect(asked()[0]!.writtenTemplate).toEqual(writtenTemplate);
  });

  test("reads a template's name once for every monitor the write took criteria off", async () => {
    resolves.mockImplementation((async (data: {
      readTemplateName: (id: ObjectID) => Promise<string>;
    }): Promise<unknown> => {
      expect(await data.readTemplateName(TEMPLATE_ID)).toBe(
        "Production API Health",
      );
      return { resolvedIncidentIds: [], resolvedAlertIds: [] };
    }) as never);

    await runUpdateSuccess({
      carry: carryOf({
        monitors: [
          monitorRow({
            id: CHECKOUT,
            name: "Checkout API",
            steps: stepsWith([{ id: "slow", resolves: true }]),
          }),
          monitorRow({
            id: SEARCH,
            name: "Search API",
            steps: stepsWith([{ id: "slow", resolves: true }]),
          }),
        ],
        written: stepsWith([]),
      }),
      updatedIds: [CHECKOUT, SEARCH],
    });

    expect(resolves).toHaveBeenCalledTimes(2);
    expect(templateReads).toHaveBeenCalledTimes(1);
  });

  test("a resolve that fails is logged and never fails the save: the next monitor is still resolved", async () => {
    resolves.mockRejectedValueOnce(new Error("Postgres went away") as never);

    await expect(
      runUpdateSuccess({
        carry: carryOf({
          monitors: [
            monitorRow({
              id: CHECKOUT,
              name: "Checkout API",
              steps: stepsWith([{ id: "slow", resolves: true }]),
            }),
            monitorRow({
              id: SEARCH,
              name: "Search API",
              steps: stepsWith([{ id: "slow", resolves: true }]),
            }),
          ],
          written: stepsWith([]),
        }),
        updatedIds: [CHECKOUT, SEARCH],
      }),
    ).resolves.toBeUndefined();

    expect(resolves).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalled();
  });

  test("runs before turning monitoring off resolves what the kept criteria would have", async () => {
    await runUpdateSuccess({
      carry: carryOf({
        monitors: [
          monitorRow({
            id: CHECKOUT,
            name: "Checkout API",
            steps: stepsWith([{ id: "slow", resolves: true }]),
          }),
        ],
        written: stepsWith([{ id: "down", resolves: true }]),
      }),
      writes: {
        monitorSteps: stepsWith([{ id: "down", resolves: true }]),
        disableActiveMonitoring: true,
      },
      updatedIds: [CHECKOUT],
      turnedOffIds: [CHECKOUT],
    });

    expect(order).toEqual(["criteria", "turned off"]);
  });

  test("an update with nothing carried asks nothing", async () => {
    await runUpdateSuccess({
      carry: null,
      writes: { name: "Renamed" },
      updatedIds: [CHECKOUT],
    });

    expect(resolves).not.toHaveBeenCalled();
  });
});
