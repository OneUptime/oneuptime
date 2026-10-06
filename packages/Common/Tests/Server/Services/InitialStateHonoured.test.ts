import AIAlertInvestigationRunner from "../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AlertEpisodeLabelRuleEngineService from "../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOwnerRuleEngineService from "../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodePrivacyRuleEngineService from "../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertLabelRuleEngineService from "../../../Server/Services/AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentEpisodeLabelRuleEngineService from "../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodePrivacyRuleEngineService from "../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodeService, {
  EPISODE_FIRST_STATE_SUBSCRIBER_MESSAGE,
} from "../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { StartingStage } from "../../../Utils/StartingStage";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * Create Alert, Create Alert Episode and Create Incident Episode offer an
 * Initial State, under More fields: "Leave empty for the usual starting
 * state. Pick a later state to record an alert that is already acknowledged
 * or resolved." Declare Incident honours its own (IncidentService); these
 * three ignored theirs - every alert and episode was stamped with the
 * project's created state, whatever the write named - so the form offered a
 * field that did nothing, and an API, Terraform or workflow write of
 * currentAlertStateId / currentIncidentStateId was dropped the same way.
 *
 * Now a state the write picks is where the record starts:
 *
 *   - under either of its names - the form sends the relation
 *     (`currentAlertState: { _id }`), the API, Terraform and workflows the ID
 *     column - and the two must agree;
 *   - checked against the project like the record's other references: a
 *     state of another project is refused with the same words as one that
 *     does not exist, before a number is used;
 *   - written under the ID column alone (RelationIdUtil.stamp), so the state
 *     checked is the state stored;
 *   - with no state picked, the project's created state, as before - and the
 *     created state is looked up only then;
 *   - an episode that starts in a resolved state is resolved from the moment
 *     it exists (resolvedAt), which is what grouping, auto-resolve and the
 *     unresolved lists read;
 *   - its first timeline row is that state, with no owner notification of
 *     its own (the "created" notification names the state), and an incident
 *     episode's first row never sends subscribers a message of its own: they
 *     hear about the episode through its created notification, if at all.
 *
 * The services' own hooks run; which records the project has is a stand-in
 * (stubProjectDirectory), and so is every service the hooks call out to.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4aaa-8bbb-000000000002",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4aaa-8bbb-0000000000d1",
);

// The project's states, in order: where new records start, then later ones.
const CREATED_STATE: string = "0193c0de-5a7e-4aaa-8bbb-0000000000a1";
const ACKNOWLEDGED_STATE: string = "0193c0de-5a7e-4aaa-8bbb-0000000000a2";
const RESOLVED_STATE: string = "0193c0de-5a7e-4aaa-8bbb-0000000000a3";

// A state of another project, and an id no state has.
const FOREIGN_STATE: string = "0193c0de-5a7e-4aaa-8bbb-0000000000f1";
const MISSING_STATE: string = "0193c0de-5a7e-4aaa-8bbb-0000000000e9";

interface StateRow {
  id: string;
  // Its place in the project's list: 1 is the top.
  order: number;
  isCreatedState: boolean;
  isAcknowledgedState: boolean;
  isResolvedState: boolean;
}

const PROJECT_STATES: Array<StateRow> = [
  {
    id: CREATED_STATE,
    order: 1,
    isCreatedState: true,
    isAcknowledgedState: false,
    isResolvedState: false,
  },
  {
    id: ACKNOWLEDGED_STATE,
    order: 2,
    isCreatedState: false,
    isAcknowledgedState: true,
    isResolvedState: false,
  },
  {
    id: RESOLVED_STATE,
    order: 3,
    isCreatedState: false,
    isAcknowledgedState: false,
    isResolvedState: true,
  },
];

type StateModel = AlertState | IncidentState;

type Hooks = Record<string, (...args: Array<unknown>) => Promise<unknown>>;

interface Kind {
  name: string;
  // How the generic project check names the record: "alert episode".
  subject: string;
  service: unknown;
  stateService: unknown;
  stateModel: new () => StateModel;
  // The state's two names, ID column first.
  idColumn: string;
  relation: string;
  // How a conflict between the two names is worded: "Alert State".
  stateTitle: string;
  // The project counter the create spends a number from.
  counter:
    | "incrementAndGetAlertCounter"
    | "incrementAndGetAlertEpisodeCounter"
    | "incrementAndGetIncidentEpisodeCounter";
  newRecord: () => Record<string, unknown>;
  // The refusal when the project has no created state and none is picked.
  noCreatedState: string;
  // Whether the record carries resolvedAt (episodes do).
  hasResolvedAt: boolean;
}

const KINDS: Array<Kind> = [
  {
    name: "alert",
    subject: "alert",
    service: AlertService,
    stateService: AlertStateService,
    stateModel: AlertState,
    idColumn: "currentAlertStateId",
    relation: "currentAlertState",
    stateTitle: "Alert State",
    counter: "incrementAndGetAlertCounter",
    newRecord: () => {
      return { title: "Disk is full" };
    },
    noCreatedState:
      "Created alert state not found for this project. Please add created alert state from settings.",
    hasResolvedAt: false,
  },
  {
    name: "alert episode",
    subject: "alert episode",
    service: AlertEpisodeService,
    stateService: AlertStateService,
    stateModel: AlertState,
    idColumn: "currentAlertStateId",
    relation: "currentAlertState",
    stateTitle: "Alert State",
    counter: "incrementAndGetAlertEpisodeCounter",
    newRecord: () => {
      return { title: "Disk alerts" };
    },
    noCreatedState:
      "Created alert state not found for this project. Please add created alert state from settings.",
    hasResolvedAt: true,
  },
  {
    name: "incident episode",
    subject: "incident episode",
    service: IncidentEpisodeService,
    stateService: IncidentStateService,
    stateModel: IncidentState,
    idColumn: "currentIncidentStateId",
    relation: "currentIncidentState",
    stateTitle: "Incident State",
    counter: "incrementAndGetIncidentEpisodeCounter",
    newRecord: () => {
      return { title: "Checkout errors" };
    },
    noCreatedState:
      "Created incident state not found for this project. Please add created incident state from settings.",
    hasResolvedAt: true,
  },
];

function hooksOf(service: unknown): Hooks {
  return service as Hooks;
}

function has(data: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

let directory: ProjectDirectoryStub;

// Whether the project still has a state flagged as the created state.
let projectHasCreatedState: boolean = true;

// Each state lookup a create hook made: the query it sent.
let stateLookups: Array<Record<string, unknown>> = [];

// The counter increments a create spent.
let numbersUsed: number = 0;

// One of the project's states, as the database hands it back.
function stateModelOf(kind: Kind, row: StateRow): StateModel {
  const state: StateModel = new kind.stateModel();
  state._id = row.id;
  state.order = row.order;
  state.isCreatedState = row.isCreatedState;
  state.isAcknowledgedState = row.isAcknowledgedState;
  state.isResolvedState = row.isResolvedState;
  return state;
}

/*
 * The project's states, answered the way the database would: pinned to the
 * project, one by id or by the created-state flag, or the whole list in its
 * order - which is how where a record starts is read (getStartingStage).
 */
function stubStateLookups(kind: Kind): void {
  jest
    .spyOn(
      kind.stateService as {
        findBy: (...args: Array<unknown>) => Promise<unknown>;
      },
      "findBy",
    )
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<StateModel>> => {
      stateLookups.push(findBy.query);

      if (idOf(findBy.query["projectId"]) !== idOf(PROJECT_ID)) {
        return [];
      }

      return PROJECT_STATES.map((row: StateRow): StateModel => {
        return stateModelOf(kind, row);
      });
    }) as never);

  jest
    .spyOn(
      kind.stateService as {
        findOneBy: (...args: Array<unknown>) => Promise<unknown>;
      },
      "findOneBy",
    )
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<StateModel | null> => {
      const query: Record<string, unknown> = findBy.query;
      stateLookups.push(query);

      if (idOf(query["projectId"]) !== idOf(PROJECT_ID)) {
        return null;
      }

      let row: StateRow | undefined = undefined;

      if (query["isCreatedState"] === true) {
        row = projectHasCreatedState
          ? PROJECT_STATES.find((state: StateRow): boolean => {
              return state.isCreatedState;
            })
          : undefined;
      } else if (query["_id"]) {
        row = PROJECT_STATES.find((state: StateRow): boolean => {
          return state.id === idOf(query["_id"]);
        });
      }

      if (!row) {
        return null;
      }

      return stateModelOf(kind, row);
    }) as never);
}

function createdStateLookups(): number {
  return stateLookups.filter((query: Record<string, unknown>): boolean => {
    return query["isCreatedState"] === true;
  }).length;
}

beforeEach(() => {
  projectHasCreatedState = true;
  stateLookups = [];
  numbersUsed = 0;

  directory = stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      AlertState: [CREATED_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
      IncidentState: [CREATED_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
    },
  });

  // Each number a create spends from the project's counter, counted.
  const useNumber: () => Promise<{
    counter: number;
    prefix: string | undefined;
  }> = async (): Promise<{ counter: number; prefix: string | undefined }> => {
    numbersUsed++;
    return { counter: 42, prefix: undefined };
  };

  jest
    .spyOn(ProjectService, "incrementAndGetAlertCounter")
    .mockImplementation(useNumber as never);
  jest
    .spyOn(ProjectService, "incrementAndGetAlertEpisodeCounter")
    .mockImplementation(useNumber as never);
  jest
    .spyOn(ProjectService, "incrementAndGetIncidentEpisodeCounter")
    .mockImplementation(useNumber as never);

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function create(
  kind: Kind,
  values: Record<string, unknown>,
  props: Record<string, unknown> = { tenantId: PROJECT_ID },
): Promise<Record<string, unknown>> {
  stubStateLookups(kind);

  const data: Record<string, unknown> = { ...kind.newRecord(), ...values };

  await hooksOf(kind.service)["onBeforeCreate"]!({
    data: data,
    props: props,
  });

  return data;
}

async function refusalOf(
  kind: Kind,
  values: Record<string, unknown>,
  props?: Record<string, unknown>,
): Promise<string> {
  let outcome: unknown = "went on";

  try {
    await create(kind, values, props);
  } catch (error) {
    outcome = error;
  }

  expect(outcome).toBeInstanceOf(BadDataException);
  return (outcome as Error).message;
}

describe.each(KINDS)(
  "creating an $name: the state it starts in",
  (kind: Kind) => {
    test("a state picked under the relation - the create form's Initial State - is where it starts, written under the ID column alone", async () => {
      const data: Record<string, unknown> = await create(kind, {
        [kind.relation]: { _id: ACKNOWLEDGED_STATE },
      });

      expect(idOf(data[kind.idColumn])).toBe(ACKNOWLEDGED_STATE);
      expect(has(data, kind.relation)).toBe(false);
      expect(numbersUsed).toBe(1);
    });

    test("a state picked under the ID column - the API, Terraform, a workflow - is where it starts", async () => {
      const data: Record<string, unknown> = await create(kind, {
        [kind.idColumn]: new ObjectID(RESOLVED_STATE),
      });

      expect(idOf(data[kind.idColumn])).toBe(RESOLVED_STATE);
      expect(has(data, kind.relation)).toBe(false);
    });

    test("a state picked as a plain id string is where it starts", async () => {
      const data: Record<string, unknown> = await create(kind, {
        [kind.idColumn]: ACKNOWLEDGED_STATE,
      });

      expect(idOf(data[kind.idColumn])).toBe(ACKNOWLEDGED_STATE);
    });

    test("the same state under both names, in any letter case, is one state", async () => {
      const data: Record<string, unknown> = await create(kind, {
        [kind.idColumn]: new ObjectID(ACKNOWLEDGED_STATE.toUpperCase()),
        [kind.relation]: { _id: ACKNOWLEDGED_STATE },
      });

      expect(idOf(data[kind.idColumn])).toBe(ACKNOWLEDGED_STATE);
      expect(has(data, kind.relation)).toBe(false);
    });

    test("the project's created state picked on purpose is where it starts", async () => {
      const data: Record<string, unknown> = await create(kind, {
        [kind.relation]: { _id: CREATED_STATE },
      });

      expect(idOf(data[kind.idColumn])).toBe(CREATED_STATE);
    });

    test("with no state picked it starts in the project's created state", async () => {
      const data: Record<string, unknown> = await create(kind, {});

      expect(idOf(data[kind.idColumn])).toBe(CREATED_STATE);
      expect(has(data, kind.relation)).toBe(false);
      expect(numbersUsed).toBe(1);
    });

    test("a state left empty - a cleared field - is no pick: it starts in the created state", async () => {
      for (const empty of [null, { _id: null }, ""]) {
        const data: Record<string, unknown> = await create(kind, {
          [kind.relation]: empty,
        });

        expect(idOf(data[kind.idColumn])).toBe(CREATED_STATE);
        expect(has(data, kind.relation)).toBe(false);
      }
    });

    test("the created state is looked up only when no state is picked", async () => {
      await create(kind, { [kind.relation]: { _id: ACKNOWLEDGED_STATE } });
      expect(createdStateLookups()).toBe(0);

      await create(kind, {});
      expect(createdStateLookups()).toBe(1);
    });

    test("a picked state is checked against the project, under the name it came in", async () => {
      await create(kind, { [kind.relation]: { _id: ACKNOWLEDGED_STATE } });

      expect(
        directory.recordLookups.some(
          (lookup: {
            model: string;
            projectId: string;
            ids: Array<string>;
          }) => {
            return (
              lookup.projectId === PROJECT_ID.toString() &&
              lookup.ids
                .map((id: string): string => {
                  return id.toLowerCase();
                })
                .includes(ACKNOWLEDGED_STATE)
            );
          },
        ),
      ).toBe(true);
    });

    test("two different states under the two names are refused, naming both fields, and no number is used", async () => {
      const message: string = await refusalOf(kind, {
        [kind.idColumn]: new ObjectID(CREATED_STATE),
        [kind.relation]: { _id: ACKNOWLEDGED_STATE },
      });

      expect(message).toBe(
        RelationIdUtil.getConflictMessage(kind.stateTitle, [
          kind.idColumn,
          kind.relation,
        ]),
      );
      expect(numbersUsed).toBe(0);
    });

    test("a state under one name beside a clear under the other is refused", async () => {
      for (const values of [
        { [kind.idColumn]: null, [kind.relation]: { _id: RESOLVED_STATE } },
        {
          [kind.idColumn]: new ObjectID(RESOLVED_STATE),
          [kind.relation]: null,
        },
      ]) {
        const message: string = await refusalOf(kind, values);
        expect(message).toContain(
          `${kind.idColumn} and ${kind.relation} are names for the same field`,
        );
      }

      expect(numbersUsed).toBe(0);
    });

    test.each([
      [
        "the relation",
        (kind: Kind, id: string): Record<string, unknown> => {
          return { [kind.relation]: { _id: id } };
        },
      ],
      [
        "the ID column",
        (kind: Kind, id: string): Record<string, unknown> => {
          return { [kind.idColumn]: new ObjectID(id) };
        },
      ],
    ] as Array<[string, (kind: Kind, id: string) => Record<string, unknown>]>)(
      "another project's state under %s is refused with the same words as one that does not exist, and no number is used",
      async (
        _name: string,
        payload: (kind: Kind, id: string) => Record<string, unknown>,
      ) => {
        const foreign: string = await refusalOf(
          kind,
          payload(kind, FOREIGN_STATE),
        );
        const missing: string = await refusalOf(
          kind,
          payload(kind, MISSING_STATE),
        );

        expect(foreign).toContain(
          `This ${kind.subject} references records that are not in this project:`,
        );
        expect(foreign).toContain(`"${FOREIGN_STATE}"`);
        expect(missing.split(MISSING_STATE).join("<id>")).toBe(
          foreign.split(FOREIGN_STATE).join("<id>"),
        );
        expect(numbersUsed).toBe(0);
      },
    );

    test("a malformed state id is refused like one that does not exist", async () => {
      const message: string = await refusalOf(kind, {
        [kind.relation]: { _id: "not-a-state" },
      });

      expect(message).toContain(
        "references records that are not in this project",
      );
      expect(message).toContain('"not-a-state"');
      expect(numbersUsed).toBe(0);
    });

    test("a project without a created state: a picked state still works, and no pick is refused with the created-state message", async () => {
      projectHasCreatedState = false;

      const data: Record<string, unknown> = await create(kind, {
        [kind.relation]: { _id: ACKNOWLEDGED_STATE },
      });
      expect(idOf(data[kind.idColumn])).toBe(ACKNOWLEDGED_STATE);

      expect(await refusalOf(kind, {})).toBe(kind.noCreatedState);
    });

    test("OneUptime's own write (root, no project on the request) is checked against the record's project", async () => {
      const data: Record<string, unknown> = await create(
        kind,
        {
          projectId: PROJECT_ID,
          [kind.idColumn]: new ObjectID(ACKNOWLEDGED_STATE),
        },
        { isRoot: true },
      );

      expect(idOf(data[kind.idColumn])).toBe(ACKNOWLEDGED_STATE);

      const message: string = await refusalOf(
        kind,
        { projectId: PROJECT_ID, [kind.idColumn]: new ObjectID(FOREIGN_STATE) },
        { isRoot: true },
      );
      expect(message).toContain(`"${FOREIGN_STATE}"`);
    });

    test("the state is checked against the request's project, not a project the payload names", async () => {
      const message: string = await refusalOf(kind, {
        projectId: OTHER_PROJECT_ID,
        [kind.relation]: { _id: FOREIGN_STATE },
      });

      expect(message).toContain(`"${FOREIGN_STATE}"`);
    });
  },
);

describe.each(
  KINDS.filter((kind: Kind): boolean => {
    return kind.hasResolvedAt;
  }),
)("creating an $name in a resolved state", (kind: Kind) => {
  test("an episode that starts resolved is resolved from the moment it exists", async () => {
    const before: number = Date.now();

    const data: Record<string, unknown> = await create(kind, {
      [kind.relation]: { _id: RESOLVED_STATE },
    });

    expect(data["resolvedAt"]).toBeInstanceOf(Date);
    expect((data["resolvedAt"] as Date).getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
  });

  test("an episode that starts in a state before resolved has no resolvedAt", async () => {
    const data: Record<string, unknown> = await create(kind, {
      [kind.relation]: { _id: ACKNOWLEDGED_STATE },
    });

    expect(data["resolvedAt"]).toBeUndefined();
  });

  test("an episode that starts in the created state reads no state flags and has no resolvedAt", async () => {
    const data: Record<string, unknown> = await create(kind, {});

    expect(data["resolvedAt"]).toBeUndefined();
    // Only the created-state lookup: nothing asked where it starts.
    expect(stateLookups).toHaveLength(1);
    expect(createdStateLookups()).toBe(1);
  });

  test("a resolvedAt the write sent is not kept: resolvedAt follows the state the episode starts in", async () => {
    const yesterday: Date = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Starting before resolved, or in the created state: none.
    for (const values of [
      { [kind.relation]: { _id: ACKNOWLEDGED_STATE } },
      {},
    ]) {
      const data: Record<string, unknown> = await create(kind, {
        ...values,
        resolvedAt: yesterday,
      });

      expect(data["resolvedAt"]).toBeUndefined();
    }

    // Starting resolved: the moment it was created, not the one sent.
    const before: number = Date.now();
    const resolved: Record<string, unknown> = await create(kind, {
      [kind.relation]: { _id: RESOLVED_STATE },
      resolvedAt: yesterday,
    });

    expect((resolved["resolvedAt"] as Date).getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
  });
});

/*
 * What the success hooks do with the stored state: the record's first
 * timeline row. Each success hook runs a chain of steps after the create
 * returns; every step but the state change is a stand-in here, and the last
 * one tells the test the chain has run.
 */
describe("the first timeline row is the state the record starts in", () => {
  type Resolve = () => void;

  function stubStep(target: unknown, method: string, done?: Resolve): void {
    jest
      .spyOn(
        target as Record<string, (...args: Array<unknown>) => Promise<unknown>>,
        method,
      )
      .mockImplementation((async (): Promise<undefined> => {
        if (done) {
          done();
        }
        return undefined;
      }) as never);
  }

  // The rows the timeline service was asked to create.
  function captureTimelineRows(
    timelineService: unknown,
  ): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];

    jest
      .spyOn(
        timelineService as {
          findOneBy: (...args: Array<unknown>) => Promise<unknown>;
        },
        "findOneBy",
      )
      .mockResolvedValue(null as never);
    jest
      .spyOn(
        timelineService as {
          create: (...args: Array<unknown>) => Promise<unknown>;
        },
        "create",
      )
      .mockImplementation((async (createBy: {
        data: Record<string, unknown>;
        props: Record<string, unknown>;
      }): Promise<unknown> => {
        rows.push({ ...createBy.data, __props: createBy.props });
        return createBy.data;
      }) as never);

    return rows;
  }

  test("an alert: one row in the state it started in, written as OneUptime, owners not notified of it on its own", async () => {
    const rows: Array<Record<string, unknown>> = captureTimelineRows(
      AlertStateTimelineService,
    );

    let chainDone: Resolve = () => {};
    const chain: Promise<void> = new Promise<void>((resolve: Resolve) => {
      chainDone = resolve;
    });

    stubStep(AlertPrivacyRuleEngineService, "applyRulesToAlert");
    stubStep(AlertService, "handleAlertWorkspaceOperationsAsync");
    stubStep(AlertService, "createAlertFeedAsync");
    stubStep(AlertOwnerRuleEngineService, "applyRulesToAlert");
    stubStep(AlertLabelRuleEngineService, "applyRulesToAlert");
    stubStep(AlertOnCallRuleEngineService, "applyRulesToAlert");
    stubStep(RunbookRuleEngineService, "applyRulesToAlert");
    stubStep(AlertGroupingEngineService, "processAlert");
    stubStep(AlertService, "refreshReminderSchedule");
    stubStep(AIAlertInvestigationRunner, "investigateNewAlert");
    stubStep(AutoRemediationRuleEngineService, "onAlertCreated", chainDone);

    const alert: Alert = new Alert();
    alert.id = RECORD_ID;
    alert.projectId = PROJECT_ID;
    alert.currentAlertStateId = new ObjectID(RESOLVED_STATE);
    alert.rootCause = "Alert created by Ada";

    await hooksOf(AlertService)["onCreateSuccess"]!(
      { createBy: { data: alert, props: {} }, carryForward: null },
      alert,
    );
    await chain;

    expect(rows).toHaveLength(1);
    expect(idOf(rows[0]!["alertStateId"])).toBe(RESOLVED_STATE);
    expect(idOf(rows[0]!["alertId"])).toBe(idOf(RECORD_ID));
    expect(rows[0]!["isOwnerNotified"]).toBe(true);
    expect(rows[0]!["__props"]).toEqual({ isRoot: true });
  });

  test("an alert episode: one row in the state it started in, owners not notified of it on its own", async () => {
    const rows: Array<Record<string, unknown>> = captureTimelineRows(
      AlertEpisodeStateTimelineService,
    );

    let chainDone: Resolve = () => {};
    const chain: Promise<void> = new Promise<void>((resolve: Resolve) => {
      chainDone = resolve;
    });

    stubStep(AlertEpisodePrivacyRuleEngineService, "applyRulesToEpisode");
    stubStep(AlertEpisodeService, "handleEpisodeWorkspaceOperationsAsync");
    stubStep(AlertEpisodeService, "createEpisodeCreatedFeed");
    stubStep(AlertEpisodeOwnerRuleEngineService, "applyRulesToEpisode");
    stubStep(AlertEpisodeLabelRuleEngineService, "applyRulesToEpisode");
    stubStep(AlertEpisodeOnCallRuleEngineService, "applyRulesToEpisode");
    stubStep(
      AlertEpisodeService,
      "executeEpisodeOnCallDutyPoliciesAsync",
      chainDone,
    );

    const episode: AlertEpisode = new AlertEpisode();
    episode.id = RECORD_ID;
    episode.projectId = PROJECT_ID;
    episode.currentAlertStateId = new ObjectID(ACKNOWLEDGED_STATE);

    await hooksOf(AlertEpisodeService)["onCreateSuccess"]!(
      { createBy: { data: episode, props: {} }, carryForward: null },
      episode,
    );
    await chain;

    expect(rows).toHaveLength(1);
    expect(idOf(rows[0]!["alertStateId"])).toBe(ACKNOWLEDGED_STATE);
    expect(idOf(rows[0]!["alertEpisodeId"])).toBe(idOf(RECORD_ID));
    expect(rows[0]!["isOwnerNotified"]).toBe(true);
  });

  describe("an incident episode", () => {
    async function firstRowOf(
      episode: IncidentEpisode,
    ): Promise<Record<string, unknown>> {
      const rows: Array<Record<string, unknown>> = captureTimelineRows(
        IncidentEpisodeStateTimelineService,
      );

      let chainDone: Resolve = () => {};
      const chain: Promise<void> = new Promise<void>((resolve: Resolve) => {
        chainDone = resolve;
      });

      stubStep(IncidentEpisodePrivacyRuleEngineService, "applyRulesToEpisode");
      stubStep(IncidentEpisodeService, "handleEpisodeWorkspaceOperationsAsync");
      stubStep(IncidentEpisodeService, "createEpisodeCreatedFeed");
      stubStep(IncidentEpisodeOwnerRuleEngineService, "applyRulesToEpisode");
      stubStep(IncidentEpisodeLabelRuleEngineService, "applyRulesToEpisode");
      stubStep(IncidentEpisodeOnCallRuleEngineService, "applyRulesToEpisode");
      stubStep(
        IncidentEpisodeService,
        "executeEpisodeOnCallDutyPoliciesAsync",
        chainDone,
      );

      await hooksOf(IncidentEpisodeService)["onCreateSuccess"]!(
        { createBy: { data: episode, props: {} }, carryForward: null },
        episode,
      );
      await chain;

      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    function episodeIn(
      state: string,
      notifiesOnCreate: boolean | undefined,
    ): IncidentEpisode {
      const episode: IncidentEpisode = new IncidentEpisode();
      episode.id = RECORD_ID;
      episode.projectId = PROJECT_ID;
      episode.currentIncidentStateId = new ObjectID(state);

      if (notifiesOnCreate !== undefined) {
        episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated =
          notifiesOnCreate;
      }

      return episode;
    }

    test("one row in the state it started in, owners not notified of it on its own", async () => {
      const row: Record<string, unknown> = await firstRowOf(
        episodeIn(RESOLVED_STATE, true),
      );

      expect(idOf(row["incidentStateId"])).toBe(RESOLVED_STATE);
      expect(idOf(row["incidentEpisodeId"])).toBe(idOf(RECORD_ID));
      expect(row["isOwnerNotified"]).toBe(true);
    });

    /*
     * Its created notification is the one message about the episode: the
     * first state is never queued for subscribers on its own, whichever
     * state it is and whether or not the episode tells subscribers it was
     * created. The row says so as it is written, instead of waiting for the
     * job - which used to skip a first row only in the created state, and
     * would have sent an episode created as Acknowledged twice.
     */
    test.each([
      ["an acknowledged state, subscribers told", ACKNOWLEDGED_STATE, true],
      ["a resolved state, subscribers told", RESOLVED_STATE, true],
      ["the created state, subscribers told", CREATED_STATE, true],
      [
        "an acknowledged state, subscribers not told",
        ACKNOWLEDGED_STATE,
        false,
      ],
      ["the created state, subscribers not told", CREATED_STATE, false],
      [
        "an acknowledged state, the column's default",
        ACKNOWLEDGED_STATE,
        undefined,
      ],
    ] as Array<[string, string, boolean | undefined]>)(
      "the first state is never sent to subscribers on its own: %s",
      async (
        _name: string,
        state: string,
        notifiesOnCreate: boolean | undefined,
      ) => {
        const row: Record<string, unknown> = await firstRowOf(
          episodeIn(state, notifiesOnCreate),
        );

        expect(row["shouldStatusPageSubscribersBeNotified"]).toBe(false);
        expect(row["subscriberNotificationStatus"]).toBe(
          StatusPageSubscriberNotificationStatus.Skipped,
        );
        expect(row["subscriberNotificationStatusMessage"]).toBe(
          EPISODE_FIRST_STATE_SUBSCRIBER_MESSAGE,
        );
      },
    );
  });

  test("a later state change of an incident episode is unaffected: its row is queued for subscribers as before", async () => {
    const rows: Array<Record<string, unknown>> = captureTimelineRows(
      IncidentEpisodeStateTimelineService,
    );

    await IncidentEpisodeService.changeEpisodeState({
      projectId: PROJECT_ID,
      episodeId: RECORD_ID,
      incidentStateId: new ObjectID(RESOLVED_STATE),
      notifyOwners: true,
      rootCause: "Resolved from the episode page.",
      props: { isRoot: true },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!["isOwnerNotified"]).toBe(false);
    // Neither is set: the columns' defaults (notify, Pending) apply.
    expect(rows[0]!["shouldStatusPageSubscribersBeNotified"]).toBeUndefined();
    expect(rows[0]!["subscriberNotificationStatus"]).toBeUndefined();
  });
});

/*
 * The lookups the create hooks share, on the state services: the project's
 * created state, and how far along a state is (getStartingStage, which the
 * StartingStage suites cover in full). Each is pinned to the project and
 * reads only what it needs.
 */
describe("the state services' starting-state lookups", () => {
  interface Lookup {
    name: string;
    stateService: unknown;
    getCreatedStateId: (projectId: ObjectID) => Promise<ObjectID>;
    getStartingStage: (
      projectId: ObjectID,
      stateId: ObjectID,
    ) => Promise<StartingStage>;
    stateModel: new () => StateModel;
    noCreatedState: string;
  }

  const LOOKUPS: Array<Lookup> = [
    {
      name: "alert states",
      stateService: AlertStateService,
      getCreatedStateId: (projectId: ObjectID): Promise<ObjectID> => {
        return AlertStateService.getCreatedAlertStateId(projectId);
      },
      getStartingStage: (
        projectId: ObjectID,
        stateId: ObjectID,
      ): Promise<StartingStage> => {
        return AlertStateService.getStartingStage({
          projectId: projectId,
          alertStateId: stateId,
        });
      },
      stateModel: AlertState,
      noCreatedState:
        "Created alert state not found for this project. Please add created alert state from settings.",
    },
    {
      name: "incident states",
      stateService: IncidentStateService,
      getCreatedStateId: (projectId: ObjectID): Promise<ObjectID> => {
        return IncidentStateService.getCreatedIncidentStateId(projectId);
      },
      getStartingStage: (
        projectId: ObjectID,
        stateId: ObjectID,
      ): Promise<StartingStage> => {
        return IncidentStateService.getStartingStage({
          projectId: projectId,
          incidentStateId: stateId,
        });
      },
      stateModel: IncidentState,
      noCreatedState:
        "Created incident state not found for this project. Please add created incident state from settings.",
    },
  ];

  // Each read the lookup made: its query and what it selected.
  function stubReads(
    lookup: Lookup,
    answer: StateModel | null,
  ): Array<{
    query: Record<string, unknown>;
    select: Record<string, unknown>;
  }> {
    const reads: Array<{
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    }> = [];

    jest
      .spyOn(
        lookup.stateService as {
          findOneBy: (...args: Array<unknown>) => Promise<unknown>;
        },
        "findOneBy",
      )
      .mockImplementation((async (findBy: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
      }): Promise<StateModel | null> => {
        reads.push({ query: findBy.query, select: findBy.select });
        return answer;
      }) as never);

    return reads;
  }

  function state(lookup: Lookup, id: string): StateModel {
    const row: StateModel = new lookup.stateModel();
    row._id = id;
    return row;
  }

  test.each(LOOKUPS)(
    "$name: the created state is read pinned to the project, its id only",
    async (lookup: Lookup) => {
      const reads: Array<{
        query: Record<string, unknown>;
        select: Record<string, unknown>;
      }> = stubReads(lookup, state(lookup, CREATED_STATE));

      expect(idOf(await lookup.getCreatedStateId(PROJECT_ID))).toBe(
        CREATED_STATE,
      );
      expect(reads).toHaveLength(1);
      expect(reads[0]!.query["isCreatedState"]).toBe(true);
      expect(idOf(reads[0]!.query["projectId"])).toBe(idOf(PROJECT_ID));
      expect(reads[0]!.select).toEqual({ _id: true });
    },
  );

  test.each(LOOKUPS)(
    "$name: a project without a created state is told to add one",
    async (lookup: Lookup) => {
      stubReads(lookup, null);

      await expect(lookup.getCreatedStateId(PROJECT_ID)).rejects.toThrow(
        lookup.noCreatedState,
      );
    },
  );

  // The project's whole list, as getStartingStage reads it.
  function stubListReads(lookup: Lookup): Array<{
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    props: Record<string, unknown>;
  }> {
    const reads: Array<{
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    }> = [];

    jest
      .spyOn(
        lookup.stateService as {
          findBy: (...args: Array<unknown>) => Promise<unknown>;
        },
        "findBy",
      )
      .mockImplementation((async (findBy: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      }): Promise<Array<StateModel>> => {
        reads.push({
          query: findBy.query,
          select: findBy.select,
          props: findBy.props,
        });

        return PROJECT_STATES.map((row: StateRow): StateModel => {
          const model: StateModel = new lookup.stateModel();
          model._id = row.id;
          model.order = row.order;
          model.isCreatedState = row.isCreatedState;
          model.isAcknowledgedState = row.isAcknowledgedState;
          model.isResolvedState = row.isResolvedState;
          return model;
        });
      }) as never);

    return reads;
  }

  test.each(LOOKUPS)(
    "$name: where a state stands is read once, from the project's whole list, as OneUptime",
    async (lookup: Lookup) => {
      const reads: Array<{
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      }> = stubListReads(lookup);

      expect(
        await lookup.getStartingStage(PROJECT_ID, new ObjectID(RESOLVED_STATE)),
      ).toBe(StartingStage.Resolved);
      expect(reads).toHaveLength(1);
      expect(idOf(reads[0]!.query["projectId"])).toBe(idOf(PROJECT_ID));
      expect(reads[0]!.select).toEqual(
        expect.objectContaining({
          _id: true,
          order: true,
          isAcknowledgedState: true,
          isResolvedState: true,
        }),
      );
      expect(reads[0]!.props).toEqual({ isRoot: true });
    },
  );

  test.each(LOOKUPS)(
    "$name: the created, acknowledged and resolved states are open, acknowledged and resolved; a state not in the list is open",
    async (lookup: Lookup) => {
      stubListReads(lookup);

      expect(
        await lookup.getStartingStage(PROJECT_ID, new ObjectID(CREATED_STATE)),
      ).toBe(StartingStage.Open);
      expect(
        await lookup.getStartingStage(
          PROJECT_ID,
          new ObjectID(ACKNOWLEDGED_STATE),
        ),
      ).toBe(StartingStage.Acknowledged);
      expect(
        await lookup.getStartingStage(PROJECT_ID, new ObjectID(RESOLVED_STATE)),
      ).toBe(StartingStage.Resolved);
      expect(
        await lookup.getStartingStage(PROJECT_ID, new ObjectID(FOREIGN_STATE)),
      ).toBe(StartingStage.Open);
    },
  );
});
