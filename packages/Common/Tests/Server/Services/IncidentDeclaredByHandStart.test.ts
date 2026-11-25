import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { INCIDENT_DECLARED_BY_HAND_KEY } from "../../../Types/Incident/IncidentDeclaredByHandStart";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { StartingStage } from "../../../Utils/StartingStage";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// The refusals below are deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * "Start incidents declared by hand acknowledged" (#11137), as
 * IncidentService.onBeforeCreate applies it - the hook itself runs, with the
 * project's states and switch as stand-ins:
 *
 *   - an incident a declare form sends as declared by hand
 *     (miscDataProps.declaredByHand), with the switch on, no state picked and
 *     no on-call policy to page, starts in the project's acknowledged state,
 *     placed there as any incident declared acknowledged is - so it pages
 *     nobody, and still holds its monitors;
 *   - picking an on-call policy - the person's or the template's - starts it
 *     in the created state, so the policy pages;
 *   - a state the person picked, or the template's, wins;
 *   - nobody's incident but a declare form's is touched: without the flag,
 *     or with the switch off, it starts in the created state as always - and
 *     an incident created by anything else never even reads the switch;
 *   - a flag that is not true or false is refused before a number is taken;
 *   - a switch or a state list that cannot be read never fails a
 *     declaration: it starts in the created state.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000aa";

const CREATED_STATE: string = "c0000000-0000-4000-8000-000000000001";
const ACKNOWLEDGED_STATE: string = "c0000000-0000-4000-8000-000000000002";
const RESOLVED_STATE: string = "c0000000-0000-4000-8000-000000000003";

const POLICY_ID: string = "e0000000-0000-4000-8000-000000000001";

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
};

type OnBeforeCreate = (
  createBy: CreateBy<Incident>,
) => Promise<OnCreate<Incident>>;

interface Declared {
  incident: Incident;
  startingStage: StartingStage;
}

function state(data: {
  id: string;
  order: number;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}): IncidentState {
  const incidentState: IncidentState = new IncidentState();
  incidentState._id = data.id;
  incidentState.order = data.order;
  incidentState.isCreatedState = Boolean(data.isCreatedState);
  incidentState.isAcknowledgedState = Boolean(data.isAcknowledgedState);
  incidentState.isResolvedState = Boolean(data.isResolvedState);
  return incidentState;
}

let projectStates: Array<IncidentState> = [];
let isSwitchOn: boolean | undefined = undefined;
let switchReadFails: boolean = false;
let template: IncidentTemplate | null = null;
let projectReads: MockFunction;
let counter: MockFunction;

function newIncident(): Incident {
  const incident: Incident = new Incident();
  incident.title = "Checkout is down";
  incident.incidentSeverityId = new ObjectID(
    "d0000000-0000-4000-8000-000000000001",
  );
  return incident;
}

function policy(id: string): OnCallDutyPolicy {
  const onCallDutyPolicy: OnCallDutyPolicy = new OnCallDutyPolicy();
  onCallDutyPolicy._id = id;
  return onCallDutyPolicy;
}

async function declare(
  data: Incident,
  miscDataProps?: JSONObject | undefined,
): Promise<Declared> {
  const onCreate: OnCreate<Incident> = await (
    IncidentService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate({
    data: data,
    props: MEMBER_PROPS,
    ...(miscDataProps ? { miscDataProps: miscDataProps } : {}),
  });

  return {
    incident: onCreate.createBy.data,
    startingStage: (onCreate.carryForward as { startingStage: StartingStage })
      .startingStage,
  };
}

const BY_HAND: JSONObject = { [INCIDENT_DECLARED_BY_HAND_KEY]: true };

function startedIn(incident: Incident): string | undefined {
  return incident.currentIncidentStateId?.toString();
}

// The reads of the switch, as ProjectService was asked for them.
function switchReads(): Array<unknown> {
  return projectReads.mock.calls
    .map((call: Array<unknown>): unknown => {
      return call[0];
    })
    .filter((read: unknown): boolean => {
      const select: Record<string, unknown> =
        (read as { select?: Record<string, unknown> }).select || {};
      return select["startIncidentsDeclaredByHandAcknowledged"] === true;
    });
}

beforeEach(() => {
  projectStates = [
    state({ id: CREATED_STATE, order: 1, isCreatedState: true }),
    state({ id: ACKNOWLEDGED_STATE, order: 2, isAcknowledgedState: true }),
    state({ id: RESOLVED_STATE, order: 3, isResolvedState: true }),
  ];
  isSwitchOn = true;
  switchReadFails = false;
  template = null;

  // The created state, as getCreatedIncidentStateId reads it.
  jest.spyOn(IncidentStateService, "findOneBy").mockImplementation((() => {
    return Promise.resolve(
      projectStates.find((row: IncidentState): boolean => {
        return row.isCreatedState === true;
      }) || null,
    );
  }) as never);

  // The project's whole list, as the starting-state reads read it.
  jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockImplementation((() => {
      return Promise.resolve(projectStates);
    }) as never);

  projectReads = getJestMockFunction();
  projectReads.mockImplementation((() => {
    if (switchReadFails) {
      return Promise.reject(new Error("the database is away"));
    }

    const project: Project = new Project();
    project._id = PROJECT_ID.toString();

    if (isSwitchOn !== undefined) {
      project.startIncidentsDeclaredByHandAcknowledged = isSwitchOn;
    }

    return Promise.resolve(project);
  }) as never);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(projectReads as never);

  counter = getJestMockFunction();
  counter.mockResolvedValue({ counter: 7, prefix: undefined } as never);
  jest
    .spyOn(ProjectService, "incrementAndGetIncidentCounter")
    .mockImplementation(counter as never);

  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(FeedMarkdown.asMarkdown("Test User") as never);
  jest.spyOn(IncidentTemplateService, "findOneBy").mockImplementation((() => {
    return Promise.resolve(template);
  }) as never);
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockResolvedValue(undefined as never);
  // Whether the member may name what a template added is not asked here.
  jest
    .spyOn(
      IncidentService as unknown as {
        checkRecordsNamedSoFar: () => Promise<void>;
      },
      "checkRecordsNamedSoFar",
    )
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident declared by hand, in a project that starts them acknowledged", () => {
  test("starts in the acknowledged state when no state is picked and no policy pages", async () => {
    const declared: Declared = await declare(newIncident(), BY_HAND);

    expect(startedIn(declared.incident)).toBe(ACKNOWLEDGED_STATE);
    // Placed as any incident declared acknowledged is: it pages nobody.
    expect(declared.startingStage).toBe(StartingStage.Acknowledged);
    // And is still live: it holds its monitors until it is resolved.
    expect(declared.incident.holdsMonitors).toBe(true);
  });

  test("is written under the ID column alone, as every starting state is", async () => {
    const declared: Declared = await declare(newIncident(), BY_HAND);

    expect(declared.incident.currentIncidentStateId?.toString()).toBe(
      ACKNOWLEDGED_STATE,
    );
    expect(
      (declared.incident as unknown as Record<string, unknown>)[
        "currentIncidentState"
      ],
    ).toBeUndefined();
  });

  test("reads the switch once, as OneUptime, for the project declared in", async () => {
    await declare(newIncident(), BY_HAND);

    expect(switchReads()).toHaveLength(1);

    const read: { id: ObjectID; props: DatabaseCommonInteractionProps } =
      switchReads()[0] as never;
    expect(read.id.toString()).toBe(PROJECT_ID.toString());
    expect(read.props.isRoot).toBe(true);
  });

  test("starts in the created state when it pages an on-call policy, so the policy pages", async () => {
    const incident: Incident = newIncident();
    incident.onCallDutyPolicies = [policy(POLICY_ID)];

    const declared: Declared = await declare(incident, BY_HAND);

    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Open);
    // Paging somebody: the switch is not even read.
    expect(switchReads()).toHaveLength(0);
  });

  test("starts in the created state when its template pages an on-call policy", async () => {
    template = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    template.onCallDutyPolicies = [policy(POLICY_ID)];

    const incident: Incident = newIncident();
    incident.createdIncidentTemplateId = TEMPLATE_ID;

    const declared: Declared = await declare(incident, BY_HAND);

    expect(
      (declared.incident.onCallDutyPolicies || []).map(
        (onCallDutyPolicy: OnCallDutyPolicy): string => {
          return onCallDutyPolicy._id?.toString() || "";
        },
      ),
    ).toEqual([POLICY_ID]);
    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Open);
  });

  test("starts where its template says, when the template names a state", async () => {
    template = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    template.initialIncidentStateId = new ObjectID(RESOLVED_STATE);

    const incident: Incident = newIncident();
    incident.createdIncidentTemplateId = TEMPLATE_ID;

    const declared: Declared = await declare(incident, BY_HAND);

    expect(startedIn(declared.incident)).toBe(RESOLVED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Resolved);
    expect(switchReads()).toHaveLength(0);
  });

  test("starts in a state the person picked, under either of its names", async () => {
    const byId: Incident = newIncident();
    byId.currentIncidentStateId = new ObjectID(RESOLVED_STATE);

    expect(startedIn((await declare(byId, BY_HAND)).incident)).toBe(
      RESOLVED_STATE,
    );

    const byRelation: Incident = newIncident();
    (byRelation as unknown as Record<string, unknown>)["currentIncidentState"] =
      state({ id: CREATED_STATE, order: 1, isCreatedState: true });

    const declared: Declared = await declare(byRelation, BY_HAND);

    // Picked the created state on purpose: it starts there, and pages.
    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Open);
    expect(switchReads()).toHaveLength(0);
  });

  test("starts in the project's acknowledged state wherever the project placed it, past a state of its own", async () => {
    const triaged: string = "c0000000-0000-4000-8000-0000000000aa";

    projectStates = [
      state({ id: CREATED_STATE, order: 1, isCreatedState: true }),
      // A state of the project's own above Acknowledged: still not acknowledged.
      state({ id: triaged, order: 2 }),
      state({ id: ACKNOWLEDGED_STATE, order: 3, isAcknowledgedState: true }),
      state({ id: RESOLVED_STATE, order: 4, isResolvedState: true }),
    ];

    const declared: Declared = await declare(newIncident(), BY_HAND);

    expect(startedIn(declared.incident)).toBe(ACKNOWLEDGED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Acknowledged);
  });
});

describe("an incident that starts as every incident does", () => {
  test("with the switch off", async () => {
    isSwitchOn = false;

    const declared: Declared = await declare(newIncident(), BY_HAND);

    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Open);
  });

  test("in a project that never set the switch", async () => {
    isSwitchOn = undefined;

    const declared: Declared = await declare(newIncident(), BY_HAND);

    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Open);
  });

  test("created by anything but a declare form - a monitor, a rule, the API - which never reads the switch", async () => {
    const declared: Declared = await declare(newIncident());

    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Open);
    expect(switchReads()).toHaveLength(0);
  });

  test("sent as not declared by hand", async () => {
    const declared: Declared = await declare(newIncident(), {
      [INCIDENT_DECLARED_BY_HAND_KEY]: false,
    });

    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
    expect(switchReads()).toHaveLength(0);
  });

  test("when the switch cannot be read: declaring never fails over it", async () => {
    switchReadFails = true;

    const declared: Declared = await declare(newIncident(), BY_HAND);

    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Open);
  });

  test("when the project has no acknowledged state", async () => {
    projectStates = [
      state({ id: CREATED_STATE, order: 1, isCreatedState: true }),
      state({ id: RESOLVED_STATE, order: 3, isResolvedState: true }),
    ];

    const declared: Declared = await declare(newIncident(), BY_HAND);

    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
    expect(declared.startingStage).toBe(StartingStage.Open);
  });
});

describe("the flag", () => {
  test.each([["true"], [1], [{}], [[]]])(
    "%j is refused, before an incident number is taken",
    async (value: unknown) => {
      await expect(
        declare(newIncident(), {
          [INCIDENT_DECLARED_BY_HAND_KEY]: value as JSONObject,
        }),
      ).rejects.toThrow(BadDataException);

      await expect(
        declare(newIncident(), {
          [INCIDENT_DECLARED_BY_HAND_KEY]: value as JSONObject,
        }),
      ).rejects.toThrow("declaredByHand must be true or false.");

      expect(counter).not.toHaveBeenCalled();
    },
  );

  test("null reads as not sent", async () => {
    const declared: Declared = await declare(newIncident(), {
      [INCIDENT_DECLARED_BY_HAND_KEY]: null,
    });

    expect(startedIn(declared.incident)).toBe(CREATED_STATE);
  });
});
