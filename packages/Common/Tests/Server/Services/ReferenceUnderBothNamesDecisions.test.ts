import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import { StartingStage } from "../../../Utils/StartingStage";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import UserService from "../../../Server/Services/UserService";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * What a service does with a reference, not only whether it lets it in:
 * the state a record starts in, the template values it fills in, the state
 * change or severity change an update triggers, who a record is "created
 * by". Each reads the reference under both of its names - a write may use
 * either - and a value the service decides is written under the ID column
 * alone (RelationIdUtil.stamp), so a relation the write sent beside it is
 * not what TypeORM stores (RelationNamePrecedence.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dec1-4aaa-8bbb-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-dec1-4aaa-8bbb-0000000000d1",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-dec1-4aaa-8bbb-0000000000e1");
const OTHER_USER_ID: string = "0193c0de-dec1-4aaa-8bbb-0000000000e2";

// The state each kind of record starts in, and another of the project's.
const CREATED_STATE: string = "0193c0de-dec1-4aaa-8bbb-0000000000a1";
const OTHER_STATE: string = "0193c0de-dec1-4aaa-8bbb-0000000000a2";

const SEVERITY: string = "0193c0de-dec1-4aaa-8bbb-0000000000b1";
// The severity a record held before an update changed it.
const PREVIOUS_SEVERITY: string = "0193c0de-dec1-4aaa-8bbb-0000000000b3";
const TEMPLATE_SEVERITY: string = "0193c0de-dec1-4aaa-8bbb-0000000000b2";
const STATUS: string = "0193c0de-dec1-4aaa-8bbb-0000000000c1";
const TEMPLATE_STATUS: string = "0193c0de-dec1-4aaa-8bbb-0000000000c2";
const TEMPLATE_ID: string = "0193c0de-dec1-4aaa-8bbb-0000000000f1";

// Thrown by the first step after the one under test.
class PastTheStep extends Error {}

function row<T extends { _id?: string | undefined }>(
  ctor: new () => T,
  id: string,
): T {
  const record: T = new ctor();
  record._id = id;
  return record;
}

function hooksOf(
  service: unknown,
): Record<string, (...args: Array<unknown>) => Promise<unknown>> {
  return service as Record<
    string,
    (...args: Array<unknown>) => Promise<unknown>
  >;
}

async function outcomeOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
    return "went on";
  } catch (error) {
    return error;
  }
}

function has(data: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

beforeEach(() => {
  // Every record named here is the project's own.
  stubProjectDirectory({});

  jest
    .spyOn(IncidentStateService, "findOneBy")
    .mockResolvedValue(row(IncidentState, CREATED_STATE) as never);
  jest
    .spyOn(AlertStateService, "findOneBy")
    .mockResolvedValue(row(AlertState, CREATED_STATE) as never);
  jest
    .spyOn(ScheduledMaintenanceStateService, "findOneBy")
    .mockResolvedValue(row(ScheduledMaintenanceState, CREATED_STATE) as never);

  /*
   * Where a record starts among the project's states decides what its
   * create sets off (StartingStage), not which name of the state is kept:
   * open here.
   */
  jest
    .spyOn(IncidentStateService, "getStartingStage")
    .mockResolvedValue(StartingStage.Open as never);
  jest
    .spyOn(AlertStateService, "getStartingStage")
    .mockResolvedValue(StartingStage.Open as never);

  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * An alert and both kinds of episode start in the state the write picks -
 * their create forms offer an Initial State - or, with none picked, in the
 * project's created state. A scheduled maintenance event always starts in
 * the project's scheduled state: its state follows its schedule, and its
 * form offers none. Either way the state is written under the ID column
 * alone, so a relation sent beside it is not what TypeORM stores.
 */
describe("the state a record starts in is the one the service stamps", () => {
  interface StartingStateCase {
    name: string;
    service: unknown;
    relation: string;
    idColumn: string;
    // Whether the state the write names is where the record starts.
    startsInPickedState: boolean;
    // The step right after the stamp, stopped there.
    stopAfterStamp: () => void;
    newRecord: () => Record<string, unknown>;
  }

  const CASES: Array<StartingStateCase> = [
    {
      name: "alert",
      service: AlertService,
      relation: "currentAlertState",
      idColumn: "currentAlertStateId",
      startsInPickedState: true,
      stopAfterStamp: () => {
        jest
          .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
          .mockResolvedValue(undefined as never);
        jest
          .spyOn(ProjectService, "incrementAndGetAlertCounter")
          .mockRejectedValue(new PastTheStep() as never);
      },
      newRecord: () => {
        return { title: "Disk is full" };
      },
    },
    {
      name: "scheduled maintenance event",
      service: ScheduledMaintenanceService,
      relation: "currentScheduledMaintenanceState",
      idColumn: "currentScheduledMaintenanceStateId",
      startsInPickedState: false,
      stopAfterStamp: () => {
        jest
          .spyOn(ProjectService, "incrementAndGetScheduledMaintenanceCounter")
          .mockRejectedValue(new PastTheStep() as never);
      },
      newRecord: () => {
        return { title: "Database upgrade" };
      },
    },
    {
      name: "incident episode",
      service: IncidentEpisodeService,
      relation: "currentIncidentState",
      idColumn: "currentIncidentStateId",
      startsInPickedState: true,
      stopAfterStamp: () => {
        jest
          .spyOn(ProjectService, "incrementAndGetIncidentEpisodeCounter")
          .mockRejectedValue(new PastTheStep() as never);
      },
      newRecord: () => {
        return { title: "Checkout errors" };
      },
    },
    {
      name: "alert episode",
      service: AlertEpisodeService,
      relation: "currentAlertState",
      idColumn: "currentAlertStateId",
      startsInPickedState: true,
      stopAfterStamp: () => {
        jest
          .spyOn(ProjectService, "incrementAndGetAlertEpisodeCounter")
          .mockRejectedValue(new PastTheStep() as never);
      },
      newRecord: () => {
        return { title: "Disk alerts" };
      },
    },
  ];

  // Where a record whose write named OTHER_STATE starts.
  function startingStateOf(testCase: StartingStateCase): string {
    return testCase.startsInPickedState ? OTHER_STATE : CREATED_STATE;
  }

  test.each(CASES)(
    "$name: a state the write named under the relation is stored under the ID column alone, where the record may start in it",
    async (testCase: StartingStateCase) => {
      testCase.stopAfterStamp();

      const data: Record<string, unknown> = {
        ...testCase.newRecord(),
        [testCase.relation]: { _id: OTHER_STATE },
      };

      expect(
        await outcomeOf(
          hooksOf(testCase.service)["onBeforeCreate"]!({
            data: data,
            props: { tenantId: PROJECT_ID },
          }),
        ),
      ).toBeInstanceOf(PastTheStep);

      expect(String(data[testCase.idColumn])).toBe(startingStateOf(testCase));
      expect(has(data, testCase.relation)).toBe(false);
    },
  );

  test.each(CASES)(
    "$name: a state written under the ID column is decided the same way",
    async (testCase: StartingStateCase) => {
      testCase.stopAfterStamp();

      const data: Record<string, unknown> = {
        ...testCase.newRecord(),
        [testCase.idColumn]: new ObjectID(OTHER_STATE),
      };

      await outcomeOf(
        hooksOf(testCase.service)["onBeforeCreate"]!({
          data: data,
          props: { tenantId: PROJECT_ID },
        }),
      );

      expect(String(data[testCase.idColumn])).toBe(startingStateOf(testCase));
    },
  );

  test.each(CASES)(
    "$name: with no state named, it starts in the project's starting state",
    async (testCase: StartingStateCase) => {
      testCase.stopAfterStamp();

      const data: Record<string, unknown> = testCase.newRecord();

      expect(
        await outcomeOf(
          hooksOf(testCase.service)["onBeforeCreate"]!({
            data: data,
            props: { tenantId: PROJECT_ID },
          }),
        ),
      ).toBeInstanceOf(PastTheStep);

      expect(String(data[testCase.idColumn])).toBe(CREATED_STATE);
      expect(has(data, testCase.relation)).toBe(false);
    },
  );
});

describe("declaring an incident", () => {
  // The last step of the create hook, stopped there.
  function stopAtTheEnd(): void {
    jest
      .spyOn(ProjectService, "incrementAndGetIncidentCounter")
      .mockResolvedValue({ counter: 7, prefix: undefined } as never);
    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
      .mockRejectedValue(new PastTheStep() as never);
  }

  async function declare(
    data: Record<string, unknown>,
    props: Record<string, unknown> = { tenantId: PROJECT_ID },
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      title: "Payments are down",
      ...data,
    };

    expect(
      await outcomeOf(
        hooksOf(IncidentService)["onBeforeCreate"]!({
          data: payload,
          props: props,
        }),
      ),
    ).toBeInstanceOf(PastTheStep);

    return payload;
  }

  test("a state picked under the relation is where the incident starts, written under the ID column alone", async () => {
    stopAtTheEnd();

    const data: Record<string, unknown> = await declare({
      currentIncidentState: { _id: OTHER_STATE },
    });

    expect(String(data["currentIncidentStateId"])).toBe(OTHER_STATE);
    expect(has(data, "currentIncidentState")).toBe(false);
  });

  test("with no state picked the incident starts in the project's created state", async () => {
    stopAtTheEnd();

    const data: Record<string, unknown> = await declare({});

    expect(String(data["currentIncidentStateId"])).toBe(CREATED_STATE);
  });

  test("a state picked under two names that disagree is refused", async () => {
    stopAtTheEnd();

    const outcome: unknown = await outcomeOf(
      hooksOf(IncidentService)["onBeforeCreate"]!({
        data: {
          title: "Payments are down",
          currentIncidentStateId: new ObjectID(CREATED_STATE),
          currentIncidentState: { _id: OTHER_STATE },
        },
        props: { tenantId: PROJECT_ID },
      }),
    );

    expect(outcome).toBeInstanceOf(BadDataException);
    expect((outcome as Error).message).toContain(
      "currentIncidentStateId and currentIncidentState are names for the same field",
    );
  });

  describe("from a template", () => {
    beforeEach(() => {
      const template: IncidentTemplate = new IncidentTemplate();
      template._id = TEMPLATE_ID;
      template.incidentSeverityId = new ObjectID(TEMPLATE_SEVERITY);
      template.changeMonitorStatusToId = new ObjectID(TEMPLATE_STATUS);

      jest
        .spyOn(IncidentTemplateService, "findOneBy")
        .mockResolvedValue(template as never);
    });

    test("fills in the severity and the monitor status the caller left out", async () => {
      stopAtTheEnd();

      const data: Record<string, unknown> = await declare({
        createdIncidentTemplateId: new ObjectID(TEMPLATE_ID),
      });

      expect(String(data["incidentSeverityId"])).toBe(TEMPLATE_SEVERITY);
      expect(String(data["changeMonitorStatusToId"])).toBe(TEMPLATE_STATUS);
    });

    test("is applied when the template is named under the relation", async () => {
      stopAtTheEnd();

      const data: Record<string, unknown> = await declare({
        createdIncidentTemplate: { _id: TEMPLATE_ID },
      });

      expect(String(data["incidentSeverityId"])).toBe(TEMPLATE_SEVERITY);
    });

    test("leaves the severity and the monitor status the caller sent under the relation", async () => {
      stopAtTheEnd();

      const data: Record<string, unknown> = await declare({
        createdIncidentTemplateId: new ObjectID(TEMPLATE_ID),
        incidentSeverity: { _id: SEVERITY },
        changeMonitorStatusTo: { _id: STATUS },
      });

      // The caller's, and no template value beside them to disagree with.
      expect(data["incidentSeverity"]).toEqual({ _id: SEVERITY });
      expect(data["changeMonitorStatusTo"]).toEqual({ _id: STATUS });
      expect(data["incidentSeverityId"]).toBeUndefined();
      expect(data["changeMonitorStatusToId"]).toBeUndefined();
    });

    test("leaves a monitor status the caller cleared under the relation", async () => {
      stopAtTheEnd();

      const data: Record<string, unknown> = await declare({
        createdIncidentTemplateId: new ObjectID(TEMPLATE_ID),
        changeMonitorStatusTo: null,
      });

      expect(data["changeMonitorStatusTo"]).toBeNull();
      expect(data["changeMonitorStatusToId"]).toBeUndefined();
    });
  });

  describe("the root cause names who declared it", () => {
    beforeEach(() => {
      jest
        .spyOn(UserService, "getUserMarkdownString")
        .mockImplementation((async (data: { userId: ObjectID }) => {
          return `user ${data.userId.toString()}`;
        }) as never);
    });

    test("the person making the request", async () => {
      stopAtTheEnd();

      const data: Record<string, unknown> = await declare(
        { createdByUserId: new ObjectID(OTHER_USER_ID) },
        { tenantId: PROJECT_ID, userId: USER_ID },
      );

      expect(data["rootCause"]).toBe(
        `Incident created by user ${USER_ID.toString()}`,
      );
    });

    test("with no person on the request, the creator the write names under the relation", async () => {
      stopAtTheEnd();

      const data: Record<string, unknown> = await declare(
        { createdByUser: { _id: OTHER_USER_ID } },
        { isRoot: true, tenantId: PROJECT_ID },
      );

      expect(data["rootCause"]).toBe(
        `Incident created by user ${OTHER_USER_ID}`,
      );
    });
  });
});

describe("an update that writes a state changes the state, under either name", () => {
  interface StateChangeCase {
    name: string;
    service: unknown;
    relation: string;
    idColumn: string;
    method: string;
    // The state id the state change was asked for.
    stateOf: (call: Array<unknown>) => string;
  }

  const CASES: Array<StateChangeCase> = [
    {
      name: "incident",
      service: IncidentService,
      relation: "currentIncidentState",
      idColumn: "currentIncidentStateId",
      method: "changeIncidentState",
      stateOf: (call: Array<unknown>): string => {
        return String(
          (call[0] as { incidentStateId: unknown }).incidentStateId,
        );
      },
    },
    {
      name: "alert",
      service: AlertService,
      relation: "currentAlertState",
      idColumn: "currentAlertStateId",
      method: "changeAlertState",
      stateOf: (call: Array<unknown>): string => {
        return String((call[0] as { alertStateId: unknown }).alertStateId);
      },
    },
    {
      name: "scheduled maintenance event",
      service: ScheduledMaintenanceService,
      relation: "currentScheduledMaintenanceState",
      idColumn: "currentScheduledMaintenanceStateId",
      method: "changeScheduledMaintenanceState",
      stateOf: (call: Array<unknown>): string => {
        return String(
          (call[0] as { scheduledMaintenanceStateId: unknown })
            .scheduledMaintenanceStateId,
        );
      },
    },
    {
      name: "alert episode",
      service: AlertEpisodeService,
      relation: "currentAlertState",
      idColumn: "currentAlertStateId",
      method: "changeEpisodeState",
      stateOf: (call: Array<unknown>): string => {
        return String((call[0] as { alertStateId: unknown }).alertStateId);
      },
    },
    {
      name: "monitor",
      service: MonitorService,
      relation: "currentMonitorStatus",
      idColumn: "currentMonitorStatusId",
      method: "changeMonitorStatus",
      stateOf: (call: Array<unknown>): string => {
        return String(call[2]);
      },
    },
  ];

  function spyOnStateChange(testCase: StateChangeCase): jest.Mock {
    const change: jest.Mock = jest.fn(async () => {
      // The state change is the step under test: stop right after it.
      throw new PastTheStep();
    }) as unknown as jest.Mock;

    jest
      .spyOn(
        testCase.service as Record<string, () => Promise<unknown>>,
        testCase.method,
      )
      .mockImplementation(change as never);

    return change;
  }

  function onUpdateSuccess(
    testCase: StateChangeCase,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return outcomeOf(
      hooksOf(testCase.service)["onUpdateSuccess"]!(
        {
          updateBy: {
            query: { _id: RECORD_ID.toString() },
            data: data,
            props: { tenantId: PROJECT_ID, userId: USER_ID },
          },
          carryForward: null,
        },
        [RECORD_ID],
      ),
    );
  }

  test.each(CASES)(
    "$name: a state written under the relation",
    async (testCase: StateChangeCase) => {
      const change: jest.Mock = spyOnStateChange(testCase);

      expect(
        await onUpdateSuccess(testCase, {
          [testCase.relation]: { _id: OTHER_STATE },
        }),
      ).toBeInstanceOf(PastTheStep);

      expect(change).toHaveBeenCalledTimes(1);
      expect(testCase.stateOf(change.mock.calls[0] as Array<unknown>)).toBe(
        OTHER_STATE,
      );
    },
  );

  test.each(CASES)(
    "$name: a state written under the ID column",
    async (testCase: StateChangeCase) => {
      const change: jest.Mock = spyOnStateChange(testCase);

      await onUpdateSuccess(testCase, {
        [testCase.idColumn]: new ObjectID(OTHER_STATE),
      });

      expect(change).toHaveBeenCalledTimes(1);
      expect(testCase.stateOf(change.mock.calls[0] as Array<unknown>)).toBe(
        OTHER_STATE,
      );
    },
  );
});

/*
 * The severity's feed entry, SLA recalculation, reminder refresh and metric
 * follow a severity change written under either name - the relation the
 * dashboard's forms send, or the ID column the API, Terraform, workflows and
 * the AI tools send - against the severity the incident held before the
 * write, which onBeforeUpdate hands over (SeverityChangeSideEffects.test.ts
 * runs both hooks). The id they act on is the stored one.
 */
describe("an incident update records a severity change written under either name", () => {
  interface SeverityEffects {
    severityLookup: jest.Mock;
    recalculate: jest.Mock;
    feed: jest.Mock;
  }

  function spyOnSeverityEffects(): SeverityEffects {
    const incident: Incident = new Incident();
    incident._id = RECORD_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.incidentNumber = 7;

    const severity: IncidentSeverity = row(IncidentSeverity, SEVERITY);
    severity.name = "Critical";

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/i") as never);
    jest
      .spyOn(IncidentService, "refreshReminderSchedule")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "getIncidentMetricContext")
      .mockRejectedValue(new Error("no metrics here") as never);

    return {
      severityLookup: jest
        .spyOn(IncidentSeverityService, "findOneBy")
        .mockResolvedValue(severity as never) as unknown as jest.Mock,
      recalculate: jest
        .spyOn(IncidentSlaService, "recalculateDeadlines")
        .mockResolvedValue(undefined as never) as unknown as jest.Mock,
      feed: jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined as never) as unknown as jest.Mock,
    };
  }

  // The update, with the severity the incident held before it.
  async function runUpdate(
    data: Record<string, unknown>,
    severityBeforeUpdate: string = PREVIOUS_SEVERITY,
  ): Promise<void> {
    await hooksOf(IncidentService)["onUpdateSuccess"]!(
      {
        updateBy: {
          query: { _id: RECORD_ID.toString() },
          data: data,
          props: { tenantId: PROJECT_ID, userId: USER_ID },
        },
        carryForward: {
          [RECORD_ID.toString()]: {
            monitorsRemoved: [],
            monitorsAdded: [],
            oldChangeMonitorStatusIdTo: undefined,
            newMonitorChangeStatusIdTo: undefined,
            severityIdBeforeUpdate: severityBeforeUpdate,
          },
        },
      },
      [RECORD_ID],
    );
  }

  test.each([
    ["the relation alone", { incidentSeverity: { _id: SEVERITY } }],
    [
      "the ID column alone, as the API, Terraform and workflows write it",
      { incidentSeverityId: new ObjectID(SEVERITY) },
    ],
    [
      "both names, holding the same id",
      {
        incidentSeverityId: new ObjectID(SEVERITY),
        incidentSeverity: { _id: SEVERITY },
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "%s: the feed names the severity, and the SLA deadlines follow it",
    async (_label: string, data: Record<string, unknown>) => {
      const effects: SeverityEffects = spyOnSeverityEffects();

      await runUpdate(data);

      expect(
        String(
          (
            effects.severityLookup.mock.calls[0]![0] as {
              query: { _id: unknown };
            }
          ).query._id,
        ),
      ).toBe(SEVERITY);
      expect(effects.recalculate).toHaveBeenCalledTimes(1);
      expect(
        (effects.feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
          .feedInfoInMarkdown,
      ).toContain("Critical");
    },
  );

  test.each([
    ["the ID column", { incidentSeverityId: new ObjectID(SEVERITY) }],
    ["the relation", { incidentSeverity: { _id: SEVERITY } }],
  ] as Array<[string, Record<string, unknown>]>)(
    "the severity the incident already held, written back under %s, is not announced",
    async (_label: string, data: Record<string, unknown>) => {
      const effects: SeverityEffects = spyOnSeverityEffects();

      await runUpdate(data, SEVERITY);

      expect(effects.severityLookup).not.toHaveBeenCalled();
      expect(effects.recalculate).not.toHaveBeenCalled();
      expect(effects.feed).not.toHaveBeenCalled();
    },
  );
});

describe("an alert update records a severity change written under either name", () => {
  async function runUpdate(
    data: Record<string, unknown>,
    severityBeforeUpdate: string = PREVIOUS_SEVERITY,
  ): Promise<{ outcome: unknown; severityLookup: jest.Mock }> {
    const severityLookup: jest.Mock = jest
      .spyOn(AlertSeverityService, "findOneBy")
      .mockRejectedValue(new PastTheStep() as never) as unknown as jest.Mock;

    jest.spyOn(AlertService, "findOneById").mockResolvedValue({
      projectId: PROJECT_ID,
      alertNumber: 3,
    } as never);
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/a") as never);

    const outcome: unknown = await outcomeOf(
      hooksOf(AlertService)["onUpdateSuccess"]!(
        {
          updateBy: {
            query: { _id: RECORD_ID.toString() },
            data: data,
            props: { tenantId: PROJECT_ID, userId: USER_ID },
          },
          carryForward: {
            monitorChanges: {},
            severityIdsBeforeUpdate: {
              [RECORD_ID.toString()]: severityBeforeUpdate,
            },
          },
        },
        [RECORD_ID],
      ),
    );

    return { outcome: outcome, severityLookup: severityLookup };
  }

  test.each([
    ["the relation alone", { alertSeverity: { _id: SEVERITY } }],
    [
      "the ID column alone, as the API, Terraform and workflows write it",
      { alertSeverityId: new ObjectID(SEVERITY) },
    ],
    [
      "both names, holding the same id",
      {
        alertSeverityId: new ObjectID(SEVERITY),
        alertSeverity: { _id: SEVERITY },
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "%s: the severity is read by the stored id for the feed",
    async (_label: string, data: Record<string, unknown>) => {
      const { outcome, severityLookup } = await runUpdate(data);

      expect(outcome).toBeInstanceOf(PastTheStep);
      expect(
        String(
          (severityLookup.mock.calls[0]![0] as { query: { _id: unknown } })
            .query._id,
        ),
      ).toBe(SEVERITY);
    },
  );

  test.each([
    ["the ID column", { alertSeverityId: new ObjectID(SEVERITY) }],
    ["the relation", { alertSeverity: { _id: SEVERITY } }],
  ] as Array<[string, Record<string, unknown>]>)(
    "the severity the alert already held, written back under %s, is not announced",
    async (_label: string, data: Record<string, unknown>) => {
      const { outcome, severityLookup } = await runUpdate(data, SEVERITY);

      expect(outcome).not.toBeInstanceOf(PastTheStep);
      expect(severityLookup).not.toHaveBeenCalled();
    },
  );
});
